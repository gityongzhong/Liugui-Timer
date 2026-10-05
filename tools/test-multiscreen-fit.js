/* 多屏回归：把主窗口挪到「非主屏」区域，触发 window:fit（新增计时器会调），
 * 校验窗口位置不得被拽回主屏。
 *
 * 本机实测有两块屏：主屏 workArea 1536x912 @0,0 + 副屏 workArea 2048x1104 @1536,0。
 * 修复前：window:fit / win:maxh 写死 getPrimaryDisplay()，窗口在副屏时会被按主屏
 * 边界夹取并跳回主屏（用户反馈 bug）。
 * 修复后：按 getDisplayMatching(窗口 bounds) 取当前屏，且窗口完整在屏内时位置一律不动。
 */
const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

const TEST_DATA = path.join(__dirname, '..', '.test-userdata');
try { fs.rmSync(TEST_DATA, { recursive: true, force: true }); } catch (e) {}
app.setPath('userData', TEST_DATA);

require(path.join(__dirname, '..', 'main.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '   [' + extra + ']' : ''));
  cond ? pass++ : fail++;
};

async function waitFor(fn, tries = 150, step = 100) {
  for (let i = 0; i < tries; i++) { const v = fn(); if (v) return v; await sleep(step); }
  return null;
}

/** 判断点 (x,y) 落在哪块屏（模拟 Electron 的 getDisplayMatching 直觉） */
function displayAt(x, y) {
  const hits = screen.getAllDisplays().filter((d) =>
    x >= d.bounds.x && x < d.bounds.x + d.bounds.width &&
    y >= d.bounds.y && y < d.bounds.y + d.bounds.height);
  return hits[0] || screen.getPrimaryDisplay();
}

app.whenReady().then(async () => {
  console.log('=== 多屏自适应回归 ===\n');

  const win = await waitFor(() => BrowserWindow.getAllWindows()[0], 150, 100);
  ok('主窗口已创建', !!win);
  if (!win) return finish();

  await waitFor(() => win && !win.webContents.isLoading(), 150, 100);
  await sleep(1500);

  const wa = screen.getPrimaryDisplay().workArea;
  const dips = screen.getAllDisplays();
  console.log('主屏工作区 ' + wa.width + 'x' + wa.height + ' @' + wa.x + ',' + wa.y);
  console.log('显示器数量 ' + dips.length);
  dips.forEach((d, i) => console.log('  屏' + i + ' ' + JSON.stringify(d.bounds) +
    ' 工作区 ' + JSON.stringify(d.workArea) + (d.id === screen.getPrimaryDisplay().id ? ' ←主屏' : '')));
  console.log('');

  /* ---------- 场景一：窗口放到「主屏右边界之外」（副屏区）---------- */
  const fakeX = wa.x + wa.width + 100;      // 主屏右边界之外
  const fakeY = wa.y + 120;
  win.setBounds({ x: fakeX, y: fakeY, width: 780, height: 520 });
  await sleep(500);
  const before = win.getBounds();
  const targetDisplay = displayAt(fakeX + 10, fakeY + 10);
  console.log('挪到主屏外侧后 bounds = ' + JSON.stringify(before) +
              '（落在 ' + (targetDisplay.id === screen.getPrimaryDisplay().id ? '主屏' : '副屏') + '）');

  await win.webContents.executeJavaScript(`(function(){
    if (window.LG && window.LG.fitWindow) window.LG.fitWindow({ w: 780, h: 540 });
    return true;
  })()`);
  await sleep(700);
  const after = win.getBounds();
  console.log('触发 fit 之后 bounds = ' + JSON.stringify(after));

  ok('窗口 x 未被拽回主屏', Math.abs(after.x - before.x) <= 2,
     'x: ' + before.x + ' → ' + after.x);
  ok('窗口 y 未被拽回主屏', Math.abs(after.y - before.y) <= 2,
     'y: ' + before.y + ' → ' + after.y);
  ok('尺寸确实按内容重排了（功能没退化）', after.width === 780 && after.height === 540,
     after.width + 'x' + after.height);

  const stillOutside = after.x >= wa.x + wa.width;
  ok('窗口仍在主屏工作区之外（关键：没被夹回来）', stillOutside,
     'x=' + after.x + ' vs 主屏右边界 ' + (wa.x + wa.width));

  /* ---------- 场景二：窗口完全在副屏深处，多次 fit 都应稳定不动 ---------- */
  const deepX = dips.length > 1 ? dips[1].bounds.x + 200 : wa.x + wa.width + 200;
  win.setBounds({ x: deepX, y: 80, width: 780, height: 500 });
  await sleep(400);
  const b2 = win.getBounds();
  let stable = true, trace = [b2.x];
  for (let i = 0; i < 3; i++) {
    await win.webContents.executeJavaScript(`(function(){
      if (window.LG && window.LG.fitWindow) window.LG.fitWindow({ w: 780, h: ${500 + i * 20} });
      return true;
    })()`);
    await sleep(450);
    const cur = win.getBounds();
    trace.push(cur.x);
    if (Math.abs(cur.x - b2.x) > 2) stable = false;
  }
  ok('副屏内连续 3 次 fit 位置始终不动', stable, 'x 轨迹 ' + trace.join(' → '));

  /* ---------- 场景三：win:maxh 返回「当前屏」工作区高度 ---------- */
  const maxh = await win.webContents.executeJavaScript(`(function(){
    return (window.LG && window.LG.maxWindowHeight) ? window.LG.maxWindowHeight() : -1;
  })()`);
  const curB = win.getBounds();
  const curD = displayAt(curB.x + 10, curB.y + 10);
  ok('win:maxh 返回当前所在屏的工作区高度（不是主屏）',
     maxh > 300 && Math.abs(maxh - curD.workArea.height) <= 4,
     'maxh=' + maxh + ' / 当前屏高 ' + curD.workArea.height +
     ' / 主屏高 ' + wa.height);

  /* 把窗口搬回主屏，maxh 应跟着变回主屏高度 */
  win.setBounds({ x: wa.x + 100, y: wa.y + 100, width: 780, height: 520 });
  await sleep(500);
  const maxh2 = await win.webContents.executeJavaScript(`(function(){
    return (window.LG && window.LG.maxWindowHeight) ? window.LG.maxWindowHeight() : -1;
  })()`);
  ok('搬回主屏后 win:maxh 变成主屏高度（当前屏判定生效）',
     Math.abs(maxh2 - wa.height) <= 4,
     'maxh=' + maxh2 + ' / 主屏高 ' + wa.height + (maxh !== maxh2 ? '（前后不同 ✓）' : ''));

  finish();

  function finish() {
    console.log('\n=== 结果: ' + pass + '/' + (pass + fail) + ' ===');
    setTimeout(() => app.exit(fail ? 1 : 0), 300);
  }
}).catch((e) => {
  console.log('异常: ' + (e && e.stack || e));
  app.exit(2);
});

