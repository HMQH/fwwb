package expo.modules.fraudintervention

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import android.animation.ValueAnimator
import android.graphics.drawable.GradientDrawable
import kotlin.math.abs

object FraudOverlayController {
  private val mainHandler = Handler(Looper.getMainLooper())

  private enum class OverlayMode {
    NONE,
    READY,
    WARNING,
    RECORDING,
    RECORDING_CONFIRM,
    SAVED,
  }

  @Volatile
  private var mode: OverlayMode = OverlayMode.NONE
  private var overlayView: View? = null
  private var overlayWindowManager: WindowManager? = null
  private var overlayLayoutParams: WindowManager.LayoutParams? = null
  private var pulseAnimator: ValueAnimator? = null
  private var transcriptView: TextView? = null
  private var autoDismissRunnable: Runnable? = null
  private var currentCallId: String? = null
  private var currentRiskLevel: String = "low"
  private var currentPhoneNumber: String? = null
  private var currentMessage: String = ""
  private var currentTranscript: String = "录音开始后，这里会显示最新一行转写。"
  private var bubbleOffsetX: Int = -1
  private var bubbleOffsetY: Int = -1

  fun showRiskWarningOverlay(
    context: Context,
    callId: String,
    riskLevel: String,
    phoneNumber: String?,
    message: String,
  ) {
    if (!FraudCallDetectionHelper.canDrawOverlays(context)) {
      return
    }

    currentCallId = callId
    currentRiskLevel = riskLevel
    currentPhoneNumber = phoneNumber
    currentMessage = message
    mode = OverlayMode.WARNING

    mainHandler.post {
      render(context.applicationContext)
    }
  }

  fun showPermissionReadyOverlay(context: Context) {
    if (!FraudCallDetectionHelper.canDrawOverlays(context)) {
      return
    }

    mode = OverlayMode.READY
    mainHandler.post {
      render(context.applicationContext)
      scheduleAutoDismiss(2600L)
    }
  }

  fun showRecordingOverlay(
    context: Context,
    callId: String,
    riskLevel: String,
    phoneNumber: String?,
    confirmStop: Boolean = false,
  ) {
    if (!FraudCallDetectionHelper.canDrawOverlays(context)) {
      return
    }

    currentCallId = callId
    currentRiskLevel = riskLevel
    currentPhoneNumber = phoneNumber
    if (currentTranscript.isBlank()) {
      currentTranscript = "录音开始后，这里会显示最新一行转写。"
    }
    mode = if (confirmStop) OverlayMode.RECORDING_CONFIRM else OverlayMode.RECORDING

    mainHandler.post {
      render(context.applicationContext)
    }
  }

  fun showRecordingSavedOverlay(
    context: Context,
    callId: String?,
    riskLevel: String,
    phoneNumber: String?,
  ) {
    if (!FraudCallDetectionHelper.canDrawOverlays(context)) {
      dismiss()
      return
    }

    currentCallId = callId
    currentRiskLevel = riskLevel
    currentPhoneNumber = phoneNumber
    mode = OverlayMode.SAVED

    mainHandler.post {
      render(context.applicationContext)
    }
  }

  fun updateRecordingTranscript(text: String?) {
    val normalized = text?.trim().orEmpty().ifBlank { "录音进行中，等待新的转写内容…" }
    currentTranscript = normalized
    mainHandler.post {
      transcriptView?.text = normalized
      transcriptView?.isSelected = true
    }
  }

  fun isOverlayVisible(): Boolean = mode != OverlayMode.NONE && overlayView != null

  fun dismiss() {
    mainHandler.post {
      removeOverlay()
      mode = OverlayMode.NONE
    }
  }

  private fun render(context: Context) {
    removeOverlay()

    val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager ?: return
    val params = buildLayoutParams(context)
    val view = when (mode) {
      OverlayMode.READY -> buildReadyOverlay(context)
      OverlayMode.WARNING -> buildWarningOverlay(context)
      OverlayMode.RECORDING -> buildRecordingOverlay(context, confirmStop = false)
      OverlayMode.RECORDING_CONFIRM -> buildRecordingOverlay(context, confirmStop = true)
      OverlayMode.SAVED -> buildSavedOverlay(context)
      OverlayMode.NONE -> null
    } ?: return

    overlayView = view
    overlayWindowManager = windowManager
    overlayLayoutParams = params
    try {
      windowManager.addView(view, params)
    } catch (_: Exception) {
      overlayView = null
      overlayWindowManager = null
      overlayLayoutParams = null
      mode = OverlayMode.NONE
    }
  }

