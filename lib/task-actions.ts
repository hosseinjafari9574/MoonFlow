import { playSound } from "@/lib/sound";
import type { Task } from "@/lib/types";
import { useTimerStore } from "@/store/use-timer-store";
import { useTodoStore } from "@/store/use-todo-store";
import { useUiStore } from "@/store/use-ui-store";

/**
 * The timer's link is only ever an *active* task. A task that is completed or
 * deleted stops being something the clock can be focused on, so the link is
 * released here — where the two stores can meet — rather than left pointing at
 * a row the list no longer offers. The running clock is untouched: those
 * minutes still belong to today, they just no longer belong to that task.
 */
function releaseTimerLink(taskId: string): void {
  const timer = useTimerStore.getState();
  if (timer.taskId === taskId) timer.setTaskId(null);
}

/** Toggle completion with sound + an undo toast. */
export function toggleTaskWithFeedback(task: Task): boolean {
  const todo = useTodoStore.getState();
  const ui = useUiStore.getState();
  const next = !task.completed;

  todo.setTaskCompleted(task.id, next);
  if (next) releaseTimerLink(task.id);
  ui.select(task.id);

  if (next) {
    if (todo.settings.soundEnabled) playSound("complete");
    ui.pushToast({
      message: "Nice — one less thing on your mind.",
      action: {
        label: "Undo",
        run: () => useTodoStore.getState().setTaskCompleted(task.id, false),
      },
    });
  }
  return next;
}

/** Delete with an undo toast. */
export function deleteTaskWithFeedback(task: Task): void {
  const ui = useUiStore.getState();
  useTodoStore.getState().deleteTask(task.id);
  releaseTimerLink(task.id);
  if (ui.selectedId === task.id) ui.select(null);
  if (ui.focusTaskId === task.id) ui.closeFocus();
  if (ui.editingId === task.id) ui.closeEdit();
  ui.pushToast({
    message: `Deleted “${task.title}”`,
    tone: "warning",
    action: {
      label: "Undo",
      run: () => useTodoStore.getState().restoreTask(task),
    },
  });
}
