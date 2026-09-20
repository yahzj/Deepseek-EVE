/**
 * **成就徽章**（2026-09-20 船长批「继续之前的成就系统」· 第一批 = 徽章框架）。
 *
 * 这一组钉四件事（都是"悄悄坏掉也看不出来"的那种）：
 * ① **表的口径**：63 枚（13 任务 ＋ 50 链）· 档位与船长裁定一致（一般链 1/4/7/10、探索家 1/5）· id 唯一；
 * ② **发放去重**：只置一次 ⇒ 重复判定 / 读档往返都不会重复发、也不会篡改已达成的时刻；
 * ③ **纯展示**（船长裁定）：发徽章**不动钱包/仓库/货舱**一分一毫；
 * ④ **老档自愈**：老档的账本可以是空的，载入后第一拍按现状把够格的补上（迁移不补发，见 `save.ts` MIGRATIONS[29]）。
 *
 * 第二批（里程碑成就内容）尚未实现 ⇒ 本组只覆盖任务与链两种来源（本文件属**已完成的第一批**，
 * 不挂 `⟪未完成⟫` 记号——约定 §十一之二：完成即删记号）。
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
import { CHAIN_TIERS, FIRST_TASKS, bumpFirst, advanceFirstChains, advanceFirstTasks } from '../src/firstTasks'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()

function testState(): GameState {
  return createInitialState({ nowWallMs: 0, seed: 7 })
}

/** 把某条链的进度直接写到账本上（模拟"玩家已经刷到这个级数"） */
function setChainProgress(state: GameState, chainId: string, level: number): void {
  state.importantTasks[`chain-${chainId}`] = { done: false, delivered: level }
}

const TASK_BADGES = ACHIEVEMENTS.filter((a) => a.source.kind === 'task')
const CHAIN_BADGES = ACHIEVEMENTS.filter((a) => a.source.kind === 'chain')

describe('成就徽章：表的口径（船长 2026-09-20 的两条裁定）', () => {
  it('总数 = 13 任务徽章 ＋ 50 链徽章 = 63', () => {
    // 13 条任务各 1 枚
    expect(TASK_BADGES.length).toBe(FIRST_TASKS.length)
    expect(FIRST_TASKS.length).toBe(13)
    // 12 条一般链 × 4 档 ＋ 探索家 2 档 = 50
    expect(CHAIN_BADGES.length).toBe(50)
    expect(ACHIEVEMENTS.length).toBe(63)
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
  it('总览按表顺序给全 63 枚，含达成状态与到手时刻', () => {
    const state = testState()
    state.gameMs = 42
    state.importantTasks['first-mine'] = { done: true }
    advanceAchievements(state, ACHIEVEMENTS)
    const rows = achievementOverview(state, ACHIEVEMENTS)
    expect(rows.length).toBe(63)
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

describe('成就徽章：与引擎挂点同拍（任务达成即到手）', () => {
  it('任务判定与链记账做完之后才判徽章 ⇒ 同一拍能看到两边的结果', () => {
    const state = testState()
    // 攒够"维修 1 次"（first-repair 的判据）——直接走计数 + 任务判定 + 链记账，再判徽章
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
