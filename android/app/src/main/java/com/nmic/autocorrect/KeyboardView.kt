package com.nmic.autocorrect

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.View

/** A compact QWERTY keyboard with Danish letters, drawn by hand so it works the same on every Android build. */
class KeyboardView(ctx: Context, private val listener: Listener) : View(ctx) {
    interface Listener {
        fun onText(s: String)
        fun onBackspace()
        fun onEnter()
    }
    private data class Key(val label: String, val code: String, val weight: Float = 1f)
    private val letters = listOf(
        listOf("q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "å").map { Key(it, it) },
        listOf("a", "s", "d", "f", "g", "h", "j", "k", "l", "æ", "ø").map { Key(it, it) },
        listOf(Key("⇧", "SHIFT", 1.5f)) + listOf("z", "x", "c", "v", "b", "n", "m").map { Key(it, it) } + listOf(Key("⌫", "BS", 1.5f)),
        listOf(Key("?123", "SYM", 1.5f), Key(",", ","), Key("space", " ", 4f), Key(".", "."), Key("⏎", "ENTER", 1.5f))
    )
    private val symbols = listOf(
        listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "0").map { Key(it, it) },
        listOf("@", "#", "€", "%", "&", "-", "+", "(", ")", "/").map { Key(it, it) },
        listOf(Key("*", "*"), Key("\"", "\""), Key("'", "'"), Key(":", ":"), Key(";", ";"), Key("!", "!"), Key("?", "?"), Key("_", "_"), Key("⌫", "BS", 1.5f)),
        listOf(Key("abc", "ABC", 1.5f), Key(",", ","), Key("space", " ", 4f), Key(".", "."), Key("⏎", "ENTER", 1.5f))
    )
    private var shift = false
    private var shiftLock = false
    private var sym = false
    private val paintKey = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val paintSpecial = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#DADCE0") }
    private val paintText = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#1F1F1F"); textAlign = Paint.Align.CENTER }
    private val bg = Paint().apply { color = Color.parseColor("#E8EAED") }
    private val rects = ArrayList<Pair<RectF, Key>>()
    private val handler = Handler(Looper.getMainLooper())
    private var repeat: Runnable? = null
    private var lastShiftTap = 0L

    private fun rows() = if (sym) symbols else letters
    private fun dp(v: Float) = v * resources.displayMetrics.density

    override fun onMeasure(w: Int, h: Int) {
        setMeasuredDimension(MeasureSpec.getSize(w), dp(210f).toInt())
    }

    override fun onDraw(c: Canvas) {
        c.drawRect(0f, 0f, width.toFloat(), height.toFloat(), bg)
        rects.clear()
        val rows = rows()
        val rowH = height / rows.size.toFloat()
        val gap = dp(3f)
        paintText.textSize = dp(19f)
        for ((ri, row) in rows.withIndex()) {
            val totalW = row.sumOf { it.weight.toDouble() }.toFloat()
            var x = gap
            val unit = (width - gap * (row.size + 1)) / totalW
            for (k in row) {
                val w = unit * k.weight
                val r = RectF(x, ri * rowH + gap, x + w, (ri + 1) * rowH - gap)
                val special = k.code.length > 1 && k.code != " "
                c.drawRoundRect(r, dp(6f), dp(6f), if (special) paintSpecial else paintKey)
                var label = k.label
                if (!sym && k.code.length == 1 && k.code != " " && k.code != "," && k.code != "." && (shift || shiftLock)) label = label.uppercase()
                if (k.code == "SHIFT" && (shift || shiftLock)) label = if (shiftLock) "⇪" else "⬆"
                c.drawText(label, r.centerX(), r.centerY() + paintText.textSize / 3, paintText)
                rects.add(r to k)
                x += w + gap
            }
        }
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val k = rects.firstOrNull { it.first.contains(e.x, e.y) }?.second ?: return true
                performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP)
                press(k)
                if (k.code == "BS") {
                    repeat = object : Runnable { override fun run() { listener.onBackspace(); handler.postDelayed(this, 60) } }
                    handler.postDelayed(repeat!!, 400)
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { repeat?.let { handler.removeCallbacks(it) }; repeat = null }
        }
        return true
    }

    private fun press(k: Key) {
        when (k.code) {
            "SHIFT" -> {
                val now = System.currentTimeMillis()
                if (now - lastShiftTap < 350) { shiftLock = !shiftLock; shift = false } else { shift = !shift && !shiftLock; if (shiftLock) shiftLock = false }
                lastShiftTap = now
            }
            "SYM" -> sym = true
            "ABC" -> sym = false
            "BS" -> listener.onBackspace()
            "ENTER" -> listener.onEnter()
            else -> {
                val t = if (!sym && (shift || shiftLock) && k.code.length == 1) k.code.uppercase() else k.code
                listener.onText(t)
                if (shift && !shiftLock) shift = false
            }
        }
        invalidate()
    }

    fun autoShift(on: Boolean) { if (!shiftLock) { shift = on; invalidate() } }
}
