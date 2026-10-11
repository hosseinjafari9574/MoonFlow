/*
 * Phase hand-off end-to-end test — no dependencies, drives real Chrome.
 *
 * The claim under test: when a session ends the *state* changes on its own
 * (mode, session count, phase event), but the clock never starts itself — the
 * next phase waits for the user's click. Covered here:
 *
 *   1  a focus session ending live, in front of the tab
 *   2  a short break ending live
 *   3  the fourth session arming the long break
 *   4  Start from the armed state actually runs, and persists
 *   5  Skip arms the next phase instead of starting it
 *   6  Focus Mode reads "Resume" for a paused clock, "Start" for an armed one,
 *      and opening it starts nothing
 *   7  a running session survives a reload untouched
 *   8  completing a task advances the overlay without starting the clock
 *   9  the task row's explicit start button still runs a session
 *
 * Every case writes real state through `localStorage` (the app's own key) to a
 * freshly loaded page, then observes the DOM and the persisted payload, so the
 * assertions cover the store *and* what the user is shown.
 *
 * Usage: node .freebuff/e2e-timer.mjs
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9344;
const APP = "http://localhost:3100/";
const TIMER_KEY = "cadence:timer:v1";
const TODOS_KEY = "cadence:todos:v1";

const CHROME_CANDIDATES = [
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const DURATIONS = { focus: 25 * 60_000, short: 5 * 60_000, long: 15 * 60_000 };
const CARD = 'section[aria-label="Pomodoro timer"]';
const OVERLAY = '[role="dialog"]:not([aria-hidden="true"])';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("no Chrome/Edge binary found");
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.problems = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === "Runtime.exceptionThrown") {
        this.problems.push(
          msg.params?.exceptionDetails?.exception?.description ??
            msg.params?.exceptionDetails?.text ??
            "uncaught exception",
        );
        return;
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
        this.problems.push(
          (msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" "),
        );
        return;
      }
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
      throw new Error(`${detail} | in: ${expression.replace(/\s+/g, " ").slice(0, 140)}`);
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

/* ---------------------------------------------------------------- reading -- */

/*
 * What the user can see, and what the app saved. `dialog` excludes the ghost
 * pre-warm, which is also a `[role="dialog"]` but carries `aria-hidden`.
 */
const READ = `(() => {
  const text = (el) => (el ? el.textContent.replace(/\\s+/g, " ").trim() : null);
  const card = document.querySelector(${JSON.stringify(CARD)});
  const primary = card ? card.querySelector('button[aria-label$="timer"]') : null;
  const dialog = document.querySelector(${JSON.stringify(OVERLAY)});
  const dwell = dialog ? dialog.querySelector('h1') : null;
  /* The status line, not the header counter: "Session 2 of 4" is also a <p>. */
  const footer = card
    ? [...card.querySelectorAll('p')].map(text).find((t) => /^(press start|(session|block) ends)/i.test(t || '')) ?? null
    : null;
  let saved = null;
  try {
    const payload = JSON.parse(localStorage.getItem(${JSON.stringify(TIMER_KEY)}));
    const s = payload && payload.state;
    if (s) saved = { preset: s.preset, mode: s.mode, running: s.running, endsAt: s.endsAt, remainingMs: s.remainingMs, sessions: s.sessions, taskId: s.taskId };
  } catch { /* unreadable payload is reported as null */ }
  return {
    heading: text(card ? card.querySelector('h2') : null),
    clock: text(card ? card.querySelector('[role="timer"]') : null),
    button: primary ? primary.getAttribute('aria-label') : null,
    buttonText: text(primary),
    footer,
    dialogTask: text(dwell),
    dialogLabel: dialog ? (dialog.querySelector('button[aria-label$="timer"]')?.getAttribute('aria-label') ?? null) : null,
    dialogText: dialog ? text(dialog.querySelector('button[aria-label$="timer"]')) : null,
    saved,
  };
})()`;

const read = (session) => session.eval(READ);

/*
 * What the app banked, from the todos payload. Totals rather than today's row,
 * so the assertions do not depend on the harness and the page agreeing about
 * which local day it is.
 */
const READ_TODOS = `(() => {
  try {
    const s = JSON.parse(localStorage.getItem(${JSON.stringify(TODOS_KEY)})).state;
    const totals = Object.values(s.activity || {}).reduce(
      (acc, day) => ({
        pomodoros: acc.pomodoros + (day.pomodoros || 0),
        focusMinutes: acc.focusMinutes + (day.focusMinutes || 0),
      }),
      { pomodoros: 0, focusMinutes: 0 },
    );
    return { totals, tasks: (s.tasks || []).map((t) => ({ id: t.id, pomodoros: t.pomodoros })) };
  } catch (error) {
    return { error: String(error) };
  }
})()`;

