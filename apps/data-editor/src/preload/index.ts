import { contextBridge, ipcRenderer } from 'electron'
import type { DataEditorApi } from '../../../../tools/data-editor-contract'
const invoke = (method: string, ...args: unknown[]) => ipcRenderer.invoke(`data-editor:${method}`, ...args)
const api: DataEditorApi = {
  chooseProject: () => invoke('chooseProject'),
  openProject: root => invoke('openProject', root),
  preview: (root, fingerprint, edits) => invoke('preview', root, fingerprint, edits),
  save: (root, token) => invoke('save', root, token),
  restore: root => invoke('restore', root),
  check: root => invoke('check', root),
  build: root => invoke('build', root),
  exportChanges: changes => invoke('exportChanges', changes),
  setDirty: dirty => ipcRenderer.send('data-editor:dirty', dirty),
}
contextBridge.exposeInMainWorld('dataEditor', api)
