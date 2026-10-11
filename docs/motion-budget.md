# Focus Mode motion budget

Focus Mode is the one screen where every layer moves at once, so "it feels
smooth" needs a number attached to it. This is the budget, how it is measured,
and what the measurements changed.

## How to measure

```bash
node .freebuff/perf-focus.mjs            # off-screen window (quiet by default)
node .freebuff/perf-focus.mjs --visible  # window on screen, if the off-screen
                                         # window produces no frames
node .freebuff/perf-focus.mjs --layers   # + which layer repainted, how often
node .freebuff/perf-focus.mjs --trace    # + browser task names, paint cost per node
node .freebuff/perf-focus.mjs --profile  # + CPU profile, functions by self time
node .freebuff/perf-focus.mjs --entryBisect   # paired A/B on the arrival
node .freebuff/perf-focus.mjs --exitBisect    # paired A/B on the departure
node .freebuff/perf-focus.mjs --ghostProbe    # is anything invisible mounted at
                                              # start-up?
node .freebuff/startup-check.mjs 4            # start-up: when the list appears,
                                              # and its own first frames
node .freebuff/perf-summary.mjs <label> run1.json run2.json run3.json
node .freebuff/phase-table.mjs run1.json run2.json   # one line per run, and
                                                     # *where* its slow frames fall
```

The bisects inject their conditions as a stylesheet *before* the click — a
candidate fix is tested on the first paint, not as a re-raster — and bracket
every condition with a plain control, alternating inside one browser session.
That is what resolves effects smaller than the ±15% run-to-run spread. `--layers`
diffs a `LayerTree` snapshot of `paintCount` per layer across the window and
resolves each layer back to its DOM node, which is how a repaint gets a name.

The harness **starts the clock itself**, from the Pomodoro card, before the
arrival. That is not a detail. The app used to start a focused task's session by
itself the moment the overlay opened, and `entry`, `idle` and `exit` were
measured with a clock running because of it — and `idle` is the budget's most
important row precisely because it is the running state. A clock now runs only
because the user started one, so the harness starts one; otherwise every arrival
number would quietly change meaning to "a paused overlay" and the worst case
would stop being measured at all. Every report records `focus.clockRunning`, so
a run can be *shown* to have measured the state the budget is about.

The start-up pre-warm (change 8) had three instruments of its own: a `?nowarm`
seam in the app, `.freebuff/warm-bisect.mjs` (paired A/B across the two arms in
one session) and `.freebuff/warm-timeline.mjs` (placement: when the ghost mounted
and unmounted against when `main` appeared). All three went with the pass on
2026-10-11, and `warm-bisect.mjs` now refuses to run rather than compare the app
with itself. Two things they established are about *this machine*, not about that
pass, and are worth keeping anyway: the *first* arrival of a browser session
costs 133–216ms more than every later one in the same session (216ms against
50–83ms across four pairs), which is why a comparison of two single runs measures
the session rather than the change — and why a change that only touches the first
arrival needs a fresh-session control (three runs each side, clean controls) on
top of any paired bisect. `.freebuff/startup-check.mjs` replaced the timeline
probe: it loads the app N times from one session and reports, per load, when
`main` appears, whether anything invisible mounted, and the frame intervals of
the list's own first 400ms.

The harness (scratch, in `.freebuff/`) drives a local Chrome over the DevTools
protocol and records, per phase:

- **frame intervals** from `requestAnimationFrame` — the transition is driven by
  rAF, so interval pacing *is* visual smoothness
- **long tasks** (`longtask` PerformanceObserver)
- **cumulative layout shift** (`layout-shift` PerformanceObserver)
- **Blink render metrics** (`LayoutCount`, `RecalcStyleCount`, `ScriptDuration`)
  — cumulative since the renderer started, and durations are in **seconds**

It measures three controls and four phases, in this order:

| Phase | What it is |
| --- | --- |
| `calibration` | `about:blank` in the same window — the raw rAF cadence |
| `list` | the todo list, all CSS animations running |
| `listPaused` | the todo list with every Web Animation paused |
| `entry` | Focus Mode arrival, on a deliberately long (two-line) task title |
| `idle` | Focus Mode, settled |
| `exit` | leaving Focus Mode |
| `entry2` | the arrival again in the same session: chunks parsed, layers rastered, fonts loaded. A first arrival and a warm one are different events, and the budget applies to both |

