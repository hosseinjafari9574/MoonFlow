"use client";

import { useEffect } from "react";

import { filterTasks } from "@/lib/activity";
import { enterFocus } from "@/lib/timer-actions";
import { toggleTaskWithFeedback } from "@/lib/task-actions";
import { useTodoStore } from "@/store/use-todo-store";
import { useUiStore } from "@/store/use-ui-store";
import { useTimerStore } from "@/store/use-timer-store";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/** App-wide shortcuts: N new · F focus · Space/P timer · X complete · ? help */
export function useKeyboardShortcuts() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const ui = useUiStore.getState();
      const typing = isTypingTarget(event.target);

      if (event.key === "Escape") {
        if (ui.focusTaskId) {
          ui.closeFocus();
        } else if (ui.editingId) {
          ui.closeEdit();
        } else if (ui.shortcutsOpen) {
          ui.setShortcutsOpen(false);
        } else if (typing && event.target instanceof HTMLElement) {
          event.target.blur();
        }
        return;
      }

      if (typing) return;

      const key = event.key.toLowerCase();

      if (key === "n") {
        event.preventDefault();
        ui.focusComposer();
        return;
      }

      if (key === "?" || (event.key === "/" && event.shiftKey)) {
        event.preventDefault();
        ui.setShortcutsOpen(!ui.shortcutsOpen);
        return;
      }

      if (event.key === " " || key === "p") {
        // Let a focused button handle its own Space activation.
        if (
          event.key === " " &&
          event.target instanceof HTMLElement &&
          (event.target.tagName === "BUTTON" ||
            event.target.getAttribute("role") === "checkbox")
        ) {
          return;
        }
        event.preventDefault();
        useTimerStore.getState().toggle();
        return;
      }

      const tasks = useTodoStore.getState().tasks;
      const visible = filterTasks(tasks, ui.filter, ui.tagFilter);
      const selected =
        visible.find((task) => task.id === ui.selectedId) ?? visible[0] ?? null;

      if (key === "f") {
        event.preventDefault();
        if (ui.focusTaskId) {
          ui.closeFocus();
          return;
        }
        const target =
          selected && !selected.completed
            ? selected
            : visible.find((task) => !task.completed) ?? null;
        if (target) enterFocus(target.id);
        else
          useUiStore
            .getState()
            .pushToast({ message: "Nothing left to focus on right now." });
        return;
      }

      if (key === "x") {
        if (!selected) return;
        event.preventDefault();
        toggleTaskWithFeedback(selected);
        return;
      }

      if (key === "e") {
        if (!selected) return;
        event.preventDefault();
        ui.openEdit(selected.id);
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (visible.length === 0) return;
        event.preventDefault();
        const currentIndex = visible.findIndex(
          (task) => task.id === ui.selectedId,
        );
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          currentIndex === -1
            ? 0
            : Math.min(visible.length - 1, Math.max(0, currentIndex + delta));
        const next = visible[nextIndex];
        if (next) {
          ui.select(next.id);
          document
            .querySelector(`[data-task-id="${next.id}"]`)
            ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
