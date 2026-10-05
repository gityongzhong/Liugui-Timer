const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWin = null;
let floatWin = null;
let lastState = null;          // 最近一次的倒计时状态
let floatOpacity = 0.88;       // 悬浮窗透明度 0.2 ~ 1
let didFitMain = false;        // 主窗口是否已按内容自适应过（用于只居中一次）
let zoomed = false;            // 主窗口是否处于放大态
let zoomRestore = null;        // 放大前的窗口位置尺寸

const LOG_FILE = path.join(app.getPath('userData'), 'launch.log');
const CFG_FILE = path.join(app.getPath('userData'), 'float-window.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

const detect = require('./lib/ppt-detect');
const PPT_POLL_MS = Number(process.env.LG_PPT_POLL) || 1000;   // 轮询间隔（测试可加速）
let settings = { pptAuto: true };   // PPT 放映时自动计时（默认开）
let pptActive = false;              // 上一次检测到的放映状态
let pptTimer = null;                // 轮询定时器
let pptAutoOpening = false;         // 放映触发的悬浮窗待创建 → 用演讲者屏位置

/* 悬浮窗宽度按「只比倒计时数字宽一点」定：
   数字 56px 实测「00:00」=139.8px、最长「599:59」=171.4px，
   取 200 - 左右 padding 12*2 = 内容 176px，容得下最长数字且不浪费 */
const FLOAT_W = 200;
const FLOAT_H = 132;
const EDGE_PAD = 0;           // 主窗口留白由页面自己控制（透明窗口，卡片带阴影）
const TIMERS_FILE = path.join(app.getPath('userData'), 'timers.json');

/* 首次运行的示例预设：按会议类型分组 */
const SEED_TIMERS = {
  cat: '周例会',
  activeId: 's1',
  timers: [
    { id: 's1', name: '议题一 · 工作汇报', sec: 600, cat: '周例会' },
    { id: 's2', name: '议题二 · 问题讨论', sec: 900, cat: '周例会' },
    { id: 's3', name: '议题三 · 下步安排', sec: 300, cat: '周例会' },
    { id: 's4', name: '月度总结', sec: 1800, cat: '月度会' },
    { id: 's5', name: '重点指标通报', sec: 1200, cat: '月度会' },
    { id: 's6', name: '季度总结', sec: 2700, cat: '季度会' },
    { id: 's7', name: '下季度规划', sec: 1800, cat: '季度会' }
  ]
};

function log(msg) {
  const line = new Date().toISOString() + '  ' + msg + '\n';
  try { fs.appendFileSync(LOG_FILE, line); } catch (e) {}
  console.log('[流晷]', msg);
}

function clamp01(v) {
  v = Number(v);
  if (!isFinite(v)) return 0.88;
  if (v < 0.2) return 0.2;
  if (v > 1) return 1;
  return v;
}

function readCfg() {
  try { return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) || {}; } catch (e) { return {}; }
}
function writeCfg(patch) {
  const c = Object.assign(readCfg(), patch);
  try {
    fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true });
    fs.writeFileSync(CFG_FILE, JSON.stringify(c));
  } catch (e) {}
  return c;
}

/* 应用设置（目前只有「PPT 放映时自动计时」） */
function readSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {}; } catch (e) { s = {}; }
  return { pptAuto: s.pptAuto !== false };      // 默认开启
}
function writeSettings(patch) {
  settings = Object.assign(readSettings(), patch);
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings));
  } catch (e) {}
  return settings;
}

/* ---------------- PPT 放映自动计时 ---------------- */

