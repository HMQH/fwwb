package com.zhimeng.antifraud

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View

class SelectionOverlayView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null
) : View(context, attrs) {

  private enum class DragMode {
    NONE,
    MOVE,
    TOP_LEFT,
    TOP_RIGHT,
    BOTTOM_LEFT,
    BOTTOM_RIGHT,
  }

  private val dimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.parseColor("#B0000000")
    style = Paint.Style.FILL
  }

  private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.parseColor("#AAFFFFFF")
    style = Paint.Style.STROKE
    strokeWidth = dp(1).toFloat()
  }

  private val handlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    style = Paint.Style.STROKE
    strokeWidth = dp(4).toFloat()
    strokeCap = Paint.Cap.ROUND
  }

  private val minSelectionSize = dp(120).toFloat()
  private val handleTouchRadius = dp(26).toFloat()
  private val handleLength = dp(18).toFloat()

  private var dragMode = DragMode.NONE
  private var lastX = 0f
  private var lastY = 0f
  private var defaultLandscape = true

  var selectionRect: RectF? = null
    private set

  var onSelectionChanged: ((Rect?) -> Unit)? = null

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (w <= 0 || h <= 0) {
      return
    }
    selectionRect = buildDefaultSelection(defaultLandscape)
    notifySelectionChanged()
    invalidate()
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    val rect = selectionRect ?: return false
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        dragMode = resolveDragMode(event.x, event.y, rect)
        if (dragMode == DragMode.NONE) {
          return false
        }
        lastX = event.x
        lastY = event.y
        parent?.requestDisallowInterceptTouchEvent(true)
        return true
      }

      MotionEvent.ACTION_MOVE -> {
        if (dragMode == DragMode.NONE) {
          return false
        }
        updateRect(rect, event.x - lastX, event.y - lastY)
        lastX = event.x
        lastY = event.y
        notifySelectionChanged()
        invalidate()
        return true
      }

      MotionEvent.ACTION_UP,
      MotionEvent.ACTION_CANCEL -> {
        dragMode = DragMode.NONE
        parent?.requestDisallowInterceptTouchEvent(false)
        return true
      }
    }
    return super.onTouchEvent(event)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val rect = selectionRect
    if (rect == null) {
      canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), dimPaint)
      return
    }

    canvas.drawRect(0f, 0f, width.toFloat(), rect.top, dimPaint)
    canvas.drawRect(0f, rect.top, rect.left, rect.bottom, dimPaint)
    canvas.drawRect(rect.right, rect.top, width.toFloat(), rect.bottom, dimPaint)
    canvas.drawRect(0f, rect.bottom, width.toFloat(), height.toFloat(), dimPaint)
    canvas.drawRect(rect, borderPaint)

    drawCornerHandles(canvas, rect)
  }

  fun toggleSelectionOrientation() {
    defaultLandscape = !defaultLandscape
    selectionRect = buildDefaultSelection(defaultLandscape)
    notifySelectionChanged()
    invalidate()
  }

  fun currentSelection(): Rect? {
    val rect = selectionRect ?: return null
    val left = rect.left.toInt().coerceIn(0, width)
    val top = rect.top.toInt().coerceIn(0, height)
    val right = rect.right.toInt().coerceIn(0, width)
    val bottom = rect.bottom.toInt().coerceIn(0, height)
    if (right - left < minSelectionSize.toInt() || bottom - top < minSelectionSize.toInt()) {
      return null
    }
    return Rect(left, top, right, bottom)
  }

  private fun buildDefaultSelection(landscape: Boolean): RectF {
    val centerX = width / 2f
    val centerY = height * 0.43f

    val frameWidth = if (landscape) width * 0.74f else width * 0.58f
    val frameHeight = if (landscape) height * 0.22f else height * 0.42f

    val halfWidth = frameWidth / 2f
    val halfHeight = frameHeight / 2f
    return RectF(
      (centerX - halfWidth).coerceAtLeast(0f),
      (centerY - halfHeight).coerceAtLeast(0f),
      (centerX + halfWidth).coerceAtMost(width.toFloat()),
      (centerY + halfHeight).coerceAtMost(height.toFloat())
    )
  }

  private fun resolveDragMode(x: Float, y: Float, rect: RectF): DragMode {
    if (nearCorner(x, y, rect.left, rect.top)) return DragMode.TOP_LEFT
    if (nearCorner(x, y, rect.right, rect.top)) return DragMode.TOP_RIGHT
    if (nearCorner(x, y, rect.left, rect.bottom)) return DragMode.BOTTOM_LEFT
    if (nearCorner(x, y, rect.right, rect.bottom)) return DragMode.BOTTOM_RIGHT
    if (rect.contains(x, y)) return DragMode.MOVE
    return DragMode.NONE
  }

  private fun nearCorner(x: Float, y: Float, cx: Float, cy: Float): Boolean {
    return kotlin.math.abs(x - cx) <= handleTouchRadius && kotlin.math.abs(y - cy) <= handleTouchRadius
  }

  private fun updateRect(rect: RectF, dx: Float, dy: Float) {
    when (dragMode) {
      DragMode.MOVE -> moveRect(rect, dx, dy)
      DragMode.TOP_LEFT -> {
        rect.left = (rect.left + dx).coerceIn(0f, rect.right - minSelectionSize)
        rect.top = (rect.top + dy).coerceIn(0f, rect.bottom - minSelectionSize)
      }
      DragMode.TOP_RIGHT -> {
        rect.right = (rect.right + dx).coerceIn(rect.left + minSelectionSize, width.toFloat())
        rect.top = (rect.top + dy).coerceIn(0f, rect.bottom - minSelectionSize)
      }
      DragMode.BOTTOM_LEFT -> {
        rect.left = (rect.left + dx).coerceIn(0f, rect.right - minSelectionSize)
        rect.bottom = (rect.bottom + dy).coerceIn(rect.top + minSelectionSize, height.toFloat())
      }
      DragMode.BOTTOM_RIGHT -> {
        rect.right = (rect.right + dx).coerceIn(rect.left + minSelectionSize, width.toFloat())
        rect.bottom = (rect.bottom + dy).coerceIn(rect.top + minSelectionSize, height.toFloat())
      }
      DragMode.NONE -> Unit
    }
  }

  private fun moveRect(rect: RectF, dx: Float, dy: Float) {
    val rectWidth = rect.width()
    val rectHeight = rect.height()
    val newLeft = (rect.left + dx).coerceIn(0f, width.toFloat() - rectWidth)
    val newTop = (rect.top + dy).coerceIn(0f, height.toFloat() - rectHeight)
    rect.set(newLeft, newTop, newLeft + rectWidth, newTop + rectHeight)
  }

  private fun drawCornerHandles(canvas: Canvas, rect: RectF) {
    drawHandle(canvas, rect.left, rect.top, true, true)
    drawHandle(canvas, rect.right, rect.top, false, true)
    drawHandle(canvas, rect.left, rect.bottom, true, false)
    drawHandle(canvas, rect.right, rect.bottom, false, false)
  }

  private fun drawHandle(
    canvas: Canvas,
    x: Float,
    y: Float,
    left: Boolean,
    top: Boolean
  ) {
    val horizontalStart = if (left) x else x - handleLength
    val horizontalEnd = if (left) x + handleLength else x
    val verticalStart = if (top) y else y - handleLength
    val verticalEnd = if (top) y + handleLength else y

    canvas.drawLine(horizontalStart, y, horizontalEnd, y, handlePaint)
    canvas.drawLine(x, verticalStart, x, verticalEnd, handlePaint)
  }

  private fun notifySelectionChanged() {
    onSelectionChanged?.invoke(currentSelection())
  }

  private fun dp(value: Int): Int =
    (value * resources.displayMetrics.density).toInt()
}
