/**
 * **成就徽章**（2026-09-20 船长批「继续之前的成就系统」；**两批都已完成**）。
 *
 * 这一组钉几件事（都是"悄悄坏掉也看不出来"的那种）：
 * ① **表的口径**：81 枚（13 任务 ＋ 50 链 ＋ **18 里程碑**）· 档位与船长裁定一致
 *    （一般链 1/4/7/10、探索家 1/5）· id 唯一 · 卡名口径；
 * ② **发放去重**：只置一次 ⇒ 重复判定 / 读档往返都不会重复发、也不会篡改已达成的时刻；
 * ③ **纯展示**（船长裁定）：发徽章**不动钱包/仓库/货舱**一分一毫；
 * ④ **老档自愈**：老档的账本可以是空的，载入后第一拍按现状把够格的补上（迁移不补发，见 `save.ts` MIGRATIONS[29]）；
 * ⑤ **里程碑判据**（第二批）：18 条的阈值与计数键 · **峰值型不回退** · 老档（新键缺省）自愈。
 *
 * 本文件属**已完成的两批**，不挂 `⟪未完成⟫` 记号——约定 §十一之二：完成即删记号。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { ACHIEVEMENTS } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import {
  achievementCount,
  achievementOverview,
  achievementReached,
  advanceAchievements,
} from '../src/achievements'
import { CHAIN_TIERS, FIRST_TASKS, bumpFirst, peakFirst, firstStatOf, advanceFirstChains, advanceFirstTasks } from '../src/firstTasks'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { advanceGame } from '../src/engine'
import { assignAiMining, assignAiSalvage, gainAiCore } from '../src/ai'
import { wormholeEnter } from '../src/wormhole'
import { makeTestCtx, fittedOf, skipFirstSkillReward } from './helpers'
import type { ModuleDef, SimContext } from '../src/types'
import { chainProgress } from '../src/achievements'

const ctx = buildSimContext()

function testState(): GameState {
  return createInitialState({ nowWallMs: 0, seed: 7 })
}

/** 把某条链的进度直接写到账本上（模拟"玩家已经刷到这个级数"） */
function setChainProgress(state: GameState, chainId: string, level: number): void {
  state.importantTasks[`chain-${chainId}`] = { done: false, delivered: level }
}

/**
 * 把「第一次」队列推到某条任务前面（2026-09-20：`advanceFirstTasks` 改成**只判当前那一条**，
 * 未显示的任务不再提前判过）⇒ 要验"某条的徽章"，先得让队列走到它。
 */
function reachQueue(state: GameState, taskId: string): void {
  const idx = FIRST_TASKS.findIndex((t) => t.id === taskId)
  expect(idx, `未知任务 id：${taskId}`).toBeGreaterThanOrEqual(0)
  for (const t of FIRST_TASKS.slice(0, idx)) state.importantTasks[t.id] = { done: true }
}

const TASK_BADGES = ACHIEVEMENTS.filter((a) => a.source.kind === 'task')
const CHAIN_BADGES = ACHIEVEMENTS.filter((a) => a.source.kind === 'chain')
const MILE_BADGES = ACHIEVEMENTS.filter((a) => a.source.kind === 'milestone')

