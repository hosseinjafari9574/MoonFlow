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
node .freebuff/perf-focus.mjs --entryBisect --lunarBisect
                                              # the arrival with the lunar room
                                              # hidden, between plain arrivals
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
  (`nightOffset` in `components/focus/geometry.ts`, drawn by
  `components/focus/moon.tsx`). The travel is a
  `translate` on a promoted layer and the wash's own opacity is quantised to the
  same 5% steps the halo's is, because the alternative — masking the light with
  the crescent-shaped bit of a second disc, the construction the mark itself is
  built from — re-rasterises the whole disc on every one of a session's ~7500
  ticks. A third layer carries the limb's rim light and falloff with no fill of
  its own, so a new moon is still a moon: measured on the shipped build (mean of
  a 7×7 patch, 0–255), the lit quadrant reads **52–53** across runs against **20**
  on the unlit side and **12** of air between the disc and the ring below it — a sphere lit
  from the **lower left**, standing clear of its own sky. (The design pass below
  raised the lit side from ~29; the unlit side and the air are where they were.
  The light was moved to the lower left after it, which mirrors both patches and
  the strip — see "The direction" below.)
- **The cycle strip is four static rasters.** Four 14px moon phases (16px for one
  pass in between — see "The alignment pass" below). A phase is
  not a bite out of a disc: its terminator is a *great circle on the sphere*, so
  the mask is the half-plane the light occupies — cut by the diameter through the
  centre, which is where a half moon's terminator lies — plus an ellipse through
  both poles whose waist is `|2k − 1|` of the radius, turned to the same
  `MOON_NIGHT_AXIS` the instrument slides along (`phaseGeometry` in
  `components/focus/geometry.ts`). Under the lit lune each glyph carries a body of
  the room's own dark (`MOON_DARK`) and over it a hairline limb (`PHASE_LIMB`), so
  the *unlit* part of a phase is a dark crescent rather than a tint of the phase
  colour. The two-disc construction this replaced could not draw that shape — its
  horns stop short of the poles — which is why a three-quarter glyph sat in the
  disc's corner looking like a filled disc (see "The dark crescent" below).
  Nothing in the strip animates: banking a session only changes which of two
  states a glyph is in, a colour and a drop-shadow.
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
buys the long break. Each glyph is a *phase* at 14px: the light's half-plane and
an ellipse through both poles, its waist `|2k − 1|` of the radius
(`phaseGeometry`), which is the terminator a real moon has.
`.freebuff/phase-probe.mjs` seeds the clock twice — nothing banked, then two
sessions — and reads the row off the pixels at DPR 3, where a glyph is 48px. It
then compares every interior pixel with that geometry, skipping the limb's own
hairline (which is drawn over the disc's outer 10%) and the antialiased seam along
the terminator itself:

| glyph | phase asked for | interior recognised as lit | the same pixels, per the geometry | pixels compared |
| --- | --- | --- | --- | --- |
| 1 | 0.25 | 0.257 | 0.187 | 781 |
| 2 | 0.50 | 0.534 | 0.504 | 889 |
| 3 | 0.75 | 0.809 | 0.819 | 781 |
| 4 | 1.00 | 1.000 | 1.000 | 996 |

**Agreement is 1.0000 on all four.** That is the check this pass added, and it is
the one the construction it replaced would have failed: the bite's boundary sat up
to four units off the ellipse. The two shares differ by up to 0.07 for the
three-quarter glyph, and that gap is the *measurement*, not the glyph: a crescent
hugs the rim, so its outer band lies under the hairline and any area read off the
interior is biased high — which is why the table gives the model's share on the
same pixels (0.187 / 0.504 / 0.819 / 1.000, matching the pixels to three decimals)
and why the phase's *own* fraction — ¼, ½, ¾, full — is asserted where it is
exactly knowable: off the terminator's geometry in the DOM (waist 5 / 0 / 5 / 10
of a radius of 10, ry the radius, turn −58.4° = the night axis).

Banking two sessions leaves the shapes and their order where they were — the same
four lit fractions within 0.03 in both passes — and turns the first two amber
(`rgb(233, 184, 114)`, measuring 225,178,110 in the pixels) while the last two stay
ivory. The deep dark of a banked glyph reads `rgb(8, 8, 14)` — the body's colour,
no amber in it — and the aria-label still reports the count (`2 of 4 focus sessions
completed`), so the shapes are decoration over the same announcement, not a
replacement for it.
The strip is one raster each and the settled budget is unmoved: in
`.freebuff/idle-probe.mjs`, hiding all four glyphs reads 60fps, p95 16.8ms and 0
frames past 33ms against a control with 0 as well.

### The budget, taken

Thirteen attempts of `perf-focus.mjs` through the retry loop this document
prescribes produced **11 valid runs** and two refusals — each a single `list`
frame at 33ms, the same hairline that refused every run during the pass — so the
pass's refusal was the machine, as suspected, and not the build. The table below
is the median of those eleven, every control clean in every one of them, taken
against the production build (`7Vo6sVXUuFF5zUYoLFR1Z`) and printed by the
document's own `perf-summary.mjs`:

| Phase | fps | median | p95 | max | > 33ms | > 50ms | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `calibration` | 60.1 | 16.7 | 16.8 | 16.8 | 0 | 0 | control |
| `list` | 60.1 | 16.7 | 16.8 | 16.9 | 0 | 0 | control |
| `listPaused` | 60.1 | 16.7 | 16.8 | 16.8 | 0 | 0 | control |
| `entry` | 44.6 | 16.7 | 49.8 | 300.4 | 7 | 4 | **over p95** |
| `idle` | 60.1 | 16.7 | 16.7 | 16.8 | 0 | 0 | **pass** |
| `exit` | 50.7 | 16.7 | 49.9 | 66.6 | 7 | 1 | **over p95** |

Three things to read out of it.

**The settled row is the one the design had to hold, and it holds.** `idle` is
60.1fps, p95 16.7ms and **0** frames past 33ms at the median of eleven runs — the
same row the idle probe reported, now taken by the budget harness itself, and the
row the budget calls the state a user sits in for 25 minutes. The lunar room is
indifferent to it.

**`entry` and `exit` are outside the p95 line, and were before this pass.**
`entry` p95 **49.8ms** and `exit` p95 **49.9ms** against the budget's 33.4ms.
Both rows were already failing on the clock-pass baseline taken immediately
before the lunar work — `entry` p95 33.9ms, `exit` p95 49.9ms — and the exit
lands on exactly the same 49.9 here, which reproduces the "does not reproduce"
re-take above: the ~50ms departure is the reproducible mode on this machine and
the 33.4ms one is the exception. The arrival's per-run p95s across the eleven
runs are 16.8, 33.2, 33.3, 48.3, 49.3, 49.8, 49.8, 50.1, 66.6, 66.6, 66.6 — the
bimodality the clock pass documented, one build producing both modes — so the
row's distance from the clock-pass median cannot be read as a regression on this
instrument. What the budget says about these two rows is unchanged, and it is
still "outside": the design does not pass the arrival or the departure, and it
did not when it was measured last.

**The new room is not what that residue is in.** The table cannot say whether the
dark-space layers *caused* it, so the same instrument was pointed at them. A new
`--lunarBisect` condition in `.freebuff/perf-focus.mjs` (inside `--entryBisect`)
injects a stylesheet *before* the click that hides the whole of the new room —
starfield, galactic band, both breathing shells, twinkle, motes and the
satellite's orbit, `matched: 23`, counted rather than assumed — and brackets it
with plain arrivals in the same browser session:

| session | plain arms (p95 / frames > 33ms) | room hidden (p95 / frames > 33ms) |
| --- | --- | --- |
| 1 | 34.4 / 13, 50 / 18, 49.9 / 15 | 49.9 / 15, 34.7 / 12 |
| 2 | 33.7 / 15, 49.9 / 18, 33.7 / 17 | 33.4 / 11, 49.9 / 17 |
| 3 | 48.7 / 12, 34.8 / 21, 49.9 / 17 | 35.7 / 14, 34.2 / 15 |