const readTodos = (session) => session.eval(READ_TODOS);

const seconds = (clock) => {
  if (!clock) return null;
  const [m, s] = clock.split(":").map(Number);
  return Number.isFinite(m) && Number.isFinite(s) ? m * 60 + s : null;
};

async function waitFor(session, expression, label, timeout = 15000) {
  const started = Date.now();
  for (;;) {
    if (await session.eval(expression)) return;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(120);
  }
}

/* --------------------------------------------------------------- driving --- */

async function click(session, selector) {
  const box = await session.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!box) throw new Error(`no element to click: ${selector}`);
  const base = { x: box.x, y: box.y, button: "left", clickCount: 1 };
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
}

const timerPayload = ({
  mode = "focus",
  running = true,
  endsAt = null,
  remainingMs,
  sessions = 0,
  preset = "classic",
  taskId = null,
  /* Focus minutes already banked before the page was frozen. */
  flushedMs = 0,
}) => ({
  state: {
    preset,
    mode,
    running,
    endsAt,
    remainingMs: remainingMs ?? DURATIONS[mode],
    sessions,
    flushedMs,
    taskId,
  },
  version: 1,
});

const todosPayload = (titles) => ({
  state: {
    tasks: titles.map((title, index) => ({
      id: `e2e-${index}`,
      title,
      completed: false,
      priority: "medium",
      tags: [],
      createdAt: Date.now() - index * 1000,
      completedAt: null,
      pomodoros: 0,
    })),
    activity: {},
    settings: { soundEnabled: false },
  },
  version: 1,
});

/**
 * Park the app, pause anything running (a live clock rewrites storage every
 * 200ms and would clobber the seed), write the seed, then load it for real.
 */
async function load(session, timer, todos = null) {
  await session.send("Page.navigate", { url: "about:blank" });
  await session.send("Page.navigate", { url: APP });
  await waitFor(session, `!!document.querySelector(${JSON.stringify(CARD)})`, "the pomodoro card");
  await session.eval(`(() => {
    const p = document.querySelector(${JSON.stringify(CARD)} + ' button[aria-label="Pause timer"]');
    if (p) p.click();
    return true;
  })()`);
  await sleep(250);
  await session.eval(`(() => {
    ${todos ? `localStorage.setItem(${JSON.stringify(TODOS_KEY)}, ${JSON.stringify(JSON.stringify(todos))});` : ""}
    localStorage.setItem(${JSON.stringify(TIMER_KEY)}, ${JSON.stringify(JSON.stringify(timer))});
    return true;
  })()`);
  await session.send("Page.navigate", { url: APP });
  await waitFor(session, `!!document.querySelector(${JSON.stringify(CARD)})`, "the card after reload");
  await sleep(700);
}

/* --------------------------------------------------------------- results --- */

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail });
}

async function frozen(session, label) {
  const before = seconds((await read(session)).clock);
  await sleep(1600);
  const after = seconds((await read(session)).clock);
  return { before, after, label };
}

/* ------------------------------------------------------------------ main --- */

const profile = mkdtempSync(join(tmpdir(), "moonflow-e2e-"));
const chrome = spawn(findChrome(), [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-sync",
  "--window-size=1440,900",
  "--window-position=-32000,-32000",
  "about:blank",
]);
chrome.stderr.on("data", () => {});

