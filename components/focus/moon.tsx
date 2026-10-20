"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  MOON_DARK,
  MOON_GLYPH,
  MOON_LIGHT,
  PHASE_RADIUS,
  phaseGeometry,
} from "@/components/focus/geometry";
import { cn } from "@/lib/utils";

/**
 * The moon, drawn at the two sizes the room needs it: the disc at the centre of
 * the dial, and the phase glyph at the size of a session marker — 14px, one step
 * up from the marker itself and the size the row has always been set at.
 *
 * They are the same object lit from the same side and, now, the same phase: the
 * terminator is a great circle on the sphere in both. The instrument clips its
 * light layer to the lit region (quantised, so a session's 7500 ticks cost about
 * a thousand repaints of one disc rather than 7500 — docs/motion-budget.md), and
 * eases the full-to-new hand-off when focus becomes a break. The strip's glyphs
 * never animate, so they can draw the same shape as static rasters. The old
 * instrument slid a second disc of the moon's own dark across this one, which
 * draws a crescent but not a gibbous: past half an equal disc's edge bows the
 * wrong way and the moon becomes a lens (see `phaseGeometry`).
 */

/**
 * The lit region of a moon, in normalized disc coordinates: a semicircular limb
 * on the light's side, closed by the terminator.
 *
 * The terminator is a *great circle* on the sphere, which projects to an ellipse
 * through both poles of the disc, its waist `|2k − 1|` of the radius along the
 * light's axis. The path starts at the top pole, follows the lit limb to the
 * bottom pole, and returns along that ellipse. Short of half the ellipse bulges
 * into the lit half (the path is cut in, a crescent); past half it bulges into
 * the dark half (the path is let out, a gibbous moon). The same arc carries both
 * — only its waist and sweep change — so the terminator is a phase at every
 * fraction rather than a second disc sliding off the first.
 *
 * Coordinates are the 0–1 box `clipPathUnits="objectBoundingBox"` expects, and
 * the caller rotates the path onto `MOON_NIGHT_AXIS`.
 */
function litPath(lit: number): string {
  const { waist, pastHalf } = phaseGeometry(lit);
  const rx = (waist / PHASE_RADIUS) * 0.5;
  /*
   * Below a hundredth of a percent the arc is a line for every purpose; SVG
   * treats a zero radius as one anyway, so say so and keep the command valid.
   */
  const terminator =
    rx < 0.0001
      ? "L 0.5 0"
      : `A ${rx.toFixed(5)} 0.5 0 0 ${pastHalf ? 0 : 1} 0.5 0`;
  return `M 0.5 0 A 0.5 0.5 0 0 0 0.5 1 ${terminator} Z`;
}

/** How long the full moon takes to hand back to the new-moon sliver. */
const MOON_WANE_MS = 1400;

/** Slow at both ends, so the hand-off reads as a deliberate wane. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * The moon's body: the sphere's own light, cut to the cycle's phase.
 *
 * It is a *dark* sphere lit from the left, below the middle (see `MOON_LIGHT`).
 * The light is one gradient on the disc, clipped to the exact lit region; the
 * unlit rest is the moon's own dark. The target path is quantized to a
 * thousandth of the disc, so a 200ms focus tick changes it only about once a
 * second — a repaint of one disc, not of the ring, and far less often than the
 * 7500 ticks a session would otherwise ask for (docs/motion-budget.md).
 *
 * The one exception is the end of focus. The full moon has to return to new for
 * the break, and that hand-off is eased over `MOON_WANE_MS`: about eighty
 * frames of one clipped layer, then still for the whole break. A break's own
 * clock never moves the target, so the moon cannot refill before the next focus
 * session starts it again.
 */
