# Research & Requirements — DSA Game

**Status:** research only. No production code was changed to produce this document.
**Date:** 2026-09-28
**Scope:** (a) what already exists in this category, (b) what the learning science
actually supports, (c) what is wrong with *this* codebase today, verified by running it,
(d) prioritised requirements.

---

## 0. How to read this

Three kinds of claim appear below and they are labelled:

| Tag | Meaning |
|---|---|
| ✅ **VERIFIED** | I ran it, or fetched the source and read it. |
| 📄 **CITED** | From a peer-reviewed paper, a published product page, or a primary source I fetched. |
| 📰 **ANECDOTAL** | Reddit / HN / forum. Directional only. |
| 🧠 **INFERENCE** | My reasoning, not a source claim. |

A separate section (**§4**) is entirely first-hand: defects I reproduced against your own
running stack. That section is the highest-value part of this document and needs no
external source.

---

## 1. Executive summary

**Your architecture is ahead of the field and validated by the strongest recent evidence
in the space.** The decision to make a deterministic oracle own correctness and confine the
LLM to text slots is not a stylistic preference — it is the specific design that the best
2025 evidence says is necessary. See §5.1 (Bastani et al., *PNAS* 2025): students given an
unguarded GPT tutor scored **17% worse** than a no-AI control on an unassisted exam, and
the harm was "essentially eradicated" by guardrails that make the model give *hints instead
of answers*. Your `services/api/src/coach/guardrails.ts` is exactly that guardrail,
implemented as a 610-line validator over generated text rather than as a prompt
instruction, with the comment *"A prompt rule is a suggestion; a validator is a
guarantee."* That is a better piece of engineering than most published systems have.

**The problem is not the idea. It is that the idea is not finished, and the parts that are
unfinished are the parts that produce learning.** Specifically:

1. **The product has no memory.** No accounts, no persistence, no progress, no spaced
   repetition, no recall. A learner who plays six games gains nothing on the seventh. For a
   product whose entire thesis is *"learn it and remember it,"* this is the single largest
   structural gap. (§4.1, §6 R1)
2. **The hint ladder has a spoiler hole the coach does not.** Your hardest-engineered
   component protects the *chat*; the far easier-to-reach *hint* path has no validator at
   all, and in the template tier it hands the player the canonical algorithm verbatim, in
   raw `lo=0, hi=n-1` notation, one line per request. (§4.2 — this is a shipped spoiler)
3. **The debrief tells; it does not ask.** Retrieval practice is the strongest single
   learning lever in the literature (Roediger & Karpicke 2006: 61% vs 40% after one week).
   Your debrief is a re-read. It needs to be a re-ask. (§5.2)
4. **A perfect run is reported as a mistake.** Verified live: 0 mistakes, all 10 moves
   correct, score 98/100, and the debrief says *"the mistake compounded from here."* (§4.3)
5. **One oracle out of eleven.** Without an oracle a problem has no definition of correct,
   so the game cannot be played honestly — as your own README says. 10 of 11 catalogue
   entries are clickable and unplayable. (§4.4)

