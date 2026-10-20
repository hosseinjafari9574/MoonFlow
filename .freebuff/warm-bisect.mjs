/*
 * RETIRED 2026-10-11 — the warm pass this measured was removed, and with it the
 * `?nowarm` seam that gave this harness its two arms. Both URLs now serve the
 * same build, so a run would quietly compare the app with itself and print a
 * confident, meaningless delta. It refuses to run unless `--force`.
 *
 * The trial, and the numbers that ended it, are in docs/motion-budget.md
 * (change 8). `.freebuff/warm-timeline.mjs` was the other half of the experiment
 * and has been replaced by `.freebuff/startup-check.mjs`, which checks the two
 * things that pass used to trade against each other: that nothing invisible is
 * mounted at start-up, and that the shell is not held.
 *
 * Scratch: paired A/B on the Focus Mode start-up warm pass.
 *
 * The warm pass is worth its start-up cost only if it visibly shrinks the cold
 * arrival — and the effect is close to this machine's ±15% run-to-run spread, so
 * two sets of three runs cannot settle it. This alternates the two arms inside
 * one browser session instead: same Chrome, same profile, same machine load,
 * back to back, order flipped every pair. What is left of a difference is the
 * difference.
 *
 *   A  the shipped build                       (warm pass runs)
 *   B  the same build with `?nowarm`           (warm pass skipped)
 *
 * Each arm loads the app from cleared storage (so both start from the same DOM),
 * records the `list` control, then the Focus Mode `entry` on a two-line title,
 * using exactly the recorder and the timing of `.freebuff/perf-focus.mjs` so the
 * numbers are comparable with the budget's own.
 *
 * A script installed before every document also logs whether `.focus-ghost`
 * actually mounted *and when it went away*, alongside the moment `main` (the real
 * list) first appeared. Two things depend on those timestamps:
 *
 *  - the arm's claim: a warm arm whose ghost was still mounted when the list
 *    painted did not actually run behind the loading screen;
 *  - the list's own first paint: frames are recorded from the moment `main`
 *    appears, so "the warm pass no longer touches the list's startup" is a
 *    measurement, not an assertion.
 *
 * Usage: node .freebuff/warm-bisect.mjs [pairs]      (default 4)
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.argv.includes("--force")) {
  console.log("warm-bisect.mjs is retired.");
  console.log("The Focus Mode start-up warm pass, and the `?nowarm` seam that was this harness's control arm,");
  console.log("were removed on 2026-10-11. Running it would compare the app with itself.");
  console.log("The trial and its numbers: docs/motion-budget.md, change 8. Start-up is checked today by");
  console.log(".freebuff/startup-check.mjs.");
  process.exit(0);
}

const PORT = 9346;
const APP = "http://localhost:3100/";
const ORIGIN = "http://localhost:3100";
const PAIRS = Number(process.argv[2] ?? 4);
const LONG_TITLE =
  "Rewrite the quarterly architecture review doc and circulate it to the platform team before Friday";

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
    if (exceptionDetails) {
      const detail = exceptionDetails.exception?.description ?? exceptionDetails.text ?? "";
      throw new Error(`${detail} | in: ${expression.replace(/\s+/g, " ").slice(0, 120)}`);
    }
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
      /* chrome not up yet */
    }
    await sleep(500);
  }
  throw new Error("could not attach to Chrome");
}

/* Identical to perf-focus.mjs, so the two harnesses speak the same numbers. */
const RECORDER = `(() => {
  window.__perf = { frames: [], long: [], shifts: [], phase: 'idle' };
  const tick = (t) => { window.__perf.frames.push([window.__perf.phase, t]); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__perf.long.push({ start: e.startTime, dur: e.duration });
  }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) window.__perf.shifts.push({ start: e.startTime, value: e.value });
  }).observe({ type: 'layout-shift', buffered: true });
  return true;
})()`;

const READ = `(() => {
  const p = window.__perf;
  return { frames: p.frames, long: p.long, shifts: p.shifts, hidden: document.hidden, focusOpen: !!document.querySelector('[role="dialog"][aria-label^="Focus mode"]') };
})()`;

const round = (n) => (n === null ? null : Math.round(n * 100) / 100);

function summarise(sample, phase, from) {
  const rows = sample.frames.filter(([p, t]) => p === phase && t >= from);
  const deltas = [];
  const slowFramesAtMs = [];
  for (let i = 1; i < rows.length; i++) {
    const delta = rows[i][1] - rows[i - 1][1];
    deltas.push(delta);
    if (delta > 33) slowFramesAtMs.push(Math.round(rows[i][1] - from));
  }
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);
  return {
    phase,
    frames: rows.length,
    fps: sorted.length ? Math.round((1000 / (sorted.reduce((a, b) => a + b, 0) / sorted.length)) * 10) / 10 : null,
    medianMs: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(sorted.length ? sorted[sorted.length - 1] : null),
    over33: deltas.filter((d) => d > 33).length,
    over50: deltas.filter((d) => d > 50).length,
    longTasks: sample.long.filter((e) => e.start >= from).length,
    cls: Math.round(sample.shifts.filter((e) => e.start >= from).reduce((s, e) => s + e.value, 0) * 10000) / 10000,
    firstFrameAtMs: rows.length ? Math.round(rows[0][1] - from) : null,
    slowFramesAtMs: slowFramesAtMs.slice(0, 24),
  };
}

