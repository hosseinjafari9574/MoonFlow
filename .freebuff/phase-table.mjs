/*
 * Scratch: a compact line per run, for comparing sets of perf-focus reports.
 * Usage: node .freebuff/phase-table.mjs <label:file...> [more sets as bare args]
 *
 * The point is the *timing* of the slow frames, not just their count: a cost
 * that lands at the same offset in every run is deterministic (something the
 * app does), and one that wanders is the machine.
 *
 * A run whose controls were not clean gets one word instead of a line of
 * numbers — including runs written before this rule existed, which are judged by
 * it here. Exits non-zero if any input was refused.
 */
import { readFileSync } from "node:fs";

import { printRetry, verdictForReport } from "./perf-controls.mjs";

const load = (file) => {
  const text = readFileSync(file, "utf8");
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
};

const files = process.argv.slice(2).flatMap((arg) => arg.split(",").map((f) => f.trim()));
const refused = [];
for (const file of files) {
  let report;
  try {
    report = load(file);
  } catch (error) {
    console.log(file.padEnd(34), "ERR", error.message);
    refused.push({ file, failures: [`unreadable: ${error.message}`] });
    continue;
  }
  const verdict = verdictForReport(report);
  if (!verdict.valid) {
    console.log(file.replace(".freebuff/", "").padEnd(30), "REFUSED —", verdict.failures.join("; "));
    refused.push({ file, failures: verdict.failures });
    continue;
  }
  const list = report.controls?.list;
  const entry = report.focus?.entry;
  const exit = report.focus?.exit;
  const f = (n, w = 6) => String(Math.round(n ?? 0)).padStart(w);
  console.log(
    file.replace(".freebuff/", "").padEnd(30),
    "list", f(list?.maxMs, 5), "slow@" + JSON.stringify(list?.slowFramesAtMs ?? []),
    "| entry", f(entry?.maxMs, 5), "o50", entry?.over50,
    "slow@" + JSON.stringify(entry?.slowFramesAtMs ?? []),
    "| exit p95", f(exit?.p95Ms, 5), "o50", exit?.over50,
    "slow@" + JSON.stringify(exit?.slowFramesAtMs ?? []),
  );
}

if (refused.length) {
  printRetry("phase-table.mjs", {
    failures: refused.flatMap((entry) => entry.failures.map((failure) => `${entry.file}: ${failure}`)),
    rule: "controls were not clean for these runs, so they are not in the table",
  });
  process.exitCode = 1;
}
