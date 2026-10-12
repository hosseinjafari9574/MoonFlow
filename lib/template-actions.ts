import type { TaskTemplate } from "@/lib/types";
import { useTemplateStore } from "@/store/use-template-store";
import { useTodoStore } from "@/store/use-todo-store";
import { useUiStore } from "@/store/use-ui-store";

/**
 * Drop a routine into the list.
 *
 * Every title becomes an ordinary task — same shape, same defaults, the same
 * everything as one typed by hand — so nothing downstream (filters, stats,
 * Focus Mode, the pomodoro link) has to know routines exist.
 *
 * The store inserts new tasks at the top, so a routine is applied *backwards*:
 * its first line goes in last and ends up where the user expects to read it.
 */
export function addTemplateToList(template: TaskTemplate): number {
  const todo = useTodoStore.getState();
  const created = [...template.titles]
    .reverse()
    .map((title) => todo.addTask({ title }));

  if (created.length > 0) {
    useUiStore.getState().pushToast({
      message: `Added ${created.length} task${
        created.length === 1 ? "" : "s"
      } from “${template.name}”`,
      action: {
        label: "Undo",
        run: () => {
          const store = useTodoStore.getState();
          for (const task of created) store.deleteTask(task.id);
        },
      },
    });
  }

  return created.length;
}

/** Delete a routine with an undo toast, restoring it to its old position. */
export function deleteTemplateWithUndo(template: TaskTemplate): void {
  const index = useTemplateStore
    .getState()
    .templates.findIndex((item) => item.id === template.id);
  useTemplateStore.getState().deleteTemplate(template.id);
  useUiStore.getState().pushToast({
    message: `Deleted “${template.name}”`,
    tone: "warning",
    action: {
      label: "Undo",
      run: () => useTemplateStore.getState().restoreTemplate(template, index),
    },
  });
}
