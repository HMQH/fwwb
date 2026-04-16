package expo.modules.fraudintervention

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.os.bundleOf
import java.lang.ref.WeakReference
import java.util.concurrent.CopyOnWriteArrayList

object FraudInterventionRegistry {
  private val modules = CopyOnWriteArrayList<WeakReference<FraudInterventionModule>>()

  @Volatile
  var isAppActive: Boolean = false

  @Volatile
  var latestIncomingRisk: Bundle = defaultIncomingRiskBundle()

  @Volatile
  var latestRecordingStatus: Bundle = defaultRecordingStatusBundle()

  fun register(module: FraudInterventionModule) {
    modules.add(WeakReference(module))
  }

  fun unregister(module: FraudInterventionModule) {
    modules.removeAll { it.get() == null || it.get() == module }
  }

  fun emitIncomingRisk(bundle: Bundle) {
    latestIncomingRisk = bundle
    emit("onIncomingRisk", bundle)
  }

  fun emitRecordingStatus(bundle: Bundle) {
    latestRecordingStatus = bundle
    emit("onRecordingStatus", bundle)
  }

  fun emitAudioChunk(bundle: Bundle) {
    emit("onAudioChunk", bundle)
  }

  fun emitRiskWarning(bundle: Bundle) {
    emit("onRiskWarning", bundle)
  }

  fun clearCompletedRecording(callId: String?) {
    val latestCallId = latestRecordingStatus.getString("callId")
    val isRecording = latestRecordingStatus.getBoolean("isRecording", false)
    if (!isRecording && (callId.isNullOrBlank() || latestCallId == callId)) {
      latestRecordingStatus = defaultRecordingStatusBundle()
    }
  }

  private fun emit(eventName: String, payload: Bundle) {
    modules.removeAll { it.get() == null }
    modules.forEach { ref ->
      ref.get()?.sendEventSafe(eventName, payload)
    }
  }

  private fun defaultIncomingRiskBundle(): Bundle {
    return bundleOf(
      "callId" to null,
      "phoneNumber" to null,
      "riskLevel" to "low",
      "labels" to emptyArray<String>(),
      "message" to null,
      "suggestedAction" to "manual_recording"
    )
  }

  private fun defaultRecordingStatusBundle(): Bundle {
    return bundleOf(
      "status" to "idle",
      "callId" to null,
      "phoneNumber" to null,
      "riskLevel" to "low",
      "isRecording" to false,
      "finalFilePath" to null,
      "segmentCount" to 0,
      "durationMs" to 0,
      "reason" to null
    )
  }
}

object FraudRuntimeConfig {
  private const val PREFS_NAME = "fraud_intervention_runtime"
  private const val KEY_LOOKUP_BASE_URL = "lookup_base_url"

  fun setLookupBaseUrl(context: Context, apiBaseUrl: String?) {
    val normalized = apiBaseUrl
      ?.trim()
      ?.trimEnd('/')
      ?.takeIf { it.isNotBlank() }

    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .apply {
        if (normalized == null) {
          remove(KEY_LOOKUP_BASE_URL)
        } else {
          putString(KEY_LOOKUP_BASE_URL, normalized)
        }
      }
      .apply()
  }

  fun getLookupBaseUrl(context: Context): String? {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_LOOKUP_BASE_URL, null)
      ?.trim()
      ?.trimEnd('/')
      ?.takeIf { it.isNotBlank() }
  }
}

object FraudNotificationHelper {
  const val RECORDING_CHANNEL_ID = "fraud_recording"
  const val WARNING_CHANNEL_ID = "fraud_warning"
  const val RECORDING_NOTIFICATION_ID = 42001
  const val WARNING_NOTIFICATION_ID = 42002

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    if (manager.getNotificationChannel(RECORDING_CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(
          RECORDING_CHANNEL_ID,
          "反诈录音",
          NotificationManager.IMPORTANCE_LOW
        ).apply {
          description = "通话中的前台录音和转写提醒"
          setShowBadge(false)
        }
      )
    }

    if (manager.getNotificationChannel(WARNING_CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(
          WARNING_CHANNEL_ID,
          "风险提醒通知",
          NotificationManager.IMPORTANCE_HIGH
        ).apply {
          description = "高风险来电与通话过程风险提醒"
          enableVibration(true)
        }
      )
    }
  }
}

object FraudCallDetectionHelper {
  private const val REQUEST_CALL_SCREENING_ROLE = 42021

  fun getStatus(context: Context): Bundle {
    return bundleOf(
      "callScreeningEnabled" to isCallScreeningEnabled(context),
      "canRequestCallScreeningRole" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q),
      "phoneStatePermissionGranted" to hasPermission(context, Manifest.permission.READ_PHONE_STATE),
      "contactsPermissionGranted" to hasPermission(context, Manifest.permission.READ_CONTACTS),
      "overlayPermissionGranted" to canDrawOverlays(context)
    )
  }

  fun requestCallScreeningRole(activity: Activity?, context: Context): Boolean {
    val intent = when {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> {
        val roleManager = context.getSystemService(RoleManager::class.java) ?: return false
        if (roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
          return true
        }
        if (roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
          roleManager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING)
        } else {
          Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
        }
      }

      else -> Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
    }

    return try {
      if (activity != null) {
        activity.startActivityForResult(intent, REQUEST_CALL_SCREENING_ROLE)
      } else {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      }
      true
    } catch (_: Exception) {
      false
    }
  }

  fun isCallScreeningEnabled(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      return false
    }
    val roleManager = context.getSystemService(RoleManager::class.java) ?: return false
    return roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)
  }

  fun openOverlayPermissionSettings(activity: Activity?, context: Context): Boolean {
    val intent = Intent(
      Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
      android.net.Uri.parse("package:${context.packageName}")
    )

    return try {
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      }
      true
    } catch (_: Exception) {
      false
    }
  }

  fun canDrawOverlays(context: Context): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      Settings.canDrawOverlays(context)
    } else {
      true
    }
  }

  private fun hasPermission(context: Context, permission: String): Boolean {
    return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
  }
}
