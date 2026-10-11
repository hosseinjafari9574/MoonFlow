/*
 * Bake the film-grain texture into a PNG.
 *
 * `app/globals.css` builds its grain from an inline SVG `feTurbulence` filter.
 * That filter has to be run by Skia every time the layer is rastered, including
 * the overlay's first paint. The noise itself is static, so it only needs to be
 * generated once: this renders the *existing* texture through a canvas at its
 * native 140×140 and writes exactly those pixels to `public/grain.png`, so the
 * app keeps the same grain and pays a PNG decode instead of a filter.
 *
 * Usage: node .freebuff/bake-grain.mjs [out.png]
 */

import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const PORT = 9334;
const OUT = process.argv[2] ?? "public/grain.png";
const SIZE = 140;

/* Verbatim from `.grain` in app/globals.css. */
const SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

const CANDIDATES = [
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = CANDIDATES.find((p) => existsSync(p));
if (!chromePath) throw new Error("no Chrome/Edge binary found");

const chrome = spawn(chromePath, [
  `--remote-debugging-port=${PORT}`,
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--user-data-dir=" + process.env.TEMP + "\\grain-bake-profile",
  "--window-size=800,600",
  "about:blank",
]);
chrome.stderr.on("data", () => {});

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener("open", resolve, { once: true });
          ws.addEventListener("error", reject, { once: true });
        });
        let nextId = 1;
        const pending = new Map();
        ws.addEventListener("message", (event) => {
          const msg = JSON.parse(event.data);
          const entry = pending.get(msg.id);
          if (!entry) return;
          pending.delete(msg.id);
          msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
        });
        return {
          send: (method, params = {}) => {
            const id = nextId++;
            ws.send(JSON.stringify({ id, method, params }));
            return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
          },
          close: () => ws.close(),
        };
      }
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("devtools never came up");
}

const session = await connect();
await session.send("Page.enable");
await session.send("Runtime.enable");
const { result } = await session.send("Runtime.evaluate", {
  awaitPromise: true,
  returnByValue: true,
  expression: `(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(SVG)};
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = ${SIZE};
    canvas.height = ${SIZE};
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, ${SIZE}, ${SIZE});
    const png = canvas.toDataURL('image/png');
    /* Pixel statistics, so the bake can be checked against the live texture. */
    const data = ctx.getImageData(0, 0, ${SIZE}, ${SIZE}).data;
    let sum = 0;
    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i];
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const mean = sum / (data.length / 4);
    let sq = 0;
    for (let i = 0; i < data.length; i += 4) sq += (data[i] - mean) ** 2;
    return { png, mean: Math.round(mean * 10) / 10, sd: Math.round(Math.sqrt(sq / (data.length / 4)) * 10) / 10, min, max };
  })()`,
});
const { png, mean, sd, min, max } = result.value;
const base64 = png.split(",")[1];
writeFileSync(OUT, Buffer.from(base64, "base64"));
console.log(
  `wrote ${OUT}: ${SIZE}×${SIZE}, ${(base64.length * 0.75 / 1024).toFixed(1)} KiB | pixel mean ${mean}, sd ${sd}, range ${min}–${max}`,
);
session.close();
chrome.kill();
