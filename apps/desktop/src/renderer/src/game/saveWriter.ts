/** 网页同 origin 单写者；锁在页面存活期间持有，不因切后台释放。 */
export type SaveWriterState = 'pending' | 'writer' | 'busy' | 'unsupported'
let state: SaveWriterState = 'pending'
let acquisition: Promise<SaveWriterState> | null = null
const listeners = new Set<() => void>()

export function saveWriterState(): SaveWriterState { return state }
export function subscribeSaveWriter(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function setState(next: SaveWriterState): void {
  state = next
  for (const listener of listeners) listener()
}
export function canWriteSave(): boolean {
  return typeof window !== 'undefined' && (window.whale !== undefined || state === 'writer')
}
export function acquireSaveWriter(): Promise<SaveWriterState> {
  if (acquisition) return acquisition
  if (typeof window !== 'undefined' && window.whale !== undefined) {
    setState('writer')
    return Promise.resolve(state)
  }
  acquisition = new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.locks) {
      setState('unsupported')
      resolve(state)
      return
    }
    try {
      void navigator.locks.request('whale:idle:save-writer', { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (!lock) {
          setState('busy')
          resolve(state)
          return
        }
        setState('writer')
        window.addEventListener('pageshow', (event) => {
          // BFCache 恢复不继承未核验的写入权；重载重新竞争锁并读取最新档。
          if (event.persisted) setState('busy')
        })
        resolve(state)
        await new Promise<void>(() => {})
      }).catch(() => { setState('unsupported'); resolve(state) })
    } catch {
      setState('unsupported')
      resolve(state)
    }
  })
  return acquisition
}
