"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ChevronDown,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
} from "lucide-react";

import { sortTasks } from "@/lib/activity";
import {
  PRESET_ORDER,
  TIMER_PRESETS,
  modeMeta,
  presetBlurb,
} from "@/lib/constants";
import { formatClock } from "@/lib/format";
import { EASE_OUT_EXPO, SPRING } from "@/lib/motion";
import { TONES, toneKeyForMode } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { enterFocus, getProgress } from "@/lib/timer-actions";
import { useTodoStore } from "@/store/use-todo-store";
import { useTimerStore } from "@/store/use-timer-store";
import { useUiStore } from "@/store/use-ui-store";
import { ProgressRing } from "@/components/progress-ring";
import { Button } from "@/components/ui/button";

const MODES = ["focus", "short", "long"] as const;

export function PomodoroCard() {
  const preset = useTimerStore((state) => state.preset);
  const mode = useTimerStore((state) => state.mode);
  const running = useTimerStore((state) => state.running);
  const remainingMs = useTimerStore((state) => state.remainingMs);
  const sessions = useTimerStore((state) => state.sessions);
  const taskId = useTimerStore((state) => state.taskId);
  const endsAt = useTimerStore((state) => state.endsAt);
  const phaseEvent = useTimerStore((state) => state.phaseEvent);

  const tasks = useTodoStore((state) => state.tasks);
  const selectedId = useUiStore((state) => state.selectedId);
  const activeTasks = tasks.filter((task) => !task.completed);
  /*
   * Only an active task can be what the clock is focused on — completing or
   * deleting one releases the link — so a stored id that no longer matches an
   * active task reads as no link at all, instead of as a `<select>` whose value
   * is not among its own options.
   */
  const linkedTask = activeTasks.find((task) => task.id === taskId) ?? null;
  /*
   * What the card's Focus Mode button opens on. The link is the card's own
   * answer, and the select below keeps it in step with the list's selection;
   * when nothing is linked the button falls to the same two fallbacks the F
   * shortcut uses — the selected row, then the top of the list — so both doors
   * into the room open on the task the user is looking at. The order is the
   * list's own (`sortTasks`: newest active first, completed last), not the
   * store's insertion order, so "the first one" means the same thing on both
   * sides of the screen. It goes dark only when there is nothing left to focus
   * on.
   */
  const ordered = useMemo(() => sortTasks(tasks), [tasks]);
  const focusTarget =
    linkedTask ??
    ordered.find((task) => task.id === selectedId && !task.completed) ??
    ordered.find((task) => !task.completed) ??
    null;
  const reduceMotion = useReducedMotion();

  const [announcement, setAnnouncement] = useState("");
  const [beat, setBeat] = useState<{ id: number; kind: string } | null>(null);

  const previousKey = useRef(`${preset}:${mode}`);
  const seenPhaseEvent = useRef(phaseEvent?.id ?? 0);

  const presetMeta = TIMER_PRESETS[preset];
  const longBreakAfter = presetMeta.longBreakAfter;
  const sessionWord = presetMeta.sessionWord;
  const durations = presetMeta.durations;
  const tone = TONES[toneKeyForMode(mode)];
  const toneKey = toneKeyForMode(mode);
  const isFocus = mode === "focus";

  useEffect(() => {
    const key = `${preset}:${mode}`;
    if (previousKey.current !== key) {
      previousKey.current = key;
      setAnnouncement(
        `${modeMeta(preset, mode).label} — ${formatClock(durations[mode])} ready.`,
      );
    }
  }, [mode, preset, durations]);

  /* The phase hand-off: a short flourish, never a delay. */
  useEffect(() => {
    if (!phaseEvent || phaseEvent.id === seenPhaseEvent.current) return;
    seenPhaseEvent.current = phaseEvent.id;
    if (reduceMotion) return;
    setBeat({ id: phaseEvent.id, kind: phaseEvent.kind });
    const timeout = window.setTimeout(() => setBeat(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [phaseEvent, reduceMotion]);

  const progress = getProgress(mode, remainingMs, preset);
  const minutes = durations[mode] / 60_000;
  const endsLabel =
    running && endsAt
      ? `ends ${new Date(endsAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : "paused";

  return (
    <section className="panel relative overflow-hidden p-5" aria-label="Pomodoro timer">
      {/*
       * The room changes colour with the phase. A masked bloom rather than
       * `blur-[90px]`: this card sits inside the shell that scales on the way
       * into Focus Mode, and a scaled ancestor re-rasterises a 90px blur on
       * every frame of that move (see `.bloom` in globals.css).
       */}
      <div
        aria-hidden
        className={cn(
          "bloom pointer-events-none absolute -right-24 -top-28 size-64 rounded-full transition-colors duration-1000",
          isFocus ? "bg-primary/25" : "bg-ivory/10",
        )}
      />

      {/* Phase hand-off flourish. */}
      <AnimatePresence>
        {beat && (
          <motion.div
            key={beat.id}
            aria-hidden
            className="pointer-events-none absolute inset-0"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
          >
            <motion.span
              className={cn(
                "absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent to-transparent",
                beat.kind === "cycle" ? "via-achievement/25" : "via-ivory/16",
              )}
              initial={{ x: "-130%" }}
              animate={{ x: "330%" }}
              transition={{ duration: 1.1, ease: EASE_OUT_EXPO }}
            />
            <motion.span
              className={cn(
                "absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent to-transparent",
                beat.kind === "cycle" ? "via-achievement/80" : "via-ivory/60",
              )}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1.3, times: [0, 0.3, 1] }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <header className="relative flex items-start justify-between">
        <div>
          <p className="text-micro font-semibold uppercase text-muted-foreground">
            Pomodoro
          </p>
          <div className="mt-1 h-6 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.h2
                key={mode}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
                className="text-title font-semibold tracking-[-0.01em]"
              >
                {modeMeta(preset, mode).label}
              </motion.h2>
            </AnimatePresence>
          </div>
        </div>
        <div className="text-right">
          <p className="text-micro font-medium uppercase text-muted-foreground">
            {sessionWord} {Math.min(sessions + 1, longBreakAfter)} of{" "}
            {longBreakAfter}
          </p>
          <div className="mt-2 flex justify-end gap-1.5" aria-hidden>
            {Array.from({ length: longBreakAfter }).map((_, index) => (
              <motion.span
                key={index}
                animate={{
                  scale: index < sessions ? [1, 1.4, 1] : 1,
                  backgroundColor:
                    index < sessions
                      ? "rgba(233,184,114,1)"
                      : "rgba(244,241,234,0.14)",
                }}
                transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
                className={cn(
                  "size-2 rounded-full",
                  index < sessions &&
                    "shadow-[0_0_10px_rgba(233,184,114,0.55)]",
                )}
              />
            ))}
          </div>
        </div>
      </header>

      {/* Quiet progress rule — the ring without the shout. */}
      <div className="relative mt-4 h-px w-full overflow-hidden bg-white/[0.06]">
        {/*
         * Scaled, not resized. A transition on `width` re-runs layout on every
         * frame it interpolates, and this one is retriggered every 200ms for the
         * length of a session. Scaling the full-width box paints the same thing
         * — the gradient is defined across the element's own box, so it squashes
         * with it — and never touches layout.
         */}
        <div
          className="absolute inset-y-0 left-0 w-full origin-left transition-transform duration-300 ease-linear"
          style={{
            transform: `scaleX(${Math.max(progress, 0.005)})`,
            background: `linear-gradient(90deg, rgba(${tone.rgb},0.15), ${tone.solid})`,
          }}
        />
      </div>

      {/* Rhythm — the tempo the session runs on. */}
      <div
        role="radiogroup"
        aria-label="Pomodoro preset"
        className="inset relative mt-4 grid grid-cols-2 gap-1 rounded-xl p-1"
      >
        {PRESET_ORDER.map((id) => {
          const option = TIMER_PRESETS[id];
          const active = preset === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => useTimerStore.getState().setPreset(id)}
              title={`Switch to ${option.label} (${presetBlurb(option)})`}
              className={cn(
                "relative cursor-pointer rounded-lg px-2 py-1.5 text-center transition-colors duration-200",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="preset-pill"
                  aria-hidden
                  className="absolute inset-0 rounded-lg bg-white/[0.07] shadow-[inset_0_0_0_1px_rgba(244,241,234,0.08)]"
                  transition={SPRING.snappy}
                />
              )}
              <span className="relative block text-caption font-semibold">
                {option.label}
              </span>
              <span className="relative block font-mono text-[10px] text-muted-foreground/80">
                {presetBlurb(option)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative mt-5 grid place-items-center">
        <ProgressRing
          progress={progress}
          size={216}
          strokeWidth={isFocus ? 7 : 6}
          tone={toneKey}
          ticks={{ total: minutes, majorEvery: 5 }}
        >
          <div className="grid place-items-center gap-1">
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-[0.2em]",
                isFocus ? "text-primary-soft" : "text-ivory/75",
              )}
            >
              {modeMeta(preset, mode).label}
            </span>
            {/* Remounts on mode change so the clock flips instead of ticking. */}
            <motion.span
              key={mode}
              role="timer"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
              className="font-mono text-[42px] font-medium leading-none tracking-[-0.04em] tabular-nums"
            >
              {formatClock(remainingMs)}
            </motion.span>
            <span className="mt-1 max-w-[150px] truncate text-micro text-muted-foreground">
              {linkedTask ? linkedTask.title : "No task linked"}
            </span>
          </div>
        </ProgressRing>
      </div>

      <div className="relative mt-5 flex items-center justify-center gap-2">
        <Button
          variant={isFocus ? "default" : "ivory"}
          size="lg"
          className="min-w-[136px]"
          onClick={() => useTimerStore.getState().toggle()}
          aria-label={running ? "Pause timer" : "Start timer"}
        >
          {running ? (
            <>
              <Pause className="size-4" /> Pause
            </>
          ) : (
            <>
              <Play className="size-4" /> Start
            </>
          )}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-10"
          onClick={() => useTimerStore.getState().reset()}
          aria-label="Reset current session"
          title="Reset"
        >
          <RotateCcw className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-10"
          onClick={() => useTimerStore.getState().skip()}
          aria-label="Skip to next session"
          title="Skip"
        >
          <SkipForward className="size-4" />
        </Button>
        {/*
         * The room is one tap from the timer. Without this the only ways into
         * Focus Mode from here were the F key and a task row's own button,
         * which on a phone means scrolling back up the page to the list and
         * down again to read the clock. Same icon the task rows use for the
         * same action, and the same "opening it starts the session" rule.
         */}
        <Button
          variant="outline"
          size="icon"
          className="size-10"
          onClick={() => focusTarget && enterFocus(focusTarget.id)}
          disabled={!focusTarget}
          aria-label={
            focusTarget
              ? `Enter focus mode for “${focusTarget.title}”`
              : "Enter focus mode"
          }
          title="Focus mode — starts the session"
        >
          <Maximize2 className="size-4" />
        </Button>
      </div>

      <p className="relative mt-3 text-center font-mono text-[11px] text-muted-foreground">
        {running ? `${sessionWord.toLowerCase()} ${endsLabel}` : "press start when you're ready"}
      </p>

      <div
        role="radiogroup"
        aria-label="Timer mode"
        className="inset relative mt-4 grid grid-cols-3 gap-1 rounded-xl p-1"
      >
        {MODES.map((value) => {
          const active = mode === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => useTimerStore.getState().setMode(value)}
              className={cn(
                "relative cursor-pointer rounded-lg px-2 py-1.5 text-center transition-colors duration-200",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="phase-pill"
                  aria-hidden
                  className={cn(
                    "absolute inset-0 rounded-lg shadow-[inset_0_0_0_1px_rgba(244,241,234,0.08)]",
                    value === "focus" ? "bg-primary/15" : "bg-ivory/[0.09]",
                  )}
                  transition={SPRING.snappy}
                />
              )}
              <span className="relative block text-caption font-semibold">
                {modeMeta(preset, value).shortLabel}
              </span>
              <span className="relative block font-mono text-[10px] text-muted-foreground/80">
                {formatClock(durations[value])}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative mt-3.5">
        <label
          htmlFor="timer-task"
          className="mb-1.5 block text-micro font-semibold uppercase text-muted-foreground"
        >
          Focusing on
        </label>
        <div className="relative">
          <select
            id="timer-task"
            value={linkedTask?.id ?? ""}
            onChange={(event) => {
              const id = event.target.value || null;
              useTimerStore.getState().setTaskId(id);
              /* Picking the subject of the session selects its row, so the
               * list and the card always name the same task. */
              useUiStore.getState().select(id);
            }}
            className="h-10 w-full cursor-pointer appearance-none rounded-xl border border-hairline bg-white/[0.03] px-3 pr-9 text-caption text-foreground outline-none transition-colors duration-200 hover:border-white/15 focus-visible:border-primary/50"
          >
            <option value="">No task linked</option>
            {activeTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
        </div>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
