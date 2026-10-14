"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Pause, Play, RotateCcw, SkipForward, X } from "lucide-react";

import { currentStreak, getDay, sortTasks } from "@/lib/activity";
import {
  PRIORITY_META,
  TIMER_PRESETS,
  modeMeta,
  presetBlurb,
} from "@/lib/constants";
import { formatClock, formatDuration } from "@/lib/format";
import {
  EASE_IN_OUT,
  EASE_OUT_EXPO,
  EASE_SOFT,
  focusAurora,
  focusItem,
  focusLens,
  focusShell,
  focusStage,
  SPRING,
} from "@/lib/motion";
import { toneForMode, toneKeyForMode } from "@/lib/tone";
import { advanceFocus, getProgress } from "@/lib/timer-actions";
import { toggleTaskWithFeedback } from "@/lib/task-actions";
import type { TimerMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { usePageVisible } from "@/hooks/use-page-visible";
import { useTodoStore } from "@/store/use-todo-store";
import { useUiStore } from "@/store/use-ui-store";
import { useTimerStore } from "@/store/use-timer-store";
import { MoonFlowMark } from "@/components/moonflow-mark";
import { ProgressRing } from "@/components/progress-ring";

const MODE_COPY = {
  focus: { hint: "One thing. Nothing else." },
  short: { hint: "Breathe. Look away from the screen." },
  long: { hint: "You've earned a longer pause." },
} as const;

/**
 * The bright stars — the only ones that move on their own.
 *
 * Opacity-only, on their own clocks, eight of them. Everything else in the sky
 * is one static raster (`.starfield` in app/globals.css), because a full-screen
 * layer that twinkles is a full-screen layer that repaints.
 */
const TWINKLERS = Array.from({ length: 8 }, (_, i) => ({
  id: i,
  left: 5 + ((i * 61) % 88),
  top: 7 + ((i * 41) % 80),
  size: i % 3 === 0 ? 2.5 : 1.75,
  duration: 5.5 + (i % 5) * 1.6,
  delay: (i % 6) * 1.3,
}));

/** Drifting motes — CSS driven, so the main thread stays free. */
const MOTES = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  left: (i * 67) % 100,
  top: 20 + ((i * 37) % 70),
  size: 1 + (i % 2) * 0.6,
  duration: 15 + (i % 5) * 3.5,
  delay: (i % 7) * 1.9,
  drift: ((i % 5) - 2) * 12,
}));

/** Radial burst directions for the completion celebration. */
const CELEBRATION_SPARKS = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2;
  const distance = 92 + (i % 3) * 32;
  return {
    id: i,
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    delay: (i % 5) * 0.045,
  };
});

/**
 * One shutter pass: close fast, hold a beat, then lift away. Keyframes are
 * evenly spaced, so the middle pair is the hold.
 */
const VEIL_TRANSITION = {
  duration: 1.15,
  ease: [EASE_OUT_EXPO, EASE_IN_OUT, EASE_OUT_EXPO],
};

/** Air between the progress ring and the orbit arc that circles it. */
const ORBIT_GAP = 26;

/** How much of the orbit the satellite's trail covers — a little under a third. */
const ORBIT_TRAIL = 0.3;

/*
 * A hidden start-up pre-warm of this tree used to live here: the overlay
 * mounted once at 1% opacity at app start, on the theory that its first commit
 * and first rasters were what the first arrival's ~250ms frame was paying for.
 * Behind the loading screen it cost ~300ms of skeleton, and with `?nowarm` as a
 * control its benefit did not reproduce (six fresh-session runs each side,
 * `entry` max median 266ms with it against 250ms without). It was removed on
 * 2026-10-11; docs/motion-budget.md records the trial and the numbers.
 */

/**
 * Where the moon's light comes from, in percent of its own box. Its surface
 * gradient and the axis its night side travels along are both derived from this
 * one point, so the light never disagrees with itself.
 */
const MOON_LIGHT = { x: 34, y: 24 } as const;

/**
 * The unit vector from the light, through the disc: the way the night side
 * slides. Away from the source, so the last of the light to go is the upper left
 * — the limb the highlight sits on.
 */
const MOON_NIGHT_AXIS = (() => {
  const dx = MOON_LIGHT.x / 100 - 0.5;
  const dy = MOON_LIGHT.y / 100 - 0.5;
  const length = Math.hypot(dx, dy);
  return { x: -dx / length, y: -dy / length };
})();

/**
 * The colour the disc's own fill and its night side share, so the seam between
 * them can never be seen — the night side is the unlit moon, not a shadow drawn
 * on top of one.
 */
const MOON_DARK = "#07080e";

/**
 * The sliver of moon that is lit even on a brand-new session. A moon that goes
 * out entirely reads as the room's centrepiece having been switched off.
 */
const MOON_MIN_LIT = 0.06;

/**
 * How far the night-side disc has to slide, as a percentage of the moon's own
 * width, for the *lit area* to be `lit` of the disc.
 *
 * Two equal discs offset by `k` leave a lune whose area is the disc less the lens
 * they share; with `t = k / 2r` that lens is `2r²(acos t − t√(1−t²))`, so the lit
 * fraction is `1 − (2/π)(acos t − t√(1−t²))` — rising from 0 at `t = 0` (the discs
 * coincident) to 1 at `t = 1` (tangent), and with no closed-form inverse. Thirty
 * bisections of a function this flat agree with the exact value to far under a
 * pixel, at 5 Hz.
 */
function nightOffset(lit: number): number {
  const target = Math.min(1, Math.max(0, lit));
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 30; step += 1) {
    const t = (lo + hi) / 2;
    const lens = (2 / Math.PI) * (Math.acos(t) - t * Math.sqrt(1 - t * t));
    if (1 - lens < target) lo = t;
    else hi = t;
  }
  return ((lo + hi) / 2) * 100;
}

