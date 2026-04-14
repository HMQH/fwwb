package com.anonymous.myapp

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class FloatingCaptureModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "FloatingCapture"

  @ReactMethod
  fun getStatus(promise: Promise) {
    promise.resolve(buildStatusMap())
  }

  @ReactMethod
  fun openOverlaySettings() {
    val context = reactApplicationContext
    val intent = Intent(
      Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
      Uri.parse("package:${context.packageName}")
    ).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(intent)
  }

  @ReactMethod
  fun startAssistant(promise: Promise) {
    val context = reactApplicationContext
    if (!Settings.canDrawOverlays(context)) {
      promise.resolve(buildStatusMap())
      return
    }

    if (FloatingCaptureState.projectionActive) {
      startBubbleService(context)
      promise.resolve(buildStatusMap())
      return
    }

    val intent = Intent(context, ProjectionPermissionActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(intent)
    promise.resolve(buildStatusMap())
  }

  @ReactMethod
  fun stopAssistant(promise: Promise) {
    val context = reactApplicationContext
    stopService(context, FloatingBubbleService::class.java, FloatingBubbleService.ACTION_STOP)
    stopService(context, ProjectionSessionService::class.java, ProjectionSessionService.ACTION_STOP)
    FloatingCaptureState.bubbleActive = false
    FloatingCaptureState.clearProjectionState()
    promise.resolve(buildStatusMap())
  }

  @ReactMethod
  fun consumePendingCapture(promise: Promise) {
    val uri = FloatingCaptureState.pendingCaptureUri
    val name = FloatingCaptureState.pendingCaptureName
    if (uri.isNullOrBlank() || name.isNullOrBlank()) {
      promise.resolve(null)
      return
    }

    val result = Arguments.createMap().apply {
      putString("uri", uri)
      putString("name", name)
      putString("type", "image/png")
    }
    FloatingCaptureState.clearPendingCapture()
    promise.resolve(result)
  }

  private fun buildStatusMap() = Arguments.createMap().apply {
    putBoolean("platformSupported", true)
    putBoolean("overlayPermission", Settings.canDrawOverlays(reactApplicationContext))
    putBoolean("bubbleActive", FloatingCaptureState.bubbleActive)
    putBoolean("hasPendingCapture", !FloatingCaptureState.pendingCaptureUri.isNullOrBlank())
    putBoolean("screenCapturePermission", FloatingCaptureState.projectionActive)
  }

  private fun startBubbleService(context: ReactApplicationContext) {
    val intent = Intent(context, FloatingBubbleService::class.java).apply {
      action = FloatingBubbleService.ACTION_START
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      ContextCompat.startForegroundService(context, intent)
    } else {
      context.startService(intent)
    }
  }

  private fun stopService(
    context: ReactApplicationContext,
    serviceClass: Class<*>,
    action: String
  ) {
    val intent = Intent(context, serviceClass).apply {
      this.action = action
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      ContextCompat.startForegroundService(context, intent)
    } else {
      context.startService(intent)
    }
  }
}
