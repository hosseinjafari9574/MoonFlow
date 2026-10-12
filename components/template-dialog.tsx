"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";

import { TEMPLATE_LIMITS } from "@/lib/constants";
import { deleteTemplateWithUndo } from "@/lib/template-actions";
import { cn } from "@/lib/utils";
import { useTemplateStore } from "@/store/use-template-store";
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

/**
 * Create or edit a routine. The draft lives here and the store is written once,
 * on save, so a routine the user abandons halfway is never persisted — which is
 * also why a routine with no tasks is refused rather than stored empty.
 */
export function TemplateDialog() {
  const editor = useUiStore((state) => state.templateEditor);
  const closeEditor = useUiStore((state) => state.closeTemplateEditor);
  const pushToast = useUiStore((state) => state.pushToast);

  const editingId = editor?.id ?? null;
  const template = useTemplateStore((state) =>
    editingId ? state.templates.find((item) => item.id === editingId) : undefined,
  );

  const [name, setName] = useState("");
  const [titles, setTitles] = useState<string[]>([""]);
  const rows = useRef<(HTMLInputElement | null)[]>([]);
  const pendingFocus = useRef<number | null>(null);

  /* A fresh draft every time the dialog opens. */
  useEffect(() => {
    if (!editor) return;
    setName(template?.name ?? "");
    setTitles(template ? [...template.titles] : [""]);
  }, [editor, template]);

  /* A row added with Enter (or the button) takes focus as it appears, so a
   * routine can be typed as one uninterrupted list. */
  useEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    pendingFocus.current = null;
    rows.current[index]?.focus();
  }, [titles]);

  function addRow(after: number) {
    setTitles((current) => [
      ...current.slice(0, after + 1),
      "",
      ...current.slice(after + 1),
    ]);
    pendingFocus.current = after + 1;
  }

  function removeRow(index: number) {
    setTitles((current) => current.filter((_, at) => at !== index));
  }

  function setTitleAt(index: number, value: string) {
    setTitles((current) =>
      current.map((title, at) => (at === index ? value : title)),
    );
  }

  const canSave =
    name.trim().length > 0 && titles.some((title) => title.trim().length > 0);

  function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    const store = useTemplateStore.getState();
    if (template) {
      store.updateTemplate(template.id, { name, titles });
      pushToast({ message: "Routine updated" });
    } else {
      const created = store.createTemplate({ name, titles });
      if (!created) return;
      pushToast({ message: `Saved “${created.name}”` });
    }
    closeEditor();
  }

  return (
    <Dialog
      open={Boolean(editor)}
      onOpenChange={(next) => {
        if (!next) closeEditor();
      }}
    >
      <DialogContent
        aria-describedby="template-description"
        className="max-h-[calc(100vh-3rem)] max-w-xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{template ? "Edit routine" : "New routine"}</DialogTitle>
          <DialogDescription id="template-description">
            Name it, then list the tasks it should add — each line becomes a
            task in your list.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleSave}>
          <div className="grid gap-2">
            <Label htmlFor="template-name">Name</Label>
            <Input
              id="template-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Morning routine"
              maxLength={TEMPLATE_LIMITS.name}
              autoFocus
              required
            />
          </div>

          <div className="grid gap-2">
            <Label>Tasks</Label>
            <div className="grid gap-2">
              {titles.map((title, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="w-5 shrink-0 text-right font-mono text-[11px] text-muted-foreground/60"
                  >
                    {index + 1}
                  </span>
                  <Input
                    ref={(node) => {
                      rows.current[index] = node;
                    }}
                    value={title}
                    onChange={(event) => setTitleAt(index, event.target.value)}
                    onKeyDown={(event) => {
                      /* Enter starts the next line instead of submitting: a
                       * routine is a list, so the keyboard stays in the list. */
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      if (titles.length >= TEMPLATE_LIMITS.tasks) return;
                      addRow(index);
                    }}
                    maxLength={TEMPLATE_LIMITS.title}
                    placeholder={index === 0 ? "First task" : "Another task"}
                    aria-label={`Task ${index + 1}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="iconSm"
                    aria-label={`Remove task ${index + 1}`}
                    className="shrink-0"
                    disabled={titles.length === 1}
                    onClick={() => removeRow(index)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 w-fit gap-1.5"
              disabled={titles.length >= TEMPLATE_LIMITS.tasks}
              onClick={() => addRow(titles.length - 1)}
            >
              <Plus className="size-3.5" />
              Add another task
            </Button>
          </div>

          <DialogFooter
            className={cn("items-center gap-2", template && "sm:justify-between")}
          >
            {template && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground hover:text-destructive"
                onClick={() => {
                  deleteTemplateWithUndo(template);
                  closeEditor();
                }}
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={closeEditor}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!canSave}>
                {template ? "Save changes" : "Save routine"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