Nine plain samples sit at p95 33.7–50 with 12–21 frames past 33ms; six hidden
samples sit at p95 33.4–49.9 with 11–17. The hidden arm is not better — both
modes appear in both arms and the counts overlap — so the arrival's dropped
frames are not the new room's first paint. That is the idle probe's finding
about the settled state, now made about the arrival, and it is why the verdict
for this pass is **the settled budget holds and the entrance and the departure
stay where they were**, not "the whole budget passes".

The pass's own dev-server reading (`idle` 52.5fps with 6 frames past 33ms,
`exit` p95 49.3ms, `entry` p95 66.6ms) is left above as what it was: a dev build
pricing the environment.

## The design pass (2026-10-15)

A craft pass over the room's chrome and its centrepiece: the controls became the
app's own `<Button>`, the top bar's preset chip became the header's `.inset` well,
the labels moved onto the shared `--text-*` scale, and the moon's lit side was
raised so the disc reads as a sphere rather than as a hole behind the clock.

**No motion changed, and that is the point of recording it here.** Same layer
count, same animations, no new keyframes, no new `will-change`, nothing added that
scales or blurs. The three things that could have moved the budget were checked
rather than assumed:

- **The dial's arc got thinner** (6 → 5.5px in focus, 5 → 4.5 mid-session). The arc
  is the one gradient-stroked circle that repaints on every 200ms tick, so its
  repaint *area* is a budget quantity: a thinner stroke is strictly less of it.
- **The moon's light layer got brighter**, not bigger — same single gradient, same
  quantised `wash` opacity, same transform on the night side. `wax-probe.mjs`
  still passes end to end, with the terminator and the lit fraction per position
  unchanged (the material table above carries the new levels).
- **The dial's clearance was fixed by arithmetic, not by air.** `use-ring-size.ts`
  now takes the orbit's overhang *and* the stage's own computed `row-gap` out of
  the ring's allowance, where before it subtracted a flat 96px and so let the
  orbit's arc cross the control row on a short viewport. The dial is smaller on
  exactly the viewports where it was too big, and unchanged on the desktop where
  the width is what binds.

The settled state is still the row that matters, and it still holds: on the
production build after the pass, `.freebuff/idle-probe.mjs` reads 60.0–60.2fps
with p95 16.8ms and **0** frames past 33ms in the control and in every arm
(`no-moon-light`, `no-moon-night`, `moon-no-tween`, `no-phase-strip`), with no
console problems. `visual-check.mjs` 41/41, `wax-probe.mjs`, `phase-probe.mjs`
and `focus-shots.mjs` all pass on the same build, and `e2e-timer.mjs` 29/29 — no
behaviour moved.

What this pass did add is a check for the *design* claims themselves, since none
of the probes above can see a button's radius. `.freebuff/design-probe.mjs`
compares every control in the room against the app's own button — radius, height,
weight, label size, padding, gap, transition, focus ring, with the page's recede
(`scale: 0.94`) normalised out so the reference is not compared to itself at 6%
off — and then measures what the pass changed: the orbit's clearance above and
below the drawn dial at five viewports (22px / 77px on the desktop, 10px / 16px on
a phone), and the contrast of eleven text elements read out of the rendered pixels
(5.9–17.5:1 across the room's own text, plus the app's accent button reported as
the 4.68:1 it is).
Its verdict on the thing this document cares about is the same as the idle
probe's: 60fps, p95 16.8ms, 0 frames past 33ms.

## The lune pass (2026-10-16)

Two asks, both about which way the moons face and how much of them you can see:
the room's moon was turned to fill from the **lower left** up the disc, the four
small moons with it, and the phases short of full were given a **dark crescent**
you can actually see — the third of the four, the one before full, most of all.

### The direction

