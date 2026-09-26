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
import { FOE_MOUNTS, WEB_BREAK_DIST_M } from '@whale/core'
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
 *
 * **2026-09-26 船长令**：「**不需要括号内的东西**」＋「**除非非常有必要，否则不要用括号进行额外说明**」
 * ⇒ 这九条文案**去掉了尾部的装置名括号**：调用方本来就在前面写着装置名，括号里那一份是重复；
 * 需要"这件叫什么"的地方，由调用方（悬停标签 / 图鉴小标题）自己带，不再塞进效果句里。
 *
 * **返回 `null` = 该件没有任何"可解释的机制"**（目录里只留了名字）——调用方据此决定"显示名"还是"显示效果"。
 * ⚠ 早先这一支返回的是**装置名本身**，于是战斗画面的悬停把同一串字又复读了一遍
 * （**2026-09-26 船长报障**：「**玩家鼠标悬停敌方挂载件时，不应该复读一遍相同的文字**」）⇒ 已改。
 */
export function mountEffectText(id: string): string | null {
  const def = FOE_MOUNTS[id as keyof typeof FOE_MOUNTS]
  if (!def) return null
  const pct = (v: number) => String(Math.round(v * 100))

  if (def.droneRangeOnHit) {
    return tr('ui.foeIntro.100', { p1: String(def.droneRangeOnHit.mul) })
  }
  if (def.gunRangeOnHit) {
    return tr('ui.foeIntro.101', { p1: String(def.gunRangeOnHit.mul) })
  }
  if (def.web) {
    // ⚠ 解除条件 = 击沉发动者（2026-09-16）**或交战距离超过 4500 米**（2026-09-26「这个断开对敌我都有效」）
    // —— 断开距离取引擎单点 `WEB_BREAK_DIST_M`，不在这里硬写数字
    return tr('ui.foeIntro.102', {
      p1: pct(1 - def.web.slowMul),
      p2: String(def.web.rangeDownM),
      p3: String(WEB_BREAK_DIST_M),
    })
  }
  if (def.supportCall) {
    return tr('ui.foeIntro.103', { p1: String(def.supportCall.delaySec) })
  }
  if (def.reviveEscort) {
    return tr('ui.foeIntro.104', { p1: String(Math.round(def.reviveEscort.everyMs / 1000)) })
  }
  if (def.repairPulse) {
    const sec = Math.round(def.repairPulse.everyMs / 1000)
    const amt = `${def.repairPulse.armor}/${def.repairPulse.hull}`
    return tr('ui.foeIntro.105', { p1: String(sec), p2: amt })
  }
  if (def.evasionBonus) {
    return tr('ui.foeIntro.106', { p1: pct(def.evasionBonus.add) })
  }
  if (def.charge) {
    return tr('ui.foeIntro.107', { p1: String(def.charge.mul), p2: String(Math.round(def.charge.cooldownMs / 1000)) })
  }
  if (def.rangeDebuff) {
    return tr('ui.foeIntro.108', { p1: pct(def.rangeDebuff.pct) })
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

/**
 * **一件特殊装置**（装置名 ＋ 效果明文）。
 *
 * ⚠ **一件一行**（**2026-09-26 船长令**：「**每个特殊装置都要如上文中那样单独起一行，并且连带
 * 挂载件名称一样染色**」）——所以这里**不给拼好的字符串**：界面要**逐件成行**，而且
 * 「特殊装置：」＋**装置名**要**同色**（`UI_TONES.matBattle`），只有效果说明保持正文色。
 * `name` 可能为空串（舰级字段那两条自愈/压制没有具名挂载件）⇒ 界面按"只有效果"渲染。
 */
export interface FoeMountLine {
  /** 装置名（`FOE_MOUNTS[id].name`；空串 = 该条没有具名装置） */
  name: string
  /** 该件的效果明文（触发条件 ＋ 效果，见 `mountEffectText`） */
  effect: string
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
  /** 特殊装置那一节（**逐件一行**；界面把「特殊装置：」＋装置名同色染）；无则缺省 */
  mounts?: FoeMountLine[]
}

/**
 * 其余部分：战术 / 武器 / 主副伤 / 舰载机 / 精英档。
 * ⚠ **"特殊装置"那一节不在这里**，写进 `out.mounts` —— 界面要**逐件一行**，且
 * 「特殊装置：」＋**装置名**要**同色**（2026-09-26 船长令两连：
 * 「特殊装置颜色不要和舰船名称颜色一样。建议就特殊装置这四个字染色」→
 * 「每个特殊装置都要如上文中那样单独起一行，并且连带挂载件名称一样染色」），
 * 所以必须让它拿得到**结构**，而不是混在一串 bits 里、也不是拼好的字符串。
 */
function bitsOf(ship: FoeShipDef, out: { mounts?: FoeMountLine[] }): string[] {
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
  const mech: FoeMountLine[] = []
  for (const id of ship.mounts ?? []) {
    const eff = mountEffectText(id)
    if (!eff) continue
    /**
     * **装置名按当前语言取**（**2026-09-26 三号补 · 真机复读抓出的缺口**）：
     * `FOE_MOUNTS` 是 **core 的静态表**（建档路径拿不到 `ctx`，见 `core/foeMounts.ts` 头注），
     * 而**中文名是唯一必填项** ⇒ 直接读 `.name` 在英文界面下恒中文（实测：补了 `en` 之后
     * 英文界面这里仍印「劫掠捕获网」）。战斗屏那条路走数据层的 `foeMountNamePairs`
     * （`mountNamesTextOf` 按语言挑列），**本模块不走那条**（它只拿得到中文名）
     * ⇒ 这里按同一条口径就地挑一列：有 `en` 用 `en`，缺省回退中文。
     */
    const def = FOE_MOUNTS[id as keyof typeof FOE_MOUNTS]
    const name = def === undefined ? '' : isEn() ? (def.en ?? def.name) : def.name
    mech.push({ name, effect: eff })
  }
  // 舰级字段兜底（没有具名挂载件的那两条：自愈 / 压制）——名字留空，界面按"只有效果"渲染
  if ((ship.repairPct ?? 0) > 0) mech.push({ name: '', effect: tr('ui.foeIntro.050') })
  if ((ship.foeRangeDebuffPct ?? 0) > 0) mech.push({ name: '', effect: tr('ui.foeIntro.051') })
  if (mech.length > 0) out.mounts = mech
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
  const out: { mounts?: FoeMountLine[] } = {}
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

/**
 * **单舰级的结构化简报**（2026-09-26 加：势力图鉴复用这份）。
 *
 * 与悬赏卡悬停**同一份内容、同一个出口**（`bitsOf` / `toLine`）——图鉴里那一行与悬停里那行**逐字同源**，
 * 不另写一套文案。`count` 传 `0` = "该族有这型舰、但不在某张卡的编成里"（图鉴就是这个语义）。
 * ⚠ **只读出口**：不改悬停的任何行为（`foeShipBriefOf` 仍走 `lineText(toLine(ship, 1))`）。
 */
export function foeBriefLinesOfShip(ship: FoeShipDef | null | undefined): FoeBriefLine | null {
  if (!ship) return null
  return toLine(ship, 0)
}

/** 挂载件那一节的**标签词**（「特殊装置」/「special mounts」）——界面要**只染这四个字**，故单点导出 */export function mountLabelText(): string {
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
  const body = [...l.bits]
  // 特殊装置并进同一行（字符串版没有"逐件成行"这回事）：装置名：效果，件间顿号
  if (l.mounts !== undefined && l.mounts.length > 0) {
    body.push(l.mounts.map((m) => (m.name !== '' ? `${m.name}${en ? ': ' : '：'}${m.effect}` : m.effect)).join(en ? ', ' : '、'))
  }
  return body.length > 0 ? `${head}${en ? ': ' : '：'}${body.join(en ? ', ' : '，')}${en ? '.' : '。'}` : `${head}${en ? '.' : '。'}`
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
