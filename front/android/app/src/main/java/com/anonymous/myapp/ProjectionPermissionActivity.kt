package com.anonymous.myapp

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class ProjectionPermissionActivity : AppCompatActivity() {
  private val permissionLauncher =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      if (result.resultCode == Activity.RESULT_OK && result.data != null) {
        startProjectionSession(result.resultCode, result.data!!)
        startBubbleService()
      } else {
        Toast.makeText(this, "未开启共享屏幕", Toast.LENGTH_SHORT).show()
      }
      finish()
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.setBackgroundDrawableResource(android.R.color.transparent)
    window.setDimAmount(0f)

    if (savedInstanceState == null) {
      val manager = getSystemService(MediaProjectionManager::class.java)
      permissionLauncher.launch(manager.createScreenCaptureIntent())
    }
  }

  private fun startProjectionSession(resultCode: Int, data: Intent) {
    val intent = Intent(this, ProjectionSessionService::class.java).apply {
      action = ProjectionSessionService.ACTION_START
      putExtra(ProjectionSessionService.EXTRA_RESULT_CODE, resultCode)
      putExtra(ProjectionSessionService.EXTRA_RESULT_DATA, data)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      ContextCompat.startForegroundService(this, intent)
    } else {
      startService(intent)
    }
  }

  private fun startBubbleService() {
    val intent = Intent(this, FloatingBubbleService::class.java).apply {
      action = FloatingBubbleService.ACTION_START
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      ContextCompat.startForegroundService(this, intent)
    } else {
      startService(intent)
    }
  }
}
