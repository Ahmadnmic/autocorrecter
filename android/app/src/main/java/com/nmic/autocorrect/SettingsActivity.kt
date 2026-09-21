package com.nmic.autocorrect

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.inputmethod.InputMethodManager
import android.widget.*
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {
    private val releasesApi = "https://api.github.com/repos/Ahmadnmic/autocorrecter/releases/latest"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(this)
        val api = Api(prefs)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }
        fun label(t: String) = TextView(this).apply { text = t; textSize = 13f; setPadding(0, pad / 2, 0, 4) }
        fun heading(t: String) = TextView(this).apply { text = t; textSize = 12f; isAllCaps = true; alpha = 0.6f; setPadding(0, pad, 0, 2) }
        val version = try { packageManager.getPackageInfo(packageName, 0).versionName ?: "?" } catch (e: Exception) { "?" }
        root.addView(TextView(this).apply { text = "Inline Autocorrect"; textSize = 22f })
        root.addView(label("Version $version"))

        // ---- Update
        root.addView(heading("Update"))
        val updateStatus = TextView(this).apply { textSize = 13f; text = "Checks the latest release on GitHub." }
        val updateBtn = Button(this).apply { text = "Check for updates" }
        val installBtn = Button(this).apply { text = "Download and install"; visibility = android.view.View.GONE }
        var latestUrl: String? = null
        updateBtn.setOnClickListener {
            updateBtn.isEnabled = false
            updateStatus.text = "Checking…"
            Thread {
                val rel = api.getUrl(releasesApi)
                val tag = rel?.optString("tag_name") ?: ""
                val latest = tag.removePrefix("android-v")
                val asset = rel?.optJSONArray("assets")?.let { a -> (0 until a.length()).map { a.getJSONObject(it) }.firstOrNull { it.optString("name").endsWith(".apk") } }
                val url = asset?.optString("browser_download_url")
                runOnUiThread {
                    updateBtn.isEnabled = true
                    when {
                        rel == null -> updateStatus.text = "Could not reach GitHub. Check the Network permission for this app."
                        url == null || latest.isEmpty() -> updateStatus.text = "No release found."
                        newer(latest, version) -> { updateStatus.text = "Version $latest is available (you have $version)."; latestUrl = url; installBtn.visibility = android.view.View.VISIBLE }
                        else -> { updateStatus.text = "You are on the latest version ($version)."; installBtn.visibility = android.view.View.GONE }
                    }
                }
            }.start()
        }
        installBtn.setOnClickListener {
            val url = latestUrl ?: return@setOnClickListener
            try {
                // The system downloader fetches the APK and shows a notification; tapping it opens the installer.
                // Android verifies the signature against the installed app, so only our own builds can replace it.
                val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                val req = DownloadManager.Request(Uri.parse(url)).setTitle("Inline Autocorrect update").setMimeType("application/vnd.android.package-archive")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "inline-autocorrect.apk")
                dm.enqueue(req)
                updateStatus.text = "Downloading… tap the notification when it finishes to install."
            } catch (e: Exception) {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            }
        }
        root.addView(updateStatus); root.addView(updateBtn); root.addView(installBtn)

        // ---- Setup
        root.addView(heading("Setup"))
        root.addView(label("Recommended: the spell checker. It works with your normal keyboard. Settings → System → Languages → Spell checker (on some builds: Keyboard → Spell checker) → choose Inline Autocorrect. Typos are underlined red, wrong words in context blue; tap a word to accept the suggestion."))
        root.addView(Button(this).apply { text = "Open spell checker settings"; setOnClickListener {
            try { startActivity(Intent("android.settings.SPELL_CHECKER_SETTINGS")) } catch (e: Exception) { startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)) }
        } })
        val status = TextView(this).apply { textSize = 13f; setPadding(0, pad / 2, 0, 4) }
        root.addView(label("Optional: the keyboard, which corrects automatically while you type (like the desktop app). Android never hides the stock keyboard; you switch the current one: 1. Enable, 2. Choose, or tap the small keyboard icon at the bottom-right of the screen while typing."))
        root.addView(status)
        fun refreshStatus() {
            val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
            val enabled = imm.enabledInputMethodList.any { it.packageName == packageName }
            val current = Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD) ?: ""
            val isCurrent = current.startsWith("$packageName/")
            status.text = when { isCurrent -> "✓ Inline Autocorrect is the current keyboard."; enabled -> "Enabled, but not selected. Tap “Choose keyboard” and pick Inline Autocorrect."; else -> "Not enabled yet. Tap “Enable keyboard” and switch it on." }
        }
        refreshStatus()
        window.decorView.viewTreeObserver.addOnWindowFocusChangeListener { if (it) refreshStatus() }
        root.addView(Button(this).apply { text = "Enable keyboard"; setOnClickListener { startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)) } })
        root.addView(Button(this).apply { text = "Choose keyboard"; setOnClickListener { (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker() } })

        // ---- Settings
        root.addView(heading("Settings"))
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
        root.addView(label("Tone. As written: only errors are fixed. Any other tone also swaps single words that clash with it."))
        val tones = listOf("as-written" to "As written", "neutral" to "Neutral", "formal" to "Formal", "professional" to "Professional", "casual" to "Casual", "friendly" to "Friendly", "academic" to "Academic", "concise" to "Concise")
        root.addView(Spinner(this).apply {
            adapter = ArrayAdapter(this@SettingsActivity, android.R.layout.simple_spinner_dropdown_item, tones.map { it.second })
            setSelection(tones.indexOfFirst { it.first == prefs.tone }.coerceAtLeast(0))
            onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onItemSelected(p: AdapterView<*>?, v: android.view.View?, pos: Int, id: Long) { prefs.tone = tones[pos].first }
                override fun onNothingSelected(p: AdapterView<*>?) {}
            }
        })
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
        root.addView(label("Server (HTTPS only)"))
        root.addView(EditText(this).apply { setText(prefs.apiBase); setOnFocusChangeListener { _, f -> if (!f) prefs.apiBase = text.toString().trim() } })
        root.addView(label("Text near the cursor is sent to the server for decisions. Passwords, numbers, e-mail, URL and incognito fields are never touched. On GrapheneOS, keep the Network permission for this app enabled."))
        root.addView(label("Try it here:"))
        root.addView(EditText(this).apply { hint = "Type: I definately recieved it ,and woyou please look"; minLines = 3 })
        setContentView(ScrollView(this).apply { addView(root) })
    }

    private fun newer(a: String, b: String): Boolean {
        val pa = a.split(".").map { it.toIntOrNull() ?: 0 }
        val pb = b.split(".").map { it.toIntOrNull() ?: 0 }
        for (i in 0 until 3) { val x = pa.getOrElse(i) { 0 }; val y = pb.getOrElse(i) { 0 }; if (x != y) return x > y }
        return false
    }
}