/* 每秒看一眼有没有放映窗口；状态变化时通知主窗口去「自动开始 / 自动暂停」 */
function startPptWatch() {
  if (pptTimer) return;
  pptTimer = setInterval(() => {
    let now = false;
    try { now = detect.isSlideshowActive(); } catch (e) { now = false; }
    if (now === pptActive) return;               // 状态没变，什么都不做
    pptActive = now;
    log('放映状态 → ' + (now ? '开始放映' : '结束放映'));
    if (!settings.pptAuto) return;               // 功能关闭：只跟踪状态，不触发动作
    if (now) {
      // 多屏：放映屏在别处时，把已存在的悬浮窗挪到演讲者屏；
      // 悬浮窗还没创建的话，标记待创建，createFloat 时用演讲者屏位置
      const moved = ensureFloatOnPresenterScreen();
      if (!moved && !floatWin) pptAutoOpening = true;
    }
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('ppt:slideshow', now);
    }
  }, PPT_POLL_MS);
}

function notifyMain(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send(channel, payload);
  }
}

function defaultFloatPos(w, h) {
  let wa = { width: 1920, height: 1080 };
  try { wa = screen.getPrimaryDisplay().workAreaSize; } catch (e) {}
  return { x: Math.max(0, wa.width - w - 40), y: 64 };
}

/* ---------------- 多屏：悬浮窗躲开放映屏 ----------------
 * 会议场景：PPT 放映在投影仪/副屏，主持人看的应该是自己面前的屏。
 * 判定：放映窗口在哪块显示器（getDisplayMatching），悬浮窗避开它；
 * 候选演讲者屏优先主屏。单屏环境放映屏=唯一屏 → 不挪，行为不变。
 * 注意：GetWindowRect 返回物理像素，Electron 显示器坐标是 DIP，
 * 需按该屏 scaleFactor 折算后再判断中心点归属。 */

function slideshowDisplay() {
  try {
    if (!detect.available()) return null;
    const r = detect.getSlideshowRect();
    if (!r || r.width <= 0 || r.height <= 0) return null;
    const displays = screen.getAllDisplays();
    for (let i = 0; i < displays.length; i++) {
      const d = displays[i];
      const f = d.scaleFactor || 1;
      const cx = (r.x + r.width / 2) / f;
      const cy = (r.y + r.height / 2) / f;
      const b = d.bounds;
      if (cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height) return d;
    }
    // 中心点没落进任何已知屏（极少见）：退而求其次按包围盒匹配
    const dip = { x: r.x, y: r.y, width: r.width, height: r.height };
    return screen.getDisplayMatching(dip) || null;
  } catch (e) { return null; }
}

/* 演讲者屏 = 放映屏之外优先主屏的那块；单屏或不在放映返回 null */
function presenterDisplay() {
  const ss = slideshowDisplay();
  if (!ss) return null;
  const cands = screen.getAllDisplays().filter(d => d.id !== ss.id);
  if (!cands.length) return null;
  let primaryId = null;
  try { primaryId = screen.getPrimaryDisplay().id; } catch (e) {}
  return cands.find(d => d.id === primaryId) || cands[0];
}

/* 演讲者屏上的默认停靠位置（右上角，与 defaultFloatPos 同款） */
function presenterFloatPos(pd, w, h) {
  const wa = pd.workArea || pd.bounds;
  return { x: wa.x + Math.max(0, wa.width - w - 40), y: wa.y + 64 };
}

function posInDisplay(pos, w, h, d) {
  const b = d.bounds;
  return pos.x >= b.x - 60 && pos.x < b.x + b.width &&
         pos.y >= b.y - 60 && pos.y < b.y + b.height;
}

