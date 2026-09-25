/**
 * **敌舰一句话介绍**（2026-09-26 船长令）。
 *
 * 船长原话（照抄）：「先落地入侵活动的悬赏卡的一句话介绍。
 * **介绍内要说明一些有特殊机制的敌方舰船的效果**。」
 *
 * **为什么从数据推导、而不是每条硬写一句**：敌舰的"特殊机制"本来就全在数据里——
 * 挂载件（冲锋推进器 / 捕获网 / 姿态陀螺仪 / 船体修理装置 / 支援呼叫装置 / 增程观瞄阵列）、
 * 无人机编队、能量形态、精英档。照着 `FOE_MOUNTS` 的 `name` 与各字段拼，写出来的必然与战斗里
 * 真正生效的是同一件事；硬写 30 句一旦机制改了（比如给某条船加了挂载件）文案就悄悄过期，没人会发现。
 *
 * ⚠ **为什么在界面层而不是 core**：core 只产出 `textId`（文案解析归界面），
 * 且敌舰定义就挂在**卡**的 `ships[].ship` 上（`ctx.anomalies` 已被 `localizeCtx` 本地化）——
 * 不需要额外的表，也不需要反向 import data 包。
 */
import type { AnomalyDef, FoeShipDef } from '@whale/core'
import { FOE_MOUNTS } from '@whale/core'
import { isEn, tr } from '../i18n/locale'


/** 舰种档中文（与 `data/src/hullClass.ts` 的 `HULL_CLASS_NAME` 同值） */
const HULL_CN: Record<number, string> = { 1: '护卫舰', 2: '驱逐舰', 3: '巡洋舰', 4: '战列舰', 5: '旗舰' }
const HULL_EN: Record<number, string> = { 1: 'frigate', 2: 'destroyer', 3: 'cruiser', 4: 'battleship', 5: 'flagship' }

/** 伤害类型短名（与伤害配色契约的三系同源） */
function dmgText(t: string): string {
  if (t === 'kinetic') return tr('ui.foeIntro.001')
  if (t === 'explosive') return tr('ui.foeIntro.002')
  if (t === 'plasma') return tr('ui.foeIntro.003')
  return t
}

/** 挂载件名按当前语言取（`FoeMountDef.en` 是英文列；与 `BattleScreen.mountNamesTextOf` 同一口径） */
function mountText(id: string): string | null {
  const def = FOE_MOUNTS[id as keyof typeof FOE_MOUNTS]
  if (!def) return null
  return isEn() ? (def.en ?? def.name) : def.name
}

/** 取该卡里"最该介绍的那条舰"：主舰优先，其次档位最高的（头目 > 护卫） */
export function briefShipOf(anomaly: AnomalyDef | null | undefined): FoeShipDef | null {
  const slots = anomaly?.ships ?? []
  if (slots.length === 0) return null
  let best: FoeShipDef | null = null
  for (const s of slots) {
    if (!s?.ship) continue
    if (best === null) {
      best = s.ship
      continue
    }
    const score = (d: FoeShipDef) => (d.elite === true ? 100 : 0) + d.hullClassTier
    if (score(s.ship) > score(best) || (score(s.ship) === score(best) && s.escort !== true)) best = s.ship
  }
  return best
}

/**
 * **一句话介绍**（纯函数：同一个 `FoeShipDef` ⇒ 同一句话）。
 * 组合 = `族名 + 舰种 + 舰级名：行为，武器，无人机，特殊机制，精英档。`
 * 其中"特殊机制"那一节是**逐件点名挂载件**（船长要的"说明特殊机制的效果"）。
 */
export function foeShipBriefOf(ship: FoeShipDef | null | undefined): string | null {
  if (!ship) return null
  const en = isEn()
  const bits: string[] = []

  // ① 行为（战术）
  if (ship.tactic === 'brawl') bits.push(tr('ui.foeIntro.010'))
  else if (ship.tactic === 'orbit') bits.push(tr('ui.foeIntro.011'))
  else if (ship.tactic === 'kite') bits.push(tr('ui.foeIntro.012'))

  // ② 武器形态：能量（光束必中 / 掷命中）
  if (ship.energyForm !== undefined) bits.push(ship.energyForm === 'beam' ? tr('ui.foeIntro.020') : tr('ui.foeIntro.021'))

  // ③ 主副伤构成（与战斗结算同源的 `dmgMix`）
  const mix = Object.entries(ship.dmgMix ?? {}).sort((a, b) => b[1] - a[1])
  const total = mix.reduce((n, [, v]) => n + v, 0)
  if (mix.length > 0 && total > 0) {
    const [mt, mv] = mix[0]!
    bits.push(tr('ui.foeIntro.030', { p1: dmgText(mt), p2: String(Math.round((mv / total) * 100)) }))
    const sub = mix[1]
    if (sub && sub[1] / total >= 0.15) bits.push(tr('ui.foeIntro.031', { p1: dmgText(sub[0]) }))
  }

  // ④ 无人机编队
  const drones = ship.drones ?? []
  if (drones.length > 0) {
    const totalN = drones.reduce((n, d) => n + (d.count ?? 1), 0)
    bits.push(tr('ui.foeIntro.040', { p1: String(totalN) }))
  }

  // ⑤ **特殊机制**：逐件点名挂载件（＋后勤/干扰两条不进挂载件的字段）
  const mech: string[] = []
  for (const id of ship.mounts ?? []) {
    const nm = mountText(id)
    if (nm) mech.push(nm)
  }
  if ((ship.repairPct ?? 0) > 0) mech.push(tr('ui.foeIntro.050'))
  if ((ship.foeRangeDebuffPct ?? 0) > 0) mech.push(tr('ui.foeIntro.051'))
  if (mech.length > 0) bits.push(tr('ui.foeIntro.060', { p1: mech.join(en ? ', ' : '、') }))

  // ⑥ 精英档
  if (ship.elite === true) bits.push(tr('ui.foeIntro.070'))

  const hull = (en ? HULL_EN : HULL_CN)[ship.hullClassTier] ?? ''
  /**
   * ⚠ **句子开头不能"族+舰种+舰名"三连**：舰名本身已经带族与舰种
   * （「墨潮突击舰」「海盗头目舰」「守墓王座舰」）⇒ 拼出来是「墨潮护卫舰墨潮突击舰」这种叠字。
   * 改口径：**舰名打头 + 舰种放括号**（规格），`族+舰种` 那份信息交给卡片上已有的族徽/档位。
   */
  const head = en ? `${ship.name} (${hull})` : `${ship.name}（${hull}）`
  return bits.length > 0 ? `${head}${en ? ': ' : '：'}${bits.join(en ? ', ' : '，')}${en ? '.' : '。'}` : `${head}${en ? '.' : '。'}`
}

/** 卡级便捷入口：取代表舰 + 组句（一处收口，界面不各拼一套） */
export function foeBriefOfCard(anomaly: AnomalyDef | null | undefined): string | null {
  return foeShipBriefOf(briefShipOf(anomaly))
}
