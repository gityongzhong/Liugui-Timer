const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('LG', {
  isDesktop: true,
  platform: process.platform,

  /* 无边框窗口按钮 */
  minimizeWindow: () => ipcRenderer.send('win:minimize'),
  closeWindow: () => ipcRenderer.send('win:close'),
  toggleZoom: () => ipcRenderer.send('win:zoom-toggle'),
  getZoom: () => ipcRenderer.invoke('win:zoom-get'),
  onZoom: (fn) => { ipcRenderer.on('win:zoom', (e, v) => fn(!!v)); },

  /* 计时器预设存储 */
  loadTimers: () => ipcRenderer.invoke('timers:load'),
  saveTimers: (data) => ipcRenderer.invoke('timers:save', data),

  /* 悬浮窗开关 */
  openFloat: (opts) => ipcRenderer.invoke('float:open', opts || {}),
  closeFloat: () => ipcRenderer.invoke('float:close'),
  onFloatVisible: (fn) => { ipcRenderer.on('float:visible', (e, v) => fn(!!v)); },

  /* 倒计时状态：主窗口推送 / 悬浮窗接收 */
  pushState: (st) => ipcRenderer.send('timer:state', st),
  onState: (fn) => { ipcRenderer.on('timer:state', (e, st) => fn(st)); },
  onSyncRequest: (fn) => { ipcRenderer.on('float:sync-request', () => fn()); },

  /* 透明度 */
  setFloatOpacity: (v) => ipcRenderer.send('float:opacity', v),
  getFloatOpacity: () => ipcRenderer.invoke('float:opacity-get'),
  onOpacity: (fn) => { ipcRenderer.on('float:opacity', (e, v) => fn(v)); },

  /* PPT 放映自动计时：开关 + 放映状态推送 */
  getAuto: () => ipcRenderer.invoke('auto:get'),
  setAuto: (v) => ipcRenderer.invoke('auto:set', v),
  onSlideshow: (fn) => { ipcRenderer.on('ppt:slideshow', (e, v) => fn(!!v)); },

  /* 从悬浮窗唤回主窗口 */
  activateMain: () => ipcRenderer.send('main:activate'),

  /* 主窗口按内容自适应尺寸 */
  fitWindow: (size) => ipcRenderer.send('window:fit', size || {}),
  /* 主窗口最高能到多少（屏幕工作区高度）：列表据此判断要不要内部滚动 */
  maxWindowHeight: () => { try { return ipcRenderer.sendSync('win:maxh'); } catch (e) { return 0; } },

  log: (msg) => ipcRenderer.send('app:log', String(msg))
});
