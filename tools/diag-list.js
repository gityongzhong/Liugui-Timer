/* 诊断：列表在「全部」分类下的真实高度 / 是否出现滚动条
 * 用法：electron tools/diag-list.js
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
const js = (w, c) => w.webContents.executeJavaScript(c);
const allWins = () => BrowserWindow.getAllWindows();

const PROBE = `(function(){
  function box(sel){
    var el = document.querySelector(sel);
    if(!el) return null;
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    return {
      h: Math.round(r.height*10)/10, w: Math.round(r.width*10)/10,
      minH: cs.minHeight, maxH: cs.maxHeight, gapRow: cs.rowGap,
      padY: cs.paddingTop + '/' + cs.paddingBottom, overflowY: cs.overflowY,
      scrollH: el.scrollHeight, clientH: el.clientHeight,
      scrolling: el.scrollHeight > el.clientHeight + 0.5
    };
  }
  var items = document.querySelectorAll('#list .item');
  var onBtn = document.querySelector('.seg button.on');
  return JSON.stringify({
    cat: onBtn ? onBtn.textContent : '(无)',
    n: items.length,
    itemH: items.length ? Math.round(items[0].getBoundingClientRect().height*10)/10 : null,
    list: box('#list'),
    side: box('.side'),
    main: box('.main'),
    body: box('.body'),
    app: box('.app'),
    docScrollH: document.documentElement.scrollHeight,
    docClientH: document.documentElement.clientHeight
  });
})()`;

async function waitFor(fn, tries = 120, step = 100) {
  for (let i = 0; i < tries; i++) { const v = fn(); if (v) return v; await sleep(step); }
  return null;
}

function dump(tag, raw, bounds) {
  const d = JSON.parse(raw);
  console.log('\n== ' + tag + ' ==  窗口 ' + bounds.width + ' x ' + bounds.height);
  console.log('  分类「' + d.cat + '」 条目 ' + d.n + ' 条 × ' + d.itemH + 'px');
  ['list', 'side', 'main', 'body', 'app'].forEach((k) => {
    const b = d[k];
    if (!b) { console.log('  ' + k.padEnd(5) + ' 未找到'); return; }
    console.log('  ' + k.padEnd(5) + ' 高 ' + String(b.h).padStart(7) +
      ' 宽 ' + String(b.w).padStart(7) +
      ' | min/max-h ' + b.minH + '/' + b.maxH +
      ' | gap ' + b.gapRow +
      ' | pad-y ' + b.padY +
      ' | scrollH ' + b.scrollH + ' clientH ' + b.clientH +
      (b.scrolling ? '  ⚠ 出现滚动条' : ''));
  });
  console.log('  文档 scrollH ' + d.docScrollH + ' clientH ' + d.docClientH);
}

async function run() {
  const mainWin = await waitFor(() => allWins()[0]);
  if (!mainWin) { console.log('主窗口没起来'); app.quit(); return; }
  await waitFor(() => !mainWin.webContents.isLoading(), 150, 100);
  await sleep(1400);

  dump('默认态', await js(mainWin, PROBE), mainWin.getBounds());

  // 切到「全部」
  await js(mainWin, `(function(){ var bs=document.querySelectorAll('.seg button');
    for(var i=0;i<bs.length;i++){ if(bs[i].textContent==='全部'){ bs[i].click(); return; } } })()`);
  await sleep(700);
  dump('点「全部」', await js(mainWin, PROBE), mainWin.getBounds());

  // 再加 1 条（共 8 条）：按需求，第 8 条起才出现列表内滚动条
  await js(mainWin, `document.querySelector('.add').click()`);
  await sleep(600);
  dump('加到 8 条（预期：出现滚动条）', await js(mainWin, PROBE), mainWin.getBounds());

  // 继续加到 20 条：窗口高度应保持不变，滚动只发生在左边列表内
  for (let i = 0; i < 12; i++) {
    await js(mainWin, `document.querySelector('.add').click()`);
    await sleep(350);
  }
  const raw20 = await js(mainWin, PROBE);
  const b20 = mainWin.getBounds();
  dump('加到 20 条（超出屏幕高度）', raw20, b20);
  const p20 = JSON.parse(raw20);
  console.log('  → 整页滚动条：' + (p20.docScrollH > p20.docClientH + 0.5 ? '有 ✗' : '无 ✓') +
    ' | 列表内部滚动：' + (p20.list.scrolling ? '有 ✓' : '无'));

  app.quit();
}

app.whenReady().then(run);
