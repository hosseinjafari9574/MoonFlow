"use client";

import { useId } from "react";

import {
  MOON_DARK,
  MOON_GLYPH,
  MOON_LIGHT,
  PHASE_RADIUS,
  nightOffset,
  phaseGeometry,
} from "@/components/focus/geometry";
import { cn } from "@/lib/utils";

/**
 * The moon, drawn at the two sizes the room needs it: the disc at the centre of
 * the dial, and the phase glyph at the size of a session marker — 14px, one step
 * up from the marker itself and the size the row has always been set at.
 *
 * They are the same object lit from the same side, and they part company on how
 * the terminator is made. The instrument's night side is a disc of the room's own
 * dark sliding along `MOON_NIGHT_AXIS`, which is what keeps a session's ~7500
 * ticks off the paint path (docs/motion-budget.md). The strip's glyphs never
 * animate, so they draw a *phase*: the real terminator, which no bite out of a
 * second disc can reach (see `phaseGeometry`).
 */

/**
 * The moon's body: the sphere's own light, and the night side sliding off it.
 *
 * It is a *dark* sphere lit from the left, below the middle (see `MOON_LIGHT`).
 * The light is one gradient on the disc; the night side is a disc of the moon's
 * own dark, the same size as the moon, sliding along the light's axis until it
 * clears the disc entirely — to the right and up, at the light's own angle, so
 * the moon fills from the left.
 * Both halves are free to move on every 200ms tick — a transform on a promoted
 * layer and an opacity quantised to 5% steps — where a masked shape would
 * repaint the whole disc 7500 times over a session (docs/motion-budget.md).
 */
export function MoonBody({
  inset,
  wash,
  nightX,
  nightY,
  reduceMotion,
}: {
  /** The disc's inset inside the instrument box. */
  inset: number;
  /** The light's opacity, quantised in `moonGeometry`. */
  wash: number;
  /** The night side's travel, in percent of its own width. */
  nightX: string;
  nightY: string;
  reduceMotion: boolean;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute overflow-hidden rounded-full"
      style={{ inset, background: MOON_DARK }}
    >
      {/*
       * The sphere's own light, brightest toward its source.
       *
       * Its levels are what make the disc read as a *moon* rather than as a dark
       * hole behind the clock: the body sits on the room's own near-black, so
       * all of the shape comes from this one gradient and the limb above it. It
       * is still strictly a function of `progress` through the quantised `wash`
       * below — `.freebuff/wax-probe.mjs` reads the lit fraction back off these
       * pixels and the terminator's position off them too.
       */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(circle at ${MOON_LIGHT.x}% ${MOON_LIGHT.y}%, rgba(236,240,255,0.17), rgba(139,153,255,0.062) 46%, rgba(96,110,200,0.03) 100%)`,
          opacity: wash,
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
