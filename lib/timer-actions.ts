import { TIMER_PRESETS } from "@/lib/constants";
import type { TimerMode, TimerPresetId } from "@/lib/types";
import { useTimerStore } from "@/store/use-timer-store";
import { useUiStore } from "@/store/use-ui-store";

/**
 * Focus the timer on a task and start a focus session.
 *
 * Two things this gets right beyond "set the link and start":
 *
 * 1. Switching to another task while a *paused* focus clock still holds time
 *    re-arms it. The minutes already spent are banked where they were spent
 *    (the clock's own accrual sees to that) and the new task gets a whole
 *    session rather than the tail of someone else's. Entering a task with 4:12
 *    left on another one used to hand you that 4:12.
 * 2. A clock that is *running* is never yanked. The rest of that session
 *    follows the new link, because the user is mid-session and Pause/Reset are
 *    right there if they want to stop — nothing is truncated behind their back.
 */
export function startFocusForTask(taskId: string | null, autoStart = true) {
  const timer = useTimerStore.getState();
  const switching = timer.taskId !== taskId;
  const pausedMidSession =
    timer.mode === "focus" &&
    !timer.running &&
    timer.remainingMs < TIMER_PRESETS[timer.preset].durations.focus;
  if (switching && pausedMidSession) timer.reset();
  timer.setTaskId(taskId);
  if (timer.mode !== "focus") timer.setMode("focus");
  if (autoStart) timer.start();
}

/**
 * Enter Focus Mode for a task — which is the user saying "focus on this, now".
 *
 * Opening the overlay starts the session for that task; there is no second
 * click to make. The automatic advance after completing a task is the one path
 * that only *moves* the overlay (it calls `openFocus` on its own): a break that
 * starts itself is a break nobody took.
 */
export function enterFocus(taskId: string) {
  useUiStore.getState().openFocus(taskId);
  startFocusForTask(taskId);
}

export function getProgress(
  mode: TimerMode,
  remainingMs: number,
  preset: TimerPresetId,
): number {
  const duration = TIMER_PRESETS[preset].durations[mode];
  return 1 - Math.min(1, Math.max(0, remainingMs / duration));
}