A session opens on the moon's bottom-left limb and the light climbs the face toward
the top right, where the night side is the last of the phase to go. That is the
mark's own direction: the crescent cut out of the mark's disc (the bite at
`14.15, 9.6` against the moon at `11.2, 11.8`) sits above and to the right of it,
so the app's mark has always been lit from the lower left — the room was the one
thing facing the other way. (A real waxing moon is lit from the right; this one is
the app's own.)

**The angle this put the terminator at was not kept.** Left as a shallow diagonal
— **31.6° from the horizontal** — a half moon read as a lens leaning in a corner
rather than as a moon cut by an edge, and the pass below moved the light to the
left of the disc's middle, where the terminator runs **71°**. What follows in this
section is the pass that set the direction; the numbers in it are the ones that
were shipped then.

One constant does the work. `MOON_LIGHT` in `components/focus/geometry.ts` is the
single point the light comes from, 34% across the disc's box and 76% down it; the
surface gradient is drawn at it and `MOON_NIGHT_AXIS` is derived from it as the unit
vector pointing *away* from it. The night side's travel reads that axis, and so does
the four small moons' terminator, which is why they cannot end up facing different
ways; the limb's own rim light and far falloff follow the same direction by hand
(`inset 1px -1px 0` for the rim, `inset -22px 26px 62px` for the falloff).

Checked off the pixels rather than the source, and by the probes that were already
there:

- `design-probe.mjs` reads the quadrants: the big moon is brightest on its
  **bottom-left** (42 against 28 top-right), a new session's crescent is lit on its
  **bottom-left** limb (169 against 33), and the strip is darkest on its
  **upper-right** limb all the way along (46/33, 85/33, 45/19 for the three phases
  short of full). Every phase before the full one keeps a dark limb — the dimmest
  quadrant at 0.19–0.33 of its brightest — and the full session has none of the
  room's dark left in its disc: **0** of 136 interior pixels, against 62, 51 and 33
  on the three short ones.
- `wax-probe.mjs` walks the terminator at eight positions through a session. It now
  takes the axis off the *shipped gradient* instead of a copy of the constant — it
  reads `light {x: 34, y: 76}` back out of the markup, and `axis {x: 0.524, y:
  -0.852}` off that — so a mis-flipped light fails as the 117° error it is instead
  of as a mismatch against a frozen table. The terminator then lands within 0.02 of
  where the two discs put it at every measurable position, and reads "beyond 0.93R"
  where the face is full.
- `phase-probe.mjs` measures the strip against the same shared axis, so the row
  follows the instrument for free.

### The dark crescent, and the shape of a phase

The four small moons used to draw their unlit part as a *tint* of the phase colour
(`currentColor` at 16%) — enough to make a crescent read, not enough to make a
moon: a tinted unlit side glows. Measured on the build before the change,
glyph 3's unlit crescent sat at **58** luma against the **19** of the sky behind
it, i.e. brighter than the sky it was supposed to be darker than, so the row read
as four filled discs rather than as four phases. The glyph the brief named is the
third — three quarters lit, the step before full — which is exactly the session
that buys the long break, and it was indistinguishable from it.

That took a body of the room's dark (`MOON_DARK`), the lit lune laid over it, and
a hairline limb (`PHASE_LIMB`, one unit of the glyph's 24-unit canvas) last so the
dark side ends on a real edge instead of dissolving into a sky of nearly the same
darkness — **a limb that the next pass removed** (it was invisible over the lit
lune and a visible rim over the dark body, i.e. it made the two crescents differ;
with a body darker than the sky the edge is the body's own): the unlit crescent reads **8.2** against a sky of **27.2**, the room's
floor, where a dark crescent belongs, and the deep dark of a banked glyph reads
`rgb(8, 8, 14)` — the body's own colour with no amber in it — while the same
glyph's lit lune stays at 189.

**And the shape was still wrong, which the pixels said plainly and no number
here did.** A phase is not a bite out of a disc: its terminator is a *great circle
on the sphere*, so in projection it is an ellipse through both poles of the moon's
disc with its waist `|2k − 1|` of the radius. Two discs of the *same* size — the
construction the mark itself is built from — cross `acos(d/2r)` from the axis, so
their unlit region's horns always stop short of the poles, and the fuller the moon
the worse it reads: at three quarters the old glyph's dark part spanned **101°** of
the rim where a moon's spans 180°, hanging in the disc's corner like a lens with
the far limb still lit. Every reading above passed while that was true — a lens can
be exactly as dark as a crescent.

So the glyph is drawn as a moon now. The mask is the half-plane the light occupies
(cut by the diameter through the centre, which is exactly where a half moon's
terminator lies) plus an ellipse through both poles turned to the night axis
(`phaseGeometry`). Drawn at 14px, the third glyph is a dark crescent running from
pole to pole down the upper-right limb: 189 lit, 8.7 dark, a sky of 27.

The instrument keeps its sliding two-disc night side, because a transform on a
promoted layer is what keeps a session's ~7500 ticks off the paint path; the two
are the same object lit from the same side that part company on how the terminator
is made, and the strip — four static rasters — can afford the true one.

One consequence worth recording: `drop-shadow` is cast from an element's rendered
alpha, so the glow a banked moon carries now follows the *disc* rather than the lit
lune alone — the sky just outside a banked glyph measures ~27 against 12–19 before.
Nothing about the budget moves for it: the shadow is a filter on a static element,
and `idle-probe.mjs` still reads `no-phase-strip` at 60fps, p95 16.8ms and 0 frames
past 33ms against a clean control.

### The checks

Production build `nSuxaOSjWKq2CmGt1R-1-`, with no source file newer than its
`BUILD_ID`:

| check | result |
| --- | --- |
| `tsc --noEmit` / `next build` | exit 0 / exit 0 |
| `phase-probe.mjs` | **14/14** — four checks added for this pass |
| `design-probe.mjs` | **42/42**, including the limb direction and the room's dark counted in each glyph's own disc |
| `wax-probe.mjs` | **13/13**, the terminator within 0.02 of the design at every measurable position |
| `visual-check.mjs` | **41/41** |
| `focus-shots.mjs` | all checks, 5 viewports |
| `e2e-timer.mjs` | **29/29** |
| `idle-probe.mjs` | `problems: none`, 60fps, p95 16.8ms, 0 past 33ms |
| `perf-focus.mjs` | three fresh runs, controls clean in all three, clock running: `idle` **pass**; `entry`, `entry2` and `exit` land where this document already has them (re-taken below) |

The checks the strip gained, in the order they were written — each one earning its
place by failing on the build before it:

1. **each a masked phase — a lit lune, a dark body, a limb and a terminator** —
   one mask, one masked circle (the lit lune), one body, one limb, one ellipse per
   glyph.
2. **a phase's unlit side is dark — a crescent, not a tint of the phase colour** —
   the unlit side is never brighter than the sky around it (15–17.6 against 34–47
   across the eight glyph readings).
3. **a banked phase's amber is its lit lune alone — the dark crescent is not
   amber** — the deep dark of a banked glyph is `rgb(8, 9, 14)` to `rgb(7, 8, 14)`,
   no amber in it.
4. **each terminator is a moon's — an ellipse through both poles, waist |2k − 1|
   of the radius** — read off the DOM: 5 / 0 / 5 / 10 of a radius of 10, `ry` the
   radius, turned −58.4°, which is the night axis (**−19° since the light pass
   below**).
5. **the pixels are that geometry** — every interior pixel against the same
   ellipse, skipping the limb's hairline (drawn over the disc's outer 10%, exactly
   where a crescent lives) and the antialiased seam along the terminator:
   **agreement 1.0000** on all four glyphs (781, 889, 781 and 996 pixels compared).
   This is the check the bite construction fails.
6. **its area is the phase's own, both read over the same pixels** — the measured
   and modelled shares within 0.02 (0.187/0.187, 0.504/0.504, 0.819/0.819, 1/1).
7. **the room's dark in the disc, by count** (`design-probe`): 62 / 51 / 33
   interior pixels on the three phases short of full, **0** on the full one — where
   the check it replaced read quadrant means, which a banked neighbour's halo tints
   by a few percent (it read 0.94 against a 0.95 line on a glyph this pass proves is
   full).

`.freebuff/phase-dark.mjs` and `.freebuff/phase-model.mjs` are the tooling this pass
added: the first prints each glyph's lit limb, its dark limb and the sky outside it
on an *absolute* luminance ramp — `phase-ascii.mjs` normalises every glyph to its
own range, and so cannot tell a dark crescent from a glowing one, which is how the
tint read as a moon for as long as it did — and the second prints the geometry's own
picture of a phase in the same grid, for comparing line by line.

### The budget, re-taken on the phase build

This pass adds no motion. The strip is four static rasters, and the change is
geometry inside four SVG nodes that were already there — one more `<ellipse>` per
glyph, drawn once. So the budget should not have moved, and three fresh runs of
`perf-focus.mjs` against production build `nSuxaOSjWKq2CmGt1R-1-` say it has not.
Window off screen at −32000,−32000, 1600×1000, hardware raster, **every control
clean in all three** runs, the clock running in all three
(`focus.clockRunning` and the two-line title the arrival is measured on are both
true in all three). Median of the three, with the three run values where they
differ:

| Phase | fps | median | p95 | max | > 33ms | > 50ms | long tasks | CLS | against the budget |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `idle` | 60.1 (60.1/59.2/60.1) | 16.6ms | **16.8ms** (16.8/16.8/16.7) | 17ms | **0** (0/1/0) | 0 | **0** | 0 | **pass** |
| `entry` | 39.9 (43.9/39.9/38) | 16.7ms | 34.4ms (33.2/34.4/50) | 416ms | 8 (7/10/8) | 3 (4/3/3) | 1 (0/0/1) | 0 | p95 1ms over the 33.4ms line |
| `entry2` | 47 (52/46.3/47) | 16.7ms | 33.4ms (33.3/40/33.4) | 117ms | 14 (15/11/14) | 4 (1/4/4) | 3 (0/3/3) | 0 | p95 on the line |
| `exit` | 51.3 (52/51.3/49.6) | 16.7ms | 49.8ms (33.4/49.8/49.9) | 67ms | 6 (6/7/6) | 3 (3/1/3) | 1 (0/0/1) | 0 | p95 over, as documented |

Read against the numbers already in this document, that is the same picture
rather than a new one. The settled room is the row the budget is about and it
holds: 60.1fps, p95 16.8ms, **0** frames past 33ms by median, no long task, no
layout shift — and the arrival, the warm re-entry and the departure sit inside
the spread the change-9 table carries (`entry` p95 33.9–34.2 with 10–10.5 frames
past 33ms against 34.4 with 8; `entry2` p95 33.4 against 33.4; `exit` p95
49.9–50.1 with 7–8 past 33ms against 49.8 with 6, and 3 frames past 50ms against
the 1–4 that table already records as a session effect that did not hold up).
The `exit`'s p95 has been bimodal since change 9 — 33.4 / 49.8 / 49.9 across
these three runs is that bimodality, not a third value — which is the same reason
nobody should read a single departure run.

Two things stated plainly rather than left in a table:

- **The arrival and the departure are still outside their p95 line, and were
  before this pass.** Nothing here is evidence about the moons either way: the
  budgets the pass could have broken are the ones it did not touch, and the
  phase probes above are the evidence that the strip changed at all.
- **The "all phases: no long task > 50ms" row is violated in a minority of these
  runs** — `entry` 0/0/1, `entry2` 0/3/3, `exit` 0/0/1, against **0** long tasks
  in `idle` and in all nine controls. This is the row this document has already
  warned about: the controls measure *frame pacing*, and ten busy loops on this
  machine once left both controls clean while the app's start-up went from `load`
  38ms to 614ms. A long task is exactly the burst the seal cannot see, so it is
  recorded as unresolved here rather than as a price of the moons — three runs is
  not enough to separate it from machine load, and the change under it is static
  geometry.

What backs "the strip costs nothing" more directly than these four phases is the
bisect that already exists for it: `.freebuff/idle-probe.mjs` alternates the plain
room with one layer hidden by a style injected before the click, and its
`no-phase-strip` arm reads the same 60fps, p95 16.8ms and 0 frames past 33ms as
the room it is compared against. There is deliberately no `--stripBisect` in
`perf-focus.mjs`: the arrival arms that exist hide the lunar room, the grain or
the blur, each of which is a layer with its own cost, and hiding the strip during
an arrival would compare two arrangements of the room rather than two costs of
one.

## The light pass (2026-10-16)

Four asks in one round: keep the strip's glyphs at **16px** (reversed in the
alignment pass below, which took the row back to the 14px it had been set at
before this one), turn the terminator
nearer the vertical, make a three-quarter moon's dark crescent the *mirror* of a
crescent moon's lit one, and refit the instrument — the moon read small, the
clock was wider than the moon it sat in, and the ring around them had no
relationship to either.

### The angle, 31.6° → 71°

The light sat at the disc's lower left (`{ x: 34, y: 76 }`), which put a half
moon's terminator at **31.6° from the horizontal**: a shallow diagonal that reads
as a lens leaning in a corner, not as a moon cut by an edge — and it was the
angle every phase in the strip carried, since the strip and the instrument come
off the same constant. `MOON_LIGHT` moved to `{ x: 21, y: 60 }` — the left of the
disc's middle, a little below it — so the night axis sits 19° above the
horizontal and the terminator **71°** from it. Off the shipped DOM
(`phase-probe.mjs`): the ellipse's turn went from −58.4° to **−19°**. (It was
asked back down a step in the next pass but one — 50°, and it reads −40.03°
now; the section at the end of this document has that ask and its numbers.)

