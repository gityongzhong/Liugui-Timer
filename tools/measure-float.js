/* 量悬浮窗关键元素的真实渲染尺寸（用真实 Electron 内核，不靠 CSS 推算）
   用法：env -u ELECTRON_RUN_AS_NODE ... electron.exe tools/measure-float.js
   用途：决定悬浮窗窗口宽度该设多少（窗口宽 = 内容宽 + 左右 padding） */
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = '1';

const W = Number(process.env.MF_W || 320);
const H = Number(process.env.MF_H || 132);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'ui', 'float.html'));
  await new Promise((r) => setTimeout(r, 500));

  const out = await win.webContents.executeJavaScript(`(function(){
    function textW(sel, txt){
      var el = document.querySelector(sel);
      var prev = el.textContent;
      if(txt !== undefined) el.textContent = txt;
      var range = document.createRange();
      range.selectNodeContents(el);
      var w = range.getBoundingClientRect().width;
      if(txt !== undefined) el.textContent = prev;
      return +w.toFixed(1);
    }
    function box(sel){
      var el = document.querySelector(sel);
      var b = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      return { w:+b.width.toFixed(1), h:+b.height.toFixed(1), fs:cs.fontSize, ff:cs.fontFamily.split(",")[0], pad:cs.padding };
    }
    return JSON.stringify({
      iw: window.innerWidth,
      ih: window.innerHeight,
      dpr: window.devicePixelRatio,
      fwPad: getComputedStyle(document.getElementById('fw')).padding,
      num_00_00: textW('#num','00:00'),
      num_99_59: textW('#num','99:59'),
      num_599_59: textW('#num','599:59'),
      num_09_59: textW('#num','09:59'),
      num_dash:  textW('#num','--:--'),
      numBox: box('#num'),
      tagBox: box('#tag'),
      topBox: box('.top'),
      btnsBox: box('.btns'),
      gap: getComputedStyle(document.querySelector('.top')).gap
    });
  })()`);

  const d = JSON.parse(out);
  console.log('[measure-float] 窗口 ' + W + 'x' + H + '  视口 ' + d.iw + 'x' + d.ih + '  dpr=' + d.dpr);
  console.log('.fw padding      = ' + d.fwPad);
  console.log('数字宽度 00:00    = ' + d.num_00_00 + 'px   字号 ' + d.numBox.fs + '  字体 ' + d.numBox.ff);
  console.log('数字宽度 99:59    = ' + d.num_99_59 + 'px');
  console.log('数字宽度 09:59    = ' + d.num_09_59 + 'px');
  console.log('数字宽度 599:59   = ' + d.num_599_59 + 'px  ← 分钟上限 599，最长形态');
  console.log('数字宽度 --:--    = ' + d.num_dash + 'px');
  console.log('#num 盒子         = ' + d.numBox.w + 'x' + d.numBox.h);
  console.log('tag 盒子          = ' + d.tagBox.w + 'x' + d.tagBox.h + '  字号 ' + d.tagBox.fs);
  console.log('.top 行           = ' + d.topBox.w + 'x' + d.topBox.h + '  gap=' + d.gap);
  console.log('.btns 组          = ' + d.btnsBox.w + 'x' + d.btnsBox.h);

  const padL = parseFloat(d.fwPad.split(' ')[1] || d.fwPad.split(' ')[0]);
  const padR = padL;
  const needNum = Math.max(d.num_00_00, d.num_99_59, d.num_dash);
  console.log('');
  console.log('→ 按「只比数字宽一点」推算窗口宽度：');
  console.log('   数字所需窗口宽 = ' + needNum + ' + 左右 padding(' + padL + '+' + padR + ') = ' + (needNum + padL + padR).toFixed(1) + 'px');
  console.log('   顶部一行所需  = .btns ' + d.btnsBox.w + ' + gap ' + d.gap + ' + tag 最短可用 60 + 左右 padding = ' +
              (d.btnsBox.w + parseFloat(d.gap) + 60 + padL + padR).toFixed(1) + 'px');
  console.log('   进度条需要一定宽度（太窄不好看，建议 ≥ ' + (needNum + padL + padR).toFixed(0) + '）');

  win.destroy();
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
