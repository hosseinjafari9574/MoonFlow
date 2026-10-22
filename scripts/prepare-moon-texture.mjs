#!/usr/bin/env node
/**
 * The moon's surface: NASA's base-colour map, reprojected into the disc the
 * room draws.
 *
 * The room needs an *orthographic* disc — a sphere as seen from here — not an
 * equirectangular map, and the browser is the only image decoder this project
 * has without adding a dependency. So the work is done in headless Chrome:
 * for each output pixel, invert the orthographic projection to a latitude and
 * longitude, sample the map bilinearly, and average a 4×4 grid inside the
 * pixel so the limb (where the map is compressed hardest) does not alias.
 *
 * The source is NASA's CGI Moon Kit colour map, which is *base colour before
 * lighting* — the one property that matters here, because the room applies its
 * own terminator and a full-moon photograph would carry a second, conflicting
 * set of shadows (see `docs/moon.md`). The committed asset is the output; this
 * script is how it can be rebuilt, not part of `next build`.
 *
 * Usage:
 *   npm run prepare:moon
 *   node scripts/prepare-moon-texture.mjs --size 1536 --quality 0.9
 *
 * The source is downloaded to `.freebuff/moon-source.jpg` (ignored) and checked
 * against the pinned digest below, so a replaced map fails loudly instead of
 * silently changing the moon. Output goes to `public/moon/moon-disc.webp`.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_URL =
  "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg";
/** The 2048×1024 map this asset was built from. */
const SOURCE_SHA256 = "cfc70f02a2fd9d752e3c1237f528c899d681db19a42b7dc5c0d45931b78bb95d";
const SOURCE_CACHE = join(ROOT, ".freebuff", "moon-source.jpg");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const SIZE = Number(flag("size", 1024));
const QUALITY = Number(flag("quality", 0.92));
const OUT = resolve(ROOT, flag("out", "public/moon/moon-disc.webp"));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/* ------------------------------------------------------------------ source */

