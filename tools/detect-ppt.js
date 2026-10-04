/* 探测当前窗口环境：列出可见顶层窗口类名 + 放映状态
   用法：node tools/detect-ppt.js
   排障：想看 PowerPoint 放映态时屏幕上有哪些窗口，就放映着跑这个脚本 */
'use strict';
const d = require('../lib/ppt-detect');

console.log('koffi/模块可用:', d.available());
console.log('目标类名:', d.SLIDESHOW_CLASSES.join(', '));
console.log('');

const list = d.listWindows(true);
const stat = {};
list.forEach(function (w) { stat[w.cls] = (stat[w.cls] || 0) + 1; });
const rows = Object.keys(stat).sort(function (a, b) { return stat[b] - stat[a]; });
console.log('可见顶层窗口类名（' + rows.length + ' 种 / ' + list.length + ' 个窗口）:');
rows.forEach(function (c) { console.log('  ' + c + '  ×' + stat[c]); });

console.log('');
console.log('★ 是否正在放映:', d.isSlideshowActive());
