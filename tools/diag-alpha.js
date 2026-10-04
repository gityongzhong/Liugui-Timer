/* 诊断：悬浮窗透明度的真实情况
 * 目的：分清「窗口真的不透明」还是「capturePage 采样/阴影造成的非零 alpha」
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('no-sandbox');
require(path.join(__dirname, '..', 'main.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await sleep(1400);

  const mainWin = BrowserWindow.getAllWindows()[0];
  if (!mainWin) { console.log('主窗口未创建'); return app.exit(1); }

  await mainWin.webContents.executeJavaScript(
    `document.getElementById('floatBtn').click()`);
  await sleep(1600);

  const fw = BrowserWindow.getAllWindows().find(w => (w.getTitle() || '').indexOf('悬浮') >= 0);
  if (!fw) { console.log('悬浮窗未打开'); return app.exit(1); }

  // 复位为完全不透明，排除 setOpacity 干扰
  fw.setOpacity(1);
  await sleep(600);

  const d = fw.webContents;
  const cssSize = await d.executeJavaScript(
    `JSON.stringify({w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio})`);
  console.log('窗口 bounds :', JSON.stringify(fw.getBounds()));
  console.log('CSS 视口    :', cssSize);

  const img = fw.webContents.capturePage();
  const image = await img;
  const sz = image.getSize();
  const bmp = image.toBitmap ? image.toBitmap() : image.getBitmap();
  console.log('截图尺寸    :', sz.width + 'x' + sz.height, ' buffer=' + bmp.length);

  const px = (x, y) => {
    const i = (y * sz.width + x) * 4;
    return { b: bmp[i], g: bmp[i + 1], r: bmp[i + 2], a: bmp[i + 3] };
  };

  const total = sz.width * sz.height;
  let a0 = 0, aLow = 0, aMid = 0, aHigh = 0;
  for (let i = 3; i < bmp.length; i += 4) {
    const a = bmp[i];
    if (a === 0) a0++;
    else if (a < 64) aLow++;
    else if (a < 200) aMid++;
    else aHigh++;
  }
  console.log('\n--- alpha 分布 (共 ' + total + ' px) ---');
  console.log('  alpha = 0      : ' + a0 + '  (' + (a0 / total * 100).toFixed(1) + '%)');
  console.log('  0 < alpha < 64 : ' + aLow + '  (' + (aLow / total * 100).toFixed(1) + '%)');
  console.log('  64 <= a < 200  : ' + aMid + '  (' + (aMid / total * 100).toFixed(1) + '%)');
  console.log('  alpha >= 200   : ' + aHigh + '  (' + (aHigh / total * 100).toFixed(1) + '%)');

  console.log('\n--- 关键点 BGRA ---');
  const pts = [
    ['左上角', 1, 1],
    ['右上角', sz.width - 2, 1],
    ['左下角', 1, sz.height - 2],
    ['右下角', sz.width - 2, sz.height - 2],
    ['顶边中点外', Math.floor(sz.width / 2), 1],
    ['左边中点外', 1, Math.floor(sz.height / 2)],
    ['内部(卡片背景)', Math.floor(sz.width / 2), Math.floor(sz.height / 2)],
    ['内部(靠上)', Math.floor(sz.width / 2), 8],
  ];
  for (const [name, x, y] of pts) {
    const p = px(x, y);
    console.log('  ' + name.padEnd(14) + ' (' + x + ',' + y + ')  B=' + p.b + ' G=' + p.g +
                ' R=' + p.r + ' A=' + p.a);
  }

  console.log('\n--- 沿左上对角线 alpha 采样 ---');
  let line = [];
  for (let k = 0; k < 20; k++) line.push(px(k, k).a);
  console.log('  ' + line.join(' '));

  // 生成浅底合成预览，肉眼看圆角
  const W = sz.width, H = sz.height;
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0, j = 0; i < W * H; i++, j += 4) {
    const a = bmp[j + 3] / 255;
    // 与浅灰底 (240,240,240) 合成
    out[j]     = Math.round(bmp[j]     * a + 240 * (1 - a));
    out[j + 1] = Math.round(bmp[j + 1] * a + 240 * (1 - a));
    out[j + 2] = Math.round(bmp[j + 2] * a + 240 * (1 - a));
    out[j + 3] = 255;
  }
  const { nativeImage } = require('electron');
  const composed = nativeImage.createFromBitmap(out, { width: W, height: H });
  const p1 = path.join(__dirname, '..', 'shots', '悬浮窗-浅底预览.png');
  fs.writeFileSync(p1, composed.toPNG());
  console.log('\n浅底合成预览已保存: ' + p1);

  app.exit(0);
});
