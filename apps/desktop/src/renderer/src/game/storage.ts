import { tr } from '../i18n/locale'
import { noteSaveWriteFailed } from './saveGuard'
import { bindSaveFile, readFromBoundFile, reconnectSaveFile, saveFileStatus, unbindSaveFile, writeToBoundFile,
  saveFileWriteToken, checkReconnectFile, resumeEquivalentFile, pauseBoundFile } from './saveFileHandle'
import { createSaveQueue } from '../../../shared/saveQueue'
import { canWriteSave } from './saveWriter'

const BP_NAME_RE = /^save-\d{8}-\d{6}(-\d+)?\.json$/

function stampOf(date: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `save-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.json`
}

function wallMsOf(name: string): number {
  const m = /^save-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name)
  if (!m) return 0
  const [, Y, Mo, D, H, Mi, S] = m.map(Number)
  return new Date(Y, Mo - 1, D, H, Mi, S).getTime()
}

function savedAtOf(text: string | null): number {
  if (text === null) return 0
  try {
    const raw = JSON.parse(text) as { savedAtWallMs?: unknown }
    const v = raw.savedAtWallMs
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

function touchLike(): boolean {
  try {
    if ((navigator.maxTouchPoints ?? 0) > 0) return true
    return typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches
  } catch {
    return false
  }
}

function newerSaveText(fileText: string | null, lsText: string | null): string | null {
  if (fileText === null) return lsText
  if (lsText === null) return fileText
  return savedAtOf(fileText) >= savedAtOf(lsText) ? fileText : lsText
}


const electronBridge: WhaleApi = {
  load: () => window.whale.load(),
  save: (data) => window.whale.save(data),
  backup: (snapshot) => window.whale.backup(snapshot),
  listBackups: () => window.whale.listBackups(),
  readBackup: (name) => window.whale.readBackup(name),
  restore: (name) => window.whale.restore(name),
  pickImportSave: () => window.whale.pickImportSave(),
  exportSaveToFile: (text) => window.whale.exportSaveToFile(text),
  deleteBackup: (name) => window.whale.deleteBackup(name),
  ironmanLedger: () => window.whale.ironmanLedger(),
  ironmanNoteRescue: () => window.whale.ironmanNoteRescue(),
}


const SAVE_KEY = 'whale:idle:save'
const BP_PREFIX = 'whale:idle:backup:'
const LEDGER_KEY = 'whale:idle:ironman-ledger'
const BP_CAP = 30
const webOperations = createSaveQueue()

function ls(): Storage {
  return window.localStorage
}
export function readStoredWebSave(): string | null { return ls().getItem(SAVE_KEY) }

function backupKeyOf(name: string): string | null {
  if (!BP_NAME_RE.test(name)) return null
  return BP_PREFIX + name
}

function setWithBudget(key: string, data: string): boolean {
  try {
    ls().setItem(key, data)
    return true
  } catch {
    let oldest: { key: string; wall: number } | null = null
    for (let i = 0; i < ls().length; i += 1) {
      const k = ls().key(i)
      if (k !== null && k.startsWith(BP_PREFIX)) {
        const wall = wallMsOf(k.slice(BP_PREFIX.length))
        if (oldest === null || wall < oldest.wall) oldest = { key: k, wall }
      }
    }
    if (oldest) ls().removeItem(oldest.key)
    try {
      ls().setItem(key, data)
      return true
    } catch {
      return false
    }
  }
}

function collectBackups(): Array<{ name: string; text: string; wall: number }> {
  const out: Array<{ name: string; text: string; wall: number }> = []
  for (let i = 0; i < ls().length; i += 1) {
    const k = ls().key(i)
    if (k !== null && k.startsWith(BP_PREFIX)) {
      const text = ls().getItem(k)
      if (text !== null) out.push({ name: k.slice(BP_PREFIX.length), text, wall: wallMsOf(k.slice(BP_PREFIX.length)) })
    }
  }
  return out
}

function webBumpLedgerFromSave(data: string): void {
  try {
    const raw = JSON.parse(data) as { state?: { ironman?: { seq?: unknown } } }
    const seqRaw = raw.state?.ironman?.seq
    const seq = typeof seqRaw === 'number' && Number.isFinite(seqRaw) ? Math.max(0, Math.floor(seqRaw)) : 0
    if (seq <= 0) return
    const cur = JSON.parse(ls().getItem(LEDGER_KEY) ?? '{"seq":0,"rescues":0}') as { seq?: unknown; rescues?: unknown }
    const curSeq = typeof cur.seq === 'number' && Number.isFinite(cur.seq) ? Math.max(0, Math.floor(cur.seq)) : 0
    if (seq <= curSeq) return
    const curRescues = typeof cur.rescues === 'number' && Number.isFinite(cur.rescues) ? Math.max(0, Math.floor(cur.rescues)) : 0
    ls().setItem(LEDGER_KEY, JSON.stringify({ seq, rescues: curRescues }))
  } catch (err) {
    console.warn('铁人账本写入失败，浏览器主档保留，账本保护降级。', err)
  }
}

function readWebLedger(): { ok: boolean; seq: number; rescues: number; error?: string } {
  try {
    const raw = ls().getItem(LEDGER_KEY)
    if (!raw) return { ok: true, seq: 0, rescues: 0 }
    const o = JSON.parse(raw) as { seq?: unknown; rescues?: unknown }
    const seq = typeof o.seq === 'number' && Number.isFinite(o.seq) ? Math.max(0, Math.floor(o.seq)) : 0
    const rescues = typeof o.rescues === 'number' && Number.isFinite(o.rescues) ? Math.max(0, Math.floor(o.rescues)) : 0
    return { ok: true, seq, rescues }
  } catch (err) {
    return { ok: false, seq: 0, rescues: 0, error: String(err) }
  }
}

const localStorageBridge: WhaleApi = {
  async load(): Promise<string | null> {
    return webOperations(async () => {
      const fileText = await readFromBoundFile().catch(() => null)
      const lsText = ls().getItem(SAVE_KEY)
      return newerSaveText(fileText, lsText)
    })
  },
  async save(data: string): Promise<boolean> {
    const token = saveFileWriteToken()
    return webOperations(async () => {
      if (!canWriteSave()) return false
      const fileRes = await writeToBoundFile(data, token).catch(() => false)
      if (fileRes === false) noteSaveWriteFailed()
      if (!setWithBudget(SAVE_KEY, data)) return false
      webBumpLedgerFromSave(data)
      return true
    })
  },
  async backup(snapshot?: string): Promise<{ ok: boolean; name?: string; error?: string }> {
    return webOperations(async () => {
      if (!canWriteSave()) return { ok: false }
      const text = snapshot ?? ls().getItem(SAVE_KEY)
      if (text === null) return { ok: false, error: tr("ui.storage.001") }
      const now = new Date()
      let name = stampOf(now)
      for (let n = 1; ls().getItem(BP_PREFIX + name) !== null; n += 1) {
        name = stampOf(new Date(now.getTime() + n))
      }
      if (!setWithBudget(BP_PREFIX + name, text)) return { ok: false, error: tr("ui.storage.002") }
      const backups = collectBackups().sort((a, b) => b.wall - a.wall)
      for (const b of backups.slice(BP_CAP)) ls().removeItem(BP_PREFIX + b.name)
      return { ok: true, name }
    })
  },
  async listBackups(): Promise<{ ok: boolean; backups: SaveBackupInfo[]; error?: string }> {
    return webOperations(async () => {
      const list = collectBackups()
        .sort((a, b) => b.wall - a.wall)
        .map((b) => ({ name: b.name, size: new TextEncoder().encode(b.text).length, wallMs: b.wall || Date.now() }))
      return { ok: true, backups: list.slice(0, BP_CAP) }
    })
  },
  async readBackup(name: string): Promise<{ ok: boolean; text?: string; error?: string }> {
    return webOperations(async () => {
      const key = backupKeyOf(name)
      const text = key === null ? null : ls().getItem(key)
      if (text === null) return { ok: false, error: tr("ui.storage.003") }
      return { ok: true, text }
    })
  },
  async restore(name: string): Promise<{ ok: boolean; error?: string }> {
    return webOperations(async () => {
      if (!canWriteSave()) return { ok: false }
      const key = backupKeyOf(name)
      const text = key === null ? null : ls().getItem(key)
      if (text === null) return { ok: false, error: tr("ui.storage.003") }
      if (!setWithBudget(SAVE_KEY, text)) return { ok: false, error: tr("ui.storage.004") }
      return { ok: true }
    })
  },
  async deleteBackup(name: string): Promise<{ ok: boolean; error?: string }> {
    return webOperations(async () => {
      if (!canWriteSave()) return { ok: false }
      const key = backupKeyOf(name)
      if (key === null) return { ok: false, error: tr("ui.storage.005") }
      if (ls().getItem(key) === null) return { ok: false, error: tr("ui.storage.003") }
      ls().removeItem(key)
      return { ok: true }
    })
  },
  async ironmanLedger(): Promise<{ ok: boolean; seq: number; rescues: number; error?: string }> {
    return webOperations(async () => readWebLedger())
  },
  async ironmanNoteRescue(): Promise<{ ok: boolean; error?: string }> {
    return webOperations(async () => {
      if (!canWriteSave()) return { ok: false }
      try {
        const cur = readWebLedger()
        ls().setItem(LEDGER_KEY, JSON.stringify({ seq: cur.seq, rescues: cur.rescues + 1 }))
        return { ok: true }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    })
  },
  async pickImportSave(): Promise<{ ok: boolean; text?: string; canceled?: boolean; error?: string }> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,application/json,text/plain,application/octet-stream,*/*'
      input.style.position = 'fixed'
      input.style.left = '-9999px'
      input.style.top = '0'
      input.style.width = '1px'
      input.style.height = '1px'
      input.style.opacity = '0'
      input.tabIndex = -1
      input.setAttribute('aria-hidden', 'true')
      document.body.appendChild(input)
      let done = false
      let polling = false
      let watchdog = 0
      let fgProbe = 0
      const finish = (r: { ok: boolean; text?: string; canceled?: boolean; error?: string }): void => {
        if (done) return
        done = true
        if (watchdog !== 0) window.clearTimeout(watchdog)
        if (fgProbe !== 0) window.clearInterval(fgProbe)
        input.remove()
        window.removeEventListener('focus', onFocusBack)
        window.removeEventListener('blur', onBlur)
        document.removeEventListener('visibilitychange', onVisibleBack)
        document.removeEventListener('visibilitychange', onHiddenAny)
        resolve(r)
      }
      const readPicked = (file: File): void => {
        if (file.size > 10 * 1024 * 1024) {
          finish({ ok: false, error: tr("ui.storage.006") })
          return
        }
        const reader = new FileReader()
        reader.onload = (): void => {
          finish({ ok: true, text: String(reader.result ?? '').replace(/^\uFEFF/, '') })
        }
        reader.onerror = (): void => finish({ ok: false, error: tr("ui.storage.007") })
        reader.readAsText(file, 'utf-8')
      }
      const graceMs = touchLike() ? 8000 : 2100
      const startPoll = (): void => {
        if (polling || done) return
        polling = true
        let waited = 0
        const poll = (): void => {
          if (done) return
          const picked = input.files?.[0]
          if (picked !== undefined) {
            readPicked(picked)
            return
          }
          waited += 300
          if (waited >= graceMs) {
            finish({ ok: false, canceled: true })
            return
          }
          setTimeout(poll, 300)
        }
        setTimeout(poll, 300)
      }
      const onFocusBack = (): void => startPoll()
      const onVisibleBack = (): void => {
        if (document.visibilityState === 'visible') startPoll()
      }
      const WATCHDOG_MS = touchLike() ? 60000 : 3500
      let leftForeground = false
      const onBlur = (): void => {
        leftForeground = true
      }
      const onHiddenAny = (): void => {
        if (document.visibilityState === 'hidden') leftForeground = true
      }
      watchdog = window.setTimeout(() => {
        if (done || leftForeground) return
        finish({ ok: false, canceled: true })
      }, WATCHDOG_MS)
      fgProbe = window.setInterval(() => {
        if (document.hidden) leftForeground = true
      }, 300)
      window.addEventListener('blur', onBlur)
      document.addEventListener('visibilitychange', onHiddenAny)
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        if (!file) {
          finish({ ok: false, canceled: true })
          return
        }
        readPicked(file)
      })
      input.addEventListener('cancel', () => finish({ ok: false, canceled: true }))
      window.addEventListener('focus', onFocusBack)
      document.addEventListener('visibilitychange', onVisibleBack)
      input.click()
    })
  },
  async exportSaveToFile(text: string): Promise<{ ok: boolean; shared?: boolean; canceled?: boolean; error?: string }> {
    const name = `${stampOf(new Date())}.json`
    try {
      const share = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>
        canShare?: (data: ShareData) => boolean
      }
      const file = new File([text], name, { type: 'application/json' })
      if (typeof share.share === 'function' && (typeof share.canShare !== 'function' || share.canShare({ files: [file] }))) {
        await share.share({ files: [file], title: name })
        return { ok: true, shared: true }
      }
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return { ok: false, canceled: true }
    }
    try {
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: tr("ui.storage.008", { p1: String(err) }) }
    }
  },
  saveFile: {
    status: () => saveFileStatus(),
    bind: async () => canWriteSave() ? await bindSaveFile(ls().getItem(SAVE_KEY)) : { ok: false },
    reconnect: () => canWriteSave() ? reconnectSaveFile() : Promise.resolve({ ok: false }),
    resume: (token, expected) => webOperations(async () => canWriteSave()
      ? resumeEquivalentFile(token, expected) : { ok: false }),
    resolve: (token, expected, text, choice) => webOperations(async () => {
      if (!canWriteSave()) return { ok: false }
      const checked = await checkReconnectFile(token, expected)
      if (!checked.ok) return checked
      if (choice === 'file') {
        if (!setWithBudget(SAVE_KEY, text)) return { ok: false, browserSaved: false, fileSaved: false, error: tr('ui.engine.027') }
        webBumpLedgerFromSave(text)
        const file = await checkReconnectFile(token, expected, text)
        return { ...file, browserSaved: true, fileSaved: file.ok }
      }
      const file = await checkReconnectFile(token, expected, text)
      if (!file.ok) return file
      const browserSaved = setWithBudget(SAVE_KEY, text)
      if (browserSaved) webBumpLedgerFromSave(text)
      else pauseBoundFile()
      return { ...file, ok: browserSaved, browserSaved, fileSaved: true,
        error: browserSaved ? undefined : tr('ui.engine.027') }
    }),
    unbind: () => canWriteSave() ? unbindSaveFile() : Promise.resolve({ ok: false }),
  },
}

export const saveBridge: WhaleApi =
  typeof window !== 'undefined' && window.whale !== undefined ? electronBridge : localStorageBridge
