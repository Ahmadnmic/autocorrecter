package com.nmic.autocorrect

import android.content.Context

class Prefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("ica", Context.MODE_PRIVATE)
    var enabled: Boolean get() = p.getBoolean("enabled", true); set(v) = p.edit().putBoolean("enabled", v).apply()
    var aggressiveness: Float get() = p.getFloat("aggr", 0.5f); set(v) = p.edit().putFloat("aggr", v).apply()
    var lang: String get() = p.getString("lang", "auto")!!; set(v) = p.edit().putString("lang", v).apply()
    var apiBase: String get() = p.getString("api", "https://inline-autocorrect.vercel.app")!!; set(v) = p.edit().putString("api", v).apply()
    var session: String get() = p.getString("session", null) ?: java.util.UUID.randomUUID().toString().take(8).also { p.edit().putString("session", it).apply() }
        set(v) = p.edit().putString("session", v).apply()
}
