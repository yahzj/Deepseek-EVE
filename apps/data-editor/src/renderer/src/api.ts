import type { DataEditorApi } from './model'

export async function resolveApi(): Promise<{ api: DataEditorApi; demo: boolean }> {
  if (window.dataEditor) return { api: window.dataEditor, demo: false }
  if (import.meta.env.DEV) {
    const { devApi } = await import('./devMock')
    return { api: devApi, demo: true }
  }
  throw new Error('桌面桥接未连接，无法读取或保存项目。请使用独立编辑器启动。')
}