describe('成就徽章：表的口径（船长 2026-09-20 的两条裁定）', () => {
  it('总数 = 13 任务 ＋ 50 链 ＋ 18 里程碑 = 81', () => {
    // 13 条任务各 1 枚
    expect(TASK_BADGES.length).toBe(FIRST_TASKS.length)
    expect(FIRST_TASKS.length).toBe(13)
    // 12 条一般链 × 4 档 ＋ 探索家 2 档 = 50
    expect(CHAIN_BADGES.length).toBe(50)
    // 第二批：六个家族 4+2+5+4+2+1 = 18
    expect(MILE_BADGES.length).toBe(18)
    expect(ACHIEVEMENTS.length).toBe(81)
  })

  it('id 唯一（重复 id 会让账本互相覆盖）', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('一般链 = 1/4/7/10 级各一枚；宇宙探索家 = 只 1 级与 5 级（它上限就是 5 级）', () => {
    const byChain = new Map<string, number[]>()
    for (const a of CHAIN_BADGES) {
      if (a.source.kind !== 'chain') continue
      byChain.set(a.source.chainId, [...(byChain.get(a.source.chainId) ?? []), a.source.level])
    }
    expect(byChain.size).toBe(13)
    for (const [chainId, levels] of byChain) {
      const sorted = [...levels].sort((x, y) => x - y)
      if (chainId === 'explorer') {
        expect(sorted, '宇宙探索家应只有 1/5 级').toEqual([1, 5])
        continue
      }
      expect(sorted, `${chainId} 应为 1/4/7/10`).toEqual([1, 4, 7, 10])
    }
  })

  it('每条链的档位都不超过它的阈值表上限（防"给了够不到的档位"）', () => {
    for (const def of CHAIN_BADGES) {
      const src = def.source
      if (src.kind !== 'chain') continue
      const task = FIRST_TASKS.find((t) => t.chain?.id === src.chainId)
      const tierKey = task?.chain?.tierKey ?? ''
      const top = (CHAIN_TIERS[tierKey] ?? []).length
      expect(src.level, `${def.id} 超过上限 ${top}`).toBeLessThanOrEqual(top)
    }
  })

  it('同一条链的 4 枚共用一个图案、靠颜色区分（船长「图案相同，用颜色区分」）', () => {
    const byChain = new Map<string, Array<{ pattern: string; tone: string }>>()
    for (const a of CHAIN_BADGES) {
      if (a.source.kind !== 'chain') continue
      byChain.set(a.source.chainId, [...(byChain.get(a.source.chainId) ?? []), { pattern: a.pattern, tone: a.tone }])
    }
    for (const [chainId, items] of byChain) {
      const patterns = new Set(items.map((i) => i.pattern))
      expect(patterns.size, `${chainId} 的图案应只有 1 种`).toBe(1)
      const tones = new Set(items.map((i) => i.tone))
      expect(tones.size, `${chainId} 的颜色应逐档不同`).toBe(items.length)
    }
  })
})

describe('成就徽章：达成判定', () => {
  it('任务未完成 ⇒ 未达成；完成后 ⇒ 达成', () => {
    const state = testState()
    const badge = TASK_BADGES.find((a) => a.source.kind === 'task' && a.source.taskId === 'first-mine')!
    expect(achievementReached(state, badge.source)).toBe(false)
    state.importantTasks['first-mine'] = { done: true }
    expect(achievementReached(state, badge.source)).toBe(true)
  })

  it('链进度按 `chain-<id>.delivered` 判：到了 4 级 ⇒ 1 级与 4 级都算达成，7 级不算', () => {
    const state = testState()
    setChainProgress(state, 'digger', 4)
    const of = (lv: number): boolean => {
      const b = CHAIN_BADGES.find(
        (a) => a.source.kind === 'chain' && a.source.chainId === 'digger' && a.source.level === lv,
      )!
      return achievementReached(state, b.source)
    }
    expect(of(1)).toBe(true)
    expect(of(4)).toBe(true)
    expect(of(7)).toBe(false)
    expect(of(10)).toBe(false)
  })
})

describe('成就徽章：发放与去重（纯展示 · 只置一次）', () => {
  it('达成即发：任务 done 后一判就到手，且返回"本次新到手"的列表', () => {
    const state = testState()
    state.importantTasks['first-mine'] = { done: true }
    const newly = advanceAchievements(state, ACHIEVEMENTS)
    expect(newly.map((a) => a.id)).toContain('ach-first-mine')
    expect(achievementCount(state)).toBe(1)
    // 再判一次不重复发
    expect(advanceAchievements(state, ACHIEVEMENTS)).toEqual([])
    expect(achievementCount(state)).toBe(1)
  })

  it('链升到 4 级 ⇒ 1 级与 4 级两枚一起补上（跨档不遗漏）', () => {
    const state = testState()
    setChainProgress(state, 'hunter', 4)
    const newly = advanceAchievements(state, ACHIEVEMENTS)
    expect(newly.map((a) => a.id).sort()).toEqual(['ach-chain-hunter-1', 'ach-chain-hunter-4'])
  })

  it('到手时刻只记一次，后续判定不覆盖', () => {
    const state = testState()
    state.importantTasks['first-mine'] = { done: true }
    state.gameMs = 1000
    advanceAchievements(state, ACHIEVEMENTS)
    const at = state.achievements!.earned['ach-first-mine']
    expect(at).toEqual({ atGameMs: 1000, atWallMs: 0 })
    state.gameMs = 9999
    advanceAchievements(state, ACHIEVEMENTS)
    expect(state.achievements!.earned['ach-first-mine']).toEqual(at)
  })

  /**
   * **完成时间要记下来**（船长 2026-09-20：「成就系统还要记录成就完成时间。」）：
   * 游戏内时间与真实时间各记一份；未传墙钟时**记 0 = 未记录**（不编假时间）。
   */
  it('记完成时间：游戏内时间与真实时间各一份', () => {
    const state = testState()
    state.importantTasks['first-mine'] = { done: true }
    state.gameMs = 3_600_000
    advanceAchievements(state, ACHIEVEMENTS, 1_700_000_000_000)
    expect(state.achievements!.earned['ach-first-mine']).toEqual({
      atGameMs: 3_600_000,
      atWallMs: 1_700_000_000_000,
    })
  })

  it('未传墙钟 ⇒ 真实时间记 0（不编假时间），游戏内时间照记', () => {
    const state = testState()
    state.importantTasks['first-mine'] = { done: true }
    state.gameMs = 500
    advanceAchievements(state, ACHIEVEMENTS)
    expect(state.achievements!.earned['ach-first-mine']).toEqual({ atGameMs: 500, atWallMs: 0 })
  })

  it('时间读数：未到手为 null，老档补发（两时刻皆 0）标 legacy', () => {
    const state = testState()
    state.importantTasks['first-mine'] = { done: true }
    state.gameMs = 42
    advanceAchievements(state, ACHIEVEMENTS, 1_700_000_000_000)
    // 手工塞一条"老档补发"记录（两时刻皆 0）
    state.achievements!.earned['ach-first-scan'] = { atGameMs: 0, atWallMs: 0 }
    const rows = achievementOverview(state, ACHIEVEMENTS)
    const mine = rows.find((r) => r.def.id === 'ach-first-mine')!
    expect(mine.earnedAt).toBe(42)
    expect(mine.earnedWallMs).toBe(1_700_000_000_000)
    expect(mine.legacy).toBe(false)
    const legacyRow = rows.find((r) => r.def.id === 'ach-first-scan')!
    expect(legacyRow.legacy).toBe(true)
    const notYet = rows.find((r) => r.def.id === 'ach-chain-abyss-10')!
    expect(notYet.earnedAt).toBe(null)
    expect(notYet.legacy).toBe(false)
  })

  it('**纯展示**：发徽章不动钱包 / 仓库 / 货舱（船长 2026-09-20 裁定）', () => {
    const state = testState()
    const before = {
      isk: state.wallet.isk,
      ware: JSON.stringify(state.warehouse.items),
      modules: JSON.stringify(state.moduleBay ?? {}),
      fleet: JSON.stringify(Object.keys(state.fleet)),
    }
    // 一次性把所有够格的都放开：任务全 done ＋ 所有链满级
    for (const t of FIRST_TASKS) state.importantTasks[t.id] = { done: true }
    for (const t of FIRST_TASKS) {
      if (t.chain) setChainProgress(state, t.chain.id, 99)
    }
    const newly = advanceAchievements(state, ACHIEVEMENTS)
    expect(newly.length).toBeGreaterThan(0)
    expect(state.wallet.isk).toBe(before.isk)
    expect(JSON.stringify(state.warehouse.items)).toBe(before.ware)
    expect(JSON.stringify(state.moduleBay ?? {})).toBe(before.modules)
    expect(JSON.stringify(Object.keys(state.fleet))).toBe(before.fleet)
  })

  it('不发日志（保持"离线事件条数"等既有口径逐字不变）', () => {
    const state = testState()
    const before = state.logs.length
    state.importantTasks['first-mine'] = { done: true }
    advanceAchievements(state, ACHIEVEMENTS)
    expect(state.logs.length).toBe(before)
  })
})

describe('成就徽章：老档自愈（迁移不补发，载入后第一拍补上）', () => {
  it('老档账本为空但任务已完成 ⇒ 第一拍补发', () => {
    const state = testState()
    state.importantTasks['first-mine'] = { done: true }
    setChainProgress(state, 'digger', 7)
    state.achievements = { earned: {} } // 模拟"迁移只补了空账本"
    const newly = advanceAchievements(state, ACHIEVEMENTS)
    const ids = newly.map((a) => a.id)
    expect(ids).toContain('ach-first-mine')
    expect(ids).toContain('ach-chain-digger-1')
    expect(ids).toContain('ach-chain-digger-4')
    expect(ids).toContain('ach-chain-digger-7')
    expect(ids).not.toContain('ach-chain-digger-10')
  })

  it('读档往返：账本落盘后原样恢复（含两个时间），不重复发', () => {
    const state = testState()
    state.importantTasks['first-mine'] = { done: true }
    state.gameMs = 5000
    advanceAchievements(state, ACHIEVEMENTS, 1_700_000_000_000)
    const json = serializeSaveFile(state, 0)
    const { state: back } = loadSaveFile(json)
    expect(back.achievements?.earned['ach-first-mine']).toEqual({
      atGameMs: 5000,
      atWallMs: 1_700_000_000_000,
    })
    expect(advanceAchievements(back, ACHIEVEMENTS)).toEqual([])
  })

  it('读档兼容首版账本（裸数字 = 只记了游戏内时间，墙钟补 0）', () => {
    const state = testState()
    state.importantTasks['first-mine'] = { done: true }
    state.gameMs = 5000
    advanceAchievements(state, ACHIEVEMENTS)
    // 手工降级成首版形状（v30 首版落盘的是 number）
    const raw = JSON.parse(serializeSaveFile(state, 0)) as { state: { achievements: { earned: Record<string, unknown> } } }
    raw.state.achievements.earned['ach-first-mine'] = 5000
    const { state: back } = loadSaveFile(JSON.stringify(raw))
    expect(back.achievements?.earned['ach-first-mine']).toEqual({ atGameMs: 5000, atWallMs: 0 })
  })
})

describe('成就徽章：界面读数', () => {
  it('总览按表顺序给全 81 枚，含达成状态与到手时刻', () => {
    const state = testState()
    state.gameMs = 42
    state.importantTasks['first-mine'] = { done: true }
    advanceAchievements(state, ACHIEVEMENTS)
    const rows = achievementOverview(state, ACHIEVEMENTS)
    expect(rows.length).toBe(81)
    const mine = rows.find((r) => r.def.id === 'ach-first-mine')!
    expect(mine.earnedAt).toBe(42)
    expect(mine.reached).toBe(true)
    const other = rows.find((r) => r.def.id === 'ach-first-scan')!
    expect(other.earnedAt).toBe(null)
  })

  it('卡名口径：链徽章 = 档位词 ＋ 行当，且**不带「· N 级」**（船长 2026-09-20 改版）', () => {
    /**
     * 档位词**按链分表**（与 `data/src/achievements.ts` 同口径）。
     * ⚠ 不能用统一门槛推导：一般链顶档是 10 级、探索家只有 5 级，
     * 5 与 10 是各自链的顶档 ⇒ 一律取「传奇」。第一版这里就写错过
     * （把 5 映射成 4 档，得到「资深探索家」），被本条用例当场抓出。
     */
    const WORD_STANDARD: Record<number, string> = { 1: '见习', 4: '资深', 7: '王牌', 10: '传奇' }
    const WORD_EXPLORER: Record<number, string> = { 1: '见习', 5: '传奇' }
    /** 船长点名的两枚：探索家那条只 1/5 级 ⇒ 落到**首尾**两档 */
    const of = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)!
    expect(of('ach-chain-explorer-1').name).toBe('见习探索家')
    expect(of('ach-chain-explorer-5').name).toBe('传奇探索家')
    // 13 条链 × 各自档位：名字必须是「档位词 + 行当」且**不含级别数字**
    for (const task of FIRST_TASKS) {
      const chain = task.chain
      if (!chain) continue
      const words = chain.id === 'explorer' ? WORD_EXPLORER : WORD_STANDARD
      for (const a of ACHIEVEMENTS) {
        if (a.source.kind !== 'chain' || a.source.chainId !== chain.id) continue
        const word = words[a.source.level]!
        expect(word, `${a.id} 的档位 ${a.source.level} 没配档位词`).toBeTruthy()
        expect(a.name.startsWith(word), `${a.id} 应以档位词「${word}」开头，实际「${a.name}」`).toBe(true)
        // 旧写法是「链名 · N 级」⇒ 卡名不许再出现中点与"级"字
        expect(a.name.includes('·'), `${a.id} 卡名不该带「·」：${a.name}`).toBe(false)
        expect(a.name.includes('级'), `${a.id} 卡名不该带「级」：${a.name}`).toBe(false)
      }
    }
    // 50 个链徽章名两两不重名（重名就没法在卡面上区分）
    const chainNames = ACHIEVEMENTS.filter((a) => a.source.kind === 'chain').map((a) => a.name)
    expect(chainNames.length).toBe(50)
    expect(new Set(chainNames).size).toBe(50)
    // 任务徽章仍与任务标题同名（船长裁定：不改）
    const first = ACHIEVEMENTS.find((a) => a.source.kind === 'task' && a.source.taskId === 'first-mine')!
    expect(first.name).toBe(FIRST_TASKS.find((t) => t.id === 'first-mine')!.title)
  })

  it('卡名不回退成旧写法：说明里仍讲得清"哪条链的哪一档"', () => {
    const abyss10 = ACHIEVEMENTS.find((a) => a.id === 'ach-chain-abyss-10')!
    expect(abyss10.name).toBe('传奇深渊行者')
    // 说明要保留链名与级别（卡名去掉了数字，信息不能就此丢失）
    expect(abyss10.note).toContain('深渊探索者')
    expect(abyss10.note).toContain('10 级')
  })
})