export function MoonBody({
  inset,
  lit,
  reduceMotion,
}: {
  /** The disc's inset inside the instrument box. */
  inset: number;
  /** The phase's lit fraction, quantised in `moonGeometry`. */
  lit: number;
  reduceMotion: boolean;
}) {
  const clipId = `moon-lit-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [shownLit, setShownLit] = useState(lit);
  const shownRef = useRef(lit);
  const frameRef = useRef<number | null>(null);

  /*
   * The focus clock only ever raises the target, so follow it directly: there is
   * nothing to animate while the moon is filling and quantising it already keeps
   * the repaint rate down. A *drop* is the candle being snuffed — the end of
   * focus, a reset, a skip — and that is the one transition worth easing.
   */
  useEffect(() => {
    const from = shownRef.current;
    if (reduceMotion || lit >= from) {
      shownRef.current = lit;
      setShownLit(lit);
      return;
    }

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / MOON_WANE_MS);
      const value = from + (lit - from) * easeInOutCubic(t);
      shownRef.current = value;
      setShownLit(value);
      frameRef.current = t < 1 ? requestAnimationFrame(frame) : null;
    };
    frameRef.current = requestAnimationFrame(frame);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [lit, reduceMotion]);

  const { angle } = phaseGeometry(shownLit);
  /*
   * The wash belongs to the phase too: it dims as the moon wanes, so the new
   * moon at the start of a break is quieter than the full face that preceded it.
   * It is quantised in the same 5% steps the previous value used, and the 240ms
   * opacity transition smooths the steps while the clip path is already moving.
   */
  const wash = 0.86 + (Math.round(shownLit * 20) / 20) * 0.14;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute overflow-hidden rounded-full"
      style={{ inset, background: MOON_DARK }}
    >
      {/*
       * The clip lives in an SVG definition so the path can carry real arcs;
       * `objectBoundingBox` keeps it tied to the disc at any instrument size.
       */}
      <svg aria-hidden className="absolute size-0">
        <defs>
          <clipPath id={clipId} clipPathUnits="objectBoundingBox">
            <path
              d={litPath(shownLit)}
              transform={`rotate(${angle} 0.5 0.5)`}
            />
          </clipPath>
        </defs>
      </svg>

      {/*
       * The sphere's own light, brightest toward its source, cut to the lit
       * region. Its levels are what make the disc read as a *moon* rather than
       * as a dark hole behind the clock: the body sits on the room's own
       * near-black, so all of the shape comes from this layer and the limb above
       * it.
       *
       * The flat tint underneath is what keeps a **gibbous** moon lit to its
       * terminator: the highlight alone falls to a near-black limb on the far
       * side, so past half the disc read as a crescent that had been stretched
       * rather than as a moon. The highlight stays a function of the light's
       * position; the tint is the surface the light is falling on.
       */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(circle at ${MOON_LIGHT.x}% ${MOON_LIGHT.y}%, rgba(236,240,255,0.16), rgba(139,153,255,0.05) 48%, rgba(139,153,255,0) 82%), rgba(139,153,255,0.075)`,
          opacity: wash,
          clipPath: `url(#${clipId})`,
          transition: reduceMotion ? "none" : "opacity 240ms linear",
        }}
      />
    </div>
  );
}

/**
 * The moon's form, above its light: the limb's hairline, the rim light along the
 * lower-left edge and the falloff to the upper right. It carries no fill of its
 * own, so the moon keeps its silhouette at every phase — a new moon is still a
 * moon.
 *
 * The rim and the falloff are placed from the same direction the light comes
 * from: an *inset* shadow lights the edge it is offset *towards*, so with the
 * light at the left and about a third of the way below the middle the rim is
 * `2px -0.9px` (left, low) and the falloff is `-21px 15px` (right, high) — the
 * same two directions as `MOON_LIGHT`, turned with it. Those two pairs are the
 * same pair as they were at `{ x: 21, y: 60 }` (`2px -0.5px` and `-24px 8px`),
 * at `{ x: 23, y: 65.5 }` (`2px -0.7px` and `-22px 13px`) and at
 * `{ x: 25, y: 71 }` (`2px -1px` and `-21px 17px`), scaled by where the light
 * moved to: the same distance, at the angle between those.
 */
export function MoonLimb({ inset }: { inset: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-full"
      style={{
        inset,
        /*
         * Four layers, in order: the hairline that keeps the disc's edge
         * legible against a sky of nearly the same darkness, the rim light on
         * the side the light comes from, and the falloff that turns the disc
         * into a sphere rather than a circle of flat colour.
         */
        boxShadow:
          "0 0 0 1px rgba(244,241,234,0.035), inset 0 0 0 1px rgba(244,241,234,0.07), inset 2px -0.9px 0 rgba(244,241,234,0.19), inset -21px 15px 62px rgba(0,0,0,0.6)",
      }}
    />
  );
}

