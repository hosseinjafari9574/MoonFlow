# MoonFlow

A calm, premium todo app with an immersive **Focus Mode** and a **Pomodoro timer**.
Everything is stored locally in your browser — no account, no backend, no sync.

The name is the two things the app is built from. The **moon** is on the dial —
the instrument in the header and the favicon — and **flow** is the state Focus
Mode exists to protect: one ordered session at a time, then a break, then a
cycle. It also describes the look — graphite surfaces, ivory text, film grain,
and an aurora that only appears in Focus Mode. The mark is the app's own
instrument: a progress ring with the moon at its centre, and one indigo dot for
live phase. It lives in
`components/moonflow-mark.tsx`; `app/icon.svg` is the favicon — the same
composition on a graphite tile so it reads against both light and dark browser
chrome, with the dial inset and the stroke widened so the ring keeps a real
margin at 16px (the dot stays: it survives there as four pixels of indigo).
Geometry, measured clearances and the rejected alternatives are in
[docs/mark.md](docs/mark.md).

Formerly *Cadence*, then *Nocturne*; the current name is **MoonFlow**. The
localStorage keys still say `cadence:` — see *Data & persistence* below.

Names screened and rejected for collisions: *Vigil* (surveillance/VMS software),
*Sundial* (timekeeping, HR and analytics), *Tessera* (three funded companies).

## Stack

- **Next.js 15** (App Router) + **TypeScript**
- **Tailwind CSS v4** with a deep dark theme — the *Graphite & Ivory* palette:
  graphite surfaces, ivory text and a single electric-indigo accent reserved for
  live state
- **Framer Motion** for every meaningful animation, driven by a shared motion
  system (`lib/motion.ts`)
- **Inter** for prose, **Geist Mono** for every number (clock, counts, stats)
- **shadcn/ui** base components (Button, Input, Dialog, Label, Switch, Badge)
- **Zustand** for state, persisted to **localStorage**

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run typecheck  # tsc --noEmit
```

## Features

- **Focus Mode** — a full-screen, distraction-free view with a cinematic
  backdrop (slow aurora drift, floating specks, vignette and film grain), a
  glowing progress ring with a comet tip and minute graduations, staggered
  entrance choreography, session-phase shockwaves and a completion celebration.
  Only the essentials: Pause / Complete / Exit. `Esc` leaves any time.
- **Phase tones** — focus is the only colourful state (indigo); every break
  drains to hue-less ivory, so the shift is felt before it is read. The
  full-screen aurora, ring, controls and eyebrow all follow the same tone.
- **Phase-completion beat** — when a session or a full cycle ends inside Focus
  Mode, a brief centrepiece badges the change (amber for a completed cycle).
  Any key or tap skips it instantly, and it never blocks the timer.
- **Pomodoro** — two rhythm presets, switchable at any time before a
  session and remembered across reloads:
  - **Classic** — 25 min focus / 5 min short break / 15 min long break after
    four sessions
  - **Deep Work** — 50 min focus / 10 min break (20 min long break after four
    blocks)
  A smooth hand-off: when a session ends, the next phase arms itself and the
  state changes on its own — but the clock never starts itself, every session
  waits for your Start. Optional sound feedback, session counters, skip and
  reset. Completed sessions are persisted per task and overall.
- **Tasks** — create, edit, delete, complete, plus optional priority and tags
  with tag filtering.
- **Stats & streak** — completed today, focus minutes today, current streak and
  a last-7-days focus chart.
- **Sound effects** — synthesised WebAudio chimes (no assets), toggleable.
- **Toasts** — undo for delete and completion.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `N` | New task |
| `↑` / `↓` | Move selection |
| `X` | Complete selected task |
| `E` | Edit selected task |
| `F` | Toggle Focus Mode |
| `Space` / `P` | Start / pause the pomodoro |
| `?` | Shortcut list |
| `Esc` | Exit Focus Mode / close dialogs |

## Structure

```
app/            layout, page shell, global styles + design tokens (@theme)
components/     feature UI (list, focus mode, pomodoro, stats…) + ui/ (shadcn)
hooks/          timer engine, global keyboard shortcuts, page visibility
lib/            pure helpers (activity, format, sound, actions) + motion & tone systems
store/          Zustand stores (todos, timer, transient UI)
docs/           the mark spec (geometry, clearances, regeneration)
```

## Design system

Tokens live in `app/globals.css` under `@theme` (`background`, `foreground`,
`ivory`, `primary`/`primary-soft`, `achievement`, surfaces 1–3, hairline and
surface overlays, the `--text-*` type scale, and the sans/mono families).
Reusable layer: `.panel` (matte gradient-bordered surface), `.inset`, `.kbd`,
`.hairline`, `.ambient`, `.skeleton`, `.dot-grid`, `.grain`, `.float-up`.

Motion is centralised in `lib/motion.ts` (durations, springs, variants) and
phase colour in `lib/tone.ts` — components read the tone by timer mode instead
of hard-coding colours. Every animation respects `prefers-reduced-motion`.

The Focus Mode entry/exit has a measured frame budget — what it is, how to
re-measure it, and which optimisations it already paid for are in
[docs/motion-budget.md](docs/motion-budget.md).

## Data & persistence

Everything lives in `localStorage` under two keys (`cadence:todos:v1`,
`cadence:timer:v1`). Those names predate the rename and stay frozen on purpose —
renaming them would orphan existing local data. Upgrades are driven by the
`version` field inside each payload instead.

Every hydrate runs through `lib/persist.ts`, whether the payload matches the
current version, needs a migration, or predates versioning altogether. A stored
shape we no longer recognise is *repaired* rather than discarded: missing task
fields fall back to defaults, a missing task id is regenerated, an unknown
timer mode or preset falls back to Classic focus, a running clock with no end
stamp reads as paused, and a payload stamped with a *newer* version is
normalised instead of thrown away. Only entries carrying no information at all
(a task with no title, a day key that isn't a day key) are dropped.
