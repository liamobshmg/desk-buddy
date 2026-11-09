const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onSay: (cb) => ipcRenderer.on('say', (_e, p) => cb(p)),
  sayDone: () => ipcRenderer.send('say-done'),
  hit: (b) => ipcRenderer.send('hit', !!b),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  click: () => ipcRenderer.send('click'),
  menu: () => ipcRenderer.send('menu'),
});
