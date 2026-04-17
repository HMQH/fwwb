package expo.modules.fraudintervention

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.telephony.TelephonyManager
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.os.bundleOf
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID
import kotlin.concurrent.thread
import kotlin.math.max

class FraudRecordingService : Service() {
  companion object {
    private const val TAG = "FraudRecordingService"
    const val ACTION_START = "fraud.action.START_RECORDING"
    const val ACTION_STOP = "fraud.action.STOP_RECORDING"
    const val ACTION_CALL_CONNECTED = "fraud.action.CALL_CONNECTED"
    const val EXTRA_CALL_ID = "callId"
    const val EXTRA_RISK_LEVEL = "riskLevel"
    const val EXTRA_PHONE_NUMBER = "phoneNumber"
    const val EXTRA_SHOW_OVERLAY = "showOverlay"

    @Volatile
    var isRecordingActive: Boolean = false

    fun stopActiveRecording(context: Context) {
      context.startService(Intent(context, FraudRecordingService::class.java).apply { action = ACTION_STOP })
    }

    fun notifyCallConnected(context: Context) {
      context.startService(Intent(context, FraudRecordingService::class.java).apply { action = ACTION_CALL_CONNECTED })
    }

    fun showRiskWarning(context: Context, level: String, text: String) {
      FraudNotificationHelper.ensureChannels(context)
      val notification = NotificationCompat.Builder(context, FraudNotificationHelper.WARNING_CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_sys_warning)
        .setContentTitle(if (level == "high") "高风险通话提醒" else "通话风险提醒")
        .setContentText(text)
        .setStyle(NotificationCompat.BigTextStyle().bigText(text))
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setCategory(NotificationCompat.CATEGORY_ALARM)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setAutoCancel(true)
        .setContentIntent(buildLaunchPendingIntent(context, null, level))
        .build()
      NotificationManagerCompat.from(context).notify(FraudNotificationHelper.WARNING_NOTIFICATION_ID, notification)
      FraudInterventionRegistry.emitRiskWarning(bundleOf("level" to level, "message" to text))
    }

    private fun buildLaunchPendingIntent(context: Context, callId: String?, riskLevel: String?): PendingIntent {
      val deepLink = Uri.parse(
        buildString {
          append("myapp://call-intervention")
          val query = mutableListOf<String>()
          if (!callId.isNullOrBlank()) query += "callId=$callId"
          if (!riskLevel.isNullOrBlank()) query += "riskLevel=$riskLevel"
          if (query.isNotEmpty()) append("?${query.joinToString("&")}")
        }
      )
      val intent = Intent(Intent.ACTION_VIEW, deepLink).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        setPackage(context.packageName)
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
      return PendingIntent.getActivity(context, 7, intent, flags)
    }
  }

  private val sampleRate = 16000
  private val channelConfig = AudioFormat.CHANNEL_IN_MONO
  private val audioFormat = AudioFormat.ENCODING_PCM_16BIT

  private data class RecorderSetup(
    val recorder: AudioRecord,
    val bufferSize: Int,
    val sourceName: String,
  )

  @Volatile
  private var workerRunning = false