async function sourceBytes() {
  if (existsSync(SOURCE_CACHE)) return readFileSync(SOURCE_CACHE);
  console.log(`fetch   ${SOURCE_URL}`);
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`${SOURCE_URL} answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(SOURCE_CACHE), { recursive: true });
  writeFileSync(SOURCE_CACHE, bytes);
  return bytes;
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
    throw new Error("no Chrome or Edge found — set CHROME_PATH to a Chromium-based browser binary");
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
    return new Promise((resolve_, reject) => {
      this.pending.set(id, { resolve: resolve_, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function connect(cdpPort) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json());
      const page = list.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((open, fail) => {
          socket.onopen = open;
          socket.onerror = fail;
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

/* ------------------------------------------------------------- projection */

/**
 * Runs inside the page. Returns the WebP as base64 plus the luma distribution
 * of the opaque disc, which is what the treatment in `geometry.ts` is chosen
 * against. Kept as a standalone function so it can be read on its own.
 */
async function reproject({ jpg, size, quality }) {
  const image = new Image();
  image.src = `data:image/jpeg;base64,${jpg}`;
  await image.decode();

  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  sourceContext.drawImage(image, 0, 0);
  const map = sourceContext.getImageData(0, 0, source.width, source.height).data;
  const W = source.width;
  const H = source.height;

  /** Bilinear read of the equirectangular map, in lon/lat radians. */
  const sample = (lon, lat) => {
    const x = ((lon / (Math.PI * 2) + 0.5) * W - 0.5 + W) % W;
    const y = Math.min(H - 1, Math.max(0, (0.5 - lat / Math.PI) * H - 0.5));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const x1 = (x0 + 1) % W;
    const y1 = Math.min(H - 1, y0 + 1);
    const at = (px, py) => (py * W + px) * 4;
    const out = [0, 0, 0];
    for (let channel = 0; channel < 3; channel += 1) {
      const a = map[at(x0, y0) + channel];
      const b = map[at(x1, y0) + channel];
      const c = map[at(x0, y1) + channel];
      const d = map[at(x1, y1) + channel];
      out[channel] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
    return out;
  };

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const target = context.createImageData(size, size);
  const pixels = target.data;
  const SUB = 4;
  const subOffsets = Array.from({ length: SUB }, (_, i) => (i + 0.5) / SUB);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (const sy of subOffsets) {
        for (const sx of subOffsets) {
          const u = ((x + sx) / size) * 2 - 1;
          const v = ((y + sy) / size) * 2 - 1;
          const rr = u * u + v * v;
          if (rr > 1) continue;
          /*
           * Orthographic → sphere: the visible hemisphere is the near side, so
           * `z` is toward the viewer, longitude is measured off that axis and
           * latitude off the equator. The map is centred on 0° longitude, which
           * is the face the Moon keeps toward us.
           */
          const z = Math.sqrt(1 - rr);
          const lat = Math.asin(-v);
          const lon = Math.atan2(u, z);
          const [cr, cg, cb] = sample(lon, lat);
          r += cr;
          g += cg;
          b += cb;
          covered += 1;
        }
      }
      if (!covered) {
        pixels[index + 3] = 0;
        continue;
      }
      pixels[index] = Math.round(r / covered);
      pixels[index + 1] = Math.round(g / covered);
      pixels[index + 2] = Math.round(b / covered);
      /* Supersampling is the antialiasing; the edge is partial coverage. */
      pixels[index + 3] = Math.round((covered / (SUB * SUB)) * 255);
    }
  }
  context.putImageData(target, 0, 0);

  const lumas = [];
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 250) continue;
    const l = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    lumas.push(l);
    sum += l;
  }
  lumas.sort((a, b) => a - b);
  const percentile = (fraction) => lumas[Math.floor(fraction * (lumas.length - 1))] ?? 0;

  return {
    webp: canvas.toDataURL("image/webp", quality).split(",")[1],
    stats: {
      size,
      opaque: lumas.length,
      mean: sum / lumas.length,
      p05: percentile(0.05),
      p50: percentile(0.5),
      p95: percentile(0.95),
      edge: pixels[3],
    },
  };
}

/* ------------------------------------------------------------------- main */

async function main() {
  const bytes = await sourceBytes();
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== SOURCE_SHA256) {
    throw new Error(
      `the source map changed (sha256 ${digest}); review the new map before updating SOURCE_SHA256`,
    );
  }

  const cdpPort = 9500 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), "moon-texture-"));
  const chrome = spawn(findChrome(), [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--force-color-profile=srgb",
    `--window-size=${SIZE},${SIZE}`,
    "about:blank",
  ]);
  chrome.stderr.on("data", () => {});

  let session = null;
  try {
    session = await connect(cdpPort);
    await session.send("Runtime.enable");
    const { result, exceptionDetails } = await session.send("Runtime.evaluate", {
      expression: `(${reproject.toString()})(${JSON.stringify({
        jpg: bytes.toString("base64"),
        size: SIZE,
        quality: QUALITY,
      })})`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(
        exceptionDetails.exception?.description ?? exceptionDetails.text ?? "the projection threw",
      );
    }

    const webp = Buffer.from(result.value.webp, "base64");
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, webp);

    const { stats } = result.value;
    console.log(
      `\nwrote   ${OUT.replace(ROOT + (process.platform === "win32" ? "\\" : "/"), "")} ` +
        `(${(webp.length / 1024).toFixed(1)} KB, ${stats.size}×${stats.size})`,
    );
    console.log(
      `surface mean ${stats.mean.toFixed(1)} luma · p05 ${stats.p05.toFixed(1)} · ` +
        `p50 ${stats.p50.toFixed(1)} · p95 ${stats.p95.toFixed(1)} · ${stats.opaque} opaque px`,
    );
  } finally {
    session?.socket.close();
    stopTree(chrome);
  }
}

main().catch((error) => {
  console.error(`\nprepare:moon failed — ${error.message}`);
  process.exitCode = 1;
});