/* 放映开始时调用：若悬浮窗已存在且正压在放映屏上，挪到演讲者屏右上角 */
function ensureFloatOnPresenterScreen() {
  const pd = presenterDisplay();
  if (!pd) return false;
  try {
    if (floatWin && !floatWin.isDestroyed()) {
      const b = floatWin.getBounds();
      if (screen.getDisplayMatching(b).id === slideshowDisplay().id) {
        const p = presenterFloatPos(pd, b.width, b.height);
        floatWin.setBounds({ x: Math.round(p.x), y: Math.round(p.y), width: b.width, height: b.height });
        log('悬浮窗已挪到演讲者屏 @' + Math.round(p.x) + ',' + Math.round(p.y));
        return true;
      }
      return false;   // 悬浮窗本来就不在放映屏，尊重用户摆放
    }
  } catch (e) {}
  return false;
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 820,
    height: 560,
    minWidth: 470,
    minHeight: 400,
    title: '流晷计时器',
    backgroundColor: '#00000000',
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWin.setMenuBarVisibility(false);
  mainWin.loadFile(path.join(__dirname, 'ui', 'index.html'));

  mainWin.once('ready-to-show', () => {
    mainWin.show();
    log('主窗口已显示');
  });

  mainWin.webContents.on('did-finish-load', () => log('页面加载完成'));
  mainWin.webContents.on('did-fail-load', (e, code, desc, url) => {
    log('页面加载失败 code=' + code + ' desc=' + desc + ' url=' + url);
  });
  mainWin.webContents.on('render-process-gone', (e, d) => log('渲染进程异常: ' + JSON.stringify(d)));
  mainWin.webContents.on('console-message', (e, level, message, line, sourceId) => {
    log('页面控制台[' + level + '] ' + message + ' @' + sourceId + ':' + line);
  });

  mainWin.on('closed', () => {
    mainWin = null;
    // 主窗口关掉 = 退出软件，悬浮窗一并关闭
    if (floatWin && !floatWin.isDestroyed()) floatWin.close();
  });

  didFitMain = false;
  zoomed = false;
  zoomRestore = null;
}

/* 放大 / 还原：透明无边框窗口不用系统最大化，自己 setBounds 到工作区更稳 */
function toggleZoom() {
  if (!mainWin || mainWin.isDestroyed()) return;

  if (zoomed) {
    if (zoomRestore) { try { mainWin.setBounds(zoomRestore); } catch (e) {} }
    zoomed = false;
  } else {
    zoomRestore = mainWin.getBounds();
    let wa = null;
    try { wa = screen.getDisplayMatching(zoomRestore).workArea; } catch (e) {}
    if (!wa) { try { wa = screen.getPrimaryDisplay().workArea; } catch (e) {} }
    if (wa) {
      try {
        mainWin.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height });
      } catch (e) {}
    }
    zoomed = true;
  }

  notifyMain('win:zoom', zoomed);
  log('主窗口' + (zoomed ? '已放大到工作区' : '已还原'));
}