The instrument's own rim light and falloff turn with it, because they are drawn
from the same direction by hand: `inset 1px -1px 0` became `inset 2px -0.5px 0`
(the lit edge, left and a hair low) and `inset -22px 26px 62px` became
`inset -24px 8px 62px` (the falloff, right and a hair high). `wax-probe.mjs`
reads the axis back off the *shipped gradient* rather than a copy of the
constant, which is what makes this a measurement rather than a restatement.

### The mirror, and the one thing that was breaking it

A three-quarter moon's dark crescent is the *same lune* as a quarter moon's lit
one, half a turn round — exactly, and by construction: the terminator's ellipse
is centred in the disc and a half turn swaps the two half-planes, so a point's
lit-ness plus its mirrored counterpart's is 1. The render did not hold it, and
that is now measured rather than assumed — `phase-probe.mjs` builds a soft
mask for both glyphs on a shared pixel grid and reports the mean deviation from
1: **0.102 before, 0.053 after**, and by radius band it reads
`[0, 0, 0.005, 0.041, 0.054, 0.131]` — nothing at all in the middle of the disc,
and 0.13 in the outer band.

Two things were behind that, and only one of them was the shape:

- **The limb.** A hairline in the phase colour, drawn last. Over the lit lune it
  is the lune's own colour and invisible; over the dark body it is a rim (level
  29 against a body of 15) — so a three-quarter moon's dark crescent wore an
  outline its crescent counterpart did not have, which is precisely the
  difference the ask named. It was added when the unlit side was a *tint*
  brighter than the sky and needed an edge to end on. That is no longer true: the
  body is darker than the sky (15 against 34–47 on the max channel), so the edge
  is the body's own, and the limb is gone (`phase-probe.mjs` reads two circles
  per glyph now, where it used to read three).
- **The outer band's 0.13 is the rim's own, and it stays.** Where a crescent
  *darker* than its sky meets the sky, the pixel that spans the boundary darkens;
  where a *brighter* crescent meets it, the same pixel brightens. The two halves
  of that pixel are complements only if the sky were the average of the two
  colours, which it is not. Recorded rather than tuned away, which is why the
  check's line is 0.06 and not 0.02.

### The instrument

The moat between the moon and its dial was **22px** at a ring of 203 — a moon
parked in the middle of a ring — and the reading inside the moon was sized from
the *ring* at 0.235 of it. Two numbers, in `moonGeometry`: the inset is **8.5% a
side** rather than 13%, and the clock is a fifth of the **disc** rather than a
quarter of the ring. The second is the one that matters, because a fraction of
the ring drifts as the ring changes size and a fraction of the disc does not: the
clock is now 20% of the moon's diameter at every viewport, where it used to be
25–32% depending on the room.

| where | ring | moon | clock (type size) | clock ÷ moon |
| --- | --- | --- | --- | --- |
| desktop 1600×1000 | 384px | 284 → **318px** | 84 → **64px** | 30% → **20%** |
| phone 390×844 | 231px | 171 → **191px** | 54 → **38px** | 32% → **20%** |
| the panel | 162px | 120 → **134px** | 38 → **27px** | 25% → **20%** |

(`focus-shots.mjs` reads the ring, the moon box and the clock's computed size at
the first two viewports; the third is the live DOM in this session's own panel,
and the moon and clock columns for it are arithmetic on the same two rules. The
*type size* is the quantity here rather than the text's own box, because the box
follows the number of digits the clock happens to be showing.) The orbit and the
dial's stroke are unchanged — the moon moved out toward them rather than the
reverse.

**The inset moved once more, to 10% a side, in the alignment pass below.** At
8.5% the moon filled 83% of the dial and left the graduation ring **17px** of air
at the desktop size and **4px** on a phone, which read as a crowded instrument
rather than a large one; 10% is 80% of the dial and 22px / 7px of air. The halo
stopped being a flat `inset-4` in the same pass: a fixed 16px was 5% of the disc
on the desktop and 8.6% of it on a phone, so it now follows the moon's own inset
by 14px at every size.

### The checks

Production build `Sl3PjQ0NLmfjgdw1SReLK`, no source file newer than its
`BUILD_ID`:

| check | result |
| --- | --- |
| `tsc --noEmit` / `next build` | exit 0 / exit 0 |
| `phase-probe.mjs` | **16/16** — the two checks below are new |
| `design-probe.mjs` | **42/42**, with the full-moon row re-stated (below) |
| `wax-probe.mjs` | **14/14**, including a new check for occluded positions (below) |
| `visual-check.mjs` | **41/41** |
| `focus-shots.mjs` | all checks, 5 viewports |
| `e2e-timer.mjs` | **29/29** |
| `idle-probe.mjs` | `problems: none`, 60fps and p95 16.8ms in the control and in every arm; one arm's control carried a single frame at 33.2ms (machine noise, and the only frame past 33ms in the run) |

The two new checks are the ask, written as tests, and each failed on the build
before this pass:

1. **the three-quarter moon's dark crescent is the mirror of the crescent moon's
   lit one** — mean |lit + mirrored lit − 1| = **0.053** over 1109 px, against a
   0.06 line. It read 0.1297 with the metric still normalising by each glyph's
   *peak* rather than its measured plateau (the peak is where the limb crossed the
   lit lune, so every radius band carried a constant 0.22 of error), and 0.102
   once the metric was right and the limb was still there.
2. **…and the terminator runs nearer the vertical than the mark's own bite (≥ 60°
   from horizontal)** — **71°**, where the build before it read 31.6°.

Three expectations moved with the change, each for a reason that is not a
loosening:

- `phase-probe.mjs`'s DOM check read *three* circles per glyph — a mask, a body,
  a lune and a limb. It reads two now, and asserts `limb === 0`, i.e. it fails if
  the rim comes back.
