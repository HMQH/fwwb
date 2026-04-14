package com.anonymous.myapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.appcompat.widget.AppCompatImageView
import androidx.core.app.NotificationCompat
import kotlin.math.abs

class FloatingBubbleService : Service() {
  companion object {
    const val ACTION_START = "com.anonymous.myapp.FLOATING_CAPTURE_START"
    const val ACTION_STOP = "com.anonymous.myapp.FLOATING_CAPTURE_STOP"

    private const val TAG = "FloatingBubbleService"
    private const val CHANNEL_ID = "floating_capture_channel"
    private const val NOTIFICATION_ID = 4107
  }

  private lateinit var windowManager: WindowManager
  private var bubbleView: View? = null
  private var layoutParams: WindowManager.LayoutParams? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }

    return try {
      val notification = createNotification()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(
          NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        )
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      if (bubbleView == null) {
        showBubble()
      }
      FloatingCaptureState.bubbleActive = true
      START_STICKY
    } catch (error: Throwable) {
      FloatingCaptureState.bubbleActive = false
      Log.e(TAG, "Unable to start floating bubble service", error)
      stopSelf()
      START_NOT_STICKY
    }
  }

  override fun onDestroy() {
    bubbleView?.let {
      windowManager.removeView(it)
      bubbleView = null
    }
    FloatingCaptureState.bubbleActive = false
    super.onDestroy()
  }

  private fun showBubble() {
    windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager

    val container = FrameLayout(this).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.WHITE)
        setStroke(dp(1), Color.parseColor("#D9E7FF"))
      }
      elevation = dp(12).toFloat()
      clipToOutline = true
    }

    val icon = AppCompatImageView(this).apply {
      setImageResource(R.drawable.ic_floating_camera)
      scaleType = ImageView.ScaleType.CENTER_INSIDE
      setPadding(dp(14), dp(14), dp(14), dp(14))
    }

    val bubbleSize = dp(64)
    container.addView(
      icon,
      FrameLayout.LayoutParams(bubbleSize, bubbleSize, Gravity.CENTER)
    )

    val overlayType =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      } else {
        @Suppress("DEPRECATION")
        WindowManager.LayoutParams.TYPE_PHONE
      }

    layoutParams = WindowManager.LayoutParams(
      bubbleSize,
      bubbleSize,
      overlayType,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = dp(18)
      y = dp(220)
    }

    var initialX = 0
    var initialY = 0
    var touchDownX = 0f
    var touchDownY = 0f
    var moved = false

    container.setOnTouchListener { _, event ->
      val params = layoutParams ?: return@setOnTouchListener false
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          initialX = params.x
          initialY = params.y
          touchDownX = event.rawX
          touchDownY = event.rawY
          moved = false
          true
        }

        MotionEvent.ACTION_MOVE -> {
          val dx = (event.rawX - touchDownX).toInt()
          val dy = (event.rawY - touchDownY).toInt()
          if (abs(dx) > 6 || abs(dy) > 6) {
            moved = true
          }
          params.x = initialX + dx
          params.y = initialY + dy
          windowManager.updateViewLayout(container, params)
          true
        }

        MotionEvent.ACTION_UP -> {
          if (!moved) {
            openSelectionScreen()
          }
          true
        }

        else -> false
      }
    }

    bubbleView = container
    Log.d(TAG, "Adding floating bubble view to window manager")
    windowManager.addView(container, layoutParams)
  }

  private fun openSelectionScreen() {
    val intent = Intent(this, CaptureSelectionActivity::class.java).apply {
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_SINGLE_TOP or
          Intent.FLAG_ACTIVITY_CLEAR_TOP
      )
    }
    startActivity(intent)
  }

  private fun createNotification(): Notification {
    ensureChannel()
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("反诈悬浮助手")
      .setContentText("点击悬浮球即可框选区域并发起截图。")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }

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
      "反诈悬浮助手",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "保持悬浮截图助手在后台运行。"
    }
    manager.createNotificationChannel(channel)
  }

  private fun dp(value: Int): Int =
    TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      value.toFloat(),
      resources.displayMetrics
    ).toInt()
}
