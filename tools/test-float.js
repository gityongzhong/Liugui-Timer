/* 流晷计时器 · 真机回归测试
 * 全程真实 Electron 内核 + OS 级鼠标事件；直接加载生产 main.js，测的就是打包进去的逻辑。
 * 覆盖：苹果风界面布局 / 多计时器分类与增删改 / 倒计时联动 / 悬浮窗。
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

/* 用独立 userData，避免污染真机数据 */
const TEST_DATA = path.join(__dirname, '..', '.test-userdata');
try { fs.rmSync(TEST_DATA, { recursive: true, force: true }); } catch (e) {}
app.setPath('userData', TEST_DATA);

app.commandLine.appendSwitch('no-sandbox');
process.env.LG_PPT_POLL = '150';    // 加速放映检测轮询（生产 1000ms），测试更快更稳
require(path.join(__dirname, '..', 'main.js'));

const OUT = path.join(__dirname, '..', 'shots');
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' });
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '   [' + extra + ']' : ''));
}

const allWins = () => BrowserWindow.getAllWindows();
const isFloat = (w) => (w.getTitle() || '').indexOf('悬浮') >= 0;

async function waitFor(fn, tries, step) {
  tries = tries || 100; step = step || 100;
  for (let i = 0; i < tries; i++) {
    const v = fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

/* 轮询等待页面内表达式的值满足条件（js() 是异步的，waitFor 不适用）
   用途：进度条「光点出现 / 转琥珀 / 转红 / 到点」这类阈值状态，
   固定 sleep 会卡在阈值边界抖动导致误判，改成「等它出现，最多等 N 次」 */
async function waitJs(win, expr, test, tries, step) {
  tries = tries || 60; step = step || 100;
  let v = null;
  for (let i = 0; i < tries; i++) {
    v = await js(win, expr);
    if (test ? test(v) : v) return v;
    await sleep(step);
  }
  return v;
}

async function waitLoaded(win) {
  if (!win) return;
  await waitFor(() => !win.webContents.isLoading(), 150, 100);
  await sleep(600);
}

function clickAt(win, x, y) {
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

const js = (win, code) => win.webContents.executeJavaScript(code);

async function clickSel(win, selector) {
  const pos = await js(win, `(function(){
    var el = document.querySelector(${JSON.stringify(selector)});
    if(!el) return null;
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
  })()`);
  if (!pos) return false;
  clickAt(win, pos.x, pos.y);
  await sleep(350);
  return true;
}

async function clickByText(win, selector, text) {
  const pos = await js(win, `(function(){
    var els = document.querySelectorAll(${JSON.stringify(selector)});
    for(var i=0;i<els.length;i++){
      if((els[i].textContent||'').trim() === ${JSON.stringify(text)}){
        var r = els[i].getBoundingClientRect();
        return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) };
      }
    }
    return null;
  })()`);
  if (!pos) return false;
  clickAt(win, pos.x, pos.y);
  await sleep(350);
  return true;
}

const itemCount = (win) => js(win, `document.querySelectorAll('#list .item').length`);
const itemNames = (win) => js(win, `Array.prototype.map.call(
  document.querySelectorAll('#list .nm'), function(e){ return e.textContent; })`);

/* 量文本真实渲染中心与容器的中心差 */
function centerOffset(win, textSel, boxSel) {
  return js(win, `(function(){
    var el = document.querySelector(${JSON.stringify(textSel)});
    var box = document.querySelector(${JSON.stringify(boxSel)});
    if(!el || !box) return null;
    var range = document.createRange();
    range.selectNodeContents(el);
    var tr = range.getBoundingClientRect();
    var br = box.getBoundingClientRect();
    return { off: Math.round(((tr.left + tr.width/2) - (br.left + br.width/2)) * 10) / 10,
             text: (el.textContent||'').trim() };
  })()`);
}

/* 把带 alpha 的截图合成到浅色底，便于肉眼查看圆角与透明区 */
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

async function run() {
  console.log('=== 流晷计时器 · 真机回归测试 ===\n');
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  /* ---------- 主窗口 ---------- */
  const mainWin = await waitFor(() => allWins()[0], 150, 100);
  ok('主窗口已创建', !!mainWin);
  if (!mainWin) return finish();
  await waitLoaded(mainWin);
  ok('主窗口加载完成', !mainWin.webContents.isLoading());

  await sleep(700);
  const cMain = await centerOffset(mainWin, '#time', '.main');
  ok('倒计时数字居中', cMain && Math.abs(cMain.off) <= 2,
     cMain ? '偏移 ' + cMain.off + 'px' : 'null');

  const fit = await js(mainWin, `(function(){
    var r = document.getElementById('app').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height),
             iw: window.innerWidth, ih: window.innerHeight };
  })()`);
  const padX = (fit.iw - fit.w) / 2, padY = (fit.ih - fit.h) / 2;
  ok('窗口只比界面大一点点', padX >= 4 && padX <= 20 && padY >= 4 && padY <= 20,
     '界面 ' + fit.w + 'x' + fit.h + ', 窗口 ' + fit.iw + 'x' + fit.ih +
     ', 边距 ' + padX.toFixed(1) + '/' + padY.toFixed(1));

  /* 卡片四周必须完全透明（不能有外投影留下的灰黑雾） */
  const ring = await js(mainWin, `(function(){
    var g = getComputedStyle(document.getElementById('app'));
    return JSON.stringify({ shadow: g.boxShadow, body: getComputedStyle(document.body).background });
  })()`);
  const ringObj = JSON.parse(ring);
  ok('卡片无黑色外投影', ringObj.shadow.indexOf('rgba(0, 0, 0') < 0, ringObj.shadow);

  /* 像素级：卡片外一圈必须 alpha=0（此前外投影会在这里留下灰黑雾） */
  const rShot = await mainWin.webContents.capturePage();
  const rBmp = rShot.toBitmap ? rShot.toBitmap() : rShot.getBitmap();
  const rSz = rShot.getSize();
  const rDpr = await js(mainWin, `window.devicePixelRatio`);
  const rRect = await js(mainWin, `(function(){
    var r = document.getElementById('app').getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom };
  })()`);
  const aAt = (x, y) => rBmp[(y * rSz.width + x) * 4 + 3];
  const rcx = Math.round((rRect.l + rRect.r) / 2 * rDpr);
  const rcy = Math.round((rRect.t + rRect.b) / 2 * rDpr);
  const probes = [
    aAt(Math.round(rRect.l * rDpr) - 3, rcy),
    aAt(Math.round(rRect.r * rDpr) + 3, rcy),
    aAt(rcx, Math.round(rRect.t * rDpr) - 3),
    aAt(rcx, Math.round(rRect.b * rDpr) + 3)
  ];
  ok('卡片四周像素完全透明（无灰黑雾）', probes.every((a) => a === 0),
     '左/右/上/下外 3px alpha=' + probes.join(','));

  const winCfg = await js(mainWin, `JSON.stringify({
    radius: getComputedStyle(document.getElementById('app')).borderTopLeftRadius,
    font: getComputedStyle(document.body).fontFamily.slice(0, 40)
  })`);
  ok('苹果风外观（大圆角卡片）', JSON.parse(winCfg).radius === '16px', winCfg);

  /* 底部两个功能按钮必须等高（此前一个 padding 8px、一个 7px，差 2px） */
  const btnH = await js(mainWin, `JSON.stringify({
    add: Math.round(document.querySelector('.add').getBoundingClientRect().height * 10) / 10,
    flt: Math.round(document.getElementById('floatBtn').getBoundingClientRect().height * 10) / 10
  })`);
  const bh = JSON.parse(btnH);
  ok('「新建计时器」与「投到悬浮窗」等高', Math.abs(bh.add - bh.flt) <= 0.5,
     '新建 ' + bh.add + 'px / 投到悬浮窗 ' + bh.flt + 'px');

  /* 大数字字号（用户要求放大） */
  const fsMain = await js(mainWin,
    `parseFloat(getComputedStyle(document.getElementById('time')).fontSize)`);
  ok('主窗口大数字字号 ≥100px', fsMain >= 100, fsMain + 'px');

  /* ---------- 多计时器：分类 ---------- */
  const CATS_JS = `Array.prototype.map.call(document.querySelectorAll('.seg button'), function(e){ return e.dataset.cat || (e.textContent||'').trim(); }).join('/')`;
  const segs = await js(mainWin, CATS_JS);
  ok('分类标签齐全', segs === '全部/周例会/月度会/季度会', segs);

  const nWeekly = await itemCount(mainWin);
  ok('默认分类列出预设', nWeekly === 3, '周例会 ' + nWeekly + ' 条');

  await clickSel(mainWin, '.seg button[data-cat="月度会"]');
  const nMonth = await itemCount(mainWin);
  ok('切到月度会只剩对应预设', nMonth === 2, nMonth + ' 条');

  await clickByText(mainWin, '.seg button', '全部');
  const nAll = await itemCount(mainWin);
  ok('「全部」显示所有预设', nAll === 7, nAll + ' 条');

  await clickSel(mainWin, '.seg button[data-cat="周例会"]');
  await sleep(200);

  /* ---------- 多计时器：选中联动 ---------- */
  const names0 = await itemNames(mainWin);
  await clickSel(mainWin, '#list .item:nth-child(2)');
  await sleep(300);
  const afterSel = await js(mainWin, `JSON.stringify({
    cur: document.getElementById('curName').textContent,
    time: document.getElementById('time').textContent,
    min: document.getElementById('min').value,
    sec: document.getElementById('sec').value
  })`);
  const sel = JSON.parse(afterSel);
  ok('选中预设后名称与时长同步',
     sel.cur === names0[1] && sel.time === '15:00' && sel.min === '15' && sel.sec === '0',
     sel.cur + ' / ' + sel.time + ' / ' + sel.min + '分' + sel.sec + '秒');

  /* ---------- 多计时器：新建 + 改名 ---------- */
  await clickSel(mainWin, '#add');
  await sleep(400);
  const nAfterAdd = await itemCount(mainWin);
  ok('新建后列表多一条', nAfterAdd === 4, nAfterAdd + ' 条');
  const hasEdit = await js(mainWin, `!!document.querySelector('#list .nm-edit')`);
  ok('新建后自动进入改名输入', hasEdit === true);

  await js(mainWin, `(function(){
    var i = document.querySelector('#list .nm-edit');
    if(!i) return;
    i.value = '测试议题';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await sleep(400);
  const names1 = await itemNames(mainWin);
  ok('回车后改名生效', names1.indexOf('测试议题') >= 0, names1.join(' | '));

  /* ---------- 多计时器：删除 ---------- */
  const delIdx = names1.indexOf('测试议题') + 1;
  await clickSel(mainWin, '#list .item:nth-child(' + delIdx + ') .del');
  await sleep(400);
  const nAfterDel = await itemCount(mainWin);
  ok('删除后列表恢复', nAfterDel === nWeekly, nAfterDel + ' 条');

  /* ---------- 分类管理：新建 / 删除（带确认） / 重置 ---------- */
  const catBtns = await js(mainWin,
    `!!document.getElementById('catAdd') && !!document.getElementById('catReset')`);
  ok('分类区有「新建分类」与「重置分类」按钮', catBtns === true);

  const clickCatX = (cat) => clickSel(mainWin, '.seg button[data-cat="' + cat + '"] .cx');
  const clickYes = () => clickSel(mainWin, '.askrow button.yes');
  const clickNo = () => clickSel(mainWin, '.askrow button:not(.yes)');
  const hasAsk = () => js(mainWin, `!!document.querySelector('.mask .ask')`);
  const typeCat = (name) => js(mainWin, `(function(){
    var i = document.querySelector('.seg .cat-edit');
    if(!i) return false;
    i.value = ${JSON.stringify(name)};
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);

  await clickSel(mainWin, '#catAdd');
  const typed = await typeCat('培训');
  await sleep(400);
  ok('新建分类：就地输入框出现并接受回车', typed === true);
  const segs2 = await js(mainWin, CATS_JS);
  ok('新建的分类出现在分类栏', segs2.split('/').indexOf('培训') >= 0, segs2);
  const curCat = await js(mainWin,
    `(document.querySelector('.seg button.on') || {dataset:{}}).dataset.cat || '全部'`);
  ok('新建后自动切到该分类', curCat === '培训', curCat);

  await clickCatX('培训');
  await sleep(400);
  const segs3 = await js(mainWin, CATS_JS);
  ok('删除空分类：不弹确认、直接消失',
     segs3.split('/').indexOf('培训') < 0 && !(await hasAsk()),
     segs3);

  /* 非空分类：先取消一次，确认数据不丢；再确认删除，验证级联清除 */
  await clickSel(mainWin, '#catAdd');
  await typeCat('培训');
  await sleep(400);
  await clickSel(mainWin, '#add');
  await sleep(350);
  await js(mainWin, `(function(){
    var i = document.querySelector('#list .nm-edit');
    if(!i) return;
    i.value = '临时议题';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await sleep(400);
  const nInCat = await itemCount(mainWin);
  ok('新分类下新建的计时器归属该分类', nInCat === 1, nInCat + ' 条');

  await clickCatX('培训');
  await sleep(350);
  ok('删除非空分类：先弹确认框', (await hasAsk()) === true);
  await clickNo();
  await sleep(350);
  const segsKeep = await js(mainWin, CATS_JS);
  const nKeep = await itemCount(mainWin);
  ok('取消删除：分类与计时器都保留',
     segsKeep.split('/').indexOf('培训') >= 0 && nKeep === 1,
     segsKeep + ' / ' + nKeep + ' 条');

  await clickCatX('培训');
  await sleep(350);
  await clickYes();
  await sleep(400);
  const segs4 = await js(mainWin, CATS_JS);
  await clickByText(mainWin, '.seg button', '全部');
  await sleep(300);
  const nAfterCatDel = await itemCount(mainWin);
  ok('确认删除：分类与其计时器一并移除',
     segs4.split('/').indexOf('培训') < 0 && nAfterCatDel === nAll,
     segs4 + ' / ' + nAfterCatDel + ' 条');

  /* 重置：恢复默认分类（自定义分类先弹确认） */
  await clickSel(mainWin, '#catAdd');
  await typeCat('培训');
  await sleep(400);
  await clickSel(mainWin, '#catReset');
  await sleep(350);
  ok('重置分类：有自定义分类时先弹确认', (await hasAsk()) === true);
  await clickYes();
  await sleep(450);
  const segs5 = await js(mainWin, CATS_JS);
  ok('重置后回到默认分类', segs5 === '全部/周例会/月度会/季度会', segs5);

  /* ---------- 倒计时运行 ---------- */
  await clickSel(mainWin, '#list .item:nth-child(1)');
  await js(mainWin, `(function(){
    var m=document.getElementById('min'), s=document.getElementById('sec');
    m.value=1; s.value=0;
    m.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await sleep(300);
  await clickSel(mainWin, '#start');
  await sleep(1300);
  const t1 = await js(mainWin, `document.getElementById('time').textContent`);
  await sleep(1200);
  const t2 = await js(mainWin, `document.getElementById('time').textContent`);
  ok('倒计时在走动', /^\d{2}:\d{2}$/.test(t1) && t1 !== t2, t1 + ' -> ' + t2);

  /* 等光点条件（进度 >0.5%）真正成立再读样式，避免采样早于阈值 */
  await waitJs(mainWin, `document.getElementById('bar').className`,
               (c) => c.indexOf('on') >= 0, 40, 100);

  /* 进度条本体：加粗 + 渐变填充 + 末端光点 */
  const barCss = await js(mainWin, `JSON.stringify({
    h: getComputedStyle(document.getElementById('bar').parentNode).height,
    bg: getComputedStyle(document.getElementById('bar')).backgroundImage,
    knob: getComputedStyle(document.getElementById('bar'), '::before').opacity
  })`);
  const bc = JSON.parse(barCss);
  ok('进度条加粗到 8px', parseFloat(bc.h) >= 7.5 && parseFloat(bc.h) <= 8.5, bc.h);
  ok('进度条为渐变填充（非纯色）', /linear-gradient/.test(bc.bg), bc.bg.slice(0, 44) + '...');
  ok('计时中末端光点显示', bc.knob === '1', '::before opacity=' + bc.knob);

  /* 暂停：整条变暗、光点熄灭 */
  await clickSel(mainWin, '#pause');
  await sleep(500);
  const pauseCss = await js(mainWin, `JSON.stringify({
    cls: document.getElementById('app').className,
    op: getComputedStyle(document.getElementById('bar')).opacity,
    knob: getComputedStyle(document.getElementById('bar'), '::before').opacity
  })`);
  const pc = JSON.parse(pauseCss);
  ok('暂停后进度条变暗、光点熄灭',
     /paused/.test(pc.cls) && parseFloat(pc.op) < 0.6 && pc.knob === '0',
     pc.cls + ' / opacity=' + pc.op + ' / knob=' + pc.knob);
  await clickSel(mainWin, '#start');
  await sleep(400);

  fs.writeFileSync(path.join(OUT, '主界面-计时中.png'),
    (await mainWin.webContents.capturePage()).toPNG());

  /* ---------- 悬浮窗 ---------- */
  await clickSel(mainWin, '#floatBtn');
  const floatWin = await waitFor(() => allWins().find(isFloat), 120, 100);
  ok('悬浮窗已打开', !!floatWin);
  if (floatWin) {
    await waitLoaded(floatWin);
    ok('悬浮窗无边框置顶',
       floatWin.isAlwaysOnTop() && !floatWin.isResizable(),
       'alwaysOnTop=' + floatWin.isAlwaysOnTop());

    const cFloat = await centerOffset(floatWin, '#num', '#fw');
    ok('悬浮窗数字居中', cFloat && Math.abs(cFloat.off) <= 2,
       cFloat ? '偏移 ' + cFloat.off + 'px' : 'null');

    const fsFloat = await js(floatWin,
      `parseFloat(getComputedStyle(document.getElementById('num')).fontSize)`);
    ok('悬浮窗大数字字号 ≥52px', fsFloat >= 52, fsFloat + 'px');

    /* 悬浮窗宽度：只比数字宽一点（曾经是 320 的大宽条） */
    const fFit = JSON.parse(await js(floatWin, `(function(){
      var el = document.getElementById('num');
      var prev = el.textContent;
      function tw(t){
        el.textContent = t;
        var r = document.createRange(); r.selectNodeContents(el);
        return r.getBoundingClientRect().width;
      }
      var w5 = tw('00:00'), w6 = tw('599:59'), wd = tw('--:--');
      el.textContent = prev;
      return JSON.stringify({
        win: window.innerWidth,
        avail: +el.getBoundingClientRect().width.toFixed(1),
        w5: +w5.toFixed(1), w6: +w6.toFixed(1), wd: +wd.toFixed(1)
      });
    })()`));
    ok('悬浮窗宽度只比数字宽一点（≤240px）', fFit.win <= 240,
       '窗口 ' + fFit.win + 'px / 数字00:00=' + fFit.w5 + 'px');
    ok('最长数字 599:59 不被裁切', fFit.w6 <= fFit.avail,
       '数字 ' + fFit.w6 + 'px ≤ 可用 ' + fFit.avail + 'px');

    const fTag = await js(floatWin, `document.getElementById('tag').textContent`);
    const mainName = await js(mainWin, `document.getElementById('curName').textContent`);
    ok('悬浮窗显示当前计时器名称', fTag.indexOf(mainName) === 0, fTag + ' ← ' + mainName);

    const fNum = await js(floatWin, `document.getElementById('num').textContent`);
    ok('悬浮窗数字与主窗口同步',
       /^\d{2}:\d{2}$/.test(fNum) && fNum !== '00:00' && fNum !== '--:--', fNum);

    await js(mainWin, `(function(){
      var o=document.getElementById('opacity'); o.value=55;
      o.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await sleep(500);
    ok('透明度生效', Math.abs(floatWin.getOpacity() - 0.55) < 0.02,
       'getOpacity=' + floatWin.getOpacity().toFixed(2));

    floatWin.setOpacity(1);
    await sleep(450);
    const img = await floatWin.webContents.capturePage();
    const bmp = img.toBitmap ? img.toBitmap() : img.getBitmap();
    const sz = img.getSize();
    const alphaAt = (x, y) => bmp[(y * sz.width + x) * 4 + 3];
    const corners = [alphaAt(1, 1), alphaAt(sz.width - 2, 1),
                     alphaAt(1, sz.height - 2), alphaAt(sz.width - 2, sz.height - 2)];
    const inner = alphaAt(Math.floor(sz.width / 2), Math.floor(sz.height / 2));
    const maxCorner = Math.max.apply(null, corners);
    ok('悬浮窗四角完全透明（无投影残留）',
       maxCorner === 0 && inner > 120,
       '角落=' + corners.join(',') + ' 内部=' + inner);
    fs.writeFileSync(path.join(OUT, '悬浮窗-计时中.png'), img.toPNG());
    fs.writeFileSync(path.join(OUT, '悬浮窗-浅底预览.png'), composeOnLight(bmp, sz));

    /* 六秒倒计时：一路走过「正常 → 琥珀预警 → 红色预警 → 到点」 */
    await js(mainWin, `(function(){
      document.getElementById('reset').click();
      var m=document.getElementById('min'), s=document.getElementById('sec');
      m.value=0; s.value=6;
      m.dispatchEvent(new Event('input',{bubbles:true}));
      document.getElementById('start').click();
    })()`);
    await sleep(400);
    const runCls = await js(mainWin, `document.getElementById('bar').parentNode.className`);
    ok('剩余充足时无预警色', !/warn|crit/.test(runCls), '剩 ~93% / class="' + runCls + '"');

    /* 等琥珀预警出现（最多 5.5s），再读悬浮窗同一状态 */
    const warnCls = await waitJs(mainWin, `document.getElementById('bar').parentNode.className`,
                                (c) => /warn/.test(c), 55, 100);
    const fWarnCls = await js(floatWin, `document.getElementById('bar').parentNode.className`);
    ok('剩余不足 20% 转琥珀预警',
       /warn/.test(warnCls) && /warn/.test(fWarnCls),
       '主 "' + warnCls + '" / 悬浮 "' + fWarnCls + '"');

    const critCls = await waitJs(mainWin, `document.getElementById('bar').parentNode.className`,
                                (c) => /crit/.test(c), 30, 100);
    ok('剩余不足 10% 转红色预警', /crit/.test(critCls), '"' + critCls + '"');

    const cls = await waitJs(floatWin, `document.getElementById('fw').className`,
                             (c) => c.indexOf('done') >= 0, 30, 100);
    ok('到点后悬浮窗变红', cls.indexOf('done') >= 0, cls);
    fs.writeFileSync(path.join(OUT, '悬浮窗-时间到.png'),
      (await floatWin.webContents.capturePage()).toPNG());

    await clickSel(floatWin, '#x');
    await sleep(800);
    ok('关闭悬浮窗', allWins().filter(isFloat).length === 0);
  }

  /* ---------- PPT 放映自动计时 ---------- */
  const detect = require(path.join(__dirname, '..', 'lib', 'ppt-detect'));
  ok('放映检测模块可用（koffi + user32）', detect.available());
  ok('未放映时检测结果为 false', detect.isSlideshowActive() === false);

  const swCls = await js(mainWin, `document.getElementById('autoSw').className`);
  ok('自动计时开关默认开启', /on/.test(swCls), 'class="' + swCls + '"');

  /* 备好一个待机中的 9 分钟计时器 */
  await js(mainWin, `(function(){
    var m=document.getElementById('min'), s=document.getElementById('sec');
    m.value=9; s.value=0;
    m.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('reset').click();
  })()`);
  await sleep(400);

  detect.setOverride(true);                        // 模拟「PPT 开始放映」
  const autoFloat = await waitFor(() => allWins().find(isFloat), 40, 150);
  ok('放映开始 → 自动弹出悬浮窗', !!autoFloat);

  const aT1 = await js(mainWin, `document.getElementById('time').textContent`);
  await sleep(1500);
  const aT2 = await js(mainWin, `document.getElementById('time').textContent`);
  ok('放映开始 → 自动开始计时（数字在走）',
     /^\d{2}:\d{2}$/.test(aT1) && aT1 !== aT2, aT1 + ' -> ' + aT2);

  detect.setOverride(false);                       // 模拟「按 Esc 退出放映」
  await sleep(700);
  const aStatus = await js(mainWin, `document.getElementById('status').textContent`);
  const hold1 = await js(mainWin, `document.getElementById('time').textContent`);
  await sleep(1200);
  const hold2 = await js(mainWin, `document.getElementById('time').textContent`);
  ok('退出放映 → 自动暂停并保留剩余时间',
     /暂停/.test(aStatus) && hold1 === hold2 && hold1 !== '00:00',
     'status="' + aStatus + '" 剩余 ' + hold1 + ' 保持不变');

  /* 关掉开关后，再放映不应自动开始 */
  await clickSel(mainWin, '#autoSw');
  await sleep(250);
  const swOff = await js(mainWin, `document.getElementById('autoSw').className`);
  ok('开关可关闭', !/on/.test(swOff), 'class="' + swOff + '"');

  await js(mainWin, `document.getElementById('reset').click()`);
  await sleep(250);
  const fwBefore = allWins().filter(isFloat).length;
  detect.setOverride(true);
  await sleep(1200);
  const fwAfter = allWins().filter(isFloat).length;
  const offStatus = await js(mainWin, `document.getElementById('status').textContent`);
  ok('开关关闭时放映不触发自动计时',
     fwAfter === fwBefore && !/计时中/.test(offStatus),
     '悬浮窗 ' + fwBefore + '→' + fwAfter + ' / status="' + offStatus + '"');

  const setFile = path.join(TEST_DATA, 'settings.json');
  ok('开关状态已落盘 settings.json', fs.existsSync(setFile),
     fs.existsSync(setFile) ? fs.readFileSync(setFile, 'utf8') : '未生成');

  detect.setOverride(null);                        // 复位为真实检测

  /* ---------- 持久化 ---------- */
  const saved = JSON.parse(fs.readFileSync(path.join(TEST_DATA, 'timers.json'), 'utf8'));
  ok('预设已持久化到本地', Array.isArray(saved.timers) && saved.timers.length === 7,
     saved.timers.length + ' 条');

  /* ---------- 放大 / 还原 ---------- */
  const { screen } = require('electron');
  const wa = screen.getPrimaryDisplay().workArea;

  const before = mainWin.getBounds();
  await clickSel(mainWin, '#dz');
  await sleep(700);
  const zoomedBounds = mainWin.getBounds();
  ok('点绿点后窗口放大到工作区',
     Math.abs(zoomedBounds.width - wa.width) <= 2 && Math.abs(zoomedBounds.height - wa.height) <= 2,
     zoomedBounds.width + 'x' + zoomedBounds.height + ' / 工作区 ' + wa.width + 'x' + wa.height);

  const zoomCss = await js(mainWin, `JSON.stringify({
    cls: document.body.className,
    radius: getComputedStyle(document.getElementById('app')).borderTopLeftRadius,
    h: Math.round(document.getElementById('app').getBoundingClientRect().height),
    ih: window.innerHeight,
    listMax: getComputedStyle(document.getElementById('list')).maxHeight
  })`);
  const zc = JSON.parse(zoomCss);
  ok('放大后卡片铺满窗口（无圆角/无留白）',
     zc.cls.indexOf('zoomed') >= 0 && zc.radius === '0px' && Math.abs(zc.h - zc.ih) <= 2,
     zc.cls + ' radius=' + zc.radius + ' 卡片高=' + zc.h + '/窗口高=' + zc.ih);

  /* 放大后整套字号同比放大，数字要够大（观众席也要看得清） */
  const zFont = await js(mainWin, `JSON.stringify({
    time: parseFloat(getComputedStyle(document.getElementById('time')).fontSize),
    nm: parseFloat(getComputedStyle(document.querySelector('#list .nm')).fontSize),
    ctrl: parseFloat(getComputedStyle(document.querySelector('#start')).fontSize),
    item: parseFloat(getComputedStyle(document.querySelector('#list .item')).fontSize)
  })`);
  const zf = JSON.parse(zFont);
  ok('全屏数字按屏幕比例放大（≥220px）', zf.time >= 220, zf.time + 'px（紧凑态 104px）');
  ok('全屏其余文字同比放大', zf.nm >= 17 && zf.ctrl >= 19,
     '列表 ' + zf.nm + 'px / 按钮 ' + zf.ctrl + 'px');

  const zBar = await js(mainWin,
    `parseFloat(getComputedStyle(document.getElementById('bar').parentNode).height)`);
  ok('全屏进度条加粗到 14px', zBar >= 13, zBar + 'px（紧凑态 8px）');

  /* 放大后数字不能溢出卡片（宽度必须放得下） */
  const zFit = await js(mainWin, `(function(){
    var el = document.getElementById('time');
    var range = document.createRange();
    range.selectNodeContents(el);
    var tw = range.getBoundingClientRect().width;
    var cardW = document.getElementById('app').getBoundingClientRect().width;
    var mainW = document.querySelector('.main').getBoundingClientRect().width;
    return { tw: Math.round(tw), cardW: Math.round(cardW), mainW: Math.round(mainW) };
  })()`);
  ok('全屏数字未溢出卡片',
     zFit.tw < zFit.mainW && zFit.tw < zFit.cardW,
     '数字宽 ' + zFit.tw + ' < 右栏 ' + zFit.mainW + ' / 卡片 ' + zFit.cardW);
  /* 截全屏图前先让计时器跑起来，顺便验证放大态仍可操作 */
  await js(mainWin, `(function(){
    document.getElementById('reset').click();
    var m=document.getElementById('min'), s=document.getElementById('sec');
    m.value=12; s.value=0;
    m.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('start').click();
  })()`);
  await sleep(1300);
  ok('放大态下计时器可正常操作',
     /^1[12]:\d{2}$/.test(await js(mainWin, `document.getElementById('time').textContent`)),
     await js(mainWin, `document.getElementById('time').textContent`));

  fs.writeFileSync(path.join(OUT, '主界面-放大.png'),
    (await mainWin.webContents.capturePage()).toPNG());

  await clickSel(mainWin, '#dz');
  await sleep(700);
  const back = mainWin.getBounds();
  ok('再点一次还原到原尺寸',
     Math.abs(back.width - before.width) <= 2 && Math.abs(back.height - before.height) <= 2 &&
     !/zoomed/.test(await js(mainWin, `document.body.className`)),
     back.width + 'x' + back.height + ' / 原 ' + before.width + 'x' + before.height +
     '（差值 ≤2px，DPI 缩放取整）');

  /* ---------- Windows 风格窗口按钮 ---------- */
  const dots = await js(mainWin, `document.querySelectorAll('.titlebar .winbtn').length`);
  ok('Windows 风格窗口按钮存在（最小化/放大/关闭）', dots === 3, dots + ' 个');
  const hasDrag = await js(mainWin,
    `getComputedStyle(document.querySelector('.titlebar')).webkitAppRegion`);
  ok('顶栏可拖动窗口', hasDrag === 'drag', hasDrag);

  fs.writeFileSync(path.join(OUT, '主界面-苹果风.png'),
    (await mainWin.webContents.capturePage()).toPNG());

  finish();
}

function finish() {
  const pass = results.filter((r) => r.pass).length;
  console.log('\n=== 结果: ' + pass + '/' + results.length + ' ===');
  const bad = results.filter((r) => !r.pass);
  if (bad.length) {
    console.log('未通过:');
    bad.forEach((r) => console.log('  - ' + r.name + ' ' + r.extra));
  }
  setTimeout(() => app.exit(bad.length ? 1 : 0), 400);
}

app.whenReady().then(() => {
  setTimeout(() => {
    run().catch((e) => {
      console.log('测试异常: ' + (e && e.stack ? e.stack : e));
      app.exit(2);
    });
  }, 1200);
});