- `design-probe.mjs`'s full-moon row asserted exactly **0** interior pixels of the
  room's dark in the disc. Without the limb covering the rim it reads **1 of
  136**, at the boundary where the terminator's own ellipse meets the disc's limb;
  the check now says what the row means — *no crescent, at most a rim pixel* —
  against 65 / 51 / 35 on the three phases short of full, which is the same
  order-of-magnitude gap it was written to test.
- `wax-probe.mjs` gained a check, and it is the most interesting thing this pass
  found. Its scan band walks the light's axis and reads the *step* the terminator
  makes in the moonlight — and the clock is drawn inside the disc, on top of the
  light. With the axis at 71° that band now runs straight *through* the number
  instead of clipping its corner, so the readout's pixels (which are not
  moonlight) come out of the measurement. Masking them left a gap whose own edge
  the step detector read as the terminator, so the bins inside the readout are
  gaps, no step is read across them, and a position whose terminator falls behind
  the reading is reported as **occluded, not full**: 3 of 7 positions, at 0.35,
  0.50 and 0.70 of the session. At the positions it can see it matches the
  two-disc model to 0.004 (−0.905 vs −0.911, −0.682 vs −0.685, 0.632 vs 0.636),
  and its optical reading of the lit fraction is 0.057 / 0.200 / 0.909 against the
  design's 0.060 / 0.202 / 0.908.

**The budget.** `idle` is the row that matters and it is re-taken on this build:
60fps and p95 16.8ms in the control and in every arm (`no-moon-light`,
`no-moon-night`, `no-moon-tween`, `no-phase-strip`), with **one** frame in the
whole run past 33ms — 33.2ms, in one of the five controls, where the room is not
in the measurement at all. The
`entry` / `entry2` / `exit` medians in the section above were taken on the build
before this pass and are not re-taken here — this pass changes geometry inside
existing elements (the axis, an inset, a font size) and removes a circle per
glyph, so nothing in it adds work per frame; the settled room, which is the state
the user sits in for 25 minutes, is measured.

**One check that could not run as a look.** The preview panel produced no frames
this session (`the preview webview is not being composited`), so the visual
confirmation is pixel-level rather than by eye: every number above is read from
the rendered pixels of the shipped build by the probes' own browsers. `design-probe`
reads the moon's own quadrants off those pixels (brightest lower-left, 27 against
24 at the top right), which is the direction this pass preserved while turning
it.

## The alignment pass (2026-10-16)

Three complaints in one round, none of them about motion: the room read jumbled,
"everything" was asymmetric, and the four small moons of the cycle row had been
made too big. A fourth arrived as a question — *why don't we have the small moons
on the desktop?* — and its answer is a media query, below. The last one turns the pass above around — 16px was that pass's own
ask — and the row goes back to the **14px** it had been set at before it, which is
also the size `phase-probe.mjs` was written against: its header says "a glyph is
42px of real pixels" at its DPR 3, which was true of 14px and wrong about the
16px it was measuring.

Nothing here animates. Same layers, same transforms, same opacities, no new
`will-change`: a row's heights and gaps, a glyph's size, an inset and what is
derived from it. What it did change is the *form* of two checks, which is recorded
below — a check that only holds at one size is not a check.

### The control row: one height, one radius, one gap

Read off the shipped build by `.freebuff/asym-probe.mjs` (which is new in this
pass: it measures every row of the room against the room's own axis, and the
instrument's parts against each other, at four viewports):

| the row's four controls | before | after |
| --- | --- | --- |
| heights | 48 / 48 / 40 / 40 | **48 / 48 / 48 / 48** |
| radii | 12 / 12 / 8 / 8px | **12px** |
| gaps between them | 10 / 14 / **6**px | **12 / 12 / 12**px |
| the row's own span about the room's axis | ±208.9px | ±219.9px |

The 14 was the seam: a `pl-1` on the quiet pair pushed it 4px off the row's own
rhythm, so one row had three different gaps in it — and beside two 48px buttons
the pair sat at 40px with an 8px radius, which is the card's row and reads as two
smaller objects under the instrument rather than as the last two controls of one
line. All four are now the app's own `lg` button (`h-12`, `rounded-xl`), the pair
cut to its icon's 48px square, on the stage's single `sm:gap-3`. The row wraps to
two lines on a phone exactly as it did before.

### The strip: back to 14px

| | before | after |
| --- | --- | --- |
| one glyph | 16px (`size-4`) | **14px** (`size-3.5`) |
| the gap between them | 10px | **8px** |
| the row's own width (four glyphs) | 94px | **80px** |
| the row's span about the axis | ±47px | ±40px |
| a banked glyph's glow | `0 0 6px` | **`0 0 5px`** |
| an unbanked glyph | ivory 30% | **ivory 35%** |

### The dial's air

The one number this pass moved inside the instrument is the moon's inset, and it
moved *back*: the light pass had just taken the moon's smallness apart, so the
correction is not a return to 13% but to the middle — **10% a side**, 80% of the
dial rather than 74% or 83%. What 83% cost was the graduation ring's air: sixty
ticks sit 10.5px inside the arc, and the moon's own glow has to fade before they
start.

| where | dial | the moon | moon ÷ dial | air above the ticks |
| --- | --- | --- | --- | --- |
| desktop 1600×1000 | 384px | 318 → **308px** | 83% → **80%** | 17 → **22px** |
| laptop 1280×800 | 316px | 258 → **252px** | 83% → **80%** | 11 → **16px** |
| panel 1024×768 | 285px | 233 → **227px** | 83% → **80%** | 8 → **13px** |
| phone 390×844 | 225px | 191 → **179px** | 83% → **80%** | 4 → **7px** |

The halo moved with it, and for the same reason: it was a flat `inset-4`, which is
5% of the disc on the desktop and 8.6% of it on a phone, so the bloom that read as
air around a big moon washed over the ticks on a small one. It is now the moon's
own inset less 14px (`HALO_AIR` in `components/focus/geometry.ts`), the same
fraction of the disc at every size — 336px against a 308px moon on the desktop,
207 against 179 on a phone.

### Two checks changed with the pass

1. **The quiet pair's parity check.** It compared the room's skip and reset to the
   card's *icon* button, its 40px width included, because the room's pair was that
   button exactly. It is now two claims: the pair shares Complete's frame (radius,
   height, label size, weight, gap, transition, focus ring — one frame end to end),
   and it is still the app's own outline button underneath (colour, border, weight,
   focus ring). The old form would have called the taller square pair a regression
   when the thing it was protecting is the frame.
2. **The dark body in each glyph's disc** (`design-probe.mjs`). It was an absolute
   count — `> 24px` — which was the same claim only while a glyph was 16px: a 14px
   glyph samples **108** interior pixels where a 16px one samples ~140, so a
   threshold in pixels moves with the glyph's size and says nothing about the
   shape. It is now a fraction of the sampled disc (≥ 15%, against 49/108, 39/108
   and 24/108 for the three short phases and 0/108 for the full one), which is what
   the claim always meant: a tint in place of the room's dark reads ~0 at any size.

### The mirror, read at two resolutions

The light pass's mirror check had a 0.06 line, and at the shipping size this pass
puts the glyphs at the shipped reading is **0.0636** — over it. The geometry is not
the cause and the measurement says so: under a point reflection through the disc's
centre the light's half-plane swaps for its complement and the terminator's
ellipse maps onto itself, so the two crescents are complements to the pixel *given
a raster*. A 14px glyph is 42 device pixels at the probe's DPR 3, which makes the
antialiased limb 1/42 of the disc and, in the outer band, a third of the band:
0.156 there against 0.065 in the band inside it. Read again at DPR 6 — the same
domino, an 84px glyph — the same geometry reads **0.0446** over 3397 samples and
the outer band falls to 0.095, which is what separates a shape from a raster: an
asymmetry does not improve with resolution.