describe('终身计数：AI 副船的产量也计入（船长 2026-09-20 令）', () => {
  /**
   * 船长原话：「**成就系统和重要任务的累计，也计入AI副船的产量**」。
   *
   * 口径：`firstStats` 是**一把尺**——「第一次」任务与次数链都读它 ⇒ 补上 AI 侧之后，
   * 成就 / 任务 / 链三层一起生效。这同时**修掉一处不一致**：精炼 / 制造 / 造船 / 维修
   * 那四项**早就含 AI**（结算函数主控与 AI 共用），只有采掘与打捞漏了。
   */
  function aiReadyState(): { state: GameState; ctx: SimContext } {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.skills.trained['ai-expert'] = 1
    skipFirstSkillReward(state) // 只考计数，不考「第一次」奖励
    state.fleet['sandcat2'] = {
      durability: 1,
      cargo: {},
      fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }),
    }
    gainAiCore(state, 'basic', 2)
    // 关富矿脉 ⇒ 数量确定（否则 ×3 会让断言变成概率题）
    const bal = makeTestCtx().balance
    return { state, ctx: makeTestCtx({ balance: { ...bal, richVeinChance: 0 } }) }
  }

  it('AI 采矿：每个循环的原矿都进 `mineUnits`（原先只累计"本趟"给日志用）', () => {
    const { state, ctx } = aiReadyState()
    expect(firstStatOf(state, 'mineUnits')).toBe(0)
    expect(assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx).ok).toBe(true)
    // sandcat2 每循环 6 秒 ⇒ 跑 30 秒 = 至少 5 个循环
    advanceGame(state, 30_000, ctx)
    const units = firstStatOf(state, 'mineUnits')
    expect(units).toBeGreaterThan(0)
    // 与主控同口径 = **入舱的实际单位数**（本趟累计应与终身计数同步增长）
    const task = state.aiAssignments['sandcat2']!.task as { tripUnits: number }
    expect(task.tripUnits).toBeGreaterThan(0)
    expect(units).toBeGreaterThanOrEqual(task.tripUnits)
  })

  it('AI 采矿的产量能点亮「第一次采集原矿」与采掘链（三层同源）', () => {
    const { state, ctx } = aiReadyState()
    expect(assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx).ok).toBe(true)
    /**
     * ⚠ 别硬编码速率：AI 采矿要**乘核心效率**（`aiEfficiency`，基础核心约 0.4），
     * 而且**满舱会返航卸货再出航**（产量不是线性——我先试过"实测速率再外推"，
     * 在返航段直接失效，800/1000 卡住）。
     * 正确做法 = **分片推进、每片看一次账**，直到越过阈值（这也正是真实运行的样子）。
     */
    const need = CHAIN_TIERS.mineUnits![0]!
    let guard = 0
    while (firstStatOf(state, 'mineUnits') < need && guard++ < 120) {
      advanceGame(state, 60_000, ctx)
      // 任务被中止（例如敌袭善后）就没有继续推进的意义了
      if (!state.aiAssignments['sandcat2']) break
    }
    expect(firstStatOf(state, 'mineUnits')).toBeGreaterThanOrEqual(need)
    advanceFirstTasks(state, ctx)
    expect(state.importantTasks['first-mine']?.done).toBe(true)
    advanceFirstChains(state)
    expect(chainProgress(state, 'digger')).toBeGreaterThanOrEqual(1)
    // 徽章也在同一拍到手（任务徽章 ＋ 采掘链 L1）
    const ids = advanceAchievements(state, ACHIEVEMENTS).map((a) => a.id)
    expect(ids).toContain('ach-first-mine')
    expect(ids).toContain('ach-chain-digger-1')
  })

  it('AI 打捞：每捞上一批进一次 `salvageRuns`（原先只在主控循环里记）', () => {
    /**
     * ⚠ 环境要点：AI 打捞**必须先有打捞器**才能进 `salvaging` 相
     * （`assignAiSalvage` 会拒"没有打捞器的船"）⇒ 这里给测试 ctx 注入一枚合成打捞器
     * （槽位 `salvager`、周期 10 秒——真实数据里 MK1 就是这个值）。
     */
    const salvager: ModuleDef = {
      id: 'test-salvager',
      name: '测试打捞器',
      slot: 'salvager',
      rack: 'high',
      cpu: 1,
      cycleMs: 10_000,
    } as unknown as ModuleDef
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.skills.trained['ai-expert'] = 1
    skipFirstSkillReward(state)
    state.fleet['sandcat2'] = {
      durability: 1,
      cargo: {},
      fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }),
    }
    state.fleet['sandcat2']!.fitted.high[0] = 'test-salvager'
    gainAiCore(state, 'basic', 1)
    const ctx = makeTestCtx({ modules: [salvager] })
    expect(firstStatOf(state, 'salvageRuns')).toBe(0)
    const assigned = assignAiSalvage(state, 'sandcat2', 'basic', 'galaxy-hub', ctx)
    expect(assigned.ok, assigned.error ?? '').toBe(true)
    // 出航腿 + 若干个打捞周期（本地星系腿短；跑够时间让至少一轮落袋）
    advanceGame(state, 600_000, ctx)
    expect(firstStatOf(state, 'salvageRuns')).toBeGreaterThan(0)
  })
})

