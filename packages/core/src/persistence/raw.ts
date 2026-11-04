/** 战斗域职责拆分，保持原计算与顺序。 */
import type { RawState } from '../save'

/** 把未知值安全转成普通对象（非对象一律当空对象） */
export function asRaw(value: unknown): RawState {
  return typeof value === 'object' && value !== null ? (value as RawState) : {}
}

/** 非负有限数（坏值 = undefined，调用方决定丢弃或兜底） */
export function cleanPosNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
}

/** 「字符串 → 架数/枚数」计数表（键非空、值为 ≥0 整数；坏项丢键；空表 = undefined） */
export function cleanCountMap(raw: unknown): Record<string, number> | undefined {
  const r = asRaw(raw)
  let out: Record<string, number> | undefined
  for (const [k, v] of Object.entries(r)) {
    if (!k) continue
    const n = cleanPosNum(v)
    if (n === undefined) continue
    if (!out) out = {}
    out[k] = Math.floor(n)
  }
  return out
}

/** **两层计数表**（`舰tag → (机型 id → 架数)`；2026-09-14「逐舰机群」）：
 *  逐层清洗，空的一律省掉（读不到该字段的老档 = undefined ⇒ 调用方按"只有主控那一份"回落）。 */
export function cleanCountMapBy(raw: unknown): Record<string, Record<string, number>> | undefined {
  const r = asRaw(raw)
  let out: Record<string, Record<string, number>> | undefined
  for (const [k, v] of Object.entries(r)) {
    if (!k) continue
    const inner = cleanCountMap(v)
    if (!inner) continue
    if (!out) out = {}
    out[k] = inner
  }
  return out
}

/**
 * **逐舰账本清洗**（2026-09-16 逐舰维修）：键 = 战斗 tag（`player` / `ally-1`…），值走各自的单份清洗器。
 * 坏键/清洗失败的项**丢键**；整表为空 ⇒ `undefined`（不写字段 ⇒ 老读法退化成"只有主控那一份"）。
 */
export function cleanLedgerMap<T>(
  raw: unknown,
  cleanOne: (v: unknown) => T | undefined,
): Record<string, T> | undefined {
  const r = asRaw(raw)
  let out: Record<string, T> | undefined
  for (const [tag, v] of Object.entries(r)) {
    if (tag.length === 0) continue
    const one = cleanOne(v)
    if (one === undefined) continue
    if (!out) out = {}
    out[tag] = one
  }
  return out
}

/**
 * 保存数组的安全边界 = 基础槽位上界 + 插件件数上界；不是可装槽位，实装仍由船型/插件校验。
 */
export const PLUG_LIST_MAX = 8

export const RACK_MAX = 7 + PLUG_LIST_MAX

/**
 * 插件 id 列表清洗：非空字符串，保留重复件及位序，截到插件列表安全上界。
 *
 * ⚠ **这是"随档字段两处落笔"的第二处**（约定 §二验证闭环）：引擎侧写 `FleetShipState.plugs`，
 * 清洗器这里必须重建它，否则读档/刷新即丢（`importantTasks.salvagerGift` 的同款前车之鉴）。
 * 空表 ⇒ `undefined`（与 `droneLoad` 同款：没有就不写键，往返幂等）。
 */
export function cleanPlugIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string') continue
    const id = x.trim()
    if (id.length === 0) continue
    out.push(id)
    if (out.length >= PLUG_LIST_MAX) break
  }
  return out.length > 0 ? out : undefined
}

/** 弹药 id 映射清洗（弹药 MK2：kinetic/explosive/plasma 键下的非空字符串 id；坏值丢键） */
export function cleanAmmoIdMap(raw: unknown): Partial<Record<'kinetic' | 'explosive' | 'plasma', string>> | undefined {
  const r = asRaw(raw)
  let out: Partial<Record<'kinetic' | 'explosive' | 'plasma', string>> | undefined
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const v = r[t]
    if (typeof v === 'string' && v.length > 0) {
      if (!out) out = {}
      out[t] = v
    }
  }
  return out
}
