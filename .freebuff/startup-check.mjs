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
 * Usage: node .freebuff/startup-check.mjs [loads] [--trace] [--profile]   (default 4 loads)
 *
 * `--trace` adds one traced load after the measured ones and prints what the
 * worst frame in the list's window was made of — tasks by kind, by name, and by
 * the DOM node that paid for the paint. It never reports numbers for the traced
 * load, because tracing costs frames.
 *
 * `--profile` adds a CPU-profiled load and ranks self time *inside the list's
 * first-400ms window*, with each hot minified frame resolved back to the served
 * chunk text. Also attribution only.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { controlsVerdict, printRetry, retryReport } from "./perf-controls.mjs";
import {
  collectTrace,
  resolveNodes,
  resolveWorstCall,
  summarizeProfile,
} from "./perf-trace.mjs";

const PORT = 9353;
const APP = "http://localhost:3100/";
const ORIGIN = "http://localhost:3100";
const LOADS = Number(process.argv[2] ?? 4);
/*
 * --trace adds one traced load at the very end, for attribution only. Tracing
 * costs frames, so its render is never folded into the measured loads: what it
 * answers is which tasks a frame in that window is *made of*.
 */
const TRACE = process.argv.includes("--trace");
/* --profile adds a CPU-profiled load of its own, for the same reason. */
const PROFILE = process.argv.includes("--profile");

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
  /*
   * A trace runs on Chrome's clock; the frames below are in the page's. A
   * console.timeStamp lands in the trace as a TimeStamp event, and the page
   * time it was emitted at is kept here, so the two clocks are aligned by
   * measurement instead of assumed to agree.
   */
  window.__su.probeT0 = Math.round(performance.now() * 1000) / 1000;
  try { console.timeStamp("su-t0"); } catch (error) { void error; }
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
  /*
   * Long-animation-frame entries: the browser's own per-frame attribution —
   * which scripts ran, where they live, and how much forced style/layout they
   * caused. Only frames at or above 50ms are reported, so this catches the
   * worst ones and --trace covers the rest.
   */
  window.__su.loaf = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__su.loaf.push({
          at: Math.round(e.startTime),
          dur: Math.round(e.duration * 10) / 10,
          blocking: Math.round((e.blockingDuration ?? 0) * 10) / 10,
          renderStart: e.renderStart == null ? null : Math.round(e.renderStart * 10) / 10,
          layoutStart: e.styleAndLayoutStart == null ? null : Math.round(e.styleAndLayoutStart * 10) / 10,
          styleAndLayout:
            Math.round(
              ((e.startTime + e.duration) -
                (e.styleAndLayoutStart ?? e.renderStart ?? e.startTime + e.duration)) * 10,
            ) / 10,
          render:
            e.renderStart == null
              ? null
              : Math.round(
                  ((e.styleAndLayoutStart ?? e.startTime + e.duration) - e.renderStart) * 10,
                ) / 10,
          scriptMs:
            Math.round((e.scripts ?? []).reduce((a, s) => a + s.duration, 0) * 10) / 10,
          scripts: (e.scripts ?? []).map((s) => ({
            dur: Math.round(s.duration * 10) / 10,
            forced: Math.round((s.forcedStyleAndLayoutDuration ?? 0) * 10) / 10,
            invoker: s.invoker,
            kind: s.invokerType,
            fn: s.sourceFunctionName,
            url: s.sourceURL,
            pos: s.sourceCharPosition,
          })),
        });
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch (error) {
    void error;
  }

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

/* ------------------------------------------------------------------ trace --- */

/*
 * Which tasks a frame is made of.
 *
 * A frame record is the interval since the previous rAF callback, so a frame
 * reporting 50ms *ending* at 113ms stalled between 63ms and 113ms — that is the
 * window whose work gets listed, everything overlapping it included. Names are
 * grouped the way perf-trace groups them, so "paint" here means what "paint"
 * means in every other report on this app.
 */
