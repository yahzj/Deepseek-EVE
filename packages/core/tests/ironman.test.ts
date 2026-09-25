/**
 * **铁人模式 · 用例**（**2026-09-23 船长令**：「和玩家讨论了下，发现好像搞一个铁人模式更受欢迎」）。
 *
 * 钉住四件事：
 * ① **代次**：只在铁人开启期间上升；关闭后冻结；装载闸门 `T = max(当前档, 账本)`；
 * ② **救援例外**：`< T` 但**存档年龄 ≥48 小时** ⇒ 放行（船长：「回退这么多刚刚好作为平衡」）；
 * ③ **福利**：非铁人一律 1×（既有读数逐字不变）；铁人 = 离线上限 +8h / 市场三旋钮 / 奖励 1.1 /
 *    稀有掉率 1.2 / 训练 0.9（**贸易税不做优惠**）；
 * ④ **存档往返**：`ironman` 字段（含 seq/墙钟）不许在读档时丢（白名单落笔）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { ensureMarket, slowSupplyDraw } from '../src/market'
import { achievementOf } from '@whale/data'
import { achievementReached } from '../src/achievements'
import { makeTestCtx, moduleDef } from './helpers'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { simulateOffline } from '../src/simulation'
import { trainingTimeFactor } from '../src/training'
import { rareDropRateMulOf, rewardMulOf } from '../src/tuning'
import {
  IRONMAN_COMMON_FLOW_MUL,
  IRONMAN_EXOTIC_CAP_BONUS,
  IRONMAN_EXOTIC_WEIGHT_MUL,
  IRONMAN_OFFLINE_CAP_BONUS_MS,
  IRONMAN_RARE_DROP_MUL,
  IRONMAN_RARE_WEIGHT_MUL,
  IRONMAN_RESCUE_MIN_AGE_MS,
  IRONMAN_REWARD_MUL,
  IRONMAN_TRAINING_MUL,
  bumpIronmanSeq,
  closeIronman,
  enterIronman,
  ironmanClosed,
  ironmanCommonFlowMul,
  ironmanEver,
  ironmanExoticCapBonus,
  ironmanExoticWeightMul,
  ironmanLoadVerdict,
  ironmanOfflineCapBonusMs,
  ironmanOf,
  ironmanOn,
  ironmanRareDropMul,
  ironmanRareWeightMul,
  ironmanRewardMul,
  ironmanSeq,
  ironmanTrainingMul,
  // 2026-09-24 船长令：模式选择弹窗（判据 ＋ 选普通的记账）
  ironmanModeChosen,
  markModeChosenAsStandard,
} from '../src/ironman'

const H = 3_600_000
const ctx = buildSimContext()

/** 造一份铁人档（可选：指定代次/开启时刻） */
function ironState(seq: number, sinceWallMs = 1_000): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 7 })
  enterIronman(s, sinceWallMs, 0)
  s.ironman = { ...s.ironman!, seq }
  return s
}

