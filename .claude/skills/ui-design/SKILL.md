---
name: ui-design
description: Visual and interaction design for the GymAI mobile app — color tokens, type scale, spacing, touch targets, the states every async surface owes, and dark-theme contrast. Use when designing or restyling any screen or component in frontend/, choosing a color or font size, building a card/badge/chart, or when asked to make UI look better.
---

# Designing UI in `frontend/`

Companion to the `frontend` skill: that one covers conventions and defects,
this one covers how it should look. React Native + Expo, dark theme, no
Tailwind.

## Never type a hex or a font size

`frontend/src/theme.ts` is the source. Import from it.

```ts
import { colors, macro, spacing, typography, weight } from "../../theme";
```

A Sep 2026 audit found **129 distinct hex literals** and **21 distinct
`fontSize` values** across 54 component files, against ~20 tokens. That is the
design system failing, not people being careless: the tokens did not cover
what screens actually needed, so everyone routed around them. The tokens below
were added from measured usage, so the thing you reach for now exists.

If a color or size you need genuinely has no token, add one to `theme.ts` with
a comment saying what role it plays. Do not paste a literal — that is how the
drift started.

### Color

| Role | Token |
|---|---|
| Primary text | `colors.textPrimary` |
| Secondary text, inactive icons | `colors.textMutedCool` |
| Tertiary, disabled, faint | `colors.textFaintCool` |
| Screen background | `colors.background` |
| Card | `colors.cardBackground` |
| Raised card | `colors.surfaceRaised` |
| Recessed well, scrim | `colors.surfaceSunken` |
| Hairline | `colors.border` / `colors.borderCool` |
| Selected outline | `colors.borderCoolStrong` |
| Accent | `colors.accentPrimary` (blue `#9CC0E8`) |
| Text **on** an accent fill | `colors.onAccent` |
| AI-generated content | `colors.ai` (teal) |
| Success / warning / danger | `colors.success` / `.warning` / `.danger` |
| Soft warning, short of danger | `colors.attention` |
| Macro + metric marks | `macro.calories` `.protein` `.carbs` `.fats` `.fiber` `.sleep` |

**The app speaks in cool, blue-tinted greys.** `colors.textSecondary`
(`#8E8E93`) is a neutral iOS grey that predates the palette shift and appears
6 times; `colors.textMutedCool` (`#7C8CA0`) appears 80. Use the cool ramp.

**The accent is blue, not orange.** Root `CLAUDE.md` still says `#FF6B35`. It
is wrong.

`macro.*` are data marks — for chart series, rings, and macro figures. Keep
them off buttons, borders and backgrounds, or a carb reading and a warning
state start looking like the same thing.

### Type

Seven steps: `micro` 10, `caption` 12, `body` 14, `title` 16, `heading` 20,
`display` 24, `hero` 32. Every existing size lands within ±2px of one of
these, so adopting a step is a visual no-op almost everywhere.

Weights: `weight.regular` `.medium` `.bold` `.heavy`.

Do not reintroduce 11/12/13/14 as four separate decisions — they are not four
perceptibly different sizes, and 593 of the app's ~800 size declarations are
one of those four.

### Spacing

`spacing.xs` 4 → `spacing["3xl"]` 48. Raw padding numbers currently outnumber
token uses 915 to 741; do not widen that gap. Radii come from `borderRadius`;
`999` for pills is fine as a literal.

## Craft rules

**Touch targets are 44×44 minimum.** A 14px icon in a 20px box is not
tappable. Either size the container or add `hitSlop`.

**Every async surface owes four states**: loading, empty, error, loaded. Ship
all four or you ship a screen that looks broken on a slow network. The error
state must be visible text, not a swallowed exception — see the `frontend`
skill's checklist for the real bug this caused.

**Never show a number you cannot stand behind.** If a value is missing, say so
in words. A placeholder score reads as data. This is why the goal-fit badge
renders nothing without a plan target rather than a zero.

**Color is never the only signal.** Pair it with a number, a label, or an
icon. The fit badge shows the band colour *and* the score *and* the reason, so
it survives colour-blindness and a bright screen outdoors.

**Respect the notch.** `useSafeAreaInsets()` on any full-screen surface;
`Math.max(insets.top, 12)` rather than a bare constant, so it works on devices
without an inset too.

**One hero per screen.** `typography.hero` is for the single figure that is
the point of the view. Two heroes means neither is.

**Dark theme needs surface separation, not borders everywhere.** Prefer
stepping `background` → `cardBackground` → `surfaceRaised`. Reach for a
hairline only when two surfaces at the same level must be distinguished.

## Charts

Load the `dataviz` skill before writing chart code.

One decision is already made and recorded in `CLAUDE.md`: plot marks use
`SERIES_COLORS` (`#0D9488` / `#E2622B`), **not** the UI accents — the brand
teal and orange sit above the lightness band that reads as a data mark on
`#161A22`. Validated for colour-vision separation and contrast. No dual-axis
charts; give each unit its own frame.

## Mocking before building

For a screen worth exploring before committing to `.tsx`, use the `design`
skill — it produces an editable multi-artboard canvas. Cheaper to compare
three layouts there than to build and rewrite one.

## Checking your work

```bash
cd frontend && npx tsc --noEmit
grep -c '"#' <file>          # should be 0 in new components
```

A clean typecheck says nothing about whether the screen looks right or the
states are covered.
