/*
 * Scratch: start-up, from before the app's own scripts run.
 *
 * This replaced `.freebuff/warm-timeline.mjs`, which compared two arms of the
 * Focus Mode start-up pre-warm. That pass was removed on 2026-10-11, so there is
 * only one build to load now; what this checks is the two things the pass used
 * to trade against each other:
 *
 *   - nothing invisible is mounted at start-up (`.focus-ghost` never appears);
 *   - the shell is not held: `main` appears as soon as hydration resolves, and
 *     the list's own first frames are clean (no frame > 33ms in its first 400ms).
 *
 * One Chrome session, N fresh loads with storage cleared between, so the numbers
 * are not one-off. Same recorder shape as `.freebuff/perf-focus.mjs`.
 *
 * A blank page is measured in the same window first, as a control: start-up
 * timings from a machine that cannot hold 60fps on an empty document are the
 * machine, not the app. When that control is not clean this refuses to print any
 * of the numbers and exits non-zero — see `.freebuff/perf-controls.mjs`.
 *
 * Usage: node .freebuff/startup-check.mjs [loads]   (default 4)
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { controlsVerdict, printRetry, retryReport } from "./perf-controls.mjs";

const PORT = 9353;
const APP = "http://localhost:3100/";
const ORIGIN = "http://localhost:3100";
const LOADS = Number(process.argv[2] ?? 4);

const CHROME_CANDIDATES = [
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate;
  throw new Error("no Chrome/Edge binary found");
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method) return;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async eval(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }
}

async function connect() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener("open", resolve, { once: true });
          ws.addEventListener("error", reject, { once: true });
        });
        return new Session(ws);
      }
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error("could not attach to Chrome");
}

const PROBE = `(() => {
  window.__su = { frames: [], long: [], ghost: [], listAt: null, dcl: null, load: null };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__su.long.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
  }).observe({ type: 'longtask', buffered: true });
  document.addEventListener('DOMContentLoaded', () => { window.__su.dcl = Math.round(performance.now()); });
  window.addEventListener('load', () => { window.__su.load = Math.round(performance.now()); });
  const watch = () => {
    const g = document.querySelector('.focus-ghost');
    if (g) {
      const last = window.__su.ghost[window.__su.ghost.length - 1];
      if (!last || last.state !== 'up') window.__su.ghost.push({ state: 'up', at: Math.round(performance.now()) });
    }
    if (window.__su.listAt === null && document.querySelector('main')) window.__su.listAt = Math.round(performance.now());
  };
  new MutationObserver(watch).observe(document, { childList: true, subtree: true });
  setInterval(watch, 30);
  let prev = null;
  const tick = (t) => {
    if (prev !== null) window.__su.frames.push({ at: Math.round(t), dur: Math.round((t - prev) * 10) / 10 });
    prev = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

const median = (xs) => {
  const s = [...xs].filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

/** Frame-interval summary for a window of the probe's `{at, dur}` records. */
const intervalStats = (frames) => {
  const deltas = frames.map((f) => f.dur).sort((a, b) => a - b);
  if (!deltas.length) return null;
  const at = (q) => deltas[Math.min(deltas.length - 1, Math.floor(q * deltas.length))];
  return {
    frames: deltas.length,
    fps: Math.round((1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length)) * 10) / 10,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    maxMs: deltas[deltas.length - 1],
    over33: deltas.filter((d) => d > 33).length,
  };
};