**A run is only valid if every phase under `controls` holds 60fps** — no frame
longer than two vsyncs (> 33ms) and a p95 frame interval of one (≤ 17ms).
Background load on the machine shows up as noisy controls first; without the
controls, a busy machine is indistinguishable from a slow app. Run it three times
and take the median — run-to-run variance on one machine is around ±15%.

That rule is now enforced rather than remembered. It lives once, in
`.freebuff/perf-controls.mjs`, and every harness that records or reports a run
applies it:

- `perf-focus.mjs` and `startup-check.mjs` **refuse to write a report** when a
  control is dirty. They print the failing control and `RETRY` to stderr, a
  machine-readable refusal (`valid: false, retry: true, failedControls`) to
  stdout, and exit non-zero. `perf-focus.mjs` stops the moment it knows — the
  first control is measured before any phase that matters, so a dirty run costs
  seconds, not the full minute.
- `perf-summary.mjs`, `perf-print.mjs` and `phase-table.mjs` **refuse to print a
  table** from such a run, and exit non-zero. They judge the `controls` in the
  file themselves, so reports written before this rule existed get the same
  treatment as new ones.

A retry is therefore a shell loop, not a judgement call:

```bash
until node .freebuff/perf-focus.mjs > .freebuff/run1.json; do
  echo "controls dirty — retrying"
done
```

**What the controls do not catch.** They measure *frame pacing* — a blank page
and the list at rest — and that turned out to be insensitive to pure CPU
starvation. Ten busy loops on this 4-core machine left both controls clean
(`over33` 0, p95 16.7ms) while the app's own start-up went from `load` 38ms and
`list` at 100ms to `load` 614ms and `list` at 677ms — burst work on the main
thread is starved long before a compositor-driven page misses a vsync. So a clean
seal means "the frame pacing was fine", not "the machine was quiet": read a
number whose whole subject is a main-thread burst with that in mind, and prefer
the paired instruments when a difference is what is at stake.

## The budget

| Phase | Target | Why |
| --- | --- | --- |
| `idle` (settled) | 60fps, p95 ≤ 17ms, **0** frames > 33ms | this is the state the user sits in for 25 minutes; any dropped frame here repeats forever |
| `entry` / `exit` | median 16.7ms (60fps pacing), p95 ≤ 33.4ms (never worse than a single dropped frame), ≤ 15 frames > 33ms over the window | a cinematic arrival may cost a few frames; it may not stutter |
| all phases | CLS < 0.01, no long task > 50ms | motion must not move the layout, and must not block the main thread |

One frame in the first `entry` of a cold session is still far past 50ms — 200–350ms
across twelve runs on 2026-10-11 — and the `exit` keeps several single-vsync
drops in its first half-second (see below).

## Before / after

Median of three runs with clean controls, 1600×1000, hardware raster.

| Phase | Before | After |
| --- | --- | --- |
| `idle` | 30–45fps, p95 33.4ms, up to 22 frames > 33ms | **60fps, p95 16.8ms, 0 frames > 33ms** |
| `entry` | 26.9–31.8fps, p95 83.3ms, 44–49 frames > 33ms, max 116–766ms | **45.1fps, p95 33.3ms, 7 frames > 33ms, max 316ms** |
| `entry2` | 47.7fps, p95 49.3ms, 24 frames > 33ms, max 66.8ms | **50.8fps, p95 33.4ms, 16 frames > 33ms, max 83.1ms** |
| `exit` | 42.9–46.4fps, p95 66.7ms, 11 frames > 33ms, max 200ms | 47fps, p95 49.9ms, 11 frames > 33ms, max 66.9ms — **still over p95** |

The `entry` max is a single cold first-paint frame; the same arrival later in the
session tops out at 83ms. The last two changes of that round alone — the page
hidden once the overlay is opaque, and a layer for the instrument — moved the
arrival from p95 49.9ms / 10 frames > 33ms to p95 33.3ms / 7 (and the warm
re-entry from p95 49.3ms / 24 to p95 33.4ms / 16), with every bracketing control
clean. The arrival's *max* was the one number the start-up pre-warm was recorded
changing afterwards: 300–384ms before it, 200–266ms after (three runs each side,
clean controls, clock running), and nothing measurable once the session is warm.
That gap has since failed to reproduce with a proper control — see change 8.

