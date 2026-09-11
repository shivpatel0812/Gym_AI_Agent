---
name: frontend
description: Conventions and a defect checklist for this repo's UI code. Use when creating or editing any screen, component, or style in frontend/ (React Native + Expo) or web-app/ (React + Vite + Tailwind) — including "add a screen", "fix this component", "style this", "review the UI", or any .tsx change.
---

# Frontend work in gymaiAgent

## First: which frontend?

**There are two, both live.** Getting this wrong wastes a whole edit.

| | `frontend/` | `web-app/` |
|---|---|---|
| Stack | React Native 0.86 + Expo 57 | React 18 + Vite 5 |
| Styling | `StyleSheet.create` | Tailwind 3 |
| React | 19.2.3 | 18.2 |
| Routing | `@react-navigation` | `react-router-dom` 6 |
| Icons | `@expo/vector-icons` | `react-icons` |

`frontend/` is the mobile app and gets the most traffic. `web-app/` is still
maintained. Check which directory the file lives in before writing a line —
Tailwind classes in `frontend/` and `StyleSheet.create` in `web-app/` are both
silently wrong.

## CLAUDE.md is stale about the UI

Trust this file over the root `CLAUDE.md` for anything visual:

- CLAUDE.md documents only `web-app/` and never mentions `frontend/`.
- **The accent is `#9CC0E8` (blue), not `#FF6B35` (orange).** The theme moved
  and CLAUDE.md did not. `theme.ts` still carries the comment recording it.
- Port 5173 is `web-app/` only. The mobile app runs through Expo.

Read `frontend/src/theme.ts` for live values rather than quoting hex from
memory. `colors.ai` (`#5EEAD4`) marks AI-generated content; `colors.onAccent`
is what goes *on top of* an accent fill.

## Conventions in `frontend/`

- `import { colors, spacing } from "../../theme"` — depth varies, no alias.
- `import apiClient from "../../api/client"` — never bare axios; the client
  attaches the Firebase token.
- `StyleSheet.create` at the **bottom** of the file, named `styles` (72 files)
  — `s` appears in 2 and is not the pattern to copy.
- `useSafeAreaInsets()` for any full-screen surface. Bars need
  `Math.max(insets.top, N)`, not a bare constant.
- Overlays that must not eat touches need `pointerEvents="none"`.
- Long-running requests set an explicit `timeout` — the client default is 30s
  and AI calls exceed it. Vision calls use 120000.

## Defect checklist

Every item below is a real bug found in this repo, not a generic warning.
Check these before calling UI work done.

**Silent `catch {}`.** "The user can retry" only works if they know it failed.
Every failure path needs visible state. `ScanFoodCamera.takePicture` swallowed
shutter errors, so the button did nothing and the fallback below it was
unreachable.

**Derived values must scale together.** If you multiply macros by a serving
count, `estimatedGrams`, component ledgers, and any other derived field move
too. Scaling only the visible numbers wrote saved foods with 3x calories
against 1x grams, corrupting every future re-log. Prefer one tested helper
over an inline spread-and-override.

**Comparing against state you just replaced.** `wasAdjusted` compared the
logged macros to `photoResult` — but accepting a revision *replaced*
`photoResult`, so the "before" was already the corrected value and every
correction read as no-change. If a handler overwrites the baseline, track the
event with an explicit flag.

**Effects that re-trigger their own dependency.** A `useEffect` that calls
`requestPermission()` with `permission` in its deps re-runs when the request
resolves. On Android `canAskAgain` stays true after a plain Deny, so that is an
inescapable prompt loop. Gate one-shot side effects with a ref.

**Formatting applied twice.** `adjustPhotoEstimate` bakes a `"Larger · "`
prefix into `amount`; the JSX prefixed it again. If a helper returns a
display string, render it, don't decorate it.

**Dead branches that are also wrong.** The Smaller/Larger rendering had no
control that could set `portion`. Unreachable code stops being reviewed and
rots. Delete it or wire it.

**Labels that overclaim.** A "Health Score" was rendering photo legibility, so
a sharp photo of a donut scored 8/10. Name what the number measures. If the
honest number does not exist yet, show nothing rather than a placeholder.

**New files must be `git add`ed.** A tracked-and-modified file importing an
untracked one passes local typecheck and breaks the build on a fresh checkout.
`web-app` and `frontend` have both been hit. After adding a component, confirm
it is staged.

## Verifying

```bash
cd frontend && npx tsc --noEmit          # must be clean
cd frontend && npx vitest run            # unit tests
```

Typecheck passing is not evidence the screen works — none of the defects above
are type errors. Trace the state by hand: what sets it, what resets it, what
happens on the second pass through the flow.

Known-failing and unrelated: `backend/tests/test_plan_context.py::TestDayResolution::test_finds_exercise_without_a_named_day`.