  private var workerThread: Thread? = null
  private var audioRecord: AudioRecord? = null
  private var callId: String = UUID.randomUUID().toString()
  private var riskLevel: String = "low"
  private var phoneNumber: String? = null
  private var showOverlayWhileRecording: Boolean = false
  private var finalWavFile: File? = null
  private var finalOutput: RandomAccessFile? = null
  private var totalPcmBytes: Long = 0L
  private var totalDurationMs: Long = 0L
  private var chunkSeq: Int = 0
  private var activeSourceName: String = "mic"
  private var callConnected: Boolean = false
  private var speakerphoneForced: Boolean = false
  private var acousticEchoCanceler: AcousticEchoCanceler? = null
  private var noiseSuppressor: NoiseSuppressor? = null
  private var automaticGainControl: AutomaticGainControl? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        callId = intent.getStringExtra(EXTRA_CALL_ID) ?: callId
        riskLevel = intent.getStringExtra(EXTRA_RISK_LEVEL) ?: "low"
        phoneNumber = intent.getStringExtra(EXTRA_PHONE_NUMBER)
        showOverlayWhileRecording = intent.getBooleanExtra(EXTRA_SHOW_OVERLAY, showOverlayWhileRecording)
        callConnected = isCallCurrentlyActive()
        if (!workerRunning) {
          startRecording()
        }
      }

      ACTION_CALL_CONNECTED -> {
        callConnected = true
        if (workerRunning) {
          configureAudioRouteForCurrentState()
          updateRecordingNotification()
          emitStatus("recording", "call_connected")
        }
      }

      ACTION_STOP -> stopRecording("manual_stop")
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    stopRecording("service_destroy")
    super.onDestroy()
  }

  private fun startRecording() {
    FraudNotificationHelper.ensureChannels(this)
    configureAudioRouteForCurrentState()
    val recorderSetup = createRecorderSetup()
    if (recorderSetup == null) {
      emitStatus("stopped", "recorder_unavailable")
      restoreAudioRoute()
      stopSelf()
      return
    }

    activeSourceName = recorderSetup.sourceName
    startForeground(
      FraudNotificationHelper.RECORDING_NOTIFICATION_ID,
      createRecordingNotification()
    )

    val recorder = recorderSetup.recorder
    audioRecord = recorder
    prepareOutputFiles()
    workerRunning = true
    isRecordingActive = true
    try {
      recorder.startRecording()
    } catch (error: Exception) {
      Log.w(TAG, "Unable to start audio recorder", error)
      workerRunning = false
      isRecordingActive = false
      try {
        recorder.release()
      } catch (_: Exception) {
      }
      audioRecord = null
      emitStatus("stopped", "recorder_start_failed")
      restoreAudioRoute()
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return
    }
    emitStatus("recording")
    updateRecordingNotification()

    if (showOverlayWhileRecording && FraudCallDetectionHelper.canDrawOverlays(this)) {
      FraudOverlayController.showRecordingOverlay(this, callId, riskLevel, phoneNumber)
    }

    startWorker(recorderSetup)
  }

  private fun startWorker(recorderSetup: RecorderSetup) {
    workerThread = thread(start = true, name = "fraud-recording-worker") {
      val buffer = ByteArray(recorderSetup.bufferSize)
      while (workerRunning) {
        val read = recorderSetup.recorder.read(buffer, 0, buffer.size)
        if (read <= 0) {
          continue
        }

        val bytes = buffer.copyOf(read)
        appendPcm(bytes)
        emitChunk(bytes)
      }
    }
  }

  private fun createRecorderSetup(): RecorderSetup? {
    val minBuffer = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
    val bufferSize = max(minBuffer, sampleRate)
    val candidates = listOf(
      Pair(MediaRecorder.AudioSource.MIC, "mic"),
      Pair(MediaRecorder.AudioSource.VOICE_RECOGNITION, "voice_recognition"),
      Pair(MediaRecorder.AudioSource.UNPROCESSED, "unprocessed"),
      Pair(MediaRecorder.AudioSource.CAMCORDER, "camcorder"),
    )

    for ((source, sourceName) in candidates) {
      try {
        val recorder = buildRecorder(source, bufferSize)
        if (recorder.state == AudioRecord.STATE_INITIALIZED) {
          configureSpeakerLeakageCapture(recorder)
          return RecorderSetup(
            recorder = recorder,
            bufferSize = bufferSize,
            sourceName = sourceName,
          )
        }
        recorder.release()
      } catch (error: Exception) {
        Log.w(TAG, "Failed to initialize recorder source=$sourceName", error)
      }
    }

    return null
  }

  private fun buildRecorder(source: Int, bufferSize: Int): AudioRecord {
    val format = AudioFormat.Builder()
      .setEncoding(audioFormat)
      .setSampleRate(sampleRate)
      .setChannelMask(channelConfig)
      .build()

    val builder = AudioRecord.Builder()
      .setAudioSource(source)
      .setAudioFormat(format)
      .setBufferSizeInBytes(bufferSize)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      builder.setPrivacySensitive(false)
    }

    return builder.build()
  }

  private fun isCallCurrentlyActive(): Boolean {
    return try {
      val telephonyManager = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
      telephonyManager?.callState == TelephonyManager.CALL_STATE_OFFHOOK
    } catch (_: Exception) {
      false
    }
  }

  private fun configureAudioRouteForCurrentState() {
    val audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
    if (!callConnected) {
      return
    }

    if (!audioManager.isSpeakerphoneOn) {
      speakerphoneForced = true
    }

    try {
      audioManager.stopBluetoothSco()
    } catch (_: Exception) {
    }
    try {
      audioManager.isBluetoothScoOn = false
    } catch (_: Exception) {
    }
    try {
      audioManager.isSpeakerphoneOn = true
    } catch (_: Exception) {
    }
  }

  private fun restoreAudioRoute() {
    val audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return

    try {
      audioManager.stopBluetoothSco()
    } catch (_: Exception) {
    }
    try {
      audioManager.isBluetoothScoOn = false
    } catch (_: Exception) {
    }
    if (speakerphoneForced) {
      try {
        audioManager.isSpeakerphoneOn = false
      } catch (_: Exception) {
      }
    }
    speakerphoneForced = false
  }

  private fun configureSpeakerLeakageCapture(recorder: AudioRecord) {
    releaseAudioEffects()
    val sessionId = recorder.audioSessionId
    try {
      if (AcousticEchoCanceler.isAvailable()) {
        acousticEchoCanceler = AcousticEchoCanceler.create(sessionId)?.apply {
          enabled = false
        }
      }
    } catch (_: Exception) {
      acousticEchoCanceler = null
    }

    try {
      if (NoiseSuppressor.isAvailable()) {
        noiseSuppressor = NoiseSuppressor.create(sessionId)?.apply {
          enabled = false
        }
      }
    } catch (_: Exception) {
      noiseSuppressor = null
    }

    try {
      if (AutomaticGainControl.isAvailable()) {
        automaticGainControl = AutomaticGainControl.create(sessionId)?.apply {
          enabled = false
        }
      }
    } catch (_: Exception) {
      automaticGainControl = null
    }
  }

  private fun releaseAudioEffects() {
    try {
      acousticEchoCanceler?.release()
    } catch (_: Exception) {
    }
    acousticEchoCanceler = null

    try {
      noiseSuppressor?.release()
    } catch (_: Exception) {
    }
    noiseSuppressor = null

    try {
      automaticGainControl?.release()
    } catch (_: Exception) {
    }
    automaticGainControl = null
  }

  private fun createRecordingNotification(): android.app.Notification {
    val contentText = if (callConnected) {
      "已自动开启免提；接通后已切换通话态录音"
    } else {
      "等待接通；接通后将自动开启免提并切换录音"
    }

    return NotificationCompat.Builder(this, FraudNotificationHelper.RECORDING_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentTitle("正在进行反诈录音")
      .setContentText(contentText)
      .setStyle(NotificationCompat.BigTextStyle().bigText(contentText))
      .setOngoing(true)
      .setContentIntent(buildLaunchPendingIntent(this, callId, riskLevel))
      .build()
  }

  private fun updateRecordingNotification() {
    try {
      NotificationManagerCompat.from(this).notify(
        FraudNotificationHelper.RECORDING_NOTIFICATION_ID,
        createRecordingNotification()
      )
    } catch (_: Exception) {
    }
  }

  private fun prepareOutputFiles() {
    val dir = File(cacheDir, "fraud-recordings/$callId")
    dir.mkdirs()
    finalWavFile = File(dir, "full_recording.wav")
    finalOutput = RandomAccessFile(finalWavFile, "rw").apply {
      setLength(0)
      write(ByteArray(44))
    }
    totalPcmBytes = 0L
    totalDurationMs = 0L
    chunkSeq = 0
  }

  private fun appendPcm(bytes: ByteArray) {
    finalOutput?.write(bytes)
    totalPcmBytes += bytes.size.toLong()
    val chunkDuration = ((bytes.size / 2.0) / sampleRate * 1000.0).toLong()
    totalDurationMs += chunkDuration
  }

  private fun emitChunk(bytes: ByteArray) {
    chunkSeq += 1
    FraudInterventionRegistry.emitAudioChunk(
      bundleOf(
        "callId" to callId,
        "seq" to chunkSeq,
        "sampleRate" to sampleRate,
        "channelCount" to 1,
        "encoding" to "pcm16",
        "durationMs" to totalDurationMs,
        "chunkBase64" to Base64.encodeToString(bytes, Base64.NO_WRAP)
      )
    )
  }

  private fun stopRecording(reason: String) {
    if (!workerRunning && !isRecordingActive) {
      if (reason == "service_destroy") {
        FraudOverlayController.dismiss()
      }
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return
    }
    workerRunning = false
    isRecordingActive = false

    try {
      audioRecord?.stop()
    } catch (_: Exception) {
    }
    try {
      audioRecord?.release()
    } catch (_: Exception) {
    }
    audioRecord = null
    releaseAudioEffects()

    try {
      workerThread?.join(250)
    } catch (_: InterruptedException) {
    }
    workerThread = null

    finalizeWavFile()
    emitStatus("stopped", reason)

    if (showOverlayWhileRecording) {
      if (reason == "service_destroy") {
        FraudOverlayController.dismiss()
      } else {
        FraudOverlayController.showRecordingSavedOverlay(this, callId, riskLevel, phoneNumber)
      }
    }

    restoreAudioRoute()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun finalizeWavFile() {
    val output = finalOutput ?: return
    try {
      output.seek(0)
      writeWavHeader(output, totalPcmBytes, sampleRate, 1, 16)
      output.fd.sync()
    } catch (_: Exception) {
    } finally {
      try {
        output.close()
      } catch (_: Exception) {
      }
      finalOutput = null
    }
  }

  private fun emitStatus(status: String, reason: String? = null) {
    FraudInterventionRegistry.emitRecordingStatus(
      bundleOf(
        "status" to status,
        "reason" to reason,
        "callId" to callId,
        "phoneNumber" to phoneNumber,
        "riskLevel" to riskLevel,
        "isRecording" to (status == "recording"),
        "finalFilePath" to finalWavFile?.absolutePath,
        "captureMode" to "speaker_leakage",
        "captureSource" to activeSourceName,
        "captureHint" to if (callConnected) {
          "已自动开启免提；若仍无声，请手动确认扬声器已打开"
        } else {
          "等待接通；接通后会自动开启免提并切换录音"
        },
        "speakerphoneRequired" to true,
        "segmentCount" to if (finalWavFile != null) 1 else 0,
        "durationMs" to totalDurationMs
      )
    )
  }

  private fun writeWavHeader(
    output: RandomAccessFile,
    totalAudioLen: Long,
    sampleRate: Int,
    channels: Int,
    bitsPerSample: Int
  ) {
    val totalDataLen = totalAudioLen + 36
    val byteRate = sampleRate * channels * bitsPerSample / 8

    output.writeBytes("RIFF")
    output.writeInt(Integer.reverseBytes(totalDataLen.toInt()))
    output.writeBytes("WAVE")
    output.writeBytes("fmt ")
    output.writeInt(Integer.reverseBytes(16))
    output.writeShort(java.lang.Short.reverseBytes(1.toShort()).toInt())
    output.writeShort(java.lang.Short.reverseBytes(channels.toShort()).toInt())
    output.writeInt(Integer.reverseBytes(sampleRate))
    output.writeInt(Integer.reverseBytes(byteRate))
    output.writeShort(java.lang.Short.reverseBytes((channels * bitsPerSample / 8).toShort()).toInt())
    output.writeShort(java.lang.Short.reverseBytes(bitsPerSample.toShort()).toInt())
    output.writeBytes("data")
    output.writeInt(Integer.reverseBytes(totalAudioLen.toInt()))
  }
}
