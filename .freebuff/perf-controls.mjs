/*
 * Scratch: when is a perf-focus run allowed to be reported at all?
 *
 * The controls exist so a busy machine cannot be mistaken for a slow app:
 * `calibration` (about:blank), `list` and `listPaused` are phases the app has no
 * business affecting, so if they do not hold 60fps, the machine is the variable
 * — not the change under test. A run with dirty controls is not a result, and
 * three of them median into a number that looks like one.
 *
 * The rule therefore lives here, once, and every harness that records or reports
 * a run applies it: `perf-focus.mjs` refuses to emit a report (`perf-summary.mjs`,
 * `perf-print.mjs` and `phase-table.mjs` refuse to print one they were handed).
 * All of them exit non-zero and print RETRY, so a shell loop can retry and a
 * reader cannot mistake a refused run for a bad result.
 *
 * The rule, as the budget states it: a control holds 60fps when no frame is
 * longer than two vsyncs, and the p95 frame interval is one (16.8ms, with a
 * hair of slack for rounding).
 */

export const CONTROL_P95_MS = 17;
export const CONTROL_MAX_MS = 33;

/** The phases that must be quiet for a run to mean anything. */
export const CONTROL_PHASES = ["calibration", "list", "listPaused"];

/** Human-readable failures for one control phase. */
export function controlPhaseFailures(name, phase) {
  if (!phase || typeof phase.p95Ms !== "number" || typeof phase.over33 !== "number") {
    return [`${name} was not measured`];
  }
  const failures = [];
  if (phase.over33 > 0) {
    failures.push(`${name}: ${phase.over33} frame(s) > ${CONTROL_MAX_MS}ms (max ${Math.round(phase.maxMs)}ms)`);
  }
  if (phase.p95Ms > CONTROL_P95_MS) {
    failures.push(`${name}: p95 ${phase.p95Ms}ms > ${CONTROL_P95_MS}ms`);
  }
  return failures;
}

/** The verdict for a bare `controls` object. */
export function controlsVerdict(controls) {
  const failures = [];
  for (const name of CONTROL_PHASES) {
    /* A control set that stops early (the harness bails the moment it knows)
     * has to say which phases it actually measured. */
    if (controls && !(name in controls)) continue;
    failures.push(...controlPhaseFailures(name, controls?.[name]));
  }
  return {
    valid: failures.length === 0,
    failures: failures.length ? failures : [],
    rule: `every control holds 60fps: no frame > ${CONTROL_MAX_MS}ms and p95 ≤ ${CONTROL_P95_MS}ms`,
  };
}

/**
 * The verdict for a whole report. Always recomputed from the controls rather
 * than trusted, so the reports written before this rule existed are judged by
 * the same standard as new ones; a report that *is* a refusal carries its own
 * failures forward.
 */
export function verdictForReport(report) {
  if (report?.valid === false && report.retry) {
    return {
      valid: false,
      failures: report.failedControls ?? ["refused before any control was measured"],
      rule: report.rule ?? "every control holds 60fps",
    };
  }
  return controlsVerdict(report?.controls);
}

/** What a harness writes instead of numbers it should not stand behind. */
export function retryReport(where, verdict, extra = {}) {
  return {
    valid: false,
    retry: true,
    where,
    rule: verdict.rule,
    failedControls: verdict.failures,
    note: "the controls are not clean, so this is not a measurement — the machine is the variable, not the app.",
    ...extra,
  };
}

/** The loud version, for a terminal rather than a JSON reader. */
export function printRetry(where, verdict, log = console.error) {
  log(`\nREFUSED — ${where}: the controls are not clean, so this run is not a result.`);
  for (const failure of verdict.failures) log(`  - ${failure}`);
  log(`  rule: ${verdict.rule}`);
  log("  RETRY on a quiet machine. Nothing was recorded.\n");
}
