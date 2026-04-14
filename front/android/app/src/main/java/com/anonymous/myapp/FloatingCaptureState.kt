package com.anonymous.myapp

object FloatingCaptureState {
  @Volatile
  var bubbleActive: Boolean = false

  @Volatile
  var projectionActive: Boolean = false

  @Volatile
  var pendingCaptureUri: String? = null

  @Volatile
  var pendingCaptureName: String? = null

  fun clearPendingCapture() {
    pendingCaptureUri = null
    pendingCaptureName = null
  }

  fun clearProjectionState() {
    projectionActive = false
  }
}
