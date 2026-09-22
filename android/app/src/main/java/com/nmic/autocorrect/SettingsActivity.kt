package com.nmic.autocorrect

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import com.google.android.material.button.MaterialButton
import com.google.android.material.button.MaterialButtonToggleGroup
import com.google.android.material.card.MaterialCardView
import com.google.android.material.materialswitch.MaterialSwitch
import com.google.android.material.progressindicator.LinearProgressIndicator
import com.google.android.material.slider.Slider
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import java.io.File

/** The app's one screen: status, update, setup, settings and a place to try the keyboard. Material 3, built in code. */
class SettingsActivity : AppCompatActivity() {
    private val releasesApi = "https://api.github.com/repos/Ahmadnmic/autocorrecter/releases/latest"
    private val main = Handler(Looper.getMainLooper())

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(this)
        val api = Api(prefs)
        val version = try { packageManager.getPackageInfo(packageName, 0).versionName ?: "?" } catch (e: Exception) { "?" }

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(24), dp(16), dp(32)) }
        fun title(t: String) = TextView(this).apply { text = t; textSize = 28f; setTextColor(color(com.google.android.material.R.attr.colorOnSurface)); setPadding(dp(4), 0, 0, dp(2)) }
        fun body(t: String, dim: Boolean = true) = TextView(this).apply { text = t; textSize = 14f; setTextColor(color(if (dim) com.google.android.material.R.attr.colorOnSurfaceVariant else com.google.android.material.R.attr.colorOnSurface)); setLineSpacing(0f, 1.15f) }
        fun heading(t: String) = TextView(this).apply { text = t; textSize = 16f; setTypeface(typeface, android.graphics.Typeface.BOLD); setTextColor(color(com.google.android.material.R.attr.colorOnSurface)); setPadding(0, 0, 0, dp(6)) }
        fun card(vararg views: View): MaterialCardView = MaterialCardView(this).apply {
            radius = dp(20).toFloat(); strokeWidth = 0; cardElevation = 0f
            setCardBackgroundColor(color(com.google.android.material.R.attr.colorSurfaceContainer))
            val inner = LinearLayout(this@SettingsActivity).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(16), dp(18), dp(16)) }
            views.forEach { v -> inner.addView(v, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = if (inner.childCount == 0) 0 else dp(8) }) }
            addView(inner)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(12) }
        }
        fun button(t: String, tonal: Boolean = false, onClick: () -> Unit) = MaterialButton(this, null, if (tonal) com.google.android.material.R.attr.materialButtonOutlinedStyle else com.google.android.material.R.attr.materialButtonStyle).apply { text = t; cornerRadius = dp(20); setOnClickListener { onClick() } }
        fun row(vararg views: View) = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; views.forEach { v -> addView(v, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(8) }) } }

        root.addView(title("Inline Autocorrect"))
        val helpBtn = button("Help", tonal = true) { showWelcome(prefs) }
        root.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(4), 0, 0, dp(12))
            addView(body("Version $version"), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(helpBtn)
        })

        // ---- Status + keyboard switch
        val status = body("", dim = false)
        val enableBtn = button("Enable keyboard", tonal = true) { startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)) }
        val chooseBtn = button("Choose keyboard") { (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker() }
        fun refreshStatus() {
            val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
            val enabled = imm.enabledInputMethodList.any { it.packageName == packageName }
            val current = Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD) ?: ""
            val isCurrent = current.startsWith("$packageName/")
            status.text = when { isCurrent -> "✓ Inline Autocorrect is your keyboard. Corrections happen while you type."; enabled -> "Enabled, but another keyboard is selected."; else -> "Not enabled yet. Turn it on in the system keyboard list, then choose it." }
            enableBtn.visibility = if (enabled) View.GONE else View.VISIBLE
            chooseBtn.visibility = if (isCurrent) View.GONE else View.VISIBLE
        }
        refreshStatus()
        window.decorView.viewTreeObserver.addOnWindowFocusChangeListener { if (it) refreshStatus() }
        val onSwitch = MaterialSwitch(this).apply { text = "Autocorrect on"; textSize = 16f; isChecked = prefs.enabled; setOnCheckedChangeListener { _, v -> prefs.enabled = v } }
        root.addView(card(heading("Keyboard"), status, row(enableBtn, chooseBtn), onSwitch))

        // ---- Update
        val updateStatus = body("Updates are published on GitHub. Checking is manual, nothing runs in the background.")
        val progress = LinearProgressIndicator(this).apply { visibility = View.GONE; isIndeterminate = false; max = 100; trackCornerRadius = dp(4) }
        var latestUrl: String? = null
        var latestVersion = ""
        val updateBtn = button("Check for updates", tonal = true) {}
        val apkFile = File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "inline-autocorrect.apk")
        fun install() {
            try {
                val uri = FileProvider.getUriForFile(this, "$packageName.files", apkFile)
                startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (e: Exception) { updateStatus.text = "Could not open the installer: ${e.message}" }
        }
        fun showInstall() {
            progress.visibility = View.GONE
            updateStatus.text = "Version $latestVersion downloaded. Android will ask you to confirm the install; your settings are kept."
            updateBtn.text = "Install $latestVersion"
            updateBtn.setOnClickListener { install() }
        }
        // The APK is fetched by the app itself: the system download manager is unreliable on GrapheneOS (a queued
        // download can sit in "pending" forever) and gives no error to show. This is a plain HTTPS GET with progress.
        var downloading = false
        fun download() {
            val url = latestUrl ?: return
            if (downloading) return
            downloading = true
            updateBtn.text = "Downloading…"; updateBtn.isEnabled = false
            progress.visibility = View.VISIBLE; progress.isIndeterminate = true
            Thread {
                var err: String? = null
                try {
                    if (apkFile.exists()) apkFile.delete()
                    val tmp = File(apkFile.parentFile, "update.part")
                    if (tmp.exists()) tmp.delete()
                    var link = url
                    var conn: java.net.HttpURLConnection? = null
                    // GitHub redirects release assets to a storage host; follow those redirects ourselves (HTTPS only).
                    for (hop in 0 until 5) {
                        val c = java.net.URL(link).openConnection() as java.net.HttpURLConnection
                        c.connectTimeout = 15000; c.readTimeout = 30000; c.instanceFollowRedirects = false
                        c.setRequestProperty("accept", "application/octet-stream")
                        val code = c.responseCode
                        if (code in 301..308) {
                            val loc = c.getHeaderField("location") ?: break
                            c.disconnect()
                            if (!loc.startsWith("https://")) { err = "Insecure redirect"; break }
                            link = loc
                            continue
                        }
                        if (code != 200) { err = "Server said $code"; c.disconnect(); break }
                        conn = c
                        break
                    }
                    if (err == null && conn == null) err = "Too many redirects"
                    if (conn != null) {
                        val total = conn.contentLengthLong
                        conn.inputStream.use { input ->
                            java.io.FileOutputStream(tmp).use { out ->
                                val buf = ByteArray(64 * 1024)
                                var done = 0L
                                var lastPost = 0L
                                while (true) {
                                    val n = input.read(buf)
                                    if (n <= 0) break
                                    out.write(buf, 0, n)
                                    done += n
                                    val now = System.currentTimeMillis()
                                    if (now - lastPost > 200) {
                                        lastPost = now
                                        val d = done
                                        runOnUiThread {
                                            if (total > 0) { progress.isIndeterminate = false; progress.setProgressCompat((d * 100 / total).toInt(), true); updateStatus.text = "Downloading $latestVersion… ${d / 1024 / 1024} of ${total / 1024 / 1024} MB" }
                                            else updateStatus.text = "Downloading $latestVersion… ${d / 1024 / 1024} MB"
                                        }
                                    }
                                }
                            }
                        }
                        conn.disconnect()
                        if (tmp.length() < 1_000_000) err = "The download was incomplete (${tmp.length() / 1024} KB)"
                        else if (!tmp.renameTo(apkFile)) err = "Could not save the file"
                    }
                } catch (e: Exception) {
                    err = e.message ?: e.javaClass.simpleName
                }
                runOnUiThread {
                    downloading = false
                    updateBtn.isEnabled = true
                    progress.visibility = View.GONE
                    if (err == null) showInstall()
                    else {
                        updateStatus.text = "Download failed: $err. Tap to try again, or open the release page in a browser."
                        updateBtn.text = "Retry download"
                        updateBtn.setOnClickListener { download() }
                    }
                }
            }.start()
        }
        fun check() {
            updateBtn.isEnabled = false
            updateStatus.text = "Checking…"
            Thread {
                val rel = api.getUrl(releasesApi)
                val latest = (rel?.optString("tag_name") ?: "").removePrefix("android-v")
                val asset = rel?.optJSONArray("assets")?.let { a -> (0 until a.length()).map { a.getJSONObject(it) }.firstOrNull { it.optString("name").endsWith(".apk") } }
                val url = asset?.optString("browser_download_url")
                runOnUiThread {
                    updateBtn.isEnabled = true
                    when {
                        rel == null -> updateStatus.text = "Could not reach GitHub. On GrapheneOS, check that this app has the Network permission."
                        url == null || latest.isEmpty() -> updateStatus.text = "No release found."
                        newer(latest, version) -> {
                            latestUrl = url; latestVersion = latest
                            updateStatus.text = "Version $latest is available (you have $version)."
                            updateBtn.text = "Download $latest"
                            updateBtn.setOnClickListener { download() }
                        }
                        else -> { updateStatus.text = "You are on the latest version ($version)."; updateBtn.text = "Check again" }
                    }
                }
            }.start()
        }
        updateBtn.setOnClickListener { check() }
        root.addView(card(heading("Update"), updateStatus, progress, updateBtn))

        // ---- Settings
        val aggrLabel = body("Aggressiveness · ${(prefs.aggressiveness * 100).toInt()}", dim = false)
        val slider = Slider(this).apply { valueFrom = 0f; valueTo = 100f; stepSize = 5f; value = (prefs.aggressiveness * 100).toInt().toFloat(); addOnChangeListener { _, v, _ -> prefs.aggressiveness = v / 100f; aggrLabel.text = "Aggressiveness · ${v.toInt()}" } }
        val langLabel = body("Language", dim = false)
        val langs = listOf("auto" to "Auto", "en" to "English", "da" to "Dansk")
        val langGroup = MaterialButtonToggleGroup(this).apply { isSingleSelection = true; isSelectionRequired = true }
        langs.forEachIndexed { i, (k, l) -> langGroup.addView(MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply { text = l; id = 1000 + i; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) }) }
        langGroup.check(1000 + langs.indexOfFirst { it.first == prefs.lang }.coerceAtLeast(0))
        langGroup.addOnButtonCheckedListener { _, id, checked -> if (checked) prefs.lang = langs[id - 1000].first }
        val langHint = body("Auto follows the paragraph you are writing. Holding the space bar on the keyboard switches too.")
        val toneLabel = body("Tone", dim = false)
        val tones = listOf("as-written" to "As written", "neutral" to "Neutral", "formal" to "Formal", "professional" to "Professional", "casual" to "Casual", "friendly" to "Friendly", "academic" to "Academic", "concise" to "Concise")
        val toneGroup = com.google.android.material.chip.ChipGroup(this).apply { isSingleSelection = true; isSelectionRequired = true }
        tones.forEachIndexed { i, (k, l) -> toneGroup.addView(com.google.android.material.chip.Chip(this, null, com.google.android.material.R.attr.chipStyle).apply { text = l; id = 2000 + i; isCheckable = true; isChecked = prefs.tone == k; setEnsureMinTouchTargetSize(false) }) }
        toneGroup.setOnCheckedStateChangeListener { _, ids -> ids.firstOrNull()?.let { prefs.tone = tones[it - 2000].first } }
        val toneHint = body("As written only fixes errors. Any other tone also swaps single words that clash with it.")
        root.addView(card(heading("Corrections"), aggrLabel, slider, langLabel, langGroup, langHint, toneLabel, toneGroup, toneHint))

        // ---- Try it
        val tryBox = TextInputLayout(this, null, com.google.android.material.R.attr.textInputOutlinedStyle).apply { hint = "Type here: I definately recieved it ,and woyou please look"; setBoxCornerRadii(dp(14).toFloat(), dp(14).toFloat(), dp(14).toFloat(), dp(14).toFloat()) }
        tryBox.addView(TextInputEditText(tryBox.context).apply { minLines = 3; gravity = Gravity.TOP })
        root.addView(card(heading("Try it"), tryBox))

        // ---- Spell checker + server
        val spellBtn = button("Open spell checker settings", tonal = true) { try { startActivity(Intent("android.settings.SPELL_CHECKER_SETTINGS")) } catch (e: Exception) { startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)) } }
        val serverBox = TextInputLayout(this, null, com.google.android.material.R.attr.textInputOutlinedStyle).apply { hint = "Server (HTTPS)" }
        serverBox.addView(TextInputEditText(serverBox.context).apply { setText(prefs.apiBase); setOnFocusChangeListener { _, f -> if (!f) prefs.apiBase = text.toString().trim() } })
        root.addView(card(heading("More"), body("The spell checker works with any keyboard: typos are underlined and a tap accepts the suggestion. Settings → System → Languages → Spell checker."), spellBtn, serverBox, body("Text near the cursor is sent to the server for decisions. Passwords, numbers, e-mail, URL and incognito fields are never touched.")))

        setContentView(ScrollView(this).apply { addView(root); isVerticalScrollBarEnabled = false; fitsSystemWindows = true })
        if (!prefs.welcomed) showWelcome(prefs)
        if (apkFile.exists() && apkFile.length() > 1_000_000) { latestVersion = "downloaded update"; updateStatus.text = "An update was downloaded earlier. Install it, or check again for a newer one."; updateBtn.text = "Install downloaded update"; updateBtn.setOnClickListener { install() } }
    }

    /** First-open explainer: how corrections happen, what the chips and the dot mean, how to undo. */
    private fun showWelcome(prefs: Prefs) {
        val pad = dp(20)
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, dp(8), pad, 0) }
        fun line(icon: String, iconColour: String, title: String, text: String) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(10), 0, dp(4)) }
            row.addView(TextView(this).apply { this.text = icon; textSize = 14f; setTextColor(Color.WHITE); setPadding(dp(10), dp(4), dp(10), dp(4)); background = android.graphics.drawable.GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(Color.parseColor(iconColour)) } }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(12); gravity = Gravity.CENTER_VERTICAL })
            val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            col.addView(TextView(this).apply { this.text = title; textSize = 15f; setTypeface(typeface, android.graphics.Typeface.BOLD); setTextColor(color(com.google.android.material.R.attr.colorOnSurface)) })
            col.addView(TextView(this).apply { this.text = text; textSize = 14f; setTextColor(color(com.google.android.material.R.attr.colorOnSurfaceVariant)); setLineSpacing(0f, 1.15f) })
            row.addView(col, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            body.addView(row)
        }
        line("abc", "#1A73E8", "It corrects while you type", "Type as usual. When you hit space, the word you just finished is checked: typos, a word that is wrong for the meaning, a stray word from the other language. Every few words the whole sentence is checked too, and again when you pause.")
        line("teh → the", "#5F6368", "Each change shows as a chip", "The strip above the keys lists what was changed, newest first. Grey is a typo, orange a re-check, blue a word fixed from context, purple a translation or a sentence repair.")
        line("↩", "#B3261E", "Tap a chip to undo", "Tapping a chip puts your original word back, and that word is never touched again on this phone. Backspace right after a change also undoes it.")
        line("●", "#D93025", "The dot: red is thinking, green is done", "Red means a check is still running or waiting for the next word. Green means everything you typed has been checked. Wait for green before you send if you want every fix in.")
        line("⎵", "#1E8E3E", "Hold the space bar", "Switches the language between Auto, English and Dansk. Auto follows the paragraph you are writing.")
        val dialog = com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
            .setTitle("How Inline Autocorrect works")
            .setView(ScrollView(this).apply { addView(body) })
            .setPositiveButton("Got it") { _, _ -> prefs.welcomed = true }
            .setNeutralButton("Show me again later", null)
            .create()
        dialog.show()
    }

    private fun color(attr: Int): Int = com.google.android.material.color.MaterialColors.getColor(this, attr, 0)

    private fun newer(a: String, b: String): Boolean {
        val pa = a.split(".").map { it.toIntOrNull() ?: 0 }
        val pb = b.split(".").map { it.toIntOrNull() ?: 0 }
        for (i in 0 until 3) { val x = pa.getOrElse(i) { 0 }; val y = pb.getOrElse(i) { 0 }; if (x != y) return x > y }
        return false
    }
}
