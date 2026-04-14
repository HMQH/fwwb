package com.anonymous.myapp

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import kotlin.math.max
import kotlin.math.min

class SelectionOverlayView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null
) : View(context, attrs) {

  private val dimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.parseColor("#8A09111F")
    style = Paint.Style.FILL
  }

  private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    style = Paint.Style.STROKE
    strokeWidth = 5f
  }

  private val gridPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.parseColor("#99FFFFFF")
    style = Paint.Style.STROKE
    strokeWidth = 2f
  }

  private var startX = 0f
  private var startY = 0f

  var selectionRect: RectF? = null
    private set

  var onSelectionChanged: ((Rect?) -> Unit)? = null

  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        startX = event.x
        startY = event.y
        selectionRect = RectF(startX, startY, startX, startY)
        notifySelectionChanged()
        invalidate()
        return true
      }

      MotionEvent.ACTION_MOVE,
      MotionEvent.ACTION_UP -> {
        selectionRect = RectF(
          min(startX, event.x),
          min(startY, event.y),
          max(startX, event.x),
          max(startY, event.y)
        )
        notifySelectionChanged()
        invalidate()
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
    canvas.drawRect(rect, strokePaint)

    val thirdWidth = rect.width() / 3f
    val thirdHeight = rect.height() / 3f
    if (thirdWidth > 0f && thirdHeight > 0f) {
      for (index in 1..2) {
        val vx = rect.left + thirdWidth * index
        val hy = rect.top + thirdHeight * index
        canvas.drawLine(vx, rect.top, vx, rect.bottom, gridPaint)
        canvas.drawLine(rect.left, hy, rect.right, hy, gridPaint)
      }
    }
  }

  fun currentSelection(): Rect? {
    val rect = selectionRect ?: return null
    val left = rect.left.toInt().coerceIn(0, width)
    val top = rect.top.toInt().coerceIn(0, height)
    val right = rect.right.toInt().coerceIn(0, width)
    val bottom = rect.bottom.toInt().coerceIn(0, height)
    if (right - left < 24 || bottom - top < 24) {
      return null
    }
    return Rect(left, top, right, bottom)
  }

  private fun notifySelectionChanged() {
    onSelectionChanged?.invoke(currentSelection())
  }
}
