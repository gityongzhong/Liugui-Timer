// 分析设计稿：找出圆角矩形面板的实际边界与圆角半径
import zlib from "node:zlib";
import fs from "node:fs";

const src = process.argv[2];
const buf = fs.readFileSync(src);
let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
const idat = [];
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString("ascii", pos + 4, pos + 8);
  const data = buf.slice(pos + 8, pos + 8 + len);
  if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
  else if (type === "IDAT") idat.push(data);
  else if (type === "IEND") break;
  pos += 12 + len;
}
const ch = colorType === 6 ? 4 : 3;
const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = w * ch;
const px = Buffer.alloc(w * h * 4);
let prev = Buffer.alloc(stride);
for (let y = 0; y < h; y++) {
  const ft = raw[y * (stride + 1)];
  const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
  const cur = Buffer.alloc(stride);
  for (let i = 0; i < stride; i++) {
    const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
    let v = line[i];
    if (ft === 1) v = (v + a) & 0xff;
    else if (ft === 2) v = (v + b) & 0xff;
    else if (ft === 3) v = (v + ((a + b) >> 1)) & 0xff;
    else if (ft === 4) {
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
    }
    cur[i] = v;
  }
  for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, s = x * ch;
    px[o] = cur[s]; px[o + 1] = cur[s + 1]; px[o + 2] = cur[s + 2];
    px[o + 3] = ch === 4 ? cur[s + 3] : 255;
  }
  prev = cur;
}

/* 以四角平均值作为背景色 */
function avg(x0, y0, x1, y1) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * w + x) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
  }
  return [r / n, g / n, b / n];
}
const cs = 30;
const corners = [avg(0, 0, cs, cs), avg(w - cs, 0, w, cs), avg(0, h - cs, cs, h), avg(w - cs, h - cs, w, h)];
const BG = [0, 1, 2].map(k => corners.reduce((s, c) => s + c[k], 0) / 4);
console.log("四角背景色 RGB =", BG.map(v => v.toFixed(1)).join(", "));

const TH = 22;
function isFg(x, y) {
  const i = (y * w + x) * 4;
  const d = Math.hypot(px[i] - BG[0], px[i + 1] - BG[1], px[i + 2] - BG[2]);
  return d > TH;
}

/* 逐行/列前景占比；用 50% 阈值锁定面板本体（细弧线/云纹占比低被排除） */
const rows = [], cols = [];
for (let y = 0; y < h; y++) { let c = 0; for (let x = 0; x < w; x++) if (isFg(x, y)) c++; rows.push(c / w); }
for (let x = 0; x < w; x++) { let c = 0; for (let y = 0; y < h; y++) if (isFg(x, y)) c++; cols.push(c / h); }

function bounds(arr, len) {
  const RT = 0.50;
  let lo = 0, hi = len - 1;
  while (lo < len && arr[lo] < RT) lo++;
  while (hi > 0 && arr[hi] < RT) hi--;
  return [lo, hi];
}
const [top, bottom] = bounds(rows, h);
const [left, right] = bounds(cols, w);
console.log(`面板边界: left=${left} top=${top} right=${right} bottom=${bottom}`);
console.log(`         宽=${right - left + 1} 高=${bottom - top + 1}  (图 ${w}x${h})`);

/* 圆角半径：从面板顶行向下，记录每行前景左端 x 的内缩量 */
let radius = 0;
const curve = [];
for (let d = 0; d < 400; d++) {
  const y = top + d;
  if (y >= h) break;
  let x = left;
  while (x < right && !isFg(x, y)) x++;
  const inset = x - left;
  curve.push(inset);
  if (inset <= 1) { radius = d; break; }
}
console.log("近似圆角半径 =", radius, ` (占面板宽度 ${(radius / (right - left + 1) * 100).toFixed(1)}%)`);

console.log("\n顶部左边界内缩曲线:");
for (let d = 0; d < Math.min(60, curve.length); d += 4) {
  console.log(`  距面板顶 ${String(d).padStart(3)}  内缩=${curve[d]}`);
}
