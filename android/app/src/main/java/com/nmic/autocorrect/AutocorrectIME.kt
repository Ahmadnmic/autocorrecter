package com.nmic.autocorrect

import android.graphics.Color
import android.inputmethodservice.InputMethodService
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The keyboard service. Types characters, and after each boundary character runs the engine. Password and
 * number fields are left alone. The strip above the keys shows colour-coded chips for each change; tap a chip
 * to revert it.
 */
class AutocorrectIME : InputMethodService(), KeyboardView.Listener, Engine.IO {
    private lateinit var prefs: Prefs
    private lateinit var api: Api
    private lateinit var engine: Engine
    private lateinit var strip: LinearLayout
    private lateinit var keyboard: KeyboardView
    private val main = Handler(Looper.getMainLooper())
    private var secureField = false

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        api = Api(prefs)
        engine = Engine(prefs, api, this)
        engine.refreshLibrary()
    }

    override fun onCreateInputView(): View {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.parseColor("#E8EAED")) }
        strip = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(6), dp(4), dp(6), dp(4)) }
        val scroll = HorizontalScrollView(this).apply { addView(strip); layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(40)); isHorizontalScrollBarEnabled = false }
        keyboard = KeyboardView(this, this)
        keyboard.setLanguageLabel(langLabel())
        root.addView(scroll)
        root.addView(keyboard)
        // Edge-to-edge (Android 15+): the IME window no longer stops above the navigation bar, so the bottom row
        // would sit under it. Pad the root by the navigation-bar inset whenever the system reports one.
        root.setOnApplyWindowInsetsListener { v, insets ->
            val bottom = if (android.os.Build.VERSION.SDK_INT >= 30) insets.getInsets(android.view.WindowInsets.Type.navigationBars()).bottom else insets.systemWindowInsetBottom
            v.setPadding(0, 0, 0, bottom)
            insets
        }
        window?.window?.navigationBarColor = Color.parseColor("#E8EAED")
        renderStrip()
        return root
    }

    override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        val variation = (info?.inputType ?: 0) and InputType.TYPE_MASK_VARIATION
        val cls = (info?.inputType ?: 0) and InputType.TYPE_MASK_CLASS
        val inputType = info?.inputType ?: 0
        val imeOptions = info?.imeOptions ?: 0
        // Never read or send text from credential-like fields: passwords, numbers, e-mail, URLs, person names,
        // phone numbers, fields that ask for no suggestions, and fields flagged "no personalized learning" (incognito).
        secureField = variation == InputType.TYPE_TEXT_VARIATION_PASSWORD || variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
            variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD || variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD || cls == InputType.TYPE_CLASS_NUMBER ||
            cls == InputType.TYPE_CLASS_PHONE || variation == InputType.TYPE_TEXT_VARIATION_PERSON_NAME || variation == InputType.TYPE_TEXT_VARIATION_POSTAL_ADDRESS ||
            variation == InputType.TYPE_TEXT_VARIATION_URI || variation == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS || variation == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS ||
            (inputType and InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS) != 0 || (imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING) != 0
        updateShift()
        if (::strip.isInitialized) renderStrip()
    }

    private fun ic(): InputConnection? = currentInputConnection

    // After the last key: a pass at 0.9 s, and follow-ups at 3 s and 5 s so late resolutions and translations that the
    // first pass started still land while the writer waits. The status dot stays red until everything has settled.
    private val idle = Runnable { engine.onIdle(); renderStrip() }
    private val dotTick = object : Runnable { override fun run() { renderDot(); if (engine.busy()) main.postDelayed(this, 400) } }
    private fun scheduleIdle() {
        main.removeCallbacks(idle)
        for (t in longArrayOf(900, 3000, 5000)) main.postDelayed(idle, t)
        main.removeCallbacks(dotTick); main.post(dotTick)
    }
    override fun onText(s: String) {
        val c = ic() ?: return
        c.commitText(s, 1)
        scheduleIdle()
        if (!secureField && prefs.enabled) {
            // Local grammar pass on every character (spacing, punctuation, capitals), then the word passes at a boundary,
            // synchronously and on a snapshot: the finished word is the one before this boundary, whatever comes next.
            engine.onChar()
            if (s.length == 1 && !TextUtil.isWordChar(s[0])) engine.onBoundary(c.getTextBeforeCursor(500, 0)?.toString())
        }
        updateShift()
    }

    override fun onBackspace() {
        val c = ic() ?: return
        scheduleIdle()
        val sel = c.getSelectedText(0)
        if (!sel.isNullOrEmpty()) c.commitText("", 1) else c.deleteSurroundingText(1, 0)
        updateShift()
    }

    override fun onEnter() {
        val c = ic() ?: return
        val action = currentInputEditorInfo?.imeOptions?.and(EditorInfo.IME_MASK_ACTION) ?: EditorInfo.IME_ACTION_NONE
        if (action != EditorInfo.IME_ACTION_NONE && action != EditorInfo.IME_ACTION_UNSPECIFIED && (currentInputEditorInfo?.imeOptions?.and(EditorInfo.IME_FLAG_NO_ENTER_ACTION) ?: 0) == 0) c.performEditorAction(action)
        else c.commitText("\n", 1)
        updateShift()
    }

    /** Capitalise automatically at sentence starts, like the web app's grammar pass. */
    private fun updateShift() {
        val before = ic()?.getTextBeforeCursor(3, 0)?.toString() ?: ""
        val start = before.isEmpty() || Regex("[.!?]\\s+$").containsMatchIn(before) || before.endsWith("\n")
        if (::keyboard.isInitialized) keyboard.autoShift(start && !secureField)
    }

    // ---- Engine.IO
    override fun textBeforeCursor(n: Int) = ic()?.getTextBeforeCursor(n, 0)?.toString() ?: ""
    override fun textAfterCursor(n: Int) = ic()?.getTextAfterCursor(n, 0)?.toString() ?: ""
    override fun replaceBeforeCursor(startBack: Int, len: Int, to: String): Boolean {
        val c = ic() ?: return false
        val wide = c.getTextBeforeCursor(startBack + 8, 0)?.toString() ?: return false
        if (wide.length < startBack) return false
        val pre = wide.dropLast(startBack) // untouched text just before the edit, so a deletion can be verified too
        val before = wide.takeLast(startBack)
        val old = before.substring(0, len)
        val tail = before.substring(len)
        val expected = pre + to + tail
        // Preferred: select exactly the old range and commit the replacement over it, then put the cursor back where
        // it was (shifted by the length difference). Nothing after the word is retyped.
        val et = try { c.getExtractedText(android.view.inputmethod.ExtractedTextRequest(), 0) } catch (e: Exception) { null }
        var method = "none"
        if (et != null && et.selectionStart >= 0 && et.selectionStart == et.selectionEnd) {
            val caret = et.startOffset + et.selectionStart
            val s = caret - startBack
            if (s >= 0) {
                method = "select"
                c.beginBatchEdit()
                c.setSelection(s, s + len)
                c.commitText(to, 1)
                val newCaret = caret + to.length - len
                c.setSelection(newCaret, newCaret)
                c.endBatchEdit()
            }
        }
        // Verify by reading the text back. Editors differ in how they honour selection edits (some ignore the
        // selection, some apply it late); whatever happened, end with exactly the expected text before the cursor.
        var after = c.getTextBeforeCursor(expected.length + old.length + 4, 0)?.toString() ?: return method == "select"
        if (after.endsWith(expected)) return true
        val repair: String
        when {
            method != "select" || after.endsWith(pre + old + tail) -> { // nothing changed: delete up to the cursor and recommit
                repair = "delete+commit"
                c.beginBatchEdit(); c.deleteSurroundingText(startBack, 0); c.commitText(to + tail, 1); c.endBatchEdit()
            }
            after.endsWith(pre + old + to + tail) || after.endsWith(pre + to + old + tail) -> { // inserted without deleting
                repair = "dedupe"
                c.beginBatchEdit(); c.deleteSurroundingText(old.length + to.length + tail.length, 0); c.commitText(to + tail, 1); c.endBatchEdit()
            }
            after.endsWith(pre + tail) -> { // deleted without inserting
                repair = "reinsert"
                c.beginBatchEdit(); c.deleteSurroundingText(tail.length, 0); c.commitText(to + tail, 1); c.endBatchEdit()
            }
            else -> { engine.diag("replace mismatch: expected …${expected.takeLast(20)} got …${after.takeLast(24)}"); return false }
        }
        after = c.getTextBeforeCursor(expected.length + 2, 0)?.toString() ?: ""
        engine.diag("replace repaired ($repair) ok=${after.endsWith(expected)} for \"$old\" -> \"$to\"")
        return after.endsWith(expected)
    }
    override fun onLongSpace() {
        // Hold the space bar to switch the correction language: Auto -> English -> Dansk -> Auto.
        prefs.lang = when (prefs.lang) { "auto" -> "en"; "en" -> "da"; else -> "auto" }
        keyboard.setLanguageLabel(langLabel())
        android.widget.Toast.makeText(this, "Language: " + when (prefs.lang) { "en" -> "English"; "da" -> "Dansk"; else -> "Auto" }, android.widget.Toast.LENGTH_SHORT).show()
    }
    private fun langLabel() = when (prefs.lang) { "en" -> "English"; "da" -> "Dansk"; else -> "Auto" }
    override fun onChange(change: Engine.Change) = renderStrip()

    private var dot: View? = null
    /** Small status dot at the start of the strip: red while corrections are still being decided, green when settled. */
    private fun renderDot() {
        val d = dot ?: return
        val busy = engine.busy()
        d.background = android.graphics.drawable.GradientDrawable().apply { shape = android.graphics.drawable.GradientDrawable.OVAL; setColor(Color.parseColor(if (busy) "#D93025" else "#1E8E3E")) }
        d.contentDescription = if (busy) "Still checking" else "All checked"
    }
    private fun renderStrip() {
        strip.removeAllViews()
        if (!prefs.enabled) { strip.addView(chip("Autocorrect off · open the app to turn it on", "#9AA0A6", null)); return }
        if (secureField) { strip.addView(chip("Password or number field: autocorrect paused", "#9AA0A6", null)); return }
        dot = View(this).apply { layoutParams = LinearLayout.LayoutParams(dp(12), dp(12)).apply { marginEnd = dp(8); marginStart = dp(2) } }
        strip.addView(dot)
        renderDot()
        val recent = engine.changes.take(6)
        if (recent.isEmpty()) { strip.addView(chip("Inline Autocorrect", "#5F6368", null)); return }
        for (ch in recent) {
            val colour = when (ch.kind) { "typo" -> "#5F6368"; "recheck" -> "#B06000"; "translate" -> "#8E24AA"; "resolved" -> "#1A73E8"; "context" -> "#1A73E8"; "tone" -> "#00897B"; "grammar" -> "#E8710A"; "rewrite" -> "#7B1FA2"; else -> "#1A73E8" }
            strip.addView(chip((if (ch.reverted) "↩ " else "") + "${ch.old} → ${ch.to}", if (ch.reverted) "#9AA0A6" else colour, if (ch.reverted) null else ch))
        }
    }

    private fun chip(text: String, colour: String, change: Engine.Change?): View = TextView(this).apply {
        this.text = text
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        setPadding(dp(10), dp(5), dp(10), dp(5))
        background = android.graphics.drawable.GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(Color.parseColor(colour)) }
        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT); lp.marginEnd = dp(6); layoutParams = lp
        if (change != null) setOnClickListener { if (engine.revert(change)) renderStrip() else { engine.diag("revert failed for \"${change.to}\""); android.widget.Toast.makeText(this@AutocorrectIME, "Can't undo: the text has changed", android.widget.Toast.LENGTH_SHORT).show() } }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
