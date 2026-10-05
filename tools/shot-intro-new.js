/* 界面介绍图制作：用真实 Electron 渲染最新界面，抓取主界面 + 深色底合成横排介绍图 */
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots');
const TEST_DATA = path.join(ROOT, '.test-userdata');
try { fs.rmSync(TEST_DATA, { recursive: true, force: true }); } catch (e) {}
app.setPath('userData', TEST_DATA);

require(path.join(ROOT, 'main.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const allWins = () => BrowserWindow.getAllWindows();
const js = (w, c) => w.webContents.executeJavaScript(c);

async function waitFor(fn, tries = 150, step = 100) {
  for (let i = 0; i < tries; i++) { const v = fn(); if (v) return v; await sleep(step); }
  return null;
}

async function save(win, name) {
  const img = await win.webContents.capturePage();
  const p = path.join(OUT, name);
  fs.writeFileSync(p, img.toPNG());
  console.log('已截图:', name, img.getSize().width + 'x' + img.getSize().height);
  return img;
}

app.whenReady().then(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const win = await waitFor(() => allWins()[0], 150, 100);
  if (!win) { console.log('主窗口未创建'); return app.exit(1); }
  await waitFor(() => win && !win.webContents.isLoading(), 150, 100);
  await sleep(1800);

  /* 1) 初始待机（主界面） */
  await save(win, '介绍图-主界面.png');

  /* 2) 计时中：3 分钟，跑到剩 2:4x */
  await js(win, `(function(){
    var m=document.getElementById('min'), s=document.getElementById('sec');
    if(m){ m.value=3; m.dispatchEvent(new Event('input',{bubbles:true})); }
    if(s){ s.value=0; s.dispatchEvent(new Event('input',{bubbles:true})); }
    document.getElementById('start').click();
    return true;
  })()`);
  await sleep(2200);
  await save(win, '介绍图-计时中.png');

  /* 3) 暂停 */
  await js(win, `(function(){ document.getElementById('pause').click(); return true; })()`);
  await sleep(700);
  await save(win, '介绍图-已暂停.png');

  /* 4) 放大态（全屏投屏） */
  await js(win, `(function(){
    var m=document.getElementById('min');
    if(m){ m.value=5; m.dispatchEvent(new Event('input',{bubbles:true})); }
    document.getElementById('start').click();
    return true;
  })()`);
  await sleep(600);
  await js(win, `document.getElementById('dz').click()`);
  await sleep(1800);
  await save(win, '介绍图-全屏投屏.png');

  /* 5) 还原 + 赞赏弹层 */
  await js(win, `document.getElementById('dz').click()`);
  await sleep(1200);
  await js(win, `document.getElementById('supportBtn').click()`);
  await sleep(1000);
  await save(win, '介绍图-支持作者.png');

  console.log('\n全部截图完成');
  setTimeout(() => app.exit(0), 400);
}).catch((e) => {
  console.log('异常: ' + (e && e.stack || e));
  app.exit(2);
});