**The competitive window is real but closing.** 🧠 Visualgo (the incumbent DSA-visualisation
authority) has publicly signalled *"the focus for 2026 expansion project is to explore new
Information Visualization techniques, perhaps AI-assisted."* They have the oracle + quiz
system, 13 years of 2,000 sessions/day, and Optiver funding. Your defensible moat is
**not** the oracle, the visualizer, or the theme — it is the *generation-gated play loop*
(no competitor lets you make the algorithm's own decisions) plus the *research-grounded
debrief*. Both are cheap to build and expensive to copy.

---

## 2. What already exists

### 2.1 The direct competitors

📄 Sources fetched or scraped; LeetCode returns HTTP 403 to fetch, so LeetCode claims are
search-snippet only.

**Visualgo (Steven Halim, NUS)** — `visualgo.net`. The design benchmark. Verified: it has an
**e-Lecture mode** (slide deck interleaved with a live, controllable animation panel — text
and visual share the screen) and an **Exploration mode** (free sandbox, `Esc`). It has a
**codetrace panel** showing the source line for the current animation frame, behind a
disclosure arrow. It has **server-side auto-graded quizzes** with a "Discussion: Why?"
follow-up whose answer lives on a hidden next slide. It explicitly invites you to **run a
wrong algorithm and watch it fail** ("Try ModifiedDijkstra(0) on the extreme corner case…
that is very hard to derive without proper understanding"). It ships **worst-case
generators** (unbalanced / skewed BST) to make `O(N)` height felt. It uses an **N-slider**
so you can feel the difference between `log N = 20` and `N = 1,048,576`. It has accounts
and per-module quiz tracking, and gates course credit on passing its own quizzes.

*Two named competitors deserve a full read before you build:*

- **AlgoMotion** (`algomotion.site`) — the closest thing to your brief, and free. Verbatim:
  *"Stop memorizing. Start thinking."* Three beats per problem (*read the constraint →
  predict the move → build the muscle*), a 5-stage Socratic flow, 4 modes (Play / Tactics /
  Foundations / Quiz), XP + combos + streaks, pattern families (Sequence Scanners, Two
  Pointers, Logarithmic Dividers, Graph Explorers, State Space Traversers). Progress saved
  on-device, no account. 98 Blind-75 + 123 NeetCode quests.
- **codedive.in** — 243+ LeetCode problems with **line-by-line stepping**, a variable
  inspector, draw-and-annotate, "test yourself", `⌘K` palette. Solo indie, Product Hunt
  Apr 2026.

**Others:** Algorithm Visualizer (48.7k GitHub stars; `tracers.*` libraries injected into
*your actual code* so the code panel and animation stay in sync — the closest architectural
precedent to "the game moves are a real execution trace"). David Galles' USFCA set (~55
visualizations, BSD, forkable, preferred by instructors over prettier tools, runs on a
Kindle). USACO Guide (curation + mastery ladder + a "Skipped" state). CSES (400 problems,
instructor progress tracking). LeetCode (4,250+ problems, **Study Plan** with daily unlock
and *"repeat at least 3 times… this is learning tip called spaced repetition"*). CMU CS
Academy (auto-graded graphics — a deterministic oracle over a visual state, shipping in
6,000 classrooms). AlgoMaster.io (1,000+ interactive animations, 100k IG followers in
2 months). DSA Animator, LeetCodeVisual, labuladong Algorithm Visualize, TraceLit,
dsaquest.com, dsa-visualizer.

### 2.2 The gap you occupy

🧠 Nobody has shipped: **deterministic oracle + every-move-is-an-operation play + LLM
narrative layer + replayable debrief + mastery model.**

| Product | Oracle | You make the moves | Replay of *your* run | LLM narrative | Mastery model |
|---|---|---|---|---|---|
| Visualgo | ✅ quizzes | ❌ you watch | ❌ | ❌ | ⚠️ own quizzes only |
| AlgoMotion | ❌ | ⚠️ Socratic quizzes | ❌ | ❌ | ⚠️ streaks |
| Algorithm Visualizer | ✅ (runs your code) | ❌ | ⚠️ | ❌ | ❌ |
| codedive | ❌ | ❌ | ⚠️ step-through | ❌ | ❌ |
| **This project** | ✅ | ✅ | ✅ | ✅ | ❌ **← the hole** |

**The column that is empty in your table is the one that produces retention.**

### 2.3 What users say is wrong with these tools

📰📄 From Hacker News on Visualgo specifically, and it is consistent:

- *"I don't understand how to use this site. There is no movement or voice or what to do
  next after I go to a page."* (2025, 252 pts)
- *"Searching for a value in an array didn't work, and then the hash table visualisation
  makes no sense to me at all."*
- A lecturer prefers Galles' plainer set because *"not as pretty but in my experience
  students pick up ideas from these faster."*
- 2017: *"the controls are not intended for touch devices"*; *"It also likes to remind people
  to log for each modal that shows up. This is a quick turn off."*

🧠 **Nobody in any of these complaints says the pedagogy is wrong.** They say three things:
**orientation** (what do I do next), **controllability** (the scrubber doesn't work), and
**mobile** (rotate your device). All three are cheap. Note that your `PlayView` already
solves orientation better than the incumbent — `YourTurnIndicator` puts one imperative
sentence at the top at the largest type size on the page, and its comment block explains
why. Do not regress it.

⚠️ Visualgo **does not permit forks or variants**, and its quiz system is server-side and
explicitly not portable ("not easy to save server-side scripts and databases locally"). So
there is no legal/design path to lift it. Also beware: `visualgo.org` is a **different site**
with SEO-farm copy. Do not cite it.

---

## 3. Learning science that applies

### 3.1 The generation effect is your product thesis

📄 **Slamecka & Graf (1978)**, *JEP:HLM* 4(6):592–604. Generate > read, robustly, across
five encoding rules, timed and self-paced, cued and uncued.

Two boundary conditions decide your design:
- 📄 **The effect survives failing to generate correctly** (Hirschman & Bjork 1988): *"the
  memorial advantage of generating accrues even when one fails to generate the word."*
  🧠 **A wrong move in your game is free retrieval practice. Never punish it hard — show
  the counterfactual and let them move again.** Your `MoveFeedback` already does this well
  (`"Mistakes here are how the pattern shows up."`, never dims the board). Keep it.
- 📄 It **disappears when the generated item is anomalous**, and when the generate condition
  also does a semantic-adequacy check. 🧠 Generating *in the theme's vocabulary* (a
  "capsule", a "vault") is anomalous; generating *in the algorithm's vocabulary* is not.
  This is an argument for the debrief's "crib sheet" table, and an argument against letting
  the theme fully displace the algorithm's terms.

### 3.2 Retrieval practice, and the caveat that matters for you

- 📄 **Roediger & Karpicke (2006)**: recall practice → **61%** retained after one week;
  repeated reading → **40%**.
- 📄 **Roediger & Butler (2011)**: retrieval practice works *"even without feedback."*
- 📄 **Karpicke & Roediger (2007)**: *"equally spaced retrieval enhances long-term
  retention"* — the active ingredient is *delaying* the first retrieval, not maximising
  spacing.
- 📄 **Roediger et al. (2009) / Kang et al. (2007)**: **absence of feedback can be
  detrimental**, especially in **multiple-choice** formats — it increases false recognition.
  🧠 **Do not build your debrief quiz as multiple choice.**
- ⚠️ **Murray, Horner & Göbel (2025)**, *Educ Psychol Rev* 37:75: in **mathematics**
  specifically, spaced vs massed gave only **g = 0.28**, and **testing vs restudy was
  g = 0.18 with a 95% CI crossing zero** — *"suggesting the testing effect is not robust"*
  in that domain.
  🧠 **Be honest about this in your own product metrics.** You are building for
  algorithm-learning, which is closer to mathematics than to vocabulary. Do not promise
  60%-vs-40% retention numbers to yourself. Instrument the outcome (§7) rather than
  assuming it.

### 3.3 Spacing: use FSRS or Half-Life Regression, over sub-skills

- ✅ **Anki 23.10+ ships both SM-2 and FSRS.** Anki's own FAQ documents the classic SM-2
  pathology: *"repeated failings of a card cause the card to get stuck in 'low interval
  hell'."*
- 📄 On a **1.7B-review benchmark**, **FSRS-5 log-loss 0.4565** vs the SM-2 trainable
  baseline, winning in **97.4%** of cases; FSRS-6 showed **83.3% superiority** on a
  19-collection head-to-head. Widely-cited synthesis: **20–30% fewer reviews for equal
  retention** (a product doc, not peer-reviewed — treat as directional).
- 📄 **Duolingo Half-Life Regression** (Settles & Meeder, ACL 2016): `p̂ = 2^(−Δ/h)`,
  `ĥ = 2^(Θ·x)`, trained on **13M student-word traces**, **+12% daily engagement**, 45%+
  error reduction vs baselines. Code and data open-sourced.
  ⚠️ **The +12% is engagement, not learning.** This paper is routinely mis-cited as
  "Duolingo has 300M users, therefore gamification works." Neither claim follows.
- 📄 **PNAS 2019 (MEMORIZE)**: the **inverted-U** — reviewing an item still in short-term
  memory does not improve long-term retention.

🧠 **The scheduling unit for you should be the *sub-skill*, not the algorithm.** "Choose a
half" and "update `hi = mid`" are different memory traces inside the same algorithm. Your
`telemetry.ts` already computes `mistakeSummary().byDsaOp` and `.byMechanic` — that is
almost exactly the sub-skill vector, and it is already instrumented but unused for
scheduling. FSRS over `byDsaOp` buckets is a defensible, differentiated design with almost
no new data collection required.

### 3.4 Desirable difficulties, and the line where they turn harmful

📄 **Bjork & Linn (2006)**, verbatim: *"Conditions of practice that appear optimal during
instruction can fail to support long-term retention and transfer… conditions that introduce
difficulties for the learner — and appear to slow the rate of the learning — can enhance
long-term retention and transfer."* The list: spacing, **interleaving**, varying
presentation, **reducing or making feedback intermittent**, **using tests as learning
events**.

⚠️ The mandatory caveat, verbatim: *"If, however, the learner does not have the background
knowledge or skills to respond to them successfully, they become undesirable difficulties."*
And: *"the level of difficulty that is optimal… will vary with the degree of a learner's
prior learning."*

📄 Same paper, domain warning relevant to you: on narrative/cumulative materials
*"interleaving and spacing having a mixture of positive and negative effects: Such
manipulations can enhance retention, but sometimes impede the induction of principles and
generalizations."*

📄 **Rohrer & Hartwig (2020)**, cited in Bjork & Bjork 2020: *"Too often, the classroom is
where promising interventions go to die"* — learners resist because it feels worse, and
because **massing creates an "illusion of mastery" that is difficult to overcome.**

🧠 So: `easy` should be a **single uninterrupted run** (massed, so the learner gets the
illusion of mastery and builds fluency). `hard` should be **interleaved with a different
problem** and should have **thinner, intermittent feedback**. Currently `difficulty` only
controls array length and wrong-answer slack.

### 3.5 Worked examples → fading → completion problems. You already have frame 1.

📄 **Renkl, Atkinson, Maier & Staley (2002)**; **Renkl, Atkinson & Grosse (2004)**: the key
mechanism finding is *"individuals learned most about those principles that were faded"*, and
fading is associated with **fewer unproductive learning events**, not more
self-explanations.

📄 **Atkinson, Renkl & Merrill (2003)**, *JEP* 95(4):774–783 — 🔥 **the single most
actionable paper for your debrief**: fading alone reliably helps **near-transfer but not
far-transfer**. Adding **self-explanation prompts that ask the learner to identify the
underlying principle** produces **medium-to-large effects on both near and far transfer, at
no extra time on task**.

📄 **Expertise reversal**: *"once learners had ample experience in the domain, learning by
solving problems was superior to studying examples."*

🧠 **Your `WatchOneStep` is the worked example. It is a genuinely good implementation and
almost nobody in this category has it.** The learning curve you should be building:

| Frame | Who acts | Mechanism |
|---|---|---|
| 1. Watch one step done, reason read aloud | engine | worked example (you have it) |
| 2. You choose the half; the next compare is shown for you | learner, partial | **fading** |
| 3. You choose the half *and* state the constraint that justifies it | learner | **completion problem** + self-explanation |
| 4. Full play, but interleaved with a *different* problem's board | learner | interleaving |
| 5. Recall mode: no board, regenerate the algorithm from the problem statement | learner | **retrieval practice** ← does not exist |

**Frame 3 is where the far-transfer gain is, and you do not have it.** Frame 5 is where
retention is, and you do not have it.

### 3.6 Cognitive load: the redundancy effect will bite your debrief

- 📄 **Split-attention effect** (Chandler & Sweller 1991/92; Mayer & Moreno 1998;
  Ayres & Sweller 2005): a diagram and its explanation separated in space forces the
  learner to mentally integrate them. **Fix: put the label on the node.**
  🟢 Your `SlotCell` already draws `lo`/`mid`/`hi` as brackets around a range *on the
  board*, not as a chip row elsewhere. This is already right — do not regress it.
- 📄 **Redundancy effect** (Mayer, Heiser & Lonn 2001; Kalyuga, Chandler & Sweller 1999;
  Mayer & Johnson 2008): adding on-screen text identical to narration **harms** learning by
  splitting the visual channel. 📄 **Albers (2023)**, *Brit J Educ Psychol*: significant
  effects for content redundancy (η² = .259) and modal redundancy (η² = .326) on learning
  and (η² = .398) on cognitive load, **with no interaction** — redundancy is not free.
  🧠 **"Code panel + animation panel + narration" all visible at once can be worse than
  animation alone.** Visualgo solves this by putting the codetrace panel behind a
  disclosure arrow. Your `CodePanel` is currently a **permanent** panel. ⚠️ This is a real
  risk in your debrief.
- 📄 **Expertise reversal** (Kalyuga et al. 1998/2000/2003): *"detailed textual
  explanations… may be essential for novices but redundant for experts."*
  🧠 **Your LLM theme layer must be length-adaptive.** A theme that writes three paragraphs
  of flavour text is a redundancy violation for experts and a distraction for novices.

### 3.7 The uncomfortable one: gamification is the weak tier, and your theme is the strong one

📄 **Sailer & Homner (2020)**, *Educ Psychol Rev* 32(1):77–112 — the canonical citation:

| Outcome | g | Stable? |
|---|---|---|
| cognitive | **0.49** (CI .30–.69, k=19, N=1686) | ✅ stable in high-rigor subsplit |
| motivational | 0.36 (k=16, N=2246) | ❌ **not stable** |
| behavioral | 0.25 (k=9, N=951) | ❌ **not stable** |

**Moderators: inclusion of game *fiction* and social interaction were significant
moderators of *behavioral* outcomes.** Competition + collaboration was particularly effective.

📄 **Wouters, van Nimwegen, van Oostendorp & van der Spek (2013)**, *JEP* 105(2): serious
games beat conventional instruction on **learning (d = 0.29)** and **retention (d = 0.36)**
but were **not more motivating (d = 0.26, p > .05)**. Better when **supplemented with other
instruction**, with **multiple sessions**, and in **groups**.

📄 **Zhonggen (2019)**: serious games win, but *"the nature of serious games negatively
influenced the relationship between mental workload and learning effect"* and *"some serious
games aggravated the mental workload and decreased the learning effectiveness."*

🧠 **The synthesis you should design to: XP / badges / streaks are the weakest tier.
Game *fiction* — which is precisely what your LLM layer produces — is a significant
moderator.** And Wouters' "better when supplemented with other instruction" maps exactly
onto your architecture: **the game is the practice, the debrief is the instruction.**

> **Therefore: do not build a better game. Build a better debrief, and let the game be the
> retrieval-practice engine you already have.** AlgoMotion's entire differentiation is
> XP/combos/streaks — the layer the evidence says is weakest.

### 3.8 Why people say they "can't remember algorithms" — and why you are the highest-risk product in the category

📄 **Rozenblit & Keil (2002)**, *Cognitive Science* 26(5):521–562 — the **illusion of
explanatory depth**, 12 studies. Three findings that are directly about your product:

- People feel they understand complex phenomena with far greater precision, coherence and
  depth than they do — and **the illusion is much stronger for explanatory/theory-like
  knowledge than for facts, procedures, or narratives.**
- 🔥 **"The illusion for explanatory knowledge is most robust where the environment
  supports real-time explanations with visible mechanisms."**
  🧠 **That is literally your product: a real-time, mechanistic, interactive
  visualization. By Rozenblit & Keil, you are the maximum-risk environment in education for
  manufacturing a false sense of understanding.** Every visualizer on the internet is an
  IOED machine.
- People are miscalibrated **because they rarely produce explanations**, so they lack
  feedback on their own success rate — and **asking people to generate an explanation
  collapses their self-rating to reality.**

🧠 **The mitigation is structural and you already have the mechanism: you must require the
user to produce the move before you show anything.** The competitors that animate the
algorithm *at* you are the ones manufacturing false mastery. Your generation-gated loop is
the single highest-leverage design decision in this project. Protect it. Everything in §6
that would show an answer before a commitment must be evaluated against it.

Corroborating, 📰📄: HN *"I have no intuitive understanding or mental model of the
algorithm. I could follow the instructions if they're written in front of me but I have
never…"*; r/learnprogramming *"I can understand the basic algorithms and how they work, but
I find it difficult to actually implement them in code."*

### 3.9 Hints: the richest transferable literature, and your weakest link

📄 **Aleven & Koedinger (2001)**, "Investigations into Help Seeking and Learning with a
Cognitive Tutor":
- 5–8 hint levels, each more specific.
- **On 81% of steps where students asked for help, they requested *all* levels including
  the bottom-out.**
- **Students spent ≤1 second on as much as 68% of intermediate hints.**
- Fixes: tutor *volunteers* help after >2 errors on a step (*"those who need help the most
  are least likely to get it in time"*); **2-second delay before each hint level** to break
  the click-through habit.

📄 **Roll, Baker, Aleven & Koedinger (2014)**: 🔥 **"hints are beneficial for local
within-tutor learning when students have a *medium* level of skill. When students have a
*low or high* level of skill, attempts at solving (without help) are more effective."**

📄 **Aleven et al. (2016)**, "Help helps, but only so much": *"the raw frequency of help use
correlated negatively with learning, [but] the **time per hint level correlated positively**."*
And: *"self-explanation prompts should replace tutor hints (except the bottom-out)."*

📄 **Goldin, Roll, Rader & Koedinger (2012)**: only **level-1 and level-2 hint-processing
proficiencies correlated with each other** — a learner who can use a light hint is not
necessarily a learner who can use a heavy hint. **Measure them separately.**

📄 **LAK 2026**, "Revisiting the Hint Button": consistent *negative* associations between
unproductive hint use and learning outcomes; frames it as **shallow cognitive processing**.

**The assembled spec you should hold your hint ladder to:**

1. **Three levels, not eight.** L1 = *principle* ("what property of a sorted array are you
   exploiting?"). L2 = *specific constraint* ("mid > target, so `hi = mid`, not `mid−1` —
   and why"). L3 = *the move*.
2. **2-second delay between levels** (Aleven & Koedinger 2001).
3. **Auto-offer L1 after 2 consecutive wrong moves** — but **gate on medium skill only**
   (Roll et al. 2014). For a struggling learner, make them struggle.
4. **Score mastery on time-per-level, not levels-requested** (Aleven et al. 2016).
5. **Never end on L3 without a follow-up self-explanation prompt** (Aleven et al. 2016).
6. **Every hint passes a spoiler validator before it is shown.** ← you do not have this
   (§4.2).

### 3.10 Adaptive difficulty: Elo, not BKT

📄 **Elo vs Bayesian-Elo vs hierarchical vs multivariate Elo** (EDM paper,
`files.eric.ed.gov/fulltext/ED560514.pdf`): *"the extensions do bring an improvement in
predictive accuracy, but **the basic Elo system is surprisingly good**."*
🧠 **Start with Elo or PFA-Elo. Do not start with BKT.**

📄 **Šarić-Grgić, Grubišić & Gašpar (2024)**, *User Modeling and User-Adapted Interaction*
34:1127–1173 — "Twenty-five years of Bayesian knowledge tracing: a systematic review." BKT
is valued for interpretability; most enhancements add student characteristics and tutor
interventions.

📄 **ARTS** (Adaptive Response-time based Sequencing; Mettler, Massey & Kellman, CogSci
2020): 🔥 *"Adaptive generation of spacing intervals in learning using response times
improves learning relative to both adaptive systems that do not use response times and fixed
spacing schemes."* **Exp. 2: adaptive spacing beat random schedules, *including* when
learning proceeded to mastery criteria and mastered items dropped out.** 🧠 This directly
answers "does a mastery gate hurt if the mastered item disappears?" — No, and adaptive beats
random. Combined with *"increasing the strictness of the criterion level produced increasing
but diminishing learning gains."*

📄 **Metcalfe & Kornell (2003)**: allocating study time to **medium-difficulty** items beats
spending it on easy or too-hard items. 🧠 **Bias your engine to spend the learner's time on
the frontier item, not the easiest item they can clear.**

### 3.11 Socratic must be a mode, not the default

📄 Systematic review of 15 Scopus-indexed studies (Frontiers in Education 2026): the Socratic
method *"does not function as a standalone instructional method but rather as a
dialogue- and questioning-based strategy integrated within various instructional
designs"*; it *"strengthens mathematical thinking processes rather than procedural
execution."*

⚠️ **The counterweight, and it is important.** A senior thesis summarising the empirical
record: *"Two studies actually resulted in the effectiveness of the Socratic method only
working for about **one-third to one-half of students**… If a significant portion of
learners cannot adequately learn from the Socratic method…"*
🧠 **Socratic mode must be opt-in, gated by demonstrated competence, and never the only
path.** Your current default — free play against the oracle — is correct for the bottom half
of the skill distribution. Keep it.

### 3.12 LLM-specific risks

📄 **Bastani, Bastani, Sungu, Ge, Kabakcı & Mariman (2025)**, *"Generative AI without
guardrails can harm learning: Evidence from high school mathematics,"* **PNAS 122(26)
e2422633122.** ~1,000 students, three arms, **preregistered**.
- Assisted practice: GPT Tutor **+127%**, GPT Base **+48%** vs control.
- **Unassisted exam: GPT Base was significantly WORSE than control — a 17% grade
  reduction.** The negative effect was *"essentially eradicated"* in GPT Tutor — but still
  no positive effect.
- Diagnosis, verbatim: *"Without guardrails, students attempt to use GPT-4 as a **'crutch'**
  during practice problem sessions, and subsequently perform worse on their own."*

🧠 **This is your thesis in one paper, and it validates the architecture *and* the
guardrail.** Put it in your README.

📄 **Lehmann, Cornelius & Sting (2025)**, arXiv:2409.09047, two preregistered incentivised
experiments + a field study:
- *"no effect of LLMs on overall learning outcomes"* (average case).
- Students who **substitute** LLM activities *"increase the volume of topics they can learn
  about but decrease their understanding of each topic."*
- Students who **complement** *"do not increase topic volume but do increase their
  understanding."*
- 🔥 **"LLMs widen the gap between students with low and high prior knowledge."**
- *"LLMs increase **perceived** learning by more than can be explained by actual differences
  in learning."*

🧠 Your LLM is decoration **on top of** the game, not a substitute — exactly the
"complement" arm, the only arm with a positive effect. And the widened prior-knowledge gap
means **adaptive difficulty is not a nice-to-have; it is the equity mechanism.**

📄 **VanLehn (2011)**, *Educ Psychol* 46(4): the **interaction granularity hypothesis**.
Textbook beliefs (ITS d = 1.0, human tutors d = 2.0) are wrong. Found: **human tutoring
d = 0.79, ITS d = 0.76** — ITS ≈ average human tutor, well below the folklore. And the
granularity hypothesis *"predicts that no-tutoring instruction should be less effective"*
— it wasn't. 🧠 **Step-based granularity is the design lever: evaluate every step, not the
final answer.** Your product is step-based by construction. This is the single most
predictive design decision you have made, and you made it for architectural reasons, not
pedagogical ones.

📄 **Ma, Adesope, Nesbit & Liu (2014)**, *JEP* 106(4):901–918 — 107 effect sizes, 14,321
participants. ITS vs large-group teacher-led **g = 0.42**; non-ITS computer-based
instruction **g = 0.57**; textbooks **g = 0.35**. Held regardless of schooling level, lab vs
classroom, **retention vs transfer**, procedural vs declarative, and *"whether or not the
ITS provided feedback or modeled misconceptions."*
🧠 **You do not have to model misconceptions on day one.** That de-risks §6 substantially.

📄 **Steenbergen-Hu & Cooper (2014)**, *JEP* 106(2):331–347 — 39 studies, college
students: **g = 0.32–0.37**; *"ITS were less effective than human tutoring, but they
outperformed all other instruction methods"*; *"effectiveness in earlier studies appeared to
be significantly greater than that in more recent studies."*
📄 **Kulik & Fletcher (2016)**, *RER* 86(1):42–78 — **median +0.66 SD** across 50 controlled
evaluations, but *"effects were small"* in evaluations with nonconventional control groups
or **flawed implementations**. 🧠 **Your "flawed implementation" risk is an oracle that
disagrees with your own explanation.** That is a testable property and it should be a test.

📄 **Khanmigo reality check (Oreopoulos & Low, NBER WP w35620)**, 2-year cluster RCT, 18
Tennessee middle schools, ~6,900 student-terms: **+1.26 national percentile ranks per
term; ~0.14 SD implied for a full year** at ~$15/student/year. Crucially: *"Students opened
the tutor but rarely talked to it."* Khan Academy's own A/Bs are more specific: **next-item
correctness +3.4%** from summarising recent problem history, **+2.7%** from surfacing
unmastered prerequisites, **+6.1% combined**; **making responses faster: no effect**;
hard-to-parse input: no effect.
🧠 **The most useful finding here is negative: latency and prose quality produced nothing.
Structured skill-gap signals produced 6%.** Your oracle *is* a structured skill-gap signal.
Feed it to the LLM. Do not spend effort optimising prose speed or temperature.

📄 **Prather et al. (2024)**, ICER '24: Copilot *"kept getting in my way when I was trying to
think. It was **interrupting my thought process**."* Metacognitive skill is the moderator —
students with metacognitive difficulties were **harmed**.
📄 **Becker et al. (2023b)**, ICER '25 — "straying": students accept incorrect
AI-generated code and end up in debugging rabbit holes. 🧠 **Design lesson: never let the
LLM's rendering of "what just happened" disagree with the oracle.** The oracle must be the
only source of truth on screen.
📄 **Ruf et al. (2024)**, Findings of EMNLP: *"the observed regressive effects are
**uniquely associated with training LLMs to replicate student misconceptions**."*
🧠 **If you ever fine-tune the theme layer, do not train it on user errors. And in
prompting: do not let it "helpfully" mirror the user's wrong reasoning.**

📄 **Kucharavy et al. (2025)**, BEA workshop, *"LLMs Protégés: Tutoring LLMs with Knowledge
Gaps"* — the **LLM-as-mentee** schema beats LLM-as-tutor on counterfactual generation,
ownership, and over-reliance. *"Students in an introductory algorithms class who
successfully diagnosed an LLM teachable agent system prompted to err on a course material
gained an average of 0.72 points on a 1–6 scale."*
🧠 **The most on-point framing available for your app: the LLM can be the *erring student*
the user corrects.** It is explicitly validated in an introductory algorithms class. This is
a genuinely differentiated mode and it costs you nothing, because your oracle is already the
thing that can adjudicate who was wrong.

📄 **CodeAid** (Kazemitabaar et al., CHI '24, arXiv 2401.11314) — 700+ students,
semester-long deployment. Guardrail: few-shot prompting to restrict output to explanation +
hints, never code; and **pseudo-code style chosen deliberately** as *"not overly revealing
the code's syntax and not too close to natural language."*
🧠 **Directly reusable for your debrief: show the real code only after the learner has
committed; show pseudocode before.** You currently show both, always, in the debrief.

📄 **Khan Academy's own efficacy data has a 20-point gap worth copying** (CodeHelp,
Liffiton et al.): *"helped me complete my work successfully"* — 9% strongly / 71% agree;
*"helped me learn the course material"* — 7% / 56%. Also: **Pardos & Bhandari found
human-generated hints produced superior learning gains than LLM-generated hints**, even
though both helped.

### 3.13 What not to cite

⚠️ Never cite vendor efficacy pages. CodeCombat's page is a McREL study **sold by
CodeCombat**; the peer-reviewed control-group work (Kroustalli & Xinogalos 2021, n=59) found
it *"positive in terms of perceived ease of use and usefulness… but **neutral in terms of
students' behavioral intention to use**."* Similarly avoid the entire Hour of Code evidence
base — it measures **attitudes and self-efficacy, never retention**.

**Cite instead:** Steenbergen-Hu & Cooper (2014) · Ma et al. (2014) · VanLehn (2011) ·
Kulik & Fletcher (2016) · Wouters et al. (2013) · Sailer & Homner (2020) · Rozenblit & Keil
(2002) · Roediger & Karpicke (2006) · Bjork & Linn (2006) · Atkinson, Renkl & Merrill
(2003) · Aleven & Koedinger (2001) · Roll et al. (2014) · Settles & Meeder (2016) · Bastani
et al. (2025) · Lehmann et al. (2025).

---

## 4. What I found by running your app

✅ **Everything in this section is first-hand**, reproduced against your running stack
(`:3000` web, `:8787` API). I drove a full binary-search game to a win through the public
API using `scripts/play-through.sh` and read the live debrief DOM.

### 4.1 🔴 The product has no memory at all — verified

`services/api/src/store.ts`: `const sessions = new Map<string, GameSession>()` — in-memory,
`MAX_SESSIONS = 200`, 3-hour idle TTL, no persistence. `apps/web/src/store/game.ts` uses
Zustand `persist` with `createJSONStorage(() => sessionStorage)`. There is no auth, no user
id, no progress record, no mastery state, no review queue, no account of any kind
(`grep -niE "\bauth\b|userId|account|signin|login"` returns only two unrelated comments).

**Consequence:** a learner who plays six games gains nothing on the seventh. Six games
produce six unrelated sessions with no shared spine. For a product whose tagline is *"Learn
the algorithm by playing it"*, and whose stated user need is *"they can remember it,"*
this is the largest structural gap in the project.

Compare: 📄 LeetCode's own official spacing advice is *"repeat at least 3 times… this is
learning tip called spaced repetition"*; 📄 Visualgo tracks per-module quiz completion per
account; 📄 USACO Guide tracks Completed / In Progress / **Skipped** / Not Started.

**You already have the data.** `telemetry.ts` computes `mistakeSummary()` returning
`byMechanic` and `byDsaOp`; `optimisationScore()`; `traceCodeHighlights()`. This is
close to a sub-skill vector already. It is simply never persisted, so it is never scheduled.

### 4.2 🔴 The hint ladder is an unguarded spoiler — verified, reproducible

This is the most serious finding in the document.

`services/api/src/coach/guardrails.ts` is 610 lines implementing 8 rules
(`pasted-code`, `answer-claim`, `answer-is-target-value`, `index-claim`, `value-claim`,
`full-solution`, `future-leak`, `unearned-correction`), with the stated invariant that **no
rewrite ever contains a digit**, and the stated principle that *"a prompt rule is a
suggestion; a validator is a guarantee."*

**None of that protects the hint path.** `packages/game-engine/src/hints.ts::hintFromSpec`
returns the spec's authored `hintPool` entry verbatim, prefixed with a factual line. There is
no validator, no `deJargon`, and no `findViolation` call anywhere in `hints.ts` or in
`services/api/src/app.ts::/api/hint`.

**Reproduced, default configuration, no API key needed** — the template tier is the
documented "the guarantee" tier:

```
$ for i in 1 2 3; do curl -sX POST :8787/api/hint -d '{"gameId":"..."}'; done
HINT1: "First move: Set lo=0, hi=n-1."
HINT2: "Then: While lo<=hi compute mid=(lo+hi)/2."
HINT3: "Then: If a[mid]==target stop."
```

Read that against three facts in your own codebase:

1. **`prompt.ts:46-48` tells the LLM tier** *"hints… must not contain the answer"* — a
   **prompt instruction**, i.e. a request, on the exact surface where you have already
   written down that requests are not guarantees. The LLM tier currently complies
   (verified: the `opencode-go` tier produced good themed hints with no notation and no
   answer), but it complies by luck of the draw, not by construction.
2. **`guidance.ts::deJargon` exists specifically to strip this notation** —
   `.replace(/\b(lo|hi|mid|i|j)\s*=\s*-?\d+/gi, '')` — and the hint path does not call it.
   `hints.ts::variableLine` then *reintroduces* `lo=0, hi=7, mid=3` by design.
3. **`guardrails.ts::fullSolutionRule`** targets exactly the shape above — "an imperative
   followed by a conjunction… the shape of a recipe." Three hint requests produce a recipe.

**And the debrief dumps the whole thing for free.** Verified in the live debrief DOM: a
panel titled **"HINTS YOU DID NOT NEED"** rendering the entire canonical algorithm as
`First move: Set lo=0, hi=n-1. / Then: While lo<=hi compute mid=(lo+hi)/2. / Then: If
a[mid]==target stop. / Then: If a[mid]<target set lo=mid+1 else set hi=mid-1. / Then: If lo>hi
the target is absent.` — for a player who spent **0 hints**. Source: `template.ts:222-225`,
`hintPool = algorithmSteps(problem.canonicalAlgorithm)`.

**Why this matters pedagogically, not just as a leak:** 📄 Roediger & Karpicke — a player
who reads the revealed algorithm is in the **40% reread arm**, not the **61% retrieval arm**.
📄 Rozenblit & Keil — handing over the mechanism is precisely what suppresses the
self-correction that would calibrate their understanding. 📄 Roll et al. 2014 — hints help
*medium*-skill learners and **hurt** low-skill ones, and this hands the complete solution to
anyone at any skill level on request, with no gate.

🟢 **The fix is small and reuses code you already wrote:** run every hint through
`findViolation` + `deJargon` before it leaves `hints.ts`, using the same `GuidancePromptSnapshot`
the coach uses. Add a bottom-out rule and the Aleven & Koedinger 2-second inter-level delay.
This is the highest value-per-line change in the document.

### 4.3 🔴 A flawless run is reported as a mistake — verified

Live debrief for a run with **0 mistakes, all 10 moves correct, score 98, Grade S**:

> **WHERE THE PATHS SPLIT** — The first divergence is at step **9**.
> **YOU DID** `found at v4` (line 6) · **THE ALGORITHM** `found: target 77 at index 4` (line 13)
> *"Steps before this one were correct — **the mistake compounded from here**, not from the
> start."*

There was no mistake. `findDivergence` (`CanonicalCompare.tsx:61-91`) compares frames, and
when `played.length !== canonical.length` it **falls through to the length branch and
returns a divergence anyway** (line 78). The player made 10 moves; the canonical trace has
9 — because `submitAnswer` is a mandatory extra game move the reference trace does not
contain. The copy at line 134–136 is then unconditional.

The same artefact propagates:
- `computeScore` deducts **−2** for *"Path efficiency (10 steps vs 9 in the reference
  solution)"* on a perfect run. Grade S instead of a clean 100.
- `optimisationScore().note` says *"Very close to optimal. You took 10 steps; the reference
  line needs 9 steps."*
- `reasons: "Optimal-ish. The board barely got in your way."` — odd phrasing for a clean run.

🧠 **A learner is told they made a mistake when the engine forced an extra click.** This is
the most trust-destroying class of bug you can ship, because it is indistinguishable from
the learner being bad. It is also a one-line class of fix: the canonical trace should either
include the commit move, or the comparison should compare **algorithm operations**
(`state.progress.comparisons` / `dsaOp` sequence) rather than raw frame counts, or the
length branch should be excluded from the "mistake" framing entirely.

### 4.4 🟠 Ten of eleven problems are unplayable — verified

`packages/dsa-oracles/src/registry.ts` has one oracle (`binary-search`).
`packages/game-schema/src/problems.ts` lists 11. ✅ Confirmed against the running API:
generation succeeds for `binary-search` and returns `no oracle for problem "..."` for the
rest.

Your README states this correctly — *"without an oracle a problem has no definition of
correct, so the game cannot be played honestly."* The requirement is unchanged; I am
restating it because it is on the critical path for everything else (retention needs
something to retain; §3.3 sub-skill scheduling needs ≥2 algorithms to interleave).

### 4.5 🟠 Template-tier language bugs ship to users — verified

The template tier is the **documented guarantee tier** and the default for anyone who clones
the repo without a key. Verified generated spec (`forceTemplate: true`):

- `theme.story`: *"Line 8 of the factory has 8 unprogrammed **actuator actuators** queued on
  the rail."* ← noun duplicated.
- `mechanics[0].label`: ***"take a actuator in hand"*** ← wrong article.
- `mechanics[1].label`: `"test two actuators against each other"` ← acceptable.
- `mechanics[2].label`: `"decide which side of the assembly line stays open"` — **clipped
  in the UI**; the operation tab row overflows horizontally with no scroll affordance and no
  wrap (verified in the rendered screenshot).

Source: `template.ts:69` — `` return `take a ${t.object} in hand` `` — a hardcoded `a` with
no article agreement. `template.ts:215` — `` `holds ${n} ${theme.objectPlural}` `` duplicating
a plural that is already in the template.

🧠 The template tier is the **degraded** tier, and degraded tiers should be *plainer*, not
*broken*. A learner who has never seen a variable named `lo` is being taught by prose that
says "actuator actuators".

### 4.6 🟠 The instruction is stated three times on one screen — verified

Play screen, one viewport, `binary-search`:

1. `YourTurnIndicator` headline: **"take a actuator in hand"**
2. `MechanicHost` panel title: **"take a actuator in hand"**
3. `MechanicHost` panel body: **"take a actuator in hand — the read step of the algorithm."**

Plus the goal kicker above it, plus a target chip row repeating the label again, plus
`"the one the program is looking at"`, plus `ProgressRail` restating **"8 of 8 still in
play"** which `YourTurnIndicator` already showed as **"8 of 8 actuators left"**.

This directly violates the file's own stated design principle. `PlayView.tsx:245-250`
already reasons about this correctly for the *objective* — *"Printing both put the same
sentence on the page twice, which is textbook extraneous load"* — and the same argument was
never applied to the mechanic label or the progress figure. 📄 Mayer redundancy effect /
Albers 2023: duplication of identical content is not free.

### 4.7 🟠 Debrief deep-link shows a false error, then recovers — verified

Cold-loading `/debrief/<id>` in a fresh tab: the first render is

> **"THIS DEBRIEF IS NOT IN THIS TAB"** — *"the contract has no endpoint to read a finished
> game back."*

…then ~1s later the real debrief appears. The recovery effect in `DebriefView.tsx:57-73` is
correct and `GET /api/game/:gameId/debrief` exists and works (verified: returns the full
`DebriefResponse`). The problem is purely that the "not in this tab" branch is rendered
during the fetch instead of a loading state. 🧠 `/api/game/:gameId/debrief` even has a
docstring saying *"That is what makes a debrief link shareable"* — so shareable links are
intended to work, and the first thing a shared link shows is an error.

### 4.8 🟠 Debrief-only wire metadata leaks to learners — verified

- **"LIKELY MISCONCEPTION: `no-mistakes`"** with *"Laya confidence 100%"* — displayed as
  though `no-mistakes` were a misconception. It should be suppressed when there are none.
- **"Laya confidence 100%"** and **"generated by built-in template"** are model/pipeline
  telemetry shown to a 12-year-old. `ProgressRail` already made the right call here — its
  comment says the provider cascade is *"collapsed, because it explains the app to its
  author, not to its learner."* The debrief has not caught up.

### 4.9 🟡 Debrief recap is a restatement, not an explanation — verified

Template-tier recap, in full:

> *"You worked the north ridge one pitch at a time until the high camp resolved. What this
> problem is built to teach: Binary search halves the search space on every comparison:
> compute mid, compare, discard one half, repeat. The run is bounded by O(log n) time and
> O(1) extra space, and that bound comes from the algorithm rather than from how carefully
> you played. Very close to optimal. You took 10 steps; the reference line needs 9 steps."*

It is: theme restatement + verbatim `learningObjective` + complexity claim + the §4.3
artefact. No information the learner did not already have. 📄 Atkinson, Renkl & Merrill
(2003): this is where the far-transfer gain lives, and there is no self-explanation prompt
anywhere in the debrief.

🟢 **One genuinely excellent thing here, worth protecting:** the `ComplexityChips` copy —
*"Read it as: this is how the cost scales when the data doubles. O(1) does not grow, O(log n)
adds only a step or two, O(n) doubles, and O(n²) quadruples."* That is better complexity
pedagogy than most paid courses. Combine it with a **live size slider** (📄 Visualgo's
`log N = 20` vs `N = 1,048,576` slider is the canonical move) and it becomes the strongest
single screen in the product.

### 4.10 🟡 Minor

- **`"Board tinted by each frame's pointers. the ridge had 8 positions."`** — lowercased
  sentence start.
- **`reasons: "Optimal-ish. The board barely got in your way."`** — should not fire on a
  clean run.
- **The board under-uses the viewport.** 8 tiles in a 1500px-wide viewport leaves large dead
  space; tiles are `min-w-12`. A learner with 16–20 instances (medium/hard) will be worse.
  📰 Visualgo's controls are desktop-first and *still* get criticised for this; yours is
  mobile-first and should not repeat it.
- **No "what next".** The debrief's only exits are *"Back to the board"* and *"Play a new
  version of this game."* No next problem, no concept review, no share, no "see this in
  Python", no explanation of *why* the next thing follows.
- 📄 `.env` is present in the working tree and `.gitignore` exists — worth confirming
  `.env` is actually ignored before this is ever pushed anywhere.

---

## 5. Where you are, relative to the evidence

### 5.1 You have already solved the hard part

🔥 **The single most important sentence in this document:** 📄 Bastani et al. (PNAS 2025)
found an unguarded GPT tutor produced a **17% worse** unassisted exam result than no AI at
all, and that the harm was *"essentially eradicated"* by guardrails that make the model
**hint instead of answer**. 🧠 Your architecture — deterministic oracle owns correctness, LLM
fills text slots, `GameSpecSchema` is `strict()` so an over-eager `correct: true` is
rejected, and `guardrails.ts` enforces no-leak as a *validator over generated text* — is
the design that paper says you need. Most products in the category (including every
competitor in §2.1) have not done this. **Lead with it.**

### 5.2 The loop you have vs. the loop the evidence describes

```
YOUR LOOP:        read objective → read instruction → make move → read explanation → ... → debrief (read)

RETRIEVAL LOOP:   ... → debrief (PRODUCE) → spaced re-encounter at the right time
```

📄 Roediger & Karpicke: 61% vs 40% is entirely the difference between producing and
re-reading. Your debrief is a very well-built **reread**. 📄 Lehmann et al.: your LLM is in
the *complement* arm (good) but the *debrief* is a reread (bad).

### 5.3 Gamification budget

📄 Sailer & Homner: cognitive **g = 0.49 (stable)**; motivational 0.36 and behavioral 0.25
(**both unstable**). **Game fiction is a significant moderator of the behavioral
outcomes.** 🧠 **You have the strong layer (the LLM theme) for free. Keep the weak layer
(score, grade) thin and truthful.** Your current score is at least transparent — it publishes
its own arithmetic in `score.ts`, which is better than most. But it must stop being wrong
(§4.3) and stop punishing hints, per 📄 Aleven et al. 2016 (help frequency ↓ learning).

🧠 The best *algorithmic* game mechanic anyone has shipped is 📄 **Lightbot's "Lower Score =
Better"** — fewest commands wins, with the provably optimal solution brute-forced per level
(📄 Hou & Huang 2025). It teaches efficiency *as the objective* rather than as a postscript
badge. That is exactly `optimisationScore()`, and it deserves to be a real mechanic rather
than a −2 line item.

---

## 6. Requirements

Ordered by **learning value per unit of effort**. Every requirement cites the evidence it
comes from and carries an acceptance criterion. Nothing here should be read as "do all of
it" — §6.1–6.3 are the ones that matter.

### R0 — Correctness bugs that teach the wrong thing 🔴 *do these first, they are cheap*

These are not features. They are defects that make the product lie to the learner.

| # | Requirement | Evidence | Acceptance |
|---|---|---|---|
| # | Requirement | Evidence | Acceptance | Status |
|---|---|---|---|---|
| **R0.1** | **The canonical trace must be comparable to a player's trace.** Exclude the `submitAnswer` commit from the step count, and compare on `dsaOp` rather than `action.type` — binary search accepts two ways to close the loop, and comparing mechanics flagged a correct run. | §4.3 verified | A 0-mistake run scores 100, reads "That is exactly the optimal line, start to finish", and the divergence panel shows no accusation. | ✅ done |
| **R0.2** | **The "mistake compounded" copy must be conditional on an actual `correct: false` frame** or a genuinely different `dsaOp`. | §4.3 | No frame with `correct !== false` can reach that sentence. | ✅ done |
| **R0.3** | **Every hint passes a spoiler validator before it leaves `hints.ts`.** | §4.2 verified; 📄 Bjork & Linn; 📄 Roediger & Karpicke | `"First move: Set lo=0, hi=n-1."` cannot be produced, from any tier. | ✅ done — `packages/game-engine/src/hint-safety.ts` |
| **R0.4** | **The debrief's "Hints you did not need" panel must not reveal the canonical algorithm.** | §4.2 verified | With `hintsUsed: 0` the debrief contains no `hintPool` text. | ✅ done |
| **R0.5** | **The template tier's prose must be grammatical**, and its hints must not be the canonical algorithm. | §4.5 verified | No generated string contains a duplicated noun or `a actuator`; no hint contains `lo=`/`hi=`/`mid=`. | ✅ done — found a **second** duplicated noun (`high camp camp`) that the first pass missed |
| **R0.6** | **Cold-loading `/debrief/:id` shows a loading state, not "this debrief is not in this tab".** | §4.7 verified | The error branch is unreachable while the fetch is in flight. | ✅ done |
| **R0.7** | **Hide `no-mistakes` and Laya confidence from learners.** | §4.8 verified | Neither string appears in the rendered debrief DOM. | ✅ done |

### Two defects found while fixing R0, not in the original list

Fixing the commit accounting surfaced two more errors of the same class — the
debrief lying about a correct run — which are worth recording because both were
**green in the test suite**:

1. **The return line was hardcoded to `return -1`.** The oracle reported
   `LINE_RETURN_NOT_FOUND` for the commit whether the target was found or not,
   in *both* the canonical trace and `applyAction`. So a successful playthrough
   highlighted line 13 — the one statement the player never executed — and the
   debrief's "executed in your run" markers pointed at it. The existing test
   asserted `expect(last.codeLine).toBe(13)` on all 240 seeded instances and
   passed, because every one of them is a hit and every one returned 13.
2. **`describeSearchWindow` printed "six of the four values"** on a window wider
   than the board, because the window count came from the bounds and the total
   from `values.length` without reconciling them.

Both are now covered. The first is why the new test asserts `6` for a hit and
`13` for a miss, and why the not-found branch — unreachable through
`buildInstance`, since `targetGuaranteed` is true — needed a hand-written test.

### R1 — Memory: persistence, mastery, and the retention loop 🔴 *the biggest gap*

> This is the requirement that turns a good demo into a product that changes behaviour.
> 📄 Roediger & Karpicke 2006 · Roediger & Butler 2011 · Settles & Meeder 2016 · Karpicke &
> Roediger 2007 (delay the first retrieval) · Lehmann et al. 2025 (LLMs widen the
> prior-knowledge gap, so adaptive difficulty is the equity mechanism).

| # | Requirement | Rationale |
|---|---|---|
| **R1.1** | **Persist play history per learner.** Minimum viable: an anonymous, device-local learner id in `localStorage` (you already use it in `firstRun.ts`) writing every finished game server-side. Server-side, not `sessionStorage`, so a cleared tab doesn't erase learning. | The store is `Map` + 3h TTL today. Nothing survives. |
| **R1.2** | **Derive a per-`problemId` mastery state** from what `telemetry.ts` already computes: wins, 0-mistake runs, median time, `byMechanic`/`byDsaOp` mistake counts, hints used, **and time-per-hint-level** (you will need to start recording it). | 📄 Aleven et al. 2016: *time per hint level* correlates positively with learning; raw frequency correlates **negatively**. Level-1 and level-2 hint proficiency don't correlate (📄 Goldin et al. 2012) — measure separately. |
| **R1.3** | **A "due for review" queue**, scheduled per **sub-skill** (`byDsaOp` bucket) with **FSRS** or **Half-Life Regression**, not per algorithm. | 📄 FSRS beats SM-2 in 97.4% of cases on 1.7B reviews; SM-2's "low interval hell" is a real failure mode. Sub-skill granularity is your differentiator. |
| **R1.4** | **Respect the inverted-U.** Don't re-encounter an item still in short-term memory. | 📄 PNAS 2019 MEMORIZE. |
| **R1.5** | **Show mastery state in the catalogue**, USACO Guide style: `6 mastered / 3 learning / 2 not started`, with **"Skipped" as a first-class non-failure state**. | 📄 USACO Guide ships exactly this. It's cheap and it orients. |
| **R1.6** | **"Retry with New Game" is not spaced repetition.** Add a distinct **"Review"** entry point that re-serves a *due* item, ideally in a **different theme**, so the retrieval is of the algorithm and not of the story. | 🧠 Same seed = same data + same theme. It trains pattern-matching on the story. |

### R2 — Debrief: stop telling, start asking 🔴 *highest value per line*

> 📄 Atkinson, Renkl & Merrill 2003 (fading + **principle-elicitation prompt** → medium-to-large
> effects on **far** transfer, at no extra time on task) · Rozenblit & Keil 2002 (generation
> is the only documented self-calibration mechanism) · Roediger et al. 2009 (avoid MCQ —
> no feedback on MCQ increases false recognition) · Bjork & Linn 2006 (free response beats
> fill-in-the-blank; **integration prompts** win for transfer).

| # | Requirement | Rationale |
|---|---|---|
| **R2.1** | **The debrief must contain at least one free-response self-explanation prompt** before the explanation is revealed. Minimum set: (a) *"Why did you go that way rather than the other way?"* (retention); (b) *"What stayed true the whole time?"* (integration → transfer). | This is the single change that converts the debrief from reread to retrieval. |
| **R2.2** | **The learner's own answer is echoed back in the explanation.** *"You said 'because the middle is too small'. Here's what that means…"* | 📄 Self-explanation is only effective if the learner sees that it mattered. |
| **R2.3** | **Never multiple choice in the debrief.** | 📄 Roediger et al. 2009 / Kang et al. 2007. |
| **R2.4** | **Make the code panel a toggle, not a permanent panel.** Show **pseudocode by default**; reveal real code on request, and always after the learner has committed a run. | 📄 Redundancy effect (Mayer; Albers 2023 η²=.259 content, .326 modal). 📄 Visualgo's disclosure arrow. 📄 CodeAid chose pseudocode deliberately: *"not overly revealing the code's syntax and not too close to natural language."* |
| **R2.5** | **Add a live size slider to the complexity panel** and re-run the learner's own trace at n = 16 / 256 / 65,536. | 📄 Visualgo's `log N = 20` vs `N = 1,048,576` slider. 🟢 Your `ComplexityChips` copy is already the best complexity teaching in the category — give it a control and it becomes the strongest screen in the product. |
| **R2.6** | **"Predict the next move" as an opt-in commitment device** before each step in `hard` mode, scored for calibration. | 📄 AlgoMotion's best primitive; 📄 Roediger & Butler (testing works even without feedback). Also your best IOED early-warning signal (§7, metric 3). |
| **R2.7** | **A synced, scrubbable comparison timeline** — your run vs. the reference on one axis, with the divergence pinned. | 📄 codedive (line-by-line), labuladong ("Run to Cursor"), Visualgo (±7 frames, frame-accurate codetrace). Your two independent `ReplayPlayer`s are defensible (§ comments) but a learner comparing two scrubbers side by side is doing arithmetic. |
| **R2.8** | **Learner can be the *erring student*.** An optional mode where the LLM proposes a wrong next move and the learner corrects it; the oracle adjudicates. | 📄 Kucharavy et al. 2025 (*LLMs Protégés*): +0.72/6 on a 1–6 scale in an **introductory algorithms class**. Costs you nothing — the oracle already adjudicates. Genuinely differentiated. |
| **R2.9** | 🔥 **A transfer-to-code step: the learner writes the algorithm.** Pseudocode or real code in a text area, checked by the **oracle** against a hidden test battery — not by an LLM. This is the *only* requirement in the document that tests whether the learner can do the thing the product exists to teach. | ✅ **Verified gap: the app has no code submission anywhere.** `grep` for `textarea`/`contenteditable`/`monaco` across `apps/web` returns exactly three hits — the theme-wish box and two in the coach composer. The product teaches an algorithm and never asks the learner to produce one. 📄 Atkinson, Renkl & Merrill 2003 (far transfer). 📄 VanLehn 2011: step-based ITS ≈ *average human tutor* (d = 0.76) — the payoff is a capability, not a feeling. 📄 Pan & Rickard 2018: transfer < retention, moderated by *format congruence* — so the recall item and the code item should look alike. |
| **R2.10** | **Format-congruent assessment.** Whatever you ask at recall time (R2.1) should look like what you ask at transfer time (R2.9). | 📄 Pan & Rickard 2018: *"congruence between training and final test format"* is a key moderator of transfer. |

### R3 — Hint ladder as a first-class, instrumented subsystem 🟠

> 📄 Aleven & Koedinger 2001 · Roll et al. 2014 · Aleven et al. 2016 · Goldin et al. 2012 ·
> LAK 2026. See §3.9 for the full assembled spec.

| # | Requirement |
|---|---|
| **R3.1** | Three levels: **principle → constraint → move.** (Today: an ordered prose pool with no levels.) |
| **R3.2** | **2-second delay between levels** to break the click-through habit. |
| **R3.3** | **Auto-offer L1 after 2 consecutive wrong moves — gated on medium skill only.** For a struggling learner, make them struggle. |
| **R3.4** | **Never end on the bottom-out hint without a self-explanation prompt** (R2.1) — "you now know the move; say *why* it was the move." |
| **R3.5** | **Record time-per-hint-level**, not levels-requested. This becomes the mastery signal in R1.2. |
| **R3.6** | **Fix the hint penalty.** `-5 per hint` contradicts 📄 Aleven et al. 2016. Make asking cost nothing in the score, and reward *not* needing it instead. |
| **R3.7** | **No digit, no position, no step-sequence** — reuse the coach's `rewriteFor` + `SAFE_LAST_RESORT` machinery for the hint path too. (R0.3 is the enforcement; this is the design.) |

### R4 — Adaptive difficulty and framing 🟠

| # | Requirement | Rationale |
|---|---|---|
| **R4.1** | **Start with Elo or PFA-Elo, not BKT.** | 📄 "the basic Elo system is surprisingly good." |
| **R4.2** | **Scale per sub-skill**, not per algorithm. | §3.3 |
| **R4.3** | **Bias difficulty toward the frontier** (Metcalfe & Kornell: spend time on medium-difficulty items). | 📄 |
| **R4.4** | **Add response time to the adaptation signal (ARTS).** Your oracle already produces exact per-turn structure; adding `responseTimeMs` is cheap. | 📄 CogSci 2020 Exp. 2: adaptive > random **even with mastery-gated drop-out**. |
| **R4.5** | **Redefine `difficulty` to mean something pedagogically.** Today it only changes array length and wrong-answer slack. `easy` = massed, uninterrupted, full feedback. `hard` = interleaved with another problem's board, intermittent feedback. | 📄 Bjork & Linn; 📄 Rohrer & Hartwig (massing creates the illusion of mastery). |
| **R4.6** | **Length-adaptive theme.** One line of flavour for a confident learner, a paragraph for a novice, with a hard cap. | 📄 Expertise reversal (Kalyuga et al.); Albers 2023. |

### R5 — Coverage: oracles and mechanics 🟠

| # | Requirement |
|---|---|
| **R5.1** | **Finish the oracle catalogue.** 10 of 11 problems return `no oracle`. Until then the catalogue is a promise the app can't keep. |
| **R5.2** | **Prioritise by mechanic, not by problem.** The 10 mechanics map onto a much smaller set of distinct algorithms. `array-max-min` and `move-zeroes` and `two-sum` are all single-pass scans; building the *scan* oracle once and parameterising it is cheaper than 3 oracles. |
| **R5.3** | **Consider "not found" as a first-class case.** The `return -1` branch (code line 13) is currently only reachable via the canonical trace, not by play. A learner who never sees the not-found path has not seen binary search. |
| **R5.4** | **Re-check the `requiredMechanics` invariant per new oracle.** Your own comment on `problems.ts:41-56` explains that "allowed" ≠ "sufficient" and that a generator which may drop a load-bearing mechanic produces an unwinnable game. Extend `scripts/play-through.sh` to run against **every** oracle, not just binary search. |

### R6 — De-duplication, polish, and the things users actually complain about 🟡

| # | Requirement | Evidence |
|---|---|---|
| **R6.1** | **State the mechanic instruction once.** It currently appears 3×. Same argument `PlayView.tsx:245-250` already makes for the objective. | §4.6; 📄 redundancy effect |
| **R6.2** | **State "how much is left" once.** `YourTurnIndicator` and `ProgressRail` both show it. | §4.6 |
| **R6.3** | **Fix the operation-tab row overflow.** It clips on a 1500px viewport. | §4.5 |
| **R6.4** | **Repair template-tier grammar and capitalisation** ("the ridge had 8 positions"). | §4.5, §4.10 |
| **R6.5** | **Use the board's vertical space.** 8 tiles in a wide viewport is dead space; `hard` instances will be worse. | 📰 Visualgo complaints |
| **R6.6** | **Add real exits from the debrief:** next problem, "review this concept", "see it in Python", share. | §4.10 |
| **R6.7** | **Verify the running build matches source.** The dev API was serving a build without `turnPrompt` ("*This server build does not send per-turn guidance*"), and the board rendered a duplicated value that `ObjectToken.tsx:213` (`showValue`) should suppress. 🧠 The duplicate-value one is *probably* a stale-build artifact rather than a live bug — **verify before filing it.** | §4.5, §4.10 |
| **R6.8** | **The board is not keyboard-operable.** Verified: `onKeyDown` exists only in `SubmitAnswer.tsx` and `AssignValue.tsx`. `ObjectToken` has no `tabIndex`, no `onKeyDown`, and no `role="button"` — so a keyboard-only user **cannot play `selectObject`/`comparePair`/`choosePath`, i.e. cannot play binary search at all.** Requires: focusable tiles, visible focus ring, Enter/Space activation, arrow-key traversal, and a roving `tabindex` for the tile row. | ✅ verified by grep; 📰 Visualgo is criticised for exactly this class of problem; WCAG 2.1.1 (Keyboard) is a conformance-level-A failure |
| **R6.9** | **Reduced motion is already handled — do not spend time here.** `Providers.tsx:17` sets `MotionConfig reducedMotion="user"` globally and `ReplayPlayer` additionally uses `useReducedMotion()`. This item is complete. | ✅ verified by grep |

### R7 — What I recommend you explicitly *not* build

| Don't | Why |
|---|---|
| **XP, badges, streaks, leaderboards** | 📄 Sailer & Homner: behavioral **g = 0.25 and not stable**. And AlgoMotion's entire differentiation is exactly this. Competing there is competing in the weakest tier of the weakest market. |
| **A general "ask it anything" tutor** | Your `guardrails.ts` is 610 lines of adversarial filtering on *game-scoped* questions. The cost of allowing open questions grows faster than the guardrail can be hardened. Keep it game-scoped. |
| **Fine-tuning the theme layer on user errors** | 📄 Ruf et al. 2024: regressive effects are *"uniquely associated with training LLMs to replicate student misconceptions."* |
| **Latency / prose-quality optimisation of the LLM** | 📄 Khan Academy A/B: making responses faster → **no effect**; structured skill-gap signals → **+6.1%**. You already have the signal. |
| **Multiple-choice anywhere in the learning loop** | 📄 Roediger et al. 2009 / Kang et al. 2007: no feedback on MCQ *increases* false recognition. |
| **Competitor cloning (CSES, USACO, a pathfinder grid)** | You already have the thing they don't: generation-gated play against a real oracle. |

---

## 7. What to measure

📄 Ordered by how directly each one detects a documented failure. **This is the section
that decides whether you learn anything, and it is currently entirely absent.**

| # | Metric | Detects | How |
|---|---|---|---|
| **1** | **Unassisted transfer.** A delayed check: no board, no oracle, no LLM — *"write binary search for a sorted array"*, or *"what is the big-O and why?"*, free response. | 📄 Bastani et al. 2025's unassisted exam — the **only** metric that matters, and the one that separated good from harmful. | A `POST /api/recall-check` returning a free-response prompt, scored by the oracle's own `code()` comparison. **Not auto-scored by an LLM.** |
| **2** | **Time-per-hint-level + bottom-out rate.** | 📄 Aleven et al. 2016; Goldin et al. 2012; LAK 2026 shallow processing. | Already computable — R1.2, R3.5. |
| **3** | **Retries-before-commit, and fast-commit-wrong rate.** | Your IOED proxy. Retrying a lot then committing = healthy. Committing fast and wrong = false mastery. | 📄 Rozenblit & Keil. |
| **4** | **Predicted-vs-actual calibration.** Ask the learner to predict their own score, then compare. | 📄 Lehmann et al. 2025: LLMs *"increase perceived learning by more than can be explained by actual differences in learning."* | One extra question in the debrief. |
| **5** | **Outcomes stratified by a placement test.** | 📄 Lehmann et al. 2025: LLMs widen the prior-knowledge gap. | The widest equity lever you have. |
| **6** | **Oracle-vs-explanation disagreement rate.** | 📄 Kulik & Fletcher 2016's "flawed implementation" risk. If your own prose ever contradicts your own oracle, you are in the worst failure class available. | A test, not a dashboard. |

⚠️ **Set the effect-size expectation honestly.** 📄 VanLehn 2011: step-based ITS ≈ average
human tutor (**d = 0.76**), not expert tutor. 📄 Khanmigo's best field result: **~0.14 SD**
over a full year. 📄 Visualgo took 13 years and 2,000 sessions/day to become the default
lecture tool. **A 0.3–0.5 SD improvement over a good visualisation-based baseline is an
excellent, publishable result for this product** — and 📄 Murray et al. 2025 is a live
warning that even the testing effect may be weaker in mathematics than the folklore says.
Instrument, don't assume.

---

## 8. Recommended sequence

**Phase 1 — stop lying to the learner (R0). ✅ COMPLETE.** All seven items shipped,
plus two further defects of the same class that surfaced while fixing them (see the table
in §6). 419 vitest tests pass, `tsc` is clean across the workspace, 25 Flutter tests pass.
Verified live against the running stack: a 0-mistake run now scores 100/100 and its debrief
reads *"You followed the reference solution exactly, and then finished the round by
committing the answer… No decision you made was the wrong one."* Six consecutive hint
requests on the default tier return clean prose — no notation, no position, no assertion.

**Phase 2 — the debrief (R2).** Highest learning value per line, and §3.7 says a good debrief
with the current game beats a good game with the current debrief. Start with **R2.1**
(one free-response prompt), **R2.4** (toggle the code panel), and **R2.9** (transfer-to-code)
— together they are a few days' work and they address the two strongest citations in this
document plus the one capability the product exists to build.

**Phase 3 — memory (R1).** The biggest structural gap and the most work. R1.1 → R1.2 → R1.3
in that order; the sub-skill vector already exists in `telemetry.ts`, so R1.3 is mostly
plumbing plus an FSRS dependency.

**Phase 4 — oracles (R5).** Gate the rest on R5.1: retention needs something to retain, and
interleaving needs ≥2 algorithms. Parameterise by mechanic, not by problem.

**Phase 5 — hints (R3), adaptivity (R4), polish (R6).** R3 is nearly done once R0.3 lands
— the validator is the missing piece, not the design.

---

## Appendix — one-paragraph pitch, rewritten with the evidence

> An LLM writes the theme; a deterministic oracle owns the truth. The player makes the
> comparisons, swaps, pushes and branches that the code would make, and afterwards sees
> their own moves replayed against the reference with the real code beside it.
>
> That separation is not a stylistic choice — it is the finding. A 2025 *PNAS* trial of
> ~1,000 students found that an unguarded AI tutor made them score **17% worse** than no
> AI at all on an unassisted exam, and that the harm was essentially eradicated by
> guardrails that make the model hint instead of answer. Interactive step-based tutoring
> systems sit at **d = 0.76** — on par with an average human tutor. And the illusion of
> explanatory depth is *strongest* precisely in the environment this product occupies: a
> real-time, mechanistic visualisation you can watch. The mitigation is structural, and it
> is the whole design — **you do not get to see the answer until you have made the move.**
>
> The game is the retrieval-practice engine. The debrief is where the learning happens, and
> it asks, it does not tell.
