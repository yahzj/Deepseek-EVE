/**
 * **入侵残骸场"比占领活得久"⇒ 打捞池也要跟着活**（**2026-09-26 玩家报障**：
 * 「**打捞残骸捞不到H族残骸，只能捞到该星系默认的。**」）。
 *
 * 病根（真档实测）：`state.weekendWrecks` 里的残骸场 48 小时自然衰减、活动结束也不清，
 * 而打捞型号池原先只在「此刻仍在占领名单里」时才并入入侵舰队 ⇒
 * ① 旗舰期的核心（核心夺回后旗舰才现身，最大一笔残骸正是在这里注入）；
 * ② 夺回后的外围；③ 上一场的遗留场 —— 三种星系的读数都是「残骸条写着入侵残骸、捞出来全是默认残骸」。
 *
 * 修法：**有场就并入来源族的独立入侵卡**（族记在残骸场记录里；老档没记 ⇒ 回落当前事件族）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { pullOneWreck } from '../src/salvaging'
import { injectWeekendWreck, weekendWreckFamilyOf } from '../src/salvage'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
/** 挑一个"本来就有可见悬赏"的星系当实验场（池底 = 它的原卡） */
const GAL = [...ctx.anomalies.values()].find((a) => !a.hidden && a.galaxyId !== 'galaxy-hub')!.galaxyId
/** 事件的占领区用**别的**星系（否则实验场自己就成了被占星系，两种口径混在一起测不出东西） */
const OTHER = [...ctx.galaxies.keys()].filter((g) => g !== GAL && g !== 'galaxy-hub')

/** 抽 40 轮打捞，返回出过的残骸型号 */
function pulls(s: GameState, galaxyId: string): Set<string> {
  const got = new Set<string>()
  for (let i = 0; i < 40; i++) {
    const r = pullOneWreck(s, ctx, galaxyId, 60_000)
    if (r) got.add(r.itemId)
  }
  return got
}

/** 事件：**以此刻为起点**、占领的是"别的星系"（本实验场**不在占领名单**里） */
function stateWithEvent(opts: { ended?: boolean } = {}): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 9 })
  s.weekendEvent = {
    seq: 3,
    startedAtWallMs: Date.now(),
    coreId: OTHER[0]!,
    peripheryIds: [OTHER[1]!],
    family: 'H',
    contributed: {},
    ...(opts.ended === true ? { endedAtWallMs: Date.now() } : {}),
  }
  return s
}

describe('打捞池：入侵残骸场不在占领名单时也要并入侵卡（玩家报障）', () => {
  it('**残留场（星系已不在占领名单）⇒ 仍能捞出「墨潮帮残骸（入侵）」**', () => {
    const s = stateWithEvent()
    injectWeekendWreck(s, GAL, 600, 'H')
    expect(weekendWreckFamilyOf(s, GAL), '场里记着来源族').toBe('H')
    const got = pulls(s, GAL)
    expect(got.has('wreck-h-hi'), `40 次没出 H 残骸（出的是 ${[...got].join(' / ')}）`).toBe(true)
  })

  it('**老档没记族**（兼容字段缺席）⇒ 回落当前事件族，照样出 H', () => {
    const s = stateWithEvent()
    // 模拟老档：只写 density/decayAccMs（不经 `injectWeekendWreck` 的族参数）
    s.weekendWrecks = { [GAL]: { density: 600, decayAccMs: 0 } }
    expect(weekendWreckFamilyOf(s, GAL), '回落当前事件族').toBe('H')
    expect(pulls(s, GAL).has('wreck-h-hi')).toBe(true)
  })

  it('**活动已结束、残骸场还在**（48h 自然衰减）⇒ 仍出 H（场里的族说话）', () => {
    const s = stateWithEvent({ ended: true })
    injectWeekendWreck(s, GAL, 600, 'H')
    expect(s.weekendEvent!.endedAtWallMs, '事件已结束').toBeDefined()
    expect(pulls(s, GAL).has('wreck-h-hi')).toBe(true)
  })

  it('**没有残骸场 ⇒ 老口径逐字不变**（池底只有原卡，捞不到 H）', () => {
    const s = stateWithEvent()
    const got = pulls(s, GAL)
    expect(got.has('wreck-h-hi'), '没有入侵残骸就不该出 H 残骸').toBe(false)
    expect(got.size, '原卡残骸照旧可捞').toBeGreaterThan(0)
  })

  it('写回残骸场（打捞扣减）**不丢来源族**', () => {
    const s = stateWithEvent()
    injectWeekendWreck(s, GAL, 600, 'H')
    pulls(s, GAL) // 扣减会把记录写回
    expect(s.weekendWrecks?.[GAL]?.family, '扣减后仍记着族').toBe('H')
  })
})
