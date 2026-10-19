"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Trash2, X } from "lucide-react";

import { TEMPLATE_LIMITS } from "@/lib/constants";
import { uid } from "@/lib/format";
import { SPRING } from "@/lib/motion";
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
 * One editable line. The id is what keeps a draft row stable: keys, focus and
 * the enter/exit animation all follow the row, not its position, so removing
 * line 2 never makes line 3 look like line 2.
 */
interface DraftRow {
  id: string;
  title: string;
}

const blankRow = (): DraftRow => ({ id: uid(), title: "" });

/**
 * Create or edit a routine. The draft lives here and the store is written once,
 * on save, so a routine the user abandons halfway is never persisted — which is
 * also why a routine with no tasks is refused rather than stored empty.
 *
 * The list of tasks is the part that grows, so it is the part that scrolls: the
 * name, the guidance and the save button stay where they are however long the
 * routine gets.
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
  const [rows, setRows] = useState<DraftRow[]>([blankRow()]);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocus = useRef<string | null>(null);

  /* A fresh draft every time the dialog opens. */
  useEffect(() => {
    if (!editor) return;
    setName(template?.name ?? "");
    setRows(
      template
        ? template.titles.map((title) => ({ id: uid(), title }))
        : [blankRow()],
    );
  }, [editor, template]);

  /*
   * A row added with Enter (or the button) takes focus as it appears, and a row
   * removed hands focus back to its neighbour — so a routine can be typed, and
   * corrected, as one uninterrupted list.
   */
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const input = inputs.current.get(id);
    if (!input) return;
    input.focus();
    input.setSelectionRange?.(input.value.length, input.value.length);
  }, [rows]);

  function addRow(afterId: string) {
    if (rows.length >= TEMPLATE_LIMITS.tasks) return;
    const row = blankRow();
    pendingFocus.current = row.id;
    setRows((current) => {
      /*
       * The cap is re-checked against the list being updated, not the one this
       * handler closed over. A burst of Enter presses inside a single frame all
       * read the same `rows`, so a render-lagged guard alone lets the draft sail
       * past the limit; the clamp is what actually holds it. If it bails, the
       * pending focus points at a row that was never added, and the effect above
       * simply finds nothing to focus.
       */
      if (current.length >= TEMPLATE_LIMITS.tasks) return current;
      const at = current.findIndex((item) => item.id === afterId);
      return [...current.slice(0, at + 1), row, ...current.slice(at + 1)];
    });
  }

  function removeRow(id: string) {
    if (rows.length <= 1) return;
    const at = rows.findIndex((row) => row.id === id);
    const neighbour = rows[at - 1] ?? rows[at + 1];
    if (neighbour) pendingFocus.current = neighbour.id;
    /* Same clamp from the other side: the editor never empties itself out,
     * however fast the remove buttons are hit. */
    setRows((current) =>
      current.length <= 1 ? current : current.filter((row) => row.id !== id),
    );
  }

  function setTitleAt(id: string, value: string) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, title: value } : row)),
    );
  }

  const titles = rows.map((row) => row.title);
  const filled = titles.filter((title) => title.trim().length > 0).length;
  const named = name.trim().length > 0;
  const canSave = named && filled > 0;
  const atCap = rows.length >= TEMPLATE_LIMITS.tasks;
  /* Always a row: the draft is seeded with one and never emptied past it. */
  const lastRowId = rows[rows.length - 1]?.id ?? "";

  function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    const clean = name.trim();
    const store = useTemplateStore.getState();
    if (template) {
      store.updateTemplate(template.id, { name, titles });
      pushToast({ message: `Updated “${clean}”` });
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
        className="flex max-h-[calc(100dvh-3rem)] max-w-xl flex-col gap-5 overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle>{template ? "Edit routine" : "New routine"}</DialogTitle>
          <DialogDescription id="template-description">
            Name it, then list the tasks it adds — every line becomes a task in
            your list.
          </DialogDescription>
        </DialogHeader>

        <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={handleSave}>
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

          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label>Tasks</Label>
              {filled > 0 && (
                <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground/80">
                  {filled}
                </span>
              )}
            </div>

            <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain pr-2">
              <AnimatePresence initial={false}>
                {rows.map((row, index) => (
                  <motion.div
                    key={row.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={SPRING.snappy}
                    className="flex items-center gap-2"
                  >
                    <span
                      aria-hidden
                      className="w-5 shrink-0 text-right font-mono text-[11px] text-muted-foreground/50"
                    >
                      {index + 1}
                    </span>
                    <Input
                      ref={(node) => {
                        if (node) inputs.current.set(row.id, node);
                        else inputs.current.delete(row.id);
                      }}
                      value={row.title}
                      onChange={(event) => setTitleAt(row.id, event.target.value)}
                      onKeyDown={(event) => {
                        /* Enter starts the next line instead of submitting: a
                         * routine is a list, so the keyboard stays in the list. */
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addRow(row.id);
                          return;
                        }
                        /* Backspace on an empty line is how a list is thinned
                         * without reaching for the mouse. */
                        if (
                          event.key === "Backspace" &&
                          row.title.length === 0 &&
                          rows.length > 1
                        ) {
                          event.preventDefault();
                          removeRow(row.id);
                        }
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
                      className={cn("shrink-0", rows.length === 1 && "invisible")}
                      disabled={rows.length === 1}
                      onClick={() => removeRow(row.id)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-fit gap-1.5"
                disabled={atCap}
                onClick={() => addRow(lastRowId)}
              >
                <Plus className="size-3.5" />
                Add another task
              </Button>
              <p className="text-[11px] leading-relaxed text-muted-foreground/70">
                {atCap ? (
                  `${TEMPLATE_LIMITS.tasks} tasks is the limit`
                ) : (
                  <>
                    Press <span className="kbd mx-0.5 align-middle">Enter</span>{" "}
                    for the next line
                  </>
                )}
              </p>
            </div>
          </div>

          <DialogFooter
            className={cn(
              "items-stretch gap-2 sm:flex-row sm:items-center",
              template && "sm:justify-between",
            )}
          >
            {template && (
              <Button
                type="button"
                variant="ghost"
                className="w-fit gap-1.5 text-muted-foreground hover:text-destructive max-sm:w-full max-sm:justify-center"
                onClick={() => {
                  deleteTemplateWithUndo(template);
                  closeEditor();
                }}
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 max-sm:w-full">
              {/* Why Save is still dark, said where the button is. */}
              {!canSave && (
                <p
                  aria-live="polite"
                  className="text-[11px] leading-relaxed text-muted-foreground/80"
                >
                  {named ? "Add at least one task" : "Give the routine a name"}
                </p>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={closeEditor}
                className="max-sm:flex-1"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSave} className="max-sm:flex-1">
                {template ? "Save changes" : "Save routine"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
