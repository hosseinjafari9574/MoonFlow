"use client";

import { useEffect, useState } from "react";
import { Keyboard, Volume2, VolumeX } from "lucide-react";

import { APP_NAME } from "@/lib/constants";
import { formatDateHeading } from "@/lib/format";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useTodoStore } from "@/store/use-todo-store";
import { useUiStore } from "@/store/use-ui-store";
import { MoonFlowMark } from "@/components/moonflow-mark";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export function AppHeader() {
  const soundEnabled = useTodoStore((state) => state.settings.soundEnabled);
  const setSoundEnabled = useTodoStore((state) => state.setSoundEnabled);
  const setShortcutsOpen = useUiStore((state) => state.setShortcutsOpen);

  /* Chrome only materialises once the page moves. */
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b transition-all duration-300",
        scrolled
          ? "border-hairline bg-[#0b0b0e]/85 backdrop-blur-xl"
          : "border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="relative grid size-10 place-items-center rounded-xl text-ivory shadow-[0_0_28px_-10px_rgba(75,98,255,0.85)]"
            style={{
              backgroundImage:
                "linear-gradient(160deg, rgba(75,98,255,0.28), rgba(75,98,255,0.06))",
              boxShadow:
                "inset 0 0 0 1px rgba(139,153,255,0.28), 0 10px 26px -14px rgba(75,98,255,0.9)",
            }}
          >
            <MoonFlowMark />
          </span>
          <div className="leading-tight">
            <p className="text-[15px] font-semibold tracking-[-0.01em]">
              {APP_NAME}
            </p>
            <p className="hidden text-micro font-medium uppercase text-muted-foreground sm:block">
              {formatDateHeading()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="inset flex items-center gap-2 rounded-xl px-3 py-2">
            <span className="text-muted-foreground" aria-hidden>
              {soundEnabled ? (
                <Volume2 className="size-4" />
              ) : (
                <VolumeX className="size-4" />
              )}
            </span>
            <label
              htmlFor="sound-toggle"
              className="hidden text-caption font-medium text-muted-foreground sm:block"
            >
              Sounds
            </label>
            <Switch
              id="sound-toggle"
              checked={soundEnabled}
              onCheckedChange={(next) => {
                setSoundEnabled(next);
                if (next) playSound("soft");
              }}
              aria-label="Toggle sound effects"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShortcutsOpen(true)}
            className="h-9 gap-2 text-caption"
            aria-label="Show keyboard shortcuts"
          >
            <Keyboard className="size-4" />
            <span className="hidden sm:inline">Shortcuts</span>
            <span className="kbd hidden sm:inline">?</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