Blink's render metrics are cumulative since the renderer started and in
**seconds** — reading them as milliseconds once made a ~600ms script total look
like 0.6ms, and that misreading is why the arrival was first blamed on raster. A
CPU profile over the arrival corrects it: the main thread is **idle for ~2s of
the 3s window**. The cost is **paint and raster work on composited layers** — a
layer-tree diff shows the stage layer repainting 93 times in one arrival, and the
page's sidebar 62 times behind an opaque overlay. CLS is 0 in every phase.

## What the measurements changed

1. **The page recede no longer animates `filter`.** It was `blur(7px)` on the
   whole app shell for the length of both transitions — animating a filter on the
   page re-rasterises the entire page every frame. Depth now comes from scale
   (`0.94`), a small rise and opacity, which the compositor does for free.
2. **The aurora drift no longer animates `scale`.** `drift-a` / `drift-b` scaled
   blobs carrying a 130–150px gaussian blur; a scale change forces the blur to be
   recomputed every frame. The drift is translate-only now, with
   `will-change: transform` so each blob keeps its raster.
3. **Those blurs are gradients now.** Two soft `radial-gradient` falloffs replace
   `blur(130px)` / `blur(150px)` — the same cloud, without a large gaussian in the
   overlay's first paint. The ring's halo lost its 64px blur the same way.
4. **The atmosphere is split into cheap layers.** Static base (dot-grid, vignette,
   grain) never transforms; the aurora only translates and fades; only the
   specks ride the push-in. The two breathing rings moved into the static base,
   because a scale animation on 560–760px rasters costs per-frame raster for no
   visible gain.
5. **Nothing scales or blurs a filtered subtree.** The session column and the
   instrument no longer scale on entry: the progress ring's arc carries a
   `drop-shadow`, and scaling (or blurring) its ancestor re-rasterises that filter
   every frame. The instrument rises and fades instead, and the clock keeps a
   small scale of its own (text, not a filter).
6. **`will-change` is left to Framer — with one measured exception.** Toggling
   it off by hand invalidated the shell's layer exactly when the exit animation
   started, so it stays off the shell. But the instrument is a different case: it
   is the one box whose *contents* keep animating forever (the arc, the comet
   head and the graduation ticks retick every 200ms), and without a layer of its
   own those repaints invalidated the whole stage layer — 93 repaints of an
   1863×870 layer in a single arrival. On its own, `will-change: transform` on
   that box measures inside the noise; together with the page-hide below it
   halves the arrival's dropped frames (20 → 8 in the paired bisect, controls
   unchanged). Promoting the h1 as well was worse, and the shell and stage
   conditions of the earlier rounds were neutral.
7. **The page stops painting once the overlay is opaque.** It kept painting
   behind the opaque overlay for the whole session — the sidebar's layer alone
   62 times in one arrival, all of it unseen. A `visibility` transition with a
   0.26s delay flips it off when the overlay's fade completes (the recede's own
   window), and back on with no delay on exit so the overlay has a page to fade
   over. The duration is 10ms, not 0: a zero-length transition never resolves in
   Chrome (it sits at `currentTime: 0` forever, leaving the page visible —
   verified in the running app).
