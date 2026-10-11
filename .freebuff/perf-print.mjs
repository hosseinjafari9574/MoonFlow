/* Scratch: pretty-print a .freebuff/perf-focus.mjs report. Usage: node .freebuff/perf-print.mjs <file> [--slow]
 *
 * Prints nothing when the report's controls were not clean: a run that was
 * refused, or an older one that this rule judges dirty, is a retry, not a
 * table. Exits non-zero so a shell loop can act on it. */
import { readFileSync } from "node:fs";

import { printRetry, verdictForReport } from "./perf-controls.mjs";

const file = process.argv[2];
const showSlow = process.argv.includes("--slow");
const r = JSON.parse(readFileSync(file, "utf8"));

if (r.error) {
  console.error(`\nERROR — ${file}: ${r.error}\n`);
  process.exit(1);
}

const verdict = verdictForReport(r);
if (!verdict.valid) {
  printRetry(`perf-print.mjs — ${file}`, verdict);
  process.exit(1);
}

const row = (label, s) => ({
  phase: label,
  fps: s.fps,
  med: s.medianMs,
  p95: s.p95Ms,
  max: s.maxMs,
  ">33": s.over33,
  ">50": s.over50,
  long: s.longTasks,
  cls: s.cls,
});

console.log(
  "note:", r.note,
  "| hidden:", r.hidden,
  "| overlayRemovedAfterExit:", r.overlayRemovedAfterExit,
  "| controls:", r.controlsRule ?? `clean (${verdict.rule})`,
);
console.log("render:", r.render);

const rows = [row("calibration", r.controls.calibration), row("list", r.controls.list)];
if (r.controls.listPaused) rows.push(row("listPaused", r.controls.listPaused));
if (r.focus) {
  for (const phase of ["entry", "idle", "exit", "entry2"]) {
    if (r.focus[phase]) rows.push(row(phase, r.focus[phase]));
  }
}
console.table(rows);

if (r.bisect?.entry) {
  const t = [];
  for (const [k, v] of Object.entries(r.bisect.entry)) {
    t.push({ condition: k, opened: v.opened, fps: v.fps, med: v.medianMs, p95: v.p95Ms, max: v.maxMs, ">33": v.over33, ">50": v.over50 });
  }
  console.table(t);
}

if (r.trace) {
  console.log(
    "=== trace over the entry window (" + r.trace.eventCount + " events): union thread time, ms ===",
  );
  console.table([r.trace.threadTimeMs]);
  console.log("=== trace: JS calls ranked by worst single call ===");
  console.table(r.trace.topJs);
  console.log("=== trace: browser tasks by total time ===");
  console.table(r.trace.byName.slice(0, 14));
  console.log("=== trace: paint/raster cost by DOM node ===");
  console.table(r.trace.paintByNode);
  console.log("TimerFire offsets in window (ms):", JSON.stringify(r.trace.timerFireAtMs));
  if (r.trace.worstCall) {
    console.log("=== worst call ===", JSON.stringify({ durMs: r.trace.worstCall.durMs, url: (r.trace.worstCall.url || "").split("/").pop(), line: r.trace.worstCall.lineNumber }));
  }
  if (r.trace.insideWorstCall?.length) {
    console.log("=== inside the worst call (top 20 by size) ===");
    console.table(r.trace.insideWorstCall.slice(0, 20));
  }
  if (r.trace.overlappingWorstCall?.length) {
    console.log("=== browser tasks overlapping the worst call ===");
    console.table(r.trace.overlappingWorstCall);
  }
}

if (r.profile) {
  console.log(
    `=== CPU profile over the arrival: ${r.profile.sampleCount} samples / ${r.profile.windowMs}ms ===`,
  );
  console.table(
    r.profile.topSelfTime.map((p) => ({
      name: p.name,
      selfMs: p.selfMs,
      samples: p.samples,
      at: `${(p.url || "").split("/").pop()}:${p.line}:${p.column}`,
    })),
  );
  for (const p of r.profile.topSelfTime.filter((p) => p.source)) {
    console.log(`— ${p.name} (${p.selfMs}ms): ${p.source}`);
  }
}

if (r.ghostProbe) {
  console.log("=== warm-pass probe ===");
  console.log(JSON.stringify(r.ghostProbe));
}

if (r.exitBisect) {
  console.log("=== exit bisect ===");
  console.table(
    Object.entries(r.exitBisect).map(([condition, v]) => ({
      condition,
      opened: v.opened,
      fps: v.fps,
      med: v.medianMs,
      p95: v.p95Ms,
      max: v.maxMs,
      ">33": v.over33,
      ">50": v.over50,
    })),
  );
}

if (r.layers) {
  console.log("=== layer repaints over the entry window ===");
  console.table(
    r.layers.rows.map((row) => ({
      layer: row.layerId,
      node: row.node ? r.layers.nodeLabels?.[row.node] ?? `backend#${row.node}` : "—",
      size: row.size,
      paints: row.paints,
      created: row.created,
    })),
  );
  console.log(`(${r.layers.layerCount} layers total | ${r.layers.note})`);
}

if (r.traceExit) {
  console.log("=== trace over the exit window === union thread time, ms ===");
  console.table([r.traceExit.threadTimeMs]);
  console.log(
    "=== exit: worst call ===",
    JSON.stringify({
      durMs: r.traceExit.worstCall?.durMs,
      totalJsMs: r.traceExit.topJs?.[0]?.totalMs,
    }),
  );
  console.table(r.traceExit.topJs.slice(0, 4));
}

if (showSlow && r.focus) {
  for (const phase of ["entry", "idle", "exit"]) {
    const s = r.focus[phase];
    console.log(phase, "first frame at", s.firstFrameAtMs, "ms | slow frames at:", JSON.stringify(s.slowFramesAtMs));
  }
}
