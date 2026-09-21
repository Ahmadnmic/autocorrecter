package com.nmic.autocorrect

import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject

/**
 * The correction engine for the keyboard. It reads the real text around the cursor through the InputConnection
 * (no drift), runs the same passes as the web app (common typos, learned library, Jev typo/re-check, translation,
 * late resolution) and applies fixes with delete + commit. Every outcome is logged for the learning job.
 */
class Engine(private val prefs: Prefs, private val api: Api, private val io: IO) {
    interface IO {
        fun textBeforeCursor(n: Int): String
        fun textAfterCursor(n: Int): String
        /** Replace `len` chars ending `backFromCursor` chars before the cursor with `to`. */
        fun replaceBeforeCursor(backFromCursor: Int, len: Int, to: String): Boolean
        fun onChange(change: Change)
    }
    data class Change(val id: String, val old: String, val to: String, val kind: String, var reverted: Boolean = false, val at: Long = System.currentTimeMillis())

    private val main = Handler(Looper.getMainLooper())
    val changes = ArrayList<Change>()
    private val never = HashSet<String>()
    private val unresolved = LinkedHashMap<String, Unresolved>()
    private data class Unresolved(val word: String, val leftAnchor: String, var tries: Int = 0)
    private var lang: String? = null
    private var langProbe = 0
    @Volatile var library: JSONObject = JSONObject().put("entries", JSONObject()).put("never", JSONArray())
    private val logQueue = ArrayList<JSONObject>()
    private var logScheduled = false

    fun currentLang(text: String): String = if (prefs.lang == "auto") lang ?: TextUtil.detectLang(text) else prefs.lang

    fun refreshLibrary() = api.pool.execute { api.get("/api/library")?.let { library = it } }

    /** Called after a boundary character was committed. */
    fun onBoundary() {
        if (!prefs.enabled) return
        val before = io.textBeforeCursor(500)
        val w = TextUtil.wordEndingAt(before, before.length - 1) ?: return
        val tail = before.substring(w.end)
        val lang = currentLang(before)
        val bare = w.word.trim('\'', '’').lowercase()
        val learned = library.optJSONObject("entries")?.optJSONObject(bare)
        val neverLib = library.optJSONArray("never")?.let { a -> (0 until a.length()).any { a.optString(it) == bare } } ?: false
        val table = TextUtil.commonTypos[lang]?.get(bare) ?: if (learned != null && !neverLib && (learned.optString("lang", lang) == lang)) learned.optString("to") else null
        if (table != null && !never.contains(w.word.lowercase())) {
            apply(w.word, TextUtil.transferCase(w.word, table), tail, "typo", before.substring(0, w.start))
            resolveLate()
            return
        }
        val typos = JSONArray()
        if (!TextUtil.shouldSkip(w.word) && !never.contains(w.word.lowercase())) typos.put(JSONObject().put("id", "t").put("word", w.word).put("left", before.substring(maxOf(0, w.start - 400), w.start)))
        val recheck = JSONArray()
        val prev = TextUtil.wordsBefore(before, w.start, 4)
        val conf = TextUtil.confusables[lang] ?: emptyMap()
        val rcMeta = HashMap<String, TextUtil.Span>()
        for ((i, sp) in prev.withIndex()) {
            var alts = conf[sp.word.lowercase()]
            val own = changes.lastOrNull { !it.reverted && it.kind == "typo" && it.to == sp.word }
            if (own != null) alts = listOf(own.old) + (alts ?: emptyList())
            if (alts.isNullOrEmpty() || never.contains(sp.word.lowercase())) continue
            val id = "r$i"
            rcMeta[id] = sp
            recheck.put(JSONObject().put("id", id).put("word", sp.word).put("alternatives", JSONArray(alts.take(3))).put("left", before.substring(maxOf(0, sp.start - 300), sp.start)).put("right", before.substring(sp.end)))
        }
        if (typos.length() == 0 && recheck.length() == 0) { resolveLate(); return }
        val probe = prefs.lang == "auto" && (lang == null || langProbe++ >= 10)
        if (probe) langProbe = 0
        val body = JSONObject().put("client", "android").put("session", prefs.session).put("lang", if (probe) "auto" else lang).put("aggressiveness", prefs.aggressiveness.toDouble()).put("typos", typos).put("recheck", recheck)
        if (probe) body.put("doc", before)
        val anchorLeft = before.substring(0, w.start)
        api.pool.execute {
            val res = api.post("/api/jev", body) ?: return@execute
            main.post {
                res.optString("lang").takeIf { it.isNotEmpty() }?.let { this.lang = it }
                val ts = res.optJSONArray("typos") ?: JSONArray()
                for (i in 0 until ts.length()) {
                    val d = ts.getJSONObject(i)
                    if (d.optBoolean("foreign")) { translate(w.word, anchorLeft, lang); continue }
                    if (d.optBoolean("replace") && d.has("to")) applyIfIntact(w.word, d.getString("to"), anchorLeft, "typo")
                    else if (d.optBoolean("unresolved")) unresolved.putIfAbsent(w.word + "@" + anchorLeft.takeLast(40), Unresolved(w.word, anchorLeft.takeLast(40)))
                }
                val rs = res.optJSONArray("recheck") ?: JSONArray()
                for (i in 0 until rs.length()) {
                    val d = rs.getJSONObject(i)
                    val sp = rcMeta[d.optString("id")] ?: continue
                    if (d.optBoolean("replace") && d.has("to")) applyIfIntact(sp.word, d.getString("to"), before.substring(0, sp.start), "recheck")
                }
                resolveLate()
            }
        }
    }

