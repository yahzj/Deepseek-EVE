/**
 * **敌卡档案**（2026-10-02 从 `combat.ts` 拆出 · 批次 4d · 零行为变化）。
 *
 * 本文件 = 敌舰**显示名与舰级反查**：名字只由"异常属性 × 单位规格"推导（引擎建档与界面显示
 * 同源），以及舰级路径的 tag → 舰级反查（舰影/体积/名称同一入口）。全部**纯 AnomalyDef 读数**，
 * 只依赖 `types`，无战斗引擎内部件。`combat.ts` 原样再导出（先例：fitted.ts），
 * foeBrief / wormholeBattle / 用例等既有引用零改动；`enumerateShipUnits` / `shipWaveIndexOf`
 * 因 `createFoeSpecs` 也要用而转公开。
 */
import type { AnomalyDef, FoeShipDef, FoeShipSlot } from './types'

/* ═══════════ 敌舰显示名（2026-09-09 船长拍板：同一悬赏内规格/属性不同的敌舰名字不同；
   名字只由"异常属性 × 单位规格"推导，引擎建档与界面显示同源，存档字符串仅作兜底） ═══════════ */

/** 敌舰"舰种名"按 战术 × 血型（9 类；满规格主体用本名，弱规格单位加词缀） */
const FOE_CLASS: Record<string, Record<string, string>> = {
  brawl: { shield: '突击护卫舰', armor: '攻坚重甲舰', balanced: '突击炮艇' },
  orbit: { shield: '巡逻护卫舰', armor: '装甲巡逻舰', balanced: '环绕护航舰' },
  kite: { shield: '狙击护卫舰', armor: '远程装甲舰', balanced: '狙击炮艇' },
}

/** 规格词缀（前缀）：轻装 = 单舰规格 ≤ 本场最强档 ×FOE_LIGHT_FRAC（现覆盖僚机 ×0.6 份额与
 *  明显低血波，见 foeUnitNameOf）；"精锐"档预留——若将来出现相对规格 >1 的头目单位，
 *  在此增加精锐前缀分支即可（词缀判定与血量数值解耦，纯命名）。 */
export const FOE_LIGHT_WORD = '轻装'
/** 头目档词缀（2026-09-11 船长裁决实装；对应 `FoeShipDef.elite`）——与「轻装」同为纯命名、与数值解耦 */
export const FOE_ELITE_WORD = '精锐'
const FOE_LIGHT_FRAC = 0.6
const FOE_CLASS_FALLBACK = '敌方舰艇'

/** 舰种名（战术 × 血型；与卡面"敌型/战术"口径一致） */
export function foeClassName(tactic: string | undefined, profile: string | undefined): string {
  return FOE_CLASS[tactic ?? 'orbit']?.[profile ?? 'balanced'] ?? FOE_CLASS_FALLBACK
}

/** 主/僚判定（按 tag 结构，2026-09-09 多波）：主舰 = foe-0 或 w{n}-foe-{k}；
 *  僚机 = legacy foe-N（N≥1，旧单波 escorts）或 *-e{i}（各小队 escort）。
 *  ⚠ 支援舰（`sup{n}-<原tag>`）先剥前缀再判——它继承原单位的位次。 */
export function foeMainTagOf(tag: string): boolean {
  const base = baseFoeTag(tag)
  if (base === 'foe-0') return true
  if (/^foe-\d+$/.test(base)) return false
  return base.includes('-foe-') && !base.includes('-e')
}

/** 单位所在波的血档（tag 前缀 w{n}- 反查波表；首波/无波表 = 1）——支援舰同样先剥前缀 */
function waveHpShareOf(tag: string, anomaly: AnomalyDef): number {
  const waves = anomaly.waves
  if (!waves || waves.length === 0) return 1
  const m = /^w(\d+)-/.exec(baseFoeTag(tag))
  const idx = m ? Math.min(waves.length - 1, parseInt(m[1]!, 10)) : 0
  return Math.max(0.001, waves[idx]!.hpShare ?? 1)
}

/* ═══════ 舰级路径（2026-09-11 船长定案：敌舰配置表 · A 族试点）═══════
 * 写了 `anomaly.ships` 的卡走这条路：单位一律按**舰级绝对值 × 本条倍率**建档，
 * 不吃威胁份额均分、不吃 hpShare；允许同波混编（一张卡引用多个舰级）。
 * 未写的卡走下面的旧"威胁推导"路径，行为逐字不变。 */

/** 波序号从 tag 前缀反查（首波 = ''；第 n 波 = 'w{n}-'），与旧多波 tag 口径一致 */
export function shipWaveIndexOf(prefix: string): number {
  const m = /^w(\d+)-$/.exec(prefix)
  return m ? parseInt(m[1]!, 10) : 0
}

