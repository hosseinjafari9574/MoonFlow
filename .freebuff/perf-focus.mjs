/*
 * Focus Mode motion budget harness.
 *
 * Drives a local Chrome over the DevTools protocol (no extra dependencies —
 * Node 26 has fetch + WebSocket built in) and records what the *browser* says
 * about the transition, against two controls:
 *
 *   calibration   about:blank, same window  → the raw rAF cadence here
 *   list          the todo list, animations running
 *   listPaused    the todo list with every Web Animation paused
 *   entry         the Focus Mode arrival (long, two-line task title)
 *   idle          Focus Mode, settled
 *   exit          leaving Focus Mode
 *
 * Without the first control a slow window looks exactly like a slow app.
 *
 * Usage: node .freebuff/perf-focus.mjs [--visible]
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  collectTrace,
  layerSnapshot,
  resolveBackendNodes,
  resolveNodes,
  resolveWorstCall,
  summarizeLayers,
  summarizeProfile,
} from "./perf-trace.mjs";
import { controlsVerdict, printRetry, retryReport, verdictForReport } from "./perf-controls.mjs";

const PORT = 9333;
const APP = "http://localhost:3100/";
const VISIBLE = process.argv.includes("--visible");
/*
 * `--nowarm` was removed with the start-up pre-warm it measured: the `?nowarm`
 * seam lived in the app, and a flag that quietly loads the ordinary build while
 * labelling the report "nowarm" would be worse than no flag at all. The pass's
 * trial, and the numbers that ended it, are in docs/motion-budget.md.
 */
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
    this.events = [];
    this.eventResolvers = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method) {
        this.events.push(msg);
        this.eventResolvers.get(msg.method)?.();
        return;
      }
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
    });
  }

  /** Resolve once the named CDP event has been seen (or time out). */
  waitForEvent(method, timeoutMs = 10000) {
    if (this.events.some((e) => e.method === method)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this.eventResolvers.set(method, () => {
        clearTimeout(timer);
        this.eventResolvers.delete(method);
        resolve(true);
      });
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
    /* Name the failing expression: an unlabelled "Uncaught" in a 600-line
     * harness is a debugging tax, and the expression is always the culprit. */
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

// Installed in the page: frame timestamps tagged with the current phase, plus
// long tasks and layout shifts.
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
  return { frames: p.frames, long: p.long, shifts: p.shifts, now: performance.now(), hidden: document.hidden, visibility: document.visibilityState, focusOpen: !!document.querySelector('[role="dialog"][aria-label^="Focus mode"]') };
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
  const long = sample.long.filter((e) => e.start >= from);
  const shifts = sample.shifts.filter((e) => e.start >= from);
  return {
    phase,
    frames: rows.length,
    fps: sorted.length ? Math.round((1000 / (sorted.reduce((a, b) => a + b, 0) / sorted.length)) * 10) / 10 : null,
    medianMs: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(sorted.length ? sorted[sorted.length - 1] : null),
    over20: deltas.filter((d) => d > 20).length,
    over33: deltas.filter((d) => d > 33).length,
    over50: deltas.filter((d) => d > 50).length,
    longTasks: long.length,
    longTaskTotalMs: round(long.reduce((sum, e) => sum + e.dur, 0)),
    cls: Math.round(shifts.reduce((sum, e) => sum + e.value, 0) * 10000) / 10000,
    /* Where inside the window the dropped frames fall: a front-loaded burst is
     * mount/first-paint cost, a spread tail is per-frame animation cost. */
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

/*
 * Real input, not `element.click()`.
 *
 * A synthetic click is not a user activation, so the app's "first gesture"
 * audio priming never ran and the arrival paid for `new AudioContext()` — the
 * single largest blocking call in the profile (~120ms). Dispatching input
 * through CDP is what a real user does, and is the only honest way to measure
 * the arrival.
 */
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

const profile = mkdtempSync(join(tmpdir(), "moonflow-perf-"));
const chrome = spawn(
  findChrome(),
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--window-size=1600,1000",
    VISIBLE ? "--window-position=80,80" : "--window-position=-32000,-32000",
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

let report;
/* Set when the run is refused for dirty controls rather than measured. */
let refused = null;
/* Hoisted out of the try so a refusal can still carry it: whether a hidden
 * pre-warm mounted is a fact about the DOM, not a timing, and no amount of
 * machine load changes it. */
let ghostProbe = null;

/*
 * Stop the moment a control is known to be dirty. The remaining ~45s of phases
 * would be measured only to be refused, and a retry loop pays that cost per
 * attempt.
 */
const refuseIfControlsDirty = (controls) => {
  const verdict = controlsVerdict(controls);
  if (!verdict.valid) {
    const error = new Error(`controls dirty: ${verdict.failures.join("; ")}`);
    error.controlsVerdict = verdict;
    throw error;
  }
};

try {
  const session = await connect();
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Performance.enable");

  /*
   * Does the start-up warm pass actually mount? It lives for ~300ms after
   * hydration, so a probe that attaches afterwards can never see it; this one
   * watches from the load event and reports what it saw, including the
   * suppression (`inert`, `aria-hidden`, 1% opacity) that keeps it unseen.
   */
  if (process.argv.includes("--ghostProbe")) {
    /* Watched from before the document's own scripts run: the warm pass lives
     * ~300ms, so an observer installed after the load event can miss it
     * entirely — and a probe that can miss the thing it is proving is worse
     * than none. */
    await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        window.__ghostLog = [];
        window.__ghostProbeInstalled = true;
        const watch = () => {
          const g = document.querySelector('.focus-ghost');
          const last = window.__ghostLog[window.__ghostLog.length - 1];
          if (g) {
            const cs = getComputedStyle(g);
            const snapshot = {
              opacity: cs.opacity,
              pointerEvents: cs.pointerEvents,
              inert: g.hasAttribute('inert'),
              ariaHidden: g.getAttribute('aria-hidden'),
              titleHeight: g.querySelector('h1') ? Math.round(g.querySelector('h1').getBoundingClientRect().height) : null,
              ringWidth: (() => { const r = g.querySelector('[class*="grid place-items-center"] > svg'); return r ? r.getAttribute('width') : null; })(),
            };
            if (!last || last.state !== 'up') window.__ghostLog.push({ state: 'up', atMs: Math.round(performance.now()), ...snapshot });
            else Object.assign(last, snapshot);
          } else if (last && last.state === 'up') {
            window.__ghostLog.push({ state: 'gone', atMs: Math.round(performance.now()) });
          }
        };
        // Observe document, not documentElement: this runs before the document
        // element exists, and observing a null node throws the probe away.
        new MutationObserver(watch).observe(document, { childList: true, subtree: true });
        setInterval(watch, 60);
      })()`,
    });
    await session.send("Page.navigate", { url: APP });
    await session.waitForEvent("Page.loadEventFired", 15000);
    await sleep(1200);
    ghostProbe = await session.eval(`({
      installed: window.__ghostProbeInstalled === true,
      log: window.__ghostLog || [],
      leftover: !!document.querySelector('.focus-ghost'),
      leftoverDialog: !!document.querySelector('[role="dialog"]'),
    })`);
  }

  /* -- control 1: a blank page in the same window ------------------------- */
  await session.send("Page.navigate", { url: "about:blank" });
  await sleep(900);
  await session.eval(RECORDER);
  const calibration = await sample(session, "calibration", 1200);
  /* The first control, known before any phase that matters: `--ghostProbe` runs
   * before it, so a refusal here still carries what the probe saw. */
  refuseIfControlsDirty({ calibration });

  /* -- the app, list view ------------------------------------------------- */
  await session.send("Page.navigate", { url: APP });
  await waitFor(session, "document.readyState === 'complete' && !!document.querySelector('main')");
  await sleep(700);
  await session.eval(RECORDER);
  const list = await sample(session, "list", 1200);
  refuseIfControlsDirty({ calibration, list });

  let listPaused = null;

  /* -- a realistic worst case: a title that wraps to two lines ------------ */
  await session.eval(`(() => {
    const input = document.querySelector('form input[type="text"], form input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(LONG_TITLE)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  // A real click on Add: the first gesture a user makes, which is what primes
  // the audio context in `useTimerEngine`.
  await realClick(
    session,
    `[...document.querySelectorAll('form button')].find((b) => /add/i.test(b.textContent))`,
  );
  await sleep(500);

  const TRACE = process.argv.includes("--trace");
  const PROFILE = process.argv.includes("--profile");
  const LAYERS = process.argv.includes("--layers");
  /*
   * Start the clock before the arrival, from the Pomodoro card.
   *
   * The app used to start a focused task's session by itself the moment the
   * overlay opened, and this harness grew up around that: `entry`, `idle` and
   * `exit` were all measured with the clock running — which is what the idle
   * budget is about (the instrument reticks its arc, comet head and ticks every
   * 200ms). The app deliberately does not start a clock by itself any more, so
   * the harness has to do it; otherwise every arrival number silently changes
   * meaning to "a paused overlay", and the budget's worst case stops being
   * measured. A user really does take this path: start a session, then open
   * Focus Mode.
   */
  const startedClock = await realClick(
    session,
    `document.querySelector('section[aria-label="Pomodoro timer"] button[aria-label="Start timer"]')`,
  );
  await sleep(400);
  const clockRunning = await session.eval(
    `!!document.querySelector('section[aria-label="Pomodoro timer"] button[aria-label="Pause timer"]')`,
  );
  if (!clockRunning) {
    console.log(
      "WARNING: the clock is not running — idle and exit are no longer being measured in the state the budget is about",
    );
  }
  const focusButton = await session.eval(`(() => {
    const btn = [...document.querySelectorAll('main li button')].find((b) => /^Enter focus mode for “Rewrite the quarterly/.test(b.getAttribute('aria-label') || ''));
    if (!btn) return false;
    window.__focusBtn = btn;
    if (!${TRACE || PROFILE || LAYERS}) btn.click();
    return true;
  })()`);

  /*
   * A CPU profile names the functions a trace can only call "(anonymous)":
   * the sampling tree keeps url + line + column for every frame, and
   * `summarizeProfile` resolves those back to the served chunk so the cost has
   * a name instead of a size.
   */
  let profile = null;
  let profileSample = null;
  if (PROFILE) {
    await session.send("Profiler.enable");
    await session.send("Profiler.setSamplingInterval", { interval: 100 });
    await session.send("Profiler.start");
    await realClick(session, "window.__focusBtn");
    profileSample = await sample(session, "entryProfiled", 2600);
    const { profile: raw } = await session.send("Profiler.stop");
    profile = await summarizeProfile(raw);
  }

  /*
   * Which layer repaints on every frame of the arrival?
   *
   * A trace can say "the root painted 116 times" but its node ids are blink-
   * internal and die with the trace. The layer tree is the right instrument:
   * every layer carries a cumulative `paintCount` and a `backendNodeId` that
   * survives, so a snapshot before the arrival and one after it names the exact
   * element being repainted, in DOM terms.
   */
  let layers = null;
  if (LAYERS) {
    await session.send("LayerTree.enable");
    await sleep(500);
    const baseline = layerSnapshot(session.events);
    session.events = [];
    await realClick(session, "window.__focusBtn");
    const layerSample = await sample(session, "entryLayers", 2400);
    /* Nudge a style change so the very last snapshot reflects the final paint
     * counts rather than the last time the tree happened to change. */
    await session.eval("void document.documentElement.offsetHeight");
    await sleep(250);
    layers = summarizeLayers(session.events, baseline);
    layers.nodeLabels = await resolveBackendNodes(
      session,
      layers.rows.map((r) => r.node).filter(Boolean),
    );
    layers.sample = layerSample;
  }

  /*
   * What is the browser actually doing during the arrival? A trace answers it
   * with the browser's own task names and, for paints, the DOM node that paid.
   */
  let traceSample = null;
  let trace = null;
  if (TRACE) {
    await session.send("Tracing.start", {
      categories: "devtools.timeline,benchmark,cc,v8",
      transferMode: "ReportEvents",
    });
    await realClick(session, "window.__focusBtn");
    traceSample = await sample(session, "entryTraced", 2600);
    await session.send("Tracing.end");
    await session.waitForEvent("Tracing.tracingComplete", 20000);
    trace = collectTrace(session.events);
    trace.worstCall = await resolveWorstCall(session, trace.worstCall);
    const labels = await resolveNodes(
      session,
      trace.paintByNode.map((r) => r.nodeId),
    );
    trace.paintByNode = trace.paintByNode.map((r) => ({
      ...r,
      node: labels.get(r.nodeId) ?? `#${r.nodeId}`,
    }));
  }

  const BISECT = process.argv.includes("--bisect");
  const ENTRY_BISECT = process.argv.includes("--entryBisect");
  let bisect = null;
  let entryBisect = null;

  /*
   * The entry stall is a *first paint* problem, so the suspect has to be
   * removed before the overlay mounts, and each condition needs a clean,
   * comparable arrival. Every condition therefore reloads the app (the long
   * task title is persisted, so it comes back), clicks into Focus Mode, hides
   * the suspect within the first ~90ms, then samples the arrival. The first and
   * last conditions are the same code path, which separates "this layer costs
   * rasters" from "the first arrival in this window is simply cold".
   */
  if (ENTRY_BISECT) {
    await session.eval(`document.querySelector('button[aria-label="Exit focus mode"]')?.click()`);
    await sleep(1400);

    /*
     * `pre` runs *before* the click, which is the only way to test a layer's
     * first paint: setting it after the click measures a re-raster instead.
     * `post` runs just after, and can only neutralise what already painted.
     */
    const arrive = async (label, setup, pre) => {
      await session.send("Page.navigate", { url: APP });
      await waitFor(session, "document.readyState === 'complete' && !!document.querySelector('main')");
      await sleep(900);
      await session.eval(RECORDER);
      await session.eval(`(() => {
        const has = [...document.querySelectorAll('main li')].some((li) => /Rewrite the quarterly/.test(li.textContent || ''));
        if (has) return 'present';
        const input = document.querySelector('form input[type="text"], form input');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(LONG_TITLE)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        [...document.querySelectorAll('form button')].find((b) => /add/i.test(b.textContent)).click();
        return 'added';
      })()`);
      await sleep(700);
      if (pre) await session.eval(pre);
      const located = await session.eval(`(() => {
        const btn = [...document.querySelectorAll('main li button')].find((b) => /^Enter focus mode for “Rewrite the quarterly/.test(b.getAttribute('aria-label') || ''));
        window.__focusBtn = btn || null;
        return !!btn;
      })()`);
      // Real input here too: a synthetic click would re-introduce the
      // audio-context priming cost and swamp every condition equally.
      const opened = (await realClick(session, "window.__focusBtn")) && located;
      await sleep(90);
      if (setup) await session.eval(setup);
      const summary = await sample(session, label, 2400);
      return { opened, ...summary };
    };


    /*
     * The first pass cleared every *overlay* layer (grain, veils, aurora,
     * sweep) — all neutral, and the warm control matched the cold one. So the
     * suspects left are the three things that move the *content*: the page's
     * own scale recede, the lens push-in, and the stage rise. Each condition
     * pauses exactly those animations right after the click (paused = no
     * per-frame update, but the layer stays composited).
     */
    const PAUSE = (targetExpr) => `(() => {
      const targets = [${targetExpr}].filter(Boolean);
      let n = 0;
      for (const t of targets) {
        document.getAnimations({ subtree: true })
          .filter((a) => a.effect && t.contains(a.effect.target))
          .forEach((a) => { a.pause(); n++; });
      }
      return n;
    })()`;
    const SHELL = `document.querySelector('[inert] > div')`;
    const LENS = `(() => { const d = document.querySelector('[role="dialog"]'); return [...d.children].find((c) => c.querySelector('.float-up')); })()`;
    const STAGE = `(() => { const d = document.querySelector('[role="dialog"]'); return [...d.children].find((c) => typeof c.className === 'string' && /z-20/.test(c.className)); })()`;
    const DIALOG = `document.querySelector('[role="dialog"]')`;

    void PAUSE;
    void DIALOG;

    /*
     * A paused animation is not the same as a static layer: Framer drives
     * variant transforms from JS (not the Web Animations API), so `pause()`
     * never touched the page recede, the lens or the stage. An `!important`
     * rule *does* beat Framer's inline styles, so attributing the element and
     * neutralising its transform is the test that actually lands.
     */
    const STATIC = (...selectors) => `(() => {
      const els = [${selectors.join(", ")}].filter(Boolean);
      if (!els.length) return -1;
      els.forEach((el) => el.setAttribute('data-perf-nofx', ''));
      if (!document.getElementById('perf-nofx')) {
        const s = document.createElement('style');
        s.id = 'perf-nofx';
        s.textContent = '[data-perf-nofx] { transform: none !important; }';
        document.head.appendChild(s);
      }
      return els.length;
    })()`;

    const CONDITIONS = [
      ["base1", null],
      ["shellStatic", STATIC(SHELL)],
      ["base2", null],
      ["lensStatic", STATIC(LENS)],
      ["stageStatic", STATIC(STAGE)],
      ["shellStageStatic", STATIC(SHELL, STAGE)],
      ["base3", null],
    ];
    void CONDITIONS.length;

    /*
     * The retired inline `feTurbulence` grain, kept here as the control for the
     * baked PNG: same element, same session, alternating, so machine drift can
     * not be mistaken for an effect.
     */
    const GRAIN_SVG =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";
    const grain = (uri) => {
      /* The SVG data URI contains single quotes of its own, so the CSS text has
       * to be embedded the safe way rather than pasted into a JS string. */
      const css = `.grain { background-image: url("${uri}") !important; }`;
      return `(() => {
        let s = document.getElementById('perf-grain');
        if (!s) { s = document.createElement('style'); s.id = 'perf-grain'; document.head.appendChild(s); }
        s.textContent = ${JSON.stringify(css)};
        return ${JSON.stringify(uri.startsWith("data:") ? ".grain -> feTurbulence svg" : `.grain -> ${uri}`)};
      })()`;
    };

    /* Injecting a stylesheet *before* the click is how a candidate fix is
     * tested: the rules apply to elements that do not exist yet, so the first
     * paint is the fixed one rather than a re-raster of the broken one. */
    const CSS = (text) => `(() => {
      let s = document.getElementById('perf-css');
      if (!s) { s = document.createElement('style'); s.id = 'perf-css'; document.head.appendChild(s); }
      s.textContent = ${JSON.stringify(text)};
      return 'css';
    })()`;

    if (process.argv.includes("--grainBisect")) {
      entryBisect = { entry: {} };
      for (const [label, pre] of [
        ["grainPng1", "/grain.png"],
        ["grainSvg1", GRAIN_SVG],
        ["grainPng2", "/grain.png"],
        ["grainSvg2", GRAIN_SVG],
        ["grainPng3", "/grain.png"],
      ]) {
        entryBisect.entry[label] = await arrive(`e_${label}`, null, grain(pre));
      }
    } else if (process.argv.includes("--fixBisect")) {
      /*
       * Layer data says the frames go to two repainters: the page that is
       * already invisible behind the opaque overlay (its sidebar alone
       * repainted 62 times), and the stage layer (93 paints), which every
       * animated child inside it invalidates. Both fixes are tested here
       * against two plain controls.
       */
      const HIDE_PAGE = `[inert] { visibility: hidden !important; }`;
      const STAGE_LAYER = `[role="dialog"] div.relative.flex-none { will-change: transform; }`;
      const STAGE_ITEMS = `[role="dialog"] h1, [role="dialog"] div.relative.flex-none { will-change: transform; }`;
      entryBisect = { entry: {} };
      for (const [label, pre] of [
        ["base1", null],
        ["pageHidden", CSS(HIDE_PAGE)],
        ["base2", null],
        ["instrumentLayer", CSS(STAGE_LAYER)],
        ["pageHidden+instrument", CSS(HIDE_PAGE + STAGE_LAYER)],
        ["pageHidden+h1", CSS(HIDE_PAGE + STAGE_ITEMS)],
        ["base3", null],
      ]) {
        entryBisect.entry[label] = await arrive(`e_${label}`, null, pre);
      }
    } else {
      entryBisect = { entry: {} };
      for (const [label, setup] of CONDITIONS) {
        entryBisect.entry[label] = await arrive(
          `e_${label}`,
          setup ? `${setup}` : null,
        );
      }
    }
  }

  // Isolate what costs frames inside Focus Mode: pause or hide one suspect at
  // a time, at the same window size, against the same control numbers.
  const pauseClass = (pattern) => session.eval(`(() => {
    const re = new RegExp(${JSON.stringify(pattern)});
    const hits = document.getAnimations({ subtree: true }).filter((a) => re.test(String(a.effect?.target?.className || '')));
    hits.forEach((a) => a.pause());
    return hits.length;
  })()`);
  const hideAurora = () => session.eval(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label^="Focus mode"]');
    const aurora = [...dialog.children[0].children].find((c) => c.querySelector('.drift-a'));
    if (!aurora) return 0;
    aurora.style.visibility = 'hidden';
    return 1;
  })()`);

  if (process.argv.includes("--bisect2")) {
    // Inside Focus Mode, settled: which continuous layer costs the frame?
    const spot = async (label, setup, ms = 800) => {
      if (setup) await session.eval(setup);
      return sample(session, label, ms);
    };
    bisect = {};
    bisect.running = await spot("b_running");
    bisect.cssPaused = await spot("b_cssPaused", "document.getAnimations({ subtree: true }).forEach((a) => a.pause()); 'ok'");
    await session.eval("document.getAnimations({ subtree: true }).forEach((a) => a.play())");
    bisect.particlesHidden = await spot(
      "b_particlesHidden",
      "(() => { const d = document.querySelector('[role=\"dialog\"]'); [...d.querySelectorAll('span')].filter((s) => /float-up/.test(s.className)).forEach((s) => { s.style.display = 'none'; }); return 'ok'; })()",
    );
    bisect.breatheHidden = await spot(
      "b_breatheHidden",
      "(() => { const d = document.querySelector('[role=\"dialog\"]'); [...d.querySelectorAll('div')].filter((s) => /animate-breathe/.test(s.className)).forEach((s) => { s.style.display = 'none'; }); return 'ok'; })()",
    );
    bisect.grainHidden = await spot(
      "b_grainHidden",
      "(() => { const d = document.querySelector('[role=\"dialog\"]'); [...d.querySelectorAll('div')].filter((s) => /(^| )grain( |$)/.test(s.className)).forEach((s) => { s.style.display = 'none'; }); return 'ok'; })()",
    );
    bisect.auroraHidden = await spot(
      "b_auroraHidden",
      "(() => { const d = document.querySelector('[role=\"dialog\"]'); [...d.children].forEach((c) => { if (c.querySelector('.drift-a')) c.style.display = 'none'; }); return 'ok'; })()",
    );
  } else if (BISECT) {
    const paused = { drift: 0, breathe: 0 };
    const entryAll = await sample(session, "entryAll", 2400);
    const idleAll = await sample(session, "idleAll", 1000);
    paused.drift = await pauseClass('drift-[ab]');
    const idleDriftPaused = await sample(session, "idleDriftPaused", 1000);
    const entryDriftPaused = null; // measured in the second pass below
    const hidden = await hideAurora();
    const idleAuroraHidden = await sample(session, "idleAuroraHidden", 1000);
    bisect = { paused, hidden, entryAll, idleAll, idleDriftPaused, idleAuroraHidden, entryDriftPaused };
  } else {
    bisect = null;
  }

  if (ENTRY_BISECT) bisect = entryBisect;

  const entry = TRACE
    ? traceSample
    : PROFILE
      ? profileSample
      : LAYERS
        ? layers.sample
        : ENTRY_BISECT
          ? bisect.entry.base1
          : BISECT
            ? bisect.entryAll
            : await sample(session, "entry", 2600);
  if (BISECT) {
    // Second pass: a clean arrival with the blurred aurora suppressed from the
    // first frame, to test whether the lens scale is re-rastering the blurs.
    await session.eval(`document.querySelector('button[aria-label="Exit focus mode"]')?.click()`);
    await sleep(1200);
    await session.eval(`(() => {
      const btn = [...document.querySelectorAll('main li button')].find((b) => /^Enter focus mode for “Rewrite the quarterly/.test(b.getAttribute('aria-label') || ''));
      btn?.click();
      return !!btn;
    })()`);
    await sleep(120);
    const hiddenSecond = await hideAurora();
    bisect.hiddenSecondPass = hiddenSecond;
    bisect.entryNoBlur = await sample(session, "entryNoBlur", 2400);
  }
  const metricsEntry = await session.send("Performance.getMetrics");
  const idle = await sample(session, "idle", 1200);

  /*
   * The departure drops about ten frames. Two things move at once — the page
   * comes back under a receding shell, and the overlay's own content plays its
   * exit variants while the shell fades out — so the same paired method as the
   * arrival decides which of them costs the frames. Conditions are injected
   * before the exit click and cleared before the next one.
   */
  const EXIT_BISECT = process.argv.includes("--exitBisect");
  let exitBisect = null;
  if (EXIT_BISECT) {
    const CSS_INJECT = (text) => `(() => {
      let s = document.getElementById('perf-css');
      if (!s) { s = document.createElement('style'); s.id = 'perf-css'; document.head.appendChild(s); }
      s.textContent = ${JSON.stringify(text)};
      return 'css';
    })()`;
    const measureExit = async (label, css, probe = null) => {
      await session.eval(
        css
          ? CSS_INJECT(css)
          : `(() => { const s = document.getElementById('perf-css'); if (s) s.textContent = ''; return 'clear'; })()`,
      );
      const located = await session.eval(`(() => {
        const btn = [...document.querySelectorAll('main li button')].find((b) => /^Enter focus mode for “Rewrite the quarterly/.test(b.getAttribute('aria-label') || ''));
        window.__focusBtn = btn || null;
        return !!btn;
      })()`);
      if (located) {
        await realClick(session, "window.__focusBtn");
        await waitFor(session, `!!document.querySelector('button[aria-label="Exit focus mode"]')`);
        await sleep(700);
      }
      /* A condition that matched nothing would read as a negative result, so
       * count what it actually covers while the overlay is up. */
      const matched = probe
        ? await session.eval(`document.querySelectorAll(${JSON.stringify(probe)}).length`)
        : null;
      await session.eval(`window.__perf.phase = ${JSON.stringify(label)}`);
      const from = await session.eval("performance.now()");
      await realClick(session, `document.querySelector('button[aria-label="Exit focus mode"]')`);
      await sleep(1500);
      const data = await session.eval(READ);
      return { opened: located, matched, ...summarise(data, label, from) };
    };

    const SHELL_OFF = `[inert] > div { transform: none !important; }`;
    const DIALOG_OFF = `[role="dialog"] * { transform: none !important; }`;
    /*
     * The first of the exit candidates in "What is left": the two veils and the
     * sweep exist only for the arrival, and by the time the exit runs they are
     * parked off-screen — they are still three full-screen composited layers in
     * the commit that tears the overlay down. This asks what taking them out of
     * the tree costs, without touching the app.
     */
    const ARRIVAL_ONLY = `[role="dialog"] > div.z-10, [role="dialog"] > span.z-\\[12\\]`;
    const ARRIVAL_ONLY_OFF = `${ARRIVAL_ONLY} { display: none !important; }`;
    exitBisect = {};
    for (const [label, css, probe] of [
      ["base1", null, null],
      ["pageNoTransform", SHELL_OFF, null],
      ["base2", null, null],
      ["dialogNoTransform", DIALOG_OFF, null],
      ["both", SHELL_OFF + DIALOG_OFF, null],
      ["base3", null, null],
      ["arrivalLayersOff", ARRIVAL_ONLY_OFF, ARRIVAL_ONLY],
      ["base4", null, null],
    ]) {
      exitBisect[label] = await measureExit(label, css, probe);
    }
  }

  /*
   * Same trace over the departure, to separate two things that both happen on
   * every focus toggle: the page shell re-render, and the overlay's own mount
   * (entry only) / unmount (exit only). If the big synchronous call lives only
   * in the arrival, it is the overlay mount paying for itself, not the shell.
   */
  let traceExit = null;
  if (TRACE) {
    session.events = [];
    await session.send("Tracing.start", {
      categories: "devtools.timeline,benchmark,cc,v8",
      transferMode: "ReportEvents",
    });
    await realClick(session, `document.querySelector('button[aria-label="Exit focus mode"]')`);
    const exitSample = await sample(session, "exitTraced", 1600);
    await session.send("Tracing.end");
    await session.waitForEvent("Tracing.tracingComplete", 20000);
    traceExit = collectTrace(session.events);
    traceExit.worstCall = await resolveWorstCall(session, traceExit.worstCall);
    traceExit.sample = exitSample;
  }

  const exit =
    traceExit?.sample ??
    exitBisect?.base1 ??
    (await (async () => {
      await realClick(session, `document.querySelector('button[aria-label="Exit focus mode"]')`);
      return sample(session, "exit", 1400);
    })());

  /*
   * The second arrival: everything about it is warm — chunks parsed, layers
   * rastered once, shaders compiled, fonts loaded. A first arrival and a repeat
   * arrival are different events, and only reporting the first one makes the
   * app look worse than the twenty-fifth time a user opens it.
   */
  const locatedForSecond = await session.eval(`(() => {
    const btn = [...document.querySelectorAll('main li button')].find((b) => /^Enter focus mode for “Rewrite the quarterly/.test(b.getAttribute('aria-label') || ''));
    window.__focusBtn = btn || null;
    return !!btn;
  })()`);
  const entry2 = locatedForSecond
    ? await (async () => {
        await realClick(session, "window.__focusBtn");
        return sample(session, "entry2", 2600);
      })()
    : null;

  /*
   * Control 2, last on purpose: pausing every Web Animation and playing it
   * again leaves the compositor in a state no user ever creates, and it used to
   * run directly before the arrival it was meant to be a control for.
   */
  if (entry2) {
    await realClick(session, `document.querySelector('button[aria-label="Exit focus mode"]')`);
    await sleep(1200);
  }
  await session.eval("document.getAnimations({ subtree: true }).forEach((a) => a.pause())");
  listPaused = await sample(session, "listPaused", 1200);
  await session.eval("document.getAnimations({ subtree: true }).forEach((a) => a.play())");

  const metric = (list2, name) => list2.metrics.find((m) => m.name === name)?.value ?? null;

  report = {
    note: VISIBLE ? "window on screen" : "window off screen at -32000,-32000",
    controls: { calibration, list, listPaused },
    focus: {
      longTitleTaskCreated: focusButton,
      startedClock,
      clockRunning,
      entry,
      idle,
      exit,
      entry2,
    },
    bisect,
    entryBisect,
    exitBisect,
    trace,
    traceExit,
    profile,
    layers,
    ghostProbe,
    render: {
      /*
       * CDP's Performance metrics are cumulative since the renderer started
       * and durations are in SECONDS. Both facts matter: labelling these as
       * milliseconds once made a 600ms script total look like 0.6ms.
       */
      note: "cumulative since renderer start; durations in seconds",
      layoutCountTotal: round(metric(metricsEntry, "LayoutCount")),
      recalcStyleCountTotal: round(metric(metricsEntry, "RecalcStyleCount")),
      layoutDurationSecTotal: round(metric(metricsEntry, "LayoutDuration")),
      scriptDurationSecTotal: round(metric(metricsEntry, "ScriptDuration")),
      layoutDurationMsTotal: round(metric(metricsEntry, "LayoutDuration") * 1000),
      scriptDurationMsTotal: round(metric(metricsEntry, "ScriptDuration") * 1000),
    },
    overlayRemovedAfterExit: !(await session.eval("!!document.querySelector('[role=\"dialog\"][aria-label^=\"Focus mode\"]')")),
    hidden: await session.eval("document.hidden"),
  };
} catch (error) {
  if (error?.controlsVerdict) refused = { verdict: error.controlsVerdict, ghostProbe };
  else report = { error: String(error), note: VISIBLE ? "window on screen" : "window off screen" };
} finally {
  chrome.kill();
  await sleep(600);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* windows file locks */
  }
}

/*
 * Refuse to record rather than record and hope somebody discards it.
 *
 * A report is only written when the controls are clean; otherwise this prints
 * what failed and exits non-zero, so an invalid run cannot be mistaken for a
 * bad result by a reader or by a later `perf-summary.mjs` invocation.
 */
const note = VISIBLE ? "window on screen" : "window off screen at -32000,-32000";
const verdict = refused?.verdict ?? (report?.error ? null : verdictForReport(report));

if (report?.error) {
  console.error(`\nperf-focus.mjs could not finish: ${report.error}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else if (!verdict.valid) {
  printRetry("perf-focus.mjs", verdict);
  /* `window`, not `note`: the refusal's own note is what explains it, and
   * overwriting it with the window position would leave the file silent about
   * why nothing was recorded. */
  console.log(JSON.stringify(retryReport("perf-focus.mjs", verdict, { window: note, ghostProbe }), null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ...report, valid: true, controlsRule: verdict.rule }, null, 2));
}
