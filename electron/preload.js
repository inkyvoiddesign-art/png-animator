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

  /* Saved looks, kept on disk in userData rather than localStorage, so each
     one can carry its source PNG as well as its settings. */
  looks: {
    list: () => ipcRenderer.invoke('looks-list'),
    save: (payload) => ipcRenderer.invoke('looks-save', payload),
    load: (id) => ipcRenderer.invoke('looks-load', String(id)),
    remove: (id) => ipcRenderer.invoke('looks-delete', String(id)),
    exportOne: (id, defaultName) => ipcRenderer.invoke('looks-export', { id: String(id), defaultName }),
    importOne: () => ipcRenderer.invoke('looks-import')
  },

  /* Opens the releases page in the real browser. Deliberately takes no URL:
     main holds the address, so the page cannot redirect the user anywhere. */
  openReleasePage: () => ipcRenderer.invoke('open-release-page'),

  /* Stop offering this particular version. */
  skipUpdate: (version) => ipcRenderer.invoke('skip-update-version', String(version || '')),

  /* Fires only when a newer release exists. Returns an unsubscribe fn. */
  onUpdateAvailable(cb) {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('update-available', handler);
    return () => ipcRenderer.removeListener('update-available', handler);
  },

  /* File > Open Image delivers { name, bytes }. Returns an unsubscribe fn. */
  onOpenImage(cb) {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('open-image', handler);
    return () => ipcRenderer.removeListener('open-image', handler);
  }
});
