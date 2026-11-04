/** 战斗域职责拆分，保持原计算与顺序。 */
import type { BattleState, BattleShieldFieldStream, BattleShieldFieldLedger } from '../../state'
import { asRaw, cleanPosNum, cleanCountMap } from '../../persistence/raw'

/** 维修装置运行态（开战写入；**含预载组件账本**——丢了组件会凭空消失、战后无从退回） */
export function cleanRepair(raw: unknown): BattleState['repair'] | undefined {
  const r = asRaw(raw)
  if (Object.keys(r).length === 0) return undefined
  const units: NonNullable<BattleState['repair']>['units'] = []
  if (Array.isArray(r.units)) {
    for (const u of r.units) {
      const it = asRaw(u)
      const moduleId = typeof it.moduleId === 'string' ? it.moduleId : ''
      const kitId = typeof it.kitId === 'string' ? it.kitId : ''
      if (!moduleId || !kitId) continue
      /**
       * **逐台计时器**（**2026-09-21 船长令：不同型号独立回转冷却**）。旧档（在途战斗）没有本字段
       * ⇒ 不写该键 ⇒ `advanceBattleFor` 走迁移分支（借账本那一个 `nextPulseAtMs` 判一次到期，
       * 随后转入逐台计时）。**不升版本**。
       */
      const unitAt = cleanPosNum(it.nextPulseAtMs)
      units.push({
        moduleId,
        kitId,
        ...(it.free === true ? { free: true } : {}),
        armorPerPulse: cleanPosNum(it.armorPerPulse) ?? 0,
        hullPerPulse: cleanPosNum(it.hullPerPulse) ?? 0,
        stopped: it.stopped === true,
        ...(unitAt !== undefined ? { nextPulseAtMs: unitAt } : {}),
      })
    }
  }
  const nextPulseAtMs = cleanPosNum(r.nextPulseAtMs)
  const kitsUsedByType = cleanCountMap(r.kitsUsedByType)
  return {
    units,
    kits: cleanCountMap(r.kits) ?? {},
    pulses: Math.floor(cleanPosNum(r.pulses) ?? 0),
    kitsUsed: Math.floor(cleanPosNum(r.kitsUsed) ?? 0),
    ...(nextPulseAtMs !== undefined ? { nextPulseAtMs } : {}),
    ...(kitsUsedByType !== undefined ? { kitsUsedByType } : {}),
  }
}

/**
 * **逐型号脉冲流清洗**（**2026-09-21 船长令：不同型号独立回转冷却**）——两族共用（护盾充能 / 力场）。
 *
 * 两代结构都认：
 * - **新**（本批起）：`streams: [{ modelId, pct, ms, nextPulseAtMs? }, …]`；
 * - **旧**（2026-09-21 之前写下的在途战斗）：`{ pctPerPulse, msPerPulse?, nextPulseAtMs?, pulses }`
 *   ——**一台一路**的合计值 ⇒ 升级成**单路流**：`modelId` 留空串（找不到具体型号，**衰减已含在
 *   `pctPerPulse` 里**、不重算）。**不升存档版本、不改字段名。**
 *
 * ⚠ **比例与间隔都必须为正**（与改前同一条口径）：间隔为 0 / 缺失 ⇒ **该路丢弃** ——
 * 否则脉冲循环里 `nextPulseAtMs += 0` 会原地打转（`guard` 兜底但那是空转）。
 * 本文件**不 import `combat.ts` 的脉冲常量**（`save → combat → state` 会成环）⇒ 不替旧档猜间隔：
 * 旧结构本来就把 `msPerPulse` 写在档里（力场那件一直有），没有就是坏档、丢路。
 * 坏值一律丢路；整表为空 ⇒ `undefined`（不写字段 ⇒ 视为没装该族件）。
 */
export function cleanPulseStreams(raw: unknown): BattleShieldFieldStream[] | undefined {
  const r = asRaw(raw)
  if (Object.keys(r).length === 0) return undefined
  const out: BattleShieldFieldStream[] = []
  const rawList = Array.isArray(r.streams) ? r.streams : null
  if (rawList) {
    for (const item of rawList) {
      const s = asRaw(item)
      const pct = cleanPosNum(s.pct)
      if (pct === undefined || pct <= 0) continue
      const ms = cleanPosNum(s.ms)
      if (ms === undefined || ms <= 0) continue
      const nextPulseAtMs = cleanPosNum(s.nextPulseAtMs)
      out.push({
        modelId: typeof s.modelId === 'string' ? s.modelId : '',
        pct,
        ms,
        ...(nextPulseAtMs !== undefined ? { nextPulseAtMs } : {}),
      })
    }
  } else {
    // 旧结构（单路合计值）⇒ 升级为一行流
    const pct = cleanPosNum(r.pctPerPulse)
    const ms = cleanPosNum(r.msPerPulse)
    if (pct !== undefined && pct > 0 && ms !== undefined && ms > 0) {
      const nextPulseAtMs = cleanPosNum(r.nextPulseAtMs)
      out.push({ modelId: '', pct, ms, ...(nextPulseAtMs !== undefined ? { nextPulseAtMs } : {}) })
    }
  }
  return out.length > 0 ? out : undefined
}

