// 把用户提供的 PNG 设计稿转成应用图标（纯 Node，无第三方依赖）
// 用法: node png2ico.mjs <源图.png> <输出目录>
// 输出: icon.ico（16/32/48/64/128/256）+ icon-256.png（预览）
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const [src, outDir] = process.argv.slice(2);
if (!src || !outDir) { console.error("用法: node png2ico.mjs <源图.png> <输出目录>"); process.exit(1); }

/* ---------- PNG 解码（支持 8bit RGB/RGBA 非隔行） ---------- */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG 文件");
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error("仅支持 8bit PNG，实际位深 " + bitDepth);
  if (interlace !== 0) throw new Error("不支持隔行 PNG");
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!ch) throw new Error("仅支持 RGB/RGBA，实际颜色类型 " + colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      switch (ft) {
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
      }
      cur[i] = v;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * ch;
      out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2];
      out[o + 3] = ch === 4 ? cur[s + 3] : 255;
    }
    prev = cur;
  }
  return { data: out, w, h };
}

/* ---------- 盒滤波缩放（缩小质量最好） ---------- */
function resize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const xr = sw / dw, yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * yr);
    const y1 = Math.min(sh, Math.max(y0 + 1, Math.floor((y + 1) * yr)));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * xr);
      const x1 = Math.min(sw, Math.max(x0 + 1, Math.floor((x + 1) * xr)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * sw + xx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/* ---------- PNG 编码 / ICO 打包（与 make-icon.mjs 相同） ---------- */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function toPng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function toIco(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dirs = [];
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d.writeUInt8(e.size >= 256 ? 0 : e.size, 0);
    d.writeUInt8(e.size >= 256 ? 0 : e.size, 1);
    d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6);
    d.writeUInt32LE(e.png.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.png.length;
    dirs.push(d);
  }
  return Buffer.concat([head, ...dirs, ...entries.map(e => e.png)]);
}

/* ---------- 圆角遮罩（Windows 11 风格 squircle 圆角，边缘抗锯齿） ---------- */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}
function applyRoundMask(rgba, size, radiusRatio, feather) {
  const r = size * radiusRatio;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = sdRoundRect(x + 0.5, y + 0.5, size / 2, size / 2, size / 2, size / 2, r);
      const a = Math.max(0, Math.min(1, 0.5 - d / feather));
      if (a < 1) {
        const i = (y * size + x) * 4;
        rgba[i + 3] = Math.round(rgba[i + 3] * a);
      }
    }
  }
  return rgba;
}

/* ---------- 主流程 ---------- */
const img = decodePng(fs.readFileSync(src));
console.log(`源图: ${img.w}x${img.h} RGBA`);

const ROUND = process.argv.includes("--square") ? false : true;   // 默认圆角
const sizes = [16, 32, 48, 64, 128, 256];
const entries = sizes.map(s => {
  let scaled = resize(img.data, img.w, img.h, s, s);
  if (ROUND) applyRoundMask(scaled, s, 0.225, 1.5);
  console.log(`  ${s}x${s} ✓${ROUND ? " (圆角)" : ""}`);
  return { size: s, png: toPng(scaled, s) };
});

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon.ico"), toIco(entries));
fs.writeFileSync(path.join(outDir, "icon-256.png"), entries[entries.length - 1].png);
console.log("已输出:", path.join(outDir, "icon.ico"));
