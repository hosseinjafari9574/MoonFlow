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
node .freebuff/visual-check.mjs              # phone viewport (390x844 @ DPR 3):
                                              # the blooms' pixel falloff against
                                              # an unmasked reference of the same
                                              # fill, and that Focus Mode's speck
                                              # layer and ring halo never scale,
                                             # and that a departure freezes both
                                             # without snapping them back
node .freebuff/perf-tick.mjs --label before   # the *running* clock: Layout /
                                              # UpdateLayoutTree / Paint counts
                                              # and main-thread time per second,
                                              # running vs paused, bisected
node .freebuff/visual-ring.mjs capture before # the ring's pixels in a frozen,
node .freebuff/visual-ring.mjs diff before after   # deterministic state
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
arrival. That is not a detail. `entry`, `idle` and `exit` are all measured with a
clock running, and `idle` is the budget's most important row precisely because
it is the running state — the instrument reticks its arc, comet head and ticks
every 200ms. Entering Focus Mode starts the session by itself now, so the
explicit start is kept as a control rather than a necessity: it makes the arrival
independent of the entry path (the clock is running *before* the click, so the
arrival cannot be measuring its own first tick), and it is the path a user takes
who starts from the card and then opens the overlay. Were the clock left paused,
every arrival number would quietly change meaning to "a paused overlay" and the
worst case would stop being measured at all. Every report records
`focus.clockRunning`, so a run can be *shown* to have measured the state the
budget is about.

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
| `exit` | 42.9–46.4fps, p95 66.7ms, 11 frames > 33ms, max 200ms | 47fps, p95 49.9ms, 11 frames > 33ms, max 66.9ms — **still over p95** (the departure pass below brings it inside) |

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

9. **The departure is a shorter window, one moving layer fewer, and a frozen
   scene.** The exit's dropped frames were not a teardown spike. `phase-table.mjs`
   places them *throughout* the window — 97, 181, 231, 264, 297, 347, 381, 430,
   464ms after the click — so the window itself is what a departure costs, and
   the last 0.14s of the old one paid for a full-page transform and overlay
   compositing on a page that had already been fully visible for two frames.
   Three things came out of that. The sheet's fade is 0.26s plus a 0.02s delay
   instead of 0.4s plus 0.04s, matched by the page's recede (0.28s, from 0.42s)
   rather than outliving it. The aurora and the speck layer lost their own exit
   animations, which the sheet's fade was already multiplying — two
   full-viewport layers moving in every frame of the fade for a difference
   nobody can see. And every eternal animation in the scene — the two breathing
   rings, the sixteen specks, the live dot — is frozen for the fade by
   `.departing` (app/globals.css), applied to the overlay's live DOM node from an
   effect, because the tree `AnimatePresence` keeps mounted during an exit is the
   one from *before* the store flipped and every `className` in it still says the
   overlay is open. `paused`, never `none`: ending an animation snaps its element
   back to its unanimated value, and a 760px ring jumping 4% at the start of the
   fade would be visible, whereas a paused one holds the frame it was on.

   Median of three runs, controls clean in all six: `exit` p95 **49.9 → 33.4ms**,
   frames > 33ms **9 → 6**, fps 49.3 → 52.7, and the drops that remain fall inside
   the fade (last slow frame at 138–416ms, against 464–518ms before) instead of in
   its tail. `idle` is unmoved — 60fps with no frame > 33ms — and the arrival reads
   the same within the noise its p95 has always carried: frames > 50ms were 5, 4,
   3 (median 4) across the three baseline runs and 5, 5, 5 across the three after
   runs, while its p95 moved 34.1 → 49.6ms. That phase has ~10 slow frames out of
   ~150, so its p95 sits on the boundary between the eighth
   and ninth slowest frame and flips between 33 and 50 on a single frame; `over33`
   and the > 50ms count are the numbers to read for an arrival.

## The phone pass (2026-10-11)