/**
 * 按 tag 命名规则枚举某波的舰级单位（**建档与反查共用同一顺序**，保证 tag 与舰级一一对应）。
 * tag 规则与旧口径一致：首队 = `foe-0`（主体）/ `foe-{i}`（僚机）；其余小队 = `{prefix}foe-{k}` /
 * `{prefix}foe-{k}-e{i}`（首波非首队用 `w0-` 前缀）。
 */
export function enumerateShipUnits(
  anomaly: AnomalyDef,
  waveIdx: number,
): Array<{ tag: string; slot: FoeShipSlot; escort: boolean }> {
  const prefix = waveIdx === 0 ? '' : `w${waveIdx}-`
  const out: Array<{ tag: string; slot: FoeShipSlot; escort: boolean }> = []
  let mainIdx = 0
  let lastMain = 0
  for (const slot of anomaly.ships ?? []) {
    if ((slot.wave ?? 0) !== waveIdx) continue
    const count = Math.max(1, Math.floor(slot.count ?? 1))
    const isEscort = slot.escort === true
    for (let i = 0; i < count; i++) {
      const k = isEscort ? lastMain : mainIdx + i
      const legacySquad = prefix === '' && k === 0
      const squadPrefix = legacySquad ? '' : prefix === '' ? 'w0-' : prefix
      const tag = isEscort
        ? legacySquad
          ? `foe-${i + 1}`
          : `${squadPrefix}foe-${k}-e${i + 1}`
        : legacySquad
          ? 'foe-0'
          : `${squadPrefix}foe-${k}`
      out.push({ tag, slot, escort: isEscort })
    }
    if (!isEscort) {
      lastMain = mainIdx + count - 1
      mainIdx += count
    }
  }
  return out
}

/**
 * **支援舰的 tag 前缀**（船长 2026-09-25「支援舰船召唤装置」）：复活/入场的支援舰 tag = `sup{n}-<原tag>`
 * ⇒ 界面上它是一艘**新单位**（新的舰影 + 入场动画），而美术/体积/名称仍按**原 tag** 解析。
 * `baseFoeTag` 是那条解析的**唯一剥壳点**（下面三个查询函数都先过它）。
 */
export const FOE_SUPPORT_TAG_RE = /^sup\d+-/

/** 剥掉支援舰前缀（非支援舰 tag 原样返回） */
export function baseFoeTag(tag: string): string {
  return tag.replace(FOE_SUPPORT_TAG_RE, '')
}

/** 舰级路径的 tag → 舰级反查（界面 `foeUnitNameOf` 沿用同一入口，读档/实时推导都不迁移） */
function foeShipAtTag(anomaly: AnomalyDef, tag: string): { ship: FoeShipDef; escort: boolean } | null {
  if (!anomaly.ships || anomaly.ships.length === 0) return null
  /** ⚠ **先剥支援舰前缀**（`sup1-foe-0` → `foe-0`）：不剥的话它查不到舰级 ⇒ 舰影/体积/名称一起回落 */
  const base = baseFoeTag(tag)
  const m = /^w(\d+)-/.exec(base)
  const waveIdx = m ? parseInt(m[1]!, 10) : 0
  for (const u of enumerateShipUnits(anomaly, waveIdx)) {
    if (u.tag === base) return { ship: u.slot.ship, escort: u.escort }
  }
  return null
}

/**
 * **单位 tag → 舰级 id**（界面逐舰取形用；2026-09-26 船长令「旧版敌人按敌舰不同做出些许区分」）。
 *
 * 与 `foeUnitNameOf` / `foeShipTierOf` / `foeShipEliteOf` **同一入口**（`foeShipAtTag`）——
 * 界面要画的舰、要显示的名、要算的体积必须来自同一次反查，三处各推一套必然对不上。
 *
 * 返回值是**舰级 id**（`FoeShipDef.id`，形如 `foe-pirate-skiff`），不是 tag（形如 `w1-foe-0#2`）：
 * 逐舰线稿按舰级 id 索引，tag 一带波次/序号/支援前缀就取不到形（静默落族形兜底）。
 *
 * 非舰级路径（旧卡无 `anomaly.ships`）→ `null`，界面自行回落族形。
 */
export function foeShipIdOfTag(anomaly: AnomalyDef | null | undefined, tag: string): string | null {
  if (!anomaly) return null
  return foeShipAtTag(anomaly, tag)?.ship.id ?? null
}

/**
 * **卡片代表舰**（界面画"这张卡的敌舰影"用；与 `foeShipIdOfTag` 同批）。
 *
 * 口径 = **本卡第 1 波里最强的那一型**：档高者优先，同档优先头目档（`elite`）；
 * 完全并列取编成表里靠前的那条。玩家在卡面/星图上一眼看到的应是本卡最危险的那型。
 *
 * ⚠ **不许在界面层拼 `foe-{k}` 反查**：tag 编号是按 `count` 展开并给支援舰跳号的
 * （`enumerateShipUnits`：`foe-3` 也可能是某条 `count:3` 条目的第 4 个单位），
 * 界面照编成表下标拼出来的 tag 会指向另一条舰。要 tag 就用 `foeShipIdOfTag`，
 * 要"代表舰"就用本函数——两者都从同一份编成枚举里取。
 *
 * 非舰级路径（旧卡无 `anomaly.ships`）→ `null`，界面回落族形。
 */
