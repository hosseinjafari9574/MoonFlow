"use client";

import { useEffect } from "react";
import { motion, MotionConfig } from "framer-motion";

import { LoadingScreen } from "@/components/loading-screen";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useTimerEngine } from "@/hooks/use-timer-engine";
import { EASE_OUT_EXPO, EASE_SOFT } from "@/lib/motion";
import { useTodoStore } from "@/store/use-todo-store";
import { useUiStore } from "@/store/use-ui-store";
import { useTemplateStore } from "@/store/use-template-store";
import { useTimerStore } from "@/store/use-timer-store";
import { AppHeader } from "@/components/app-header";
import { EditTaskDialog } from "@/components/edit-task-dialog";
import { FocusMode } from "@/components/focus-mode";
import { PomodoroCard } from "@/components/pomodoro-card";
import { ShortcutsDialog } from "@/components/shortcuts-dialog";
import { StatsPanel } from "@/components/stats-panel";
import { TaskComposer } from "@/components/task-composer";
import { TaskList } from "@/components/task-list";
import { TemplateDialog } from "@/components/template-dialog";
import { TemplatesPanel } from "@/components/templates-panel";
import { Toaster } from "@/components/toaster";

/** Two slow blooms — enough to keep the graphite from going flat. */
function AmbientBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      aria-hidden
    >
      <div className="ambient bloom right-[-6%] top-[-160px] h-[520px] w-[520px] bg-primary/20" />
      <div className="ambient bloom bottom-[-210px] left-[4%] h-[460px] w-[460px] bg-ivory/[0.06]" />
      <div className="ambient bloom right-[-140px] top-[38%] h-72 w-72 bg-primary/10" />
    </div>
  );
}

function AppShell() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 sm:px-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:py-8">
        <div className="grid content-start gap-5">
          <StatsPanel />
          <TaskComposer />
          <TaskList />
          <TemplatesPanel />
        </div>
        <aside className="grid content-start gap-4 lg:sticky lg:top-24 lg:self-start">
          <PomodoroCard />
          <p className="px-1 text-center text-[11px] leading-relaxed text-muted-foreground/85 lg:text-left">
            Press <span className="kbd mx-0.5 align-middle">?</span> for
            shortcuts · everything is stored locally on this device.
          </p>
        </aside>
      </main>
    </>
  );
}

export default function HomePage() {
  const hydrated = useUiStore((state) => state.hydrated);
  const focusOpen = useUiStore((state) => Boolean(state.focusTaskId));

  useTimerEngine();
  useKeyboardShortcuts();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.all([
        useTodoStore.persist.rehydrate(),
        useTemplateStore.persist.rehydrate(),
        useTimerStore.persist.rehydrate(),
      ]);
      if (!cancelled) useUiStore.getState().setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Entering focus lets the whole room recede behind the overlay: a pull back,
   * sideways-in, that reads as one camera move with the overlay's own push-in.
   * Leaving it snaps back faster than it left.
   *
   * Two measured rules hold this in budget (see docs/motion-budget.md):
   *
   * 1. No blur. Animating a `filter` on the page shell re-rasters the entire
   *    page every frame — the single most expensive part of both transitions.
   *    Depth comes from scale and translate instead.
   * 2. The entry recede only lasts as long as it can be *seen*. The overlay is
   *    opaque (`bg-[#070709]`), so the page behind it is gone once the overlay
   *    has faded in — 0.26s, exactly the overlay's own `focusShell` fade. Any
   *    recede past that point is a full-page transform of invisible content,
   *    and it measured as the largest single block of dropped frames in the
   *    arrival. So the two fades are matched, and the moving work stops with
   *    them.
   */
  const recede = {
    scale: focusOpen ? 0.94 : 1,
    y: focusOpen ? 14 : 0,
    opacity: focusOpen ? 0.3 : 1,
  };

  /* Visible window of the recede: the overlay's fade on the way in, the
   * overlay's own exit (0.4s + 0.04s delay) on the way out. */
  const recedeDuration = focusOpen ? 0.26 : 0.42;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen">
        <AmbientBackground />
        {/*
         * The page behind the overlay should be invisible — it sits behind an
         * opaque sheet — but it kept painting anyway: the sidebar's own layer
         * repainted 62 times during a single arrival, all of it unseen. A
         * `visibility` transition with a 0.26s delay flips it off exactly when
         * the overlay's fade completes (so the recede is still seen), and back
         * on with no delay on exit, so the overlay has a page to fade over.
         *
         * The duration is 10ms, not 0: a zero-length transition never resolves
         * in Chrome (it sits at `currentTime: 0` forever, leaving the page
         * visible). Visibility is discrete — it flips at the end — so this only
         * shifts the crossing by a frame.
         */}
        <div
          inert={focusOpen}
          style={{
            visibility: focusOpen ? "hidden" : "visible",
            transitionProperty: "visibility",
            transitionDuration: "0.01s",
            transitionDelay: focusOpen ? "0.26s" : "0s",
          }}
        >
          <motion.div
            animate={recede}
            initial={false}
            transition={{ duration: recedeDuration, ease: focusOpen ? EASE_OUT_EXPO : EASE_SOFT }}
            /* No manual `will-change`: Framer manages it per animation, and
               toggling it ourselves invalidated the layer mid-transition. */
            style={{ transformOrigin: "50% 28%" }}
          >
            {hydrated ? <AppShell /> : <LoadingScreen />}
          </motion.div>
        </div>
        {/* Filmic grain over the whole app. */}
        <div
          aria-hidden
          className="grain pointer-events-none fixed inset-0 z-40 opacity-[0.022]"
        />
        <FocusMode />
        <EditTaskDialog />
        <TemplateDialog />
        <ShortcutsDialog />
        <Toaster />
      </div>
    </MotionConfig>
  );
}