try {
  const session = await connect();
  await session.send("Page.enable");
  await session.send("Runtime.enable");

  /* 1 — a focus session ends in front of the user ------------------------- */
  await load(
    session,
    timerPayload({ mode: "focus", running: true, endsAt: Date.now() + 12_000, remainingMs: 12_000 }),
  );
  const live = await read(session);
  check(
    "1a a running focus session is restored mid-flight",
    live.button === "Pause timer" &&
      (seconds(live.clock) ?? 0) > 0 &&
      (seconds(live.clock) ?? 0) <= 12 &&
      live.saved?.running === true,
    JSON.stringify({ clock: live.clock, button: live.button, savedRunning: live.saved?.running }),
  );

  await waitFor(
    session,
    `document.querySelector(${JSON.stringify(CARD)} + ' h2').textContent.trim() === 'Short break'`,
    "the focus session to hand off to the break",
    20000,
  );
  await sleep(600);
  const armed = await read(session);
  check(
    "1b the break arms itself: mode, clock and copy all change with no click",
    armed.heading === "Short break" &&
      armed.clock === "5:00" &&
      armed.button === "Start timer" &&
      armed.buttonText === "Start" &&
      armed.footer === "press start when you're ready",
    JSON.stringify({ heading: armed.heading, clock: armed.clock, button: armed.buttonText, footer: armed.footer }),
  );
  check(
    "1c the armed break is not running, in the DOM or in storage",
    armed.saved?.mode === "short" &&
      armed.saved?.running === false &&
      armed.saved?.endsAt === null &&
      armed.saved?.remainingMs === DURATIONS.short &&
      armed.saved?.sessions === 1,
    JSON.stringify(armed.saved),
  );
  const stillArmed = await frozen(session);
  check(
    "1d the armed clock does not tick while the user is away",
    stillArmed.before === stillArmed.after && stillArmed.before === 300,
    `${stillArmed.before}s → ${stillArmed.after}s over 1.6s`,
  );

  /* 4 — and the user's click does start it -------------------------------- */
  await click(session, `${CARD} button[aria-label="Start timer"]`);
  await sleep(1600);
  const started = await read(session);
  check(
    "4a clicking Start runs the break",
    started.button === "Pause timer" &&
      seconds(started.clock) < 300 &&
      started.saved?.running === true &&
      (started.saved?.endsAt ?? 0) > Date.now(),
    JSON.stringify({ clock: started.clock, button: started.button, saved: started.saved }),
  );

  /* 2 — a break ends, the focus session arms ------------------------------ */
  await load(
    session,
    timerPayload({ mode: "short", running: true, endsAt: Date.now() + 2500, sessions: 1 }),
  );
  await waitFor(
    session,
    `document.querySelector(${JSON.stringify(CARD)} + ' h2').textContent.trim() === 'Focus'`,
    "the break to hand off to focus",
    12000,
  );
  await sleep(600);
  const back = await read(session);
  const backFrozen = await frozen(session);
  check(
    "2 the next focus session arms, paused, and keeps the cycle count",
    back.heading === "Focus" &&
      back.clock === "25:00" &&
      back.button === "Start timer" &&
      backFrozen.before === backFrozen.after &&
      back.saved?.mode === "focus" &&
      back.saved?.running === false &&
      back.saved?.endsAt === null &&
      back.saved?.sessions === 1,
    JSON.stringify({ heading: back.heading, clock: back.clock, saved: back.saved, frozen: [backFrozen.before, backFrozen.after] }),
  );

  /* 3 — the fourth session arms the long break ---------------------------- */
  await load(
    session,
    timerPayload({ mode: "focus", running: true, endsAt: Date.now() + 2500, sessions: 3 }),
  );
  await waitFor(
    session,
    `document.querySelector(${JSON.stringify(CARD)} + ' h2').textContent.trim() === 'Long break'`,
    "the fourth session to hand off to the long break",
    12000,
  );
  await sleep(600);
  const long = await read(session);
  check(
    "3 the long break arms after the fourth session, still paused",
    long.heading === "Long break" &&
      long.clock === "15:00" &&
      long.button === "Start timer" &&
      long.saved?.running === false &&
      long.saved?.sessions === 4,
    JSON.stringify({ heading: long.heading, clock: long.clock, saved: long.saved }),
  );

  /* 5 — skip arms rather than starts -------------------------------------- */
  await load(session, timerPayload({ mode: "focus", running: false, remainingMs: DURATIONS.focus }));
  const beforeSkip = await read(session);
  await click(session, `${CARD} button[aria-label="Skip to next session"]`);
  await sleep(500);
  const skipped = await read(session);
  check(
    "5a Skip moves to the break without starting it",
    beforeSkip.button === "Start timer" &&
      skipped.heading === "Short break" &&
      skipped.clock === "5:00" &&
      skipped.button === "Start timer" &&
      skipped.saved?.running === false &&
      skipped.saved?.endsAt === null,
    JSON.stringify({ from: beforeSkip.heading, to: skipped.heading, clock: skipped.clock, saved: skipped.saved }),
  );

  /* 6 — Focus Mode's button says what the clock actually is --------------- */
  const todos = todosPayload(["E2E task"]);
  await load(
    session,
    timerPayload({ mode: "focus", running: false, remainingMs: 600_000, taskId: "e2e-0" }),
    todos,
  );
  const beforeOpen = await read(session);
  await click(session, `button[aria-label="Enter focus mode for “E2E task”"]`);
  await waitFor(session, `!!document.querySelector(${JSON.stringify(OVERLAY)})`, "focus mode to open");
  await sleep(500);
  const opened = await read(session);
  /*
   * Opening the overlay links the task and nothing else. If it ever starts the
   * clock again, stop it so later checks stay meaningful — but `opened' has
   * already recorded the failure below.
   */
  if (opened.saved?.running) {
    await click(session, `${OVERLAY} button[aria-label="Pause timer"]`);
    await sleep(400);
  }
  const pausedDwell = await read(session);
  const pausedFreeze = await frozen(session);
  check(
    "6a a half-spent, paused clock reads \"Resume\", and opening the overlay starts nothing",
    opened.saved?.running === false &&
      pausedDwell.dialogLabel === "Resume timer" &&
      pausedDwell.dialogText === "Resume" &&
      pausedDwell.saved?.running === false &&
      pausedFreeze.before === pausedFreeze.after,
    JSON.stringify({
      beforeOpen: { button: beforeOpen.button, running: beforeOpen.saved?.running },
      opened: { label: opened.dialogLabel, running: opened.saved?.running },
      settled: { label: pausedDwell.dialogLabel, text: pausedDwell.dialogText, running: pausedDwell.saved?.running },
      clock: [pausedFreeze.before, pausedFreeze.after],
    }),
  );
  await click(session, `${OVERLAY} button[aria-label="Exit focus mode"]`);
  await sleep(500);

  await load(
    session,
    timerPayload({ mode: "short", running: false, remainingMs: DURATIONS.short, sessions: 1, taskId: "e2e-0" }),
    todos,
  );
  await click(session, `button[aria-label="Enter focus mode for “E2E task”"]`);
  await waitFor(session, `!!document.querySelector(${JSON.stringify(OVERLAY)})`, "focus mode to reopen");
  await sleep(500);
  const armedDwell = await read(session);
  check(
    "6b an armed, untouched clock reads \"Start\" in Focus Mode",
    armedDwell.dialogLabel === "Start timer" && armedDwell.dialogText === "Start",
    JSON.stringify({ label: armedDwell.dialogLabel, text: armedDwell.dialogText }),
  );
  await click(session, `${OVERLAY} button[aria-label="Start timer"]`);
  await sleep(1400);
  const dwellRunning = await read(session);
  check(
    "6c Start inside Focus Mode runs the armed break",
    dwellRunning.dialogLabel === "Pause timer" &&
      seconds(dwellRunning.clock) < 300 &&
      dwellRunning.saved?.running === true,
    JSON.stringify({ label: dwellRunning.dialogLabel, clock: dwellRunning.clock }),
  );

  /* 8 — the automatic advance is a state change, not a start -------------- */
  await load(
    session,
    timerPayload({
      mode: "focus",
      running: false,
      remainingMs: DURATIONS.focus,
      taskId: "e2e-0",
    }),
    todosPayload(["First task", "Second task"]),
  );
  await click(session, `button[aria-label="Enter focus mode for “First task”"]`);
  await waitFor(session, `!!document.querySelector(${JSON.stringify(OVERLAY)})`, "focus mode for the first task");
  await sleep(400);
  await click(session, `${OVERLAY} button[aria-label="Complete “First task”"]`);
  await waitFor(
    session,
    `document.querySelector(${JSON.stringify(OVERLAY)} + ' h1')?.textContent.includes("Second task")`,
    "the overlay to advance to the second task",
    9000,
  );
  await sleep(300);
  const advanced = await read(session);
  const advancedFreeze = await frozen(session);
  check(
    "8 completing a task moves the overlay on without starting the clock",
    advanced.dialogTask === "Second task" &&
      advanced.saved?.taskId === "e2e-1" &&
      advanced.saved?.running === false &&
      advanced.saved?.endsAt === null &&
      advanced.dialogLabel === "Start timer" &&
      advancedFreeze.before === advancedFreeze.after &&
      advancedFreeze.before === 1500,
    JSON.stringify({
      task: advanced.dialogTask,
      label: advanced.dialogLabel,
      saved: advanced.saved,
      frozen: [advancedFreeze.before, advancedFreeze.after],
    }),
  );
  await click(session, `${OVERLAY} button[aria-label="Exit focus mode"]`);
  await sleep(400);

  /* 9 — the deliberate "start this task" affordance still runs ------------- */
  await load(
    session,
    timerPayload({ mode: "focus", running: false, remainingMs: DURATIONS.focus }),
    todosPayload(["Only task"]),
  );
  await click(session, `button[aria-label="Start a focus session for “Only task”"]`);
  await sleep(1200);
  const deliberate = await read(session);
  check(
    "9 the task row's Start-pomodoro button still starts a focus session",
    deliberate.button === "Pause timer" &&
      deliberate.saved?.running === true &&
      deliberate.saved?.taskId === "e2e-0" &&
      (seconds(deliberate.clock) ?? 0) < 1500,
    JSON.stringify({ button: deliberate.button, clock: deliberate.clock, saved: deliberate.saved }),
  );

  /* 7 — a genuinely running session is still resumed by a reload ---------- */
  await load(
    session,
    timerPayload({ mode: "focus", running: true, endsAt: Date.now() + 90_000, remainingMs: 90_000 }),
  );
  const resumed = await read(session);
  await sleep(1500);
  const resumedLater = await read(session);
  check(
    "7 a running session survives a reload and keeps counting",
    resumed.button === "Pause timer" &&
      resumed.saved?.running === true &&
      seconds(resumedLater.clock) < seconds(resumed.clock) &&
      resumedLater.saved?.running === true,
    JSON.stringify({ first: resumed.clock, later: resumedLater.clock }),
  );

  /*
   * 10 — the phone scenario, cold: the screen was locked two minutes in, so the
   * page was frozen for the rest of the session and the engine never saw the
   * tick that crossed zero. The app only learns about it when it is opened
   * again, half an hour after the session ended — and it must still count it,
   * with the whole session's minutes, not the two it watched go by.
   */
  await load(
    session,
    timerPayload({
      mode: "focus",
      running: true,
      endsAt: Date.now() - 30 * 60_000,
      remainingMs: 23 * 60_000,
      flushedMs: 2 * 60_000,
      taskId: "e2e-0",
    }),
    todosPayload(["Phone task"]),
  );
  const late = await read(session);
  const lateBanked = await readTodos(session);
  check(
    "10 a session the phone finished while the app was asleep is still recorded",
    late.heading === "Short break" &&
      late.clock === "5:00" &&
      late.button === "Start timer" &&
      late.saved?.mode === "short" &&
      late.saved?.running === false &&
      late.saved?.endsAt === null &&
      late.saved?.sessions === 1 &&
      lateBanked.totals?.pomodoros === 1 &&
      lateBanked.totals?.focusMinutes === 25 &&
      lateBanked.tasks?.find((t) => t.id === "e2e-0")?.pomodoros === 1,
    JSON.stringify({ heading: late.heading, clock: late.clock, saved: late.saved, banked: lateBanked }),
  );

  /*
   * 11 — the same thing noticed late without a reload: a page that stayed alive
   * through the whole session (backgrounded or in a pocket), whose completion is
   * only seen when the clock jumps. It is the live twin of 10.
   */
  await load(
    session,
    timerPayload({
      mode: "focus",
      running: true,
      endsAt: Date.now() + 20 * 60_000,
      remainingMs: 20 * 60_000,
      taskId: "e2e-0",
    }),
    todosPayload(["Phone task"]),
  );
  await session.eval(`(() => {
    const real = Date.now;
    Date.now = () => real() + 40 * 60_000;
    window.__restoreNow = () => { Date.now = real; return true; };
    return true;
  })()`);
  await sleep(900);
  const jumped = await read(session);
  const jumpedBanked = await readTodos(session);
  await session.eval("window.__restoreNow()");
  check(
    "11 a completion noticed late on a live page is recorded too",
    jumped.heading === "Short break" &&
      jumped.clock === "5:00" &&
      jumped.saved?.mode === "short" &&
      jumped.saved?.running === false &&
      jumped.saved?.sessions === 1 &&
      jumpedBanked.totals?.pomodoros === 1 &&
      jumpedBanked.totals?.focusMinutes > 0,
    JSON.stringify({ heading: jumped.heading, clock: jumped.clock, saved: jumped.saved, banked: jumpedBanked }),
  );

  check("no console errors or uncaught exceptions during the run", session.problems.length === 0, session.problems.slice(0, 4).join(" | ") || "clean");
} catch (error) {
  check("harness completed", false, String(error?.message ?? error));
} finally {
  chrome.kill();
}

const failed = checks.filter((c) => !c.pass);
for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  —  ${c.detail}` : ""}`);
}
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ""}`);
process.exit(failed.length ? 1 : 0);
