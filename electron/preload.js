const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  showFolderPicker: (payload) =>
    ipcRenderer.invoke('show-folder-picker', payload).then((res) => res.path),
})
