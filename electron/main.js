const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell
} = require('electron');
const store = require('./store');
const updater = require('./update');

const RENDERER = path.join(__dirname, '..', 'renderer');
const SCHEME = 'png-animator';
const START_URL = SCHEME + '://app/index.html';

// Serving the renderer over a registered standard scheme rather than file://
// gives the page a real, stable origin, so fetch(), localStorage and the font
// loads all behave the way they do in a browser.
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

// Folders the user has explicitly chosen this session. write-frame refuses
// anywhere else, so a misbehaving renderer cannot scatter files across the disk.
const grantedDirs = new Set();

let mainWindow = null;

function resolveWithin(root, relative) {
  const cleaned = path.normalize(relative).replace(/^[\\/]+/, '');
  const target = path.join(root, cleaned);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

function createWindow() {
  const bounds = store.get('windowBounds', { width: 1600, height: 1000 });

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1280,
    minHeight: 760,
    show: false,
    backgroundColor: '#0d0e10',
    title: 'PNG Animator',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Frame-by-frame export walks a timer; without this it stalls the moment
      // the window is minimised or fully covered.
      backgroundThrottling: false
    }
  });

  if (store.get('windowMaximized', false)) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    setTimeout(() => runUpdateCheck(false), 1200);
  });
  mainWindow.loadURL(START_URL);

  const remember = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
    store.set('windowMaximized', mainWindow.isMaximized());
    if (!mainWindow.isMaximized()) store.set('windowBounds', mainWindow.getNormalBounds());
  };
  mainWindow.on('resize', remember);
  mainWindow.on('move', remember);
  mainWindow.on('close', remember);
  mainWindow.on('closed', () => { mainWindow = null; });

  // This app never navigates and never opens windows; treat any attempt as a
  // stray link and hand it to the real browser instead.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url !== START_URL) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

async function openImageDialog() {
  if (!mainWindow) return;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Open image',
    defaultPath: store.get('lastOpenDir', app.getPath('pictures')),
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'webp', 'gif', 'jpg', 'jpeg'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (res.canceled || !res.filePaths.length) return;

  const file = res.filePaths[0];
  store.set('lastOpenDir', path.dirname(file));
  try {
    const bytes = await fsp.readFile(file);
    mainWindow.webContents.send('open-image', { name: path.basename(file), bytes });
  } catch (err) {
    dialog.showErrorBox('Could not open image', err.message);
  }
}

/*
 * manual=true means the user asked, so say something either way. On launch we
 * only ever speak up when there is actually a new version - a dialog on every
 * quiet start would be worse than no check at all.
 */
async function runUpdateCheck(manual) {
  if (!manual && !store.get('checkUpdates', true)) return;
  const result = await updater.check(app.getVersion(), manual ? '' : store.get('skippedVersion', ''));
  if (result && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-available', result);
    return;
  }
  if (manual) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'PNG Animator',
      message: 'You are up to date.',
      detail: 'Version ' + app.getVersion() + ' is the latest release.\n\n' +
        'If you are offline this check quietly does nothing, so this message can also mean it could not reach GitHub.',
      buttons: ['OK']
    });
  }
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '&File',
      submenu: [
        { label: 'Open Image...', accelerator: 'CmdOrCtrl+O', click: openImageDialog },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Check for Updates Now', click: () => runUpdateCheck(true) },
        {
          label: 'Check for Updates on Launch',
          type: 'checkbox',
          checked: store.get('checkUpdates', true),
          click: (item) => {
            store.set('checkUpdates', item.checked);
            store.set('skippedVersion', '');
          }
        },
        { type: 'separator' },
        {
          label: 'About PNG Animator',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'PNG Animator',
            message: 'PNG Animator ' + app.getVersion(),
            detail: 'Electron ' + process.versions.electron + ' - Chromium ' + process.versions.chrome
          })
        }
      ]
    }
  ]));
}

ipcMain.handle('save-file', async (_e, { defaultName, ext, data }) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Save export',
    defaultPath: path.join(store.get('lastSaveDir', app.getPath('videos')), defaultName),
    filters: ext
      ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'All files', extensions: ['*'] }]
      : [{ name: 'All files', extensions: ['*'] }]
  });
  if (res.canceled || !res.filePath) return { canceled: true };

  await fsp.writeFile(res.filePath, Buffer.from(data));
  store.set('lastSaveDir', path.dirname(res.filePath));
  return { path: res.filePath };
});

ipcMain.handle('choose-export-folder', async (_e, { defaultName }) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder for the PNG sequence',
    defaultPath: store.get('lastExportDir', app.getPath('videos')),
    buttonLabel: 'Export here',
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };

  const parent = res.filePaths[0];
  store.set('lastExportDir', parent);

  // A sequence is hundreds of files; give it its own folder rather than
  // dumping it next to whatever else lives there.
  const dir = path.join(parent, defaultName.replace(/[^\w.-]+/g, '-'));
  await fsp.mkdir(dir, { recursive: true });
  grantedDirs.add(dir);
  return { dir, sep: path.sep };
});

ipcMain.handle('write-frame', async (_e, { dir, filename, data }) => {
  if (!grantedDirs.has(dir)) throw new Error('that folder was not chosen in this session');
  const target = resolveWithin(dir, filename);
  if (!target) throw new Error('invalid frame name: ' + filename);
  await fsp.writeFile(target, Buffer.from(data));
});

ipcMain.handle('open-release-page', () => {
  // The renderer never supplies a URL; main decides, so the page cannot be
  // talked into opening something arbitrary.
  shell.openExternal(updater.RELEASES_PAGE);
  return { ok: true };
});

ipcMain.handle('skip-update-version', (_e, version) => {
  store.set('skippedVersion', String(version || '').slice(0, 32));
  return { ok: true };
});

ipcMain.handle('reveal-path', async (_e, target) => {
  const allowed = grantedDirs.has(target) ||
    grantedDirs.has(path.dirname(target)) ||
    path.dirname(target) === store.get('lastSaveDir', null);
  if (!allowed || !fs.existsSync(target)) return;
  shell.openPath(fs.statSync(target).isDirectory() ? target : path.dirname(target));
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    protocol.handle(SCHEME, (request) => {
      const target = resolveWithin(RENDERER, decodeURIComponent(new URL(request.url).pathname));
      if (!target) return new Response('Forbidden', { status: 403 });
      // pathToFileURL rather than string concatenation: the install path can
      // contain spaces and other characters that need percent-encoding.
      return net.fetch(pathToFileURL(target).toString());
    });

    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => store.flush());
}
