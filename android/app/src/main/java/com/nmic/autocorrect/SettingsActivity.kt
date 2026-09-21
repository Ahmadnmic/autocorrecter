package com.nmic.autocorrect

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.inputmethod.InputMethodManager
import android.widget.*
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(this)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }
        fun label(t: String) = TextView(this).apply { text = t; textSize = 13f; setPadding(0, pad / 2, 0, 4) }
        root.addView(TextView(this).apply { text = "Inline Autocorrect"; textSize = 22f })
        root.addView(label("Recommended: the spell checker. It works with your normal keyboard. Settings → System → Languages → Spell checker (on some builds: Keyboard → Spell checker) → choose Inline Autocorrect. Typos are underlined red, wrong words in context blue; tap a word to accept the suggestion."))
        root.addView(Button(this).apply { text = "Open spell checker settings"; setOnClickListener {
            try { startActivity(Intent("android.settings.SPELL_CHECKER_SETTINGS")) } catch (e: Exception) { startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)) }
        } })
        root.addView(label("Optional: the keyboard, which corrects automatically while you type (like the desktop app). Enable it, then pick it from the keyboard switcher."))
        root.addView(Button(this).apply { text = "Enable keyboard"; setOnClickListener { startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)) } })
        root.addView(Button(this).apply { text = "Choose keyboard"; setOnClickListener { (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker() } })
        root.addView(Switch(this).apply { text = "Autocorrect on"; isChecked = prefs.enabled; setOnCheckedChangeListener { _, v -> prefs.enabled = v } })
        root.addView(label("Aggressiveness"))
        val aggrValue = TextView(this)
        root.addView(SeekBar(this).apply { max = 100; progress = (prefs.aggressiveness * 100).toInt(); setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(s: SeekBar?, p: Int, u: Boolean) { prefs.aggressiveness = p / 100f; aggrValue.text = "$p" }
            override fun onStartTrackingTouch(s: SeekBar?) {}
            override fun onStopTrackingTouch(s: SeekBar?) {}
        }) })
        aggrValue.text = "${(prefs.aggressiveness * 100).toInt()}"
        root.addView(aggrValue)
        root.addView(label("Language"))
        val langs = listOf("auto" to "Auto (counts your words)", "en" to "English", "da" to "Dansk")
        root.addView(Spinner(this).apply {
            adapter = ArrayAdapter(this@SettingsActivity, android.R.layout.simple_spinner_dropdown_item, langs.map { it.second })
            setSelection(langs.indexOfFirst { it.first == prefs.lang }.coerceAtLeast(0))
            onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onItemSelected(p: AdapterView<*>?, v: android.view.View?, pos: Int, id: Long) { prefs.lang = langs[pos].first }
                override fun onNothingSelected(p: AdapterView<*>?) {}
            }
        })
        root.addView(label("Server"))
        root.addView(EditText(this).apply { setText(prefs.apiBase); setOnFocusChangeListener { _, f -> if (!f) prefs.apiBase = text.toString().trim() } })
        root.addView(label("Text near the cursor is sent to the server for decisions. Passwords, numbers, e-mail and URL fields are never touched. On GrapheneOS, keep the Network permission for this app enabled."))
        root.addView(label("Try it here:"))
        root.addView(EditText(this).apply { hint = "Type: I definately recieved it ,and woyou please look"; minLines = 3 })
        setContentView(ScrollView(this).apply { addView(root) })
    }
}
