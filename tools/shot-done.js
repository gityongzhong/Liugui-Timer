/* 补拍「时间到」状态 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');

const ROOT = path.join(__dirname, '..');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180, height: 780, show: false,
    backgroundColor: '#14161a',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  await win.loadFile(path.join(ROOT, 'ui', 'index.html'));
  await sleep(1200);

  await win.webContents.executeJavaScript(`(function(){
    var m=document.getElementById('min'), s=document.getElementById('sec');
    m.value=0; s.value=1;
    m.dispatchEvent(new Event('input',{bubbles:true}));
    s.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('start').click();
  })();`);
  await sleep(2300);

  const img = await win.webContents.capturePage();
  const p = path.join(ROOT, 'shots', '3-时间到.png');
  fs.writeFileSync(p, img.toPNG());
  console.log('已截图: 3-时间到.png', fs.statSync(p).size + ' B');
  app.exit(0);
});
