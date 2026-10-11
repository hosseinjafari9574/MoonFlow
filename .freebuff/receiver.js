/**
 * One-shot local receiver: the browser rasterises app/icon.svg and POSTs the
 * PNG payloads here, so the bytes never have to be copied by hand (hand-copying
 * base64 is how the previous favicon payload was corrupted).
 *
 * Binds 127.0.0.1:3199 only. Accepts a text/plain body of JSON:
 *   { "16": "<base64 png>", "32": "...", "48": "..." }
 * Validates each payload (signature + inflate) and writes .freebuff/png-<size>.png.
 *
 * Usage: node .freebuff/receiver.js   (run in background, then POST from the page)
 */
const fs = require("fs");
const http = require("http");
const zlib = require("zlib");

const PORT = 3199;
let received = false;
let sizeCount = 0;

function inspect(png) {
  const problems = [];
  if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) problems.push("bad signature");
  let p = 8;
  const idat = [];
  let ihdr = null;
  while (p + 12 <= png.length) {
    const len = png.readUInt32BE(p);
    const type = png.toString("latin1", p + 4, p + 8);
    if (p + 12 + len > png.length) {
      problems.push(`chunk ${type} past end`);
      break;
    }
    const crc = png.readUInt32BE(p + 8 + len);
    const calc = zlib.crc32(png.subarray(p + 4, p + 8 + len)) >>> 0;
    if (crc !== calc) problems.push(`${type} CRC mismatch`);
    if (type === "IHDR") {
      ihdr = { w: png.readUInt32BE(p + 8), h: png.readUInt32BE(p + 12), color: png[p + 17] };
    }
    if (type === "IDAT") idat.push(png.subarray(p + 8, p + 8 + len));
    if (type === "IEND") break;
    p += 12 + len;
  }
  if (!ihdr) problems.push("no IHDR");
  if (!idat.length) problems.push("no IDAT");
  if (idat.length) {
    try {
      const raw = zlib.inflateSync(Buffer.concat(idat));
      const bpp = ihdr && ihdr.color === 6 ? 4 : 3;
      const expected = ihdr.h * (1 + ihdr.w * bpp);
      if (raw.length !== expected) problems.push(`inflated ${raw.length}, expected ${expected}`);
    } catch (err) {
      problems.push(`IDAT will not inflate: ${err.message}`);
    }
  }
  return { problems, ihdr };
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    try {
      const payload = JSON.parse(body);
      const report = [];
      for (const size of Object.keys(payload)) {
        const png = Buffer.from(payload[size], "base64");
        const r = inspect(png);
        if (r.problems.length) {
          report.push(`${size}: FAIL ${r.problems.join("; ")}`);
          continue;
        }
        fs.writeFileSync(`.freebuff/png-${size}.png`, png);
        sizeCount += 1;
        report.push(`${size}: ok ${png.length} bytes ${r.ihdr.w}x${r.ihdr.h}`);
      }
      received = true;
      console.log("received payloads:\n  " + report.join("\n  "));
      res.writeHead(200, { "Content-Type": "text/plain" }).end(report.join("\n"));
      console.log("wrote", sizeCount, "files — exiting");
      setTimeout(() => process.exit(0), 150);
    } catch (err) {
      console.log("BAD REQUEST:", err.message);
      res.writeHead(400, { "Content-Type": "text/plain" }).end("bad request");
    }
  });
});

server.listen(PORT, "127.0.0.1", () => console.log("receiver listening on 127.0.0.1:" + PORT));
setTimeout(() => {
  if (!received) {
    console.log("TIMEOUT — nothing received");
    process.exit(1);
  }
}, 120000).unref();
