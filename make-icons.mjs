// Makes the home-screen icons (a green dumbbell on a dark background).
// Run once in the gym-log folder:  node make-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// draw(x, y) takes positions from 0 to 1 and returns [r, g, b]. Each pixel averages 4 samples to smooth edges.
function png(size, draw) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);   // one filter byte (0) at the start of each row
  const sub = [0.25, 0.75];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (const sx of sub) {
        for (const sy of sub) {
          const c = draw((x + sx) / size, (y + sy) / size);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const i = y * stride + 1 + x * 3;
      raw[i] = Math.round(r / 4);
      raw[i + 1] = Math.round(g / 4);
      raw[i + 2] = Math.round(b / 4);
    }
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head[8] = 8;   // 8 bits per channel
  head[9] = 2;   // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const box = (x, y, x0, x1, y0, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

function dumbbell(x, y) {
  const on =
    box(x, y, 0.18, 0.82, 0.47, 0.53) ||   // bar
    box(x, y, 0.28, 0.36, 0.28, 0.72) ||   // inner plates
    box(x, y, 0.64, 0.72, 0.28, 0.72) ||
    box(x, y, 0.18, 0.26, 0.36, 0.64) ||   // outer plates
    box(x, y, 0.74, 0.82, 0.36, 0.64);
  return on ? [22, 163, 74] : [17, 17, 17];
}

for (const [name, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
  writeFileSync(name, png(size, dumbbell));
  console.log("Wrote " + name);
}