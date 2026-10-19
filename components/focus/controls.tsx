"use client";

import { motion } from "framer-motion";
import { Check, Pause, Play, RotateCcw, SkipForward } from "lucide-react";

import { Button } from "@/components/ui/button";
import { focusItem } from "@/lib/motion";

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
        className="w-full sm:w-auto sm:min-w-[164px]"
        onClick={onToggle}
        aria-label={running ? "Pause timer" : fresh ? "Start timer" : "Resume timer"}
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