const profile = mkdtempSync(join(tmpdir(), "moonflow-startup-"));
const chrome = spawn(
  findChrome(),
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--window-size=1600,1000",
    "--window-position=-32000,-32000",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-features=CalculateNativeWinOcclusion,Translate,MediaRouter,OptimizationHints",
    "--new-window",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const loads = [];
/* The control set measured so far: `calibration` (a blank page) always, and
 * `list` (the app, settled and idle) once the loads have run. */
let controls = null;
let refusal = null;
try {
  const session = await connect();
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });

  /*
   * The control, first and before the app is ever loaded: a blank page in the
   * same window. Two navigations, because the very first one of a fresh profile
   * is cold for reasons that have nothing to do with the app — the second is the
   * one that is measured.
   */
  await session.send("Page.navigate", { url: "about:blank" });
  await sleep(900);
  await session.send("Page.navigate", { url: "about:blank" });
  await sleep(1200);
  const calibration = intervalStats(await session.eval("window.__su.frames"));
  controls = { calibration };
  if (!controlsVerdict(controls).valid) {
    /* No loads are run: a start-up number from a machine that cannot hold 60fps
     * on an empty page is not a start-up number. */
    refusal = { verdict: controlsVerdict(controls), controls };
  } else {
    /* A throwaway load: the app's first load in a session is cold for reasons
     * that have nothing to do with the app either. */
    await session.send("Storage.clearDataForOrigin", { origin: ORIGIN, storageTypes: "local_storage" });
    await session.send("Page.navigate", { url: APP });
    await sleep(2200);

    for (let i = 1; i <= LOADS; i++) {
      await session.send("Storage.clearDataForOrigin", { origin: ORIGIN, storageTypes: "local_storage" });
      await session.send("Page.navigate", { url: APP });
      await sleep(2200);
      const r = await session.eval("window.__su");
      const window_ = r.frames.filter((f) => f.at >= (r.listAt ?? 0) - 60 && f.at <= (r.listAt ?? 0) + 400);
      const ghost = r.ghost;
      loads.push({ ...r, windowMax: Math.max(0, ...window_.map((f) => f.dur)), windowOver33: window_.filter((f) => f.dur > 33).length });
      console.log(
        `load ${i}`,
        `load ${String(r.load).padStart(4)}ms`,
        `list(main) @${String(r.listAt).padStart(4)}ms`,
        `| ghost ${ghost.length ? ghost.map((g) => `${g.state}@${g.at}ms`).join(",") : "never mounted"}`,
        `| list first 400ms: max ${String(Math.round(loads[loads.length - 1].windowMax)).padStart(4)}ms over33 ${loads[loads.length - 1].windowOver33}`,
        `| long tasks ${r.long.filter((e) => e.start < 1500).length}`,
      );
    }

    /*
     * The control that actually decides, measured after the last load: the app
     * itself, settled and idle. The blank-page control above is a raw-cadence
     * check and is insensitive to load — run under four busy cores it still holds
     * 60fps while the app's own frames do not — so a start-up window is only
     * reported when the real page holds 60fps here too.
     */
    await sleep(900);
    const frames = await session.eval("window.__su.frames");
    const windowStart = (frames[frames.length - 1]?.at ?? 0) - 1200;
    controls = { calibration, list: intervalStats(frames.filter((f) => f.at >= windowStart)) };
    if (!controlsVerdict(controls).valid) refusal = { verdict: controlsVerdict(controls), controls };
  }
} catch (error) {
  console.error("\nstartup-check.mjs could not finish:", error?.message ?? error, "\n");
  process.exitCode = 1;
} finally {
  chrome.kill();
}

if (refusal) {
  printRetry("startup-check.mjs", refusal.verdict);
  console.log(JSON.stringify(retryReport("startup-check.mjs", refusal.verdict, { controls: refusal.controls }), null, 2));
  process.exitCode = 1;
} else if (loads.length) {
  const show = (phase) => `p95 ${phase.p95Ms}ms max ${Math.round(phase.maxMs)}ms over33 ${phase.over33}`;
  console.log("\n=== medians over", loads.length, "loads ===");
  console.log(
    "controls:", "blank page", show(controls.calibration), "| settled list", show(controls.list),
  );
  console.log(
    "load", median(loads.map((l) => l.load)),
    "| list appears @", median(loads.map((l) => l.listAt)),
    "| list first-400ms max", median(loads.map((l) => l.windowMax)),
    "| loads with a frame > 33ms in that window", loads.filter((l) => l.windowOver33 > 0).length,
  );
  const ghosted = loads.filter((l) => l.ghost.length).length;
  console.log("loads that mounted a hidden pre-warm:", ghosted, ghosted === 0 ? "(clean — nothing invisible is mounted)" : "(a hidden tree is being mounted at start-up)");
}