function createFloat(usePresenter) {
  if (floatWin && !floatWin.isDestroyed()) {
    floatWin.show();
    notifyMain('float:visible', true);
    return floatWin;
  }

  const cfg = readCfg();
  const w = FLOAT_W;
  const h = FLOAT_H;
  const hasPos = typeof cfg.x === 'number' && typeof cfg.y === 'number';
  let pos;
  if (hasPos) {
    pos = { x: cfg.x, y: cfg.y };
    // 窗口尺寸变过（例如把宽度由 320 调窄到 200）：旧窗口若贴着屏幕右边，
    // 就保持「右边缘不动」，否则新版打开会离屏幕右侧空出一大截
    const ow = Number(cfg.w);
    if (isFinite(ow) && ow > 0 && ow !== w) {
      const d = defaultFloatPos(ow, h);
      if (Math.abs((cfg.x + ow) - (d.x + ow)) <= 24) pos.x = cfg.x + (ow - w);
    }
  } else {
    pos = defaultFloatPos(w, h);
  }

  // 多屏：放映触发的自动创建 → 位置若不在演讲者屏，改停靠到演讲者屏右上角
  if (usePresenter) {
    const pd = presenterDisplay();
    if (pd && !posInDisplay(pos, w, h, pd)) {
      pos = presenterFloatPos(pd, w, h);
      log('放映自动启动：悬浮窗定位到演讲者屏 @' + Math.round(pos.x) + ',' + Math.round(pos.y));
    }
  }
  floatOpacity = clamp01(cfg.opacity != null ? cfg.opacity : floatOpacity);

  floatWin = new BrowserWindow({
    width: w,
    height: h,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    title: '流晷 · 悬浮',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // 最高层级：压得住 PPT 放映窗口
  floatWin.setAlwaysOnTop(true, 'screen-saver');
  try { floatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) {}

  floatWin.loadFile(path.join(__dirname, 'ui', 'float.html'));

  floatWin.webContents.on('did-finish-load', () => {
    if (!floatWin || floatWin.isDestroyed()) return;
    floatWin.setOpacity(floatOpacity);
    if (lastState) floatWin.webContents.send('timer:state', lastState);
    notifyMain('float:sync-request', null);   // 让主窗口立刻补推一次状态
    floatWin.show();
    notifyMain('float:visible', true);
    log('悬浮窗已就绪 opacity=' + floatOpacity.toFixed(2));
  });

  const save = () => {
    if (!floatWin || floatWin.isDestroyed()) return;
    const b = floatWin.getBounds();
    writeCfg({ x: b.x, y: b.y, w: b.width, h: b.height });
  };
  floatWin.on('moved', save);

  floatWin.on('closed', () => {
    floatWin = null;
    notifyMain('float:visible', false);
    log('悬浮窗已关闭');
  });

  log('悬浮窗已创建 ' + w + 'x' + h + ' @' + pos.x + ',' + pos.y);
  return floatWin;
}

app.whenReady().then(() => {
  log('应用启动, userData=' + app.getPath('userData'));
  settings = readSettings();
  log('PPT 自动计时=' + (settings.pptAuto ? '开' : '关') +
      ' / 放映检测模块=' + (detect.available() ? '可用' : '不可用'));
  createMain();
  startPptWatch();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMain();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ---------------- IPC ---------------- */

/* PPT 放映自动计时：开关读写 */
ipcMain.handle('auto:get', () => ({ pptAuto: !!settings.pptAuto }));
ipcMain.handle('auto:set', (e, v) => {
  writeSettings({ pptAuto: !!v });
  log('PPT 自动计时已' + (settings.pptAuto ? '开启' : '关闭'));
  return { pptAuto: !!settings.pptAuto };
});

ipcMain.handle('float:open', () => {
  const auto = pptAutoOpening;         // 放映触发的自动打开 → 用演讲者屏定位
  pptAutoOpening = false;
  createFloat(auto);
  return true;
});

ipcMain.handle('float:close', () => {
  if (floatWin && !floatWin.isDestroyed()) floatWin.close();
  floatWin = null;
  return true;
});

ipcMain.handle('float:opacity-get', () => floatOpacity);

ipcMain.on('timer:state', (e, st) => {
  lastState = st;
  if (floatWin && !floatWin.isDestroyed()) floatWin.webContents.send('timer:state', st);
});

ipcMain.on('float:opacity', (e, v) => {
  floatOpacity = clamp01(v);
  writeCfg({ opacity: floatOpacity });
  if (floatWin && !floatWin.isDestroyed()) floatWin.setOpacity(floatOpacity);
  notifyMain('float:opacity', floatOpacity);
});

/* ---------------- 计时器预设存储 ---------------- */

ipcMain.handle('timers:load', () => {
  try {
    const d = JSON.parse(fs.readFileSync(TIMERS_FILE, 'utf8'));
    if (d && Array.isArray(d.timers) && d.timers.length) return d;
  } catch (e) {}
  return SEED_TIMERS;
});

ipcMain.handle('timers:save', (e, data) => {
  try {
    if (!data || !Array.isArray(data.timers)) return false;
    fs.mkdirSync(path.dirname(TIMERS_FILE), { recursive: true });
    fs.writeFileSync(TIMERS_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (err) { return false; }
});

/* ---------------- 无边框窗口的自绘按钮 ---------------- */

ipcMain.on('win:minimize', () => {
  if (mainWin && !mainWin.isDestroyed()) mainWin.minimize();
});

ipcMain.on('win:close', () => {
  if (mainWin && !mainWin.isDestroyed()) mainWin.close();
});

/* 放大 / 还原 */
ipcMain.on('win:zoom-toggle', () => toggleZoom());
ipcMain.handle('win:zoom-get', () => zoomed);

/* 主窗口能长到多高（当前所在屏幕的工作区高度）：渲染进程据此决定列表是否需要内部滚动 */
function currentWorkArea() {
  try {
    if (mainWin && !mainWin.isDestroyed()) {
      const b = mainWin.getBounds();
      const d = screen.getDisplayMatching(b);
      if (d && d.workArea) return d.workArea;
    }
  } catch (e) {}
  try { return screen.getPrimaryDisplay().workArea; } catch (e) {}
  return null;
}

ipcMain.on('win:maxh', (e) => {
  const wa = currentWorkArea();
  e.returnValue = wa ? Math.round(wa.height) : 1100;
});

/* 主窗口按内容尺寸自适应（无边框透明窗口，setBounds 比 setContentSize 可靠） */
ipcMain.on('window:fit', (e, size) => {
  if (!mainWin || mainWin.isDestroyed() || !size) return;
  if (zoomed) return;                 // 放大态下不要被内容尺寸拽回去
  const w = Number(size.w), h = Number(size.h);
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return;

  /* 高度上限跟着「窗口当前所在的那块屏」走：多屏时副屏可能比主屏高/宽，
     用主屏数据会把窗口硬拽回主屏（用户反馈的 bug） */
  const wa = currentWorkArea();
  const maxW = wa ? Math.round(wa.width) : 1600;
  const maxH = wa ? Math.round(wa.height) : 1100;

  const cw = Math.min(Math.max(Math.round(w) + EDGE_PAD * 2, 470), maxW);
  const ch = Math.min(Math.max(Math.round(h) + EDGE_PAD * 2, 400), maxH);

  const b = mainWin.getBounds();
  if (b.width === cw && b.height === ch) return;   // 尺寸没变就不折腾窗口

  let nx = b.x, ny = b.y;
  if (wa) {
    /* 窗口当前完整落在工作区内 → 只改尺寸、位置一律不动，避免每次重排都被挪走 */
    const inside = b.x >= wa.x - 1 && b.y >= wa.y - 1 &&
                   b.x + b.width <= wa.x + wa.width + 1 &&
                   b.y + b.height <= wa.y + wa.height + 1;
    if (!inside) {
      // 只有真的越界了才夹回当前屏幕工作区
      nx = Math.min(Math.max(b.x, wa.x), Math.max(wa.x, wa.x + wa.width - cw));
      ny = Math.min(Math.max(b.y, wa.y), Math.max(wa.y, wa.y + wa.height - ch));
    }
  }
  try { mainWin.setBounds({ x: nx, y: ny, width: cw, height: ch }); } catch (err) {}

  if (!didFitMain) {
    didFitMain = true;
    /* 首次自适应才居中。窗口若已被（用户或系统）放到别处，就不要抢它的位置 */
    try { mainWin.center(); } catch (err) {}
    log('窗口已按内容自适应 ' + cw + 'x' + ch + '（界面 ' + Math.round(w) + 'x' + Math.round(h) + '）');
  }
});

ipcMain.on('main:activate', () => {  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  }
});

ipcMain.on('app:log', (e, msg) => log('前端: ' + msg));

/* 用系统默认浏览器打开链接：只放行 https://github.com/，避免被滥用成任意协议跳转 */
ipcMain.on('shell:open-external', (e, url) => {
  try {
    if (/^https:\/\/github\.com\//i.test(url)) shell.openExternal(url);
  } catch (err) {}
});
