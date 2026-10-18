"use client";

import { useEffect, useState, type RefObject } from "react";

import { ORBIT_GAP } from "@/components/focus/geometry";

/**
 * The dial's size for the room it actually has.
 *
 * Focus Mode never scrolls, so the instrument has to fit the stage at every
 * height and width rather than being sized from the viewport. The stage's own box
 * doesn't depend on the ring — only on the title block above it — so
 * measure → set settles in one pass and cannot loop.
 *
 * The caller owns the two refs, because they are two boxes in its own render: the
 * stage, and the title block whose height is the ring's allowance.
 */
export function useRingSize({
  open,
  stageRef,
  blockRef,
}: {
  /** Nothing is measured while the overlay is closed. */
  open: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  blockRef: RefObject<HTMLDivElement | null>;
}): number {
  const [ringSize, setRingSize] = useState(300);

  useEffect(() => {
    if (!open) return;
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const { width, height } = stage.getBoundingClientRect();
      const blockHeight = blockRef.current?.getBoundingClientRect().height ?? 148;
      /*
       * The dial's air, in two parts.
       *
       * The ring's *box* is the dial's own size, but what is drawn around it is
       * bigger: the orbit overhangs it by ORBIT_GAP on every side. Horizontally
       * that is the whole allowance (plus a 24px margin).
       *
       * Vertically the same overhang has to clear the title above and the
       * controls below, so the ring's own gap to the title comes out of the
       * allowance *as well* — read from the stage's own computed `row-gap`
       * rather than repeated here, because the two only stay in agreement if
       * there is one number. The last 32px is the stage's padding, the halo's
       * bloom and the margin the room wants between the faint orbit arc and the
       * things it passes.
       *
       * It used to be a flat 96px in place of the overhang and the gap, which
       * counted the title block and some air but not the orbit — so on a short
       * viewport the orbit's arc crossed the control row.
       */
      const gap = Number.parseFloat(getComputedStyle(stage).rowGap) || 24;
      const room = Math.min(
        width - ORBIT_GAP * 2 - 24,
        height - blockHeight - gap - ORBIT_GAP * 2 - 32,
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
     * one settle pass after the arrival choreography keeps the instrument right
     * even if nothing else ever resizes.
     */
    const settle = window.setTimeout(measure, 1100);
    return () => {
      window.clearTimeout(settle);
      observer.disconnect();
    };
  }, [open, stageRef, blockRef]);

  return ringSize;
}
