/* 验证打包后（asar）koffi 能否正常加载并调用 user32
   用法：electron.exe tools/verify-asar.js <win-unpacked/resources 目录> */
'use strict';
const path = require('path');

const resDir = process.argv[2];
if (!resDir) { console.log('缺少参数：resources 目录'); process.exit(1); }
const asar = path.join(resDir, 'app.asar');

let ok = false, detail = '';
try {
  const koffi = require(path.join(asar, 'node_modules', 'koffi'));
  const u = koffi.load('user32.dll');
  const GetForegroundWindow = u.func('void *GetForegroundWindow()');
  const GetClassNameW = u.func('int GetClassNameW(void *hWnd, _Out_ char16_t *buf, int nMax)');
  const buf = Buffer.alloc(1024);
  const hwnd = GetForegroundWindow();
  const n = hwnd ? GetClassNameW(hwnd, buf, 512) : 0;
  const cls = n > 0 ? buf.toString('utf16le', 0, n * 2) : '(无前台窗口)';
  ok = true;
  detail = 'koffi ' + (koffi.version || '') + ' 调用 user32 成功，前台类名=' + cls;
} catch (e) {
  detail = e.message.split('\n')[0];
}
console.log('[verify-asar] ' + (ok ? '✅ asar 内 koffi 加载并调用成功' : '❌ 失败') + ' — ' + detail);
process.exit(0);
