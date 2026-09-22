package com.nmic.autocorrect

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.MotionEvent
import android.view.View

/**
 * A QWERTY keyboard with Danish letters, drawn by hand so it looks and behaves the same on every Android build.
 * Geometry follows the stock (AOSP/GrapheneOS) keyboard. Each press: the key darkens and sinks, a preview bubble
 * shows the character above the finger, and a short haptic tick fires. Letters commit on release (so a slip can be
 * corrected by sliding), Backspace commits on press and repeats while held, Shift double-tap locks caps.
 */
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
        listOf(Key("?123", "SYM", 1.5f), Key(",", ","), Key("", " ", 4f), Key(".", "."), Key("⏎", "ENTER", 1.5f))
    )
    private val symbols = listOf(
        listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "0").map { Key(it, it) },
        listOf("@", "#", "€", "%", "&", "-", "+", "(", ")", "/").map { Key(it, it) },
        listOf(Key("*", "*"), Key("\"", "\""), Key("'", "'"), Key(":", ":"), Key(";", ";"), Key("!", "!"), Key("?", "?"), Key("_", "_"), Key("⌫", "BS", 1.5f)),
        listOf(Key("abc", "ABC", 1.5f), Key(",", ","), Key("", " ", 4f), Key(".", "."), Key("⏎", "ENTER", 1.5f))
    )
    private var shift = false
    private var shiftLock = false
    private var sym = false
    private val paintKey = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val paintKeyPressed = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#C9CCD1") }
    private val paintSpecial = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#D6D9DE") }
    private val paintSpecialPressed = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#B8BCC2") }
    private val paintAccent = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#1A73E8") }
    private val paintShadow = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#33000000") }
    private val paintText = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#1F1F1F"); textAlign = Paint.Align.CENTER; typeface = Typeface.create("sans-serif", Typeface.NORMAL) }
    private val paintTextWhite = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textAlign = Paint.Align.CENTER }
    private val paintHint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#80505050"); textAlign = Paint.Align.CENTER }
    private val paintPreview = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#F2FFFFFF") }
    private val paintPreviewShadow = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#40000000") }
    private val bg = Paint().apply { color = Color.parseColor("#E8EAED") }
    private val rects = ArrayList<Pair<RectF, Key>>()
    private val handler = Handler(Looper.getMainLooper())
    private var repeat: Runnable? = null
    private var lastShiftTap = 0L
    private var pressed: Key? = null
    private var pressedRect: RectF? = null
    private var pressedIsRepeating = false
    private val vibrator: Vibrator? = try {
        if (Build.VERSION.SDK_INT >= 31) (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        else @Suppress("DEPRECATION") ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    } catch (e: Exception) { null }

    private fun rows() = if (sym) symbols else letters
    private fun dp(v: Float) = v * resources.displayMetrics.density

    /**
     * Same geometry as the stock (AOSP/GrapheneOS) keyboard: the key area is 205.6dp, but never less than 61.8% of
     * the screen width and never more than 46% of the screen height (portrait); 176dp / 45% of the height in landscape.
     */
    fun keyboardHeightPx(): Int {
        val dm = resources.displayMetrics
        val landscape = dm.widthPixels > dm.heightPixels
        val default = if (landscape) dp(176f) else dp(205.6f)
        val max = dm.heightPixels * 0.46f
        val min = if (landscape) dm.heightPixels * 0.45f else dm.widthPixels * 0.618f
        return kotlin.math.max(kotlin.math.min(default, max), min).toInt()
    }

    override fun onMeasure(w: Int, h: Int) {
        setMeasuredDimension(MeasureSpec.getSize(w), keyboardHeightPx())
    }

    private fun labelFor(k: Key): String {
        var label = k.label
        if (!sym && k.code.length == 1 && k.code != " " && k.code != "," && k.code != "." && (shift || shiftLock)) label = label.uppercase()
        if (k.code == "SHIFT" && (shift || shiftLock)) label = if (shiftLock) "⇪" else "⬆"
        return label
    }

    override fun onDraw(c: Canvas) {
        c.drawRect(0f, 0f, width.toFloat(), height.toFloat(), bg)
        rects.clear()
        val rows = rows()
        val rowH = height / rows.size.toFloat()
        // Stock keyboard gaps: 6.127% of the keyboard height vertically, 1.917% of the width horizontally.
        val vGap = height * 0.05f / 2f
        val gap = width * 0.014f / 2f
        val radius = dp(6f)
        paintText.textSize = dp(21f)
        paintTextWhite.textSize = dp(21f)
        paintHint.textSize = dp(11f)
        for ((ri, row) in rows.withIndex()) {
            val totalW = row.sumOf { it.weight.toDouble() }.toFloat()
            var x = gap
            val unit = (width - gap * (row.size + 1)) / totalW
            for (k in row) {
                val w = unit * k.weight
                val r = RectF(x, ri * rowH + vGap, x + w, (ri + 1) * rowH - vGap)
                val special = k.code.length > 1 && k.code != " "
                val isPressed = pressed === k
                val enterAccent = k.code == "ENTER"
                // Shadow below the key gives it the stock "raised" look; a pressed key sinks (no shadow, darker).
                if (!isPressed) c.drawRoundRect(RectF(r.left, r.top + dp(1f), r.right, r.bottom + dp(1.5f)), radius, radius, paintShadow)
                val fill = when {
                    enterAccent -> paintAccent
                    special && isPressed -> paintSpecialPressed
                    special -> paintSpecial
                    isPressed -> paintKeyPressed
                    else -> paintKey
                }
                c.drawRoundRect(r, radius, radius, fill)
                val label = labelFor(k)
                val tp = if (enterAccent) paintTextWhite else paintText
                if (k.code == " ") c.drawText("Inline Autocorrect", r.centerX(), r.centerY() + paintHint.textSize / 3, paintHint)
                else c.drawText(label, r.centerX(), r.centerY() + tp.textSize / 3, tp)
                // Number hints on the top letter row, like the stock keyboard.
                if (!sym && ri == 0 && k.code.length == 1) {
                    val idx = "qwertyuiop".indexOf(k.code)
                    if (idx >= 0) c.drawText(((idx + 1) % 10).toString(), r.right - dp(7f), r.top + dp(11f), paintHint)
                }
                rects.add(r to k)
                x += w + gap
            }
        }
        // Preview bubble above the pressed character key.
        val pr = pressedRect
        val pk = pressed
        if (pr != null && pk != null && pk.code.length == 1 && pk.code != " ") {
            val bw = kotlin.math.max(pr.width() * 1.25f, dp(44f))
            val bh = rowH * 1.05f
            val left = (pr.centerX() - bw / 2).coerceIn(dp(2f), width - bw - dp(2f))
            val top = pr.top - bh - dp(4f)
            val bubble = RectF(left, top, left + bw, top + bh)
            c.drawRoundRect(RectF(bubble.left, bubble.top + dp(2f), bubble.right, bubble.bottom + dp(3f)), dp(8f), dp(8f), paintPreviewShadow)
            c.drawRoundRect(bubble, dp(8f), dp(8f), paintPreview)
            val big = Paint(paintText).apply { textSize = dp(30f) }
            c.drawText(labelFor(pk), bubble.centerX(), bubble.centerY() + big.textSize / 3, big)
        }
    }

    /**
     * Hit test like the stock keyboard: every point on the keyboard belongs to the nearest key (the gaps between keys
     * are not dead), and the touch is read a little above where the finger lands, because fingertips press below the
     * spot the eye aims at.
     */
    private fun keyAt(x: Float, y0: Float): Pair<RectF, Key>? {
        val y = (y0 - dp(5f)).coerceAtLeast(0f)
        var best: Pair<RectF, Key>? = null
        var bestD = Float.MAX_VALUE
        for (e in rects) {
            val r = e.first
            val dx = when { x < r.left -> r.left - x; x > r.right -> x - r.right; else -> 0f }
            val dy = when { y < r.top -> r.top - y; y > r.bottom -> y - r.bottom; else -> 0f }
            val d = dx * dx + dy * dy
            if (d < bestD) { bestD = d; best = e }
        }
        return best
    }

    private fun haptic() {
        try {
            val v = vibrator
            if (v != null && v.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= 29) v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK))
                else @Suppress("DEPRECATION") v.vibrate(12)
            } else performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP)
        } catch (e: Exception) {
            performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP)
        }
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val hit = keyAt(e.x, e.y) ?: return true
                pressed = hit.second; pressedRect = hit.first; pressedIsRepeating = false
                haptic()
                if (hit.second.code == "BS") {
                    listener.onBackspace()
                    pressedIsRepeating = true
                    repeat = object : Runnable { override fun run() { listener.onBackspace(); haptic(); handler.postDelayed(this, 50) } }
                    handler.postDelayed(repeat!!, 350)
                }
                invalidate()
            }
            MotionEvent.ACTION_MOVE -> {
                // Sliding onto another key moves the highlight and the preview, so a slip can be corrected before release.
                val hit = keyAt(e.x, e.y)
                if (!pressedIsRepeating && hit != null && hit.second !== pressed) { pressed = hit.second; pressedRect = hit.first; invalidate() }
            }
            MotionEvent.ACTION_UP -> {
                repeat?.let { handler.removeCallbacks(it) }; repeat = null
                val k = pressed
                if (k != null && k.code != "BS") press(k)
                pressed = null; pressedRect = null
                invalidate()
            }
            MotionEvent.ACTION_CANCEL -> {
                repeat?.let { handler.removeCallbacks(it) }; repeat = null
                pressed = null; pressedRect = null
                invalidate()
            }
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
