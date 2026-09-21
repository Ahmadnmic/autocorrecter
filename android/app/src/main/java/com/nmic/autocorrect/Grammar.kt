package com.nmic.autocorrect

/**
 * Instant, local punctuation and spacing fixes applied as the user types, ported from the web app's lib/grammar.ts.
 * `fix(text, p, lang)` looks at the character just typed at index p and returns a small replacement near it, or null.
 */
object Grammar {
    data class Fix(val start: Int, val end: Int, val to: String, val note: String)

    private val ABBREV = setOf("e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "prof", "st", "no", "ca", "fx", "bl.a", "osv", "dvs", "evt", "mv", "jf", "pga", "ifm", "hhv", "inkl", "ekskl", "kl", "nr")
    private val letter = Regex("\\p{L}")
    private val lower = Regex("\\p{Ll}")
    private val letterOrDigit = Regex("[\\p{L}\\p{N}]")

    private fun isWordChar(c: Char?): Boolean = c != null && (c.isLetterOrDigit() || c == '\'' || c == '’' || c == '-' || Character.getType(c) == Character.NON_SPACING_MARK.toInt())
    private fun at(t: String, i: Int): Char? = if (i in t.indices) t[i] else null
    private fun quoteIsOpening(text: String, i: Int): Boolean {
        val paraStart = text.lastIndexOf('\n', i - 1) + 1
        var n = 0
        for (k in paraStart until i) if (text[k] == '"') n++
        return n % 2 == 0
    }
    private fun wordBefore(text: String, end: Int): String = Regex("[\\p{L}.]+$").find(text.substring(0, end.coerceIn(0, text.length)))?.value?.lowercase() ?: ""

    fun fix(text: String, p: Int, lang: String): Fix? {
        val ch = at(text, p) ?: return null
        val prev = at(text, p - 1)
        val prev2 = at(text, p - 2)

        // 0. English pronoun "i" on its own -> "I"
        if (lang == "en" && !isWordChar(ch) && prev == 'i' && !isWordChar(prev2) && prev2 != '\'' && prev2 != '’') return Fix(p - 1, p, "I", "pronoun I")
        // 1. Double space -> single
        if (ch == ' ' && prev == ' ') return Fix(p, p + 1, "", "double space")
        // 2. Space before closing punctuation
        if (ch in ",.;:!?)" && prev == ' ' && p >= 2 && prev2 != null && (letterOrDigit.matches(prev2.toString()) || prev2 in ")\"'’”")) {
            if (!(ch == '.' && prev2.isDigit())) return Fix(p - 1, p, "", "space before $ch")
        }
        // 3. Space after opening bracket or opening quote
        if (ch == ' ' && prev == '(') return Fix(p, p + 1, "", "space after (")
        if (ch == ' ' && prev == '"' && quoteIsOpening(text, p - 1)) return Fix(p, p + 1, "", "space after opening quote")
        // 4. Closing quote after a space
        if (ch == '"' && prev == ' ' && !quoteIsOpening(text, p) && p >= 2 && prev2 != null && (letterOrDigit.matches(prev2.toString()) || prev2 in ".,!?")) return Fix(p - 1, p, "", "space before closing quote")
        // 5. Missing space after , ; : ! ? . followed by a letter
        if (letter.matches(ch.toString()) && prev != null && prev in ",;:!?.") {
            val before = at(text, p - 2)
            if (before != null && letter.matches(before.toString())) {
                val wb = wordBefore(text, p - 1)
                val isUrlish = Regex("\\.(com|org|net|dk|io|co|app|ai)$", RegexOption.IGNORE_CASE).containsMatchIn("$wb.$ch") || Regex("^(www|http)", RegexOption.IGNORE_CASE).containsMatchIn(wb)
                if (prev == '.' && (ABBREV.contains(wb.trimEnd('.')) || wb.length <= 2 || isUrlish)) return null
                if (prev != '.' || wb.length > 2) return Fix(p, p, " ", "space after $prev")
            }
        }
        // 6. Missing space after closing bracket before a letter
        if (letter.matches(ch.toString()) && prev == ')') return Fix(p, p, " ", "space after )")
        // 7. Missing space before an opening bracket
        if (ch == '(' && prev != null && letterOrDigit.matches(prev.toString())) return Fix(p, p, " ", "space before (")
        // 8. Capital letter after sentence end, or at paragraph start
        if (lower.matches(ch.toString())) {
            val before = text.substring(0, p)
            val m = Regex("([.!?])\\s+$").find(before)
            if (m != null) {
                val wb = wordBefore(before, before.length - m.value.length)
                if (m.groupValues[1] != "." || !(ABBREV.contains(wb) || wb.length <= 1)) return Fix(p, p + 1, ch.uppercase(), "capital after sentence end")
            } else if (before.isBlank() || Regex("\\n\\s*$").containsMatchIn(before)) return Fix(p, p + 1, ch.uppercase(), "capital at paragraph start")
        }
        // 9. Doubled comma or semicolon
        if ((ch == ',' && prev == ',') || (ch == ';' && prev == ';')) return Fix(p, p + 1, "", "double $ch")
        return null
    }
}