So `phase-probe.mjs` now reads the row twice. Both readings are checks — the
shipped one at ≤ 0.08 (the raster it has) and the fine one at ≤ 0.045 *and*
strictly better than the shipped reading (the shape) — and the pair is reported as
one number each, so a future pass that changes the glyph's size sees both move
together.

### The ladder: the moons were the first thing to step away, and that was backwards

The room is fixed and scroll-proof, so anything the window cannot hold has to be
dropped by a media query. Which thing goes, and in what order, is a design
decision that nobody had written down — and it was the wrong way round. Measured
at a desktop width (`.freebuff/asym-probe.mjs` prints the whole ladder, 1440 wide,
from 1000px of window height down to 480):

| window height | eyebrow | task meta | **the four moons** | day's total | key hints | dial |
| --- | --- | --- | --- | --- | --- | --- |
| 1000–721 | yes | yes | **yes** | yes | yes | 384–240px |
| 720 and below (before) | yes | yes | **—** | — | yes | 294px |
| 720–641 (after) | yes | yes | **yes** | **—** | yes | 264–207px |
| 640–561 (after) | yes | — | **yes** | — | yes | 199–217px (238 at 620, where the hints go) |
| 560 and below (after) | yes | — | **—** | — | — | 210–169px |

The moons used to go at 720px of *window* height, in one piece with the day's
total — and 720 is what a laptop lands under once the browser's own chrome comes
off a 768- or 900-tall screen, which is to say: on the thing the room is most
often opened on. So the room kept the key hints, a row that fades itself out after
five seconds of stillness, and lost the four moons, the only thing that says how
far into the cycle you are. The strip is now the **last** thing to step away,
except for the eyebrow above it (which carries the same count as text and holds on
to 520), and the prose steps away first:

- **720px**: the day's total, one line of prose and the least load-bearing thing in
  the column. The moons stay, alone in their row.
- **560px**: the moons, below which the dial wants the room.
- **640 / 620 / 520px**: the task meta, the key hints and the eyebrow, as before.

What it costs is the dial: keeping the moons in the 561–720 band means the ring is
height-bound and gives up ~30px there (294px at 720 before, 264px with the moons),
and at 640 the meta line stepping away hands 10px of it back. Below 561 the dial is
unchanged, and above 721 nothing about the room moved at all.

### The checks

Production build `Qq6YCduvyz0WwX4MmJbMM`, no source file newer than its
`BUILD_ID`:

| check | result |
| --- | --- |
| `tsc --noEmit` / `next build` | exit 0 / exit 0 |
| `design-probe.mjs` | **43/43** |
| `phase-probe.mjs` | **17/17** — the mirror is now two checks |
| `wax-probe.mjs` | **14/14** |
| `visual-check.mjs` | **41/41** |
| `focus-shots.mjs` | all checks, 5 viewports (ring 384, moon 308, orbit 436; the short 1280×620 room still cannot scroll with the moons in it) |
| `e2e-timer.mjs` | **29/29** |
| `idle-probe.mjs` | `problems: none`, 60.0–60.2fps, p95 16.8ms, **0** frames past 33ms in the control and in all four arms |

One run is recorded as what it was rather than as a result: the first `idle-probe`
of this pass read 43.2fps with 13 frames past 50ms in `no-moon-night` — and 57.6–58.4fps with frames at 97ms and 151ms *in its own controls*, which is the
machine, not the room (three probes had just been run back to back on it). Re-taken
on a quiet machine the same build reads the row above. The controls exist precisely
so that distinction can be made.

**The budget.** `idle` is the row that matters and it holds exactly where the
passes above left it: 60fps, p95 16.8ms, 0 frames past 33ms, in the control and in
`no-moon-light`, `no-moon-night`, `moon-no-tween` and `no-phase-strip` alike. The
`entry` / `entry2` / `exit` medians are not re-taken: this pass changes geometry
inside elements that already exist (a class, a height, two insets), adds no layer
and no animation, and the settled room — where a session is actually spent — is
measured.

**One check that still could not run as a look.** The preview panel produced no
frames again this session (`the preview webview is not being composited`), so the
composition is confirmed in numbers and pixel maps rather than by eye:
`asym-probe.mjs` prints each row's centre against the room's axis (±0.0px for all
six rows at all four viewports), the four control heights and gaps, the glyph
sizes and their gaps, the moon's fraction of the dial, and text views of the
instrument, the control row and the strip, decoded from its own screenshots.

## The small moons, taken back a step — 2026-10-17

Two asks, one afternoon, and both were *judgements* rather than measurements: the
four moons' edge had gone too upright, and the moon's unlit half read as a black
hole rather than as a body. So both were chosen off samples painted by the app
itself. `.freebuff/moon-samples.mjs` holds one property — `--moon-dark`, which the
disc's own fill and its night side both read — and one attribute, the
terminator's `rotate`, which the component writes from `MOON_LIGHT`. It paints six
values of the first and five of the second through the shipped build (1280×860,
DPR 3), reads the dark side, the sky and the lit lune off the resulting pixels,
and assembles the tiles into `shots/moon-samples.png` with the numbers beside
them. That pass shipped as 50° and one token; the second pass, further down,
repainted seven values of two tokens and three angles.

What makes those tiles the app's own pixels rather than a drawing of it is checked
in the same run. The strip's terminator is *turned* in the live DOM — the mask's
half-plane rect and its ellipse share one `rotate`, and nothing else in the glyph
depends on the angle — and the harness proves the patch is transparent by writing
React's own string, `rotate(-19.02560603756868 12 12)`, back over the elements it
came from (after a detour through zero, so the paint really happens) and comparing
with a capture that was never patched: **0 of 142272 channels differ**. The sheet
itself is checked the same way, from the saved PNG: each tile's region is compared
with the tile's own pixels — 12 tiles 1:1, 12 scaled with the means agreeing to
0.6 luma — so the page cannot be a blank grid that looks like a sheet.

### What the two numbers were, and what they are

The strip's sky, measured beside a **pending** glyph — which has no amber glow in
it, and that is the whole point of reading it there:

| | before | after | asked for |
| --- | --- | --- | --- |
| the terminator, from the horizontal | 71.0° | **50.0°** → 61.0° | between 71° and the first ship's 31.6°, then between 71° and 50° |
| `MOON_LIGHT` | `{ x: 21, y: 60 }` | `{ x: 25, y: 71 }` | — |
| the unlit body, luma | 8.2 | **21.1** | a grey, not the black |
| the sky beside a pending glyph, luma | 7.5 | 7.5 | — |
| a pending glyph's lit lune, luma | 84.6 | 93.3 | — |
| a banked glyph's lit lune, luma | 189.4 | 189.4 | — |
| the dial's unlit half / its sky, early | 14.5 / 11 | 24 / 11 | — |

That table is also the correction of an older claim. The phase work above asserts
that the unlit side is *darker than the sky it sits on*, and measures that sky as
19–27 — from the annulus around the glyph, which for a **banked** one is its own
amber glow (28.7 here against 7.5 beside a pending one). Beside the glyph it is
about, the unlit body was **8.2 against 7.5**: the dark crescent of a
three-quarter moon was the sky, which is what a black hole in the row looks like,
and what the ask was really about. The token (`--moon-dark`, a plain custom
property in `app/globals.css` rather than a `@theme` entry, because Tailwind emits
only the theme variables it sees used in class names) now sits a step above the
sky — and still a fifth of a *pending* glyph's own lune, which is what keeps the
phase legible at the row's dimmest end.

### The probe, measured before it was believed

The mirror check — the third glyph's dark crescent against the first one's lit
crescent, half a turn round — read **0.088** on this build against its 0.08 line,
and the first thing it got was not a new line but five fixes to the *measurement*,
each of which moved it:

- **the capture waited on a stopwatch** (900ms after the strip appeared) while the
  readouts row was still arriving, so the shot was of a moving box: two runs of
  the same build read 0.0944 and 0.1215. It now waits for the strip's own box to
  stop moving (three reads inside a hundredth of a pixel), and every reading below
  repeats exactly.
- **the grid sampled whole pixels** (`at(Math.round(cx + gx + sx))`), which for a
  fractional centre does not sample a point and its mirror symmetrically; it is
  bilinear now.
- **the plateau was the mean of the lit pixels**, and a thin crescent is mostly
  edge — 89.1 where the same colour in a wide lune is 93.7, worth 0.08 of the
  reading by itself, and a fact about *shape*. It is the 90th percentile now.
- **the shade ramp was ten levels**, and two roundings either side of a half are
  worth 0.037 by themselves; it is 64 (`SHADE`), with no `x` in it so a cell
  outside the disc cannot be read as a level.
- **the model's axis** is read from the shipped terminator's own `rotate`
  (it had been copied into the probe as `{ x: 34, y: 24 }`, two passes stale).

What was left after that is real, and it is the raster: **0.088** at 42 device px
and **0.0745** at 84. Its size is a property of the *angle* and not of the shape,
which the A/B runs on the same build and metric say outright —
`OVERRIDE=angle:71` reads 0.060 (and 0.052 at DPR 6), `OVERRIDE=dark:#07080e`
reads 0.083, a limb in the phase colour reads 0.080 (it is symmetric, so it
*lowers* the reading — that bug is caught where it lives, in the DOM check for
`limb === 0`). The difference map (`--dump-mirror`) puts what is left along the
*poles' line*, at the cusp where the terminator's ellipse meets the limb: there
two boundary crossings share one pixel, and the coverage the rasteriser estimates
for them (`1 − (1 − a_rect)(1 − a_ellipse)`, or `a_rect(1 − a_ellipse)`) is exact
only where the two are independent. At 71° those cusps sit at the top and bottom
of the disc, where a scanline fill gets them right; at 50° they are diagonal.

So the lines moved to 0.115 and 0.095, with the reason recorded here rather than
in the probe's own source — and the *shape* does not rest on them: the
terminator's geometry (an ellipse through both poles, waist |2k − 1|) and the area
comparison are exact to 0.002, and a limb comes back as a DOM failure.

### The checks

Production build `x0CiMXKdaR1gsETFFMILN`, no source file newer than its
`BUILD_ID`:

| check | result |
| --- | --- |
| `tsc --noEmit` / `next build` | exit 0 / exit 0 |
| `phase-probe.mjs` | **17/17**, twice, identically — three checks re-stated below |
| `design-probe.mjs` | all checks passed |
| `wax-probe.mjs` | all checks passed |
| `visual-check.mjs` | **41/41** |
| `focus-shots.mjs` | all checks, 5 viewports |
| `e2e-timer.mjs` | **29/29** |
| `idle-probe.mjs` | `problems: none`, 60.0–60.2fps, p95 16.8ms, **0** frames past 20ms in the control and in all four arms |

Four expectations moved, and one was replaced by what the ask made true:

- **the unlit side** was checked as *darker than the sky* (`darkLevel <= skyLevel + 4`).
  That is no longer the property — on a pane-size room the body sits above the sky
  by design — and the check's own robustness was thin anyway (the full moon has no
  unlit side, and its "body" read 0 on one run and 47 on another, from the
  antialiased rim alone). It now reads the body's *level* (34–44 of the max
  channel, measured 39–40 off `--moon-glyph`, whose blue channel is 39) with the
  full moon out of it, and the limb-ratio check beside it moved 0.35 → 0.45 of the
  *pending* lune (0.18 → 0.35 with the lift, 0.40–0.41 with the glyph token;
  both ends of the row are in the detail).
- **the terminator** was checked as "nearer the vertical than the mark's own bite,
  ≥ 60°" — a floor that the ask's whole point was to come down from. It is a band
  now, **55–65°**, measured 60.9°, and both states the asks named (50° and 71°) sit
  outside it, with the middle they asked for inside.
- **the mirror**, as above.

**One thing still could not be looked at the way a person would.** The preview
panel was registered with the sample page and the sheet was revealed in the file
viewer, but the *pixel* evidence in this section is all headless capture read back
in a canvas — the sheet's provenance check and the tables above — rather than a
composited look, and the sheet's own tiles are magnified 3× where the moons are
14px, so the judgement of the *grey* was made on numbers and a zoomed rendering.

### The same afternoon, a second pass: 61°, and two tokens for one moon

Three judgements came back, and each was answered on a number rather than on an
impression. The sheet was rebuilt for them (v2, `.freebuff/moon-samples.mjs`): the
same real component, seven values of the unlit side — **A** `#12151f` (21 luma),
**B** `#1a1d27` (29), **C** `#22262f` (38), **D** `#2a2e37` (46), **E** `#32363f`
(54), **F** `#3a3e47` (62), and **G** `#2c2c2e` (44, the blue taken out of D) —
and three angles, 71°, 61° and 50°, with the middle one the build actually draws.

**The angle.** 50° was called *too upright* against the row, and the ask was the
middle of it and 71°. The middle of the two points is `(23, 65.5)`; `y` rounded
down to the percent gives `MOON_LIGHT = { x: 23, y: 65 }`, the night axis 29.0°
above the horizontal and the terminator **60.9°** from it — read back off the
shipped `rotate(-29.054604099077146 12 12)`, which is what the four glyphs write.
The patch harness turns the shipped angle in the live DOM beside it and compares
the result with the unpatched capture: **0 of 142272 channels differ**.

**The grey, answered twice.** The first sheet's answer had been one value for both
the 300px disc and the 14px glyph, and the second sheet put them on trial
together — and the answer split them: the dial's **A** was called *much better*
(the clock needs the field under it to stay out of the way), and the strip wanted
**B**. So the judgement became two tokens, which is why `--moon-glyph` exists
beside `--moon-dark`. The dial is unchanged; the strip's body is one step up.

| | the dial | the strip |
| --- | --- | --- |
| token | `--moon-dark` | `--moon-glyph` |
| value | `#12151f` | `#1a1d27` |
| luma | 21.1 | 29.1 |
| the body, and the sky beside it | 24.9 / 11 | 29.1 / 8.4 |
| the body, and a banked neighbour's glow | — | 29.1 / 26.0 |
| the lit lune beside it | — | 98.2 pending, 189.4 banked |

The last two rows are the reason a single token was never going to be right: in
the strip the same body has to clear a sky of 8 and meet an amber glow of 26,
while on the dial it only has to not compete with a clock. Read on the
production build with `.freebuff/phase-dark.mjs`; the dial's row comes from the
sheet's own tiles, because the dial's token did not move.

**Two checks were restated in `phase-probe.mjs`** (17/17, then 17/17 again) and
**two in `design-probe.mjs`** (all checks passed):

- the unlit body's level, **24–40 → 34–44** of the max channel: `#1a1d27`'s blue
  is 39, where the dial's token reads 31. Measured 39.1–40.2.
- the body against the lune, **0.4 → 0.45** of it: the lift moves the floor.
  Measured 0.40–0.41 of a pending lune.
- the terminator's band, **45–55° → 55–65°**: still a band *between* the two
  states the asks named — 50° and 71° both fail it, 60.9° passes.
- in `design-probe`, the dark-body count was `bright * 0.35`, a fraction of
  whichever phase was measured, which cut the lifted body out of its own check
  (**9 of 108** px on the three-quarter glyph). It is `min(48, bright * 0.6)`
  now — a level: above the sky's 8–11, under half a pending lune's 98, and still
  under the amber tint that read 58 here once.
