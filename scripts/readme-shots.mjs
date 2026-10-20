/**
 * The README's "how you use it" shots.
 *
 * `npm run verify:visuals` proves the instrument's geometry from its own
 * numbers, and every clip it writes is object-level: the card's dial, the
 * moon's phases, the cycle strip. Those say what the timer *is*. They do not
 * say what the app is like to use, which is the first thing a README has to
 * answer. This script fills that gap with two pictures of the whole surface:
 *
 *   docs/png/app-list.png    the list, the timer card, the stats — the day
 *   docs/png/focus-room.png  Focus Mode at desktop size — one session
 *
 * Both are seeded with the same fixed day's work and shot at 2× so they stay
 * crisp on GitHub, where the README renders them at half size. They are also
 * the same on every run: the room's clock is stopped at 12:00 — the number the
 * card shows — and the key hints, which fade after five seconds, are waited
 * out. Run it after a change to the layout, copy, or palette:
 *
 *   npm run shots
 *
 * It starts its own dev server and its own headless Chrome, so it stands alone
 * the way `verify:visuals` does. Next's dev-tools button is hidden before the
 * shutter: it is an affordance of the dev server, not part of the app, and the
 * production build has nothing in that corner.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "png");

const TASKS_KEY = "cadence:todos:v1";
const TIMER_KEY = "cadence:timer:v1";
const DIALOG = '[role="dialog"][aria-label^="Focus mode"]';

/**
 * 1280×900, shot at 2× for the list and 1.25× for the room. GitHub renders
 * these inside an ~880px column; the list wants the extra sharpness once it is
 * opened at full size, while the room's grain and nebula make its PNG megabytes
 * of texture that nothing on the page can resolve — at 1.25× it is 1600px wide,
 * still almost twice the column it sits in.
 */
const WIDTH = 1280;
const HEIGHT = 900;
const LIST_SCALE = 2;
const ROOM_SCALE = 1.25;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------------------------- app */

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function stopTree(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

/** A dev server, started here so the script stands alone. */
async function startApp() {
  const port = await freePort();
  const nextBin = join(ROOT, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) throw new Error("next is not installed — run the project's install first");
  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk;
  });
  child.stderr.on("data", (chunk) => {
    log += chunk;
  });

  const base = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next dev exited (${child.exitCode}) before it answered:\n${log.slice(-3000)}`);
    }
    try {
      const response = await fetch(base);
      if (response.ok) return { base, stop: () => stopTree(child) };
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }
  stopTree(child);
  throw new Error(`the app did not answer on ${base} within 120s:\n${log.slice(-3000)}`);
}

/* ---------------------------------------------------------------- browser */

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function findChrome() {
  const found = CHROME_CANDIDATES.find((candidate) => candidate && existsSync(candidate));
  if (!found) {
    throw new Error(
      "no Chrome or Edge found — set CHROME_PATH to a Chromium-based browser binary",
    );
  }
  return found;
}

class Session {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    };
  }

  send(method, params = {}) {
    const id = (this.nextId += 1);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(
        exceptionDetails.exception?.description ?? exceptionDetails.text ?? "page threw",
      );
    }
    return result.value;
  }

  close() {
    this.socket.close();
  }
}

async function connect(cdpPort) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json());
      const page = list.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.onopen = resolve;
          socket.onerror = reject;
        });
        return new Session(socket);
      }
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error("no CDP target appeared");
}

/* ------------------------------------------------------------------- seed */

/**
 * A day's work, written into localStorage before the app's first paint so the
 * shots are the same every run. The dates are computed in the page, because
 * the streak and the week chart read local day keys.
 */
function seed() {
  const now = Date.now();
  const day = 86_400_000;
  const key = (offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const dateOfMonth = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${dateOfMonth}`;
  };

  const task = (id, title, priority, tags, createdAt, extra = {}) => ({
    id,
    title,
    completed: false,
    priority,
    tags,
    createdAt,
    completedAt: null,
    pomodoros: 0,
    focusMinutes: 0,
    ...extra,
  });

  const todos = {
    state: {
      tasks: [
        task("rs-1", "Draft the quarter's narrative", "high", ["writing"], now, {
          pomodoros: 2,
          focusMinutes: 50,
        }),
        task("rs-2", "Review the migration plan", "high", ["review"], now - 60_000),
        task("rs-3", "Book the offsite venue", "medium", ["admin"], now - 120_000),
        task("rs-4", "Read the storage RFC", "low", ["reading"], now - 180_000),
        task("rs-5", "Reply to the design thread", "medium", ["writing", "review"], now - 240_000, {
          completed: true,
          completedAt: now - 3_600_000,
        }),
        task("rs-6", "Tidy the inbox", "low", ["admin"], now - 300_000, {
          completed: true,
          completedAt: now - 5_400_000,
        }),
      ],
      activity: {
        [key(-6)]: { completed: 2, pomodoros: 2, focusMinutes: 50 },
        [key(-5)]: { completed: 1, pomodoros: 3, focusMinutes: 75 },
        [key(-4)]: { completed: 0, pomodoros: 0, focusMinutes: 0 },
        [key(-3)]: { completed: 3, pomodoros: 4, focusMinutes: 100 },
        [key(-2)]: { completed: 2, pomodoros: 3, focusMinutes: 75 },
        [key(-1)]: { completed: 1, pomodoros: 2, focusMinutes: 50 },
        [key(0)]: { completed: 2, pomodoros: 2, focusMinutes: 50 },
      },
      settings: { soundEnabled: false },
    },
    version: 1,
  };

  const timer = {
    state: {
      preset: "classic",
      mode: "focus",
      running: false,
      endsAt: null,
      remainingMs: 12 * 60_000,
      sessions: 2,
      flushedMs: 0,
      taskId: "rs-1",
    },
    version: 1,
  };

  return {
    source: `try {
      localStorage.setItem(${JSON.stringify(TASKS_KEY)}, ${JSON.stringify(JSON.stringify(todos))});
      localStorage.setItem(${JSON.stringify(TIMER_KEY)}, ${JSON.stringify(JSON.stringify(timer))});
    } catch {}`,
    titles: todos.state.tasks.map((entry) => entry.title),
  };
}

