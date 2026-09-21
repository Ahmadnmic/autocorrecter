const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("ica", {
  state: () => ipcRenderer.invoke("state"),
  set: (k, v) => ipcRenderer.invoke("set", k, v),
  revert: (id) => ipcRenderer.invoke("revert", id),
  openPermissions: (which) => ipcRenderer.invoke("openPermissions", which),
  retryHook: () => ipcRenderer.invoke("retryHook"),
  openWeb: () => ipcRenderer.invoke("openWeb"),
  feedback: (text, contact) => ipcRenderer.invoke("feedback", text, contact),
  onState: (cb) => ipcRenderer.on("state", (_e, s) => cb(s)),
  onChip: (cb) => ipcRenderer.on("chip", (_e, c) => cb(c)),
});
