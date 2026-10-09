const { app, BrowserWindow, Tray, Menu, screen, desktopCapturer, ipcMain } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');

const logFile = path.join(__dirname, 'golite_debug.log');
function log(msg) {
  try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`); } catch(e){}
}
process.on('uncaughtException', (err) => {
  log('uncaughtException: ' + (err ? err.stack : err));
});
process.on('unhandledRejection', (err) => {
  log('unhandledRejection: ' + (err ? err.stack : err));
});

app.commandLine.appendSwitch('enable-features', 'WebRtcAllowWgcScreenCapturer,WebRtcAllowWgcWindowCapturer,D3D11VideoDecoder');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

log('App starting...');

let mainWindow = null;
let notifWindow = null;
let popoutWindow = null;
let tray = null;

const DEFAULT_WIDTH = 430;
const EXPANDED_WIDTH = 1080;

const gotTheLock = app.requestSingleInstanceLock();
log('requestSingleInstanceLock: ' + gotTheLock);
if (!gotTheLock) {
  log('Did not get lock, quitting');
  app.quit();
} else {
  app.on('second-instance', () => {
    log('Second instance triggered');
    if (mainWindow) {
      if (mainWindow.isMinimized() || !mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
    }
  });
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width, height } = primaryDisplay.workArea;

  mainWindow = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: height,
    x: Math.round(x + width - DEFAULT_WIDTH),
    y: y,
    minWidth: DEFAULT_WIDTH,
    backgroundColor: '#101114',
    title: 'GoLite',
    frame: false,
    resizable: true,
    show: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('fullscreen-changed', true);
  });

  mainWindow.on('leave-full-screen', () => {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { x, y, width, height } = primaryDisplay.workArea;
    mainWindow.setBounds({
      x: Math.round(x + width - DEFAULT_WIDTH),
      y: y,
      width: DEFAULT_WIDTH,
      height: height
    });
    mainWindow.webContents.send('fullscreen-changed', false);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    log('mainWindow did-finish-load');
  });

  mainWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
    log(`[mainWindow L${line}] ${message}`);
  });

  mainWindow.webContents.on('did-fail-load', (e, code, desc) => {
    log(`mainWindow did-fail-load: ${code} ${desc}`);
  });

  mainWindow.webContents.on('render-process-gone', (e, details) => {
    log(`mainWindow render-process-gone: ${JSON.stringify(details)}`);
  });

  mainWindow.on('closed', () => {
    log('mainWindow closed');
    mainWindow = null;
  });

  mainWindow.on('minimize', (e) => {
    log('mainWindow minimize event');
    e.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('close', (e) => {
    log('mainWindow close event, isQuitting=' + app.isQuitting);
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  createNotificationWindow();
}

app.on('window-all-closed', (e) => {
  log('app window-all-closed fired');
  // Prevent app from quitting because it should live in tray
  e.preventDefault();
});

app.on('before-quit', (e) => {
  log('app before-quit fired, isQuitting=' + app.isQuitting);
});

app.on('will-quit', () => {
  log('app will-quit fired');
});

// Top-center notification window
function createNotificationWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width } = primaryDisplay.workAreaSize;
  const notifWidth = 480;
  const notifHeight = 74;

  notifWindow = new BrowserWindow({
    width: notifWidth,
    height: notifHeight,
    x: Math.round((width - notifWidth) / 2),
    y: 14,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  notifWindow.loadFile(path.join(__dirname, 'notification.html'));
}

function createTray() {
  const iconPath = path.join(__dirname, 'tray_icon.png');
  tray = new Tray(iconPath);
  tray.setToolTip('GoLite - P2P Screen Share');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir GoLite',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Encerrar',
      click: () => {
        app.isQuitting = true;
        app.exit(0);
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Centered Screen & Window Picker Modal
let pickerWindow = null;

function createPickerWindow() {
  pickerWindow = new BrowserWindow({
    width: 640,
    height: 540,
    center: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  pickerWindow.loadFile(path.join(__dirname, 'picker.html'));

  pickerWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      pickerWindow.hide();
    }
  });
}

ipcMain.on('open-picker', () => {
  if (pickerWindow) {
    pickerWindow.center();
    pickerWindow.show();
    pickerWindow.focus();
    pickerWindow.webContents.send('load-sources');
  }
});

ipcMain.on('close-picker', () => {
  if (pickerWindow) {
    pickerWindow.hide();
  }
});

ipcMain.on('source-chosen', (e, source) => {
  if (pickerWindow) {
    pickerWindow.hide();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('source-selected', source);
  }
});

// Fullscreen Monitor Toggle
ipcMain.on('toggle-fullscreen', (e, forceState) => {
  if (!mainWindow) return;
  const isCurrentlyFull = mainWindow.isFullScreen();
  const target = forceState !== undefined ? forceState : !isCurrentlyFull;

  if (target) {
    mainWindow.setFullScreen(true);
  } else {
    mainWindow.setFullScreen(false);
    const primaryDisplay = screen.getPrimaryDisplay();
    const { x, y, width, height } = primaryDisplay.workArea;
    mainWindow.setBounds({
      x: Math.round(x + width - DEFAULT_WIDTH),
      y: y,
      width: DEFAULT_WIDTH,
      height: height
    });
  }
  mainWindow.webContents.send('fullscreen-changed', target);
});

// Top Notification Toast IPC
ipcMain.on('show-entry-request', (e, data) => {
  log('[IPC] show-entry-request recebido: ' + JSON.stringify(data));
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.flashFrame(true);
  }
  if (notifWindow && !notifWindow.isDestroyed()) {
    notifWindow.webContents.send('set-request', data);
    notifWindow.setAlwaysOnTop(true, 'screen-saver');
    notifWindow.show();
    notifWindow.moveTop();
  }
});

ipcMain.on('entry-response', (e, data) => {
  log('[IPC] entry-response recebido: ' + JSON.stringify(data));
  if (notifWindow && !notifWindow.isDestroyed()) notifWindow.hide();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('entry-response-forward', data);
});

// ========================================================
// POPOUT / DETACHED VIEWER WINDOW
// ========================================================
ipcMain.on('open-popout', () => {
  if (popoutWindow && !popoutWindow.isDestroyed()) {
    if (popoutWindow.isMinimized()) popoutWindow.restore();
    popoutWindow.show();
    popoutWindow.focus();
    return;
  }

  popoutWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 480,
    minHeight: 270,
    backgroundColor: '#000000',
    title: 'GoLite - Transmissão',
    frame: false,
    resizable: true,
    show: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  popoutWindow.loadFile(path.join(__dirname, 'popout.html'));

  popoutWindow.on('enter-full-screen', () => {
    if (popoutWindow && !popoutWindow.isDestroyed()) {
      popoutWindow.webContents.send('popout-fullscreen-changed', true);
    }
  });

  popoutWindow.on('leave-full-screen', () => {
    if (popoutWindow && !popoutWindow.isDestroyed()) {
      popoutWindow.webContents.send('popout-fullscreen-changed', false);
    }
  });

  popoutWindow.on('closed', () => {
    popoutWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('popout-closed');
    }
  });
});

ipcMain.on('close-popout', () => {
  if (popoutWindow && !popoutWindow.isDestroyed()) {
    popoutWindow.close();
  }
});

ipcMain.on('popout-toggle-fullscreen', (event, forceState) => {
  if (popoutWindow && !popoutWindow.isDestroyed()) {
    const isFull = popoutWindow.isFullScreen();
    const target = forceState !== undefined ? forceState : !isFull;
    popoutWindow.setFullScreen(target);
    popoutWindow.webContents.send('popout-fullscreen-changed', target);
  }
});

ipcMain.on('popout-minimize', () => {
  if (popoutWindow && !popoutWindow.isDestroyed()) {
    popoutWindow.minimize();
  }
});

// Bidirectional WebRTC signaling between mainWindow and popoutWindow
ipcMain.on('popout-signal', (event, data) => {
  if (mainWindow && event.sender === mainWindow.webContents) {
    if (popoutWindow && !popoutWindow.isDestroyed()) {
      popoutWindow.webContents.send('popout-signal', data);
    }
  } else if (popoutWindow && event.sender === popoutWindow.webContents) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('popout-signal', data);
    }
  }
});

ipcMain.on('popout-ready', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('popout-ready');
  }
});

// Sources
ipcMain.handle('get-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 360, height: 202 },
      fetchWindowIcons: true
    });
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
      isScreen: s.id.startsWith('screen:')
    }));
  } catch (err) {
    console.error('Erro ao listar fontes:', err);
    return [];
  }
});

ipcMain.handle('check-discord-running', () => {
  return new Promise((resolve) => {
    exec('tasklist /fi "imagename eq Discord.exe" 2>NUL', (err, stdout) => {
      if (!err && stdout && stdout.toLowerCase().includes('discord.exe')) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
});

ipcMain.on('win-minimize', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.on('win-close', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.on('kill-process', () => {
  app.isQuitting = true;
  app.exit(0);
  process.exit(0);
});

// ========================================================
// AUTO-UPDATER (GitHub Releases -> app.zip -> swap files -> relaunch)
// ========================================================
function readUpdateConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'update-config.json'), 'utf8'));
  } catch (e) {
    return { repo: '' };
  }
}

function httpsGet(url, headers, redirects) {
  if (redirects === undefined) redirects = 6;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: Object.assign({ 'User-Agent': 'GoLite-Updater' }, headers || {}) }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(httpsGet(res.headers.location, headers, redirects - 1));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Tempo esgotado')));
  });
}

function isNewer(latest, current) {
  const a = String(latest).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const b = String(current).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function getAppVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    if (pkg && pkg.version) return pkg.version;
  } catch (e) {}
  return app.getVersion();
}

let pendingUpdate = null;

ipcMain.handle('get-version', () => getAppVersion());

ipcMain.handle('update-check', async () => {
  const cfg = readUpdateConfig();
  if (!cfg.repo) return { ok: false, error: 'Repositório não configurado' };
  try {
    const res = await httpsGet(`https://api.github.com/repos/${cfg.repo}/releases/latest`, { Accept: 'application/vnd.github+json' });
    if (res.statusCode === 404) { res.resume(); return { ok: false, error: 'Nenhuma versão publicada ainda' }; }
    if (res.statusCode !== 200) { res.resume(); return { ok: false, error: 'GitHub respondeu ' + res.statusCode }; }
    let body = '';
    res.setEncoding('utf8');
    for await (const chunk of res) body += chunk;
    const rel = JSON.parse(body);
    const asset = (rel.assets || []).find(a => a.name === 'app.zip');
    const current = getAppVersion();
    const hasUpdate = !!asset && isNewer(rel.tag_name, current);
    log(`[UPDATER] check: local=${current}, remote=${rel.tag_name}, hasUpdate=${hasUpdate}`);
    pendingUpdate = hasUpdate ? { version: rel.tag_name, url: asset.browser_download_url } : null;
    return { ok: true, current, latest: rel.tag_name, hasUpdate };
  } catch (err) {
    log('update-check error: ' + (err && err.message));
    return { ok: false, error: 'Sem conexão com o GitHub' };
  }
});