- its limb ratio, **0.4 → 0.55** of the brightest quadrant, measured 0.46 at the
  three-quarter glyph. What that number can no longer carry — *is it a crescent
  or a slab?* — is carried by the mirror and area checks in `phase-probe`, which
  are unchanged and still pass.

| check | result |
| --- | --- |
| `tsc --noEmit` / `next build` | exit 0 / exit 0, build `L_7hZHjeLj439Wnzj2nfL` |
| `phase-probe.mjs` | **17/17** |
| `wax-probe.mjs` | all checks passed |
| `design-probe.mjs` | all checks passed (5 viewports, 3 contrast rows) |
| `phase-dark.mjs` | body **29.1** against a sky of **8.4**; lune 98.2 / 189.4 |

**Still judged by eye, still on a zoomed tile.** The sheet's moons are the app's
own pixels at 3×, and the angle tiles are the component's own `rotate` written in
the live DOM — but the choice itself was made from a magnified row and a table of
numbers, not from a composited look at the room. The registered preview is the
place to disagree with it.

### The next morning, a step back: 55°, and a grey with no hue

Two asks came back on 2026-10-18, and only one of them was about shape. The four
small moons had gone *too upright* again at 61° — the ask was "a little less,
something between this and the one before it" — and the black of the unlit side
was to become a *grey*, with samples to choose from.

**The angle.** Between 61° and 50° is 55.5°, and the light was walked back down
the same axis to `MOON_LIGHT = { x: 24, y: 68 }`: the night axis 34.7° above the
horizontal, the terminator **55.3°** from it. Nothing else had to move — the
strip's glyphs read the axis through `phaseGeometry`, and the instrument's night
side slides along it — but the two limb offsets are a function of the light's
direction and were interpolated a third time: rim `2px -0.9px`, falloff
`-21px 15px`, between the `(23, 65.5)` pair and the `(25, 71)` one.

Read back off the shipped DOM, not off the source: the glyphs write
`rotate(-34.69515353123398 12 12)`, and `phase-probe.mjs` decodes
`[55.3, 55.3, 55.3, 55.3]` from the four ellipses. The sheet's ladder puts 61°,
55° and 50° side by side through the same component, with 55° as the *unpatched*
capture — the harness turns the other two in the live DOM and checks the patch is
transparent by writing React's own string back: **0 of 142272 channels differ**.

**The grey.** The third sheet (v3, `.freebuff/moon-samples.mjs`) repaints *both*
tokens at once now — `--moon-dark` for the dial and `--moon-glyph` for the strip —
because a candidate that only moved the dial would have left the size the ask was
about on the old colour. Seven values, paired so that hue and lift are two
questions rather than one:

| | A | B | C | D | E | F | G |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | `#12151f` | `#17171b` | `#171717` | `#1c1c21` | `#1c1c1c` | `#212126` | `#212121` |
| luma | 21.9 | 24.1 | 23.8 | 29.2 | 28.8 | 34.2 | 33.8 |
| hue | blue-black | cool *grey* | *grey* | cool *grey* | *grey* | cool *grey* | *grey* |

**E** — the middle lift, hue-less — was the answer, and only for the strip: the
dial keeps the blue-black it has had since the first sheet. So the two tokens now
differ in *hue* as well as in level, which is the first time the split has been
about colour rather than brightness.

| | the dial | the strip |
| --- | --- | --- |
| token | `--moon-dark` | `--moon-glyph` |
| value | `#12151f` | `#1c1c1c` |
| the body, luma | 24.9 | **28.8** |
| the sky beside a pending glyph | 11 | **8.3** |
| a pending glyph's lit lune | — | 97.1 |
| a banked glyph's lit lune | — | 189.4 |
| a banked neighbour's amber glow | — | 22.4 (sheet) / **28.1** (annulus) |

That last row is the one thing to watch. In `phase-dark.mjs` the body now reads
**28.0** against an annulus of **28.1** around a banked glyph — the same level, so
where the dark crescent meets a neighbour's amber glow the edge is carried by
*hue* (grey against amber) rather than by luma. Inside the glyph nothing changed:
the lune beside the body is still 161 luma away. If the room ever reads soft
there, the answer is a step back down the ladder (D/E are a pair, F/G the next),
not a different hue.

**Three checks were restated, and one added**, in `phase-probe.mjs` — now **18
checks, 18 passing**:

- the unlit body's level, **34–44 → 26–31** of the max channel: `#1c1c1c`'s is 28,
  where the blue-black's was 39. Measured 28.2–29.5 across six glyphs.
- **new**: the body is hue-less — the spread of its three channels is ≤ 4. The
  blue-black read 26/29/39; the grey reads 28/28/28.
- the terminator's band, **55–65° → 52–65°**: the ship sits at 55.3°, a hair above
  the old floor, and the band still fails both states the asks named (50° and
  71°).

| check | result |
| --- | --- |
| `tsc --noEmit` | exit 0 |
| `phase-probe.mjs` | **18/18** |
| `wax-probe.mjs` | all checks passed |
| `design-probe.mjs` | all checks passed (43 ok, 5 viewports) |
| `phase-dark.mjs` | body **28.0** against an annulus of 28.1 / 24.2; lune 97.1 / 189.4 |
| `moon-samples.mjs` (v3) | 25 tiles, 11 at 1:1 and 14 scaled, provenance passed; patch fidelity 0/142272 |

The sheet's own numbers are what the choice was made on, and they are the app's
pixels rather than a drawing of them: every tile is the shipped component with
one custom property set on `:root`, and the sheet's provenance check compares each
tile's region in the saved PNG with the tile it claims to be.

## The dial's graduations, back on the arc — 2026-10-18

The ring's tick marks sat a quarter turn behind the light. At 40% of a fifteen-tick
dial the six lit marks ran 294° → 54° from twelve o'clock, while the arc's own tip
stood at 144° — so the row of lit graduations glowed under the *dark* track at ten
o'clock while the arc passed grey ones at one o'clock, on the card and in the room
alike.

Two causes, one mark each.

**Two frames in one svg.** The arc is a circle dashed from its own 0° — three
o'clock — which the svg's `-rotate-90` carries round to twelve. The ticks are lines
drawn pointing *up*, so their 0° is already twelve. Inside one rotated svg those
baselines are ninety degrees apart, and the tick angle had to add the ninety back
(`+ 90`); without it every graduation landed a quarter turn behind the arc it was
supposed to mark.

**`lit` rounded.** At fifteen ticks a step is 24°, so rounding lit each mark from
the halfway point of the step before it — up to 12° ahead of the tip, a lit tick with
the light still short of it. Floored instead, so a mark lights when the arc reaches
it and not before. The dial's 25 ticks now light one per 14.4°.

Measured after, at 1280×900 with the store seeded to 6 of 15 minutes:

| read | card ring (216px, 15 ticks) | focus dial (384px, 25 ticks) |
| --- | --- | --- |
| first tick transform | `rotate(114 108 108)` | `rotate(104.4 192 192)` |
| step | 24° | 14.4° |
| `lit` at 0.4 progress | 6 | 10 |
| arc | dash 659.73 / offset 395.84 | — |

The card's pixels agree with the transforms: the arc's luma runs 200–222 from 0° to
142°, then 251 at 144° (its tip and the comet head) and 110 at 146°; the bright tick
peaks are at **24, 48, 72, 96, 120 and 144°** (luma 207–219), and every mark past
them rests at 25–29 with a 0.12-alpha peak of 26–51. The last lit graduation is on
the tip — which is the whole point of the marks.

| check | result |
| --- | --- |
| `tsc --noEmit` | exit 0 |
| `next build` | exit 0 |
| `ring-probe.mjs` (card, 6/15 min) | lit ticks at 24…144°, arc tip 144° |
| `ring-focus.mjs` (dial) | 25 ticks, first at 104.4°, 10 lit |
