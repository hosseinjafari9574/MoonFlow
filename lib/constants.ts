import type {
  Priority,
  TimerMode,
  TimerPreset,
  TimerPresetId,
} from "@/lib/types";

export const APP_NAME = "MoonFlow";

/**
 * Pomodoro rhythm presets. Each preset owns its durations, its break
 * cadence and its display labels so the whole UI can stay preset-aware
 * without branching in components.
 */
export const TIMER_PRESETS: Record<TimerPresetId, TimerPreset> = {
  /** 25 focus · 5 short break · 15 long break after four sessions. */
  classic: {
    id: "classic",
    label: "Classic",
    durations: {
      focus: 25 * 60_000,
      short: 5 * 60_000,
      long: 15 * 60_000,
    },
    longBreakAfter: 4,
    sessionWord: "Session",
    modeLabels: {
      focus: { label: "Focus", shortLabel: "Focus" },
      short: { label: "Short break", shortLabel: "Short" },
      long: { label: "Long break", shortLabel: "Long" },
    },
  },
  /** 50 focus · 10 break · 20 long break after four blocks. */
  deep: {
    id: "deep",
    label: "Deep Work",
    durations: {
      focus: 50 * 60_000,
      short: 10 * 60_000,
      long: 20 * 60_000,
    },
    longBreakAfter: 4,
    sessionWord: "Block",
    modeLabels: {
      focus: { label: "Focus", shortLabel: "Focus" },
      short: { label: "Break", shortLabel: "Break" },
      long: { label: "Long break", shortLabel: "Long" },
    },
  },
};

/** Order of the presets in the switcher. */
export const PRESET_ORDER: readonly TimerPresetId[] = ["classic", "deep"];

export function presetOf(id: TimerPresetId): TimerPreset {
  return TIMER_PRESETS[id];
}

/** Durations (ms) for a preset, keyed by timer mode. */
export function durationsFor(id: TimerPresetId): Record<TimerMode, number> {
  return TIMER_PRESETS[id].durations;
}

/** Display label for a mode within a preset (e.g. deep work calls both
 * breaks simply "break" until the long one). */
export function modeMeta(id: TimerPresetId, mode: TimerMode) {
  return TIMER_PRESETS[id].modeLabels[mode];
}

/** Compact preset summary for the switcher, e.g. "25m focus · 5m break". */
export function presetBlurb(preset: TimerPreset): string {
  const focus = preset.durations.focus / 60_000;
  const short = preset.durations.short / 60_000;
  return `${focus}m focus · ${short}m break`;
}

/** How often the timer engine evaluates the clock. */
export const TICK_INTERVAL_MS = 200;

/**
 * Routine caps. Shared by the store (which clamps on save) and the persistence
 * layer (which clamps on hydrate), so a routine is bounded on both ways in.
 */
export const TEMPLATE_LIMITS = {
  /** Longest routine name. */
  name: 60,
  /** Longest task title inside a routine (matches the composer's own cap). */
  title: 160,
  /** Most tasks one routine can carry. */
  tasks: 40,
} as const;

/**
 * Priority reads as a monochrome ladder — only the top rung earns colour.
 * Keeps the accent free for "live" state and amber for achievements.
 */
export const PRIORITY_META: Record<
  Priority,
  { label: string; dot: string }
> = {
  low: { label: "Low", dot: "bg-white/25" },
  medium: { label: "Medium", dot: "bg-white/60" },
  high: { label: "High", dot: "bg-destructive" },
};
