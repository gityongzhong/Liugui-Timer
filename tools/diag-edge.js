/* 诊断：主窗口四周那圈「隐约的黑色透明阴影」到底是什么
 * 逐点采样窗口边缘像素的 RGBA，并输出浅底合成图便于肉眼比对。
 */
const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const TEST_DATA = path.join(__dirname, '..', '.test-userdata');
try { fs.rmSync(TEST_DATA, { recursive: true, force: true }); } catch (e) {}
app.setPath('userData', TEST_DATA);
app.commandLine.appendSwitch('no-sandbox');
require(path.join(__dirname, '..', 'main.js'));

const OUT = path.join(__dirname, '..', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const allWins = () => BrowserWindow.getAllWindows();
const js = (w, c) => w.webContents.executeJavaScript(c);

async function waitFor(fn, tries = 120, step = 100) {
  for (let i = 0; i < tries; i++) { const v = fn(); if (v) return v; await sleep(step); }
  return null;
}

function composeOnLight(bmp, sz) {
  const { nativeImage } = require('electron');
  const W = sz.width, H = sz.height;
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0, j = 0; i < W * H; i++, j += 4) {
    const a = bmp[j + 3] / 255;
    out[j]     = Math.round(bmp[j]     * a + 238 * (1 - a));
    out[j + 1] = Math.round(bmp[j + 1] * a + 238 * (1 - a));
    out[j + 2] = Math.round(bmp[j + 2] * a + 238 * (1 - a));
    out[j + 3] = 255;
  }
  return nativeImage.createFromBitmap(out, { width: W, height: H }).toPNG();
}

async function sample(win, label) {
  const geo = await js(win, `(function(){
    var dpr = window.devicePixelRatio;
    var card = document.getElementById('app').getBoundingClientRect();
    return { dpr: dpr, iw: window.innerWidth, ih: window.innerHeight,
             card: { l: card.left, t: card.top, r: card.right, b: card.bottom,
                     w: card.width, h: card.height } };
  })()`);

  const img = await win.webContents.capturePage();
  const bmp = img.toBitmap ? img.toBitmap() : img.getBitmap();
  const sz = img.getSize();
  const at = (x, y) => {
    x = Math.max(0, Math.min(sz.width - 1, Math.round(x)));
    y = Math.max(0, Math.min(sz.height - 1, Math.round(y)));
    const j = (y * sz.width + x) * 4;
    return 'rgba(' + bmp[j] + ',' + bmp[j + 1] + ',' + bmp[j + 2] + ',' + bmp[j + 3] + ')';
  };

  const d = geo.dpr;
  const cx = ((geo.card.l + geo.card.r) / 2) * d;
  const cy = ((geo.card.t + geo.card.b) / 2) * d;

  console.log('\n===== ' + label + ' =====');
  console.log('窗口 CSS ' + geo.iw + 'x' + geo.ih + ' 截图 ' + sz.width + 'x' + sz.height +
              ' dpr=' + d);
  console.log('卡片 CSS ' + Math.round(geo.card.w) + 'x' + Math.round(geo.card.h) +
              '  左' + Math.round(geo.card.l) + ' 上' + Math.round(geo.card.t) +
              ' 右' + Math.round(geo.card.r) + ' 下' + Math.round(geo.card.b));
  console.log('-- 卡片左侧往外（水平中线）--');
  for (const off of [1, 3, 6, 10, 16, 24, 34, 44, 60]) {
    console.log('   左边缘外 ' + String(off).padStart(2) + 'px: ' + at(geo.card.l * d - off, cy));
  }
  console.log('-- 卡片上方往外（垂直中线）--');
  for (const off of [1, 3, 6, 10, 16, 24, 34, 44, 60]) {
    console.log('   上边缘外 ' + String(off).padStart(2) + 'px: ' + at(cx, geo.card.t * d - off));
  }
  console.log('-- 卡片下方往外 --');
  for (const off of [1, 3, 6, 10, 16, 24, 34, 44, 60]) {
    console.log('   下边缘外 ' + String(off).padStart(2) + 'px: ' + at(cx, geo.card.b * d + off));
  }
  console.log('-- 窗口最外圈（贴屏幕/窗口边界）--');
  console.log('   左上角(0,0)     : ' + at(0, 0));
  console.log('   上中(x, 0)      : ' + at(sz.width / 2, 0));
  console.log('   左中(0, y)      : ' + at(0, sz.height / 2));
  console.log('   右下角(w-1,h-1) : ' + at(sz.width - 1, sz.height - 1));

  fs.writeFileSync(path.join(OUT, label + '-浅底.png'), composeOnLight(bmp, sz));
  fs.writeFileSync(path.join(OUT, label + '.png'), img.toPNG());

  /* 统计整张图的 alpha 分布 */
  const hist = {};
  for (let i = 3; i < bmp.length; i += 4) {
    const a = bmp[i];
    const k = a === 0 ? '0' : (a === 255 ? '255' : (a < 64 ? '1-63' : (a < 160 ? '64-159' : '160-254')));
    hist[k] = (hist[k] || 0) + 1;
  }
  console.log('-- alpha 分布 --  ' + JSON.stringify(hist));
}

async function run() {
  const mainWin = await waitFor(() => allWins()[0]);
  await waitFor(() => mainWin && !mainWin.webContents.isLoading(), 150, 100);
  await sleep(1200);

  await sample(mainWin, '边缘诊断-紧凑态');

  await js(mainWin, `document.getElementById('dz').click()`);
  await sleep(900);
  await sample(mainWin, '边缘诊断-全屏态');

  const wa = screen.getPrimaryDisplay().workArea;
  console.log('\n工作区 ' + wa.width + 'x' + wa.height + ' @' + wa.x + ',' + wa.y);
  console.log('窗口 bounds ' + JSON.stringify(mainWin.getBounds()));

  setTimeout(() => app.exit(0), 400);
}

app.whenReady().then(() => {
  setTimeout(() => run().catch((e) => { console.log('异常: ' + (e && e.stack || e)); app.exit(2); }), 1200);
});
