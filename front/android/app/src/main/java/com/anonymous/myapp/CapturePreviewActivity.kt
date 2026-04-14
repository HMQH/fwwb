package com.anonymous.myapp

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.io.File

class CapturePreviewActivity : AppCompatActivity() {
  companion object {
    const val EXTRA_CAPTURE_URI = "capture_uri"
  }

  private var captureUri: Uri? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.setBackgroundDrawableResource(android.R.color.transparent)
    window.addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS)

    captureUri = intent.data ?: intent.getParcelableExtraCompat(EXTRA_CAPTURE_URI)
    if (captureUri == null) {
      finish()
      return
    }

    val root = FrameLayout(this).apply {
      setBackgroundColor(Color.parseColor("#A61B2431"))
    }

    val content = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(16), dp(46), dp(16), dp(24))
    }

    val topCard = buildCard().apply {
      addView(
        TextView(this@CapturePreviewActivity).apply {
          text = "截图确认"
          setTextColor(Color.WHITE)
          textSize = 20f
        }
      )
      addView(
        TextView(this@CapturePreviewActivity).apply {
          text = "确认保留这张截图后，再带到识图页面。"
          setTextColor(Color.parseColor("#D9E9FF"))
          textSize = 13f
        }
      )
    }

    val previewCard = FrameLayout(this).apply {
      background = GradientDrawable().apply {
        cornerRadius = dp(28).toFloat()
        setColor(Color.parseColor("#E8EEF5"))
        setStroke(dp(1), Color.parseColor("#59FFFFFF"))
      }
      clipToOutline = true
    }

    val preview = ImageView(this).apply {
      adjustViewBounds = true
      scaleType = ImageView.ScaleType.FIT_CENTER
      setBackgroundColor(Color.parseColor("#EEF2F6"))
      setImageURI(captureUri)
    }
    previewCard.addView(
      preview,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT
      )
    )

    val bottomCard = buildCard().apply {
      val actions = LinearLayout(this@CapturePreviewActivity).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER
      }

      actions.addView(actionButton("取消", false) {
        discardCapture()
        finish()
      })
      actions.addView(View(this@CapturePreviewActivity), LinearLayout.LayoutParams(dp(10), 1))
      actions.addView(actionButton("下一步", true) {
        confirmCapture()
      })
      addView(actions)
    }

    content.addView(topCard)
    content.addView(
      previewCard,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        0,
        1f
      ).apply {
        topMargin = dp(12)
        bottomMargin = dp(12)
      }
    )
    content.addView(bottomCard)

    root.addView(
      content,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT
      )
    )

    setContentView(root)
  }

  override fun onBackPressed() {
    discardCapture()
    super.onBackPressed()
  }

  private fun confirmCapture() {
    val uri = captureUri ?: return
    val fileName = File(uri.path ?: "capture.png").name
    FloatingCaptureState.pendingCaptureUri = uri.toString()
    FloatingCaptureState.pendingCaptureName = fileName

    val intent = Intent(
      Intent.ACTION_VIEW,
      Uri.parse("myapp://detect-visual?captured=1")
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

  private fun discardCapture() {
    val uri = captureUri ?: return
    if (FloatingCaptureState.pendingCaptureUri == uri.toString()) {
      FloatingCaptureState.clearPendingCapture()
    }
    uri.path?.let { path ->
      runCatching { File(path).delete() }
    }
  }

  private fun buildCard(): LinearLayout =
    LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(16), dp(16), dp(16), dp(16))
      background = GradientDrawable().apply {
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
      background = GradientDrawable().apply {
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

  @Suppress("DEPRECATION")
  private inline fun <reified T> Intent.getParcelableExtraCompat(key: String): T? =
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
      getParcelableExtra(key, T::class.java)
    } else {
      getParcelableExtra(key) as? T
    }

  private fun dp(value: Int): Int =
    TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      value.toFloat(),
      resources.displayMetrics
    ).toInt()
}
