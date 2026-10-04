'use strict';
/* WPS/PowerPoint 放映窗口类名探测器
 * 连续监听 N 秒（默认 45s），每 400ms 枚举可见顶层窗口，
 * 一旦出现「基线快照里没有的」新类名就打印出来 ——
 * 用户在此期间打开 WPS 演示按 F5 放映，新增的那个类名就是放映窗口。
 * 用法：node tools/probe-wps.js [监听秒数]
 */
const path = require('path');
const koffi = require(path.join(__dirname, '..', 'node_modules', 'koffi'));

const SECONDS = parseInt(process.argv[2], 10) || 45;

const u = koffi.load('user32.dll');
const EnumProc = koffi.proto('bool EnumWindowsProc(void *hWnd, intptr_t lParam)');
const EnumWindows = u.func('bool EnumWindows(EnumWindowsProc *cb, intptr_t lParam)');
const GetClassNameW = u.func('int GetClassNameW(void *hWnd, _Out_ char16_t *buf, int nMax)');
const GetWindowTextW = u.func('int GetWindowTextW(void *hWnd, _Out_ char16_t *buf, int nMax)');
const IsWindowVisible = u.func('bool IsWindowVisible(void *hWnd)');

function snapshot() {
  const out = new Map(); // cls -> title
  const cb = koffi.register(function (hwnd) {
    try {
      if (IsWindowVisible(hwnd)) {
        const b = Buffer.alloc(1024);
        const n = GetClassNameW(hwnd, b, 512);
        if (n > 0) {
          const cls = b.toString('utf16le', 0, n * 2);
          if (!out.has(cls)) {
            const b2 = Buffer.alloc(2048);
            const n2 = GetWindowTextW(hwnd, b2, 1024);
            out.set(cls, n2 > 0 ? b2.toString('utf16le', 0, n2 * 2) : '');
          }
        }
      }
    } catch (e) {}
    return true;
  }, koffi.pointer(EnumProc));
  try { EnumWindows(cb, 0); } finally { koffi.unregister(cb); }
  return out;
}

console.log('[probe] 基线快照（此刻屏幕上的窗口类名）：');
const baseline = snapshot();
for (const [cls, title] of baseline) console.log('  ' + cls + '  |  ' + title);

console.log('\n[probe] 开始监听 ' + SECONDS + ' 秒 —— 请现在打开 WPS 演示并按 F5 放映！\n');
const seen = new Set(baseline.keys());
const t0 = Date.now();
let found = [];
while (Date.now() - t0 < SECONDS * 1000) {
  const cur = snapshot();
  for (const [cls, title] of cur) {
    if (!seen.has(cls)) {
      seen.add(cls);
      const ts = ((Date.now() - t0) / 1000).toFixed(1);
      const line = '[' + ts + 's] 新窗口类名: ' + cls + '  |  标题: ' + title;
      console.log(line);
      found.push({ cls: cls, title: title });
    }
  }
  // 也记录消失（可以辅助判断哪个类名随放映退出而销毁）
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
}

console.log('\n[probe] 结束。监听期间新增的窗口类名共 ' + found.length + ' 个：');
for (const f of found) console.log('  ' + f.cls + '  |  ' + f.title);
if (found.length === 0) console.log('  （无 —— 放映可能没启动成功，或窗口不在本会话枚举范围内）');
