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
        root.addView(label("1. Enable the keyboard, 2. pick it as the current keyboard, then type anywhere. Corrections appear as chips above the keys; tap a chip to revert it."))
        root.addView(Button(this).apply { text = "Enable keyboard (system settings)"; setOnClickListener { startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)) } })
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
