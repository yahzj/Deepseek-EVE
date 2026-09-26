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

/**
 * **挂载件 → 明文效果**（2026-09-26 船长令：「**特殊装置的效果最好直接解释**。比如核心舱段：
 * 携带大量无人机的泰坦核心残骸端，受到攻击后会启动反击模式，增加无人机射程。」）。
 *
 * ⚠ 口径：**不报装置名，报"什么情况下发生什么"**——触发条件 ＋ 效果，逐条对得上
 * `core/foeMounts.ts` 里的效果字段（`droneRangeOnHit` / `web` / `gunRangeOnHit` / `supportCall` /
 * `evasionBonus` / `repairPulse` / `reviveEscort` / `charge` / **`rangeDebuff`**）。
 * 装置的中文名仍保留在括号里（玩家在战报/悬停里见过那个名字，留个对应关系）。
 *
 * **返回 `null` = 该件没有任何"可解释的机制"**（目录里只留了名字）——调用方据此决定"显示名"还是"显示效果"。
 * ⚠ 早先这一支返回的是**装置名本身**，于是战斗画面的悬停把同一串字又复读了一遍
 * （**2026-09-26 船长报障**：「**玩家鼠标悬停敌方挂载件时，不应该复读一遍相同的文字**」）⇒ 已改。
 */
export function mountEffectText(id: string): string | null {
  const def = FOE_MOUNTS[id as keyof typeof FOE_MOUNTS]
  if (!def) return null
  const nm = isEn() ? (def.en ?? def.name) : def.name
  const pct = (v: number) => String(Math.round(v * 100))

  if (def.droneRangeOnHit) {
    return tr('ui.foeIntro.100', { p1: String(def.droneRangeOnHit.mul), p2: nm })
  }
  if (def.gunRangeOnHit) {
    return tr('ui.foeIntro.101', { p1: String(def.gunRangeOnHit.mul), p2: nm })
  }
  if (def.web) {
    return tr('ui.foeIntro.102', { p1: pct(1 - def.web.slowMul), p2: String(def.web.rangeDownM), p3: nm })
  }
  if (def.supportCall) {
    return tr('ui.foeIntro.103', { p1: String(def.supportCall.delaySec), p2: nm })
  }
  if (def.reviveEscort) {
    return tr('ui.foeIntro.104', { p1: String(Math.round(def.reviveEscort.everyMs / 1000)), p2: nm })
  }
  if (def.repairPulse) {
    const sec = Math.round(def.repairPulse.everyMs / 1000)
    const amt = `${def.repairPulse.armor}/${def.repairPulse.hull}`
    return tr('ui.foeIntro.105', { p1: String(sec), p2: amt, p3: nm })
  }
  if (def.evasionBonus) {
    return tr('ui.foeIntro.106', { p1: pct(def.evasionBonus.add), p2: nm })
  }
  if (def.charge) {
    return tr('ui.foeIntro.107', { p1: String(def.charge.mul), p2: String(Math.round(def.charge.cooldownMs / 1000)), p3: nm })
  }
  if (def.rangeDebuff) {
    return tr('ui.foeIntro.108', { p1: pct(def.rangeDebuff.pct), p2: nm })
  }
  /** 目录里只留了名字、没有任何效果字段 ⇒ 没有可解释的机制（**不返回名字**，避免复读） */
  return null
}

/**
 * **按装置名反查 id**（战斗画面悬停用）。
 *
 * 为什么走名字反查而不是把 id 一路带进 `BattleState`：挂载件名在 **整条链上唯一**
 * （`core/foeMounts.ts` 的 14 件逐个核过、无重名），而 `BattleState.foeMounts` 里存的就是中文名
 * ⇒ 一行反查即可拿到 id，**不必新建 `foeMountIds` 三处随档/随快照字段**（少改 3 个文件、少一处漂移面）。
 * ⚠ 若日后出现重名件，这条会在 `content:check` 的名字唯一性之前静默取到先登记的那件 ⇒ **加件时保持名字唯一**。
 */
const MOUNT_ID_BY_NAME: ReadonlyMap<string, string> = new Map(
  Object.values(FOE_MOUNTS).map((d) => [d.name, String(d.id)]),
)

