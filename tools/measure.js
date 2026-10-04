/* 量界面上若干控件的真实渲染尺寸（紧凑态 + 全屏态）
 * 用法：electron tools/measure.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const TEST_DATA = path.join(__dirname, '..', '.test-userdata');
try { fs.rmSync(TEST_DATA, { recursive: true, force: true }); } catch (e) {}
app.setPath('userData', TEST_DATA);
app.commandLine.appendSwitch('no-sandbox');
require(path.join(__dirname, '..', 'main.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);
const allWins = () => BrowserWindow.getAllWindows();

const MEASURE = `(function(){
  function m(sel, label){
    var el = document.querySelector(sel);
    if(!el) return { label: label, h: '未找到' };
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    return {
      label: label,
      h: Math.round(r.height * 10) / 10,
      w: Math.round(r.width * 10) / 10,
      padY: cs.paddingTop + ' + ' + cs.paddingBottom,
      font: cs.fontSize,
      line: cs.lineHeight,
      radius: cs.borderTopLeftRadius
    };
  }
  return JSON.stringify({
    zoomed: document.body.classList.contains('zoomed'),
    list: [
      m('.add', '新建计时器'),
      m('#floatBtn', '投到悬浮窗'),
      m('#start', '开始'),
      m('#list .item', '列表条目')
    ]
  });
})()`;

async function waitFor(fn, tries = 120, step = 100) {
  for (let i = 0; i < tries; i++) {
    const v = fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

function dump(title, raw) {
  const d = JSON.parse(raw);
  console.log('\n【' + title + '】' + (d.zoomed ? '（全屏态）' : '（紧凑态）'));
  d.list.forEach((x) => {
    console.log('  ' + x.label.padEnd(10, ' ') +
      ' 高 ' + String(x.h).padStart(6) + 'px' +
      ' 宽 ' + String(x.w).padStart(6) + 'px' +
      ' | padding-y ' + String(x.padY).padEnd(14) +
      ' | 字号 ' + String(x.font).padEnd(7) +
      ' | line-height ' + x.line +
      ' | 圆角 ' + x.radius);
  });
}

async function run() {
  const mainWin = await waitFor(() => allWins()[0]);
  if (!mainWin) { console.log('主窗口没起来'); app.quit(); return; }
  await waitFor(() => !mainWin.webContents.isLoading(), 150, 100);
  await sleep(1200);

  dump('紧凑态', await js(mainWin, MEASURE));

  const cur = mainWin.getBounds();
  console.log('\n  窗口尺寸 ' + cur.width + ' x ' + cur.height);

  await js(mainWin, `document.getElementById('dz').click()`);
  await sleep(1200);
  dump('全屏态', await js(mainWin, MEASURE));

  const z = mainWin.getBounds();
  console.log('\n  窗口尺寸 ' + z.width + ' x ' + z.height);

  fs.writeFileSync(path.join(__dirname, '..', 'shots', '主界面-全屏.png'),
    (await mainWin.webContents.capturePage()).toPNG());
  console.log('\n  已截图 shots/主界面-全屏.png');
  app.quit();
}

app.whenReady().then(run);
