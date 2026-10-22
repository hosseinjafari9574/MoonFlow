"use client";

import { motion } from "framer-motion";

import { MoonPhaseMark } from "@/components/focus/moon";
import { formatDuration } from "@/lib/format";
import { EASE_SOFT, focusItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The quiet readouts under the controls — the ones that only stay where there is
 * height to spare.
 *
 * Both of them are set in the app's own type: the caption scale for sentences and
 * `font-mono` for anything that is a reading (the day's total).
 *
 * The grey is the app's ivory at 70% rather than `text-muted-foreground`. That
 * token is the same family, but it is tuned to sit on graphite (an inset panel or
 * a page that falls to `#08080a`); the room's quiet lines sit on the *nebula*, and
 * measured against those pixels the muted token lands at 4.0–4.4:1 — under AA on
 * the brightest band of the sky. Ivory at 70% is the same weight of grey one step
 * lighter, and reads 5.5–6.5:1 across the whole frame (`.freebuff/design-probe.mjs`).
 */

/**
 * A cycle's sessions as moon phases.
 *
 * Even quarters of a disc — crescent, half, gibbous, full — so the strip reads
 * as the cycle's own month, and the full moon at the end of the row is the one
 * that buys the long break. Four identical dots said how many; four phases say
 * how far.
 *
 * The strip stands at the session the eyebrow names, not one behind it: during
 * the first focus period the crescent is already lit, and during the break
 * before session 2 the half moon is. Counting only banked sessions left the row
 * a step behind the number beside it for the whole period a user is working —
 * and, after the fourth session, the long break has all four lit, which is
 * exactly where the cycle is.
 */
export function CycleReadouts({
  sessions,
  longBreakAfter,
  sessionWord,
  todayFocusMinutes,
  streak,
}: {
  /** Focus sessions banked in the current cycle. */
  sessions: number;
  longBreakAfter: number;
  /** What one focus period is called — "Session" or "Block". */
  sessionWord: string;
  todayFocusMinutes: number;
  streak: number;
}) {
  const lit = Math.min(sessions + 1, longBreakAfter);
  return (
    <motion.div
      variants={focusItem}
      /*
       * The row steps back in two stages, and the order is the point.
       *
       * It used to go in one piece at 720px of window height — moons *and* the
       * day's total together — which is a height most laptops land under once the
       * browser's own chrome is taken off a 768- or 900-tall screen, and which the
       * desktop app's pane sits at almost always. So the room kept the key hints
       * (a row that fades itself out after five seconds of stillness) and lost the
       * four moons (the only thing that says how far into the cycle you are).
       *
       * The sentence goes first, at 720 — it is one line of prose and the least
       * load-bearing thing in the column — and the moons hold on to 560, below
       * which the dial needs the room. `.freebuff/asym-probe.mjs` prints the whole
       * ladder at a desktop width.
       */
      className="flex flex-col items-center gap-2 [@media(max-height:560px)]:hidden"
    >
      <div
        className="flex items-center gap-2"
        role="img"
        aria-label={`${sessions} of ${longBreakAfter} focus ${sessionWord.toLowerCase()}s completed`}
      >
        {Array.from({ length: longBreakAfter }).map((_, index) => (
          <MoonPhaseMark
            key={index}
            lit={(index + 1) / longBreakAfter}
            /*
             * Two states, not three: lit means reached, whether banked or in
             * progress. A third tint for "this one is running" would have to be
             * read against amber and grey at 14px, and the eyebrow above already
             * names the session; the row only has to say how far the cycle has
             * come.
             */
            className={cn(
              "transition-[color,filter] duration-500",
              index < lit
                ? "text-achievement drop-shadow-[0_0_5px_rgba(233,184,114,0.55)]"
                : "text-ivory/35",
            )}
          />
        ))}
      </div>

      <p className="font-mono text-caption text-ivory/70 [@media(max-height:720px)]:hidden">
        {formatDuration(todayFocusMinutes)} focused today
        {streak > 0 && ` · ${streak}-day streak`}
      </p>
    </motion.div>
  );
}

/**
 * The keyboard hints. They step back once you're absorbed, and any key or
 * pointer movement brings them forward again.
 */
export function KeyboardHints({
  hintsVisible,
  running,
  fresh,
}: {
  hintsVisible: boolean;
  running: boolean;
  fresh: boolean;
}) {
  return (
    <motion.div
      variants={focusItem}
      className="flex w-full justify-center [@media(max-height:620px)]:hidden"
    >
      <motion.div
        initial={{ opacity: 1 }}
        animate={{ opacity: hintsVisible ? 1 : 0 }}
        transition={{ duration: 0.7, ease: EASE_SOFT }}
        className={cn(
          "flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-caption text-ivory/70",
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
  );
}