/** 按**装置中文名**取效果明文；查不到 id / 该件没有机制 ⇒ `null`（调用方回退显示名字） */
export function mountEffectTextByName(name: string): string | null {
  const id = MOUNT_ID_BY_NAME.get(name)
  return id === undefined ? null : mountEffectText(id)
}

/** 一句话的**分段**（界面要染色就得拿结构，不能拿拼好的字符串） */
export interface FoeBriefLine {
  /** 舰级 id（去重/取色的键） */
  id: string
  /** 舰级名（玩家可见舰种名） */
  name: string
  /** 舰种（护卫舰/驱逐舰/…） */
  hull: string
  /** 本卡编成里的数量（0 = 只是"可能出现"，不在本卡编成里） */
  count: number
  /** 其余部分：战术 / 武器 / 主副伤 / 舰载机 / 精英档 */
  bits: string[]
  /** 特殊装置那一节（**单独一段**：界面只染「特殊装置」这四个字）；无则缺省 */
  mounts?: string
}

/**
 * 其余部分：战术 / 武器 / 主副伤 / 舰载机 / 精英档。
 * ⚠ **"特殊装置"那一节不在这里**，写进 `out.mounts` 单独一段 —— 界面要**只染「特殊装置」四个字**
 * （2026-09-26 船长令：「特殊装置颜色不要和舰船名称颜色一样。建议就特殊装置这四个字染色」），
 * 所以必须让它拿得到这一段，而不是混在一串 bits 里。
 */
function bitsOf(ship: FoeShipDef, out: { mounts?: string }): string[] {
  const en = isEn()
  const bits: string[] = []
  if (ship.tactic === 'brawl') bits.push(tr('ui.foeIntro.010'))
  else if (ship.tactic === 'orbit') bits.push(tr('ui.foeIntro.011'))
  else if (ship.tactic === 'kite') bits.push(tr('ui.foeIntro.012'))
  if (ship.energyForm !== undefined) bits.push(ship.energyForm === 'beam' ? tr('ui.foeIntro.020') : tr('ui.foeIntro.021'))
  const mix = Object.entries(ship.dmgMix ?? {}).sort((a, b) => b[1] - a[1])
  const total = mix.reduce((n, [, v]) => n + v, 0)
  if (mix.length > 0 && total > 0) {
    const [mt, mv] = mix[0]!
    bits.push(tr('ui.foeIntro.030', { p1: dmgText(mt), p2: String(Math.round((mv / total) * 100)) }))
    const sub = mix[1]
    if (sub && sub[1] / total >= 0.15) bits.push(tr('ui.foeIntro.031', { p1: dmgText(sub[0]) }))
  }
  const drones = ship.drones ?? []
  if (drones.length > 0) {
    bits.push(tr('ui.foeIntro.040', { p1: String(drones.reduce((n, d) => n + (d.count ?? 1), 0)) }))
  }
  const mech: string[] = []
  for (const id of ship.mounts ?? []) {
    const nm = mountEffectText(id)
    if (nm) mech.push(nm)
  }
  if ((ship.repairPct ?? 0) > 0) mech.push(tr('ui.foeIntro.050'))
  if ((ship.foeRangeDebuffPct ?? 0) > 0) mech.push(tr('ui.foeIntro.051'))
  if (mech.length > 0) out.mounts = mech.join(en ? ', ' : '、')
  if (ship.elite === true) bits.push(tr('ui.foeIntro.070'))
  return bits
}

/** 取该卡编成里**每一种**舰（按 精英 > 档位 > 主舰 排序，去重；同型归一条并累计数量） */
export function briefShipsOf(anomaly: AnomalyDef | null | undefined): FoeBriefLine[] {
  const slots = anomaly?.ships ?? []
  const seen = new Map<string, { ship: FoeShipDef; count: number; main: boolean }>()
  for (const s of slots) {
    const ship = s?.ship
    if (!ship) continue
    const hit = seen.get(ship.id)
    if (hit) {
      hit.count += s.count ?? 1
      hit.main = hit.main || s.escort !== true
    } else {
      seen.set(ship.id, { ship, count: s.count ?? 1, main: s.escort !== true })
    }
  }
  const list = [...seen.values()]
  const score = (x: { ship: FoeShipDef; main: boolean }) =>
    (x.ship.elite === true ? 1000 : 0) + x.ship.hullClassTier * 10 + (x.main ? 5 : 0)
  list.sort((a, b) => score(b) - score(a))
  return list.map((x) => toLine(x.ship, x.count))
}

