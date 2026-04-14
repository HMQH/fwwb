package com.anonymous.myapp

import android.content.Intent
import android.graphics.Color
import android.net.Uri
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
import java.io.File
import kotlin.concurrent.thread

class CaptureSelectionActivity : AppCompatActivity() {
  private lateinit var overlayView: SelectionOverlayView
  private lateinit var chromeContainer: LinearLayout
  private lateinit var selectionHint: TextView

  private val mainHandler = Handler(Looper.getMainLooper())

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.setBackgroundDrawableResource(android.R.color.transparent)
    window.addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS)

    val root = FrameLayout(this).apply {
      setBackgroundColor(Color.TRANSPARENT)
    }

    overlayView = SelectionOverlayView(this).apply {
      onSelectionChanged = { rect ->
        selectionHint.text =
          if (rect == null) {
            "拖动框选截图区域"
          } else {
            "已选择 ${rect.width()} x ${rect.height()}"
          }
      }
    }
    root.addView(
      overlayView,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT
      )
    )

    chromeContainer = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.TOP
      setPadding(dp(16), dp(46), dp(16), dp(24))
    }

    val topCard = buildCard().apply {
      addView(
        TextView(this@CaptureSelectionActivity).apply {
          text = "悬浮截图"
          setTextColor(Color.WHITE)
          textSize = 20f
        }
      )
      selectionHint = TextView(this@CaptureSelectionActivity).apply {
        text = "拖动框选截图区域"
        setTextColor(Color.parseColor("#D9E9FF"))
        textSize = 13f
      }
      addView(selectionHint)
    }

    val bottomCard = buildCard().apply {
      val actions = LinearLayout(this@CaptureSelectionActivity).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER
      }

      actions.addView(actionButton("取消", false) { finish() })
      actions.addView(View(this@CaptureSelectionActivity), LinearLayout.LayoutParams(dp(10), 1))
      actions.addView(actionButton("下一步", true) { handleProceed() })
      addView(actions)
    }

    chromeContainer.addView(topCard)
    chromeContainer.addView(
      View(this),
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        0,
        1f
      )
    )
    chromeContainer.addView(bottomCard)

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
      Toast.makeText(this, "请先框选截图区域", Toast.LENGTH_SHORT).show()
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

        openPreview(captureFile)
      }
    }
  }

  private fun openPreview(captureFile: File) {
    val intent = Intent(this, CapturePreviewActivity::class.java).apply {
      data = Uri.fromFile(captureFile)
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_SINGLE_TOP
      )
    }
    startActivity(intent)
    finish()
  }

  private fun buildCard(): LinearLayout =
    LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(16), dp(16), dp(16), dp(16))
      background = android.graphics.drawable.GradientDrawable().apply {
        cornerRadius = dp(24).toFloat()
        setColor(Color.parseColor("#D91A2536"))
        setStroke(dp(1), Color.parseColor("#4DFFFFFF"))
      }
    }

  private fun actionButton(
    label: String,
    primary: Boolean,
    onClick: () -> Unit
  ): TextView =
    TextView(this).apply {
      text = label
      setTextColor(if (primary) Color.WHITE else Color.parseColor("#E4EEFF"))
      gravity = Gravity.CENTER
      setPadding(dp(14), dp(12), dp(14), dp(12))
      textSize = 15f
      background = android.graphics.drawable.GradientDrawable().apply {
        cornerRadius = dp(18).toFloat()
        if (primary) {
          setColor(Color.parseColor("#2F70E6"))
        } else {
          setColor(Color.parseColor("#223A516F"))
          setStroke(dp(1), Color.parseColor("#5E8AB9E3"))
        }
      }
      setOnClickListener { onClick() }
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    }

  private fun dp(value: Int): Int =
    TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      value.toFloat(),
      resources.displayMetrics
    ).toInt()
}