describe('成就徽章：与引擎挂点同拍（任务达成即到手）', () => {
  it('任务判定与链记账做完之后才判徽章 ⇒ 同一拍能看到两边的结果', () => {
    const state = testState()
    // 攒够"维修 1 次"（first-repair 的判据）——直接走计数 + 任务判定 + 链记账，再判徽章
    reachQueue(state, 'first-repair') // 顺序解锁：队列得先走到它（否则判定不认未显示的条目）
    bumpFirst(state, 'repairs', 1)
    advanceFirstTasks(state, ctx)
    advanceFirstChains(state)
    const newly = advanceAchievements(state, ACHIEVEMENTS)
    const ids = newly.map((a) => a.id)
    expect(ids).toContain('ach-first-repair')
    // 维修链 mechanic 的 L1 阈值是 1 ⇒ 同拍也该拿到链徽章
    expect(ids).toContain('ach-chain-mechanic-1')
  })
})

describe('成就徽章：里程碑（第二批 · 判据只读终身计数）', () => {
  /** 六个家族的阈值表（与 `data/src/achievements.ts` 的 specs 逐对；改动必须两边一起改） */
  const EXPECT: Record<string, Array<[string, string, number]>> = {
    whMaxDepth: [
      ['ach-mile-wh-depth-2', '初入深渊', 2],
      ['ach-mile-wh-depth-3', '深渊宿将', 3],
      ['ach-mile-wh-depth-4', '深渊之主', 4],
      ['ach-mile-wh-depth-5', '深渊彼岸', 5],
    ],
    whBossClears: [
      ['ach-mile-wh-boss-2', '斩层者', 2],
      ['ach-mile-wh-boss-4', '守关终结者', 4],
    ],
    rareBoxes: [
      ['ach-mile-box-1', '初启箱庭', 1],
      ['ach-mile-box-5', '拾荒老手', 5],
      ['ach-mile-box-20', '拾荒名匠', 20],
      ['ach-mile-box-60', '拾荒巨匠', 60],
      ['ach-mile-box-150', '箱庭之主', 150],
    ],
    aiCoreKinds: [
      ['ach-mile-core-1', '初识核心', 1],
      ['ach-mile-core-2', '双子核', 2],
      ['ach-mile-core-3', '三核共鸣', 3],
      ['ach-mile-core-4', '四核同心', 4],
    ],
    sitesBuilt: [
      ['ach-mile-site-1', '拓荒者', 1],
      ['ach-mile-site-2', '双站总督', 2],
    ],
    matterTechMaxed: [['ach-mile-tech-tree', '谜质通晓', 24]],
  }

  it('18 条的 id / 卡名 / 计数键 / 阈值与设计稿逐条一致', () => {
    const flat = Object.entries(EXPECT).flatMap(([stat, rows]) => rows.map(([id, name, target]) => ({ stat, id, name, target })))
    expect(flat.length).toBe(18)
    for (const e of flat) {
      const def = ACHIEVEMENTS.find((a) => a.id === e.id)
      expect(def, `缺 ${e.id}`).toBeTruthy()
      expect(def!.name).toBe(e.name)
      expect(def!.category).toBe('milestone')
      const src = def!.source
      expect(src.kind).toBe('milestone')
      if (src.kind !== 'milestone') continue
      expect(src.stat).toBe(e.stat)
      expect(src.target).toBe(e.target)
      // 阈值必须**写进说明**（卡面去掉数字后，说明是玩家唯一能读到规格的地方）
      expect(def!.note).toContain(String(e.target))
    }
    // 图案只认这六个家族（渲染层 `ach-mile-*` 六枚线稿一一对应）
    const slots = new Set(MILE_BADGES.map((a) => a.pattern))
    expect([...slots].sort()).toEqual(
      ['mile-cache', 'mile-core', 'mile-depth', 'mile-guard', 'mile-outpost', 'mile-tech'].sort(),
    )
    // 里程碑统一**金色**（与链徽章"同图案按档分色"相反：同色按图案分家族）
    expect(new Set(MILE_BADGES.map((a) => a.tone)).size).toBe(1)
  })

  it('判据 = 终身计数 ≥ 阈值：每个家族的每一档都能按阈值精确触发', () => {
    for (const [stat, rows] of Object.entries(EXPECT)) {
      for (const [id, , target] of rows) {
        const below = testState()
        bumpFirst(below, stat, target - 1)
        const def = ACHIEVEMENTS.find((a) => a.id === id)!
        expect(achievementReached(below, def.source), `${id} 在 ${target - 1} 时不该达成`).toBe(false)
        const at = testState()
        bumpFirst(at, stat, target)
        expect(achievementReached(at, def.source), `${id} 在 ${target} 时应达成`).toBe(true)
      }
    }
  })

  it('**峰值型不回退**：下潜纪录被写小、核心花掉、站不拆——纪录只升不降', () => {
    const state = testState()
    peakFirst(state, 'whMaxDepth', 5)
    peakFirst(state, 'whMaxDepth', 2) // 这趟只下到 2 层
    expect(state.firstStats!.whMaxDepth).toBe(5)
    // 非有限值一律忽略（Math.max 遇 NaN 会把记录污染成 NaN）
    peakFirst(state, 'whMaxDepth', Number.NaN)
    peakFirst(state, 'whMaxDepth', Number.POSITIVE_INFINITY)
    expect(state.firstStats!.whMaxDepth).toBe(5)
    // 峰值型也享受"只置一次"：先到 5 层，再回落也不会把已发的徽章收回
    advanceAchievements(state, ACHIEVEMENTS)
    peakFirst(state, 'whMaxDepth', 1)
    const rows = achievementOverview(state, ACHIEVEMENTS)
    expect(rows.find((r) => r.def.id === 'ach-mile-wh-depth-5')!.earnedAt).not.toBe(null)
  })

  it('峰值型幂等：同一深度反复报不会重复计数、也不重复发徽章', () => {
    const state = testState()
    for (let i = 0; i < 5; i++) peakFirst(state, 'whMaxDepth', 4)
    expect(state.firstStats!.whMaxDepth).toBe(4)
    const first = advanceAchievements(state, ACHIEVEMENTS).map((a) => a.id).filter((id) => id.startsWith('ach-mile-wh-depth'))
    expect(first.sort()).toEqual(['ach-mile-wh-depth-2', 'ach-mile-wh-depth-3', 'ach-mile-wh-depth-4'])
    // 再来一次：不该有任何新徽章
    expect(advanceAchievements(state, ACHIEVEMENTS).filter((a) => a.category === 'milestone')).toEqual([])
  })

  it('老档自愈：老档没有这四个键（firstStats 缺省）⇒ 载入后第一拍按**当前计数**补发', () => {
    const state = testState()
    // 模拟"老档"：直接给这本账塞入达标值（老档结构里没有这四个键 ⇒ 读作 0）
    state.firstStats = { rareBoxes: 20 }
    expect(state.firstStats.whMaxDepth).toBeUndefined()
    const newly = advanceAchievements(state, ACHIEVEMENTS).filter((a) => a.category === 'milestone')
    const ids = newly.map((a) => a.id)
    // rareBoxes = 20 ⇒ 1/5/20 三枚到手，60/150 还没有
    expect(ids).toContain('ach-mile-box-1')
    expect(ids).toContain('ach-mile-box-20')
    expect(ids).not.toContain('ach-mile-box-60')
    // 其余家族一个都没到 ⇒ 不该误发
    expect(ids).not.toContain('ach-mile-wh-depth-2')
    expect(ids).not.toContain('ach-mile-tech-tree')
  })

  it('里程碑也走"纯展示"：发徽章不动钱包/仓库/货舱', () => {
    const state = testState()
    bumpFirst(state, 'rareBoxes', 150)
    bumpFirst(state, 'whBossClears', 4)
    peakFirst(state, 'whMaxDepth', 5)
    // ⚠ `aiCoreKinds` 是**峰值型**（由 `gainAiCore` 现数库存类数写），不是累计型 ⇒ 用 peakFirst
    peakFirst(state, 'aiCoreKinds', 4)
    peakFirst(state, 'sitesBuilt', 2)
    peakFirst(state, 'matterTechMaxed', 24)
    const before = {
      isk: state.wallet.isk,
      ware: JSON.stringify(state.warehouse ?? {}),
      ai: JSON.stringify(state.aiCores),
    }
    const newly = advanceAchievements(state, ACHIEVEMENTS).filter((a) => a.category === 'milestone')
    expect(newly.length).toBe(18)
    expect(state.wallet.isk).toBe(before.isk)
    expect(JSON.stringify(state.warehouse ?? {})).toBe(before.ware)
    // ⚠ AI 核心是**读**来判定的（`aiCoreKinds`），发徽章本身不许改动核心库
    expect(JSON.stringify(state.aiCores)).toBe(before.ai)
    expect(achievementCount(state)).toBeGreaterThanOrEqual(18)
  })

  it('读档往返：里程碑计数与已发徽章都原样回来', () => {
    const state = testState()
    peakFirst(state, 'whMaxDepth', 3)
    bumpFirst(state, 'rareBoxes', 7)
    advanceAchievements(state, ACHIEVEMENTS)
    const back = loadSaveFile(serializeSaveFile(state, 1)).state
    expect(back.firstStats!.whMaxDepth).toBe(3)
    expect(back.firstStats!.rareBoxes).toBe(7)
    expect(achievementCount(back)).toBe(achievementCount(state))
  })

  /**
   * **里程碑计数的"追溯检查"**（**2026-09-20 船长令**：「**里程碑都加入追溯检查**」；
   * 由玩家报障「已经建好了的空间站无法完成成就」起头）。
   *
   * 六个计数键原先只在**事件点**记账 ⇒ 事件发生在成就系统之前（老档、或先做完再更新到本版）的档，
   * 账上永远是 0 ⇒ 成就拿不到。引擎每拍按 `state` 现算一次（`reconcileMilestoneStats`）⇒
   * 读档后第一拍就把能推导的补齐（精确值或下界，逐条见那个函数）。
   */
  it('已建成的副空间站：账上没有计数，也靠"现算兜底"补齐并发出「拓荒者」', () => {
    const state = testState()
    const site = [...ctx.stations.values()][0]!
    // 模拟"站在成就系统之前的档"：站已建成并入网（stage 满档），但 `firstStats` 里没有 sitesBuilt
    state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
    expect(state.firstStats?.sitesBuilt).toBeUndefined()
    expect(achievementReached(state, { kind: 'milestone', stat: 'sitesBuilt', target: 1 })).toBe(false)

    advanceGame(state, 1000, ctx) // 一拍 ⇒ 现算兜底 + 成就判定

    expect(firstStatOf(state, 'sitesBuilt')).toBeGreaterThanOrEqual(1)
    const earned = state.achievements?.earned ?? {}
    expect(earned['ach-mile-site-1'], '「拓荒者」应当补发').toBeDefined()
    // 幂等：再推几拍不重复、计数不回退
    for (let i = 0; i < 3; i++) advanceGame(state, 1000, ctx)
    expect(firstStatOf(state, 'sitesBuilt')).toBeGreaterThanOrEqual(1)
  })

  it('AI 核心类数 / 谜质满级数同样靠现算兜底（老档读进来那一拍补齐）', () => {
    const state = testState()
    // 老档只留下"现状"，没有这三本账
    gainAiCore(state, 'basic', 1)
    gainAiCore(state, 'gamma', 1)
    state.firstStats = {} // 抹掉事件点记的账（模拟成就系统之前的老档）
    const nodes = [...ctx.matterTech!.values()]
    state.research = { levels: Object.fromEntries(nodes.map((n) => [n.id, n.maxLevel])) }

    advanceGame(state, 1000, ctx)

    expect(state.firstStats?.aiCoreKinds).toBeGreaterThanOrEqual(2)
    expect(state.firstStats?.matterTechMaxed).toBe(nodes.length)
    const earned = state.achievements?.earned ?? {}
    expect(earned['ach-mile-core-2'], '「双子核」应当补发').toBeDefined()
    expect(earned['ach-mile-tech-tree'], '「谜质通晓」应当补发').toBeDefined()
  })

  it('稀有箱（累计型）也追溯：`rareBoxesOpened` 逐型求和 ⇒ 补齐并发出拾荒系徽章', () => {
    const state = testState()
    // 老档：账本只留"每型已开箱数"（开箱那一刻与 `bumpFirst('rareBoxes')` 同一行写的）
    state.rareBoxesOpened = { 'wreck-a': 4, 'wreck-b': 3 }
    state.firstStats = {}
    advanceGame(state, 1000, ctx)
    expect(firstStatOf(state, 'rareBoxes')).toBe(7) // 精确值：4 + 3
    const earned = state.achievements?.earned ?? {}
    expect(earned['ach-mile-box-1']).toBeDefined()
    expect(earned['ach-mile-box-5']).toBeDefined()
    expect(earned['ach-mile-box-20']).toBeUndefined() // 7 < 20：不该误发
  })

  it('虫洞层深与守卫数也追溯：洞里读本趟 run，出洞读"最近一趟结算单"的层深', () => {
    const s1 = testState()
    // 真进一趟洞（要完整 run 对象，引擎每拍会推进它）
    expect(wormholeEnter(s1, ctx, [s1.shipId], 4242).ok).toBe(true)
    s1.firstStats = {}
    const run = s1.wormhole.run!
    run.depth = 3
    run.bossCleared = 2
    advanceGame(s1, 1000, ctx)
    expect(firstStatOf(s1, 'whMaxDepth')).toBeGreaterThanOrEqual(3)
    expect(firstStatOf(s1, 'whBossClears')).toBeGreaterThanOrEqual(2)
    const e1 = s1.achievements?.earned ?? {}
    expect(e1['ach-mile-wh-depth-3']).toBeDefined()
    expect(e1['ach-mile-wh-depth-4']).toBeUndefined() // 只到 3 层
    expect(e1['ach-mile-wh-boss-2']).toBeDefined()

    // 已出洞的老档：结算单还留着"上一次撤在第 5 层" ⇒ 层深照样追溯（守卫数没留痕 ⇒ 不抬）
    const s2 = testState()
    s2.firstStats = {}
    s2.wormhole.lastSettle = {
      kind: 'extract',
      depth: 5,
      oreUnits: 0,
      oreIsk: 0,
      wreckIsk: 0,
      boxes: [],
      relics: [],
      shipsLost: [],
      lostIsk: 0,
    }
    advanceGame(s2, 1000, ctx)
    expect(firstStatOf(s2, 'whMaxDepth')).toBe(5)
    expect((s2.achievements?.earned ?? {})['ach-mile-wh-depth-5']).toBeDefined()
  })
})