describe('铁人模式 · 代次与开关', () => {
  it('新档默认是「普通档 · 代次 0」；代次只在铁人开启期间上升', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1 })
    expect(ironmanOf(s)).toEqual({ on: false, seq: 0 })
    expect(ironmanOn(s)).toBe(false)
    // 普通档：落盘多少次都不涨（冻结）
    expect(bumpIronmanSeq(s)).toBe(0)
    expect(bumpIronmanSeq(s)).toBe(0)
    expect(ironmanSeq(s)).toBe(0)
    // 开铁人 ⇒ 开始涨
    enterIronman(s, 5_000)
    expect(ironmanOn(s)).toBe(true)
    expect(bumpIronmanSeq(s)).toBe(1)
    expect(bumpIronmanSeq(s)).toBe(2)
    expect(ironmanSeq(s)).toBe(2)
    expect(ironmanEver(s)).toBe(true)
    expect(ironmanClosed(s)).toBe(false)
  })

  it('关闭铁人：写关闭时刻、代次冻结、不可再开启（单向门）', () => {
    const s = ironState(10)
    expect(closeIronman(s, 9_000)).toBe(true)
    expect(ironmanOn(s)).toBe(false)
    expect(ironmanClosed(s)).toBe(true)
    expect(ironmanOf(s).closedWallMs).toBe(9_000)
    expect(ironmanEver(s), '曾经是铁人档（徽章判据）').toBe(true)
    // 代次冻结在 10
    expect(bumpIronmanSeq(s)).toBe(10)
    // 幂等：再关一次不生效（也不会改掉原关闭时刻）
    expect(closeIronman(s, 11_000)).toBe(false)
    expect(ironmanOf(s).closedWallMs).toBe(9_000)
  })

  it('单向门：关闭过的档拒绝再入铁人（`enterIronman` 返回 false 且一个字都不改）', () => {
    const s = ironState(10)
    expect(closeIronman(s, 9_000)).toBe(true)
    const before = { ...ironmanOf(s) }
    expect(enterIronman(s, 20_000, 99)).toBe(false)
    expect(ironmanOn(s)).toBe(false)
    expect(ironmanOf(s)).toEqual(before) // 代次/关闭时刻/入模时刻全不动
    // 重置档案 = 全新状态（没有 closedWallMs）⇒ 新档照旧可选铁人
    const fresh = createInitialState({ nowWallMs: 0, seed: 3 })
    expect(enterIronman(fresh, 30_000, 12)).toBe(true)
    expect(ironmanSeq(fresh)).toBe(12)
    // 已经开着的档再调一次：空操作（入模时刻不被改写）
    expect(enterIronman(fresh, 40_000, 0)).toBe(true)
    expect(ironmanOf(fresh).sinceWallMs).toBe(30_000)
  })

  it('转换时把代次顶到账本高度（防"曾经铁人 → 关闭 → 重置"后误伤自己那份档）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 2 })
    expect(ironmanSeq(s)).toBe(0)
    enterIronman(s, 3_000, 5_000)
    expect(ironmanSeq(s), '顶到账本 5000').toBe(5_000)
    expect(bumpIronmanSeq(s)).toBe(5_001)
    expect(ironmanOf(s).sinceWallMs).toBe(3_000)
  })
})

describe('铁人模式 · 装载闸门（导入 / 恢复共用的唯一判据）', () => {
  const now = 100 * H
  const base = { currentSeq: 900, ledgerSeq: 1_000, incomingSavedAtWallMs: now - 1 * H, nowWallMs: now }

  it('普通档：一律放行（含"更旧的档"）', () => {
    expect(ironmanLoadVerdict({ ...base, ironman: false, incomingSeq: 1 })).toEqual({ ok: true, rescue: false })
  })

  it('铁人档：代次 ≥ 阈值放行；阈值 = max(当前档, 账本)', () => {
    expect(ironmanLoadVerdict({ ...base, ironman: true, incomingSeq: 1_000 })).toEqual({ ok: true, rescue: false })
    expect(ironmanLoadVerdict({ ...base, ironman: true, incomingSeq: 1_200 })).toEqual({ ok: true, rescue: false })
  })

  it('铁人档：代次更靠前且不到两天 ⇒ 拒绝（"版本号更靠前则导入失败"）', () => {
    const v = ironmanLoadVerdict({ ...base, ironman: true, incomingSeq: 899 })
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.reason).toBe('rolled-back')
      expect(v.threshold).toBe(1_000)
    }
  })

  it('铁人档：代次更靠前但**存档年龄 ≥48 小时** ⇒ 救援放行', () => {
    const old = ironmanLoadVerdict({
      ...base,
      ironman: true,
      incomingSeq: 10,
      incomingSavedAtWallMs: now - IRONMAN_RESCUE_MIN_AGE_MS - 1,
    })
    expect(old).toEqual({ ok: true, rescue: true })
    // 正好 48 小时也放行（含边界）
    const edge = ironmanLoadVerdict({
      ...base,
      ironman: true,
      incomingSeq: 10,
      incomingSavedAtWallMs: now - IRONMAN_RESCUE_MIN_AGE_MS,
    })
    expect(edge).toEqual({ ok: true, rescue: true })
    // 缺"上次保存时刻"（老档形态）⇒ 不给救援
    const noStamp = ironmanLoadVerdict({ ...base, ironman: true, incomingSeq: 10, incomingSavedAtWallMs: 0 })
    expect(noStamp.ok).toBe(false)
  })

  it('关闭铁人后再导入"当年的铁人旧档" ⇒ 仍按铁人档判（不然等于用回滚偷偷开回来）', () => {
    /**
     * 判据由调用方给：`ironmanOn(当前) || ironmanOn(待装载)`（引擎 `ironmanLoadCheck`）。
     * 本用例固定"当前档已关闭（on=false）+ 待装载档是铁人档且代次更早"这一格。
     */
    const v = ironmanLoadVerdict({ ...base, ironman: true, incomingSeq: 900 })
    expect(v.ok).toBe(false)
    // 同一份档若是"关铁人之前手动备份的两天前旧档" ⇒ 走救援，仍放行（船长给的救援通道不受影响）
    const rescue = ironmanLoadVerdict({
      ...base,
      ironman: true,
      incomingSeq: 900,
      incomingSavedAtWallMs: now - IRONMAN_RESCUE_MIN_AGE_MS - 1,
    })
    expect(rescue).toEqual({ ok: true, rescue: true })
    // 而"当前普通 + 载入普通档"这一格永远是放行（老玩家完全不受影响）
    expect(ironmanLoadVerdict({ ...base, ironman: false, incomingSeq: 0 })).toEqual({ ok: true, rescue: false })
  })
})