/** The phase glyph's disc, in its own 24-unit canvas. */
const PHASE_RADIUS = 10;

/**
 * One moon phase, at the size of a session marker.
 *
 * The same construction the app's mark is built from (docs/mark.md) — a disc cut
 * by an offset disc — and the same inversion the room's big moon uses, so the
 * strip and the instrument are the same object at two scales. `lit` is the
 * fraction of the disc that is lit. Colour comes from the parent: the body of the
 * moon fades with it, which is what leaves a banked session and a pending one
 * legible as the *same* phase, one amber and one grey.
 */
function MoonPhaseMark({ lit, className }: { lit: number; className?: string }) {
  const maskId = `cycle-phase-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const bite = (nightOffset(lit) / 100) * PHASE_RADIUS * 2;
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-3.5", className)}>
      <mask id={maskId}>
        <rect width="24" height="24" fill="#000" />
        <circle cx="12" cy="12" r={PHASE_RADIUS} fill="#fff" />
        <circle
          cx={12 + MOON_NIGHT_AXIS.x * bite}
          cy={12 + MOON_NIGHT_AXIS.y * bite}
          r={PHASE_RADIUS}
          fill="#000"
        />
      </mask>
      {/* The unlit disc: a phase is a moon, not a wedge. */}
      <circle
        cx="12"
        cy="12"
        r={PHASE_RADIUS}
        fill="currentColor"
        fillOpacity={0.16}
      />
      <circle
        cx="12"
        cy="12"
        r={PHASE_RADIUS}
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}

interface Beat {
  id: number;
  kind: "session" | "cycle";
  from: TimerMode;
  to: TimerMode;
}

export function FocusMode() {
  const focusTaskId = useUiStore((state) => state.focusTaskId);
  const closeFocus = useUiStore((state) => state.closeFocus);
  const focusedTask = useTodoStore((state) =>
    state.tasks.find((item) => item.id === focusTaskId),
  );
  const activity = useTodoStore((state) => state.activity);
  const preset = useTimerStore((state) => state.preset);
  const mode = useTimerStore((state) => state.mode);
  const running = useTimerStore((state) => state.running);
  const remainingMs = useTimerStore((state) => state.remainingMs);
  const sessions = useTimerStore((state) => state.sessions);
  const phaseEvent = useTimerStore((state) => state.phaseEvent);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const celebrationTimer = useRef<number | null>(null);
  const seenPhaseEvent = useRef(phaseEvent?.id ?? 0);

  const [ringSize, setRingSize] = useState(300);
  const [announcement, setAnnouncement] = useState("");
  const [celebrating, setCelebrating] = useState(false);
  const [beat, setBeat] = useState<Beat | null>(null);
  const [hintsVisible, setHintsVisible] = useState(true);

  const reduceMotion = useReducedMotion();
  const pageVisible = usePageVisible();

  const open = Boolean(focusTaskId);
  const task = focusedTask;

  const tone = toneForMode(mode);
  const toneKey = toneKeyForMode(mode);
  const isFocus = tone.hot;
  const presetMeta = TIMER_PRESETS[preset];
  const longBreakAfter = presetMeta.longBreakAfter;
  const sessionWord = presetMeta.sessionWord;
  const progress = getProgress(mode, remainingMs, preset);
  /*
   * How much the moon's atmosphere brightens as the session fills up.
   *
   * Quantised to 5% steps on purpose: this is a *style*, so a new value is a
   * repaint, and `progress` changes on every 200ms tick — twenty-one steps over
   * a whole session is invisible but saves ~750 repaints of a full-ring layer.
   */
  const haloGlow = 0.85 + (Math.round(progress * 20) / 20) * 0.3;
  /*
   * A clock that has never run is *started*; a paused one is *resumed*. The
   * hand-off arms the next phase untouched, so it reads "Start" — calling it
   * "Resume" would claim the user had already begun a break they haven't.
   */
  const fresh = remainingMs >= presetMeta.durations[mode];
  const minutes = presetMeta.durations[mode] / 60_000;
  const today = getDay(activity);
  const streak = currentStreak(activity);

  const phaseLabel =
    mode === "focus"
      ? preset === "deep"
        ? "Deep work"
        : "Focus session"
      : modeMeta(preset, mode).label;

  /*
   * What the phase line says. Focus counts the sessions in the cycle, so the
   * room tells you where you are without a second widget; a break prefers the
   * instruction, which is the only thing that matters during one.
   */
  const phaseDetail =
    mode === "focus"
      ? `${sessionWord} ${Math.min(sessions + 1, longBreakAfter)} of ${longBreakAfter}`
      : null;
  const taskMeta =
    mode === "focus"
      ? [
          task ? `${PRIORITY_META[task.priority].label} priority` : null,
          task && task.pomodoros > 0 ? `${task.pomodoros} done` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : MODE_COPY[mode].hint;

  /* The clock, split so the minutes can carry the weight and the seconds sit back. */
  const [clockMinutes, clockSeconds] = formatClock(remainingMs).split(":");

  /* The moon's own geometry: a disc at 74% of the ring, with air all round it. */
  const moonInset = Math.round(ringSize * 0.13);
  /*
   * And its own progress, from the same `progress` the arc is drawn from: the
   * lit fraction of its disc. Floored so a brand-new session is a hairline
   * crescent rather than a hole in the sky, and rising to a full face as the
   * session fills. A paused clock has a progress that does not move, so the moon
   * freezes with it.
   */
  const moonLit = MOON_MIN_LIT + (1 - MOON_MIN_LIT) * progress;
  /* Percent of its own width the night side has slid, along the light's axis. */
  const moonNight = nightOffset(moonLit);
  const nightX = (moonNight * MOON_NIGHT_AXIS.x).toFixed(2);
  const nightY = (moonNight * MOON_NIGHT_AXIS.y).toFixed(2);
  /*
   * The wash lifts a little as the moon fills. Quantised to 5% steps for the same
   * reason the halo's is: a style change is a paint, and `progress` moves on
   * every tick. The night side's travel is a *transform* on a promoted layer, so
   * that one is left continuous — it costs nothing.
   */
  const moonWash = 0.86 + (Math.round(moonLit * 20) / 20) * 0.14;
  const orbitSize = ringSize + ORBIT_GAP * 2;
  const orbitRadius = orbitSize / 2 - 1;
  const orbitCircumference = 2 * Math.PI * orbitRadius;
  const orbitTrail = orbitCircumference * ORBIT_TRAIL;
  const orbitAngle = Math.PI * 2 * ORBIT_TRAIL;
  const satelliteX = orbitSize / 2 + orbitRadius * Math.cos(orbitAngle);
  const satelliteY = orbitSize / 2 + orbitRadius * Math.sin(orbitAngle);

  /*
   * Size the ring from the room it actually has, not from the viewport: the
   * screen never scrolls, so the instrument has to fit the stage at every
   * height. The stage's own box doesn't depend on the ring — only on the title
   * block above it — so measure → set settles in one pass and can't loop.
   */
  useEffect(() => {
    if (!open) return;
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const { width, height } = stage.getBoundingClientRect();
      const blockHeight = blockRef.current?.getBoundingClientRect().height ?? 148;
      /*
       * The orbit needs ORBIT_GAP of air on every side, and the stage's own gap
       * plus padding (and the moon's outer glow) want ~96px of the height.
       */
      const room = Math.min(
        width - ORBIT_GAP * 2 - 12,
        height - blockHeight - 96,
      );
      setRingSize(Math.max(148, Math.min(384, Math.round(room))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    if (blockRef.current) observer.observe(blockRef.current);
    /*
     * The first measure can land before the stage's box is final (web font,
     * viewport units), and a ResizeObserver only reports further *changes* — so
     * one settle pass after the arrival choreography keeps the instrument
     * right even if nothing else ever resizes.
     */
    const settle = window.setTimeout(measure, 1100);
    return () => {
      window.clearTimeout(settle);
      observer.disconnect();
    };
  }, [open]);

  /*
   * Keep the timer linked to the task the overlay is showing, whatever put it
   * there — a click on the row (`enterFocus`), the F key, or the advance after
   * a task is completed (`advanceFocus`). Both entry paths start the session
   * themselves; this effect is only the safety net that keeps the link honest
   * when something else moved the overlay.
   */
  useEffect(() => {
    if (!focusTaskId) return;
    const timer = useTimerStore.getState();
    if (timer.taskId !== focusTaskId) timer.setTaskId(focusTaskId);
  }, [focusTaskId]);

  /* Lock background scroll and manage focus for screen readers. */
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    containerRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  /*
   * The departure freezes the scene's eternal animations (the breathing orbital
   * shells, the twinkling stars, the drifting motes, the satellite's orbit, the
   * live dot) for the length of the fade — see `.departing` in app/globals.css
   * for why the window wants it.
   *
   * The class cannot come from the render. The tree AnimatePresence keeps
   * mounted during an exit is the one from *before* the store flipped, so every
   * `className` in it still says the overlay is open; only an effect (which
   * runs in the re-render that follows) can see the new state. It goes on the
   * live DOM node, which is the same node either way.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.classList.toggle("departing", !open);
  }, [open]);

  /* The task vanished (deleted) — leave gracefully. */
  useEffect(() => {
    if (focusTaskId && !task) closeFocus();
  }, [focusTaskId, task, closeFocus]);

  /*
   * Announce on entry, phase changes and the start/pause toggle — never every
   * tick. A hand-off leaves the next phase armed but *not running*, and saying
   * "remaining" over a clock nobody started would be a small lie.
   */
  useEffect(() => {
    if (!open) return;
    setAnnouncement(
      `${phaseLabel}. ${formatClock(remainingMs)} ${running ? "remaining" : "ready"}.`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, sessions, running]);

  /* Never leave a pending celebration timer behind. */
  useEffect(
    () => () => {
      if (celebrationTimer.current) window.clearTimeout(celebrationTimer.current);
    },
    [],
  );

  /* The phase hand-off: staged here, but the timer never waits for it. */
  useEffect(() => {
    if (!phaseEvent || phaseEvent.id === seenPhaseEvent.current) return;
    seenPhaseEvent.current = phaseEvent.id;
    if (!open || reduceMotion) return;
    setBeat(phaseEvent);
    const timeout = window.setTimeout(() => setBeat(null), 1700);
    return () => window.clearTimeout(timeout);
  }, [phaseEvent, open, reduceMotion]);

  /* Any key or tap skips the beat immediately. */
  useEffect(() => {
    if (!beat) return;
    const skip = () => setBeat(null);
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [beat]);

  /* Keyboard hints step back once you're absorbed. */
  useEffect(() => {
    if (!open) return;
    let timer = window.setTimeout(() => setHintsVisible(false), 5000);
    const wake = () => {
      setHintsVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setHintsVisible(false), 5000);
    };
    window.addEventListener("keydown", wake);
    window.addEventListener("pointermove", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("pointermove", wake);
    };
  }, [open]);

  function exit() {
    setBeat(null);
    closeFocus();
  }

  function handleComplete() {
    if (!task) return;
    if (task.completed) {
      exit();
      return;
    }
    /*
     * Completing the task ends *its* session. The minutes it was given are
     * banked where they were spent — before the completion releases the link,
     * so they land on this task and not on the day alone — and the clock is
     * re-armed to a whole session, so whoever is next gets a full one instead
     * of the tail of the one that just finished. The advance then starts it:
     * the user is still in here, so landing on a task still means working on
     * it. A break is left alone: the task ending is not the pause ending.
     */
    const timer = useTimerStore.getState();
    if (timer.mode === "focus") timer.reset();
    toggleTaskWithFeedback(task);
    setCelebrating(true);
    if (celebrationTimer.current) window.clearTimeout(celebrationTimer.current);
    celebrationTimer.current = window.setTimeout(() => {
      celebrationTimer.current = null;
      setCelebrating(false);
      const ui = useUiStore.getState();
      // The user may have left focus mode during the celebration.
      if (ui.focusTaskId !== task.id) return;
      /*
       * "Next" means the next row the *list* would show: sorted the way it
       * sorts, and inside the tag filter the user is looking through. This used
       * to take the first open task in raw store order, which is the same thing
       * only while no tag filter is set.
       */
      const todos = useTodoStore.getState().tasks;
      const pool = ui.tagFilter
        ? todos.filter((item) => item.tags.includes(ui.tagFilter as string))
        : todos;
      const nextTask = sortTasks(pool).find((item) => !item.completed);
      /* Same rule as entry: landing on a task in here starts its session. */
      if (nextTask) advanceFocus(nextTask.id);
      else ui.closeFocus();
    }, 1000);
  }

  const iconBtn =
    "grid size-11 cursor-pointer place-items-center rounded-full text-white/60 transition-colors duration-200 hover:bg-white/[0.07] hover:text-white focus-visible:outline-2 focus-visible:outline-primary";

  return (
    <AnimatePresence>
      {open && task && (
        <motion.div
          ref={containerRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={`Focus mode: ${task.title}`}
          variants={focusShell}
          initial="hidden"
          animate="show"
          exit="exit"
          /*
           * Full screen and scroll-proof: the overlay is a fixed, clipped box
           * (`overscroll-none` also stops rubber-banding on touch), and the
           * column inside it is a three-row flex that owns the whole height.
           */
          className="fixed inset-0 z-50 overflow-hidden overscroll-none bg-[#040509] outline-none"
        >
          {/**
           * Atmosphere, in cheap layers — see docs/motion-budget.md.
           *
           * This is the room: deep space, a starfield, one galactic band, two
           * breathing orbital shells and a vignette. Nothing in this layer is
           * ever transformed — it is rastered once per mount and left alone, so
           * the whole sky costs one paint. The moving parts live above it.
           */}
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden"
            aria-hidden
          >
            {/* Deep space: cool at the top, falling to near-black at the feet. */}
            <div className="absolute inset-0 bg-[radial-gradient(125%_92%_at_50%_-16%,#0c1022_0%,#070812_46%,#030407_100%)]" />
            {/* The field — one static raster of eight dot layers. */}
            <div className="starfield absolute inset-0" />
            {/* One direction to the sky, masked so it never reads as a stripe. */}
            <div className="galaxy absolute inset-0" />
            {/* Orbital shells. They breathe; they never move the instrument. */}
            <div className="absolute left-1/2 top-1/2 size-[min(760px,120vw)] -translate-x-1/2 -translate-y-1/2 animate-breathe rounded-full border border-white/[0.05]" />
            <div className="absolute left-1/2 top-1/2 size-[min(560px,90vw)] -translate-x-1/2 -translate-y-1/2 animate-breathe rounded-full border border-white/[0.04] [animation-delay:-2s]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_44%,transparent_22%,rgba(2,3,6,0.8)_100%)]" />
          </div>

          {/* Above the base, below the stars: the nebula only ever translates. */}
          <motion.div
            variants={focusAurora}
            className="pointer-events-none absolute inset-0 overflow-hidden"
            aria-hidden
          >
            <AnimatePresence>
              <motion.div
                key={`nebula-${toneKey}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.5, ease: EASE_SOFT }}
                className="absolute inset-0"
              >
                {/*
                 * Two soft radial falloffs rather than two 130–150px blurs:
                 * visually the same cloud, but a gradient rasterises once and
                 * cheaply, where a big gaussian blur dominated the overlay's
                 * first paints (measured — see docs/motion-budget.md).
                 */}
                <div
                  className="drift-a absolute inset-x-0 top-[-22%] mx-auto h-[600px] w-[820px] max-w-[132vw] rounded-full"
                  style={{
                    background: `radial-gradient(closest-side, rgba(${tone.rgb},${
                      isFocus ? 0.26 : 0.1
                    }), rgba(${tone.rgb},${isFocus ? 0.12 : 0.045}) 45%, transparent 100%)`,
                  }}
                />
                <div
                  className="drift-b absolute -bottom-[30%] -right-[14%] size-[540px] max-w-[120vw] rounded-full"
                  style={{
                    background: `radial-gradient(closest-side, rgba(${tone.rgb},${
                      isFocus ? 0.2 : 0.075
                    }), rgba(${tone.rgb},${isFocus ? 0.09 : 0.035}) 50%, transparent 100%)`,
                  }}
                />
              </motion.div>
            </AnimatePresence>
          </motion.div>

          {/* The stars — the twinkle and the motes settle in together. */}
          <motion.div
            variants={focusLens}
            className="pointer-events-none absolute inset-0 overflow-hidden"
            aria-hidden
          >
            {pageVisible &&
              TWINKLERS.map((star) => (
                <span
                  key={`star-${star.id}`}
                  className={cn(
                    "absolute rounded-full bg-ivory",
                    !reduceMotion && "twinkle",
                  )}
                  style={
                    {
                      left: `${star.left}%`,
                      top: `${star.top}%`,
                      width: star.size,
                      height: star.size,
                      opacity: 0.55,
                      "--twinkle-duration": `${star.duration}s`,
                      "--twinkle-delay": `${star.delay}s`,
                    } as CSSProperties
                  }
                />
              ))}

            {pageVisible &&
              !reduceMotion &&
              MOTES.map((mote) => (
                <span
                  key={`mote-${mote.id}`}
                  className={cn(
                    "float-up absolute rounded-full",
                    isFocus ? "bg-primary-soft/70" : "bg-ivory/55",
                  )}
                  style={
                    {
                      left: `${mote.left}%`,
                      top: `${mote.top}%`,
                      width: mote.size,
                      height: mote.size,
                      "--float-duration": `${mote.duration}s`,
                      "--float-delay": `${mote.delay}s`,
                      "--drift": `${mote.drift}px`,
                    } as CSSProperties
                  }
                />
              ))}
          </motion.div>

          {/* Film grain last, and outside the push-in so it never re-rasters. */}
          <div
            aria-hidden
            className="grain pointer-events-none absolute inset-0 opacity-[0.045]"
          />

          {/*
           * The arrival: two veils sweep in from the edges — each with a
           * hairline at its leading edge — hold while the lens settles, then
           * lift away. Behind the content on purpose, so nothing ever covers
           * the task or the controls, and inside a clipped box so a parked
           * veil never adds scrollable area to the overlay.
           */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
          >
            <motion.span
              className="absolute inset-x-0 top-0 h-[30vh] border-b border-white/[0.06] bg-gradient-to-b from-[#0b0e1d] via-[#080a13]/80 to-transparent"
              initial={{ y: "-102%" }}
              animate={{ y: ["-102%", "0%", "0%", "-102%"] }}
              transition={VEIL_TRANSITION}
            />
            <motion.span
              className="absolute inset-x-0 bottom-0 h-[26vh] border-t border-white/[0.06] bg-gradient-to-t from-[#0b0e1d] via-[#080a13]/80 to-transparent"
              initial={{ y: "102%" }}
              animate={{ y: ["102%", "0%", "0%", "102%"] }}
              transition={VEIL_TRANSITION}
            />
          </div>

          {/* One pass of light as the veils lift — and on every phase change. */}
          <motion.span
            key={`sweep-${toneKey}`}
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-y-0 z-[12] w-1/3 bg-gradient-to-r from-transparent to-transparent",
              isFocus ? "via-primary/[0.07]" : "via-ivory/[0.06]",
            )}
            initial={{ x: "-130%" }}
            animate={{ x: "330%" }}
            transition={{ duration: 1.3, delay: 0.24, ease: EASE_OUT_EXPO }}
          />

          {/* The session — three rows, the middle one owns the slack. */}
          <motion.div
            variants={focusStage}
            /*
             * `overflow-x-clip` trims the few pixels the orbit, the phase
             * shockwave and the celebration sparks spend outside the column —
             * horizontally only, so the moon's glow keeps its vertical bloom.
             * `clip` (not `hidden`) adds no scroll port.
             */
            className="relative z-20 flex h-full w-full flex-col overflow-x-clip px-5 pb-5 pt-5 sm:px-8 sm:pb-6 sm:pt-6"
          >
            {/* Top bar: the app's own instrument, the rhythm, and the way out. */}
            <div className="flex flex-none items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-3">
                <MoonFlowMark className="size-5 shrink-0 text-ivory/60" />
                <span
                  className="hidden min-w-0 items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.03] py-1 pl-2.5 pr-3 sm:inline-flex"
                  title={`${presetMeta.label} preset — ${presetBlurb(presetMeta)}`}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      running && "animate-pulse-soft",
                    )}
                    style={{
                      background: running
                        ? tone.solid
                        : "rgba(244,241,234,0.3)",
                    }}
                  />
                  <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
                    {presetMeta.label} · {presetMeta.durations.focus / 60_000} /{" "}
                    {presetMeta.durations.short / 60_000}
                  </span>
                </span>
              </span>
              <button
                type="button"
                onClick={exit}
                className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-white/65 transition-colors duration-200 hover:bg-white/[0.09] hover:text-white focus-visible:outline-2 focus-visible:outline-primary"
                aria-label="Exit focus mode"
              >
                <X className="size-4" />
                <span className="hidden sm:inline">Exit focus</span>
                <span className="sm:hidden">Exit</span>
                <span className="kbd hidden sm:inline">Esc</span>
              </button>
            </div>

            {/* Stage: the task, a rule, then the instrument. */}
            <div
              ref={stageRef}
              className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-5 py-3 text-center sm:gap-7"
            >
              <div
                ref={blockRef}
                className="flex flex-none flex-col items-center gap-3"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={`phase-${toneKey}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.34, delay: 0.3, ease: EASE_OUT_EXPO }}
                    className={cn(
                      "text-[10.5px] font-bold uppercase tracking-[0.3em] [@media(max-height:520px)]:hidden",
                      isFocus
                        ? "text-primary-soft glow-accent"
                        : "text-ivory glow-ivory",
                    )}
                  >
                    {phaseLabel}
                    {phaseDetail && (
                      <span className="text-white/35">
                        {" · "}
                        {phaseDetail}
                      </span>
                    )}
                  </motion.span>
                </AnimatePresence>

                <AnimatePresence mode="wait">
                  <motion.h1
                    key={task.id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -14 }}
                    transition={{ duration: 0.42, delay: 0.4, ease: EASE_OUT_EXPO }}
                    className="line-clamp-2 max-w-[22ch] text-balance text-[clamp(1.5rem,calc(3.2vh_+_1rem),2.9rem)] font-medium leading-[1.1] tracking-[-0.015em] text-white/95"
                  >
                    {task.title}
                  </motion.h1>
                </AnimatePresence>

                <p className="text-[11px] tracking-[0.02em] text-white/40 [@media(max-height:640px)]:hidden">
                  {taskMeta}
                </p>

                <span aria-hidden className="hairline w-24 opacity-70" />
              </div>

              {/*
               * The instrument: a satellite orbit around a moon, with the
               * progress ring as the dial. It arrives behind the veils with
               * opacity and a short rise — no filter and no scale, because the
               * ring's arc is drop-shadowed and animating either one
               * re-rasterises it on every frame of the entry
               * (docs/motion-budget.md).
               *
               * `will-change` is normally left to Framer, but this box keeps
               * moving long after the arrival: the arc, the comet head and the
               * graduation ticks retick every 200ms for the whole session. With
               * no layer of its own those repaints invalidated the stage layer
               * (measured: 93 repaints of 1863×870 in one arrival); promoting
               * just this box halved the arrival's dropped frames in a paired
               * A/B (20 → 8).
               *
               * The halo is deliberately the *first* child: it is the box the
               * visual check samples for the breath, and it must stay a
               * radial-gradient that only ever changes opacity.
               */}
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.9, delay: 0.3, ease: EASE_OUT_EXPO }}
                className="relative flex-none will-change-transform"
              >
                {/*
                 * The moonlight: a halo that breathes while the timer runs and
                 * brightens with progress. Both of those are load-bearing:
                 *
                 * 1. The breath is brightness only. It used to scale (1 →
                 *    1.035), which left a forever-moving transform on a
                 *    full-ring layer and resampled its gradient every frame,
                 *    over a ring whose arc, comet head and graduations repaint
                 *    every 200ms.
                 * 2. Its animated targets are *constants*. They used to be
                 *    built from `progress`, and a Framer target that changes
                 *    restarts the animation — so on every 200ms tick the breath
                 *    started over and never got anywhere (measured in the phone
                 *    viewport: opacity 0.500 → 0.504 across 4.5s). Progress
                 *    moves into this element's own gradient instead — a style:
                 *    a paint, never a restart.
                 */}
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-4 rounded-full"
                  style={{
                    background: `radial-gradient(circle, rgba(${tone.rgb},${
                      (isFocus ? 0.28 : 0.18) * haloGlow
                    }), rgba(${tone.rgb},${
                      (isFocus ? 0.12 : 0.08) * haloGlow
                    }) 42%, transparent 74%)`,
                  }}
                  animate={
                    running && !reduceMotion
                      ? { opacity: [0.45, 0.95] }
                      : { opacity: 0.4 + progress * 0.3 }
                  }
                  transition={
                    running && !reduceMotion
                      ? {
                          duration: 3.4,
                          repeat: Infinity,
                          repeatType: "mirror",
                          ease: "easeInOut",
                        }
                      : { duration: 0.6 }
                  }
                />

                {/*
                 * The moon, at the centre of its own dial — the composition the
                 * app's mark is built from (docs/mark.md), at full size, and the
                 * second reading of the same number the arc carries: its lit
                 * *fraction* is the session's elapsed fraction, so it waxes from
                 * a hairline crescent to a full face across the session.
                 *
                 * It is a *dark* sphere lit from the upper left. The light is one
                 * gradient on the disc; the night side is a disc of the room's
                 * own dark, the same size as the moon, sliding along the light's
                 * axis until it clears the disc entirely. Both halves are free to
                 * move on every 200ms tick — a transform on a promoted layer and
                 * an opacity quantised to 5% steps — where a masked shape would
                 * repaint the whole disc 7500 times over a session
                 * (docs/motion-budget.md).
                 */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute overflow-hidden rounded-full"
                  style={{ inset: moonInset, background: MOON_DARK }}
                >
                  {/* The sphere's own light, brightest toward its source. */}
                  <div
                    className="absolute inset-0"
                    style={{
                      background: `radial-gradient(circle at ${MOON_LIGHT.x}% ${MOON_LIGHT.y}%, rgba(236,240,255,0.13), rgba(139,153,255,0.05) 46%, rgba(96,110,200,0.028) 100%)`,
                      opacity: moonWash,
                      transition: reduceMotion ? "none" : "opacity 240ms linear",
                    }}
                  />
                  {/* The night side, sliding off the disc as the session fills. */}
                  <div
                    className="absolute inset-0 rounded-full will-change-transform"
                    style={{
                      background: MOON_DARK,
                      transform: `translate(${nightX}%, ${nightY}%)`,
                      transition: reduceMotion ? "none" : "transform 240ms linear",
                    }}
                  />
                </div>

                {/*
                 * Form, above the light: the limb's hairline, the rim light
                 * along the top and the falloff to the lower right. It carries no
                 * fill of its own, so the moon keeps its silhouette at every
                 * phase — a new moon is still a moon.
                 */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute rounded-full"
                  style={{
                    inset: moonInset,
                    boxShadow:
                      "inset 0 0 0 1px rgba(244,241,234,0.05), inset 0 1px 0 rgba(244,241,234,0.1), inset -16px -20px 54px rgba(0,0,0,0.55)",
                  }}
                />

                {/* One satellite on a slow orbit, its trail fading behind it. */}
                <div
                  aria-hidden
                  className="orbit-spin pointer-events-none absolute"
                  style={{ inset: -ORBIT_GAP }}
                >
                  <svg
                    width={orbitSize}
                    height={orbitSize}
                    viewBox={`0 0 ${orbitSize} ${orbitSize}`}
                    className="absolute inset-0"
                  >
                    <defs>
                      <linearGradient
                        id={`orbit-trail-${toneKey}`}
                        x1="1"
                        y1="0.05"
                        x2="0.1"
                        y2="0.9"
                      >
                        <stop
                          offset="0%"
                          stopColor={tone.soft}
                          stopOpacity="0.05"
                        />
                        <stop
                          offset="100%"
                          stopColor={tone.soft}
                          stopOpacity="0.32"
                        />
                      </linearGradient>
                    </defs>
                    <circle
                      cx={orbitSize / 2}
                      cy={orbitSize / 2}
                      r={orbitRadius}
                      fill="none"
                      stroke={`url(#orbit-trail-${toneKey})`}
                      strokeWidth={1.25}
                      strokeLinecap="round"
                      strokeDasharray={`${orbitTrail} ${
                        orbitCircumference - orbitTrail
                      }`}
                    />
                    <circle
                      cx={satelliteX}
                      cy={satelliteY}
                      r={1.9}
                      fill={tone.soft}
                      opacity={0.8}
                    />
                  </svg>
                </div>

                {/* One-shot shockwave whenever the session phase changes */}
                <motion.span
                  key={`shock-${toneKey}`}
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-full border"
                  style={{ borderColor: `rgba(${tone.rgb},0.45)` }}
                  initial={{ scale: 0.78, opacity: 0.6 }}
                  animate={{ scale: 1.32, opacity: 0 }}
                  transition={{ duration: 1.2, ease: "easeOut" }}
                />

                <ProgressRing
                  progress={progress}
                  size={ringSize}
                  strokeWidth={ringSize < 200 ? 4 : isFocus ? 6 : 5}
                  tone={toneKey}
                  ticks={{ total: minutes, majorEvery: 5 }}
                >
                  <div className="grid place-items-center gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-[0.3em] text-white/40">
                      {/* A clock that has never run is *ready*, not paused. */}
                      {running ? "Remaining" : fresh ? "Ready" : "Paused"}
                    </span>
                    <motion.span
                      key={mode}
                      role="timer"
                      initial={{ opacity: 0, y: 8, scale: 0.94 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
                      style={{
                        fontSize: `clamp(2.1rem, ${Math.round(
                          ringSize * 0.235,
                        )}px, 5.25rem)`,
                      }}
                      className={cn(
                        "font-mono font-normal leading-none tracking-[-0.045em] tabular-nums",
                        isFocus
                          ? "[text-shadow:0_0_56px_rgba(75,98,255,0.4)]"
                          : "[text-shadow:0_0_56px_rgba(232,226,214,0.3)]",
                      )}
                    >
                      <span className="text-white">{clockMinutes}</span>
                      {/* The seconds are the detail, not the readout. */}
                      <span className="text-white/35">:{clockSeconds}</span>
                    </motion.span>
                  </div>
                </ProgressRing>

                {/* Completing the task itself */}
                <AnimatePresence>
                  {celebrating && (
                    <motion.div
                      key="celebration"
                      className="pointer-events-none absolute inset-0 grid place-items-center"
                      initial={{ opacity: 1 }}
                      exit={{ opacity: 0, transition: { duration: 0.3 } }}
                      aria-hidden
                    >
                      {[0, 0.16].map((delay) => (
                        <motion.span
                          key={delay}
                          className="absolute size-44 rounded-full border-2 border-ivory/70"
                          initial={{ scale: 0.35, opacity: 0.9 }}
                          animate={{ scale: 2, opacity: 0 }}
                          transition={{ duration: 1.05, delay, ease: "easeOut" }}
                        />
                      ))}
                      {CELEBRATION_SPARKS.map((spark) => (
                        <motion.span
                          key={spark.id}
                          className="absolute size-1.5 rounded-full bg-ivory"
                          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                          animate={{
                            x: spark.x,
                            y: spark.y,
                            opacity: 0,
                            scale: 0.4,
                          }}
                          transition={{
                            duration: 0.9,
                            delay: 0.05 + spark.delay,
                            ease: "easeOut",
                          }}
                        />
                      ))}
                      <motion.span
                        className="absolute grid size-16 place-items-center rounded-full bg-ivory text-[#0a0a0b] shadow-[0_18px_50px_-14px_rgba(232,226,214,0.85)]"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: [0, 1.14, 1], opacity: 1 }}
                        exit={{
                          scale: 0.7,
                          opacity: 0,
                          transition: { duration: 0.24 },
                        }}
                        transition={{
                          duration: 0.46,
                          ease: "easeOut",
                          times: [0, 0.6, 1],
                        }}
                      >
                        <Check className="size-7" strokeWidth={3} />
                      </motion.span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>

            {/* Controls, then everything that can afford to step away. */}
            <div className="flex flex-none flex-col items-center gap-3 sm:gap-4">
              <motion.div
                variants={focusItem}
                className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3"
              >
                <button
                  type="button"
                  onClick={() => useTimerStore.getState().toggle()}
                  className="flex h-14 min-w-[176px] cursor-pointer items-center justify-center gap-2.5 rounded-full px-8 text-sm font-semibold tracking-[0.01em] transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-primary"
                  style={{
                    background: `linear-gradient(180deg, ${tone.from} 0%, ${tone.solid} 58%, ${tone.to} 100%)`,
                    color: isFocus ? "#ffffff" : "#0a0a0b",
                    boxShadow: `0 24px 60px -26px rgba(${tone.rgb},0.95), inset 0 1px 0 rgba(255,255,255,0.26)`,
                  }}
                  aria-label={
                    running ? "Pause timer" : fresh ? "Start timer" : "Resume timer"
                  }
                >
                  {running ? (
                    <>
                      <Pause className="size-4" /> Pause
                    </>
                  ) : (
                    <>
                      <Play className="size-4" /> {fresh ? "Start" : "Resume"}
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleComplete}
                  disabled={task.completed}
                  className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-6 text-sm font-semibold text-white/85 transition-colors duration-200 hover:border-ivory/40 hover:bg-ivory/10 hover:text-white focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-60"
                  aria-label={`Complete “${task.title}”`}
                >
                  <Check className="size-4" />
                  {task.completed ? "Completed" : "Complete"}
                </button>

                <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.025] p-1.5">
                  <button
                    type="button"
                    onClick={() => useTimerStore.getState().skip()}
                    className={iconBtn}
                    aria-label="Skip to next session"
                    title="Skip"
                  >
                    <SkipForward className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => useTimerStore.getState().reset()}
                    className={iconBtn}
                    aria-label="Reset current session"
                    title="Reset"
                  >
                    <RotateCcw className="size-4" />
                  </button>
                </div>
              </motion.div>

              {/* Quiet readouts — they only stay where there is height to spare. */}
              <motion.div
                variants={focusItem}
                className="flex flex-col items-center gap-2 [@media(max-height:720px)]:hidden"
              >
                <div
                  className="flex items-center gap-2"
                  role="img"
                  aria-label={`${sessions} of ${longBreakAfter} focus ${sessionWord.toLowerCase()}s completed`}
                >
                  {/*
                   * A cycle's four sessions as four moon phases: even quarters of
                   * the disc — crescent, half, gibbous, full — so the strip
                   * reads as the cycle's own month. One banked session is one
                   * phase further through it, and the full moon at the end of the
                   * row is the one that buys the long break. Four identical dots
                   * said how many; four phases say how far.
                   */}
                  {Array.from({ length: longBreakAfter }).map((_, index) => (
                    <MoonPhaseMark
                      key={index}
                      lit={(index + 1) / longBreakAfter}
                      /*
                       * Two states, not three: the eyebrow above already says
                       * which session this is ("Session 2 of 4"), so the row
                       * only has to say how many are banked. A session in
                       * progress is a moon not yet lit.
                       */
                      className={cn(
                        "transition-[color,filter] duration-500",
                        index < sessions
                          ? "text-achievement drop-shadow-[0_0_5px_rgba(233,184,114,0.6)]"
                          : "text-ivory/35",
                      )}
                    />
                  ))}
                </div>

                <p className="font-mono text-caption text-white/45">
                  {formatDuration(today.focusMinutes)} focused today
                  {streak > 0 && ` · ${streak}-day streak`}
                </p>
              </motion.div>

              <motion.div
                variants={focusItem}
                className="flex w-full justify-center [@media(max-height:620px)]:hidden"
              >
                <motion.div
                  initial={{ opacity: 1 }}
                  animate={{ opacity: hintsVisible ? 1 : 0 }}
                  transition={{ duration: 0.7, ease: EASE_SOFT }}
                  className={cn(
                    "flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] text-white/45",
                    !hintsVisible && "pointer-events-none",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="kbd">Space</span>{" "}
                    {running ? "pause" : fresh ? "start" : "resume"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="kbd">X</span> complete
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="kbd">Esc</span> exit focus
                  </span>
                </motion.div>
              </motion.div>
            </div>
          </motion.div>

          {/*
           * Phase hand-off — presentational only. The clock does *not* keep
           * running: `completeSession` arms the next phase and leaves it for
           * the user to start.
           */}
          <AnimatePresence>
            {beat && (
              <motion.div
                key={beat.id}
                className="pointer-events-none absolute inset-0 z-40 grid place-items-center"
                initial={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.42, ease: EASE_SOFT } }}
                aria-hidden
              >
                <motion.span
                  className="absolute inset-0"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.55, ease: EASE_SOFT }}
                  style={{
                    background:
                      "radial-gradient(ellipse at 50% 50%, rgba(5,5,7,0) 22%, rgba(5,5,7,0.78) 100%)",
                  }}
                />
                <motion.span
                  className="absolute size-40 rounded-full border"
                  style={{
                    borderColor:
                      beat.kind === "cycle"
                        ? "rgba(233,184,114,0.6)"
                        : `rgba(${tone.rgb},0.55)`,
                  }}
                  initial={{ scale: 0.3, opacity: 0.85 }}
                  animate={{ scale: 4.2, opacity: 0 }}
                  transition={{ duration: 1.3, ease: "easeOut" }}
                />
                {CELEBRATION_SPARKS.slice(0, 10).map((spark) => (
                  <motion.span
                    key={spark.id}
                    className={cn(
                      "absolute size-1.5 rounded-full",
                      beat.kind === "cycle" ? "bg-achievement" : "bg-ivory",
                    )}
                    initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                    animate={{ x: spark.x, y: spark.y, opacity: 0, scale: 0.4 }}
                    transition={{
                      duration: 1,
                      delay: 0.06 + spark.delay,
                      ease: "easeOut",
                    }}
                  />
                ))}

                <div className="relative grid place-items-center px-6 text-center">
                  <motion.span
                    className="grid size-14 place-items-center rounded-full"
                    style={{
                      background: beat.kind === "cycle" ? "#e9b872" : tone.solid,
                      color:
                        beat.kind === "cycle"
                          ? "#1b1408"
                          : isFocus
                            ? "#ffffff"
                            : "#0a0a0b",
                      boxShadow: `0 20px 60px -20px rgba(${
                        beat.kind === "cycle" ? "233,184,114" : tone.rgb
                      },0.95)`,
                    }}
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={SPRING.pop}
                  >
                    <Check className="size-6" strokeWidth={3} />
                  </motion.span>
                  <motion.p
                    className="mt-5 text-xl font-semibold tracking-[-0.01em] text-white"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.07, duration: 0.45, ease: EASE_OUT_EXPO }}
                  >
                    {beat.kind === "cycle"
                      ? "Cycle complete"
                      : beat.from === "focus"
                        ? "Session complete"
                        : "Break's over"}
                  </motion.p>
                  <motion.p
                    className="mt-1.5 font-mono text-caption text-white/50"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.14, duration: 0.45, ease: EASE_OUT_EXPO }}
                  >
                    {beat.kind === "cycle"
                      ? `${formatDuration(today.focusMinutes)} focused today`
                      : beat.from === "focus"
                        ? `${modeMeta(preset, beat.to).label} ready`
                        : "Back to it"}
                  </motion.p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <p role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
