/*
 * The only surface the renderer gets. contextIsolation is on, so this runs in
 * an isolated world and the page sees nothing beyond the functions exposed here.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pngAnimatorNative', {
  sep: process.platform === 'win32' ? '\\' : '/',

  /* Save As dialog, then write. Resolves { canceled } or { path }. */
  saveFile: (opts) => ipcRenderer.invoke('save-file', {
    defaultName: String(opts.defaultName || 'export'),
    ext: String(opts.ext || ''),
    data: opts.data
  }),

  /* Pick a parent folder; main creates defaultName inside it and returns the
     folder actually written to. Resolves { canceled } or { dir, sep }. */
  chooseExportFolder: (opts) => ipcRenderer.invoke('choose-export-folder', {
    defaultName: String(opts.defaultName || 'sequence')
  }),

  writeFrame: (dir, filename, data) => ipcRenderer.invoke('write-frame', { dir, filename, data }),
  revealPath: (target) => ipcRenderer.invoke('reveal-path', String(target)),

  /* File > Open Image delivers { name, bytes }. Returns an unsubscribe fn. */
  onOpenImage(cb) {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('open-image', handler);
    return () => ipcRenderer.removeListener('open-image', handler);
  }
});