describe('铁人模式 · 福利乘区（非铁人一律 1×）', () => {
  it('普通档 / 已关闭的档：所有福利都是 1×（既有读数逐字不变）', () => {
    const normal = createInitialState({ nowWallMs: 0, seed: 3 })
    const closed = ironState(5)
    closeIronman(closed, 8_000)
    for (const s of [normal, closed]) {
      expect(ironmanOfflineCapBonusMs(s)).toBe(0)
      expect(ironmanCommonFlowMul(s)).toBe(1)
      expect(ironmanRareWeightMul(s)).toBe(1)
      expect(ironmanExoticWeightMul(s)).toBe(1)
      expect(ironmanRewardMul(s)).toBe(1)
      expect(ironmanRareDropMul(s)).toBe(1)
      expect(ironmanTrainingMul(s)).toBe(1)
    }
  })

  it('铁人档：七个乘区按船长定稿值生效（贸易税不做优惠 ⇒ 无对应乘区）', () => {
    const s = ironState(1)
    expect(ironmanOfflineCapBonusMs(s)).toBe(IRONMAN_OFFLINE_CAP_BONUS_MS)
    expect(IRONMAN_OFFLINE_CAP_BONUS_MS).toBe(8 * H)
    expect(ironmanCommonFlowMul(s)).toBe(IRONMAN_COMMON_FLOW_MUL)
    expect(IRONMAN_COMMON_FLOW_MUL).toBe(3) // +200%
    expect(ironmanRareWeightMul(s)).toBe(IRONMAN_RARE_WEIGHT_MUL)
    expect(IRONMAN_RARE_WEIGHT_MUL).toBe(2) // +100%
    expect(ironmanExoticWeightMul(s)).toBe(IRONMAN_EXOTIC_WEIGHT_MUL)
    expect(IRONMAN_EXOTIC_WEIGHT_MUL).toBe(2) // +100%
    expect(ironmanRewardMul(s)).toBe(IRONMAN_REWARD_MUL)
    expect(IRONMAN_REWARD_MUL).toBeCloseTo(1.1, 10)
    expect(ironmanRareDropMul(s)).toBe(IRONMAN_RARE_DROP_MUL)
    expect(IRONMAN_RARE_DROP_MUL).toBeCloseTo(1.2, 10)
    expect(ironmanTrainingMul(s)).toBe(IRONMAN_TRAINING_MUL)
    expect(IRONMAN_TRAINING_MUL).toBeCloseTo(0.9, 10)
  })

  it('组合入口：奖励/掉率 = 限时倍率 × 铁人（无墙钟 ⇒ 限时项为 1×）', () => {
    const normal = createInitialState({ nowWallMs: 0, seed: 4 })
    const s = ironState(1)
    expect(rewardMulOf(normal)).toBe(1)
    expect(rewardMulOf(s)).toBeCloseTo(1.1, 10)
    expect(rareDropRateMulOf(normal)).toBe(1)
    expect(rareDropRateMulOf(s)).toBeCloseTo(1.2, 10)
    // 技能训练：高效学习法 5 级 = ×0.8，铁人再 ×0.9
    normal.skills.trained['accelerated-learning'] = 5
    s.skills.trained['accelerated-learning'] = 5
    expect(trainingTimeFactor(normal)).toBeCloseTo(0.8, 10)
    expect(trainingTimeFactor(s)).toBeCloseTo(0.72, 10)
  })

  it('离线结算上限：普通 8 小时、铁人 16 小时（同一段 12 小时离线各结算多少）', () => {
    const gap = 12 * H
    const normal = createInitialState({ nowWallMs: 0, seed: 5 })
    simulateOffline(normal, 0, gap, ctx)
    expect(normal.gameMs, '普通档：只结算 8 小时').toBe(8 * H)
    const s = ironState(1)
    simulateOffline(s, 0, gap, ctx)
    expect(s.gameMs, '铁人档：结算满 12 小时（上限 16 小时）').toBe(12 * H)
  })
})