Reported from the deployed build on a real Android phone: the Focus Mode arrival
"glitches" and its animation looks wrong. Four things changed — three in the
moving layers, one in the timer. None of them is a frame-budget item: the
controls call all of this healthy, because restarting a tween or re-rastering a
blur costs frames only when the device is slow enough to notice. They are
correctness bugs in the motion, so they were measured with a different
instrument: `pixels` compared against an unmasked reference, and computed
`transform`/`opacity` sampled over time (`.freebuff/visual-check.mjs`).

1. **The big blurs are masks now.** The three `.ambient` page blobs (520, 460 and
   288px) and the Pomodoro card's glow carried `filter: blur(90px)`. A 90px
   gaussian on a layer that size is expensive at phone DPRs, and it is recomputed
   whenever the layer is re-rastered — a `position: fixed` blob is re-rastered
   when the mobile browser collapses its chrome on scroll, and the card's glow
   sits inside the shell that *scales* on the way into Focus Mode (change 1
   keeps that scale). `.bloom` — a radial `mask-image` over the same fill — gives
   the same cloud without running a kernel. Verified per fill, masked against an
   unmasked square of the identical colour: centre 51/51 (`primary/20`), 14/14
   (`ivory/6`), 26/26 (`primary/10`), 64/64 (`primary/25`); ≤2 levels left by the
   box's own edge; nothing painted outside it; largest step along the walk 1–2
   levels of 255 (8 on the white control, i.e. one gradient sample).

2. **The specks no longer ride a scaling layer.** `focusLens` pushed in with
   `scale: 1.05 → 1` over 1.05s. The dots are 1–2.5px, so a scaling ancestor
   resamples every one of them on every frame of that move, and at a phone DPR
   (2.6–3) they flicker and crawl. The settle is a translate and a fade now — the
   same read, no resampling. Verified: the speck layer's computed scale stays
   exactly 1 through the settle (`lensScale [1, 1]`) while all 16 specks still
   mount and drift.

3. **The ring halo's breath was restarting five times a second** — the actual
   bug behind "the animation looks wrong". Two changes live here. The halo used
   to scale (1 → 1.035) forever on a full-ring layer, over a ring whose arc,
   comet head and graduation ticks repaint every 200ms; the breath is
   opacity-only now. But the reason it was *wrong* is its animated target:
   `{ opacity: [0.5 + progress * 0.25, 0.95] }`. Framer restarts an animation
   whose target changed, and `progress` is rebuilt from `remainingMs` on every
   200ms tick — so the breath restarted about five times a second and never got
   past its opening frames. Measured in the phone viewport: the halo's opacity
   moved **0.500 → 0.504 across 4.5 seconds**, while the CSS-driven base ring in
   the same overlay, in the same window and on the same frames, completed its
   entire 8s loop (scale 0.980 → 1.04). That control matters: on its own, a
   frozen number could have meant a throttled sampling window, and it did not.
   The targets are constants now, and the progress signal moved into the halo's
   own gradient — a style, so a repaint, never a restart — quantised to 5% steps
   so a whole session costs ~20 repaints instead of ~750. Verified after:
   opacity **0.470 → 0.950 across 4.5s** (the whole designed breath) with scale
   still exactly 1.

4. **A session that ended while the page was frozen is recorded** (the timer, not
   the motion — it came from the same report). `tick()` used to discard a
   completion noticed more than ten minutes late. A phone can never satisfy that
   rule: a locked screen stops the interval for the *whole* session, so the
   completion is always noticed late — the session was thrown away, and with it
   the minutes. A clock that reached zero is now always a completion, and
   `completeSession` banks the whole session (`remainingMs: 0` before
   `syncAccrual`) rather than the fraction the engine happened to watch tick by.
   Covered by `.freebuff/e2e-timer.mjs` case 10 (reopened half an hour after a
   session that ended while the page was frozen: 2 minutes banked before the
   lock + 23 the frozen clock knew about = 25, pomodoro counted, break armed)
   and case 11 (the same completion, noticed late on a live page).

**What this pass cannot prove.** Every number above is headless Chrome on this
machine, and the artifacts were seen on Android — a tiled, throttled, bandwidth-
starved GPU none of these tools runs on. So the checks verify the *mechanisms*
(a mask that really falls off, a layer that really keeps its scale at 1, an
animation that really completes its cycle) rather than the device. If the
reported glitch was something else on that hardware, these four are still things
the budget had wrong, but the phone has the last word.