  private fun removeOverlay() {
    autoDismissRunnable?.let { mainHandler.removeCallbacks(it) }
    autoDismissRunnable = null
    pulseAnimator?.cancel()
    pulseAnimator = null
    transcriptView = null

    val view = overlayView ?: return
    val context = view.context
    val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
    try {
      windowManager?.removeView(view)
    } catch (_: Exception) {
    }
    overlayView = null
    overlayWindowManager = null
    overlayLayoutParams = null
  }

  private fun buildLayoutParams(context: Context): WindowManager.LayoutParams {
    val overlayType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      WindowManager.LayoutParams.TYPE_PHONE
    }
    val bubbleMode =
      mode == OverlayMode.READY || mode == OverlayMode.WARNING || mode == OverlayMode.RECORDING || mode == OverlayMode.RECORDING_CONFIRM

    return if (bubbleMode) {
      WindowManager.LayoutParams(
        dp(context, 84),
        dp(context, 84),
        overlayType,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
          WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
      ).apply {
        gravity = Gravity.TOP or Gravity.START
        x = if (bubbleOffsetX >= 0) bubbleOffsetX else dp(context, 18)
        y = if (bubbleOffsetY >= 0) bubbleOffsetY else dp(context, 220)
      }
    } else {
      WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        overlayType,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
          WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
          WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
        PixelFormat.TRANSLUCENT,
      ).apply {
        gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        x = 0
        y = dp(context, 18)
      }
    }
  }

  private fun scheduleAutoDismiss(delayMs: Long) {
    autoDismissRunnable?.let { mainHandler.removeCallbacks(it) }
    autoDismissRunnable = Runnable {
      dismiss()
    }
    mainHandler.postDelayed(autoDismissRunnable!!, delayMs)
  }

  private fun buildReadyOverlay(context: Context): View {
    return createBubbleOverlay(
      context = context,
      fillColor = "#EEF5FF",
      strokeColor = "#2F70E6",
      title = "已开",
      subtitle = "悬浮窗",
      onTap = { dismiss() },
      onLongPress = { dismiss() },
    )
  }

  private fun buildWarningOverlay(context: Context): View {
    return createBubbleOverlay(
      context = context,
      fillColor = when (currentRiskLevel) {
        "high" -> "#FFE8E8"
        "medium" -> "#FFF3E3"
        else -> "#EEF5FF"
      },
      strokeColor = when (currentRiskLevel) {
        "high" -> "#E25B5B"
        "medium" -> "#F39A37"
        else -> "#2F70E6"
      },
      title = "录音",
      subtitle = "先免提",
      onTap = {
        val callId = currentCallId ?: return@createBubbleOverlay
        val riskLevel = currentRiskLevel
        val phoneNumber = currentPhoneNumber
        showRecordingOverlay(context, callId, riskLevel, phoneNumber)
        val intent = Intent(context, FraudRecordingService::class.java).apply {
          action = FraudRecordingService.ACTION_START
          putExtra(FraudRecordingService.EXTRA_CALL_ID, callId)
          putExtra(FraudRecordingService.EXTRA_RISK_LEVEL, riskLevel)
          putExtra(FraudRecordingService.EXTRA_PHONE_NUMBER, phoneNumber)
          putExtra(FraudRecordingService.EXTRA_SHOW_OVERLAY, true)
        }
        ContextCompat.startForegroundService(context, intent)
      },
      onLongPress = { dismiss() },
    )
  }

  private fun buildRecordingOverlay(context: Context, confirmStop: Boolean): View {
    pulseAnimator?.cancel()
    pulseAnimator = null
    transcriptView = null

    return createBubbleOverlay(
      context = context,
      fillColor = if (confirmStop) "#FFF0F0" else "#FFF4E8",
      strokeColor = if (confirmStop) "#D85A5A" else "#F39A37",
      title = if (confirmStop) "结束?" else "录音中",
      subtitle = if (confirmStop) "点按停" else "免提采",
      onTap = {
        if (confirmStop) {
          FraudRecordingService.stopActiveRecording(context)
        } else {
          openApp(context)
        }
      },
      onLongPress = {
        val callId = currentCallId ?: return@createBubbleOverlay
        showRecordingOverlay(
          context,
          callId,
          currentRiskLevel,
          currentPhoneNumber,
          confirmStop = !confirmStop,
        )
      },
    )
  }

  private fun createBubbleOverlay(
    context: Context,
    fillColor: String,
    strokeColor: String,
    title: String,
    subtitle: String,
    onTap: () -> Unit,
    onLongPress: () -> Unit,
  ): View {
    val container = FrameLayout(context).apply {
      layoutParams = FrameLayout.LayoutParams(dp(context, 84), dp(context, 84), Gravity.CENTER)
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor(fillColor))
        setStroke(dp(context, 2), Color.parseColor(strokeColor))
      }
      elevation = dp(context, 12).toFloat()
      clipToOutline = true
    }

    val textWrap = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
        Gravity.CENTER,
      )
      setPadding(dp(context, 8), dp(context, 8), dp(context, 8), dp(context, 8))
    }
    textWrap.addView(
      createText(context, text = title, color = strokeColor, sizeSp = 14f, bold = true).apply {
        gravity = Gravity.CENTER
        textAlignment = View.TEXT_ALIGNMENT_CENTER
      },
    )
    textWrap.addView(space(context, 2))
    textWrap.addView(
      createText(context, text = subtitle, color = "#5E7697", sizeSp = 10f, bold = true).apply {
        gravity = Gravity.CENTER
        textAlignment = View.TEXT_ALIGNMENT_CENTER
      },
    )

    container.addView(textWrap)
    attachBubbleGesture(container, onTap, onLongPress)
    return container
  }

  private fun attachBubbleGesture(view: View, onTap: () -> Unit, onLongPress: () -> Unit) {
    var initialX = 0
    var initialY = 0
    var touchDownX = 0f
    var touchDownY = 0f
    var moved = false
    var longPressTriggered = false

    val longPressRunnable = Runnable {
      longPressTriggered = true
      onLongPress()
    }

    view.setOnTouchListener { _, event ->
      val params = overlayLayoutParams ?: return@setOnTouchListener false
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          initialX = params.x
          initialY = params.y
          touchDownX = event.rawX
          touchDownY = event.rawY
          moved = false
          longPressTriggered = false
          view.postDelayed(longPressRunnable, 520L)
          true
        }

        MotionEvent.ACTION_MOVE -> {
          val dx = (event.rawX - touchDownX).toInt()
          val dy = (event.rawY - touchDownY).toInt()
          if (abs(dx) > 6 || abs(dy) > 6) {
            moved = true
            view.removeCallbacks(longPressRunnable)
          }
          params.x = initialX + dx
          params.y = initialY + dy
          bubbleOffsetX = params.x
          bubbleOffsetY = params.y
          overlayWindowManager?.updateViewLayout(view, params)
          true
        }

        MotionEvent.ACTION_UP -> {
          view.removeCallbacks(longPressRunnable)
          if (!moved && !longPressTriggered) {
            onTap()
          }
          true
        }

        MotionEvent.ACTION_CANCEL -> {
          view.removeCallbacks(longPressRunnable)
          true
        }

        else -> false
      }
    }
  }

  private fun buildSavedOverlay(context: Context): View {
    val container = createCardContainer(context, marginHorizontal = 12, padding = 14)
    container.addView(createText(context, text = "录音已结束", color = "#163A5C", sizeSp = 15f, bold = true))
    container.addView(space(context, 4))
    container.addView(
      createText(
        context,
        text = "已保存本地录音${currentPhoneNumber?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""}，可进入 App 查看回看记录。",
        color = "#617999",
        sizeSp = 13f,
      )
    )
    container.addView(space(context, 10))

    val row = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    row.addView(createActionButton(context, "进入 App", primary = true) { openApp(context) })
    row.addView(createSpacer(context, 8))
    row.addView(createActionButton(context, "关闭", primary = false) { dismiss() })
    container.addView(row)
    return container
  }

  private fun createPulseIndicator(context: Context): View {
    val wrapper = FrameLayout(context).apply {
      layoutParams = LinearLayout.LayoutParams(dp(context, 44), dp(context, 44))
    }

    val halo = View(context).apply {
      layoutParams = FrameLayout.LayoutParams(dp(context, 44), dp(context, 44), Gravity.CENTER)
      background = circleDrawable("#33F39A37")
      scaleX = 0.92f
      scaleY = 0.92f
      alpha = 0.4f
    }

    val core = View(context).apply {
      layoutParams = FrameLayout.LayoutParams(dp(context, 18), dp(context, 18), Gravity.CENTER)
      background = circleDrawable("#F39A37")
    }

    wrapper.addView(halo)
    wrapper.addView(core)

    pulseAnimator = ValueAnimator.ofFloat(0.92f, 1.25f).apply {
      duration = 900L
      repeatCount = ValueAnimator.INFINITE
      repeatMode = ValueAnimator.REVERSE
      interpolator = AccelerateDecelerateInterpolator()
      addUpdateListener { animator ->
        val value = animator.animatedValue as Float
        halo.scaleX = value
        halo.scaleY = value
        halo.alpha = 1.35f - value
      }
      start()
    }

    return wrapper
  }

  private fun openApp(context: Context) {
    try {
      PendingIntentFactory.launchApp(context, currentCallId, currentRiskLevel, currentPhoneNumber).send()
    } catch (_: Exception) {
    }
  }

  private fun createCardContainer(context: Context, marginHorizontal: Int, padding: Int): LinearLayout {
    return LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      layoutParams = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
      )
      setPadding(dp(context, padding), dp(context, padding), dp(context, padding), dp(context, padding))
      background = roundedDrawable(
        fill = "#FDFEFF",
        stroke = "#D4E3F7",
        radius = 24f,
      )
      elevation = dp(context, 10).toFloat()
      minimumHeight = dp(context, 72)
      (layoutParams as? LinearLayout.LayoutParams)?.setMargins(
        dp(context, marginHorizontal),
        0,
        dp(context, marginHorizontal),
        0,
      )
    }
  }

  private fun createActionButton(
    context: Context,
    label: String,
    primary: Boolean,
    danger: Boolean = false,
    onClick: () -> Unit,
  ): TextView {
    val fill = when {
      primary && danger -> "#D85A5A"
      primary -> "#2F70E6"
      else -> "#EFF5FF"
    }
    val textColor = when {
      primary -> "#FFFFFF"
      danger -> "#B04343"
      else -> "#29588B"
    }
    val stroke = if (primary) fill else "#D4E3F7"

    return createText(context, text = label, color = textColor, sizeSp = 12f, bold = true).apply {
      gravity = Gravity.CENTER
      minWidth = dp(context, 78)
      minHeight = dp(context, 38)
      setPadding(dp(context, 14), dp(context, 10), dp(context, 14), dp(context, 10))
      background = roundedDrawable(fill = fill, stroke = stroke, radius = 999f)
      setOnClickListener { onClick() }
    }
  }

  private fun createText(
    context: Context,
    text: String,
    color: String,
    sizeSp: Float,
    bold: Boolean = false,
  ): TextView {
    return TextView(context).apply {
      this.text = text
      setTextColor(Color.parseColor(color))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
      typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
    }
  }

  private fun space(context: Context, heightDp: Int): View {
    return View(context).apply {
      layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(context, heightDp))
    }
  }

  private fun createSpacer(context: Context, widthDp: Int): View {
    return View(context).apply {
      layoutParams = LinearLayout.LayoutParams(dp(context, widthDp), 1)
    }
  }

  private fun roundedDrawable(fill: String, stroke: String, radius: Float): GradientDrawable {
    return GradientDrawable().apply {
      shape = GradientDrawable.RECTANGLE
      cornerRadius = radius
      setColor(Color.parseColor(fill))
      setStroke(2, Color.parseColor(stroke))
    }
  }

  private fun circleDrawable(fill: String): GradientDrawable {
    return GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(Color.parseColor(fill))
    }
  }

  private fun riskTitle(level: String): String {
    return when (level) {
      "high" -> "检测到高风险来电"
      "medium" -> "检测到可疑来电"
      else -> "检测到风险来电"
    }
  }

  private fun riskLabel(level: String): String {
    return when (level) {
      "high" -> "高风险"
      "medium" -> "中风险"
      else -> "低风险"
    }
  }

  private fun dp(context: Context, value: Int): Int {
    return TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      value.toFloat(),
      context.resources.displayMetrics,
    ).toInt()
  }
}
