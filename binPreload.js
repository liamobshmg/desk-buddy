const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bin', {
  onLid: (cb) => ipcRenderer.on('lid', (_e, open) => cb(!!open)),
  onSwallow: (cb) => ipcRenderer.on('swallow', () => cb()),
  onEmerge: (cb) => ipcRenderer.on('emerge', () => cb()),
  onMuffled: (cb) => ipcRenderer.on('muffled', (_e, text) => cb(String(text))),
  hit: (b) => ipcRenderer.send('bin-hit', !!b),
  pull: () => ipcRenderer.send('bin-pull'),
  release: () => ipcRenderer.send('bin-release'),
  click: () => ipcRenderer.send('bin-click'),
  menu: () => ipcRenderer.send('bin-menu'),
});
