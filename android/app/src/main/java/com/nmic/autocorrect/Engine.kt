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
        /**
         * Replace the `len` characters that start `startBack` characters before the cursor with `to`, leaving the text
         * after them (and the cursor's logical position) untouched.
         */
        fun replaceBeforeCursor(startBack: Int, len: Int, to: String): Boolean
        fun onChange(change: Change)
    }
    data class Change(val id: String, val old: String, val to: String, val kind: String, var reverted: Boolean = false, val at: Long = System.currentTimeMillis(), val anchor: String = "")

    private val main = Handler(Looper.getMainLooper())
    val changes = ArrayList<Change>()
    private val never = HashSet<String>()
    private val unresolved = LinkedHashMap<String, Unresolved>()
    private var unresolvedSeq = 0 // ids must survive the server's sanitiser ([A-Za-z0-9_:.-]), so they are plain counters
    private data class Unresolved(val word: String, val leftAnchor: String, var tries: Int = 0)
    private var lang: String? = null
    private var langProbe = 0
    private var wordsSinceContext = 0
    private var contextInflight = false
    private var lastContextWindow = ""
    private var lastContextAt = 0L
    @Volatile var library: JSONObject = JSONObject().put("entries", JSONObject()).put("never", JSONArray())
    private val logQueue = ArrayList<JSONObject>()
    private var logScheduled = false

    /**
     * Auto mode: the current paragraph decides when it clearly leans one way (the writer switched language mid-text);
     * otherwise the server's last probe; otherwise a local guess over the whole text.
     */
    fun currentLang(text: String): String {
        if (prefs.lang != "auto") return prefs.lang
        val para = text.substring(text.lastIndexOf('\n') + 1)
        val local = TextUtil.detectLangScore(para.takeLast(300))
        if (local.words >= 4 && kotlin.math.abs(local.da - local.en) >= 2) return if (local.da > local.en) "da" else "en"
        return lang ?: TextUtil.detectLang(text)
    }
    private val keepVerdicts = HashMap<String, Int>() // word -> confident "keep" verdicts from re-checks
    private var pendingForeign: Pair<String, String>? = null // (word, anchorLeft) waiting for the next word before translating

    fun refreshLibrary() = api.pool.execute { api.get("/api/library")?.let { library = it } }

    /**
     * Called after any character was committed (the character is the last one before the cursor). Runs the local
     * grammar pass (spacing, punctuation, capitals); returns true when it changed something.
     */
    fun onChar(lang: String? = null): Boolean {
        if (!prefs.enabled) return false
        val before = io.textBeforeCursor(200)
        if (before.isEmpty()) return false
        val f = Grammar.fix(before, before.length - 1, lang ?: currentLang(before)) ?: return false
        if (f.start < before.length - 4) return false
        val old = before.substring(f.start, f.end)
        val tail = before.substring(f.end)
        if (old == f.to) return false
        return apply(old, f.to, tail, "grammar", before.substring(0, f.start))
    }

    /**
     * Called right after a boundary character was committed, with the text before the cursor as it was at that
     * moment, so letters typed a split second later are never mistaken for the finished word.
     */
    fun onBoundary(snapshot: String? = null) {
        if (!prefs.enabled) return
        val before = snapshot ?: io.textBeforeCursor(500)
        if (before.isEmpty() || TextUtil.isWordChar(before.last())) return
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
            if (own == null && (keepVerdicts[sp.word.lowercase()] ?: 0) >= 2) continue
            val id = "r$i"
            rcMeta[id] = sp
            recheck.put(JSONObject().put("id", id).put("word", sp.word).put("alternatives", JSONArray(alts.take(3))).put("left", before.substring(maxOf(0, sp.start - 300), sp.start)).put("right", before.substring(sp.end)))
        }
        // Context pass: every few words, or at the end of a sentence, ask Jev whether the recent window holds a word
        // that is wrong in context; only then is Haiku asked to propose, and Jev gates each proposal (same as the web).
        wordsSinceContext++
        val boundary = before.lastOrNull() ?: ' '
        val window = before.takeLast(600)
        val wantContext = !contextInflight && window != lastContextWindow && window.trim().split(Regex("\\s+")).size >= 3 && (wordsSinceContext >= 2 || boundary in ".!?") && System.currentTimeMillis() - lastContextAt > 1200
        if (typos.length() == 0 && recheck.length() == 0 && !wantContext) { resolveLate(); return }
        val probe = prefs.lang == "auto" && (lang == null || langProbe++ >= 10)
        if (probe) langProbe = 0
        val body = JSONObject().put("client", "android").put("session", prefs.session).put("lang", if (probe) "auto" else lang).put("aggressiveness", prefs.aggressiveness.toDouble()).put("tone", prefs.tone).put("typos", typos).put("recheck", recheck)
        if (probe) body.put("doc", before)
        if (wantContext) { body.put("prefilter", JSONObject().put("window", window)); wordsSinceContext = 0; lastContextWindow = window; lastContextAt = System.currentTimeMillis(); contextInflight = true }
        val anchorLeft = before.substring(0, w.start)
        api.pool.execute {
            val res = api.post("/api/jev", body) ?: return@execute
            main.post {
                res.optString("lang").takeIf { it.isNotEmpty() }?.let { this.lang = it }
                val ts = res.optJSONArray("typos") ?: JSONArray()
                for (i in 0 until ts.length()) {
                    val d = ts.getJSONObject(i)
                    if (d.optBoolean("foreign")) {
                        val prev = pendingForeign
                        if (prev != null && before.contains(prev.second.takeLast(40) + prev.first)) {
                            // Two foreign words in a row: the writer switched language. Follow them instead of translating.
                            pendingForeign = null
                            if (prefs.lang == "auto") { this.lang = if (lang == "da") "en" else "da"; langProbe = 0 }
                        } else pendingForeign = w.word to anchorLeft
                        continue
                    }
                    pendingForeign?.let { (pw, pl) -> pendingForeign = null; if (!TextUtil.shouldSkip(pw)) translate(pw, pl, lang) }
                    if (d.optBoolean("replace") && d.has("to")) applyIfIntact(w.word, d.getString("to"), anchorLeft, "typo")
                    else if (d.optBoolean("unresolved")) unresolved.putIfAbsent("u" + (unresolvedSeq++), Unresolved(w.word, anchorLeft.takeLast(40)))
                }
                val rs = res.optJSONArray("recheck") ?: JSONArray()
                for (i in 0 until rs.length()) {
                    val d = rs.getJSONObject(i)
                    val sp = rcMeta[d.optString("id")] ?: continue
                    if (d.optBoolean("replace") && d.has("to")) applyIfIntact(sp.word, d.getString("to"), before.substring(0, sp.start), "recheck")
                    else if (d.optDouble("confidence", 0.0) >= 0.9) keepVerdicts[sp.word.lowercase()] = (keepVerdicts[sp.word.lowercase()] ?: 0) + 1
                }
                val pf = res.optJSONObject("prefilter")
                if (wantContext) {
                    if (pf != null && pf.optBoolean("callHaiku")) contextPass(window, res.optString("lang").ifEmpty { lang }) else contextInflight = false
                }
                resolveLate()
            }
        }
    }

    /**
     * The writer paused (no key for a moment). Short messages end without a boundary after the last word, so run
     * the context pass on the whole current text now, telling the server the window is complete.
     */
    fun onIdle() {
        if (!prefs.enabled || contextInflight) return
        val before = io.textBeforeCursor(600)
        val window = before.takeLast(600)
        if (window == lastContextWindow || window.trim().split(Regex("\\s+")).size < 3) return
        lastContextWindow = window; lastContextAt = System.currentTimeMillis(); wordsSinceContext = 0; contextInflight = true
        contextPass(window, currentLang(before), paused = true)
        resolveLate(paused = true)
    }

    /** Haiku proposes better words for the window, Jev gates them; approved ones are applied if the text is intact. */
    private fun contextPass(window: String, lang: String, paused: Boolean = false) {
        val body = JSONObject().put("window", window).put("lang", lang).put("aggressiveness", prefs.aggressiveness.toDouble()).put("tone", prefs.tone).put("skipPrefilter", true).put("paused", paused)
        api.pool.execute {
            val res = api.post("/api/propose", body, 9000)
            main.post {
                contextInflight = false
                val approved = res?.optJSONArray("approved") ?: JSONArray()
                if (approved.length() == 0) return@post
                val before = io.textBeforeCursor(600)
                val anchor = window.takeLast(80)
                val windowStart = before.lastIndexOf(anchor).let { if (it < 0) -1 else it + anchor.length - window.length }
                if (windowStart < 0) return@post
                // Apply from the end so earlier offsets stay valid.
                val items = (0 until approved.length()).map { approved.getJSONObject(it) }.sortedByDescending { it.optInt("offset") }
                for (a in items) {
                    val original = a.optString("original"); val to = a.optString("to"); val offset = a.optInt("offset", -1)
                    if (original.isEmpty() || to.isEmpty() || offset < 0) continue
                    val abs = windowStart + offset
                    if (abs < 0 || abs + original.length > before.length || before.substring(abs, abs + original.length) != original) continue
                    applyIfIntact(original, to, before.substring(0, abs), if (a.optString("kind") == "tone") "tone" else "context")
                }
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
    private fun resolveLate(paused: Boolean = false) {
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
            if (wordsAfter >= 1 || paused || Regex("[.!?]").containsMatchIn(after)) {
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
        // Locate this occurrence of `old` by the text before it. Another correction may have changed that text in
        // the meantime (two fixes a second apart), so shorter anchors are tried too, always on whole-word boundaries.
        var start = -1
        for (n in intArrayOf(60, 24, 10, 3)) {
            val a = anchorLeft.takeLast(n)
            val idx = before.lastIndexOf(a + old)
            if (idx < 0) continue
            val s = idx + a.length
            val e = s + old.length
            val wordBefore = s > 0 && TextUtil.isWordChar(before[s - 1])
            val wordAfter = e < before.length && TextUtil.isWordChar(before[e])
            if (!wordBefore && !wordAfter) { start = s; break }
        }
        if (start < 0) return false
        val tail = before.substring(start + old.length)
        if (tail.length > 500) return false
        return apply(old, to, tail, kind, before.substring(0, start))
    }

    private fun apply(old: String, to0: String, tail: String, kind: String, left: String): Boolean {
        val to = if (kind != "grammar" && currentLang(left) == "en") to0.replace(Regex("(^|\\s)i(?=\\s|$)"), "$1I") else to0
        if (to == old || never.contains(old.lowercase()) && kind != "grammar") return false
        val ok = io.replaceBeforeCursor(old.length + tail.length, old.length, to)
        if (!ok) return false
        if (kind == "grammar" && old.isBlank() && to.isBlank()) return true // spacing only: not worth a chip
        val c = Change("${System.currentTimeMillis()}-${changes.size}", old, to, kind, anchor = left.takeLast(40))
        changes.add(0, c)
        if (changes.size > 100) changes.removeAt(changes.size - 1)
        io.onChange(c)
        if (kind != "grammar") log(JSONObject().put("kind", if (kind == "resolved") "resolved" else "applied").put("old", old).put("to", to).put("changeKind", kind).put("lang", currentLang(left)).put("left", left.takeLast(160)).put("right", tail.take(120)))
        return true
    }

    fun revert(c: Change): Boolean {
        if (c.reverted) return false
        val before = io.textBeforeCursor(600)
        // Find this particular change (the text before it, then the word), not just the last occurrence of the word.
        var idx = -1
        for (n in intArrayOf(40, 20, 8)) { val a = c.anchor.takeLast(n); val i = before.lastIndexOf(a + c.to); if (i >= 0) { idx = i + a.length; break } }
        if (idx < 0) idx = before.lastIndexOf(c.to)
        if (idx < 0) return false
        val tail = before.substring(idx + c.to.length)
        if (tail.length > 500) return false
        if (!io.replaceBeforeCursor(c.to.length + tail.length, c.to.length, c.old)) return false
        c.reverted = true
        never.add(c.old.lowercase())
        log(JSONObject().put("kind", "reverted").put("old", c.old).put("to", c.to).put("changeKind", c.kind).put("lang", currentLang(before)))
        return true
    }

    /** Diagnostic note sent with the event log, so client-side failures show up in the server logs. */
    fun diag(note: String) = log(JSONObject().put("kind", "cancelled").put("old", note.take(80)).put("to", "").put("changeKind", "diag").put("lang", prefs.lang.take(2)))

    private fun scrub(t: String) = t.replace(Regex("[\\w.+-]+@[\\w-]+\\.[\\w.-]+"), "<email>").replace(Regex("\\S*\\d\\S*\\d\\S*"), "<num>").replace(Regex("\\S{20,}"), "<long>")

    private fun log(ev: JSONObject) {
        if (ev.optString("old").contains("@") || ev.optString("to").contains("@")) return
        if (ev.has("left")) ev.put("left", scrub(ev.optString("left")))
        if (ev.has("right")) ev.put("right", scrub(ev.optString("right")))
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