describe('铁人模式 · 奇货订单每窗最大数量 +2（船长 2026-09-23 追加）', () => {
  /** 造一个"奇货必中"的市场上下文：命中率拉满 ⇒ 本窗命中数只看上限 */
  function exoticCtx(goods: number) {
    const base = buildSimContext().balance
    const keys = Array.from({ length: goods }, (_, i) => `mod-ex${i}`)
    return makeTestCtx({
      marketGoods: keys.map((k) => ({
        key: k,
        kind: 'module' as const,
        refId: k,
        rarity: 'exotic' as const,
        basePrice: 10_000,
        demandMultiplier: 1,
      })),
      modules: keys.map((k) => moduleDef(k, 'turret', 0)),
      balance: { ...base, market: { ...base.market, exoticWindowChance: 1 } },
    })
  }

  it('普通档：每窗 4 张（⟪2026-09-25 船长令⟫「奇货订单每窗上限再+2」⇒ 2 → 4）', () => {
    const ctx = exoticCtx(8) // 商品数 > 上限 ⇒ 本窗命中数只看上限
    const s = createInitialState({ nowWallMs: 0, seed: 11 })
    ensureMarket(s, ctx)
    slowSupplyDraw(s, ctx, 600_000)
    const n = Object.values(s.market.npcSell).reduce((sum, list) => sum + list.length, 0)
    expect(n).toBe(4)
  })

  it('铁人档：每窗上限 4 → 6（+2）', () => {
    const ctx = exoticCtx(8)
    const s = ironState(1)
    ensureMarket(s, ctx)
    slowSupplyDraw(s, ctx, 600_000)
    const n = Object.values(s.market.npcSell).reduce((sum, list) => sum + list.length, 0)
    expect(n).toBe(6)
    expect(ironmanExoticCapBonus(s)).toBe(IRONMAN_EXOTIC_CAP_BONUS)
    expect(IRONMAN_EXOTIC_CAP_BONUS).toBe(2)
    // 关闭铁人 ⇒ 回到 4
    closeIronman(s, 1_000)
    expect(ironmanExoticCapBonus(s)).toBe(0)
  })
})

describe('铁人模式 · 存档往返（新字段必须随档）', () => {
  it('ironman 的 on/seq/两个墙钟都随档往返', () => {
    const s = ironState(4_321, 12_345)
    const back = loadSaveFile(serializeSaveFile(s, 0)).state
    expect(back.ironman).toEqual({ on: true, seq: 4_321, sinceWallMs: 12_345 })
    // 关闭后：closedWallMs 也要留下
    closeIronman(s, 77_777)
    const back2 = loadSaveFile(serializeSaveFile(s, 0)).state
    expect(back2.ironman).toEqual({ on: false, seq: 4_321, sinceWallMs: 12_345, closedWallMs: 77_777 })
  })

  it('老档（没有 ironman 键）⇒ 读作普通档、代次 0，且新档快照逐字带上这个键', () => {
    const fresh = createInitialState({ nowWallMs: 0, seed: 6 })
    const text = serializeSaveFile(fresh, 0)
    expect(text.includes('"ironman"'), '新档快照带 ironman 键').toBe(true)
    const raw = JSON.parse(text) as { state: Record<string, unknown> }
    delete raw.state.ironman
    const back = loadSaveFile(JSON.stringify(raw)).state
    expect(ironmanOf(back)).toEqual({ on: false, seq: 0 })
  })
})

