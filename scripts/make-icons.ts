// Génère les icônes PNG de la PWA (vert / blanc / rouge) sans dépendance.
import zlib from 'node:zlib';
import fs from 'node:fs';

type RGB = [number, number, number];
const GREEN: RGB = [27, 127, 59], WHITE: RGB = [255, 255, 255], RED: RGB = [214, 40, 40], DEEP: RGB = [14, 90, 40];

function pixel(u: number, v: number): RGB {
  const dx = u - 0.5, dy = v - 0.5;
  if (Math.hypot(dx, dy) > 0.36) return GREEN;
  const c = Math.SQRT1_2, x = dx * c + dy * c, y = -dx * c + dy * c;
  if ((x / 0.30) ** 2 + (y / 0.13) ** 2 <= 1) {
    if (Math.abs(y) < 0.008 && x > -0.3) return WHITE;
    return x > 0.1 && y < 0 ? DEEP : GREEN;
  }
  if (Math.hypot(dx - 0.2, dy + 0.2) < 0.045) return RED;
  return WHITE;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, sum]);
};

function png(size: number): Buffer {
  const stride = size * 4 + 1, S = 3;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
        const p = pixel((x + (i + 0.5) / S) / size, (y + (j + 0.5) / S) / size);
        r += p[0]; g += p[1]; b += p[2];
      }
      const o = y * stride + 1 + x * 4, n = S * S;
      raw[o] = r / n; raw[o + 1] = g / n; raw[o + 2] = b / n; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync('public/icons', { recursive: true });
for (const s of [96, 192, 512]) fs.writeFileSync(`public/icons/icon-${s}.png`, png(s));
console.log('Icônes générées.');