ipcMain.handle('update-apply', async () => {
  if (!pendingUpdate) return { ok: false, error: 'Nada para atualizar' };
  try {
    const workDir = path.join(os.tmpdir(), 'golite-update');
    fs.mkdirSync(workDir, { recursive: true });
    const zipPath = path.join(workDir, 'app.zip');
    log('[UPDATER] Baixando update de: ' + pendingUpdate.url);
    const res = await httpsGet(pendingUpdate.url);
    if (res.statusCode !== 200) { res.resume(); return { ok: false, error: 'Falha no download (' + res.statusCode + ')' }; }
    const total = parseInt(res.headers['content-length'] || '0', 10);
    let got = 0;
    const out = fs.createWriteStream(zipPath);
    res.on('data', (c) => {
      got += c.length;
      if (total && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-progress', Math.round(got / total * 100));
      }
    });
    await new Promise((resolve, reject) => {
      res.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      res.on('error', reject);
    });

    const ps1 = path.join(workDir, 'apply-update.ps1');
    const safeTarget = JSON.stringify(__dirname);
    const safeExe = JSON.stringify(process.execPath);
    const safeZip = JSON.stringify(zipPath);
    const procId = process.pid;

    fs.writeFileSync(ps1, [
      `$log = Join-Path $env:TEMP "golite-update\\update.log"`,
      `"[$(Get-Date)] Iniciando atualizacao..." | Out-File $log -Encoding utf8`,
      `$target = ${safeTarget}`,
      `$exe = ${safeExe}`,
      `$zip = ${safeZip}`,
      `$procId = ${procId}`,
      `try { Wait-Process -Id $procId -Timeout 10 -ErrorAction SilentlyContinue } catch {}`,
      `Get-Process -Name GoLite -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`,
      `Start-Sleep -Milliseconds 1200`,
      `$tmp = Join-Path $env:TEMP "golite-update\\extract"`,
      `if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }`,
      `Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force`,
      `robocopy $tmp $target /E /NFL /NDL /NJH /NJS /R:8 /W:1 | Out-Null`,
      `"[$(Get-Date)] Arquivos copiados com sucesso para $target" | Out-File $log -Append -Encoding utf8`,
      `Start-Sleep -Milliseconds 600`,
      `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine = ('"' + $exe + '"')}`,
      `"[$(Get-Date)] GoLite reiniciado com sucesso!" | Out-File $log -Append -Encoding utf8`
    ].join('\r\n'), 'utf8');

    spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps1
    ], { detached: true, stdio: 'ignore', windowsHide: true }).unref();

    log('[UPDATER] Handing off to updater script for ' + pendingUpdate.version);
    setTimeout(() => { app.isQuitting = true; app.exit(0); }, 500);
    return { ok: true };
  } catch (err) {
    log('update-apply error: ' + (err && err.stack));
    return { ok: false, error: 'Falha ao atualizar' };
  }
});

app.whenReady().then(() => {
  log('whenReady fired');
  try {
    createWindow();
    log('createWindow finished');
  } catch (e) {
    log('createWindow error: ' + e.stack);
  }
  try {
    createPickerWindow();
    log('createPickerWindow finished');
  } catch (e) {
    log('createPickerWindow error: ' + e.stack);
  }
  try {
    createTray();
    log('createTray finished');
  } catch (e) {
    log('createTray error: ' + e.stack);
  }
}).catch((err) => {
  log('whenReady error: ' + (err ? err.stack : err));
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
