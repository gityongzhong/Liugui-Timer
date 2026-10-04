/* 截取主窗口初始待机状态（用于确认界面文案） */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('no-sandbox');
require(path.join(__dirname, '..', 'main.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await sleep(1800);
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { console.log('主窗口未创建'); return app.exit(1); }
  const OUT = path.join(__dirname, '..', 'shots');
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, '主界面-初始待机.png'), img.toPNG());
  const status = await win.webContents.executeJavaScript(
    `JSON.stringify(document.getElementById('status').textContent)`);
  console.log('初始状态文字 =', status);
  console.log('已保存 shots/主界面-初始待机.png');
  app.exit(0);
});