const KINDS = [
  [/^(FunctionCall|v8\.callFunction|EvaluateScript|TimerFire|FireAnimationFrame|EventDispatch|RunMicrotasks|CompileScript|v8\.compile)$/, "js"],
  [/^(UpdateLayoutTree|RecalcStyle|StyleRecalc|ParseAuthorStyleSheet)$/, "style"],
  [/^(Layout|RunStyleAndLayoutLifecyclePhases|LocalFrameView::Layout)$/, "layout"],
  [/^(Paint|PaintImage|PrePaint|Layerize|UpdateLayerTree|LocalFrameView::RunPaintLifecyclePhase)$/, "paint"],
  [/^(RasterTask|RasterizerTaskImpl::RunOnWorkerThread|GpuRasterBuffer::Playback|ImageDecodeTask)$/, "raster"],
  [/^(ProxyMain::BeginMainFrame|ProxyImpl::ScheduledActionDraw|MainFrame\.Draw|Commit|LayerTreeHostImpl::CommitComplete|ProxyImpl::ReadyToCommit|ActivateLayerTree)$/, "composite"],
];
const kindOf = (name) => KINDS.find(([re]) => re.test(name))?.[1] ?? "other";

/** Trace events overlapping a page-time window, in page time. */
function tasksIn(events, anchorTs, fromMs, toMs) {
  const out = [];
  for (const e of events) {
    if (e.method !== "Tracing.dataCollected") continue;
    for (const ev of e.params?.value ?? []) {
      if (ev.ph !== "X" || !(ev.dur > 0)) continue;
      const atMs = (ev.ts - anchorTs) / 1000;
      const durMs = ev.dur / 1000;
      if (atMs + durMs < fromMs || atMs > toMs) continue;
      out.push({
        atMs: Math.round(atMs * 10) / 10,
        durMs: Math.round(durMs * 10) / 10,
        kind: kindOf(ev.name),
        name: ev.name,
        detail:
          ev.args?.data?.functionName ||
          ev.args?.data?.url ||
          ev.args?.data?.type ||
          ev.args?.data?.elementName ||
          "",
        nodeId: ev.args?.data?.nodeId ?? null,
        raw: ev.args,
      });
    }
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

/** Union of the intervals per kind: nesting inside one kind is not double-counted. */
function unionByKind(tasks) {
  const perKind = new Map();
  for (const t of tasks) {
    const spans = perKind.get(t.kind) ?? [];
    spans.push([t.atMs, t.atMs + t.durMs]);
    perKind.set(t.kind, spans);
  }
  const out = {};
  for (const [kind, spans] of perKind) {
    spans.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let cur = null;
    for (const span of spans) {
      if (!cur) cur = [...span];
      else if (span[0] <= cur[1]) cur[1] = Math.max(cur[1], span[1]);
      else {
        total += cur[1] - cur[0];
        cur = [...span];
      }
    }
    if (cur) total += cur[1] - cur[0];
    out[kind] = Math.round(total * 10) / 10;
  }
  return out;
}

/**
 * One attribution load: the trace (which frame, and the clock anchor) and, with
 * --profile, a CPU profile of the same load.
 *
 * Both clocks are aligned by measurement rather than assumption. The probe
 * emits a console.timeStamp at document start, which lands in the trace as a
 * TimeStamp event; the profile's own startTime is on the same monotonic clock
 * as that event, so a sample's page time is one subtraction away.
 */
async function attributionOnce(session) {
  if (PROFILE) {
    await session.send("Profiler.enable");
    await session.send("Profiler.setSamplingInterval", { interval: 100 });
  }
  await session.send("Tracing.start", {
    categories: "devtools.timeline,benchmark,cc,v8",
    transferMode: "ReportEvents",
  });
  if (PROFILE) await session.send("Profiler.start");
  await session.send("Storage.clearDataForOrigin", { origin: ORIGIN, storageTypes: "local_storage" });
  await session.send("Page.navigate", { url: APP });
  await sleep(2200);
  const prof = PROFILE ? (await session.send("Profiler.stop")).profile : null;
  await session.send("Tracing.end");
  await session.waitForEvent("Tracing.tracingComplete", 20000);
  const su = await session.eval("window.__su");
  const events = session.events;
  session.events = [];

  let anchor = null;
  for (const e of events) {
    if (e.method !== "Tracing.dataCollected") continue;
    for (const ev of e.params?.value ?? []) {
      if (ev.name === "TimeStamp" && /su-t0/.test(JSON.stringify(ev.args ?? {}))) anchor = ev.ts;
    }
  }
  if (anchor === null) {
    console.log("\n=== attribution load: no su-t0 anchor in the trace, skipped ===");
    return null;
  }

  const listAt = su.listAt ?? 0;
  const frames = su.frames.filter((f) => f.at >= listAt - 60 && f.at <= listAt + 400);
  const worst = frames.reduce((a, f) => (!a || f.dur > a.dur ? f : a), null);
  if (!worst) {
    console.log("\n=== attribution load: no frame records in the list's window ===");
    return null;
  }
  const stall = [Math.round((worst.at - worst.dur) * 10) / 10, worst.at];

  console.log("\n=== attribution load — its own numbers are never in the medians ===");
  console.log(
    "load", su.load + "ms",
    "| list(main) @" + listAt + "ms",
    "| worst frame", worst.dur + "ms", "ending @" + worst.at + "ms",
    "| stall window", stall[0] + "–" + stall[1] + "ms",
  );

  let traceReport = null;
  if (TRACE) {
    const overlap = tasksIn(events, anchor, stall[0], stall[1]);
    const byKind = unionByKind(overlap);
    const ranked = [...overlap].sort((a, b) => b.durMs - a.durMs);
    const paintNodes = [...new Set(ranked.filter((t) => t.nodeId).map((t) => t.nodeId))];
    try {
      await session.send("DOM.getDocument", { depth: 1 });
    } catch (error) {
      void error;
    }
    const labels = await resolveNodes(session, paintNodes);
    const withNodes = ranked.slice(0, 24).map((t) => ({
      atMs: t.atMs,
      durMs: t.durMs,
      kind: t.kind,
      name: t.name.replace(/^(LocalFrameView::|ProxyImpl::|ProxyMain::|RasterizerTaskImpl::)/, ""),
      detail: t.detail,
      node: t.nodeId ? labels.get(t.nodeId) ?? "#" + t.nodeId : "",
    }));

    const whole = collectTrace(events);
    console.log("union inside the stall window (ms):", JSON.stringify(byKind));
    console.log("union over the whole load (ms):", JSON.stringify(whole.threadTimeMs));
    console.table(withNodes);
    console.log("=== biggest browser tasks over the whole load ===");
    console.table(
      whole.byName
        .slice(0, 12)
        .map((r) => ({ name: r.name, kind: kindOf(r.name), count: r.count, totalMs: r.totalMs, maxMs: r.maxMs })),
    );
    if (whole.paintByNode.length) {
      const nodeLabels = await resolveNodes(session, whole.paintByNode.map((r) => r.nodeId));
      console.log("=== paint/raster cost by node over the whole load ===");
      console.table(
        whole.paintByNode.map((r) => ({
          node: nodeLabels.get(r.nodeId) ?? "#" + r.nodeId,
          name: r.name,
          count: r.count,
          totalMs: r.totalMs,
          maxMs: r.maxMs,
        })),
      );
    }
    if (whole.worstCall) {
      console.log(
        "=== worst JS call over the load:", whole.worstCall.durMs + "ms",
        (whole.worstCall.url || "").split("/").pop() + ":" + whole.worstCall.lineNumber,
        whole.worstCall.functionName || "(anonymous)",
      );
      const named = await resolveWorstCall(session, whole.worstCall);
      if (named?.sourceLine) console.log("     ", named.sourceLine.slice(0, 200));
    }
    console.log("=== JS calls by worst single call over the load ===");
    console.table(whole.topJs);
    console.log("=== inside the worst JS call ===");
    console.table(whole.insideWorstCall.slice(0, 14));
    traceReport = { byKind, worst, stall, top: withNodes.slice(0, 4) };
  }

  let profileReport = null;
  if (prof) {
    /*
     * Over the whole load, not a window. Cutting a profile needs a clock that
     * really is the page's: the trace has one (the probe's own timeStamp, seen
     * as an event), and a profiler's startTime does not — a first attempt that
     * assumed otherwise put one (idle) sample with a 272.9ms delta in the
     * window, which is a window landing in a gap, not a measurement.
     *
     * The load is short and its only work is the start-up this is about, so the
     * self-time ranking over it names the same functions either way.
     */
    profileReport = await summarizeProfile(prof);
    console.log(
      "=== CPU profile over the load (" + profileReport.sampleCount + " samples / " + profileReport.windowMs + "ms) ===",
    );
    console.table(
      profileReport.topSelfTime.map((p) => ({
        name: p.name,
        selfMs: p.selfMs,
        samples: p.samples,
        at: (p.url || "").split("/").pop() + ":" + p.line,
      })),
    );
    for (const p of profileReport.topSelfTime.filter((p) => p.source)) {
      console.log("— " + p.name + " (" + p.selfMs + "ms): " + p.source.slice(0, 200));
    }
  }

  return { listAt, load: su.load, worst, stall, traceReport, profileReport };
}

/**
 * What the frames in the list's window were made of, summed across the loads.
 *
 * Grouping by (function, position) rather than printing one load's list is what
 * makes this a measurement rather than an anecdote: a cost that appears in
 * every load adds up, and a one-off does not. The source slice is the repo's
 * usual way of naming minified code — the served chunk at that position.
 */
function frameAttribution(loads) {
  const byScript = new Map();
  const frames = [];
  for (const load of loads) {
    for (const e of load.loaf ?? []) {
      if (e.at < load.window[0] || e.at > load.window[1]) continue;
      frames.push({ load: load.listAt, ...e });
      for (const s of e.scripts) {
        const key = (s.fn || "(anonymous)") + "|" + (s.url || "") + "|" + s.pos;
        const row = byScript.get(key) ?? {
          fn: s.fn || "(anonymous)",
          url: s.url || "",
          pos: s.pos,
          invoker: s.invoker,
          kind: s.kind,
          totalMs: 0,
          forcedMs: 0,
          loads: 0,
          worstMs: 0,
        };
        row.totalMs += s.dur;
        row.forcedMs += s.forced;
        row.loads += 1;
        row.worstMs = Math.max(row.worstMs, s.dur);
        byScript.set(key, row);
      }
    }
  }
  const rows = [...byScript.values()].sort((a, b) => b.totalMs - a.totalMs);
  return { frames, rows };
}

/** The served chunk text around a character position, for naming a frame. */
async function sourceAt(url, pos, width = 200) {
  if (!url) return "";
  try {
    const text = await (await fetch(url)).text();
    const start = Math.max(0, pos - 60);
    return text.slice(start, start + width).replace(/\s+/g, " ");
  } catch (error) {
    return "<fetch failed: " + error + ">";
  }
}

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
let attributed = null;
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
      loads.push({
        ...r,
        windowMax: Math.max(0, ...window_.map((f) => f.dur)),
        windowOver33: window_.filter((f) => f.dur > 33).length,
        loaf: r.loaf,
        window: [Math.round((r.listAt ?? 0) - 60), Math.round((r.listAt ?? 0) + 400)],
      });
      const loafWindow = r.loaf.filter((e) => e.at >= (r.listAt ?? 0) - 60 && e.at <= (r.listAt ?? 0) + 400);
      const loafWorst = loafWindow.reduce((a, e) => (!a || e.dur > a.dur ? e : a), null);
      console.log(
        `load ${i}`,
        `load ${String(r.load).padStart(4)}ms`,
        `list(main) @${String(r.listAt).padStart(4)}ms`,
        `| ghost ${ghost.length ? ghost.map((g) => `${g.state}@${g.at}ms`).join(",") : "never mounted"}`,
        `| list first 400ms: max ${String(Math.round(loads[loads.length - 1].windowMax)).padStart(4)}ms over33 ${loads[loads.length - 1].windowOver33}`,
        `| long tasks ${r.long.filter((e) => e.start < 1500).length}`,
        loafWorst ? `| worst frame attributed: ${loafWorst.dur}ms, ${loafWorst.scripts.length} script(s)` : "| worst frame under the 50ms attribution threshold",
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

    /*
     * Attribution last of all: after the measured loads and after the control
     * that decides whether they count, so a traced load — and the tracing
     * itself — cannot be what dirtied the control this run is judged by.
     */
    if ((TRACE || PROFILE) && !refusal) attributed = await attributionOnce(session);
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
  if (attributed) {
    console.log(
      "\nattribution load: worst frame", attributed.worst.dur + "ms @", attributed.worst.at + "ms",
      "| stall window", attributed.stall[0] + "–" + attributed.stall[1] + "ms",
    );
    if (attributed.traceReport) {
      console.log("  union per kind (ms):", JSON.stringify(attributed.traceReport.byKind));
      console.log("  biggest task in that window:", JSON.stringify(attributed.traceReport.top[0] ?? null));
    }
    if (attributed.profileReport) {
      console.log(
        "  heaviest functions over the load:",
        JSON.stringify(attributed.profileReport.topSelfTime.slice(0, 5).map((p) => [p.name, p.selfMs])),
      );
    }
  }
  const attribution = frameAttribution(loads);
  if (attribution.frames.length) {
    console.log(
      "\n=== the long frames in the list's window, by the browser's own accounting ===",
    );
    console.table(
      attribution.frames.map((f) => ({
        listAt: f.load,
        atMs: f.at,
        frameMs: f.dur,
        scriptMs: f.scriptMs,
        renderMs: f.render,
        styleLayoutMs: f.styleAndLayout,
        blockingMs: f.blocking,
        scripts: f.scripts.length,
      })),
    );
    console.log("=== what those frames ran, summed across loads ===");
    console.table(
      attribution.rows.slice(0, 12).map((r) => ({
        fn: r.fn,
        at: (r.url || "").split("/").pop().slice(0, 22) + ":" + r.pos,
        totalMs: Math.round(r.totalMs * 10) / 10,
        worstMs: Math.round(r.worstMs * 10) / 10,
        forcedStyleLayoutMs: Math.round(r.forcedMs * 10) / 10,
        inLoads: r.loads,
        invokedBy: r.kind,
        invoker: r.invoker,
      })),
    );
    for (const row of attribution.rows.slice(0, 4)) {
      const source = await sourceAt(row.url, row.pos);
      console.log("— " + row.fn + " (" + Math.round(row.totalMs * 10) / 10 + "ms total, " + (row.url || "").split("/").pop() + ":" + row.pos + ")");
      if (source) console.log("    " + source.slice(0, 220));
    }
  } else {
    console.log(
      "\nno long-animation-frame entries in the list's window: every frame there came in under the 50ms attribution threshold",
    );
  }
  const ghosted = loads.filter((l) => l.ghost.length).length;
  console.log("loads that mounted a hidden pre-warm:", ghosted, ghosted === 0 ? "(clean — nothing invisible is mounted)" : "(a hidden tree is being mounted at start-up)");
}