## The clock pass (2026-10-13)

Every pass above measured a transition. None measured the state the user is
actually in, which is why one was left: a clock that is *running*.

`idle` was on budget — 60fps, p95 16.8ms, no frame past 33ms — and it still is.
But frame pacing is the wrong instrument for a cost like this one. With the
clock paused the page does **no** layout at all; with it running, the same page
ran **61 layouts and 65 style recalcs every second**, and 1522 paints in twelve,
for 220ms of main-thread time per second against 44ms idle. That is a quarter of
a core, for twenty-five minutes, on every device — and not one frame of it is
visibly late on this machine, which is exactly why the budget never saw it.

`.freebuff/perf-tick.mjs` measures it in twelve-second windows and reads the
browser's own `Layout` / `UpdateLayoutTree` / `Paint` trace-event counts, with
the clock **paused** as the control arm — same page, same layers, no ticks. Two
things about that harness were wrong before they were right, and both are worth
keeping. The seed has to be written while the page is *paused*: a running page
rewrites its own timer slice on every tick, so a seed written over it loses the
race and the "paused" arm quietly measures a running clock (an early run of this
harness had exactly that, and reported it as the control). And `LayoutCount`
from `Performance.getMetrics` reads a plain 0 on a page that does no layout, so
the paused arm is what proves the instrument is alive.

| Per second, clock **running** | before | after |
| --- | --- | --- |
| `Layout` events | 61 | **1** |
| `UpdateLayoutTree` events | 65 | 65 |
| `Paint` events | 127 | 113 |
| main thread (`TaskDuration`) | 220ms | 218ms |
| `ScriptDuration` | 30ms | 33ms |

The pause arm is 0 / 0 / 0 / 44ms / 6ms on both builds.

### Finding the two of them

The bisect took nine sessions, because the obvious instrument does not work.
A `Layout` runs at most **once per frame**, so the count pins at ~60/s and any
single contributor holds it there: taking the progress rule's transition off
moved nothing (61 → 65), and neither did the ring's SVG transitions, the divs,
the buttons and text, the `select`, the header, the glows or the blooms — each
one measured alone. `dirtyObjects` in this Chrome's trace is a bare count, and
CDP's Animation domain reports a `cssId` with no source node, so neither names
the element either. What found it was taking the contributors off *in
combination*: with the progress rule neutralised, `svg g { transition: none }`
dropped the count from 65 to **5**, and with both off the page matched the
full-transitions-off ceiling exactly.

The two are:

1. **The progress rule under the ring** was a `transition-[width]`, retriggered
every 200ms for the length of a session — so it was *always* mid-interpolation,
and a width transition lays out on every frame it interpolates. It is
`scaleX` on an `origin-left` box now. The paint is identical, because the
rule's gradient is defined across the element's own box and so squashes with
it; `origin-left` is what makes the scale grow from the same edge the width did.
2. **The comet head's rotation.** It rode the arc as an SVG `<g>` with
`transition: transform`. A transformed SVG element is a **layout** change in
Blink, not a composited one — so a rotation that glides between every tick laid
out the document every frame. `will-change: transform` on the group does not
help (measured: 65/s, unchanged); it is composited as a rotated `div` now, with
the same two circles in a small svg inside it, positioned at twelve o'clock so
the wrapper's own rotation supplies what the containing svg's `-rotate-90`
used to. Both still glide: 35 distinct computed transforms in 35 samples across
1.4s, for the comet and for the rule.

### The ring is still the ring

Moving something that is *drawn* is not a refactor you can wave through, so the
ring is captured in a frozen state — clock paused at a fixed progress, every CSS
animation and transition switched off, so no two captures can differ by phase —
and diffed pixel by pixel (`.freebuff/visual-ring.mjs`; the diff runs in the
page, where the canvas is). Two captures of the **same** build differ by zero
pixels, so the harness has no noise floor to hide behind. Before against after:
138 of 207,936 pixels differ, all of them on the comet's soft halo rim, and the
comet's near-white core is identical in both — the same 107 bright pixels with
the same centroid to three decimals (`364.037, 69.355`). The comet is in exactly
the same place; a rotated div rasterises its edge slightly differently from a
rotated SVG subtree.

