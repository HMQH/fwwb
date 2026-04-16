package expo.modules.fraudintervention

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import androidx.core.os.bundleOf
import java.util.UUID

class FraudCallStateReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
    when (state) {
      TelephonyManager.EXTRA_STATE_RINGING -> handleIncomingRinging(context, intent)
      TelephonyManager.EXTRA_STATE_IDLE -> {
        if (FraudRecordingService.isRecordingActive) {
          FraudRecordingService.stopActiveRecording(context)
        } else {
          FraudOverlayController.dismiss()
        }
      }
    }
  }

  private fun handleIncomingRinging(context: Context, intent: Intent) {
    if (FraudCallDetectionHelper.isCallScreeningEnabled(context)) {
      return
    }

    val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
      ?.trim()
      ?.takeIf { it.isNotBlank() }
      ?: "unknown"

    val message =
      if (number == "unknown") {
        "当前系统未返回来电号码，可打开 App 手动开始录音与分析。"
      } else {
        "检测到新的来电，可进入 App 手动开始录音与分析。"
      }

    FraudInterventionRegistry.emitIncomingRisk(
      bundleOf(
        "callId" to UUID.randomUUID().toString(),
        "phoneNumber" to number,
        "riskLevel" to "low",
        "labels" to if (number == "unknown") {
          arrayOf("未识别号码", "等待人工判断")
        } else {
          arrayOf("普通来电", "可手动录音")
        },
        "message" to message,
        "suggestedAction" to "manual_recording"
      )
    )
  }
}
