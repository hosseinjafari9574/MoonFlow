import { TIMER_PRESETS } from "@/lib/constants";
import type { TimerMode, TimerPresetId } from "@/lib/types";
import { useTimerStore } from "@/store/use-timer-store";

/** Focus the timer on a task and start a focus session. */
export function startFocusForTask(taskId: string | null, autoStart = true) {
  const timer = useTimerStore.getState();
  timer.setTaskId(taskId);
  if (timer.mode !== "focus") timer.setMode("focus");
  if (autoStart) timer.start();
}

export function getProgress(
  mode: TimerMode,
  remainingMs: number,
  preset: TimerPresetId,
): number {
  const duration = TIMER_PRESETS[preset].durations[mode];
  return 1 - Math.min(1, Math.max(0, remainingMs / duration));
}