function toLine(ship: FoeShipDef, count: number): FoeBriefLine {
  const out: { mounts?: string } = {}
  const bits = bitsOf(ship, out)
  return {
    id: ship.id,
    name: ship.name,
    hull: isEn() ? (HULL_EN[ship.hullClassTier] ?? '') : (HULL_CN[ship.hullClassTier] ?? ''),
    count,
    bits,
    ...(out.mounts !== undefined ? { mounts: out.mounts } : {}),
  }
}

/** 挂载件那一节的**标签词**（「特殊装置」/「special mounts」）——界面要**只染这四个字**，故单点导出 */
export function mountLabelText(): string {
  return tr('ui.foeIntro.060', { p1: '' })
    .replace('{p1}', '')
    .replace(/[：:]\s*$/, '')
    .trim()
}

/**
 * **本场入侵"可能抽到"的全部敌舰**（2026-09-26 船长令：「**因为入侵卡是随机抽取的，你应该显示所有
 * 抽取的卡可能出现的敌人**」）。
 *
 * 口径：把该族该区域**整池**的卡都过一遍（`poolIds` = `weekendFoePoolOf(...)`，与抽取同源），
 * 逐卡取编成 → 按舰级 id 去重汇总。本卡编成里已有的记 `count`（>0），只是"可能出现"的记 0。
 */
export function briefsOfPool(anomalies: ReadonlyMap<string, AnomalyDef>, poolIds: readonly string[], drawn: AnomalyDef | null | undefined): FoeBriefLine[] {
  const acc = new Map<string, FoeBriefLine>()
  for (const id of poolIds) {
    const card = anomalies.get(id)
    for (const line of briefShipsOf(card)) {
      const hit = acc.get(line.id)
      if (hit) hit.count += line.count
      else acc.set(line.id, { ...line, count: line.count })
    }
  }
  // 本卡编成（可能不在池里，例如派生卡）也并进来，保证"这一仗真会遇到的"一定在列
  for (const line of briefShipsOf(drawn)) {
    const hit = acc.get(line.id)
    if (hit) hit.count = Math.max(hit.count, line.count)
    else acc.set(line.id, line)
  }
  const list = [...acc.values()]
  list.sort((a, b) => b.count - a.count || b.bits.length - a.bits.length || a.id.localeCompare(b.id))
  return list
}

/** 卡级：**逐种**给一句话（旗舰那种 5 种舰的编成 ⇒ 5 行） */
export function foeBriefsOfCard(anomaly: AnomalyDef | null | undefined): string[] {
  return briefShipsOf(anomaly).map((l) => lineText(l))
}

/** 一行拼成字符串（非染色场景用；染色场景直接读 `FoeBriefLine` 的分段） */
export function lineText(l: FoeBriefLine): string {
  const en = isEn()
  const head = en ? `${l.name} (${l.hull})` : `${l.name}（${l.hull}）`
  return l.bits.length > 0 ? `${head}${en ? ': ' : '：'}${l.bits.join(en ? ', ' : '，')}${en ? '.' : '。'}` : `${head}${en ? '.' : '。'}`
}

/** 取该卡里"最该介绍的那条舰"——单条用途（如卡面内嵌一行） */
export function briefShipOf(anomaly: AnomalyDef | null | undefined): FoeShipDef | null {
  const slots = anomaly?.ships ?? []
  return slots.find((s) => s?.ship)?.ship ?? null
}

/**
 * **一句话介绍**（单条字符串版；纯函数：同一个 `FoeShipDef` ⇒ 同一句话）。
 * ⚠ 判据走共用的 `bitsOf()` —— 分段版（`FoeBriefLine`，界面染色用）与这里**必须是同一套口径**，
 * 否则"悬停染色版"和"字符串版"会各说各的。
 */
export function foeShipBriefOf(ship: FoeShipDef | null | undefined): string | null {
  if (!ship) return null
  return lineText(toLine(ship, 1))
}

/** 卡级便捷入口（单条）：取代表舰 + 组句 */
export function foeBriefOfCard(anomaly: AnomalyDef | null | undefined): string | null {
  return foeShipBriefOf(briefShipOf(anomaly))
}
