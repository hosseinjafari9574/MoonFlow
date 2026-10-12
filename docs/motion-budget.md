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