8. **A hidden start-up pre-warm of the overlay was tried, held behind the
   loading screen, and removed.** The theory was that the cold arrival's worst
   frame is the overlay's *first paint* — layout, the first rasters of the
   full-screen gradients and the grain tile, the first pass of the animation
   code — so the same tree was mounted once at start-up at 1% opacity, `inert`
   and `aria-hidden`, touching no store, with `?nowarm` running the same build
   with it off. It settled two separate questions.

   *Placement* first: run in plain sight of the list's first paint, the pass put
   its own first commit, and later the teardown of ~45 composited layers, on top
   of the list's first frames; fusing that teardown with the shell's mount was
   the list's worst start-up frame. Held behind the loading screen (`warming`
   gating the shell, the ghost leaving a frame *before* the shell arrived), it
   cost ~300ms of skeleton and left the list clean: the ghost was gone 57–106ms
   *before* the list appeared, four pairs, never once still mounted when it did.
   A 1400ms pass — the whole choreography — was measured and rejected earlier: it
   did not improve the arrival, and while it still ran in plain sight it dropped
   the list's own start-up frames to 51–54fps in two runs of three.

   Then *benefit*, and that is where it ended. Re-measured on 2026-10-11 with
   `?nowarm` as the control, the cold arrival is not measurably worse without the
   pass: six fresh-session runs each side (`list` and `listPaused` clean in all
   twelve) give `entry` max 250, 350, 200, 266, 233, 282 **with the pass off**
   (median 250ms) against 250, 366, 316, 266, 266, 316 **with it on** (median
   266ms) — overlapping distributions, the dropped-frame count unmoved (median
   8.5 vs 9.5), the p95 unmoved (33.4 vs 33.3), and the paired bisect agreeing
   (`entry` max median 66.4ms vs 66.7ms, paired delta −0.5ms, sign mixed). The
   300–384ms → 200–266ms the pass was justified by did not reproduce, so it was
   paying ~300ms of skeleton for an effect under ~30ms at best, and it went —
   the seam, the ghost, its CSS and its two harnesses with it. What start-up
   looks like now (`.freebuff/startup-check.mjs`, four loads in one session):
   `main` at 98–173ms, `.focus-ghost` never mounted (as `--ghostProbe` agrees:
   empty log, no leftover dialog), the list's first-400ms window 50ms max.

   One thing the trial could not test is the *page*: the first arrival is also
   the page shell's first full-page transform and raster, which a pre-warm of the
   overlay cannot pay for by construction — see "What is left".

## What is left

**The cold first arrival is the session and the page, not the overlay tree.**
Inside one browser session the *first* arrival costs 133–216ms more than every
later one (216ms against 50–83ms across four pairs); every later arrival in a
session tops out around 83ms. So the residue is a cold browser session — a fresh
profile with no raster, shader, font or disk cache for anything — and an in-app
pre-warm cannot pay for it, because it runs in the same cold session. The
overlay pre-warm was built on the assumption that it could; with `?nowarm` as a
control it did not shrink the first arrival at all (medians 266ms with it, 250ms
without — change 8), so it was removed. The one candidate that trial never could
test is the *page*: the first arrival is also the page shell's first full-page
transform and raster, which an overlay pre-warm cannot pay for by construction.
That, and warming the session before the user ever opens the app, are the two
places left to chase — and there is a third, smaller one next door: the list's
own first paint still carries a ~50ms frame in every load
(`.freebuff/startup-check.mjs`), which the `list` control (sampled 700ms after
the shell appears) does not cover.

**The exit**, still over its p95 line: ~10 frames > 33ms (each a single missed
vsync, 34–50ms) in the first half-second, p95 between 33.4 and 50 depending on
the run. A paired bisect that switched off the transforms of the page and of the
overlay content — bracketed by plain controls — moved nothing: the cost is not
one animation, it is *tearing the scene down*, ~45 composited layers unmounting
in one commit while the page underneath repaints itself back.

The first candidate has now been priced as well. An `--exitBisect` condition
that takes the arrival-only layers out of the tree — the veil container and the
sweep, `matched: 2`, so it is provably the right elements — shaves about one
frame, and unreliably: one sample took the worst frame to 50.1ms and the other
took the p95 to 34.5ms, against nine control samples whose max never came below
66.4ms and whose p95 never below 49.7, while the dropped-frame count (10–13)
never moved in either. It is not the fix — and it is not free either: the app
would have to commit that removal somewhere, and the cheap moment (once the
veils have parked, ~1.15s in) sits inside `idle`, the one phase whose budget is
not worth spending on a single frame. Better bets, in order of expected gain: a
shorter exit, or hiding the overlay's content in one commit instead of
unmounting it animated.

**Ruled out by paired tests** (inside the noise, controls clean, so not worth
re-trying on this machine): the baked-PNG grain, hiding any *single* overlay
layer (grain, one veil, aurora, sweep) — taking all three arrival-only layers out
at once is worth about a frame, which is the paragraph above — and neutralising
the shell / lens / stage transforms.

**A note on the machine.** These numbers want a quiet one. On a busy machine the
`list` control goes dirty — two of three runs on the evening of 2026-10-10, with
other apps holding a core — and the harness now refuses those runs outright
instead of leaving them to be discarded by hand. The paired harnesses still
answer their question when a run cannot be recorded at all, because both arms
share whatever load there is; that is the other reason to reach for them first.
