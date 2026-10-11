"use client";

import { useUiStore } from "@/store/use-ui-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const GROUPS: { title: string; items: { keys: string[]; description: string }[] }[] =
  [
    {
      title: "Tasks",
      items: [
        { keys: ["N"], description: "New task" },
        { keys: ["↑", "↓"], description: "Move selection" },
        { keys: ["X"], description: "Complete selected task" },
        { keys: ["E"], description: "Edit selected task" },
      ],
    },
    {
      title: "Focus & timer",
      items: [
        { keys: ["F"], description: "Toggle Focus Mode" },
        { keys: ["Space"], description: "Start / pause the pomodoro" },
        { keys: ["P"], description: "Start / pause the pomodoro" },
        { keys: ["Esc"], description: "Exit Focus Mode / close dialogs" },
      ],
    },
    {
      title: "General",
      items: [{ keys: ["?"], description: "Show this shortcut list" }],
    },
  ];

export function ShortcutsDialog() {
  const open = useUiStore((state) => state.shortcutsOpen);
  const setOpen = useUiStore((state) => state.setShortcutsOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Everything in MoonFlow is reachable without leaving the keyboard.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </h3>
              <ul className="grid gap-1.5">
                {group.items.map((item) => (
                  <li
                    key={`${group.title}-${item.description}-${item.keys.join()}`}
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm"
                  >
                    <span className="text-secondary-foreground">
                      {item.description}
                    </span>
                    <span className="flex gap-1.5">
                      {item.keys.map((key) => (
                        <kbd key={key} className="kbd">
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
