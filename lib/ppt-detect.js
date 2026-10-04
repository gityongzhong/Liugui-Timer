'use strict';
/* 幻灯片放映检测（Windows）
 *
 * 判据：PowerPoint 进入放映态时会创建一个类名为 "screenClass" 的顶层窗口
 *       （编辑态不存在该窗口），退出放映即销毁 —— 所以「枚举可见顶层窗口，
 *       看有没有 screenClass」就是可靠且轻量的放映判据，且不依赖前台焦点
 *       （用户切窗口时不会误判为退出）。
 *
 * 实现：koffi 调 user32.dll（EnumWindows / GetClassNameW / IsWindowVisible），
 *       纯读取，不注入、不挂钩、不联网。
 * 代价：一次枚举约 0.1ms 级，轮询 1s 一次可忽略。
 */

const SLIDESHOW_CLASSES = [
  'screenClass'      // PowerPoint 放映窗口（Office 2016/2019/365）
];

/* 类名不够唯一时的补充判据：类名 + 标题子串（2026-10-04 真机实测 WPS）。
 * WPS 演示（Qt 框架）放映窗口类名是通用的 Qt5QWindowIcon，
 * 但标题固定含「幻灯片放映」（如 "WPS演示 幻灯片放映 - [演示文稿1]"），
 * 编辑态主窗口类名是 PP11FrameClass，不会命中。 */
const SLIDESHOW_CLASS_TITLE = [
  { cls: 'Qt5QWindowIcon', titleIncludes: '幻灯片放映' }  // WPS 演示放映
];

let api;
function init() {
  if (api !== undefined) return api;
  try {
    const koffi = require('koffi');
    const u = koffi.load('user32.dll');
    const EnumProc = koffi.proto('bool EnumWindowsProc(void *hWnd, intptr_t lParam)');
    const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    api = {
      koffi: koffi,
      EnumProc: EnumProc,
      RECT: RECT,
      EnumWindows: u.func('bool EnumWindows(EnumWindowsProc *cb, intptr_t lParam)'),
      GetClassNameW: u.func('int GetClassNameW(void *hWnd, _Out_ char16_t *buf, int nMax)'),
      IsWindowVisible: u.func('bool IsWindowVisible(void *hWnd)'),
      GetWindowTextW: u.func('int GetWindowTextW(void *hWnd, _Out_ char16_t *buf, int nMax)'),
      GetWindowRect: u.func('int GetWindowRect(void *hWnd, _Out_ RECT *rect)')
    };
  } catch (e) {
    api = null;      // 非 Windows 或 koffi 不可用 → 功能自动降级关闭
  }
  return api;
}

function className(a, hwnd) {
  const buf = Buffer.alloc(1024);
  const n = a.GetClassNameW(hwnd, buf, 512);
  return n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
}

function winTitle(a, hwnd) {
  const buf = Buffer.alloc(2048);
  const n = a.GetWindowTextW(hwnd, buf, 1024);
  return n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
}

/* 放映窗口判据：纯类名 或 类名+标题子串 */
function isSlideshowWindow(cls, title) {
  if (SLIDESHOW_CLASSES.indexOf(cls) >= 0) return true;
  for (let j = 0; j < SLIDESHOW_CLASS_TITLE.length; j++) {
    const m = SLIDESHOW_CLASS_TITLE[j];
    if (cls === m.cls && title.indexOf(m.titleIncludes) >= 0) return true;
  }
  return false;
}

/* 枚举可见顶层窗口，返回 [{ cls, title }]（可选只取某类名） */
function listWindows(onlyVisible) {
  const a = init();
  if (!a) return [];
  const out = [];
  const cb = a.koffi.register(function (hwnd) {
    try {
      if (!onlyVisible || a.IsWindowVisible(hwnd)) {
        const cls = className(a, hwnd);
        // 标题获取很廉价（微秒级），统一取，供「类名+标题」双判据使用
        const title = winTitle(a, hwnd);
        out.push({ cls: cls, title: title });
      }
    } catch (e) {}
    return true;   // 继续枚举
  }, a.koffi.pointer(a.EnumProc));
  try { a.EnumWindows(cb, 0); } finally { a.koffi.unregister(cb); }
  return out;
}

/* 当前是否处于幻灯片放映。
   override 仅供自动化测试注入（null = 走真实窗口检测），生产环境永远是 null。 */
let override = null;

function isSlideshowActive() {
  if (override !== null) return override;
  const a = init();
  if (!a) return false;
  const list = listWindows(true);
  for (let i = 0; i < list.length; i++) {
    if (isSlideshowWindow(list[i].cls, list[i].title)) return true;
  }
  return false;
}

/* 放映窗口的屏幕坐标（物理像素）{x,y,width,height}；不在放映返回 null。
   供主进程判断放映在哪块显示器上（多屏：悬浮窗躲开放映屏）。 */
function getSlideshowRect() {
  const a = init();
  if (!a) return null;
  let hit = null;
  const cb = a.koffi.register(function (hwnd) {
    try {
      if (!a.IsWindowVisible(hwnd)) return true;
      const cls = className(a, hwnd);
      if (!isSlideshowWindow(cls, winTitle(a, hwnd))) return true;
      const rc = new a.RECT();
      if (a.GetWindowRect(hwnd, rc)) {
        hit = { x: rc.left, y: rc.top, width: rc.right - rc.left, height: rc.bottom - rc.top };
      }
    } catch (e) {}
    return !hit;   // 找到就提前结束枚举
  }, a.koffi.pointer(a.EnumProc));
  try { a.EnumWindows(cb, 0); } finally { a.koffi.unregister(cb); }
  return hit;
}

function setOverride(v) {
  override = (v === null || v === undefined) ? null : !!v;
}

/* 是否可用（Windows + koffi 正常） */
function available() { return !!init(); }

module.exports = { available, isSlideshowActive, getSlideshowRect, setOverride, listWindows, SLIDESHOW_CLASSES, SLIDESHOW_CLASS_TITLE };
