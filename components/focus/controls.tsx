"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Pause, Play, RotateCcw, SkipForward } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EASE_OUT_EXPO, focusItem } from "@/lib/motion";

/**
 * The controls: run or pause the session, complete the task, and the two quiet
 * ones that step the phase on or start it over.
 *
 * Every one of them is the app's own `<Button>` — the same object the Pomodoro
 * card uses, in the same order (a primary action, then the quiet round ones), so
 * Focus Mode's controls cannot drift away from the rest of Moonflow: radius,
 * height, weight, icon size, focus ring and the one-pixel lift on hover all come
 * from `components/ui/button.tsx` rather than from a second set of numbers kept
 * here. The only thing this module decides is *which* variant: the accent while
 * the room is in focus and ivory during a break, exactly as the card maps the
 * phase, because colour in this app means "focus".
 *
 * **One line, one height, one gap.** The row is four controls of the same height
 * (`lg`, 48px) and the same radius, with a single gap between every pair of them.
 * That is deliberate, and it is where this row parts company with the card: the
 * card's row steps down to 40px icons after its 48px primary, which reads as one
 * primary *and* two quieter things under a ring; here the four sit in a line under
 * the instrument, and measured off the shipped build the steps and the odd gaps
 * were the whole of what made the row look ragged — heights of 48/48/40/40, radii
 * of 12/12/8/8 and gaps of 10/14/6px, the last of those from a `pl-1` that nudged
 * the quiet pair off the row's own rhythm. Four equal controls on one even gap has
 * no such seam (`.freebuff/asym-probe.mjs` reads all four back).
 *
 * Presentational only — every action is handed in, so this module cannot reach
 * the timer store and a change to what a button *does* lands in the overlay that
 * owns the session.
 */
export function FocusControls({
  running,
  fresh,
  completed,
  taskTitle,
  isFocus,
  onToggle,
  onComplete,
  onSkip,
  onReset,
}: {
  running: boolean;
  /** A clock that has never run says "Start"; a paused one says "Resume". */
  fresh: boolean;
  completed: boolean;
  taskTitle: string;
  isFocus: boolean;
  onToggle: () => void;
  onComplete: () => void;
  onSkip: () => void;
  onReset: () => void;
}) {
  return (
    <motion.div
      variants={focusItem}
      className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3"
    >
      {/*
       * On a phone the row cannot hold four 48px controls beside one another,
       * so the primary takes the full line and the three quieter ones centre
       * beneath it. Two rows of deliberate width read better than a 2 + 2 wrap
       * whose first row happens to fit and whose second row is two loose icons.
       */}
      <Button
        variant={isFocus ? "default" : "ivory"}
        size="lg"
        /*
         * The press is the one thing the shared Button does not own beyond its
         * colour change: a 1.5% dip under the finger, on the same 200ms
         * transition the hover lift already uses. Enough that the control feels
         * pushed, not enough to move the row.
         */
        className="w-full transition-transform active:scale-[0.985] sm:w-auto sm:min-w-[164px]"
        onClick={onToggle}
        aria-label={running ? "Pause timer" : fresh ? "Start timer" : "Resume timer"}
      >
        {/*
         * The icon is the phase of the control, so it turns over rather than
         * being swapped: Play and Pause trade places through a 0.18s fade and a
         * slight tilt. Both sit in the same 16px box, absolutely, so the label
         * beside them never shifts while the pair is in flight.
         */}
        <span className="relative grid size-4 shrink-0 place-items-center" aria-hidden>
          <AnimatePresence initial={false}>
            <motion.span
              key={running ? "pause" : "play"}
              className="absolute inset-0 grid place-items-center"
              initial={{ opacity: 0, scale: 0.6, rotate: -24 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.6, rotate: 24 }}
              transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
            >
              {running ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
            </motion.span>
          </AnimatePresence>
        </span>
        {running ? "Pause" : fresh ? "Start" : "Resume"}
      </Button>

      <Button
        variant="outline"
        size="lg"
        onClick={onComplete}
        disabled={completed}
        aria-label={`Complete “${taskTitle}”`}
      >
        <Check className="size-4" />
        {completed ? "Completed" : "Complete"}
      </Button>

      {/*
       * The quiet pair: the same outline button as the Complete above it, cut down
       * to its own icon's square so the row keeps one height and one radius end to
       * end. They follow the primary with nothing holding them — the same rule the
       * card already sets — and they are *in* the row's one gap, so there is no
       * seam between "the pair" and the controls before it.
       */}
      <Button
        variant="outline"
        size="lg"
        className="w-12 px-0"
        onClick={onSkip}
        aria-label="Skip to next session"
        title="Skip"
      >
        <SkipForward className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="lg"
        className="w-12 px-0"
        onClick={onReset}
        aria-label="Reset current session"
        title="Reset"
      >
        <RotateCcw className="size-4" />
      </Button>
    </motion.div>
  );
}
