/**
 * **铁人模式：存档之外的代次账本**（2026-09-23 船长令）。
 *
 * **为什么账本必须放在存档之外**：代次若只写存档，回滚会把代次一起带回（等于没记）。
 * 账本放 `%APPDATA%` 下、**主 + 影子双写**（读时取 max）⇒ 玩家"外面换文件回滚"也能被看见；
 * **重置档案不清账本**（船长：「玩家重置档案并不会清空这个版本号」）。
 * 位置：与 `save.json` 同目录的 `ironman-ledger.json` / `ironman-ledger.bak.json`。
 *
 * ⚠ **本文件刻意不 import electron**：目录由一个 `dirOf()` 取值函数注入 ⇒ 同一份逻辑
 * 既能跑在 Electron 主进程里（`() => app.getPath('userData')`），也能被
 * `tools/ironman-ledger-check.ts` 直接拉起做实测（那条工具就是 S5 的"账本行为"回归）。
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export const LEDGER_FILE_NAME = 'ironman-ledger.json'
export const LEDGER_SHADOW_NAME = 'ironman-ledger.bak.json'

export interface IronmanLedger {
  /** 见过的最高代次 */
  seq: number
  /** 最后一次更新墙钟 */
  updatedAtWallMs: number
  /** 放行过的救援装载次数（只记账，玩家侧不显示——船长令） */
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

/** 从存档文本里取铁人信息（`{ format, version, savedAtWallMs, state }`） */
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
  /** 读备份文件头 4KB 取"存档自己的保存时刻"（救援判龄用；比文件 mtime 更抗"复制/搬动"） */
  savedAtOfBackup: (name: string) => Promise<number>
}

/** 造一份账本读写器；`dirOf()` 每次调用都重新取目录（Electron 的 userData 就绪前不可缓存） */
export function ironmanLedgerStore(dirOf: () => string): IronmanLedgerStore {
  /** 读账本：主 + 影子各读一次，取 **seq 最大**的那份（影子补"主文件被删/被改"） */
  async function readLedger(): Promise<IronmanLedger> {
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
        // 缺文件/坏文件 ⇒ 跳过（另一份可能与它互为备份）
      }
    }
    return out
  }

  /** 写账本（**原子写 + 双写**） */
  async function writeLedger(next: IronmanLedger): Promise<void> {
    const dir = dirOf()
    const text = JSON.stringify(next)
    for (const name of [LEDGER_FILE_NAME, LEDGER_SHADOW_NAME]) {
      const file = join(dir, name)
      const tmp = `${file}.tmp`
      await fs.writeFile(tmp, text, 'utf8')
      await fs.rename(tmp, file)
    }
  }

  /** 把账本推到"至少 seq"（只在"更高代次/更高计数"时才落盘） */
  async function bumpLedger(seq: number, rescue = false): Promise<IronmanLedger> {
    const cur = await readLedger()
    const next: IronmanLedger = {
      seq: Math.max(cur.seq, Math.max(0, Math.floor(seq || 0))),
      updatedAtWallMs: Date.now(),
      rescues: cur.rescues + (rescue ? 1 : 0),
    }
    if (next.seq !== cur.seq || rescue) {
      try {
        await writeLedger(next)
      } catch {
        // 账本写失败不阻断游戏（闸门退化为"只看当前档代次"）
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

  return { readLedger, writeLedger, bumpLedger, savedAtOfBackup }
}
