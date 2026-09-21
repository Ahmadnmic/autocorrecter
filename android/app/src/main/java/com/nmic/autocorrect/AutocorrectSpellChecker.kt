package com.nmic.autocorrect

import android.service.textservice.SpellCheckerService
import android.view.textservice.SentenceSuggestionsInfo
import android.view.textservice.SuggestionsInfo
import android.view.textservice.TextInfo
import org.json.JSONArray
import org.json.JSONObject
import java.util.Collections

/**
 * System spell checker: works with any keyboard. Android underlines the words we flag and shows our suggestions
 * when the user taps them. Typos are flagged red; confusables and context errors (their/there, then/than) are
 * flagged as grammar (blue) on Android 12+. Decisions come from the same /api/jev route as the other clients.
 */
class AutocorrectSpellChecker : SpellCheckerService() {
    override fun createSession(): Session = SessionImpl(Prefs(this))

    private class SessionImpl(private val prefs: Prefs) : Session() {
        private val api = Api(prefs)
        private val cache = Collections.synchronizedMap(object : LinkedHashMap<String, Array<Any?>>(64, 0.75f, true) {
            override fun removeEldestEntry(e: MutableMap.MutableEntry<String, Array<Any?>>?) = size > 200
        })
        override fun onCreate() {}

        override fun onGetSuggestions(textInfo: TextInfo, limit: Int): SuggestionsInfo {
            val word = textInfo.text ?: return SuggestionsInfo(0, arrayOf())
            val r = check(word, "", "", "")
            return r ?: SuggestionsInfo(0, arrayOf())
        }