/* ------------------------------------------------------------------- main */

async function main() {
  const app = process.env.APP || process.env.BASE_URL ? null : await startApp();
  const base = process.env.APP || process.env.BASE_URL || app.base;
  console.log(`app: ${base}${app ? " (started here)" : ""}`);

  mkdirSync(OUT, { recursive: true });
  const { source, titles } = seed();

  const cdpPort = 9500 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), "readme-shots-"));
  const chrome = spawn(findChrome(), [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    `--window-size=${WIDTH},${HEIGHT}`,
    "--window-position=-32000,-32000",
    "about:blank",
  ]);
  chrome.stderr.on("data", () => {});

  let session = null;
  try {
    session = await connect(cdpPort);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    /*
     * Settled, not animated: the arrival is a transition, and a screenshot of a
     * transition is a screenshot of an accident. The room itself is unchanged —
     * it is the same sky, moon, ring and controls at rest.
     */
    await session.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await session.send("Page.addScriptToEvaluateOnNewDocument", { source });

    await session.send("Emulation.setDeviceMetricsOverride", {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await session.send("Page.navigate", { url: base });
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        if (await session.eval('document.readyState === "complete" && !!document.querySelector("main li")')) break;
      } catch {
        /* navigating */
      }
      await sleep(250);
    }
    await session.eval("document.fonts.ready.then(() => true)");
    /*
     * The dev-tools button lives in a `nextjs-portal` in the bottom-left of
     * every page the dev server serves, and a shot would bake it in. Nothing
     * in production puts a control there, so it is hidden — and the check
     * beside the error-overlay one below fails the run if it ever returns.
     */
    await session.eval(`(() => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { display: none !important; }";
      document.head.appendChild(style);
      return true;
    })()`);
    await session.eval("window.scrollTo(0, 0)");
    await sleep(900);

    /*
     * A shot is only worth committing if it shows the app rather than a blank
     * page, a dev error overlay or a half-hydrated list. These are the checks
     * for that, and they print what ended up in frame so a diff of the log says
     * what changed in the picture.
     */
    const present = await session.eval(
      `[...document.querySelectorAll("main li")].map((item) => item.textContent.trim())`,
    );
    const missing = titles.filter(
      (title, index) => index < 4 && !present.some((text) => text.includes(title)),
    );
    if (missing.length) {
      throw new Error(`the seeded tasks did not render: ${missing.join(", ")}`);
    }
    const overlay = await session.eval(
      `!!document.querySelector("[data-nextjs-dialog], #nextjs__container_errors_label")`,
    );
    if (overlay) throw new Error("a Next.js dev error overlay is on screen");
    const devBadge = await session.eval(`(() => {
      const portal = document.querySelector("nextjs-portal");
      return Boolean(portal) && getComputedStyle(portal).display !== "none";
    })()`);
    if (devBadge) throw new Error("Next's dev-tools button is on screen");
    const tall = await session.eval(
      `document.documentElement.scrollHeight - window.innerHeight`,
    );
    console.log(
      `list:   ${present.length} tasks in frame, ${tall > 0 ? `${tall}px below the fold` : "nothing below the fold"}`,
    );
    for (const text of present.slice(0, 6)) {
      console.log(`        · ${text.replace(/\s+/g, " ").slice(0, 96)}`);
    }

    const shot = (name, scale) =>
      session
        .send("Page.captureScreenshot", {
          format: "png",
          clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale },
        })
        .then(({ data }) => {
          const file = join(OUT, name);
          writeFileSync(file, Buffer.from(data, "base64"));
          console.log(`wrote ${name} at ${Math.round(WIDTH * scale)}px wide`);
        });

    await shot("app-list.png", LIST_SCALE);

    /*
     * Entering Focus Mode *starts* the session (task-item.tsx says so: "no
     * second click"), so the room's clock runs from the moment it opens and its
     * digits would be whatever second the shutter caught. The clock is stopped
     * at the instant the session starts instead: `Date.now` is pinned just
     * before the click, so the room reads the seeded 12:00 on every run — the
     * same 12:00 the card shows — and a diff between two runs is a diff in the
     * layout, not in the clock. Timers and animations schedule on real time, so
     * the arrival, the grain and the orbit still settle.
     */
    await session.eval(
      `(() => { const frozen = Date.now(); Date.now = () => frozen; return frozen; })()`,
    );

    const opened = await session.eval(`(() => {
      const button = [...document.querySelectorAll("main button")].find((element) =>
        (element.getAttribute("aria-label") || "").startsWith("Enter focus mode"),
      );
      if (button) button.click();
      return Boolean(button);
    })()`);
    if (!opened) throw new Error('no "Enter focus mode" button on the page');
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await session.eval(`!!document.querySelector(${JSON.stringify(DIALOG)})`)) break;
      await sleep(250);
    }
    if (!(await session.eval(`!!document.querySelector(${JSON.stringify(DIALOG)})`))) {
      throw new Error("Focus Mode did not open");
    }
    await session.eval("document.fonts.ready.then(() => true)");
    /*
     * The key hints fade themselves out after five still seconds (focus-mode.tsx),
     * so a shot taken earlier or later carries a different room. Wait them out —
     * a second past the fifth, for the fade — and assert they are gone below.
     */
    await sleep(5600);

    const room = await session.eval(`(() => {
      const dialog = document.querySelector(${JSON.stringify(DIALOG)});
      const lines = (dialog?.innerText || "").split("\\n").map((line) => line.trim()).filter(Boolean);
      const space = [...(dialog?.querySelectorAll(".kbd") || [])].find(
        (element) => element.textContent.trim() === "Space",
      );
      let hints = "missing";
      for (let node = space; node && node !== dialog; node = node.parentElement) {
        if (Number(getComputedStyle(node).opacity) < 0.99) { hints = "hidden"; break; }
      }
      return {
        lines: lines.slice(0, 10),
        scrolls: (dialog?.scrollHeight || 0) > (dialog?.clientHeight || 0),
        hints,
        clock: (dialog?.innerText || "").includes("12:00"),
      };
    })()`);
    if (!room.lines.length) throw new Error("Focus Mode opened with no text in it");
    if (room.scrolls) throw new Error("Focus Mode overflows its own viewport");
    if (!room.clock) throw new Error("the room's clock is not the seeded 12:00");
    if (room.hints !== "hidden") throw new Error(`the key hints are ${room.hints} in the shot`);
    console.log(`room:   ${room.lines.join(" · ")}`);

    await shot("focus-room.png", ROOM_SCALE);
  } finally {
    session?.close();
    stopTree(chrome);
    app?.stop();
  }
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
});
