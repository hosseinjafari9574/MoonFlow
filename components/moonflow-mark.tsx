"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The MoonFlow mark — the app's own instrument.
 *
 * A dial with a partial progress arc (the session) and the moon at its centre,
 * cut from a single disc by an offset disc so the crescent is real geometry
 * rather than a drawn squiggle. The accent dot is the only colour in the mark,
 * matching the app-wide rule that colour means "live".
 *
 * Sized to fill the canvas: the dial sits at r 9.4 with a 2.3 stroke, and the
 * crescent takes 5.2 of the 12-unit half-width, its furthest point 6.02 units
 * from centre against the dial's inner edge at 8.25. Draw in `currentColor` and
 * set the colour on the parent.
 */
export function MoonFlowMark({
  className,
  withDot = true,
}: {
  className?: string;
  /** Drop the accent dot where the mark renders below 20px. */
  withDot?: boolean;
}) {
  // Ids must be unique per instance: several marks can share one document.
  const maskId = `moonflow-moon-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn("size-6", className)}
    >
      <mask id={maskId}>
        <rect width="24" height="24" fill="#000" />
        <circle cx="11.2" cy="11.8" r="5.2" fill="#fff" />
        <circle cx="14.15" cy="9.6" r="5.2" fill="#000" />
      </mask>
      {/* The dial. */}
      <circle
        cx="12"
        cy="12"
        r="9.4"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="2.3"
      />
      {/* The session underway. */}
      <path
        d="M12 2.6 A 9.4 9.4 0 0 1 20.15 16.78"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
      <circle
        cx="11.2"
        cy="11.8"
        r="5.2"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
      {withDot ? (
        <circle cx="12" cy="2.6" r="1.5" className="fill-primary-soft" />
      ) : null}
    </svg>
  );
}