        override fun onGetSentenceSuggestionsMultiple(textInfos: Array<TextInfo>, limit: Int): Array<SentenceSuggestionsInfo> {
            return textInfos.map { ti ->
                val text = ti.text ?: ""
                val words = Regex("[\\p{L}\\p{M}'’\\-]+").findAll(text).filter { it.value.length >= 2 }.toList()
                // The system never sends password, e-mail, URL or "no suggestions" fields here, but a sentence that has no
                // spaces or looks like a token/credential is skipped as well.
                if (words.isEmpty() || !prefs.enabled || TextUtil.looksLikeSecret(text)) return@map SentenceSuggestionsInfo(arrayOf(), intArrayOf(), intArrayOf())
                val lang = if (prefs.lang == "auto") "auto" else prefs.lang
                val typos = JSONArray(); val recheck = JSONArray()
                val confAll = TextUtil.confusables
                words.forEachIndexed { i, m ->
                    val w = m.value
                    if (TextUtil.shouldSkip(w)) return@forEachIndexed
                    typos.put(JSONObject().put("id", "w$i").put("word", w).put("left", text.substring(0, m.range.first)))
                    val lower = w.lowercase()
                    val alts = confAll["en"]?.get(lower) ?: confAll["da"]?.get(lower)
                    if (alts != null) recheck.put(JSONObject().put("id", "r$i").put("word", w).put("alternatives", JSONArray(alts.take(3))).put("left", text.substring(0, m.range.first)).put("right", text.substring(m.range.last + 1)))
                }
                val key = "$lang|$text"
                val cached = cache[key]
                val longEnough = words.size >= 6
                val res: JSONObject?
                val proposed: JSONObject?
                val extraOut: JSONObject
                if (cached != null) { res = cached[0] as JSONObject?; proposed = cached[1] as JSONObject?; extraOut = (cached.getOrNull(2) as JSONObject?) ?: JSONObject() } else {
                    val body = JSONObject().put("client", "android-spell").put("session", prefs.session).put("lang", lang).put("doc", text).put("aggressiveness", prefs.aggressiveness.toDouble()).put("tone", prefs.tone).put("typos", typos).put("recheck", recheck)
                    if (longEnough) body.put("prefilter", JSONObject().put("window", text.takeLast(900)))
                    res = api.post("/api/jev", body, 4000)
                    // Context pass: when Jev's pre-filter says the sentence holds a wrong word, Haiku proposes and Jev gates.
                    proposed = if (longEnough && res?.optJSONObject("prefilter")?.optBoolean("callHaiku") == true)
                        api.post("/api/propose", JSONObject().put("window", text.takeLast(900)).put("lang", (res?.optString("lang") ?: "").ifEmpty { if (lang == "auto") "en" else lang }).put("aggressiveness", prefs.aggressiveness.toDouble()).put("tone", prefs.tone).put("skipPrefilter", true), 9000)
                    else null
                    // Stray words from the other language: translated (like the web app). Words the dictionary could not fix
                    // with enough context after them: resolved late ("woyou" -> "would you").
                    val resolvedLang = (res?.optString("lang") ?: "").ifEmpty { if (lang == "auto") "en" else lang }
                    val ts0 = res?.optJSONArray("typos") ?: JSONArray()
                    val extra = JSONObject()
                    val toResolve = JSONArray()
                    for (j in 0 until ts0.length()) {
                        val d = ts0.getJSONObject(j)
                        val wi = d.optString("id").drop(1).toIntOrNull() ?: continue
                        val m = words.getOrNull(wi) ?: continue
                        if (d.optBoolean("foreign")) {
                            val tr = api.post("/api/decide", JSONObject().put("word", m.value).put("left", text.substring(0, m.range.first).takeLast(400)).put("lang", resolvedLang).put("aggressiveness", prefs.aggressiveness.toDouble()).put("translate", true), 5000)
                            if (tr != null && tr.optBoolean("replace") && tr.optString("kind") == "translate") extra.put("w$wi", tr.optString("to"))
                        } else if (d.optBoolean("unresolved")) {
                            val after = text.substring(m.range.last + 1)
                            if (Regex("[\\p{L}'’-]+").findAll(after).count() >= 2 || Regex("[.!?]").containsMatchIn(after))
                                toResolve.put(JSONObject().put("id", "w$wi").put("word", m.value).put("left", text.substring(0, m.range.first).takeLast(300)).put("right", after.take(200)))
                        }
                    }
                    if (toResolve.length() > 0) {
                        val rr = api.post("/api/resolve", JSONObject().put("items", toResolve).put("lang", resolvedLang).put("aggressiveness", prefs.aggressiveness.toDouble()), 9000)
                        val ds = rr?.optJSONArray("decisions") ?: JSONArray()
                        for (j in 0 until ds.length()) { val d = ds.getJSONObject(j); if (d.optBoolean("replace") && d.has("to")) extra.put(d.getString("id"), d.getString("to")) }
                    }
                    cache[key] = arrayOf(res, proposed, extra)
                    extraOut = extra
                }
                val infos = ArrayList<SuggestionsInfo>(); val offsets = ArrayList<Int>(); val lengths = ArrayList<Int>()
                if (res != null) {
                    val byId = HashMap<String, Pair<String, Int>>() // id -> (suggestion, flags)
                    val ts = res.optJSONArray("typos") ?: JSONArray()
                    for (j in 0 until ts.length()) { val d = ts.getJSONObject(j); if (d.optBoolean("replace") && d.has("to")) byId[d.getString("id")] = d.getString("to") to SuggestionsInfo.RESULT_ATTR_LOOKS_LIKE_TYPO }
                    val rs = res.optJSONArray("recheck") ?: JSONArray()
                    for (j in 0 until rs.length()) { val d = rs.getJSONObject(j); if (d.optBoolean("replace") && d.has("to")) byId["w" + d.getString("id").drop(1)] = d.getString("to") to grammarFlag() }
                    val ap = proposed?.optJSONArray("approved") ?: JSONArray()
                    val windowStart = text.length - minOf(text.length, 900)
                    for (j in 0 until ap.length()) {
                        val a = ap.getJSONObject(j)
                        val abs = windowStart + a.optInt("offset", -1)
                        val wi = words.indexOfFirst { it.range.first == abs && it.value == a.optString("original") }
                        if (wi >= 0 && !byId.containsKey("w$wi") && a.optString("to").isNotEmpty()) byId["w$wi"] = a.getString("to") to grammarFlag()
                    }
                    for (k in extraOut.keys()) if (!byId.containsKey(k)) byId[k] = extraOut.getString(k) to grammarFlag()
                    words.forEachIndexed { i, m ->
                        val hit = byId["w$i"] ?: return@forEachIndexed
                        infos.add(SuggestionsInfo(hit.second or SuggestionsInfo.RESULT_ATTR_HAS_RECOMMENDED_SUGGESTIONS, arrayOf(hit.first)))
                        offsets.add(m.range.first); lengths.add(m.value.length)
                    }
                }
                SentenceSuggestionsInfo(infos.toTypedArray(), offsets.toIntArray(), lengths.toIntArray())
            }.toTypedArray()
        }

        private fun grammarFlag(): Int = if (android.os.Build.VERSION.SDK_INT >= 31) SuggestionsInfo.RESULT_ATTR_LOOKS_LIKE_GRAMMAR_ERROR else SuggestionsInfo.RESULT_ATTR_LOOKS_LIKE_TYPO

        private fun check(word: String, left: String, right: String, lang: String): SuggestionsInfo? {
            if (TextUtil.shouldSkip(word)) return null
            val body = JSONObject().put("client", "android-spell").put("session", prefs.session).put("lang", if (prefs.lang == "auto") "auto" else prefs.lang).put("aggressiveness", prefs.aggressiveness.toDouble())
                .put("typos", JSONArray().put(JSONObject().put("id", "w").put("word", word).put("left", left)))
            val res = api.post("/api/jev", body, 4000) ?: return null
            val d = res.optJSONArray("typos")?.optJSONObject(0) ?: return null
            return if (d.optBoolean("replace") && d.has("to")) SuggestionsInfo(SuggestionsInfo.RESULT_ATTR_LOOKS_LIKE_TYPO or SuggestionsInfo.RESULT_ATTR_HAS_RECOMMENDED_SUGGESTIONS, arrayOf(d.getString("to"))) else SuggestionsInfo(0, arrayOf())
        }
    }
}
