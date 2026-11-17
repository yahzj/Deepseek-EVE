import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createSaveQueue } from '../shared/saveQueue'
import { atomicSaveWrite } from './atomicSaveWrite'

export const LEDGER_FILE_NAME = 'ironman-ledger.json'
export const LEDGER_SHADOW_NAME = 'ironman-ledger.bak.json'

export interface IronmanLedger {
  seq: number
  updatedAtWallMs: number
  rescues: number
}

const EMPTY_LEDGER: IronmanLedger = { seq: 0, updatedAtWallMs: 0, rescues: 0 }

export function parseLedger(text: string): IronmanLedger | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    const seq = typeof raw.seq === 'number' && Number.isFinite(raw.seq) ? Math.max(0, Math.floor(raw.seq)) : 0
    const updatedAtWallMs =
      typeof raw.updatedAtWallMs === 'number' && Number.isFinite(raw.updatedAtWallMs)
        ? Math.max(0, Math.floor(raw.updatedAtWallMs))
        : 0
    const rescues = typeof raw.rescues === 'number' && Number.isFinite(raw.rescues) ? Math.max(0, Math.floor(raw.rescues)) : 0
    return { seq, updatedAtWallMs, rescues }
  } catch {
    return null
  }
}

export function ironmanInfoOfSaveText(text: string): { on: boolean; seq: number; savedAtWallMs: number } | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    const savedAtWallMs =
      typeof raw.savedAtWallMs === 'number' && Number.isFinite(raw.savedAtWallMs) ? Math.max(0, Math.floor(raw.savedAtWallMs)) : 0
    const state = (raw.state ?? {}) as Record<string, unknown>
    const im = (state.ironman ?? {}) as Record<string, unknown>
    const seq = typeof im.seq === 'number' && Number.isFinite(im.seq) ? Math.max(0, Math.floor(im.seq)) : 0
    return { on: im.on === true, seq, savedAtWallMs }
  } catch {
    return null
  }
}

export interface IronmanLedgerStore {
  readLedger: () => Promise<IronmanLedger>
  writeLedger: (next: IronmanLedger) => Promise<void>
  bumpLedger: (seq: number, rescue?: boolean) => Promise<IronmanLedger>
  savedAtOfBackup: (name: string) => Promise<number>
}

export function ironmanLedgerStore(dirOf: () => string): IronmanLedgerStore {
  const enqueue = createSaveQueue()
  async function readCurrent(): Promise<IronmanLedger> {
    const dir = dirOf()
    const out = { ...EMPTY_LEDGER }
    for (const name of [LEDGER_FILE_NAME, LEDGER_SHADOW_NAME]) {
      try {
        const one = parseLedger(await fs.readFile(join(dir, name), 'utf8'))
        if (!one) continue
        out.seq = Math.max(out.seq, one.seq)
        out.updatedAtWallMs = Math.max(out.updatedAtWallMs, one.updatedAtWallMs)
        out.rescues = Math.max(out.rescues, one.rescues)
      } catch {
      }
    }
    return out
  }

  async function writeCurrent(next: IronmanLedger): Promise<void> {
    const dir = dirOf()
    const text = JSON.stringify(next)
    for (const name of [LEDGER_FILE_NAME, LEDGER_SHADOW_NAME]) {
      const file = join(dir, name)
      await atomicSaveWrite(file, text)
    }
  }

  async function bumpCurrent(seq: number, rescue: boolean): Promise<IronmanLedger> {
    const cur = await readCurrent()
    const next: IronmanLedger = {
      seq: Math.max(cur.seq, Math.max(0, Math.floor(seq || 0))),
      updatedAtWallMs: Date.now(),
      rescues: cur.rescues + (rescue ? 1 : 0),
    }
    if (next.seq !== cur.seq || rescue) {
      try {
        await writeCurrent(next)
      } catch (err) {
        console.warn('铁人账本写入失败，主档保存不回滚，账本保护降级。', err)
      }
    }
    return next
  }

  async function savedAtOfBackup(name: string): Promise<number> {
    try {
      const fh = await fs.open(join(dirOf(), name), 'r')
      try {
        const buf = Buffer.alloc(4096)
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
        const head = buf.subarray(0, bytesRead).toString('utf8')
        const m = /"savedAtWallMs"\s*:\s*(\d+)/.exec(head)
        return m ? Math.max(0, Number(m[1])) : 0
      } finally {
        await fh.close()
      }
    } catch {
      return 0
    }
  }

  return {
    readLedger: () => enqueue(readCurrent),
    writeLedger: (next) => {
      const snapshot = { ...next }
      return enqueue(() => writeCurrent(snapshot))
    },
    bumpLedger: (seq, rescue = false) => enqueue(() => bumpCurrent(seq, rescue)),
    savedAtOfBackup,
  }
}
