/** 功能域职责拆分，保持原计算与顺序。 */
import type { AnomalyDef, FoeShipSlot } from '@whale/core'
import { ANOMALY_ENTRY_0, ANOMALY_ENTRY_1 } from './specialPools'
import { ANOMALY_ENTRY_2 } from './training'
import { ANOMALY_ENTRY_3, ANOMALY_ENTRY_5, ANOMALY_ENTRY_20, ANOMALY_ENTRY_21, ANOMALY_ENTRY_22, ANOMALY_ENTRY_23 } from './familyA'
import { ANOMALY_ENTRY_4, ANOMALY_ENTRY_19 } from './familyB'
import { ANOMALY_ENTRY_6, ANOMALY_ENTRY_7, ANOMALY_ENTRY_17, ANOMALY_ENTRY_18 } from './familyD'
import { ANOMALY_ENTRY_8, ANOMALY_ENTRY_12, ANOMALY_ENTRY_16, ANOMALY_ENTRY_24 } from './familyC'
import { ANOMALY_ENTRY_9, ANOMALY_ENTRY_10, ANOMALY_ENTRY_11 } from './familyE'
import { ANOMALY_ENTRY_13, ANOMALY_ENTRY_14, ANOMALY_ENTRY_15 } from './familyG'
import { ANOMALY_ENTRY_25, ANOMALY_ENTRY_26, ANOMALY_ENTRY_27, ANOMALY_ENTRY_28 } from './encounterTemplates'

export const ANOMALIES_BASE: readonly AnomalyDef[] = [...ANOMALY_ENTRY_0, ...ANOMALY_ENTRY_1, ANOMALY_ENTRY_2, ANOMALY_ENTRY_3, ANOMALY_ENTRY_4, ANOMALY_ENTRY_5, ANOMALY_ENTRY_6, ANOMALY_ENTRY_7, ANOMALY_ENTRY_8, ANOMALY_ENTRY_9, ANOMALY_ENTRY_10, ANOMALY_ENTRY_11, ANOMALY_ENTRY_12, ANOMALY_ENTRY_13, ANOMALY_ENTRY_14, ANOMALY_ENTRY_15, ANOMALY_ENTRY_16, ANOMALY_ENTRY_17, ANOMALY_ENTRY_18, ANOMALY_ENTRY_19, ANOMALY_ENTRY_20, ANOMALY_ENTRY_21, ANOMALY_ENTRY_22, ANOMALY_ENTRY_23, ANOMALY_ENTRY_24, ANOMALY_ENTRY_25, ANOMALY_ENTRY_26, ANOMALY_ENTRY_27, ANOMALY_ENTRY_28]

export const RERATE_20260925: Readonly<Record<string, number>> = {
  'ano-training': 0.735,
  'ano-harbor-escort': 0.3427,
  'ano-redring-raiders': 1.3095,
  'ano-shard-bandits': 1.5882,
  'ano-mirage-hijackers': 4.5755,
  'ano-cinder-siege': 1.8349,
  'ano-titan-wreck': 1.6582,
  'ano-nadir-static': 2.1562,
  'ano-starcore-boss': 1.3171,
  'ano-chasm-aberrations': 2.0883,
  'ano-abyss-guard': 3.1283,
  'ano-maw-hunt': 1.444,
}

/** 按上表同乘血与火力（与 `lairAnomalyOf`/`wormholeAnomalyOf` 的 `scale` 同款做法） */
export function reratedCard(a: AnomalyDef): AnomalyDef {
  const k = RERATE_20260925[a.id]
  if (k === undefined || !a.ships || a.ships.length === 0) return a
  /** 多舰补偿 `2N/(N+1)`（与 core `foeMultiShipCompMul` 同式；本文件既有多族 `*_COMP` 常量同款） */
  const units = a.ships.reduce((n, s) => n + Math.max(1, Math.floor(s.count ?? 1)), 0)
  const comp = (2 * units) / (units + 1)
  const ships: readonly FoeShipSlot[] = a.ships.map((s) => {
    const hpMul = (s.hpMul ?? 1) * k
    const dmgMul = (s.dmgMul ?? 1) * k
    if (s.firepowerAnchor === undefined) return { ...s, hpMul, dmgMul }
    /**
     * **总火力锚点**：按 k 缩放（`round(旧锚 × k)`）——锚点是船长 2026-09-12 定的"**本条目实收总单发**"
     * 钉子（有意可低于自然合计：卡上挂机群时母舰单发让位），**不许按自然合计重算**
     * （实测：那样会把 泰坦残骸勘探 从 358 抬到 519、火力 +45%）。
     *
     * ⚠ **唯一例外 = 取整平局**：锚点若与"逐项取整后的自然合计"只差 ≤1，说明它本就是同一个量的
     * 另一种写法 ⇒ 取自然值。否则两者会互相打架，破 `content:check` 的
     * 「写了机群火力占比 ⇒ 总单发守恒」契约（实测：天底静区封锁 `round(80×2.1562)=172` vs 自然 171）。
     */
    const count = Math.max(1, Math.floor(s.count ?? 1))
    const gunPerUnit = Math.max(1, Math.round(s.ship.shotDmg * dmgMul * comp))
    const dronePerUnit = (s.ship.drones ?? []).reduce(
      (n, ds) => n + Math.max(0, Math.round(ds.count)) * Math.max(1, Math.round(ds.drone.dmg * dmgMul)),
      0,
    )
    const natural = Math.max(1, Math.round((gunPerUnit + dronePerUnit) * count))
    const scaled = Math.max(1, Math.round(s.firepowerAnchor * k))
    return { ...s, hpMul, dmgMul, firepowerAnchor: Math.abs(scaled - natural) <= 1 ? natural : scaled }
  })
  return { ...a, ships }
}

/** 全量敌卡目录（**已套用 2026-09-25 重定价批**；`ANOMALIES_FLAVORED` 与 `buildAnomalyCatalog` 同源） */
export const ANOMALIES: readonly AnomalyDef[] = ANOMALIES_BASE.map(reratedCard)

/** 构建异常点目录（2026-09-19 残骸合并后：卡上不再挂回收特色，一律走 `core/wreckGroups.ts` 的组表） */
export function buildAnomalyCatalog(): ReadonlyMap<string, AnomalyDef> {
  return new Map(ANOMALIES.map((a) => [a.id, a]))
}

/** 全量敌卡目录（桌面端 UI 目录同源；名字里的 "FLAVORED" 是历史名——卡级回收特色已退役，保留导出名免动全仓引用） */
export const ANOMALIES_FLAVORED: readonly AnomalyDef[] = ANOMALIES
