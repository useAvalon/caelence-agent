---
name: copywriting
description: >-
  Routes copy work through a pipeline: RMBC, Harry Dry line test, then
  copy-editor and anti-AI-slop. Use when writing or editing headlines, CTAs,
  landers, product UI, or when the user says copy, RMBC, Harry Dry, audit
  copy, anti-slop, or copy editor. Any category. Invented metrics and
  testimonials stay illegal. Not visual QA (that is impeccable).
---

# Copywriting (router)

Do not dump every method into one prompt. Run the pipeline. Read each skill
when you reach it (`read_skill`).

```
COPYWRITING
     │
RESEARCH        POSITIONING
     └──────┬──────┘
            ▼
         RMBC
   Research → Mechanism → Brief → Copy
            ▼
   Harry Dry (body and proof)
            ▼
      COPY EDITOR
            ▼
      ANTI-AI-SLOP
            ▼
      FINAL COPY
```

| Step | Skill | Job |
|---|---|---|
| Sequence | copy-rmbc | Research, mechanism, brief, then copy. Facts from this project's brief only. |
| Line | copy-harry-dry | Body and proof: visualize / falsify / ownable. Not a kill-switch on a hero epithet. |
| Edit | copy-editor | Write vs edit. UI states. Sweeps. `[VERIFY]` or omit. |

**Invented proof is always illegal.** Never invent a number, testimonial, case
study, customer name, star rating, or sample metric. Unproven claims: omit, or
mark `[VERIFY]` in drafts. Shipped HTML never contains `[VERIFY]` or a fake
figure.

## Two jobs

| | Who | Facts and voice | Do not |
|---|---|---|---|
| **This product** | Landing, app, chrome for the repo you are in | That project's brief and `design.md` | Another product's palette or slogans. Invented lock-in stats. |
| **A customer's site** | The brief's business, any category | Spec, sitemap, hours, names, prices, place, product | Narrating how the website was built. Invented reviews. Importing the harness brand. |

Visual identity is separate: `impeccable` plus the project's `design.md`.
Impeccable is not the copy system.

A subagent can run one step (`task` with `skills: ["copy-rmbc"]`, then Harry
Dry, then copy-editor). Do not flatten the pipeline into one prompt.

## When to skip a layer

- **One UI string** (error, empty, button): copy-editor UI states only.
- **One headline to polish:** Harry Dry on that line if it is proof; then copy-editor.
- **Full lander from a facts brief:** whole pipeline in write mode. Facts stay locked. Wording is not. Restating the brief is a fail.

## Refused

- Direct-response funnel packs: VSL, cart abandonment, scarcity, supplements, bonus stacks, soap-opera, webinars, guaranteed fake proof.
- Quality gates that require a number, testimonial, or invented mechanism on every claim.
- Invented keep-examples. Quote a published line with who ran it, or use facts already in the brief.

## After the pipeline

One revision. Do not add proof to raise a score. Hand back final copy, not a
methodology essay. Visual polish: `impeccable`.
