# Anti-slop ruleset

For writers, and for an inline autocorrect / word-suggestion engine. Compiled 2026-09-21 from the sources listed at the end. Numbered citations in brackets refer to that list.

## What slop is

Slop is prose that reads as the statistical average of everything: it favours the same few hundred "style" words regardless of topic (Kobak et al. found 66% of the 2024 excess words in PubMed abstracts were verbs and 14% adjectives, not content nouns [2]); it uses grammatical constructions at two to five times the human rate (present-participial clauses, nominalizations, "that"-clause subjects [5]); it drops the hedges and discourse markers that mark a person thinking in real time [6][15]; it keeps sentence length and paragraph shape uniform [9]; it opens by praising the question and closes by summarising what it just said [10][11]; and it reaches for stock rhetorical shapes (triads, "not X but Y", em-dash pivots) as defaults rather than choices [1][13]. Any one of these is fine on its own. Slop is the cluster: several of them at once, across a whole document, on any subject. Wikipedia's editors put it plainly: AI text is "regression to the mean", vague and emphatic at the same time [1].

## Rules

Each rule: the rule, why (with source), a bad → good example.

### A. Word choice

1. **Do not use the marker words: delve, underscore, showcase, intricate, meticulous, pivotal, realm, tapestry, testament, landscape, vibrant, crucial, notable, multifaceted, leverage, foster, bolster, garner, navigate (figurative), enhance, robust, seamless, comprehensive, insights, and their inflections.**
   Why: These are the words with the largest measured excess frequency after ChatGPT: "delves" at 28x its expected rate, "underscores" 13.8x, "showcasing" 10.7x in 2024 PubMed abstracts [2]; "realm, intricate, showcasing, pivotal" flat for a decade in arXiv CS then surging in 2023 [3]; "delve, underscore, primarily, meticulous, boast" top the 100 terms with z ≥ 3.5 in 26 million PubMed records [7]; instruction-tuned models use "tapestry", "intricate", "palpable", "amidst", "camaraderie" at 100x the human rate [5]. Readers now flag them on sight [1][13].
   Bad: "This paper delves into the intricate landscape of tenant isolation." → Good: "This paper looks at how tenants are kept apart."

2. **Use the plain verb: "is", "has", "shows", "uses", "helps".**
   Why: Wikipedia documents a 10%+ drop in "is/are" in 2023 academic writing as LLMs swap in "serves as", "stands as", "represents", "boasts", "features" [1]. Orwell called these "verbal false limbs" that "save the trouble of picking out appropriate verbs" [16]. Graham: "The less energy they expend on your prose, the more they'll have left for your ideas" [17].
   Bad: "The library serves as a foundational component that facilitates authentication." → Good: "The library handles login."

3. **Cut the intensifier when the noun already carries the weight: "truly", "incredibly", "deeply", "profoundly", "remarkably", "significantly" (non-statistical), "highly", "very".**
   Why: Puffery and "undue emphasis on significance" are top-listed content tells [1]; Orwell's "pretentious diction" and "meaningless words" [16].
   Bad: "A truly remarkable and deeply significant result." → Good: "The error rate halved."

4. **Prefer a specific noun to a generic one: not "stakeholders", "solutions", "aspects", "elements", "key factors", "various", "numerous", "a range of", "a variety of", "a plethora of", "a myriad of".**
   Why: Vagueness plus emphasis is the defining slop signature [1]; Orwell lists "element", "individual", "objective", "phenomenon" as pretentious filler [16].
   Bad: "Various stakeholders raised a range of concerns." → Good: "Two nurses and the pharmacist said the label was unreadable."