describe('铁人模式 · 两枚隐藏徽章（船长 2026-09-23）', () => {
  it('登记：两枚都在徽章表里、都带 hidden、判定来源是两个新模式；进入铁人即得"铁人"', () => {
    const iron = achievementOf('ach-ironman')
    const closed = achievementOf('ach-ironman-closed')
    expect(iron?.hidden, '「铁人」是隐藏徽章').toBe(true)
    expect(closed?.hidden, '「关闭铁人」是隐藏徽章').toBe(true)
    expect(iron?.category).toBe('ironman')
    expect(closed?.category).toBe('ironman')
    // 普通档：两枚都未达成（⇒ 界面按 hidden 过滤后看不见）
    const normal = createInitialState({ nowWallMs: 0, seed: 21 })
    expect(achievementReached(normal, iron!.source)).toBe(false)
    expect(achievementReached(normal, closed!.source)).toBe(false)
    // 进入铁人：铁人这枚现算即得；关闭那枚仍未达成
    enterIronman(normal, 1_000)
    expect(achievementReached(normal, iron!.source)).toBe(true)
    expect(achievementReached(normal, closed!.source)).toBe(false)
    // 关闭后：两枚都达成（代次冻结、关闭那一刻才出现）
    closeIronman(normal, 2_000)
    expect(achievementReached(normal, iron!.source), '曾经是铁人 ⇒ 这枚保留').toBe(true)
    expect(achievementReached(normal, closed!.source)).toBe(true)
  })
})

/**
 * **模式选择已完成**（**2026-09-24 船长令**：「对至今未选择的旧档进行模式选择弹窗」）。
 *
 * 这是"模式选择框还要不要弹"的**唯一判据**，钉三件事：
 * ① 新档/老档（没有 `modeChosen`、也没开过铁人）⇒ **没选过** ⇒ 要弹；
 * ② 选了普通（`markModeChosenAsStandard`）⇒ 选过了 ⇒ 不再弹；
 * ③ 开过铁人（含已关闭）⇒ 选过了 ⇒ 不再弹（`sinceWallMs` 本身就是记录，不必写 `modeChosen`）；
 * ④ **随档往返不许丢** —— 漏了 `save.ts` 白名单那一行 ⇒ 每次读档都重弹（本仓栽过的同一类事故）。
 */
describe('铁人模式 · 模式选择已完成（船长 2026-09-24）', () => {
  it('判据：没选过 ⇒ 要弹；选了普通 / 开过铁人 ⇒ 不再弹', () => {
    // ① 新档（也是老档的形态：两个字段都没有）
    const fresh = createInitialState({ nowWallMs: 0, seed: 5 })
    expect(fresh.modeChosen, '新档不写这个键').toBeUndefined()
    expect(ironmanModeChosen(fresh), '没选过 ⇒ 要弹').toBe(false)

    // ② 选普通
    markModeChosenAsStandard(fresh)
    expect(fresh.modeChosen).toBe(true)
    expect(ironmanModeChosen(fresh), '选过普通 ⇒ 不再弹').toBe(true)

    // ③ 开过铁人（不写 modeChosen 也算选过）
    const iron = createInitialState({ nowWallMs: 0, seed: 6 })
    enterIronman(iron, 1_000)
    expect(iron.modeChosen, '选铁人不写 modeChosen（sinceWallMs 已是记录）').toBeUndefined()
    expect(ironmanModeChosen(iron), '开着铁人 ⇒ 不再弹').toBe(true)

    // ④ 关闭之后仍然算选过（单向门：更不能再弹一次让它重开）
    closeIronman(iron, 2_000)
    expect(ironmanModeChosen(iron), '关闭过铁人 ⇒ 不再弹').toBe(true)

    // ⑤ 老档形态：把字段摘掉 ⇒ 回到"没选过"
    const old = createInitialState({ nowWallMs: 0, seed: 8 })
    delete old.modeChosen
    delete old.ironman
    expect(ironmanModeChosen(old), '老档（两字段皆无）⇒ 要弹').toBe(false)
  })

  it('随档往返：`modeChosen` 读档后还在（漏白名单 ⇒ 每次读档都重弹）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 9 })
    markModeChosenAsStandard(s)
    const text = serializeSaveFile(s, 1_000)
    expect(text.includes('"modeChosen"'), '选过普通 ⇒ 快照带这个键').toBe(true)
    const back = loadSaveFile(text).state
    expect(back.modeChosen, '读档后不许丢（丢了就会重弹模式选择框）').toBe(true)
    expect(ironmanModeChosen(back)).toBe(true)

    // 没选过的档：快照**不带**这个键（零迁移 —— 老档快照往返逐字不变）
    const blank = createInitialState({ nowWallMs: 0, seed: 10 })
    const blankText = serializeSaveFile(blank, 1_000)
    expect(blankText.includes('"modeChosen"'), '没选过就不落键').toBe(false)
    expect(loadSaveFile(blankText).state.modeChosen).toBeUndefined()
  })
})