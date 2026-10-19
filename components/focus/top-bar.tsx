"use client";

import { X } from "lucide-react";

import { MoonFlowMark } from "@/components/moonflow-mark";
import { Button } from "@/components/ui/button";
import { presetBlurb } from "@/lib/constants";
import type { Tone } from "@/lib/tone";
import type { TimerPreset } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The top bar: the app's own instrument, the rhythm the session is running on,
 * and the way out.
 *
 * Both pieces here are the app's, not the room's. The chip is the same
 * `.inset` well the header puts its sound switch in — same radius, same fill,
 * same inset hairline, and the same split between a sentence-case label and a
 * `font-mono` reading — and the exit is the header's own outline button at the
 * same height and label size. That is what keeps the room's chrome legible as
 * Moonflow rather than as a screen of its own.
 *
 * Its text is ivory at 70% for the same measured reason as the readouts: the
 * `text-muted-foreground` token is tuned to graphite, and this well sits on the
 * sky (components/focus/readouts.tsx has the numbers).
 *
 * The live dot is the one piece of colour up here and it means exactly what it
 * means everywhere else in the app — the clock is running.
 */
export function FocusTopBar({
  presetMeta,
  running,
  tone,
  onExit,
}: {
  presetMeta: TimerPreset;
  running: boolean;
  tone: Tone;
  onExit: () => void;
}) {
  const focusMinutes = presetMeta.durations.focus / 60_000;
  const shortMinutes = presetMeta.durations.short / 60_000;

  return (
    <div className="flex flex-none items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-3">
        <MoonFlowMark className="size-5 shrink-0 text-ivory/60" />
        <span
          className="inset hidden h-9 min-w-0 items-center gap-2 rounded-xl px-3 sm:inline-flex"
          title={`${presetMeta.label} preset — ${presetBlurb(presetMeta)}`}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              running && "animate-pulse-soft",
            )}
            style={{
              background: running ? tone.solid : "rgba(244,241,234,0.3)",
            }}
          />
          <span className="truncate text-caption font-medium text-ivory/70">
            {presetMeta.label}
          </span>
          <span className="font-mono text-micro tabular-nums text-ivory/70">
            {focusMinutes} / {shortMinutes}
          </span>
        </span>
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={onExit}
        className="h-9 shrink-0 gap-2 text-caption"
        aria-label="Exit focus mode"
      >
        <X className="size-4" />
        <span className="hidden sm:inline">Exit focus</span>
        <span className="sm:hidden">Exit</span>
        <span className="kbd hidden sm:inline">Esc</span>
      </Button>
    </div>
  );
}
