package com.zhimeng.antifraud

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.io.File
import java.io.FileOutputStream

class ProjectionSessionService : Service() {
  companion object {
const val ACTION_START = "com.zhimeng.antifraud.PROJECTION_SESSION_START"
const val ACTION_STOP = "com.zhimeng.antifraud.PROJECTION_SESSION_STOP"
    const val EXTRA_RESULT_CODE = "projection_result_code"
    const val EXTRA_RESULT_DATA = "projection_result_data"

    private const val TAG = "ProjectionSessionSvc"
    private const val CHANNEL_ID = "projection_session_channel"
    private const val NOTIFICATION_ID = 4108

    @Volatile
    private var currentSession: ProjectionSessionService? = null

    fun captureSelection(selection: android.graphics.Rect): File? =
      currentSession?.captureSelectionInternal(selection)

    fun hasActiveSession(): Boolean =
      currentSession?.isSessionReady() == true
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private var mediaProjection: MediaProjection? = null
  private var virtualDisplay: VirtualDisplay? = null
  private var imageReader: ImageReader? = null
  private var displayWidth: Int = 0
  private var displayHeight: Int = 0
  private var displayDensity: Int = 0

  private val projectionCallback = object : MediaProjection.Callback() {
    override fun onStop() {
      Log.d(TAG, "MediaProjection stopped by system")
      mainHandler.post {
        stopSelf()
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }

    if (intent?.action == ACTION_START) {
      val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
      val resultData = intent.getParcelableExtraCompat<Intent>(EXTRA_RESULT_DATA)
      if (resultCode != Activity.RESULT_OK || resultData == null) {
        stopSelf()
        return START_NOT_STICKY
      }

      return try {
        startAsForeground()
        initializeProjection(resultCode, resultData)
        FloatingCaptureState.projectionActive = true
        currentSession = this
        START_STICKY
      } catch (error: Throwable) {
        Log.e(TAG, "Unable to initialize projection session", error)
        FloatingCaptureState.clearProjectionState()
        stopSelf()
        START_NOT_STICKY
      }
    }

    return START_STICKY
  }

  override fun onDestroy() {
    super.onDestroy()
    teardownProjection()
    stopBubbleService()
    currentSession = null
    FloatingCaptureState.bubbleActive = false
    FloatingCaptureState.clearProjectionState()
  }

  private fun startAsForeground() {
    ensureChannel()
    val notification = createNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun initializeProjection(resultCode: Int, data: Intent) {
    teardownProjection()

    val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    val projection = manager.getMediaProjection(resultCode, data)
      ?: error("MediaProjection unavailable")
    projection.registerCallback(projectionCallback, mainHandler)

    val (width, height, density) = screenMetrics()
    val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 3)
    val display = projection.createVirtualDisplay(
      "floating-capture-session",
      width,
      height,
      density,
      DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
      reader.surface,
      null,
      mainHandler
    ) ?: error("VirtualDisplay unavailable")

    mediaProjection = projection
    imageReader = reader
    virtualDisplay = display
    displayWidth = width
    displayHeight = height
    displayDensity = density
  }

  private fun isSessionReady(): Boolean =
    mediaProjection != null && virtualDisplay != null && imageReader != null

  private fun captureSelectionInternal(selection: android.graphics.Rect): File? {
    val projection = mediaProjection ?: return null
    val display = virtualDisplay ?: return null
    val reader = imageReader ?: return null
    val width = displayWidth
    val height = displayHeight

    repeat(24) { attempt ->
      val image = reader.acquireLatestImage()
      if (image == null) {
        Thread.sleep(if (attempt < 4) 35L else 55L)
        return@repeat
      }

      try {
        val plane = image.planes[0]
        val buffer = plane.buffer
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * width

        val rawBitmap = Bitmap.createBitmap(
          width + rowPadding / pixelStride,
          height,
          Bitmap.Config.ARGB_8888
        )
        rawBitmap.copyPixelsFromBuffer(buffer)

        val fullBitmap = Bitmap.createBitmap(rawBitmap, 0, 0, width, height)
        rawBitmap.recycle()

        val cropLeft = selection.left.coerceIn(0, width - 1)
        val cropTop = selection.top.coerceIn(0, height - 1)
        val cropWidth = selection.width().coerceIn(1, width - cropLeft)
        val cropHeight = selection.height().coerceIn(1, height - cropTop)
        val cropped = Bitmap.createBitmap(fullBitmap, cropLeft, cropTop, cropWidth, cropHeight)
        fullBitmap.recycle()

        val captureDir = File(cacheDir, "floating-capture").apply { mkdirs() }
        val captureFile = File(captureDir, "capture-${System.currentTimeMillis()}.png")
        FileOutputStream(captureFile).use { output ->
          cropped.compress(Bitmap.CompressFormat.PNG, 100, output)
        }
        cropped.recycle()
        return captureFile
      } finally {
        image.close()
      }
    }

    Log.w(TAG, "Timed out waiting for screen frame")
    return null
  }

  private fun teardownProjection() {
    virtualDisplay?.release()
    virtualDisplay = null
    imageReader?.close()
    imageReader = null
    mediaProjection?.unregisterCallback(projectionCallback)
    mediaProjection?.stop()
    mediaProjection = null
  }

  private fun stopBubbleService() {
    val intent = Intent(this, FloatingBubbleService::class.java).apply {
      action = FloatingBubbleService.ACTION_STOP
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      ContextCompat.startForegroundService(this, intent)
    } else {
      startService(intent)
    }
  }

  private fun screenMetrics(): Triple<Int, Int, Int> {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bounds = getSystemService(android.view.WindowManager::class.java).currentWindowMetrics.bounds
      Triple(bounds.width(), bounds.height(), resources.displayMetrics.densityDpi)
    } else {
      @Suppress("DEPRECATION")
      val metrics = DisplayMetrics().also {
        getSystemService(android.view.WindowManager::class.java).defaultDisplay.getRealMetrics(it)
      }
      Triple(metrics.widthPixels, metrics.heightPixels, metrics.densityDpi)
    }
  }

  private fun createNotification(): Notification =
    NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("共享屏幕已开启")
      .setContentText("悬浮助手运行期间可连续截图，无需重复确认。")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = getSystemService(NotificationManager::class.java)
    val existing = manager.getNotificationChannel(CHANNEL_ID)
    if (existing != null) {
      return
    }

    val channel = NotificationChannel(
      CHANNEL_ID,
      "共享屏幕会话",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "保持共享屏幕会话，便于多次连续截图。"
    }
    manager.createNotificationChannel(channel)
  }

  @Suppress("DEPRECATION")
  private inline fun <reified T> Intent.getParcelableExtraCompat(key: String): T? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      getParcelableExtra(key, T::class.java)
    } else {
      getParcelableExtra(key) as? T
    }
}
