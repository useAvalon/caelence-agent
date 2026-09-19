---
name: copy-editor
description: >-
  Edits and writes product and marketing copy: clarity, specificity, voice,
  and anti-AI-slop sweeps. Use when the user says copy editor, fix the copy,
  remove AI-isms, anti-slop, CTA, or after RMBC and Harry Dry. Two modes:
  write and edit. Any category. Never invent proof. Not visual QA.
---

# Copy editor

Adapted from [mblode copywriting](https://github.com/mblode/agent-skills)
(MIT as stated for that skill). Ideas from George-Brothers Copywriter: swap
test, `[VERIFY]` instead of invented numbers. Not a vendor of either repo.

Router: copywriting. After copy-harry-dry. Always load `references/anti-slop.md`
(`read_skill`, `file` set to that path).

Sentence case. Oxford comma. Present tense. No exclamation marks.

**Unproven claims:** omit, or `[VERIFY]` in a draft. Never a fake figure,
testimonial, or metric. Shipped HTML must not contain `[VERIFY]`.

Product chrome (error, empty, button, settings) is mechanical: a verb that
matches the state, one-sentence descriptions, errors that say what happened
and what to do next. Do not treat lander or article body as UI chrome.

## Modes (do not ask)

- Copy exists or was pasted **and the job is to polish it**: **Edit**.
- Nothing written yet, or a **facts brief** for a lander: **Write**.
  Descriptive sentences in a brief are facts, not drafted copy.
- Ambiguous with no copy in scope: ask one question, then commit.

Point edit: change only the named line plus connective tissue.

## Write

1. Brief: page, goal, reader, core outcome. Mark inferred fields.
2. Voice: this project's brief.
3. Marketing or prose: RMBC already chose the angle.
4. One strong draft.
5. Harry Dry on body and proof.
6. Verify: no banned word, no invented specific, every supplied fact kept.

## Edit

1. Read the copy in context.
2. North star only if that pain is in the brief. Do not invent the pain.
3. Swap test on **proof lines** against a competitor in this category.
   Also swap-test a hero that is `The {category} for {audience}`. Do not
   demand a number to keep a named role.
4. Anti-slop: load `anti-slop.md`. Flag `[AI-ISM]`.
5. Sweeps (in order): clarity, voice, so-what, prove-it (omit or `[VERIFY]`,
   never invent), specificity from the brief, CTA as a verb matching the state.
6. Flag 3-7 weakest lines. Labels: `[VAGUE]`, `[DEAD-WEIGHT]`, `[AI-ISM]`,
   `[NO-PROOF]`, `[WEAK-CTA]`, `[STATE-COPY]`, `[SWAP]`, `[APHORISM]`
   (repeated `Not X. A Y.` down the page; one hero thesis is allowed),
   `[THEATER]`, `[EYEBROW]`, `[STOCK-H2]`, `[LIST-H2]`, `[INSTRUCTION-HERO]`,
   `[UI-NARRATION]`, `[EMPTY-EPITHET]`, `[TAUTOLOGY]`, `[EMPTY-PROCESS]`,
   `[FREE-HEADLINE]`.
7. Rewrite flagged lines. Cut hard. Do not add proof.
8. Optional mechanical lint, if the draft is a file under the project:
   `python3` on this skill's `scripts/lint-copy.py`.

`[STATE-COPY]` is for product chrome only. Do not flag lander body as UI
state copy.

Visual layout (kickers, equal cards) is `impeccable`, not this skill.

## Prove-it (inverted)

A missing quote is correct. `[NO-PROOF]` means the line *claims* proof it
does not have: cut the claim, or `[VERIFY]`. Do not fetch a sample quote
to "fix" it.

## After

One revision. Before/after only when editing. Do not add a methodology essay.
