package com.nmic.autocorrect

import android.content.Context

class Prefs(ctx: Context) {
    companion object { const val DEFAULT_API = "https://inline-autocorrect.vercel.app" }
    private val p = ctx.getSharedPreferences("ica", Context.MODE_PRIVATE)
    var enabled: Boolean get() = p.getBoolean("enabled", true); set(v) = p.edit().putBoolean("enabled", v).apply()
    var aggressiveness: Float get() = p.getFloat("aggr", 0.5f); set(v) = p.edit().putFloat("aggr", v).apply()
    var lang: String get() = p.getString("lang", "auto")!!; set(v) = p.edit().putString("lang", v).apply()
    var tone: String get() = p.getString("tone", "as-written")!!; set(v) = p.edit().putString("tone", v).apply()
    // Only HTTPS endpoints: typed text must never leave the phone in clear.
    var apiBase: String get() = p.getString("api", DEFAULT_API)!!.let { if (it.startsWith("https://")) it else DEFAULT_API }
        set(v) = p.edit().putString("api", if (v.startsWith("https://")) v.trimEnd('/') else DEFAULT_API).apply()
    /** Words the writer reverted on this phone: never corrected again here, even before the server profile catches up. */
    var never: Set<String> get() = p.getStringSet("never", emptySet()) ?: emptySet(); set(v) = p.edit().putStringSet("never", v.take(500).toSet()).apply()
    /** The writer's own word list, "typed=replacement" per entry, applied before anything else. */
    var myWords: Map<String, String>
        get() = (p.getStringSet("mywords", emptySet()) ?: emptySet()).mapNotNull { val i = it.indexOf('='); if (i <= 0) null else it.substring(0, i) to it.substring(i + 1) }.toMap()
        set(v) = p.edit().putStringSet("mywords", v.entries.take(500).map { "${it.key}=${it.value}" }.toSet()).apply()
    var welcomed: Boolean get() = p.getBoolean("welcomed", false); set(v) = p.edit().putBoolean("welcomed", v).apply()
    var session: String get() = p.getString("session", null) ?: java.util.UUID.randomUUID().toString().take(8).also { p.edit().putString("session", it).apply() }
        set(v) = p.edit().putString("session", v).apply()
}