    private fun translate(word: String, anchorLeft: String, lang: String) {
        val body = JSONObject().put("word", word).put("left", anchorLeft.takeLast(600)).put("lang", if (prefs.lang == "auto") lang else prefs.lang).put("aggressiveness", prefs.aggressiveness.toDouble()).put("translate", true)
        api.pool.execute {
            val res = api.post("/api/decide", body) ?: return@execute
            if (res.optBoolean("replace") && res.optString("kind") == "translate") main.post { applyIfIntact(word, res.getString("to"), anchorLeft, "translate") }
        }
    }

    private var resolving = false
    private fun resolveLate() {
        if (resolving || unresolved.isEmpty()) return
        val before = io.textBeforeCursor(600)
        val items = JSONArray()
        val ready = ArrayList<Pair<String, Unresolved>>()
        val it = unresolved.entries.iterator()
        while (it.hasNext()) {
            val (id, u) = it.next()
            val idx = before.lastIndexOf(u.leftAnchor + u.word)
            if (idx < 0 || u.tries >= 3) { it.remove(); continue }
            val after = before.substring(idx + u.leftAnchor.length + u.word.length)
            val wordsAfter = Regex("[\\p{L}'’-]+").findAll(after).count()
            if (wordsAfter >= 2 || Regex("[.!?]").containsMatchIn(after)) {
                ready.add(id to u)
                items.put(JSONObject().put("id", id).put("word", u.word).put("left", before.substring(maxOf(0, idx + u.leftAnchor.length - 300), idx + u.leftAnchor.length)).put("right", after.take(200)))
            }
        }
        if (ready.isEmpty()) return
        resolving = true
        val body = JSONObject().put("items", items).put("lang", currentLang(before)).put("aggressiveness", prefs.aggressiveness.toDouble())
        api.pool.execute {
            val res = api.post("/api/resolve", body)
            main.post {
                resolving = false
                val ds = res?.optJSONArray("decisions") ?: JSONArray()
                for ((id, u) in ready) {
                    u.tries++
                    for (i in 0 until ds.length()) {
                        val d = ds.getJSONObject(i)
                        if (d.optString("id") == id && d.optBoolean("replace") && d.has("to")) {
                            val nowBefore = io.textBeforeCursor(600)
                            val idx = nowBefore.lastIndexOf(u.leftAnchor + u.word)
                            if (idx >= 0 && applyIfIntact(u.word, d.getString("to"), nowBefore.substring(0, idx + u.leftAnchor.length), "resolved")) unresolved.remove(id)
                        }
                    }
                }
            }
        }
    }

    /** Apply if `old` still sits right after `anchorLeft` in the current text and the tail after it is short. */
    private fun applyIfIntact(old: String, to: String, anchorLeft: String, kind: String): Boolean {
        val before = io.textBeforeCursor(600)
        val key = anchorLeft.takeLast(60) + old
        val idx = before.lastIndexOf(key)
        if (idx < 0) return false
        val start = idx + anchorLeft.takeLast(60).length
        val tail = before.substring(start + old.length)
        if (tail.length > 60) return false
        return apply(old, to, tail, kind, before.substring(0, start))
    }

    private fun apply(old: String, to: String, tail: String, kind: String, left: String): Boolean {
        if (to == old || never.contains(old.lowercase()) && kind != "grammar") return false
        val ok = io.replaceBeforeCursor(old.length + tail.length, old.length + tail.length, to + tail)
        if (!ok) return false
        val c = Change("${System.currentTimeMillis()}-${changes.size}", old, to, kind)
        changes.add(0, c)
        if (changes.size > 100) changes.removeAt(changes.size - 1)
        io.onChange(c)
        if (kind != "grammar") log(JSONObject().put("kind", if (kind == "resolved") "resolved" else "applied").put("old", old).put("to", to).put("changeKind", kind).put("lang", currentLang(left)).put("left", left.takeLast(160)).put("right", tail.take(120)))
        return true
    }

    fun revert(c: Change): Boolean {
        if (c.reverted) return false
        val before = io.textBeforeCursor(600)
        val idx = before.lastIndexOf(c.to)
        if (idx < 0) return false
        val tail = before.substring(idx + c.to.length)
        if (tail.length > 60) return false
        if (!io.replaceBeforeCursor(c.to.length + tail.length, c.to.length + tail.length, c.old + tail)) return false
        c.reverted = true
        never.add(c.old.lowercase())
        log(JSONObject().put("kind", "reverted").put("old", c.old).put("to", c.to).put("changeKind", c.kind).put("lang", currentLang(before)))
        return true
    }

    private fun log(ev: JSONObject) {
        logQueue.add(ev)
        if (logScheduled) return
        logScheduled = true
        main.postDelayed({
            logScheduled = false
            val events = JSONArray(ArrayList(logQueue)); logQueue.clear()
            api.pool.execute { api.post("/api/log", JSONObject().put("client", "android").put("session", prefs.session).put("events", events)) }
        }, 1500)
    }
}