async function sample(session, phase, ms) {
  await session.eval(`window.__perf.phase = ${JSON.stringify(phase)}`);
  const from = await session.eval("performance.now()");
  await sleep(ms);
  const data = await session.eval(READ);
  return summarise(data, phase, from);
}

async function realClick(session, expression) {
  const rect = await session.eval(`(() => {
    const el = ${expression};
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!rect) return false;
  const base = { x: rect.x, y: rect.y, button: "left", clickCount: 1, modifiers: 0 };
  await session.send("Input.dispatchMouseEvent", { ...base, type: "mouseMoved", buttons: 0 });
  await session.send("Input.dispatchMouseEvent", { ...base, type: "mousePressed", buttons: 1 });
  await session.send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased", buttons: 0 });
  return true;
}

async function waitFor(session, expression, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await session.eval(expression)) return true;
    await sleep(250);
  }
  return false;
}

/* One arm: a cold load, the list control, then the arrival. */
async function arm(session, withWarm) {
  await session.send("Storage.clearDataForOrigin", { origin: ORIGIN, storageTypes: "local_storage" });
  await session.send("Page.navigate", { url: withWarm ? APP : `${APP}?nowarm` });
  await waitFor(session, "document.readyState === 'complete' && !!document.querySelector('main')");
  await sleep(700);
  await session.eval(RECORDER);
  const list = await sample(session, "list", 1200);

  await session.eval(`(() => {
    const input = document.querySelector('form input[type="text"], form input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(LONG_TITLE)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await realClick(session, `[...document.querySelectorAll('form button')].find((b) => /add/i.test(b.textContent))`);
  await sleep(500);

  const clicked = await realClick(
    session,
    `[...document.querySelectorAll('main li button')].find((b) => /^Enter focus mode for “Rewrite the quarterly/.test(b.getAttribute('aria-label') || ''))`,
  );
  const entry = await sample(session, "entry", 2400);
  const ghost = await session.eval("(window.__ghostLog || []).slice()");
  const startup = await session.eval(`({
    listAt: window.__listAt,
    frames: window.__listFrames,
  })`);

  /* Back to the list, so the next arm starts where this one did. */
  await session.eval(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"]:not([aria-hidden="true"]) button')]
      .find((x) => /exit focus mode/i.test(x.getAttribute('aria-label') || ''));
    if (b) b.click();
    return true;
  })()`);
  await sleep(700);

  return { withWarm, list, entry, clicked, ghost, startup };
}

/** Median/p95/max over the list's first-paint frame intervals. */
function startupStats(startup) {
  const deltas = startup.frames ?? [];
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);
  const total = deltas.reduce((a, b) => a + b, 0);
  return {
    listAtMs: startup.listAt,
    frames: deltas.length,
    fps: deltas.length ? Math.round((1000 / (total / deltas.length)) * 10) / 10 : null,
    p95Ms: at(0.95),
    maxMs: sorted.length ? sorted[sorted.length - 1] : null,
    over33: deltas.filter((d) => d > 33).length,
  };
}

const profile = mkdtempSync(join(tmpdir(), "moonflow-warm-"));
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
    APP,
  ],
  { stdio: "ignore" },
);

const arms = [];
try {
  const session = await connect();
  await session.send("Page.enable");
  await session.send("Runtime.enable");

  /* Watch for the ghost from before the app's own scripts run: it lives ~300ms,
   * so anything installed later can miss it — and then the warm arm would be
   * indistinguishable from the cold one. */
  await session.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      window.__ghostLog = [];
      window.__listAt = null;
      window.__listFrames = [];
      const watch = () => {
        const g = document.querySelector('.focus-ghost');
        const last = window.__ghostLog[window.__ghostLog.length - 1];
        if (g && (!last || last.state !== 'up')) window.__ghostLog.push({ state: 'up', atMs: Math.round(performance.now()) });
        else if (!g && last && last.state === 'up') window.__ghostLog.push({ state: 'gone', atMs: Math.round(performance.now()) });
        // The real list showing up is the moment its first paint begins.
        if (window.__listAt === null && document.querySelector('main')) window.__listAt = Math.round(performance.now());
      };
      new MutationObserver(watch).observe(document, { childList: true, subtree: true });
      setInterval(watch, 50);
      // Frame intervals from the list's first paint onward, whatever else is up.
      let previous = null;
      const tick = (t) => {
        if (window.__listAt !== null && t >= window.__listAt && t - window.__listAt <= 900) {
          if (previous !== null) window.__listFrames.push(Math.round((t - previous) * 100) / 100);
          previous = t;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })()`,
  });

  for (let pair = 1; pair <= PAIRS; pair++) {
    /* Flipping the order cancels a machine that is slowly getting busier. */
    const order = pair % 2 === 1 ? [true, false] : [false, true];    for (const withWarm of order) {
      const result = await arm(session, withWarm);
      arms.push({ pair, ...result });
      const ghosted = result.ghost.some((g) => g.state === "up");
      const gone = result.ghost.find((g) => g.state === "gone");
      const startup = startupStats(result.startup);
      console.log(
        `pair ${pair} ${withWarm ? "warm  " : "nowarm"}`,
        `ghost:${ghosted ? "mounted" : "absent "}`,
        `list@${String(startup.listAtMs ?? "?").padStart(4)}ms`,
        `ghost-gone@${String(gone ? gone.atMs + "ms" : "—").padStart(6)}`,
        `| startup max ${String(Math.round(startup.maxMs ?? 0)).padStart(4)}ms`,
        `over33 ${startup.over33}`,
        `| entry max ${String(Math.round(result.entry.maxMs)).padStart(4)}ms`,
        `p95 ${String(result.entry.p95Ms.toFixed(1)).padStart(5)}`,
        `over33 ${result.entry.over33} over50 ${result.entry.over50}`,
      );
    }
  }
} catch (error) {
  console.log("harness error:", error?.message ?? error);
} finally {
  chrome.kill();
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

const warm = arms.filter((a) => a.withWarm);
const cold = arms.filter((a) => !a.withWarm);

console.log("\n=== arms ===");
for (const [name, set] of [["warm (A)", warm], ["nowarm (B)", cold]]) {
  if (!set.length) continue;
  const startups = set.map((a) => startupStats(a.startup));
  console.log(
    name.padEnd(11),
    "runs", set.length,
    "| list max", median(set.map((a) => a.list.maxMs)),
    "list dirty runs", set.filter((a) => a.list.maxMs > 33).length,
    "| entry max", median(set.map((a) => a.entry.maxMs)),
    "entry p95", median(set.map((a) => a.entry.p95Ms)),
    "entry over50", median(set.map((a) => a.entry.over50)),
    "| entry cls", median(set.map((a) => a.entry.cls)),
  );
  console.log(
    "".padEnd(11),
    "| list appears @", median(startups.map((s) => s.listAtMs)), "ms",
    "| first-paint fps", median(startups.map((s) => s.fps)),
    "max", median(startups.map((s) => s.maxMs)),
    "p95", median(startups.map((s) => s.p95Ms)),
    "over33", median(startups.map((s) => s.over33)),
  );
}

/* The claim at stake: the ghost must be gone before the list paints. */
const overlaps = warm.filter((a) => {
  const startup = startupStats(a.startup);
  const gone = (a.ghost.find((g) => g.state === "gone")?.atMs) ?? Infinity;
  return startup.listAtMs !== null && gone > startup.listAtMs;
});
console.log(
  "\nghost still mounted when the list painted:",
  overlaps.length === 0 ? "never" : `${overlaps.length} of ${warm.length} warm arms`,
);

console.log("\n=== paired deltas (warm - nowarm) ===");
for (let pair = 1; pair <= PAIRS; pair++) {
  const a = warm.find((x) => x.pair === pair);
  const b = cold.find((x) => x.pair === pair);
  if (!a || !b) continue;
  const as = startupStats(a.startup);
  const bs = startupStats(b.startup);
  console.log(
    `pair ${pair}`,
    "entry max", String(Math.round(a.entry.maxMs - b.entry.maxMs)).padStart(5) + "ms",
    "| list max", String(Math.round(a.list.maxMs - b.list.maxMs)).padStart(5) + "ms",
    "| entry over33", String(a.entry.over33 - b.entry.over33).padStart(3),
    "| shell appears +" + String(Math.round(as.listAtMs - bs.listAtMs)).padStart(4) + "ms",
    "| first-paint max", String(Math.round(as.maxMs - bs.maxMs)).padStart(5) + "ms",
  );
}

const deltas = warm.map((a) => a.entry.maxMs - cold.find((x) => x.pair === a.pair)?.entry.maxMs).filter(Number.isFinite);
console.log(
  "\nmedian paired entry-max delta (warm - nowarm):",
  median(deltas),
  "ms  |  all pairs:", JSON.stringify(deltas.map((d) => Math.round(d))),
);
const startupDeltas = warm
  .map((a) => {
    const b = cold.find((x) => x.pair === a.pair);
    return b ? startupStats(a.startup).maxMs - startupStats(b.startup).maxMs : null;
  })
  .filter(Number.isFinite);
console.log(
  "median paired first-paint-max delta (warm - nowarm):",
  median(startupDeltas),
  "ms  |  all pairs:", JSON.stringify(startupDeltas.map((d) => Math.round(d))),
);

const ghostSeen = warm.every((a) => a.ghost.some((g) => g.state === "up"));
const ghostAbsentInCold = cold.every((a) => !a.ghost.some((g) => g.state === "up"));
console.log("arms valid:", ghostSeen && ghostAbsentInCold ? "yes (ghost only in warm arms)" : `NO — ghost mounted ${ghostSeen ? "" : "missing in a warm arm "}${ghostAbsentInCold ? "" : "in a nowarm arm"}`);
