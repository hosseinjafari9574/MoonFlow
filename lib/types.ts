export type Priority = "low" | "medium" | "high";

export type TimerMode = "focus" | "short" | "long";

/** Pomodoro rhythm presets the user can switch between. */
export type TimerPresetId = "classic" | "deep";

export interface ModeMeta {
  label: string;
  shortLabel: string;
}

export interface TimerPreset {
  id: TimerPresetId;
  /** Human name shown in the switcher. */
  label: string;
  /** Durations per timer mode (ms). */
  durations: Record<TimerMode, number>;
  /** A long break is taken after this many completed focus sessions. */
  longBreakAfter: number;
  /** What one focus period is called — "Session" or "Block". */
  sessionWord: string;
  /** Per-mode display labels (breaks are labelled differently per preset). */
  modeLabels: Record<TimerMode, ModeMeta>;
}

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  priority: Priority;
  tags: string[];
  createdAt: number;
  completedAt: number | null;
  /** Pomodoro sessions completed against this task. */
  pomodoros: number;
  /** Focus minutes banked against this task. */
  focusMinutes: number;
}

export interface DayActivity {
  /** Tasks completed on this day. */
  completed: number;
  /** Focus sessions finished on this day. */
  pomodoros: number;
  /** Minutes spent in focus sessions on this day. */
  focusMinutes: number;
}

/** Keyed by local day, e.g. "2026-09-26". */
export type ActivityMap = Record<string, DayActivity>;

export interface Settings {
  soundEnabled: boolean;
}

export interface NewTaskInput {
  title: string;
  priority?: Priority;
  tags?: string[];
}
