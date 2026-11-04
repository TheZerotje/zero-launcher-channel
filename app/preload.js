'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('zl', {
  call: (name, ...args) => ipcRenderer.invoke('zl:' + name, ...args),
  on: (ch, fn) => { if (['state', 'toast', 'ai', 'progress'].includes(ch)) ipcRenderer.on(ch, (_e, p) => fn(p)); },
});