### The budget, re-checked

The ring is the instrument Focus Mode is built around, so the arrival and the
departure were re-run on the same machine: **six valid runs** after, against
**three valid runs** of the unmodified build, every control clean in all nine.

| Phase | baseline (3 runs) | after (6 runs) |
| --- | --- | --- |
| `idle` | 60.1fps, p95 16.8, 0 past 33ms | 60.1fps, p95 16.8, 0 past 33ms |
| `entry` | p95 33.9, 10 past 33ms, 4 past 50ms | p95 34.2, 10.5 past 33ms, 2.5 past 50ms |
| `exit` | p95 49.9, 8 past 33ms, 1 past 50ms | p95 50.1, 7 past 33ms, 4 past 50ms |

Two things to read there. First, **entry and exit were already outside budget
before this change** — the baseline's own medians fail the p95 line, which is
what the exit's re-take above said about the shipped build. Second, the change
does not move them: the exit's p95 is the same 50 either side, and six runs
span the whole documented bimodality (33.8, 49.8, 50, 50.1, 66.4, 66.5), so the
three-run baseline looking tightly 49.9 is the *baseline's* accident, not a
regression. The one number that did move is the exit's count of frames past
50ms, median 1 → 4 — and it does not hold up: those six runs disagree with each
other in batches (4, 4, 4, then 1, 1, 1), which is a session effect rather than
a signal about the change. It is recorded here as unresolved, not as a price.

### What is left of this one

The arc itself is now the most expensive thing in the app that runs
continuously: with the two fixes in place, turning off the SVG transitions
altogether takes `Paint` from 1353 to 136 and main-thread time from 218ms/s to
**90ms/s** (`svgOff` vs `bothOff` in the harness). That is the arc's
`stroke-dashoffset` transition re-rasterising its own `drop-shadow` every frame
— roughly 127ms/s, 13% of a core, for the glide that makes the arc feel like an
instrument rather than a stepping bar. The transition is the design and the
filter is the design; the two together are the cost, and no faithful change
removes it (a static glow would stop following the tip; a stepping arc changes
the motion). It stays, priced, for whoever wants to spend the look on it.

**Declined, with reasons.** The stats bars animate `height: %` and the composer
animates `height: auto` — both layout properties, both one-shot: seven bars on
an activity change, one disclosure on open. The bars could be `scaleY` inside a
clipping wrapper (faithful, but structure for a cost that does not measure); the
composer cannot, because an expanding panel has to move what is below it. The
13 `transition-all`s in the app were left alone on measurement: narrowing every
transition to properties that cannot lay out (`safeOnly` in the harness) does
**not** reduce the count, because the rule and the comet were the layout
properties and everything else only changes colour. **Ruled out by bisect, each
with the rule held off so the count could move at all:** the ring's arc and
ticks, every div, every button and text node, the `select`, the label, the
glows, the blooms, and `will-change: transform` on the rotating group.

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

**The exit** is inside its p95 line as of change 9 (p95 33.4ms, 6 frames > 33ms,
all of them inside the fade), with one frame still past 50ms. What is left there
is not an animation turning: a paired bisect that switched off the transforms of
the page and of the overlay content — bracketed by plain controls — moved
nothing, because the cost is *tearing the scene down*, ~45 composited layers
unmounting in one commit while the page underneath repaints itself back. That is
also where the last candidate sat.