5. **Do not stack nominalizations. Turn "the implementation of", "the utilization of", "the facilitation of" back into verbs.**
   Why: GPT-4o uses nominalizations at 2.1x the human rate (Cohen's d = 1.23) [5]; ChatGPT essays show "more nominalizations" than student essays [6]. The result is "informationally dense, noun-heavy" prose applied to every genre [5].
   Bad: "The optimization of the pipeline resulted in the reduction of latency." → Good: "We tuned the pipeline and latency fell."

6. **Kill the dead metaphor: "navigate the landscape", "unlock the potential", "at the heart of", "a game-changer", "a double-edged sword", "a journey", "a beacon", "a rich tapestry", "shed light on", "pave the way", "in the realm of".**
   Why: Orwell's "dying metaphors" have "lost all evocative power" and are used "because they save people the trouble of inventing phrases" [16]; the same figures top every list of AI clichés [1][13].
   Bad: "This unlocks a new frontier in the ever-evolving landscape of payments." → Good: "Card payments settle in one day instead of three."

7. **Do not "ensure", "foster", "empower", "elevate", "harness", "streamline", "revolutionize", "transform", "align with", "resonate with".**
   Why: All appear on the 291-word excess list for 2024 [2]; Wikipedia groups them under "superficial analysis" that "attaches vague significance" [1]. In Danish the same set is "sikre", "fremme", "styrke", "løfte", "udnytte", "strømline" [18][19].
   Bad: "Fostering a culture of alignment empowers teams." → Good: "Teams that share a weekly plan ship on time more often."

### B. Sentence rhythm

8. **Vary sentence length on purpose. A paragraph with every sentence between 15 and 25 words reads as generated.**
   Why: Detectors measured "burstiness" precisely because human text has higher variance in sentence length and per-sentence surprisal; models "write with a very consistent level of AI-likeness" [9]. Reinhart et al. found LLMs "struggle to match human stylistic variation" across contexts [5].
   Bad: "The deploy failed on Tuesday morning. The team investigated the logs carefully. They found a missing environment variable. The fix was pushed within an hour." → Good: "Tuesday's deploy failed. Logs, an hour of digging, and there it was: one environment variable missing from the new region. Fixed by ten."

9. **Do not default to threes.**
   Why: Triadic constructions appear "unnaturally frequent" in AI text [1]; the Danish review lists "treleddede opremsninger" as a systematic tell [19]. The giveaway is the padded third item.
   Bad: "Fast, reliable, and scalable." → Good: "Fast, and it stays up." (Two is fine. Four is fine. Three is fine when there are three.)

10. **Break up participial tails: "…, ensuring X", "…, highlighting Y", "…, allowing Z".**
    Why: Present-participial clauses are the single strongest grammatical tell, at 2–5x the human rate, GPT-4o at 5.3x (d = 1.38) [5]. "Ensuring", "highlighting", "emphasizing", "showcasing" are the surviving marker words for 2025+ [1].
    Bad: "The cache is warmed at startup, ensuring low latency and highlighting the benefit of the new design." → Good: "The cache is warmed at startup. First requests are fast."

11. **Do not open with a "that"-clause subject or a fronted abstraction.**
    Why: GPT-4o uses "that"-clauses as subjects 2.6x more often than humans [5].
    Bad: "That the model generalises well is evident from the results." → Good: "The model generalises well: see Table 2."

12. **Coordinate with clauses, not only with phrases.** Let a sentence run "we tried X and it broke" rather than always "X and Y".
    Why: GPT-4o shows 1.9x phrasal coordination and avoids clausal coordination [5].
    Bad: "The rollout involved staged deployment and continuous monitoring." → Good: "We rolled it out in stages and watched the dashboards."

### C. Structure

13. **One idea per paragraph, unequal lengths, no fixed template (definition → explanation → hedge → mini-summary).**
    Why: Uniform paragraph shape is the structural counterpart of low burstiness [9]; Wikipedia's "outline-like conclusions" follow a "rigid formula across unrelated topics" [1]; Publico lists "stiv struktur" as tell 3 of 5 [18].
    Bad: three paragraphs of four sentences each, each ending with "This is important because…". → Good: a two-line paragraph, then a long one, then a one-sentence paragraph if that is what the idea needs.

14. **Do not use headings, bullets or numbered lists for something under ~300 words or for anything conversational.**
    Why: Claude's system prompt: "should not use lists in chit chat, in casual conversations, or in empathetic or advice-driven conversations"; in reports "write in prose and paragraphs" [10]. The OpenAI Model Spec warns against excessive markdown, headers and bullets when they do not match the request [11].
    Bad: a reply to "should I take the job?" with three H2s and nine bullets. → Good: two paragraphs.

15. **No signposting of what you are about to do or have just done. Cut "In this article we will explore", "As mentioned above", "Let's dive in", "Now that we've covered X".**
    Why: "Collaborative communication addressing readers" is a listed meta-tell [1]; Publico's Danish opener list is literally "I denne [blogpost/artikel] vil vi udforske…" [18]. The Model Spec asks for content without "padding" or "throat-clearing" [11].
    Bad: "In this section, we will explore the main causes." → Good: "There are two causes."

16. **Do not restate the question, and do not summarise the piece at the end.**
    Why: "In conclusion", "Overall", "To sum up", "Sammenfattende", "Overordnet set", "Samlet set" are listed closers [1][19]; they exist because the model was rewarded for looking complete, not because the reader needs them.
    Bad: "In conclusion, we have seen that caching improves performance in several ways." → Good: end on the last real point, or on the next step.

17. **Put the specific fact where the generic claim was.** Replace "experts argue", "studies show", "many observers", "industry reports" with a name, a number or a link.
    Why: "Vague attributions" imply consensus the sources do not support [1]; Danish version "forskere mener", "iagttagere har bemærket" [19].
    Bad: "Experts agree this approach is widely adopted." → Good: "17.5% of arXiv CS abstracts in Feb 2024 showed LLM modification (Liang et al.)."

### D. Tone and stance

18. **Take a position. Do not hedge every sentence, and do not remove every hedge either. Hedge once, where the doubt actually is.**
    Why: Two opposite failure modes are both documented. Instruction-tuned models strip epistemic markers (ChatGPT essays have "fewer discourse and epistemic markers" [6]; LLM-era engineering abstracts show "decreased hedging" and read "more confident" [15]). At the same time reflexive "may / might / could potentially / generally speaking" scattered across unrelated sections is a separate tell [13]. Humans hedge where they are unsure and commit elsewhere.
    Bad: "This may potentially suggest that the approach could be generally beneficial in many cases." → Good: "It works on the three datasets we tried. We have not tested it on audio."

19. **Do not flatter the reader or the subject.**
    Why: Sycophancy is "consistent across AI assistants" trained on human feedback, because "when a response matches a user's views, it is more likely to be preferred" [12]; Anthropic measured it in 9% of guidance chats, 25% in relationship advice [20]. Claude's prompt forbids opening with "great", "fascinating", "profound" [10]; the Model Spec says "Don't be sycophantic" [11].
    Bad: "Great question! You're absolutely right to think about this." → Good: start with the answer.

20. **Do not sell. No "boasts", "renowned", "groundbreaking", "cutting-edge", "state-of-the-art", "world-class", "nestled", "vibrant", "rich", "diverse array", "commitment to excellence".**
    Why: Wikipedia's "promotional language" cluster [1]; Publico's fifth tell is "business jargon that makes the text stiff and bloated" [18].
    Bad: "Nestled in the heart of a vibrant tech scene, the company boasts a world-class team." → Good: "The company is in Aarhus and has 40 engineers."

21. **No moralising or disclaimer paragraphs ("It's important to note that…", "Remember to consult a professional", "Ethical considerations should be kept in mind").**
    Why: Model Spec: disclaimers "should be genuine responses to actual ambiguity, not reflexive throat-clearing" [11]; Claude's prompt calls unrequested explanation "preachy and annoying" [10]. "Det er vigtigt at bemærke" / "Det er værd at notere" are the Danish markers [19].
    Bad: "It's important to note that results may vary and you should consult an expert." → Good: delete, or state the actual limit: "Tested on Postgres 15 only."

22. **Write in the register the piece lives in. Contractions, first person, a joke, an aside, a sentence fragment: these are evidence of a person.**
    Why: Base models match human feature frequencies far better than instruction-tuned ones; the tuning process itself pushes prose toward one formal register [5]. Publico's fourth tell is "lack of concrete examples and personal experience" [18].
    Bad: "One might observe that the deployment process is not without its challenges." → Good: "Deploys are a pain. Here's why."

### E. Openers and closers

23. **No praise opener, no "certainly", no "absolutely", no "of course", no "I'd be happy to".**
    Why: [10][11][12] as in rule 19.
    Bad: "Certainly! Here's a comprehensive overview." → Good: "Three things matter here."

24. **No scene-setting opener: "In today's fast-paced world", "In an era of", "In the ever-evolving landscape of", "Have you ever wondered", "Picture this", "Imagine a world where", "With the rapid development of".**
    Why: These are the most parodied openers on every list [1][13]; Publico gives the Danish set verbatim: "I nutidens [adjektiv] verden/landskab…", "Lad os dykke ned i…", "Med teknologiens hastige udvikling…", "Har du nogensinde…" [18].
    Bad: "In today's fast-paced digital landscape, security is more crucial than ever." → Good: "Last month someone logged into our admin panel with the default password."

25. **No closing offer, wish or summary: "I hope this helps", "Let me know if you have any questions", "Happy coding!", "Feel free to reach out", "Stay tuned", "The future looks bright", "Ultimately, …", "At the end of the day".**
    Why: [1][11]; these are trained-in chat sign-offs leaking into documents. "I sidste ende", "alt i alt" in Danish [19].
    Bad: "I hope this helps! Feel free to ask if anything is unclear." → Good: stop.

26. **Do not end a paragraph with a rhetorical question or a one-line "punch" ("And that changes everything.", "The result? Pure magic.").**
    Why: Fragment-as-drama and the question-then-answer template are on the stylistic tell lists [1][13]. A fragment used once, by a person, for effect, is fine; a fragment closing every paragraph is a template.
    Bad: "The result? A 40% speedup. Game-changing." → Good: "It ran 40% faster."

### F. Formatting

27. **Bold at most a handful of phrases per page, and only things a scanner needs to find (a warning, a name, a number). Never bold the first words of each bullet.**
    Why: "Excessive boldface" and "inline-header vertical lists" are listed style tells [1]; Claude's prompt requires bullets, where used, to be "at least 1–2 sentences long", not headline fragments [10].
    Bad: "**Scalability:** The system scales. **Reliability:** The system is reliable." → Good: "It scales to about 2,000 requests a second before the queue backs up."

28. **No emoji as bullets, section markers or decoration in prose.**
    Why: "Emoji as formatting elements" is a listed tell [1].
    Bad: "🚀 Performance  ✅ Reliability  🔒 Security" → Good: plain words.

29. **No heading that just repeats the title; no heading levels skipped; no section consisting only of subsections; no "Conclusion" or "Key takeaways" heading for a short piece.**
    Why: All four are enumerated in [1].

30. **Match length to the question. A one-line question gets a short answer.**
    Why: Claude's prompt: "concise responses to very simple questions, thorough responses to complex and open-ended questions" [10]; Model Spec: "thorough but efficient" [11].

### G. Punctuation

31. **Em dashes: use them, but not as the default joint of every sentence, and never the "setup — punchline" pivot twice on a page.**
    Why: The em dash itself is human ("the most human punctuation mark there is", Washington Post [14]); the tell is frequency and function. Wikipedia lists "overuse of em dashes" [1]; the Danish review lists "systematic em-dash usage as dramatic pauses" [19]; LLM-era engineering abstracts show more "segmenting punctuation" and "greater comma usage" [15]. A writer who has used dashes for years should keep doing so.
    Bad: "It's fast — really fast — and that's the point — speed." → Good: "It's fast. That's the point."

32. **Do not build the "It's not X, it's Y" / "not just X but Y" contrast unless there is a real misconception to correct.**
    Why: "Negative parallelisms" are a named tell: they read "as retroactively challenging misconceptions" nobody held [1]; "ikke kun… men også" in Danish [19].
    Bad: "This isn't just a library, it's a philosophy." → Good: "It's a library. It's small on purpose."

33. **Colons for a list or an explanation, not as a rhythm device ("The answer: yes.", "The catch: …") in every paragraph.**
    Why: Same mechanism as rules 26 and 31: a device becomes a tell when it is the default rather than a choice [1][9].

34. **Straight quotes and apostrophes in code, markdown and plain-text contexts; typographic ones only where the house style asks for them.**
    Why: "Curly quotation marks/apostrophes" pasted into wikitext are a listed artifact [1]. An autocorrect engine must not convert one to the other without being asked.

35. **Oxford comma, serial semicolons, exclamation marks: follow the writer's existing habit in the document. Do not normalise.**
    Why: Consistency within a document is a human trait; "pronounced style shifts within articles" are themselves a tell [1].

## Rules for a word-suggestion engine

The engine sits between a person and their text. Its errors are asymmetric: a missed suggestion costs nothing, a wrong suggestion makes the person sound like a machine. So:

### Never suggest these as replacements

Never offer, as a synonym, completion or "improvement", any word or phrase in `anti-slop.json` → `never_suggest` (English) or `never_suggest_da` (Danish). In particular:

- Marker verbs: delve, underscore, showcase, leverage, foster, bolster, garner, harness, navigate, streamline, elevate, empower, unlock, unveil, revolutionize, transform, facilitate, utilize, ensure, enhance, optimize, spearhead.
- Marker adjectives: intricate, meticulous, pivotal, crucial, vital, robust, seamless, comprehensive, multifaceted, nuanced, vibrant, notable, noteworthy, groundbreaking, cutting-edge, transformative, invaluable, unparalleled, holistic, dynamic, innovative.
- Marker nouns: tapestry, testament, landscape, realm, journey, beacon, cornerstone, synergy, paradigm, insights, stakeholders, plethora, myriad.
- Connectives: additionally, furthermore, moreover, notably, importantly, consequently, thus (as a swap for "so"), in order to (as a swap for "to").
- Copula avoiders: serves as, stands as, functions as, represents, boasts, features (verb), plays a role in, marks.
- Openers and closers: any entry in `suspect_patterns`.

The engine may still autocomplete a word the writer has already typed most of ("delv" → "delve"), because the writer chose it. It must not propose it unprompted, and it must not rank it above the plain word.

### Never "fix" these human features

- **Sentence fragments used for effect.** "Not great." "Which was the point." Do not merge them into the previous sentence or add a subject.
- **Contractions.** "don't", "it's", "we've", "can't". Never expand. Never contract either: the writer's mix is theirs.
- **Informal register.** "kinda", "a bunch of", "way better", "stuff", "OK", "yeah". Do not upgrade to "somewhat", "numerous", "significantly better", "material".
- **Repetition for emphasis.** "It was slow. Slow to start, slow to run, slow to stop." Do not suggest synonyms to "avoid repetition"; elegant variation is the machine habit, not the human one (Herbold: ChatGPT shows *greater* lexical diversity than students [6]).
- **Regional and variant spellings.** colour/color, organise/organize, grey/gray, programme/program, "aluminium"; Danish old and new spellings, "resurse"/"ressource", "majonæse"/"mayonnaise". Detect the document's variety from its first uses and follow it; never flip to the other.
- **Profanity and strong language.** Do not soften, mask or replace. "This is a fucking mess" is a complete, intentional sentence.
- **Dialect, slang and code-switching.** Scots, AAVE, Hiberno-English, Jutlandic forms, Danish sentences with English loanwords ("det er nice", "vi skal deploye"). Not errors.
- **Hedges where the writer put them.** "I think", "probably", "as far as I can tell", "jeg tror". Do not delete to make the text "more confident"; LLM-era text is already measurably over-confident [15].
- **First person and direct address.** "I", "we", "you". Do not passivise or third-person.
- **Sentence-initial "And", "But", "So", "Because".** Standard in edited English for a century; do not flag.
- **Short paragraphs, one-sentence paragraphs, uneven paragraphs.**
- **Punctuation habits.** A writer's em dashes, semicolons, Oxford commas, exclamation marks, ellipses, spaced dashes, straight vs curly quotes: match what the document already does. Never mass-convert.
- **Deliberate lowercase, brand casing, ALL CAPS for a shouted word.**
- **Unconventional but consistent formatting.** No headings, no lists, no bold. Absence of structure is not a defect.
- **Numbers written the way the writer wrote them.** "three" vs "3", "40%" vs "forty percent".
- **Names, quotes and citations.** Never touch text inside quotation marks or code spans.

### What the engine may do

- Correct genuine misspellings against the detected language variety.
- Complete a word the writer has started, ranked by the writer's own prior usage, then by corpus frequency, with `never_suggest` entries demoted below any plain alternative.
- Flag (not auto-replace) a `suspect_patterns` hit with a one-word note such as "cliché" and offer nothing, or offer only the plain alternative from this document's examples.
- Show a density warning when more than one marker word per 100 words, or more than one triad or "not X but Y" per 300 words, appears. The Wikipedia guidance is explicit that density is the evidence, not any single hit [1].

## Sources

1. Wikipedia, "Signs of AI writing" (WP:AISIGNS). https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
2. Kobak, González-Márquez, Horvát, Lause, "Delving into ChatGPT usage in academic writing through excess vocabulary", arXiv 2406.07016 (Science Advances 2025). https://arxiv.org/abs/2406.07016 (full text: https://arxiv.org/html/2406.07016)
3. Liang et al., "Mapping the Increasing Use of LLMs in Scientific Papers", arXiv 2404.01268. https://arxiv.org/abs/2404.01268
4. Juzek & Ward, "Why does ChatGPT 'delve' so much? Exploring the sources of lexical overrepresentation in Large Language Models", arXiv 2412.11385 (COLING 2025). https://arxiv.org/abs/2412.11385
5. Reinhart, Markey, Laudenbach, Pantusen, Yurko, Weinberg, Brown, "Do LLMs write like humans? Variation in grammatical and rhetorical styles", arXiv 2410.16107 (PNAS 2025). https://arxiv.org/html/2410.16107
6. Herbold, Hautli-Janisz, Heuer, Kikteva, Trautsch, "A large-scale comparison of human-written versus ChatGPT-generated essays", Scientific Reports 13:18617 (2023); arXiv 2304.14276. https://arxiv.org/abs/2304.14276
7. Matsui, "Delving Into PubMed Records: How AI-Influenced Vocabulary has Transformed Medical Writing since ChatGPT", Perspectives on Medical Education 14(1) 2025; medRxiv 2024.05.14.24307373. https://www.medrxiv.org/content/10.1101/2024.05.14.24307373v4
8. Yakura, Lopez-Lopez, Brinkmann, Serna, Gupta, Rahwan (Max Planck Institute for Human Development), spoken-language spillover of "GPT words", reported in Scientific American, "ChatGPT Is Changing the Words We Use in Conversation". https://www.scientificamerican.com/article/chatgpt-is-changing-the-words-we-use-in-conversation/
9. GPTZero, "What is perplexity & burstiness for AI detection?" (note: GPTZero stopped using these metrics in autumn 2023; the definitions remain the standard explanation of sentence-length variance). https://gptzero.me/news/perplexity-and-burstiness-what-is-it/
10. Anthropic, Claude 4 system prompt, as quoted by Simon Willison, "Highlights from the Claude 4 system prompt" (May 2025). https://simonwillison.net/2025/May/25/claude-4-system-prompt/
11. OpenAI, Model Spec (2025-12-18): "Don't be sycophantic", "Be clear and direct", "Use appropriate style". https://model-spec.openai.com/2025-12-18.html
12. Sharma et al. (Anthropic), "Towards Understanding Sycophancy in Language Models", arXiv 2310.13548 (ICLR 2024). https://arxiv.org/abs/2310.13548
13. The Conversation, "Too many em dashes? Weird words like 'delves'? Spotting text written by ChatGPT is still more art than science" (2025). https://theconversation.com/too-many-em-dashes-weird-words-like-delves-spotting-text-written-by-chatgpt-is-still-more-art-than-science-259629
14. Washington Post, "Some people think AI writing has a tell — the em dash. Writers disagree." (April 2025). https://www.washingtonpost.com/technology/2025/04/09/ai-em-dash-writing-punctuation-chatgpt/
15. "Have Large Language Models Enhanced the Way Civil & Environmental Engineers Write? A Quantitative Analysis of Scholarly Communication over 25 Years", arXiv 2602.03864 (2026). https://arxiv.org/abs/2602.03864
16. Orwell, "Politics and the English Language" (1946). https://www.orwellfoundation.com/the-orwell-foundation/orwell/essays-and-other-works/politics-and-the-english-language/
17. Paul Graham, "Write Simply" (2021). https://www.paulgraham.com/simply.html
18. Publico, "5 sladrehanke, der afslører, at ChatGPT har skrevet din tekst" (Danish). https://publico.dk/publico-bloggen/5-sladrehanke-der-afsloerer-at-chatgpt-har-skrevet-din-tekst
19. Copenhagen Review of Communication, "Snif snif det lugter af AI: Hvordan sniffer du egentlig om en tekst er skrevet af AI?" (Danish). https://www.copenhagen-review-of-communication.com/snif-snif-det-lugter-af-ai-hvordan-sniffer-du-egentlig-om-en-tekst-er-skrevet-af-ai/
20. Anthropic, "How people ask Claude for personal guidance" (2026; sycophancy in 9% of guidance chats, 25% of relationship chats). https://www.anthropic.com/research/claude-personal-guidance

Sources searched but not fetched in full (used only for confirmation): Originality.ai and SlopDetector word lists; The Ringer and ACU Optimist on em dashes; Gonzaga LibGuide on AI detectors.