export function foeCardShipIdOf(anomaly: AnomalyDef | null | undefined): string | null {
  if (!anomaly?.ships || anomaly.ships.length === 0) return null
  let pick: { id: string; tier: number; elite: boolean } | null = null
  for (const u of enumerateShipUnits(anomaly, 0)) {
    const t = u.slot.ship.hullClassTier
    const e = u.slot.ship.elite === true
    if (!pick || t > pick.tier || (t === pick.tier && e && !pick.elite)) pick = { id: u.slot.ship.id, tier: t, elite: e }
  }
  return pick?.id ?? null
}

/** 敌舰单位显示名（船长 2026-09-09 拍板：舰种名 + 规格词缀）：
 * - **舰级路径**（有 `anomaly.ships`）：舰级自带玩家可见舰种名；头目档 → 「精锐」前缀，
 *   僚机 → 「轻装」前缀（2026-09-11 船长裁决实装精锐档）。
 * - **旧路径**：满规格主体 = 舰种名（9 类原样）；僚机（份额 ×0.6）或 明显低血波主舰
 *   （hpShare ≤ 同卡最强波 ×0.6）→ 轻装 + 舰种名；单卡单波/波间差异小（如穹顶 .857 比值）不触发。 */
export function foeUnitNameOf(anomaly: AnomalyDef, tag: string): string {
  const hit = foeShipAtTag(anomaly, tag)
  if (hit) {
    if (hit.ship.elite) return `${FOE_ELITE_WORD}${hit.ship.name}`
    return hit.escort ? `${FOE_LIGHT_WORD}${hit.ship.name}` : hit.ship.name
  }
  const base = foeClassName(anomaly.tactic, anomaly.defProfile)
  if (!foeMainTagOf(tag)) return `${FOE_LIGHT_WORD}${base}`
  const waves = anomaly.waves
  if (waves && waves.length > 0) {
    let maxShare = 0.001
    for (const w of waves) maxShare = Math.max(maxShare, w.hpShare ?? 0)
    if (waveHpShareOf(tag, anomaly) / maxShare <= FOE_LIGHT_FRAC) return `${FOE_LIGHT_WORD}${base}`
  }
  return base
}

/**
 * **敌舰单位的舰种档**（2026-09-11 船长：战斗动画的舰身体积与舰种挂钩）——界面的**只读查询**，
 * 与 `foeUnitNameOf` 同源（同一份 tag → 舰级反查）。
 *
 * - **舰级路径**（写了 `anomaly.ships` 的卡）：返回该编成条目所引舰级的 `hullClassTier`（1~5）；
 * - **旧威胁推导路径**（未写 `ships` 的卡）：返回 **`null`**——这些卡**没有舰种档**
 *   （旧路径的"舰种名"由战术×血型推导，不是质量分级）⇒ 界面按**回落尺寸**绘制。
 *   ⚠ 2026-09-11 船长裁定：旧路径卡的体积口径**延后**（等各族舰级在二号处补完再生效）。
 *
 * 用途：战斗画面按舰种给舰身尺寸（`TIER_SIZE`，见 `ui/battleViewCore`）——引擎**不消费**本值。
 */
export function foeShipTierOf(anomaly: AnomalyDef, tag: string): 1 | 2 | 3 | 4 | 5 | null {
  const hit = foeShipAtTag(anomaly, tag)
  return hit ? hit.ship.hullClassTier : null
}

/**
 * **敌舰单位是否「头目档」（`FoeShipDef.elite`）**（2026-09-11 船长：敌列错列雁阵"主舰在前、僚机与杂鱼在后"）——
 * 界面的**只读查询**，与 `foeUnitNameOf`/`foeShipTierOf` 同源（同一份 tag → 舰级反查）。
 *
 * ⚠ 界面**不能用 `foeMainTagOf` 当"主舰"**：那条规则把多波/多小队的 `w{n}-foe-{k}`（k≥1）也当主舰
 * （2026-09-09 为"第 2 艘主舰不再当僚机"而放宽）⇒ A 族卡的 3 艘杂鱼会被判成主舰。阵形用
 * 「**tag 是本波首舰（`(w{n}-)?foe-0`）或该舰级为头目档**」作"前排"，故需要本查询。
 *
 * 旧威胁推导路径（无舰级）→ `false`（这些卡靠 tag 首舰判前排）。
 */
export function foeShipEliteOf(anomaly: AnomalyDef, tag: string): boolean {
  const hit = foeShipAtTag(anomaly, tag)
  return hit ? hit.ship.elite === true : false
}
