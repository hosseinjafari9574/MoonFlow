"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Pause, Play, RotateCcw, SkipForward, X } from "lucide-react";

import { currentStreak, getDay } from "@/lib/activity";
import { TIMER_PRESETS, modeMeta, presetBlurb } from "@/lib/constants";
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
import { getProgress } from "@/lib/timer-actions";
import { toggleTaskWithFeedback } from "@/lib/task-actions";
import type { TimerMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { usePageVisible } from "@/hooks/use-page-visible";
import { useTodoStore } from "@/store/use-todo-store";
import { useUiStore } from "@/store/use-ui-store";
import { useTimerStore } from "@/store/use-timer-store";
import { ProgressRing } from "@/components/progress-ring";

const MODE_COPY = {
  focus: { hint: "One thing. Nothing else." },
  short: { hint: "Breathe. Look away from the screen." },
  long: { hint: "You've earned a longer pause." },
} as const;

/** Drifting specks — CSS driven, so the main thread stays free. */
const PARTICLES = Array.from({ length: 16 }, (_, i) => ({
  id: i,
  left: (i * 53) % 100,
  top: 18 + ((i * 37) % 74),
  size: 1 + (i % 3) * 0.75,
  duration: 12 + (i % 6) * 3.5,
  delay: (i % 8) * 1.7,
  drift: ((i % 5) - 2) * 14,
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

/*
 * A hidden start-up pre-warm of this tree used to live here: the overlay
 * mounted once at 1% opacity at app start, on the theory that its first commit
 * and first rasters were what the first arrival's ~250ms frame was paying for.
 * Behind the loading screen it cost ~300ms of skeleton, and with `?nowarm` as a
 * control its benefit did not reproduce (six fresh-session runs each side,
 * `entry` max median 266ms with it against 250ms without). It was removed on
 * 2026-10-11; docs/motion-budget.md records the trial and the numbers.
 */

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
  const titleRef = useRef<HTMLHeadingElement>(null);
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
   * A clock that has never run is *started*; a paused one is *resumed*. The
   * hand-off arms the next phase untouched, so it reads "Start" — calling it
   * "Resume" would claim the user had already begun a break they haven't.
   */
  const fresh = remainingMs >= presetMeta.durations[mode];
  const minutes = presetMeta.durations[mode] / 60_000;
  const today = getDay(activity);
  const streak = currentStreak(activity);

  const eyebrow =
    mode === "focus"
      ? preset === "deep"
        ? "Deep work"
        : "Focus session"
      : modeMeta(preset, mode).label;

  /*
   * Size the ring from the room it actually has, not from the viewport: the
   * screen never scrolls, so the instrument has to fit the stage at every
   * height. The stage's own box doesn't depend on the ring, so measure → set
   * settles in one pass and can't loop.
   */
  useEffect(() => {
    if (!open) return;
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const { width, height } = stage.getBoundingClientRect();
      const titleHeight = titleRef.current?.getBoundingClientRect().height ?? 76;
      // Eyebrow block (~40) plus the two stage gaps (~48) and a little air.
      const room = Math.min(width - 8, height - titleHeight - 120);
      setRingSize(Math.max(148, Math.min(384, Math.round(room))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    if (titleRef.current) observer.observe(titleRef.current);
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
   * Keep the timer linked to the task being focused on — the *state* follows
   * the overlay, the clock never does. Opening Focus Mode points the timer at
   * the task and leaves it exactly as it was; running it stays the Start
   * button's job. That is what keeps the automatic advance honest too: when
   * completing a task moves the overlay to the next one, the next task arrives
   * armed and untouched instead of already underway.
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
      `${eyebrow}. ${formatClock(remainingMs)} ${running ? "remaining" : "ready"}.`,
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
    toggleTaskWithFeedback(task);
    setCelebrating(true);
    if (celebrationTimer.current) window.clearTimeout(celebrationTimer.current);
    celebrationTimer.current = window.setTimeout(() => {
      celebrationTimer.current = null;
      setCelebrating(false);
      const ui = useUiStore.getState();
      // The user may have left focus mode during the celebration.
      if (ui.focusTaskId !== task.id) return;
      const nextTask = useTodoStore.getState().tasks.find(
        (item) => item.id !== task.id && !item.completed,
      );
      if (nextTask) ui.openFocus(nextTask.id);
      else ui.closeFocus();
    }, 1000);
  }

  const iconBtn =
    "grid size-11 cursor-pointer place-items-center rounded-xl border border-white/12 bg-white/[0.04] text-white/70 transition-colors duration-200 hover:border-white/25 hover:bg-white/[0.09] hover:text-white focus-visible:outline-2 focus-visible:outline-primary";

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
          className="fixed inset-0 z-50 overflow-hidden overscroll-none bg-[#070709] outline-none"
        >
          {/**
           * Atmosphere, in cheap layers — see docs/motion-budget.md.
           * The base is rastered once per mount and never transformed: the
           * grain is an feTurbulence tile and the vignette a full-viewport
           * gradient, so scaling either one re-rasters it every frame.
           */}
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden"
            aria-hidden
          >
            <div className="dot-grid absolute inset-0 opacity-40" />
            {/* Breathing rings live here, not in the push-in: a scale animation
                on two 560–760px rasters is per-frame raster cost for no gain. */}
            <div className="absolute left-1/2 top-1/2 size-[min(760px,120vw)] -translate-x-1/2 -translate-y-1/2 animate-breathe rounded-full border border-white/[0.055]" />
            <div className="absolute left-1/2 top-1/2 size-[min(560px,90vw)] -translate-x-1/2 -translate-y-1/2 animate-breathe rounded-full border border-white/[0.045] [animation-delay:-2s]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_42%,transparent_28%,rgba(4,4,6,0.72)_100%)]" />
          </div>

          {/* Above the base, below the specks: the aurora only ever translates. */}
          <motion.div
            variants={focusAurora}
            className="pointer-events-none absolute inset-0 overflow-hidden"
            aria-hidden
          >
            <AnimatePresence>
              <motion.div
                key={`aurora-${toneKey}`}
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
                  className="drift-a absolute inset-x-0 top-[-20%] mx-auto h-[560px] w-[760px] max-w-[130vw] rounded-full"
                  style={{
                    background: `radial-gradient(closest-side, rgba(${tone.rgb},${
                      isFocus ? 0.3 : 0.11
                    }), rgba(${tone.rgb},${isFocus ? 0.14 : 0.05}) 45%, transparent 100%)`,
                  }}
                />
                <div
                  className="drift-b absolute -bottom-[28%] -right-[14%] size-[520px] max-w-[120vw] rounded-full"
                  style={{
                    background: `radial-gradient(closest-side, rgba(${tone.rgb},${
                      isFocus ? 0.22 : 0.08
                    }), rgba(${tone.rgb},${isFocus ? 0.1 : 0.04}) 50%, transparent 100%)`,
                  }}
                />
              </motion.div>
            </AnimatePresence>

          </motion.div>

          {/* The push-in itself: specks and breathing rings, nothing expensive. */}
          <motion.div
            variants={focusLens}
            className="pointer-events-none absolute inset-0 overflow-hidden"
            aria-hidden
          >
            {pageVisible &&
              !reduceMotion &&
              PARTICLES.map((particle) => (
                <span
                  key={particle.id}
                  className={cn(
                    "float-up absolute rounded-full",
                    isFocus ? "bg-primary-soft/70" : "bg-ivory/55",
                  )}
                  style={
                    {
                      left: `${particle.left}%`,
                      top: `${particle.top}%`,
                      width: particle.size,
                      height: particle.size,
                      "--float-duration": `${particle.duration}s`,
                      "--float-delay": `${particle.delay}s`,
                      "--drift": `${particle.drift}px`,
                    } as CSSProperties
                  }
                />
              ))}


          </motion.div>

          {/* Film grain last, and outside the push-in so it never re-rasters. */}
          <div
            aria-hidden
            className="grain pointer-events-none absolute inset-0 opacity-[0.05]"
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
              className="absolute inset-x-0 top-0 h-[30vh] border-b border-white/[0.06] bg-gradient-to-b from-[#0d0d14] via-[#0a0a10]/80 to-transparent"
              initial={{ y: "-102%" }}
              animate={{ y: ["-102%", "0%", "0%", "-102%"] }}
              transition={VEIL_TRANSITION}
            />
            <motion.span
              className="absolute inset-x-0 bottom-0 h-[26vh] border-t border-white/[0.06] bg-gradient-to-t from-[#0d0d14] via-[#0a0a10]/80 to-transparent"
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
             * `overflow-x-clip` trims the few pixels the phase shockwave and
             * the celebration sparks spend outside the column — horizontally
             * only, so the ring's glow keeps its vertical bloom. `clip` (not
             * `hidden`) adds no scroll port.
             */
            className="relative z-20 flex h-full w-full flex-col overflow-x-clip px-5 pb-5 pt-5 sm:px-8 sm:pb-6 sm:pt-6"
          >
            {/* Top bar */}
            <div className="flex flex-none items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    running && "animate-pulse-soft",
                  )}
                  style={{
                    background: running
                      ? tone.solid
                      : "rgba(244,241,234,0.32)",
                  }}
                />
                <span className="truncate">Focus mode</span>
                <span
                  className="hidden shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 font-mono text-[10px] normal-case tracking-normal text-white/45 sm:inline-block"
                  title={`${presetMeta.label} preset — ${presetBlurb(presetMeta)}`}
                >
                  {presetMeta.label} · {presetMeta.durations.focus / 60_000} /{" "}
                  {presetMeta.durations.short / 60_000}
                </span>
              </span>
              <button
                type="button"
                onClick={exit}
                className="flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/65 transition-colors duration-200 hover:bg-white/[0.09] hover:text-white focus-visible:outline-2 focus-visible:outline-primary"
                aria-label="Exit focus mode"
              >
                <X className="size-4" />
                <span className="hidden sm:inline">Exit focus</span>
                <span className="sm:hidden">Exit</span>
                <span className="kbd hidden sm:inline">Esc</span>
              </button>
            </div>

            {/* Stage: the task, then the instrument. */}
            <div
              ref={stageRef}
              className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 py-3 text-center sm:gap-6"
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={`eyebrow-${toneKey}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.34, delay: 0.3, ease: EASE_OUT_EXPO }}
                  className="flex flex-none flex-col items-center gap-2 [@media(max-height:520px)]:hidden"
                >
                  <span
                    className={cn(
                      "text-[11px] font-bold uppercase tracking-[0.28em]",
                      isFocus ? "text-primary-soft glow-accent" : "text-ivory glow-ivory",
                    )}
                  >
                    {eyebrow}
                  </span>
                  <span className="text-caption text-white/45 [@media(max-height:640px)]:hidden">
                    {mode === "focus"
                      ? `${sessionWord} ${Math.min(sessions + 1, longBreakAfter)} of ${longBreakAfter} · ${MODE_COPY[mode].hint}`
                      : MODE_COPY[mode].hint}
                  </span>
                </motion.div>
              </AnimatePresence>

              <AnimatePresence mode="wait">
                <motion.h1
                  key={task.id}
                  ref={titleRef}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -14 }}
                  transition={{ duration: 0.42, delay: 0.4, ease: EASE_OUT_EXPO }}
                  className="line-clamp-2 max-w-[18ch] flex-none text-balance text-[clamp(1.4rem,calc(3.4vh_+_0.9rem),2.6rem)] font-semibold leading-[1.12] tracking-[-0.02em] text-white"
                >
                  {task.title}
                </motion.h1>
              </AnimatePresence>

              {/*
               * The instrument arrives behind the veils with opacity and a
               * short rise — no filter and no scale, because the ring's arc is
               * drop-shadowed and animating either one re-rasterises it on
               * every frame of the entry (docs/motion-budget.md).
               *
               * `will-change` is normally left to Framer, but this box keeps
               * moving long after the arrival: the arc, the comet head and the
               * graduation ticks retick every 200ms for the whole session. With
               * no layer of its own those repaints invalidate the stage layer
               * (measured: 93 repaints of 1863×870 in one arrival); promoting
               * just this box halved the arrival's dropped frames in a paired
               * A/B (20 → 8).
               */}
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.9, delay: 0.3, ease: EASE_OUT_EXPO }}
                className="relative flex-none will-change-transform"
              >
                {/* Halo that breathes while the timer runs and brightens with progress */}
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-3 rounded-full"
                  style={{
                    background: `radial-gradient(circle, rgba(${tone.rgb},${
                      isFocus ? 0.3 : 0.2
                    }), rgba(${tone.rgb},${isFocus ? 0.13 : 0.09}) 40%, transparent 74%)`,
                  }}
                  animate={
                    running && !reduceMotion
                      ? {
                          opacity: [0.5 + progress * 0.25, 0.9],
                          scale: [1, 1.035],
                        }
                      : { opacity: 0.42 + progress * 0.3, scale: 1 }
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
                  strokeWidth={ringSize < 200 ? 5 : isFocus ? 7 : 6}
                  tone={toneKey}
                  ticks={{ total: minutes, majorEvery: 5 }}
                >
                  <div className="grid place-items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.26em] text-white/40">
                      {running ? "Remaining" : "Paused"}
                    </span>
                    <motion.span
                      key={mode}
                      role="timer"
                      initial={{ opacity: 0, y: 8, scale: 0.92 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
                      style={{
                        fontSize: `clamp(1.9rem, ${Math.round(ringSize * 0.225)}px, 5rem)`,
                      }}
                      className={cn(
                        "font-mono font-medium leading-none tracking-[-0.04em] tabular-nums",
                        "text-white",
                        isFocus
                          ? "[text-shadow:0_0_48px_rgba(75,98,255,0.4)]"
                          : "[text-shadow:0_0_48px_rgba(232,226,214,0.3)]",
                      )}
                    >
                      {formatClock(remainingMs)}
                    </motion.span>
                    <span
                      className={cn(
                        "mt-1 flex items-center gap-1.5 text-[11px] font-medium",
                        isFocus ? "text-primary-soft" : "text-ivory/85",
                        ringSize < 190 && "hidden",
                      )}
                    >
                      {task.pomodoros > 0 && (
                        <>
                          {task.pomodoros} done
                          <span className="text-white/25">·</span>
                        </>
                      )}
                      {task.priority} priority
                    </span>
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
                className="flex flex-wrap items-center justify-center gap-3"
              >
                <button
                  type="button"
                  onClick={() => useTimerStore.getState().toggle()}
                  className="flex h-12 min-w-[172px] cursor-pointer items-center justify-center gap-2.5 rounded-2xl px-7 text-sm font-bold transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-primary"
                  style={{
                    background: tone.solid,
                    color: isFocus ? "#ffffff" : "#0a0a0b",
                    boxShadow: `0 22px 54px -22px rgba(${tone.rgb},0.95)`,
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
                  className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.05] px-6 text-sm font-semibold text-white/85 transition-colors duration-200 hover:border-ivory/50 hover:bg-ivory/10 hover:text-white focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-60"
                  aria-label={`Complete “${task.title}”`}
                >
                  <Check className="size-4" />
                  {task.completed ? "Completed" : "Complete"}
                </button>

                <div className="flex items-center gap-2">
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
                  {Array.from({ length: longBreakAfter }).map((_, index) => (
                    <motion.span
                      key={index}
                      animate={{
                        width: index < sessions ? 30 : 16,
                        backgroundColor:
                          index < sessions
                            ? "rgba(233,184,114,1)"
                            : "rgba(244,241,234,0.16)",
                      }}
                      transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
                      className={cn(
                        "h-1.5 rounded-full",
                        index < sessions &&
                          "shadow-[0_0_12px_rgba(233,184,114,0.5)]",
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
                    <span className="kbd">Space</span> pause
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
                      color: beat.kind === "cycle" ? "#1b1408" : isFocus ? "#ffffff" : "#0a0a0b",
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
