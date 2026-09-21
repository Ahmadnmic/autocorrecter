package com.nmic.autocorrect

/** Word helpers, confusables and the common-typo table, mirroring lib/text.ts of the web app. */
object TextUtil {
    private val wordChar = Regex("[\\p{L}\\p{M}\\p{N}'’\\-]")
    fun isWordChar(c: Char) = wordChar.matches(c.toString())

    data class Span(val start: Int, val end: Int, val word: String)

    fun wordEndingAt(text: String, end: Int): Span? {
        if (end <= 0 || !isWordChar(text[end - 1])) return null
        var s = end
        while (s > 0 && isWordChar(text[s - 1])) s--
        return Span(s, end, text.substring(s, end))
    }

    fun wordsBefore(text: String, index: Int, n: Int): List<Span> {
        val out = ArrayList<Span>()
        var i = index
        while (out.size < n && i > 0) {
            while (i > 0 && !isWordChar(text[i - 1])) i--
            val w = wordEndingAt(text, i) ?: break
            out.add(0, w)
            i = w.start
        }
        return out
    }

    fun shouldSkip(word: String): Boolean {
        if (word.length < 2) return true
        if (Regex("^[\\p{Lu}\\p{N}\\-']+$").matches(word) && Regex("\\p{Lu}").containsMatchIn(word)) return true
        if (Regex("\\p{N}").containsMatchIn(word)) return true
        if (Regex("^(https?:|www\\.|[\\w.-]+@[\\w.-]+)", RegexOption.IGNORE_CASE).containsMatchIn(word)) return true
        if (Regex("[_\\\\/]").containsMatchIn(word)) return true
        return false
    }

    fun transferCase(original: String, replacement: String): String {
        if (original == original.uppercase() && original.any { it.isLetter() } && original.length > 1) return replacement.uppercase()
        val f = original.firstOrNull()
        if (f != null && f.isUpperCase()) return replacement.replaceFirstChar { it.uppercase() }
        return replacement
    }

    fun detectLang(text: String): String {
        val da = setOf("og", "at", "det", "er", "jeg", "ikke", "til", "af", "en", "på", "med", "som", "den", "for", "har", "kan", "vi", "du", "de", "skal", "være", "også", "eller", "men", "hvad", "når", "over", "her", "fra", "meget")
        val en = setOf("the", "and", "is", "are", "to", "of", "in", "it", "that", "was", "for", "on", "with", "as", "this", "have", "be", "not", "you", "we", "they", "but", "or", "what", "when", "from", "very", "there", "will")
        var nd = 0; var ne = 0
        for (w in text.lowercase().split(Regex("[^\\p{L}]+"))) { if (w in da) nd++; if (w in en) ne++ }
        if (Regex("[æøå]", RegexOption.IGNORE_CASE).containsMatchIn(text)) nd += 2
        return if (nd > ne) "da" else "en"
    }

    val confusables: Map<String, Map<String, List<String>>> = mapOf(
        "en" to mapOf(
            "their" to listOf("there", "they're"), "there" to listOf("their", "they're"), "they're" to listOf("their", "there"),
            "its" to listOf("it's"), "it's" to listOf("its"), "then" to listOf("than"), "than" to listOf("then"),
            "to" to listOf("too"), "too" to listOf("to"), "affect" to listOf("effect"), "effect" to listOf("affect"),
            "lose" to listOf("loose"), "loose" to listOf("lose"), "your" to listOf("you're"), "you're" to listOf("your"),
            "whose" to listOf("who's"), "who's" to listOf("whose"), "accept" to listOf("except"), "except" to listOf("accept"),
            "advice" to listOf("advise"), "advise" to listOf("advice"), "weather" to listOf("whether"), "whether" to listOf("weather"),
            "principal" to listOf("principle"), "principle" to listOf("principal"), "were" to listOf("where", "we're"), "where" to listOf("were", "we're"),
            "of" to listOf("off", "have"), "off" to listOf("of"), "quite" to listOf("quiet"), "quiet" to listOf("quite"),
            "passed" to listOf("past"), "past" to listOf("passed"), "piece" to listOf("peace"), "peace" to listOf("piece"),
            "brake" to listOf("break"), "break" to listOf("brake"), "hole" to listOf("whole"), "whole" to listOf("hole"),
            "write" to listOf("right"), "right" to listOf("write"), "weak" to listOf("week"), "week" to listOf("weak")
        ),
        "da" to mapOf(
            "og" to listOf("at"), "at" to listOf("og"), "af" to listOf("ad"), "ad" to listOf("af"), "nogen" to listOf("nogle"), "nogle" to listOf("nogen"),
            "ligge" to listOf("lægge"), "lægge" to listOf("ligge"), "sin" to listOf("hans", "hendes"), "hans" to listOf("sin"), "hendes" to listOf("sin"),
            "ligger" to listOf("lægger"), "lægger" to listOf("ligger"), "hver" to listOf("vær"), "vær" to listOf("hver")
        )
    )

    val commonTypos: Map<String, Map<String, String>> = mapOf(
        "en" to mapOf("teh" to "the", "hte" to "the", "adn" to "and", "taht" to "that", "thier" to "their", "recieve" to "receive", "recieved" to "received",
            "seperate" to "separate", "definately" to "definitely", "occured" to "occurred", "untill" to "until", "wich" to "which", "becuase" to "because",
            "freind" to "friend", "beleive" to "believe", "acheive" to "achieve", "tommorow" to "tomorrow", "truely" to "truly", "wierd" to "weird",
            "goverment" to "government", "enviroment" to "environment", "neccessary" to "necessary", "recomend" to "recommend", "succesful" to "successful",
            "yuo" to "you", "jsut" to "just", "waht" to "what", "wiht" to "with", "thsi" to "this", "dont" to "don't", "doesnt" to "doesn't", "didnt" to "didn't",
            "cant" to "can't", "wont" to "won't", "isnt" to "isn't", "wasnt" to "wasn't", "havent" to "haven't", "im" to "I'm", "ive" to "I've"),
        "da" to mapOf("ogsaa" to "også", "hvordn" to "hvordan", "igår" to "i går", "idag" to "i dag", "imorgen" to "i morgen", "istedet" to "i stedet",
            "intresant" to "interessant", "intressant" to "interessant", "resturant" to "restaurant", "mellom" to "mellem", "virkeligt" to "virkelig")
    )
}
