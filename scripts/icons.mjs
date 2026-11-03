// Generates the extension icons as PNGs without dependencies (deterministic output).
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

/** Green rounded square with a white "pocket" (bowl) and a leaf. */
export function iconPng(size, pad = 0) {
  const px = Buffer.alloc(size * size * 4);
  const green = [23, 99, 71];
  const leaf = [154, 205, 120];
  const art = size - 2 * pad;
  const r = art * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x - pad + 0.5) / art, fy = (y - pad + 0.5) / art;
      const cx = Math.min(Math.max(x + 0.5, pad + r), size - pad - r), cy = Math.min(Math.max(y + 0.5, pad + r), size - pad - r);
      const inside = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r;
      let c = null;
      if (inside) {
        c = green;
        // bowl: lower half-disc
        const bx = fx - 0.5, by = fy - 0.48;
        if (by >= 0 && Math.hypot(bx, by) <= 0.32) c = [255, 255, 255];
        // bowl rim
        if (Math.abs(fy - 0.48) <= 0.035 && Math.abs(bx) <= 0.36) c = [255, 255, 255];
        // leaf
        const lx = fx - 0.56, ly = fy - 0.3;
        if (Math.hypot(lx / 0.14, ly / 0.07) <= 1 && fy < 0.44) c = leaf;
      }
      const i = (y * size + x) * 4;
      if (c) { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; }
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