/**
 * One moon phase, at the size of a session marker.
 *
 * `lit` is the fraction of the disc that is lit. Two layers make it: a disc of
 * the moon's own dark, and the lit part laid over it. There used to be a third —
 * a hairline limb in the phase colour, because a *tinted* unlit side needed an
 * edge to end on. The body carries its own edge now, as a shape a step *above*
 * the sky (28 luma against the 8.3 beside a pending glyph), so the row is lighter
 * for it.
 *
 * The limb was also the one thing in the glyph that was not the same on both
 * sides of the moon: drawn over the lit lune in the lune's own colour it is
 * invisible, drawn over the dark body it is a rim — so a three-quarter moon's
 * dark crescent wore an outline its quarter-moon counterpart did not have. The
 * two are meant to be the *same lune*, half a turn apart
 * (`.freebuff/phase-probe.mjs` measures exactly that), and a rim on one of them
 * is the difference.
 *
 * The unlit side is a *body* of the moon's own grey, not a dim tint of the phase
 * colour. That is the whole point of a phase at this size: a tinted unlit disc
 * glows just enough to read as part of the moon, so a three-quarter glyph (the one
 * that buys the long break) looked like a filled disc rather than as a moon a step
 * short of full. Measured with an amber-tinted disc the unlit side sat at **58**
 * luma against a sky of **19** — brighter than the sky it was supposed to be
 * darker than — and the first fix put it at **8** against a sky of 7.5 by the same
 * measure, which is not a crescent either: it is a hole. The token
 * (`--moon-glyph`, app/globals.css) sits at **28**, a step above the sky — and a
 * step above the dial's own `--moon-dark` (**21**), because a 14px glyph has less
 * area to hold a silhouette than a 300px disc and the same value that reads as a
 * body at the dial's size read as sky at the strip's (second sample sheet,
 * 2026-10-17).
 *
 * It is also **hue-less**, which is the third sheet's answer (2026-10-18): the
 * unlit side had been a blue-black, and at this size that blue is all the
 * *colour* the glyph has room to show, so it read as a hole cut in the sky rather
 * than as a body in shadow. Three lifts were painted with and without a trace of
 * the sky's blue; the hue-less one at the middle lift won, and the dial kept the
 * blue-black it already had.
 *
 * Colour still comes from the parent, and the lit lune still *is* that colour: a
 * banked session is an amber lune, a pending one a grey — the same phase, one
 * banked and one not. At three quarters that is the dark crescent running from
 * pole to pole down the upper-right limb, measured on the shipped build at lit
 * **97.1** / dark **28.8** for a pending glyph, with the sky at **8.3** beside
 * it and **22.4** inside a banked neighbour's own amber glow — where the dark
 * side is meant to meet the glow rather than sit under it
 * (`.freebuff/moon-samples.mjs`; `.freebuff/phase-dark.mjs` reads the same
 * pixels).
 */
export function MoonPhaseMark({
  lit,
  className,
}: {
  lit: number;
  className?: string;
}) {
  const maskId = `cycle-phase-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { waist, pastHalf, angle } = phaseGeometry(lit);
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-3.5", className)}>
      <mask id={maskId}>
        <rect width="24" height="24" fill="#000" />
        {/*
         * The light's own half of the disc: everything on the light's side of
         * the diameter through the centre. That diameter is the terminator of a
         * half moon, so it is where every phase starts.
         */}
        <rect
          x={-12}
          y={-12}
          width={24}
          height={48}
          fill="#fff"
          transform={`rotate(${angle} 12 12)`}
        />
        {/*
         * The terminator: a great circle on the sphere, so an ellipse through
         * both poles, its waist reaching `|2k − 1|` of the radius along the axis.
         * Just past half the light has crossed the centre, and the ellipse is
         * part of the lit side; short of half it is cut out of it.
         */}
        <ellipse
          cx="12"
          cy="12"
          rx={waist}
          ry={PHASE_RADIUS}
          fill={pastHalf ? "#fff" : "#000"}
          transform={`rotate(${angle} 12 12)`}
        />
      </mask>
      {/* The unlit side: the room's own dark, so a phase is a moon, not a wedge. */}
      <circle cx="12" cy="12" r={PHASE_RADIUS} fill={MOON_GLYPH} />
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
