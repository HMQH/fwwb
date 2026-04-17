package expo.modules.fraudintervention

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.core.os.bundleOf
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FraudInterventionModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("FraudIntervention")

    Events("onIncomingRisk", "onRecordingStatus", "onAudioChunk", "onRiskWarning")

    OnCreate {
      FraudInterventionRegistry.register(this@FraudInterventionModule)
      FraudNotificationHelper.ensureChannels(context)
    }

    OnDestroy {
      FraudInterventionRegistry.unregister(this@FraudInterventionModule)
    }

    AsyncFunction("getStatusAsync") {
      bundleOf(
        "incomingRisk" to FraudInterventionRegistry.latestIncomingRisk,
        "recording" to FraudInterventionRegistry.latestRecordingStatus
      )
    }

    AsyncFunction("configureLookup") { apiBaseUrl: String? ->
      FraudRuntimeConfig.setLookupBaseUrl(context, apiBaseUrl)
      null
    }

    AsyncFunction("getCallDetectionStatusAsync") {
      FraudCallDetectionHelper.getStatus(context)
    }

    AsyncFunction("requestCallScreeningRoleAsync") {
      FraudCallDetectionHelper.requestCallScreeningRole(appContext.currentActivity, context)
    }

    AsyncFunction("openOverlayPermissionSettingsAsync") {
      FraudCallDetectionHelper.openOverlayPermissionSettings(appContext.currentActivity, context)
    }

    AsyncFunction("showOverlayPreviewAsync") {
      if (!FraudCallDetectionHelper.canDrawOverlays(context)) {
        return@AsyncFunction false
      }
      FraudOverlayController.showPermissionReadyOverlay(context)
      true
    }

    AsyncFunction("setAppActiveState") { isActive: Boolean ->
      FraudInterventionRegistry.isAppActive = isActive
      null
    }

    AsyncFunction("updateRecordingOverlayTranscript") { text: String? ->
      FraudOverlayController.updateRecordingTranscript(text)
      null
    }

    AsyncFunction("clearCompletedRecording") { callId: String? ->
      FraudInterventionRegistry.clearCompletedRecording(callId)
      if (!FraudRecordingService.isRecordingActive) {
        FraudOverlayController.dismiss()
      }
      null
    }

    AsyncFunction("startFraudRecording") { callId: String, riskLevel: String, phoneNumber: String? ->
      val intent = Intent(context, FraudRecordingService::class.java).apply {
        action = FraudRecordingService.ACTION_START
        putExtra(FraudRecordingService.EXTRA_CALL_ID, callId)
        putExtra(FraudRecordingService.EXTRA_RISK_LEVEL, riskLevel)
        putExtra(FraudRecordingService.EXTRA_PHONE_NUMBER, phoneNumber)
        putExtra(FraudRecordingService.EXTRA_SHOW_OVERLAY, FraudCallDetectionHelper.canDrawOverlays(context))
      }
      ContextCompat.startForegroundService(context, intent)
      FraudInterventionRegistry.latestRecordingStatus
    }

    AsyncFunction("stopFraudRecording") { callId: String ->
      val intent = Intent(context, FraudRecordingService::class.java).apply {
        action = FraudRecordingService.ACTION_STOP
        putExtra(FraudRecordingService.EXTRA_CALL_ID, callId)
      }
      context.startService(intent)
      FraudInterventionRegistry.latestRecordingStatus
    }

    AsyncFunction("showRiskWarning") { level: String, text: String ->
      FraudRecordingService.showRiskWarning(context, level, text)
      null
    }
  }

  fun sendEventSafe(eventName: String, payload: android.os.Bundle) {
    try {
      sendEvent(eventName, payload)
    } catch (_: Exception) {
    }
  }
}
