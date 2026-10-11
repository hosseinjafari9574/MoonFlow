"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

import { PRIORITY_META } from "@/lib/constants";
import { formatRelative } from "@/lib/format";
import type { Priority } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useTodoStore } from "@/store/use-todo-store";
import { useUiStore } from "@/store/use-ui-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PRIORITIES: Priority[] = ["low", "medium", "high"];

export function EditTaskDialog() {
  const editingId = useUiStore((state) => state.editingId);
  const closeEdit = useUiStore((state) => state.closeEdit);
  const pushToast = useUiStore((state) => state.pushToast);
  const task = useTodoStore((state) =>
    state.tasks.find((item) => item.id === editingId),
  );

  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setPriority(task.priority);
    setTags(task.tags.join(", "));
  }, [task]);

  const open = Boolean(editingId) && Boolean(task);

  function handleSave() {
    if (!task) return;
    const trimmed = title.trim();
    if (!trimmed) return;
    useTodoStore.getState().updateTask(task.id, {
      title: trimmed,
      priority,
      tags: [
        ...new Set(
          tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
            .map((tag) => tag.slice(0, 24)),
        ),
      ].slice(0, 4),
    });
    pushToast({ message: "Task updated" });
    closeEdit();
  }

  function handleDelete() {
    if (!task) return;
    useTodoStore.getState().deleteTask(task.id);
    pushToast({
      message: `Deleted “${task.title}”`,
      tone: "warning",
      action: {
        label: "Undo",
        run: () => useTodoStore.getState().restoreTask(task),
      },
    });
    closeEdit();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeEdit();
      }}
    >
      <DialogContent aria-describedby="edit-task-description">
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription id="edit-task-description">
            Fine-tune the details. Changes are saved locally.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleSave();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              autoFocus
              required
            />
          </div>

          <div className="grid gap-2">
            <Label>Priority</Label>
            <div role="radiogroup" aria-label="Priority" className="flex gap-2">
              {PRIORITIES.map((value) => {
                const meta = PRIORITY_META[value];
                const active = priority === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPriority(value)}
                    className={cn(
                      "flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-caption font-semibold transition-all duration-200",
                      active
                        ? "border-white/15 bg-white/[0.06] text-foreground"
                        : "border-hairline text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                    )}
                  >
                    <span className={cn("size-1.5 rounded-full", meta.dot)} />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit-tags">Tags</Label>
            <Input
              id="edit-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="comma, separated"
            />
          </div>

          {task && (
            <p className="text-caption text-muted-foreground">
              Added {formatRelative(task.createdAt)} ·{" "}
              {task.pomodoros} pomodoro{task.pomodoros === 1 ? "" : "s"} completed
              {task.completed && task.completedAt
                ? ` · done ${formatRelative(task.completedAt)}`
                : ""}
            </p>
          )}

          <DialogFooter className="items-center gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              className="gap-1.5 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={closeEdit}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm">
                Save changes
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
