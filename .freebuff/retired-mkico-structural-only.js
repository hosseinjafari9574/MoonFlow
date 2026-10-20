/**
 * One-off: writes the .ico the browser assembled (16/32/48 PNG entries) to
 * public/favicon.ico, then reads the container back to prove it is well formed.
 * Validation is structural, so it holds for any geometry.
 */
const fs = require("fs");

const b64 = fs.readFileSync(".freebuff/favicon.b64", "utf8").trim();
const buf = Buffer.from(b64, "base64");

const reserved = buf.readUInt16LE(0);
const type = buf.readUInt16LE(2);
const count = buf.readUInt16LE(4);
console.log("ICONDIR: reserved", reserved, "type", type, "images", count);

const expectedTotal = 6 + 16 * count;
let ok = reserved === 0 && type === 1 && count > 0;

const entries = [];
for (let i = 0; i < count; i += 1) {
  const e = 6 + i * 16;
  const len = buf.readUInt32LE(e + 8);
  const off = buf.readUInt32LE(e + 12);
  const sig = buf.slice(off, off + 4).toString("hex");
  const withinBounds = off + len <= buf.length;
  if (sig !== "89504e47" || !withinBounds) ok = false;
  entries.push({ size: buf[e] + "x" + buf[e + 1], len, off, sig, withinBounds });
}
for (const e of entries) {
  console.log("  " + e.size + " bytes " + e.len + " offset " + e.off + " sig " + e.sig + " in-bounds " + e.withinBounds);
}

// The last entry must end exactly at the file end, or something is truncated.
const last = entries[entries.length - 1];
const endsExactly = last.off + last.len === buf.length;
console.log("total bytes:", buf.length, "| last entry ends at file end:", endsExactly);

if (!ok || !endsExactly) {
  console.error("ICO VALIDATION FAILED");
  process.exit(1);
}
fs.writeFileSync("public/favicon.ico", buf);
console.log("wrote public/favicon.ico");
