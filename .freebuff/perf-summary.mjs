/*
 * Scratch: median across runs of .freebuff/perf-focus.mjs reports.
 * Usage: node .freebuff/perf-summary.mjs <label> <file...>
 *
 * The budget in docs/motion-budget.md says to run three times and take the
 * median, because one run on one machine varies by ~15%. This is that step,
 * plus the budget check, so a pass/fail does not depend on reading a table.
 *
 * It refuses to print that table from a run whose controls were not clean — the
 * median of dirty runs is a number nobody should read, and the point of the
 * controls is that they are checked before the numbers are, not after.
 */
import { readFileSync } from "node:fs";

import { printRetry, verdictForReport } from "./perf-controls.mjs";

const label = process.argv[2];
const files = process.argv.slice(3);
/* Node warnings can share the file (stderr is captured alongside stdout), so
 * take the JSON object itself rather than assuming a clean file. */
const runs = files.map((f) => {
  const text = readFileSync(f, "utf8");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`${f}: no JSON report found`);
  return JSON.parse(text.slice(start, end + 1));
});

/* Every input, judged before anything is computed from it. */
const refusedRuns = runs
  .map((report, index) => ({ file: files[index], verdict: verdictForReport(report) }))
  .filter((entry) => !entry.verdict.valid);

if (refusedRuns.length) {
  printRetry(`perf-summary.mjs — ${label}`, {
    failures: refusedRuns.flatMap((entry) => entry.verdict.failures.map((failure) => `${entry.file}: ${failure}`)),
    rule: `${refusedRuns[0].verdict.rule} — ${refusedRuns.length} of ${runs.length} input run(s) failed it, so no table is printed`,
  });
  process.exit(1);
}

const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!s.length) return null;
  return Math.round(s[Math.floor((s.length - 1) / 2)] * 10) / 10;
};

const PHASES = ["calibration", "list", "listPaused", "entry", "idle", "exit"];
const numeric = ["fps", "medianMs", "p95Ms", "maxMs", "over33", "over50", "longTasks", "cls"];

/* Budget, verbatim from docs/motion-budget.md. */
const BUDGET = {
  idle: { fps: 60, p95Ms: 17, over33: 0 },
  entry: { p95Ms: 33.4, over33: 15, over50: 0 },
  exit: { p95Ms: 33.4, over33: 15, over50: 0 },
};

const rows = [];
let failures = 0;
for (const phase of PHASES) {
  const samples = runs.map((r) => (phase === "entry" || phase === "idle" || phase === "exit" ? r.focus?.[phase] : r.controls?.[phase]));
  if (samples.some((s) => !s)) continue;
  const row = { phase };
  for (const key of numeric) row[key] = median(samples.map((s) => s[key]));
  const limit = BUDGET[phase];
  const bad = [];
  if (limit) {
    for (const [key, max] of Object.entries(limit)) {
      if (key === "fps") {
        if (row.fps < max - 0.5) bad.push(`fps ${row.fps} < ${max}`);
      } else if (row[key] > max) {
        bad.push(`${key} ${row[key]} > ${max}`);
      }
    }
  }
  row.verdict = limit ? (bad.length ? `FAIL (${bad.join(", ")})` : "pass") : "control only";
  if (bad.length) failures++;
  rows.push(row);
}

console.log(`=== ${label} — median of ${runs.length} runs, controls clean in all of them ===`);
console.log(
  "controls (cal/list/listPaused fps):",
  runs.map((r) => [r.controls.calibration.fps, r.controls.list.fps, r.controls.listPaused?.fps].join("/")).join(" "),
  "| window:",
  runs[0].note,
  "| rule:",
  runs[0].controlsRule ?? "every control holds 60fps (re-checked here)",
);
console.table(rows);
console.log(failures ? `${failures} phase(s) outside budget` : "all phases within budget");