**That candidate has now been priced and declined.** Hiding the overlay's content
so the teardown commit has nothing painted left to drop is a real gain in exactly
one arm — the arm that gives the dissolve away. As a ceiling (the content hidden
from the exit's *first* frame, CSS only, riding the `.departing` class the app
already applies for its freeze: the `contentHidden` condition in `--exitBisect`,
then three fresh runs against the shipped build's three) it moves `exit` frames
> 33ms **6 → 3**, p95 **33.4 → 16.8ms**, fps 52.7 → 57.3 and max 66.6 → 50.1. Its
price is the whole departure: the ring, the title and the room go at full strength
and only the dark sheet dissolves. The arm that keeps the dissolve — the same hide
at 160ms, where the sheet is at ~2.7% and the content with it, so the step is below
the threshold of seeing anything — buys none of it, and reads worse on every exit
number: p95 **49.7ms** (from 33.4), frames > 33ms **7**, frames > 50ms **2**, max
**83.4**, on three runs whose controls were as clean as the shipped build's. The
reason is placement: the dropped frames live in the first ~200ms *while the content
is still on screen*, so a hide late enough to be invisible is a hide that has
already missed them and now adds its own commit into the fade. And neither arm
touches the one line the exit misses — `over50` stays 1 either way, because that
frame is the departure's own start commit and the page repainting itself back.
So the trade is not a dissolve for a few frames: it is the whole dissolve for
frames the departure is already inside budget on, and none of the one it is over.
The condition stays in the harness so the number can be re-taken; the app change
does not.

**Re-taken, and it does not reproduce.** The same six-run protocol — three valid
runs per arm, off-screen Chrome, the harness's own controls clean in all nine —
on the build at `d7cd658`, with the plain-path splice those six reports must have
used (they carry `exitBisect: null`, so the committed harness, which can only put
`contentHidden` inside `--exitBisect`, is not what produced them), puts all three
arms in one place: baseline 7 frames > 33ms, p95 49.9ms, 49.9fps, max 82.4, 2 past
50; ceiling, hidden from the first frame, 7, 50.0ms, 50.0fps, 66.7, 3; the 160ms
arm 7, 49.9ms, 49.8fps, 83.2, 1. The timed arm's committed numbers came back to
the decimal — and so did the baseline's, which is the finding: on this machine the
unmodified build already reads like the committed "worse" arm. Across 38
departures in the re-take (three arms, three bisect sessions, two probe runs) not
one landed in the 16.8ms mode the ceiling recorded twice: 12 sat at p95 33.3–33.8,
24 at 49.5–50.4, 2 at 66.6/68.9. The hide is live rather than assumed — a
page-side probe two frames after the click reports `.departing` present,
`matched: 8`, and the content's computed visibility `hidden` — and that run still
dropped 9 frames, so it is the numbers that failed to reproduce, not the
mechanism. The bisect did read the condition at p95 33.3–33.8 in 4/4 sessions
against bases near 50, but `dialogNoTransform` — which the paragraph above records
as moving nothing — moves the same numbers in 3 of those 4, so that row is not the
plain-run separation either. Two things the re-take leaves open: the build is one
merge and 20h newer than the one measured, and the shipped build's own three runs
already contain `after-1` at p95 16.9ms — the ceiling's own median, with no hide at
all. Until the six runs are re-taken on the commit's own tree, **6 → 3** frames
and **33.4 → 16.8ms** should be read as unconfirmed: the decline may still be
right, but it no longer rests on these numbers.

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
the shell / lens / stage transforms. The departure's content-hide is ruled out as
well, but not as noise: it is priced in "What is left", where the arm that keeps
the look buys nothing and the arm that buys frames costs the dissolve.

**A note on the machine.** These numbers want a quiet one. On a busy machine the
`list` control goes dirty — two of three runs on the evening of 2026-10-10, with
other apps holding a core — and the harness now refuses those runs outright
instead of leaving them to be discarded by hand. The paired harnesses still
answer their question when a run cannot be recorded at all, because both arms
share whatever load there is; that is the other reason to reach for them first.

## The lunar pass (2026-10-14)

Focus Mode's room was rebuilt as a lunar scene: a deep-space gradient, an
eight-layer starfield, one galactic band, two breathing orbital shells, eight
twinkling stars, ten drifting motes, a dark moon at the dial's centre and a
satellite on a 110s orbit. None of the *instrument* changed — the ring, its
graduations, the comet head and the arc's transitions are the ones the clock
pass fixed — and no behaviour moved: the entry/exit choreography (two veils, the
sweep, the stagger) is the same move, retuned to the cooler palette, and the
`.dot-grid` it replaced is gone from the sheet.

Every new layer was chosen to cost nothing per frame, in this document's own
language:

- **The sky is one raster.** `.starfield` is eight dot layers at 190–440px tiles
  with per-layer offsets (so no two layers line up into a grid), plus a masked
  164° band (`.galaxy`) over a static gradient. It is painted once per mount and
  never transformed. Density was set by measurement: the field lands ~2 stars per
  140×140 box, ~180 points across a 1600×1000 room. One level denser read as
  noise beside the clock; the 28px grid it replaced read as a texture.
- **The twinkle is opacity only.** Eight 2–3px spans with `will-change: opacity`
  on their own clocks, so each keeps its own composited layer and nothing
  repaints. `prefers-reduced-motion` leaves them static rather than absent.
- **The orbit is an HTML rotation with an SVG inside it** (`.orbit-spin`),
  because a rotation inside an SVG is a *layout* change in Blink — the same
  finding that moved the comet head into a wrapper div in the clock pass.
- **The moon is two layers, and neither repaints.** A dark disc carrying one
  light gradient — the sphere, brightest toward its source — and, above it, the
  night side: a disc of the room's own dark, the same size as the moon, set down
  the light's axis. How far it slides is the session: its *lit fraction* is the
  clock's elapsed fraction, floor-ed so a new session keeps a sliver, so the moon
  waxes from a hairline crescent to a full face as the clock runs out
  (`moonLit` / `nightOffset` in `components/focus-mode.tsx`). The travel is a
  `translate` on a promoted layer and the wash's own opacity is quantised to the
  same 5% steps the halo's is, because the alternative — masking the light with
  the crescent-shaped bit of a second disc, the construction the mark itself is
  built from — re-rasterises the whole disc on every one of a session's ~7500
  ticks. A third layer carries the limb's rim light and falloff with no fill of
  its own, so a new moon is still a moon: measured on the shipped build, the
  unlit disc reads ~19 against 13–19 of air outside it, and the lit one ~29.
- **The cycle strip is four static rasters.** Four 14px moon phases, each a disc
  cut by another through an SVG mask — the mark's own construction at the size of
  a marker — with the offset inverted from the fraction the same way the big
  moon's is. Nothing in the strip animates: banking a session only changes which
  of two states a glyph is in, a colour and a drop-shadow.
- **Nothing new scales or blurs.** The halo — still the instrument's first
  child, which `visual-check.mjs` samples — animates opacity with constant
  targets, and the instrument keeps its own `will-change: transform` layer.

### What was measured

`visual-check.mjs` passes **41/41** against the production build, including the
speck layer never scaling, the halo never scaling while still visibly breathing
(0.455 → 0.950), and the departure freezing the scene instead of snapping it
back. Layout checks on the production build (`.freebuff/focus-shots.mjs`) confirm
the room cannot scroll at 1600×1000, at 390×844 (DPR 3) and at 1280×620, that
the orbit fits the viewport at every one of them, and that a skip lands on the
break's tone.

The settled state is the row that matters, and it holds: with the clock running,
five-second rAF windows on the production build read 60.0–60.2fps, p95 16.8ms and
**0** frames past 33ms, alternating a plain control with each new layer hidden by
a stylesheet (`.freebuff/idle-probe.mjs`). Hiding the twinkle, the orbit, the
motes, the sky or the shells moves nothing — the frame time is not in these
layers.

### The moon's wax

The night side is placed by inverting the geometry rather than by eye: two equal
discs offset by `k` leave a lit lune whose fraction of the disc is
`1 − (2/π)(acos t − t√(1−t²))` for `t = k / 2r`, and the component bisects that for
the offset a wanted fraction needs. `.freebuff/wax-probe.mjs` checks it end to
end on the production build. It seeds the clock at seven positions, freezes it,
and measures each one *twice* — as it stands, and with the moon's light layer
hidden — so the difference is the moonlight alone and the ring's own blurred glow
(which covers the disc and is larger than the light) cancels out. Two independent
readings come back: the night side's translated box, and the terminator's
position along the light's axis, which two discs that far apart put at
`s = 2t − 1` moon radii.

| clock (arc) | lit fraction asked for | night-side travel | terminator, from pixels | lit fraction, from pixels |
| --- | --- | --- | --- | --- |
| 0.000 | 0.060 | 0.0475 (wanted 0.0475) | −0.909 (wanted −0.905) | 0.058 |
| 0.150 | 0.201 | 0.1588 (0.1588) | −0.676 (−0.682) | 0.205 |
| 0.350 | 0.389 | 0.3109 (0.3109) | −0.381 (−0.378) | 0.388 |
| 0.500 | 0.530 | 0.4302 (0.4302) | −0.148 (−0.140) | 0.525 |
| 0.700 | 0.718 | 0.6031 (0.6031) | 0.211 (0.206) | 0.721 |
| 0.900 | 0.906 | 0.8139 (0.8139) | 0.633 (0.628) | 0.908 |
| 0.998 | 0.998 | 0.9883 (0.9883) | none inside 0.93R | ≥ 0.988 |

The travel is exact to 5×10⁻⁵ of a moon radius, and it lies on the light's axis
to the same tolerance; the terminator turns up where two discs that far apart put
it, to within 0.006 radii; and the fraction read back off the pixels — the edge's
position run through the same lens area, nothing taken on trust from the DOM — is
within 0.006 of the fraction the clock implies at every position. A fresh
session, with the floor that keeps the room's centrepiece from going out,
measures 0.058 lit of 1 against the 0.06 it asks for; a played-out one has no
edge left anywhere inside 0.93 radii, which is that bound and no measurement, so
it is written as one.

The same protocol at the phone viewport (390×844, DPR 3, a 212px moon) passes the
same twelve checks, with the fraction read back within 0.006 of the clock at every
position there as well — the geometry is percentages of the disc, so the smaller
room only makes the same shape smaller.

The wax also costs nothing at the settled state. Two clean paired runs of
`.freebuff/idle-probe.mjs` on the production build — three controls, against
hiding the light, hiding the night side, and taking the disc's tween away — all
read 60fps, median 16.7ms, p95 16.8ms, and 0 frames past 33ms in the control and
in each arm: the travel is composited, so the moon's movement is not in the frame
time.

### The cycle strip

The row under the session is four moon phases rather than four dots: even quarters
of a disc — crescent, half, gibbous, full — so one banked session is one phase
further through the cycle, and the full moon at the end of the row is the one that
buys the long break. Each glyph is the mark's two-disc construction at 14px, with
the offset inverted from its fraction exactly as the big moon's night side is.
`.freebuff/phase-probe.mjs` seeds the clock twice — nothing banked, then two
sessions — and reads the row off the pixels at DPR 3, where a glyph is 42px:

| glyph | phase asked for | lit fraction, from pixels |
| --- | --- | --- |
| 1 | 0.25 | 0.234 |
| 2 | 0.50 | 0.532 |
| 3 | 0.75 | 0.796 |
| 4 | 1.00 | 1.000 |

Banking two sessions leaves the shapes and their order where they were — the same
four lit fractions within 0.04 in both passes — and turns the first two amber
(`rgb(233, 184, 114)`, measuring 222,176,110 in the pixels) while the last two stay
ivory. The aria-label still reports the count (`2 of 4 focus sessions completed`),
so the shapes are decoration over the same announcement, not a replacement for it.
The strip is one raster each and the settled budget is unmoved: in
`.freebuff/idle-probe.mjs`, hiding all four glyphs reads 60fps, p95 16.8ms and 0
frames past 33ms against a control with 0 as well.

**The full three-phase table could not be recorded.** `perf-focus.mjs` refused
every run of this pass: the `list` control kept catching a single frame past
33ms (max 50–67ms) on this machine, and the harness refuses a run whose controls
are not clean, by design. So `entry`, `idle` and `exit` are **unmeasured** here,
not passed — the same caveat the exit's own re-take carries above. The one valid
run taken during the pass, against a `next dev` server before the build measured
above, read the documented shape — `idle` 52.5fps with 6 frames past 33ms,
`exit` p95 49.3ms, `entry` p95 66.6ms — but a dev build is not the artifact the
budget is written against, so those numbers price the environment, not the
change.
