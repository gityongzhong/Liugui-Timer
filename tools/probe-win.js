/* 最小验证：koffi 调 user32 读取窗口信息（先证明 FFI 管道可用）
   用法：node tools/probe-win.js  （或 Electron 内核跑，行为一致）*/
'use strict';
const koffi = require('koffi');

const u = koffi.load('user32.dll');
const GetForegroundWindow = u.func('void *GetForegroundWindow()');
const GetClassNameW = u.func('int GetClassNameW(void *hWnd, _Out_ char16_t *buf, int nMax)');
const GetWindowTextW = u.func('int GetWindowTextW(void *hWnd, _Out_ char16_t *buf, int nMax)');

function className(hwnd) {
  const buf = Buffer.alloc(1024);
  const n = GetClassNameW(hwnd, buf, 512);
  return n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
}
function winTitle(hwnd) {
  const buf = Buffer.alloc(2048);
  const n = GetWindowTextW(hwnd, buf, 1024);
  return n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
}

const hwnd = GetForegroundWindow();
console.log('GetForegroundWindow 类型 =', typeof hwnd, '值 =', hwnd);
console.log('前台窗口类名 =', JSON.stringify(className(hwnd)));
console.log('前台窗口标题 =', JSON.stringify(winTitle(hwnd)));
console.log('koffi 版本 =', koffi.version);
