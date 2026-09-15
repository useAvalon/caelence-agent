# UI state copy

Product strings, not lander persuasion.

Buttons are verbs that match the state they produce: `Start building` →
`Building`. Feature and panel titles are bare noun phrases. Descriptions are
one mechanical sentence. No second-person persuasion inside a description.

Errors say what happened and what to do next. No apology, no blame, no
personality, never humour.

> Good: `Builder service is unreachable at localhost:8788. Is it running?`
> Bad: `Oops! Something went wrong :(`

Empty states name what is missing and offer one action.

> `No drafts in progress. Start one in the builder.`

## Destructive labels

Verb plus object. Never `Confirm`, `OK`, `Yes`, or a bare `Delete` on a
consequential action.

| Bad | Good |
|---|---|
| Confirm | Delete project |
| OK | Remove member |
| Success! | Changes saved |

## Canonical verbs

One verb per operation, used everywhere: Create vs Add, Delete vs Remove,
Archive, Save vs Apply, Cancel vs Discard.

## Loading

Prefer `Loading your projects` over bare `Loading...` when the target is known.
Do not invent a duration.

## Permission

Benefit, then the ask. Ask in context, not at launch.

## Without the screen

No "click here", no "above" / "below". Name the place (`in Settings`).
