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
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { simulateOffline } from '../src/simulation'
import { trainingTimeFactor } from '../src/training'
import { rareDropRateMulOf, rewardMulOf } from '../src/tuning'
import {
  IRONMAN_COMMON_FLOW_MUL,
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
