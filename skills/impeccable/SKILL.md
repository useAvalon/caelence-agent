---
name: impeccable
description: >-
  Visual QA using Impeccable-style checks. Use when designing, reviewing,
  auditing, polishing, or fixing a page: contrast, type, spacing, radii,
  icons, layout slop, light and dark. Also when the user says critique this
  page, impeccable critique, polish this page, impeccable-caelence, or names
  this skill against HTML/CSS. Honor the host project's design.md. Not the
  copy system (use copywriting).
---

# Impeccable checks

Adapted from [Impeccable](https://github.com/pbakaus/impeccable) (Apache 2.0,
Copyright 2025 Paul Bakaus). This skill is **not** a vendor of that repository.

**Visual authority:** the host project's `docs/design.md` or `design.md` if
either exists. Read it before changing UI. Do not dump a whole tokens file
into context. If there is no design doc, use the checks below as the floor
and do not invent a second typeface, a new radius scale, or a decorative
gradient.

**Copy is another layer.** Wording, proof, and anti-slop live in
`copywriting`. This skill does not own the copy pipeline. Flag kicker chrome
and stock section labels as *layout* when they appear; do not run RMBC,
Harry Dry, or the copy editor from here.

A pinned project brief wins over taste. Redirecting the host toward Geist,
shadcn, or a purple SaaS kit is failure unless that brief already committed it.

## How to invoke

No npm installer. No `/impeccable` binary. Ask this agent:

| You say | This skill does |
|---|---|
| critique this page / impeccable critique | Punch list of named *visual* slop, then one fix pass |
| polish this page | Same checks, subtractive pass |
| audit this page | Technical quality (contrast, heading levels, overflow), then fix |

Point at HTML/CSS in the conversation, or a path. A `task` subagent can run
critique on one file.

## Setup

1. Read `docs/design.md` or `design.md` if this session has not.
2. Inspect the actual result when a browser exists (first viewport, full page,
   light and dark if the host has both). One batched pass, then fix, then at
   most one confirm pass.

## Checks (measure the built result)

Run against the built result, not intention. Host tokens win when named.

- **Contrast:** body ≥ 4.5:1 on the actual surface. White text only on a fill
  that was measured for white. Never white on a mid accent or on orange/warning.
  Gray text on a coloured fill is a fail. On dark, measure against the card
  surface, not pure black.
- **Primary fill:** at most one primary button per screen. Outline-with-colour
  is for selection, not a second primary. In progress **moves**; done is
  **still**. No static brand fill on a running state.
- **Neutrals:** do not mix two grey families for the same job (paper vs
  instrument, page vs chrome).
- **Type:** the faces the design doc names, and no third. Sentence case on
  labels. Mono only for machine strings (paths, IDs, logs, dimensions).
- **Shape:** a short radius scale (for example 4 / 8 / 12 / full). Hairline
  borders. No gradients, blur, or shadow except on genuinely floating layers
  (menu, popover, modal).
- **Icons:** one family, one weight per panel. Do not mix line with filled.
  Icon-only controls need an accessible name.
- **Deleted brand red** if the design doc retired one. Do not reintroduce it.

## Refuse (visual AI slop, unless the brief already committed it)

Named Impeccable anti-patterns. Check the markup. Longer list:
`references/visual-slop.md` (`read_skill` name `impeccable`, file that path).

- **Italic display headline.** `font-style: italic` on h1–h3, hero lines,
  section titles, or panel headings. Do not wrap a headline in `<em>` or `<i>`
  unless the design doc specifies italic display.
- **Kicker / eyebrow label above heading.** A small label above an h1/h2
  (uppercase, tracked, or a quiet category word). Same for a hero eyebrow /
  pill chip. Delete it. Wording of a replacement heading is copy-pipeline work.
- **Stock section labels as the only heading.** How it works, Features,
  Platform, Pricing as the only heading, Our story, Get in touch, Why choose us,
  as an h2 **or** as a kicker. Nav may use those words; that is not a license
  to put the same word above the h2.
- Same-size icon + heading + text cards as the page structure; nested cards;
  side-tab accent borders
- Icon tile stacked above a heading as a repeating feature-card grid
- Hero-metric template (big number, small label, accent). Do not invent numbers
- All-caps product tags as a default
- Gradient text, glass, decorative blur, glow, fake 3D
- Purple-to-blue / indigo / cyan-on-dark gradients, Inter-for-everything, Geist
- Extreme radius / `9999px` pills on cards or sections (full-pill is for small
  controls)
- Centered everything; three identical marketing cards. Repeating that
  equal-card grid in every section is the same slop
- Bounce / elastic easing
- Emoji in headings, or emoji standing in for the icon set
- Middle-dot `·` crumb chrome (`label · label · label`)
- Tiny muted prose to fake density
- **Product chrome as marketing hero.** Filling the first viewport with
  rulers, a canvas bed, selection handles, wireframes, or a mini editor
  unless that *is* the product shot the brief asked for

## Critique mode

When the user asks to critique a page:

1. Read the design doc if this session has not.
2. Inspect the markup (and the browser if it exists).
3. Emit a punch list of **named visual slop only**. Cite the rule.
   No score, no persona theater, no invented defects. Do not audit voice,
   proof, or banned marketing words here.
4. Apply the visual fixes in the same turn. Cap at **one** revision unless the
   user asks for another.

Punch list shape:

```json
{ "findings": [{ "rule": "kicker / eyebrow label above heading", "where": "kicker: How it works", "fix": "Delete the label. Start the section on the claim." }] }
```

Empty `findings` means the visual page is clean. Flag How it works anywhere
prominent (kicker, label, h2). Flag label-above-title. Nav labels and footer
column titles are not findings.

## After the pass

Fix the highest-impact systemic visual defect. In check mode, do not deliver a
scorecard unless asked. Critique mode emits the punch list, then fixes.
Copy wording: `copywriting`.
