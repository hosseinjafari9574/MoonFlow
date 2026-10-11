/**
 * Builds public/favicon.ico from three PNG payloads and validates them at the
 * content level, not just structurally.
 *
 * Why content level: a previous ICO passed every structural check — correct
 * ICONDIR, correct per-entry sizes, PNG signature on every entry, last entry
 * ending exactly at EOF — while its 48px payload was in fact corrupt (the IDAT
 * stream would not inflate, so the frame could not be decoded at all). Size and
 * signature checks cannot see that; inflating the stream and verifying CRCs can.
 *
 * Inputs:  .freebuff/png-16.png, .freebuff/png-32.png, .freebuff/png-48.png
 *          (Produced by rasterising app/icon.svg in a browser and POSTing the
 *          bytes to .freebuff/receiver.js — never hand-copied base64, which is
 *          what corrupted the 48px payload in the first place.)
 * Output:  public/favicon.ico
 */
const fs = require("fs");
const zlib = require("zlib");

const SIZES = [16, 32, 48];

function inspectPng(buf, expectSize) {
  const problems = [];
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) {
    problems.push("bad PNG signature");
    return { problems };
  }
  let p = 8;
  const idat = [];
  let ihdr = null;
  let sawIend = false;
  let chunks = 0;
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (p + 12 + len > buf.length) {
      problems.push(`chunk ${type} runs past end of buffer`);
      break;
    }
    const crc = buf.readUInt32BE(p + 8 + len);
    const calc = zlib.crc32(buf.subarray(p + 4, p + 8 + len)) >>> 0;
    if (crc !== calc) problems.push(`chunk ${type} CRC mismatch`);
    if (type === "IHDR") {
      ihdr = {
        w: body.readUInt32BE(0),
        h: body.readUInt32BE(4),
        depth: body[8],
        color: body[9],
        interlace: body[12],
      };
    }
    if (type === "IDAT") idat.push(body);
    if (type === "IEND") sawIend = true;
    chunks += 1;
    p += 12 + len;
    if (type === "IEND") break;
  }
  if (!sawIend) problems.push("no IEND");
  if (!idat.length) problems.push("no IDAT");
  if (!ihdr) problems.push("no IHDR");
  if (ihdr && expectSize && (ihdr.w !== expectSize || ihdr.h !== expectSize)) {
    problems.push(`IHDR is ${ihdr.w}x${ihdr.h}, expected ${expectSize}x${expectSize}`);
  }
  if (ihdr && ihdr.interlace !== 0) problems.push("interlaced (unsupported here)");
  if (idat.length) {
    try {
      const raw = zlib.inflateSync(Buffer.concat(idat));
      const bpp = ihdr.color === 6 ? 4 : ihdr.color === 2 ? 3 : 0;
      const expected = ihdr.h * (1 + ihdr.w * bpp);
      if (raw.length !== expected) {
        problems.push(`inflated ${raw.length} bytes, expected ${expected}`);
      }
    } catch (err) {
      problems.push(`IDAT will not inflate: ${err.message}`);
    }
  }
  return { problems, ihdr, idatBytes: idat.reduce((a, b) => a + b.length, 0) };
}

const payloads = SIZES.map((size) => ({
  size,
  buf: fs.readFileSync(`.freebuff/png-${size}.png`),
}));

let failed = false;
for (const p of payloads) {
  const r = inspectPng(p.buf, p.size);
  const ok = r.problems.length === 0;
  if (!ok) failed = true;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${p.size}x${p.size}  ${p.buf.length} bytes  ` +
      `ihdr ${r.ihdr ? r.ihdr.w + "x" + r.ihdr.h + " depth " + r.ihdr.depth + " color " + r.ihdr.color : "?"}  ` +
      `idat ${r.idatBytes ?? 0}`,
  );
  for (const problem of r.problems) console.log("       - " + problem);
}
if (failed) {
  console.error("PAYLOAD VALIDATION FAILED — nothing written");
  process.exit(1);
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(payloads.length, 4);
const dir = Buffer.alloc(16 * payloads.length);
let offset = 6 + dir.length;
payloads.forEach((p, i) => {
  const e = i * 16;
  dir.writeUInt8(p.size === 256 ? 0 : p.size, e);
  dir.writeUInt8(p.size === 256 ? 0 : p.size, e + 1);
  dir.writeUInt8(0, e + 2);
  dir.writeUInt8(0, e + 3);
  dir.writeUInt16LE(1, e + 4);
  dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(p.buf.length, e + 8);
  dir.writeUInt32LE(offset, e + 12);
  offset += p.buf.length;
});
const ico = Buffer.concat([header, dir, ...payloads.map((p) => p.buf)]);
fs.writeFileSync("public/favicon.ico", ico);
console.log("wrote public/favicon.ico", ico.length, "bytes");

// Read the file back and re-validate the container *and* every payload in it.
const back = fs.readFileSync("public/favicon.ico");
console.log(
  "read back: reserved",
  back.readUInt16LE(0),
  "| type",
  back.readUInt16LE(2),
  "| images",
  back.readUInt16LE(4),
);
let ok = back.readUInt16LE(0) === 0 && back.readUInt16LE(2) === 1;
for (let i = 0; i < back.readUInt16LE(4); i += 1) {
  const e = 6 + i * 16;
  const len = back.readUInt32LE(e + 8);
  const off = back.readUInt32LE(e + 12);
  const inBounds = off + len <= back.length;
  const r = inspectPng(back.subarray(off, off + len), back[e]);
  const entryOk = inBounds && r.problems.length === 0;
  if (!entryOk) ok = false;
  console.log(
    `  ${entryOk ? "OK  " : "FAIL"} ${back[e]}x${back[e + 1]} bytes ${len} offset ${off}` +
      (r.problems.length ? " :: " + r.problems.join("; ") : ""),
  );
}
const lastOff = back.readUInt32LE(6 + (back.readUInt16LE(4) - 1) * 16 + 12);
const lastLen = back.readUInt32LE(6 + (back.readUInt16LE(4) - 1) * 16 + 8);
if (lastOff + lastLen !== back.length) {
  ok = false;
  console.log("  FAIL last entry does not end at file end");
}
if (!ok) {
  console.error("ICO VALIDATION FAILED");
  process.exit(1);
}
console.log("ICO VALIDATION PASSED");
