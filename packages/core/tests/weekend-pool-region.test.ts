/**
 * **入侵敌卡的区域池边界**：外围只出 {骚扰, 袭击} · 核心才出 {袭击, 主力} —— 玩家报障的回归锁。
 *
 * 船长转述：「**玩家反应，他在外围遇见联动H族主力舰队卡**」＋ 船长判断：「**我怀疑和之前的错位有关**」。
 *
 * 真档读数（`npm run weekend:board` ⑤ 段）：
 * - 核心 深渊之门 区域池 = {袭击 `ink-raid`, **主力 `ink-main`**}，前 6 场重抽里 **4 场是主力**；
 * - 外围（红环／坟场／虚海）区域池 = {骚扰 `ink-harass`, 袭击 `ink-raid`}，**不含主力**。
 *
 * ⇒ 站在外围却打到主力舰队，只可能是**这一场被归到了核心**（旧口径按卡 id 反查星系的"错位"，
 * 已在 `75c93421` 修掉）。本用例把**池边界**本身钉死：即使将来有人把 `isCore` 传错，
 * 这三个抽签口（驻留 / 主动出击重抽 / 遇袭重抽）也要在这里立刻炸出来。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import {
  weekendAmbushPickOf,
  weekendFoePoolOf,
  weekendGarrisonFoeCardId,
  weekendDrawFoeCardId,
} from '../src/weekendEvent'
import { weekendAssaultDrawOf } from '../src/weekendBounty'
import { weekendAssaultSpecOf, weekendAmbushSpecOf } from '../src/weekendBattle'
import type { WeekendEventState } from '../src/weekendEvent'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const T = 1_000_000
const CORE = 'galaxy-abyss'
/** 真档那一幕的三个外围 */
const PERIPHERY = ['galaxy-redring', 'galaxy-grave', 'galaxy-voidedge']
const MAIN = 'ink-main'

function world(): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 11 })
  s.debugQuick = false
  const ev: WeekendEventState = {
    seq: 3,
    startedAtWallMs: 0,
    coreId: CORE,
    peripheryIds: [...PERIPHERY],
    family: 'H',
    contributed: {},
  }
  s.weekendEvent = ev
  return s
}

describe('入侵敌卡区域池：外围不出主力舰队', () => {
  it('池定义本身：外围 {骚扰, 袭击} · 核心 {袭击, 主力}', () => {
    expect(weekendFoePoolOf('H', false)).toEqual(['ink-harass', 'ink-raid'])
    expect(weekendFoePoolOf('H', true)).toEqual(['ink-raid', MAIN])
    console.log(
      `  [读数] 外围池 = ${weekendFoePoolOf('H', false).join(' / ')} · 核心池 = ${weekendFoePoolOf('H', true).join(' / ')}`,
    )
  })

  it('抽签口 × 全域扫描：外围（isCore=false）任何 seq/位序/盐 都抽不到主力', () => {
    let coreMainHits = 0
    for (let seq = 0; seq < 24; seq += 1) {
      for (let idx = 0; idx < 5; idx += 1) {
        for (let salt = 0; salt < 24; salt += 1) {
          const per = weekendDrawFoeCardId('H', false, seq, idx, salt)
          expect(per === MAIN, `外围抽到主力舰队（seq=${seq} idx=${idx} salt=${salt}）`).toBe(false)
          if (weekendDrawFoeCardId('H', true, seq, idx, salt) === MAIN) coreMainHits += 1
        }
      }
    }
    // 反向证明断言不是空转：核心池确实会抽到主力
    expect(coreMainHits, '核心池一次都没抽到主力 ⇒ 本用例的池读错了').toBeGreaterThan(0)
    console.log(`  [读数] 2880 组抽签：外围抽到主力 0 次 · 核心抽到主力 ${coreMainHits} 次`)
  })

  it('三个实际抽签口都按"该星系所在区域"取池（驻留 / 主动出击 / 遇袭 ＋ spec）', () => {
    const s = world()
    const ev = s.weekendEvent!
    for (const gid of PERIPHERY) {
      expect(weekendGarrisonFoeCardId(s, ev, gid), `${gid} 驻留卡`).not.toBe(MAIN)
      expect(weekendAssaultDrawOf(s, ctx, gid, T)!.cardId, `${gid} 主动出击重抽`).not.toBe(MAIN)
      expect(weekendAssaultSpecOf(s, ctx, gid)!.cardId, `${gid} 出击 spec`).not.toBe(MAIN)
      // 遇袭：扫时间档（盐随时刻档变化）
      const seen = new Set<string>()
      for (let tier = 0; tier < 12; tier += 1) {
        const pick = weekendAmbushPickOf(s, ctx, gid, T + tier * 60_000)
        if (pick) seen.add(pick.cardId)
        expect(weekendAmbushSpecOf(s, ctx, gid, T + tier * 60_000)?.cardId ?? '', `${gid} 遇袭`).not.toBe(MAIN)
      }
      console.log(`  [读数] ${gid}：驻留 ${weekendGarrisonFoeCardId(s, ev, gid)} · 遇袭 12 档抽到 ${[...seen].join('/')}`)
    }
    // 核心：驻留或重抽里应能出现主力（否则"外围不出主力"这条测试没有对照）
    const coreSeen = new Set<string>()
    for (let d = 0; d < 12; d += 1) {
      s.weekendEvent!.assaultDraws = d
      coreSeen.add(weekendAssaultDrawOf(s, ctx, CORE, T)!.cardId)
    }
    expect([...coreSeen], '核心 12 场重抽里没出现主力 ⇒ 对照不成立').toContain(MAIN)
    console.log(`  [读数] ${CORE}（核心）12 场重抽 = ${[...coreSeen].join('/')}`)
  })
})
