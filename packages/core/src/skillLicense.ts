/**
 * **技能训练许可**（付费解锁训练资格 · 2026-09-27 船长令）。
 *
 * 船长原话（照抄）：「我想让学习技能有成本，当玩家想要升级某个技能时，需要先购买技能书（不用实际购买，
 * 出现一个按钮，显示该技能的技能书多少钱，点之后直接付钱学会）。购买了技能书后，这个技能就可以随意从
 * LV1升级到LV5。技能书从RANK3到RANK5，价格分别为5万，20万，100万。rank1~2的技能不用技能书，初始便
 * 可以直接升级训练。」
 * 同日改判：「选甲，不过我想了下，还是rank4~rank6需要钱吧，价格分别为50万，200万，1000万」；
 * 同日裁定：「rank6是预留的。不用改名。按照现有名称维持。其他没问题」。
 *
 * **甲案**（船长选定）：买许可**只解锁训练资格** —— 拿到许可后仍要在训练队列里从 Lv1 逐级练，
 * 单级时长照旧由 rank 与目标等级决定 ⇒ 本系统加的是**钱**这道门槛，训练时长体系分毫不动。
 * 也因此，买许可**不会**顺带满足「前置 ≥ Lv1」（那得真练出来）⇒ 前置链的严肃性不受影响。
 *
 * ⚠ **命名**（船长裁定「不用改名。按照现有名称维持」）：技能树那 23 个分支（`SKILL_BRANCHES`）已占用
 * 「技能书」一词 ⇒ 本道具不得同名，定为「**训练许可**」（en: Training License）。玩家可见文案一律走
 * l10n id（`ui.SkillTree.023` 起 / `core.skillLicense.*`）⇒ 将来换词只改 `l10n/table.ts` 两行。
 *
 * **收费档**：rank4 = 50 万 · rank5 = 200 万 · **rank6 = 1000 万（预留档）**。本作数据表现最高 rank5，
 * 将来新增 rank6 技能时按本表**自动生效**、不必再改代码；rank1~3 免许可。
 *
 * **老档零迁移**：判据里"已经练到 Lv≥1"视同已购（见 `hasSkillLicense`）⇒ 不需要任何迁移键、
 * 也不回收玩家已练的等级（与真前置那套 `skillLockMissing` 同一思路）。
 */

import type { GameState } from './state'
import { addLog } from './state'
import type { SkillCatalog, SkillDef } from './types'

/**
 * **许可价目表**（ISK）——键 = 技能 rank。
 * ⚠ rank6 是**预留档**（船长 2026-09-27：「rank6是预留的」）：当前无 rank6 技能，但表先写好，
 * 以后往 `SKILLS` 里加 rank6 技能即按 100 万收费，不需要改这里之外的任何代码。
 */
export const SKILL_LICENSE_PRICES: Readonly<Record<number, number>> = {
  4: 500_000, // 50 万
  5: 2_000_000, // 200 万
  6: 10_000_000, // 1000 万（预留档）
}

/** 该技能的许可价（ISK）；`null` = **免许可**（rank1~3 或数据表里没登记的 rank） */
export function skillLicensePriceOf(def: Pick<SkillDef, 'rank'>): number | null {
  return SKILL_LICENSE_PRICES[def.rank] ?? null
}

/**
 * **是否已持有该技能的训练许可**（唯一判据，界面置灰 / 详情窗按钮 / `enqueueSkill` 共用这一把尺）。
 * 三条任一成立即放行：① 免费档（rank1~3）② 已买过 ③ **老档豁免**——已练到 Lv≥1（改动前练的，不再收费）。
 * ⚠ `trained[id] >= 1` 这条同时保证"玩家不会为已经练起来的技能白花钱"（买许可的动作里也据此拒绝）。
 */
export function hasSkillLicense(state: GameState, def: SkillDef): boolean {
  if (skillLicensePriceOf(def) === null) return true
  if (state.skills.licenses?.[def.id] === true) return true
  return (state.skills.trained[def.id] ?? 0) >= 1
}

/** 缺许可（= 需要买、且还没买）；`enqueueSkill` 的拒因与界面的"待购"状态同源 */
export function skillLicenseMissing(state: GameState, def: SkillDef): boolean {
  return !hasSkillLicense(state, def)
}

/**
 * **购买训练许可**（船长：「出现一个按钮，显示该技能的技能书多少钱，点之后直接付钱学会」——
 * 甲案：付钱买到的是**资格**，不是等级）。任何一条不满足都**不动账**。
 *
 * 拒绝的四种情形都带 `errorId`（id 制，界面按当前语言渲染）：
 * - 未知技能 · 免费档（不必买）· 已买过 · 已练到 Lv≥1（老档豁免生效，不必买）· 余额不足。
 */
export function buySkillLicense(
  state: GameState,
  catalog: SkillCatalog,
  skillId: string,
): {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  /** 成功时返回实付金额（ISK），供界面回话用 */
  price?: number
} {
  const def = catalog.get(skillId)
  if (!def) {
    return {
      ok: false,
      error: `未知技能：${skillId}（数据表里没有）。`,
      errorId: 'core.skillLicense.001',
      errorParams: { p1: skillId },
    }
  }
  const price = skillLicensePriceOf(def)
  if (price === null) {
    return {
      ok: false,
      error: `「${def.name}」无需训练许可（rank${def.rank} 技能初始即可训练）。`,
      errorId: 'core.skillLicense.002',
      errorParams: { p1: def.name, p2: def.rank },
    }
  }
  if (state.skills.licenses?.[skillId] === true) {
    return {
      ok: false,
      error: `已经买过「${def.name}」的训练许可了。`,
      errorId: 'core.skillLicense.003',
      errorParams: { p1: def.name },
    }
  }
  const trained = state.skills.trained[skillId] ?? 0
  if (trained >= 1) {
    return {
      ok: false,
      error: `「${def.name}」已练到 Lv${trained}，无需再买训练许可。`,
      errorId: 'core.skillLicense.004',
      errorParams: { p1: def.name, p2: trained },
    }
  }
  if (state.wallet.isk < price) {
    return {
      ok: false,
      error: `购买「${def.name}」的训练许可需要 ${price.toLocaleString('zh-CN')} ISK，当前只有 ${state.wallet.isk.toLocaleString('zh-CN')} ISK。`,
      errorId: 'core.skillLicense.005',
      errorParams: { p1: def.name, p2: price.toLocaleString('zh-CN'), p3: state.wallet.isk.toLocaleString('zh-CN') },
    }
  }
  state.wallet.isk -= price
  if (!state.skills.licenses) state.skills.licenses = {}
  state.skills.licenses[skillId] = true
  addLog(
    state,
    'trade',
    `📘 已购买训练许可「${def.name}」（rank${def.rank} · 耗 ${price.toLocaleString('zh-CN')} 信用点）——该技能现在可以排入训练队列。`,
    'core.skillLicense.006',
    { p1: def.name, p2: def.rank, p3: price.toLocaleString('zh-CN') },
  )
  return { ok: true, price }
}
