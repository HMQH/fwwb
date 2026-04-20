package com.zhimeng.antifraud

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.io.File
import kotlin.concurrent.thread

class CaptureSelectionActivity : AppCompatActivity() {
  private lateinit var overlayView: SelectionOverlayView
  private lateinit var chromeContainer: FrameLayout
  private lateinit var closeButton: TextView

  private val mainHandler = Handler(Looper.getMainLooper())

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.setBackgroundDrawableResource(android.R.color.transparent)
    window.addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS)

    val root = FrameLayout(this).apply {
      setBackgroundColor(Color.TRANSPARENT)
    }

    overlayView = SelectionOverlayView(this)
    root.addView(
      overlayView,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT
      )
    )

    chromeContainer = FrameLayout(this)
    closeButton = buildCloseButton()

    chromeContainer.addView(
      closeButton,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.WRAP_CONTENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
        Gravity.TOP or Gravity.END
      ).apply {
        topMargin = dp(48)
        marginEnd = dp(18)
      }
    )

    chromeContainer.addView(
      buildBottomBar(),
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
        Gravity.BOTTOM
      ).apply {
        bottomMargin = dp(32)
      }
    )

    root.addView(
      chromeContainer,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT
      )
    )

    setContentView(root)
  }

  private fun handleProceed() {
    val selection = overlayView.currentSelection()
    if (selection == null) {
      Toast.makeText(this, "请先调整截图框", Toast.LENGTH_SHORT).show()
      return
    }

    if (!ProjectionSessionService.hasActiveSession()) {
      Toast.makeText(this, "共享屏幕已失效，请重新开启悬浮助手", Toast.LENGTH_SHORT).show()
      finish()
      return
    }

    startCaptureFlow(selection)
  }

  private fun startCaptureFlow(selection: android.graphics.Rect) {
    chromeContainer.animate().alpha(0f).setDuration(120).withEndAction {
      chromeContainer.visibility = View.INVISIBLE
      overlayView.visibility = View.INVISIBLE
      mainHandler.postDelayed(
        {
          captureSelection(selection)
        },
        120
      )
    }.start()
  }

  private fun restoreChrome() {
    chromeContainer.visibility = View.VISIBLE
    overlayView.visibility = View.VISIBLE
    chromeContainer.alpha = 1f
  }

  private fun captureSelection(selection: android.graphics.Rect) {
    thread(start = true) {
      val captureFile = ProjectionSessionService.captureSelection(selection)
      runOnUiThread {
        if (captureFile == null) {
          restoreChrome()
          Toast.makeText(this, "截图失败，请重试", Toast.LENGTH_SHORT).show()
          return@runOnUiThread
        }

        openActionScreen(captureFile)
      }
    }
  }

  private fun openActionScreen(captureFile: File) {
    val uri = Uri.fromFile(captureFile)
    FloatingCaptureState.pendingCaptureUri = uri.toString()
    FloatingCaptureState.pendingCaptureName = captureFile.name

    val intent = Intent(
      Intent.ACTION_VIEW,
      Uri.parse("zhimengantifraud://floating-capture/action?captureId=${System.currentTimeMillis()}")
    ).apply {
      setPackage(packageName)
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_CLEAR_TOP or
          Intent.FLAG_ACTIVITY_SINGLE_TOP
      )
    }
    startActivity(intent)
    finish()
  }

  private fun buildCloseButton(): TextView =
    TextView(this).apply {
      text = "关闭悬浮窗"
      setTextColor(Color.WHITE)
      textSize = 13f
      setPadding(dp(14), dp(10), dp(14), dp(10))
      background = GradientDrawable().apply {
        cornerRadius = dp(14).toFloat()
        setColor(Color.parseColor("#CC111111"))
        setStroke(dp(1), Color.parseColor("#33FFFFFF"))
      }
      setOnClickListener {
        stopFloatingBubble()
        finish()
      }
    }

  private fun buildBottomBar(): LinearLayout =
    LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(32), 0, dp(32), 0)

      addView(
        actionLabel("返回") { finish() },
        LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      )
      addView(confirmButton())
      addView(
        actionLabel("旋转") { overlayView.toggleSelectionOrientation() },
        LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      )
    }

  private fun actionLabel(label: String, onClick: () -> Unit): TextView =
    TextView(this).apply {
      text = label
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      textSize = 18f
      setTypeface(typeface, Typeface.BOLD)
      setOnClickListener { onClick() }
    }

  private fun confirmButton(): FrameLayout =
    FrameLayout(this).apply {
      val outerSize = dp(78)
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor("#1B111111"))
        setStroke(dp(2), Color.parseColor("#E6FFFFFF"))
      }
      addView(
        FrameLayout(this@CaptureSelectionActivity).apply {
          background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.parseColor("#5B5BFF"))
          }
          addView(
            TextView(this@CaptureSelectionActivity).apply {
              text = "✓"
              gravity = Gravity.CENTER
              setTextColor(Color.WHITE)
              textSize = 26f
              setTypeface(typeface, Typeface.BOLD)
            },
            FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.MATCH_PARENT,
              FrameLayout.LayoutParams.MATCH_PARENT
            )
          )
        },
        FrameLayout.LayoutParams(dp(62), dp(62), Gravity.CENTER)
      )
      setOnClickListener { handleProceed() }
      layoutParams = LinearLayout.LayoutParams(outerSize, outerSize).apply {
        marginStart = dp(18)
        marginEnd = dp(18)
      }
    }

  private fun stopFloatingBubble() {
    val intent = Intent(this, FloatingBubbleService::class.java).apply {
      action = FloatingBubbleService.ACTION_STOP
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      ContextCompat.startForegroundService(this, intent)
    } else {
      startService(intent)
    }
  }

  private fun dp(value: Int): Int =
    TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      value.toFloat(),
      resources.displayMetrics
    ).toInt()
}
