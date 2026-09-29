# Linked-list learning path

## Goal

Give a learner enough reading material to understand a singly linked list, then let them choose a real exercise, write a solution in a familiar language, generate a low/medium/high game for that exercise, play through the algorithm, and review the code that matches their run.

## Source and licensing choices

- Use [TheAlgorithms/Python](https://github.com/TheAlgorithms/Python), whose repository is MIT licensed, as a reference for conventional linked-list representations and operations.
- Use [trekhleb/javascript-algorithms](https://github.com/trekhleb/javascript-algorithms), also MIT licensed, for its per-topic explanations and further-reading structure.
- Link to those projects in the lesson. The lesson prose, examples, and question wording in this app are original; question prompts are mapped only to algorithms that already have a playable oracle. This avoids copying a question sheet whose content may have separate terms from its repository.

## Learner flow

1. Home links to a Linked List lesson with a node/pointer diagram, traversal and reversal explanations, complexity notes, and source links.
2. The exercise bank contains two first-party prompts: count nodes and reverse a singly linked list. Each prompt offers low, medium, and high game generation, mapped to `linked-list-traversal` or `reverse-linked-list`.
3. The problem screen carries the selected prompt and difficulty into the existing generator. The oracle, not the language model, checks each move and determines when the question is solved.
4. A learner can draft a solution in JavaScript, TypeScript, Python, Java, or C++. Drafts stay in local browser storage. The worked answer is available after attempting the question and in the lesson reference.
5. Winning the mapped game marks that exercise solved on the lesson page. The debrief shows pseudocode, the played trace, and language-specific reference code.

## Implementation order

1. Add one typed linked-list curriculum module as the source of truth for lesson text, original prompts, game mappings, and five-language examples.
2. Add `/learn/linked-list`, link it from Home, and add saved language-specific answer drafts plus difficulty-specific game links.
3. Carry question ID and difficulty into the existing problem screen; do not create a second game engine or weaken oracle validation.
4. Give the linked-list oracle genuine JavaScript, TypeScript, Python, Java, and C++ listings with aligned source-line numbers, then include all five in its debrief.
5. Save solved exercise IDs locally only after a linked-list game reaches the oracle's won phase.
6. Verify the page, each mapped difficulty's generated instance size, game completion, saved progress, and five-language debrief in the running app.

## Expansion rule

Add more linked-list questions only when the app has both (a) a clear learning objective and (b) an oracle that can generate, check, and finish a corresponding game. This keeps every listed question playable rather than advertising unsupported exercises.