/**
 * 护盾充能装置运行态（开战写入；2026-09-14 船长新增件；**2026-09-21 改逐型号多路**）。
 * 清洗口径与 `cleanRepair` 同款：坏值丢键、不崩、零迁移；**比例必须为正**否则视为无装置。
 *
 * ⚠ **本族旧档（单路 `pctPerPulse`）没有 `msPerPulse` 字段**（间隔是全局常量 30 秒、从不落档）
 * ⇒ 旧结构那一支要补上本族常量，否则在途战斗的护盾充能会被整块丢掉。该字面量与
 * `combat.SHIELD_PULSE_MS` 是**同一个数**；`save.ts` 不能 import `combat.ts`（会成环），
 * 故在此**显式写明同源**，并由用例 `pulse-stream-save.test.ts` 钉住两处相等。
 */
export const SHIELD_PULSE_MS_FOR_OLD_SAVE = 15_000

export function cleanShieldCharge(raw: unknown): BattleState['shieldCharge'] | undefined {
  const r = asRaw(raw)
  if (Object.keys(r).length === 0) return undefined
  // 旧档单路结构：`msPerPulse` 不存在 ⇒ 先按本族常量补进副本，再走统一清洗
  const src =
    !Array.isArray(r.streams) && cleanPosNum(r.msPerPulse) === undefined && cleanPosNum(r.pctPerPulse) !== undefined
      ? { ...r, msPerPulse: SHIELD_PULSE_MS_FOR_OLD_SAVE }
      : r
  const streams = cleanPulseStreams(src)
  if (!streams) return undefined
  return { streams, pulses: Math.floor(cleanPosNum(r.pulses) ?? 0) }
}

/**
 * **护盾充能力场运行态**（开战写入；2026-09-20 船长新增件；**2026-09-21 改逐型号多路**）。
 *
 * 清洗口径：坏路丢弃、不崩、零迁移；**比例与间隔都必须为正**，否则视为无装置。
 * 旧档（`pctPerPulse` / `msPerPulse` 单路）由 `cleanPulseStreams` 升级成一行流（两值都在档里）。
 */
export function cleanShieldField(raw: unknown): BattleShieldFieldLedger | undefined {
  const r = asRaw(raw)
  if (Object.keys(r).length === 0) return undefined
  const streams = cleanPulseStreams(r)
  if (!streams) return undefined
  return { streams, pulses: Math.floor(cleanPosNum(r.pulses) ?? 0) }
}

/**
 * **单份「修理脉冲账本」清洗**（`{ nextPulseAtMs?, pulses, healed }`）：整块缺/坏 ⇒ `undefined`
 * （零迁移）。`pulses`/`healed` 取有限非负整数（`healed` 允许小数，与累计量同精度），
 * `nextPulseAtMs` 只在正数时写。
 *
 * 两个消费方**共用本函数**（口径不许各写一份）：
 * ① `battle.foeRepair`（敌方后勤舰，2026-09-16）；
 * ② `battle.foeRepairPulses[tag]`（挂载件「船体修理装置」逐单位，2026-09-24）。
 */
export function cleanFoeRepairLedger(
  v: unknown,
): NonNullable<import('../../state').BattleState['foeRepair']> | undefined {
  const r = asRaw(v)
  if (Object.keys(r).length === 0) return undefined
  const next = typeof r.nextPulseAtMs === 'number' && Number.isFinite(r.nextPulseAtMs) ? r.nextPulseAtMs : 0
  const pulses = typeof r.pulses === 'number' && Number.isFinite(r.pulses) ? Math.max(0, Math.floor(r.pulses)) : 0
  const healed = typeof r.healed === 'number' && Number.isFinite(r.healed) ? Math.max(0, r.healed) : 0
  const out: NonNullable<import('../../state').BattleState['foeRepair']> = { pulses, healed }
  if (next > 0) out.nextPulseAtMs = Math.floor(next)
  return out
}
