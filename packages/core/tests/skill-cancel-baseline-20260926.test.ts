/**
 * **取消技能时"连带取消"清单只算因本次取消而失效的项**（2026-09-26 玩家报障）
 *
 * 玩家原话（船长转述）：「**只要取消任何技能，就会出现图中所示情况**」——图里确认条写着
 * 「取消这一项会连带取消 10 项依赖它的训练：动能炮术 Lv1…Lv5、激光炮术 Lv1…Lv5」，
 * 而那 10 项与所点的技能毫无关系（且队列里原本就挂着它们）。
 *
 * 病根：`skillCancelImpact` / `removeQueueAt` 的级联判据是"**剩余队列里所有前置不满足的项**"，
 * 没有减掉"**取消之前就已经不满足**"的那一份基线 ⇒
 * ① 确认条对**任何**一项都会列出同一批坏项（玩家看到的正是这个）；
 * ② 点「确认取消」会**真把它们删掉**——毁掉玩家排好的训练（它们本来照常会练：训练时不复检前置）。
 *
 * 修法：两处都先取基线 `preexistingUnmet`，只报/只删"因本次取消才变成不满足"的项
 * （= 船长 2026-09-23 那条令的本意：被取消项的依赖者一并取消）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { removeQueueAt, skillCancelImpact } from '../src/engine'
import type { GameState } from '../src/state'

const ctx = buildSimContext()

function world(): { state: GameState } {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  state.skills.queue = []
  state.skills.trained = {}
  return { state }
}

/**
 * 复刻报障形状：队列里挂着 10 项"前置（炮术学）没满足"的武器专精训练 ＋ 几项正常训练。
 * 真实档里这 10 项就是「动能炮术 Lv1~Lv5 ＋ 激光炮学 Lv1~Lv5」（两者前置都是 `gunnery`）。
 */
function reportShape(state: GameState): void {
  state.skills.queue = [
    { skillId: 'galactic-happenings', targetLevel: 1, progressMs: 0 },
    { skillId: 'deep-space-logistics', targetLevel: 1, progressMs: 0 },
    ...Array.from({ length: 5 }, (_, i) => ({ skillId: 'kinetic-gunnery', targetLevel: i + 1, progressMs: 0 })),
    ...Array.from({ length: 5 }, (_, i) => ({ skillId: 'laser-cannon', targetLevel: i + 1, progressMs: 0 })),
  ]
}

describe('取消技能的"连带取消"清单（2026-09-26 玩家报障）', () => {
  it('前置没满足的项是"取消之前就坏的" ⇒ 取消无关项时**不出确认条**', () => {
    const { state } = world()
    reportShape(state)
    for (let i = 0; i < state.skills.queue.length; i += 1) {
      const impact = skillCancelImpact(state, ctx.skills, i)
      expect(impact, `第 ${i + 1} 项要能算出计划`).not.toBeNull()
      expect(
        impact!.also.map((it) => `${it.skillId}${it.targetLevel}`),
        `取消第 ${i + 1} 项不该牵连那 10 项本来就没前置的训练`,
      ).toEqual([])
    }
  })

  it('点「确认取消」不会顺手删掉那些"本来就没前置"的训练（改前会被删光）', () => {
    const { state } = world()
    reportShape(state)
    const before = state.skills.queue.length
    expect(removeQueueAt(state, 0, ctx.skills), '取消第一项').toBe(true)
    expect(state.skills.queue.length, '只少被取消的那一项').toBe(before - 1)
    const kept = state.skills.queue.filter((it) => it.skillId === 'kinetic-gunnery' || it.skillId === 'laser-cannon')
    expect(kept.length, '那 10 项原样留着').toBe(10)
  })

  it('真级联仍然照旧：取消前置 ⇒ 依赖它的项一并取消（船长 2026-09-23 的令没被削弱）', () => {
    const { state } = world()
    state.skills.queue = [
      { skillId: 'kinetic-gunnery', targetLevel: 1, progressMs: 0 },
      { skillId: 'gunnery', targetLevel: 1, progressMs: 0 },
    ]
    // 前置在队列里 ⇒ 取消之前"动能炮术"是满足的
    const impact = skillCancelImpact(state, ctx.skills, 1)
    expect(impact!.also.map((it) => it.skillId), '取消炮术学 ⇒ 动能炮术跟着取消').toEqual(['kinetic-gunnery'])
    expect(removeQueueAt(state, 1, ctx.skills)).toBe(true)
    expect(state.skills.queue, '两项都没了').toEqual([])
  })

  it('基线用"取消前"的整条队列算：既有的坏项不列，因本次取消才坏的照列', () => {
    const { state } = world()
    state.skills.queue = [
      // ① 基线项：前置「炮术学」根本不在队列里也没练过 ⇒ 取消之前就坏
      { skillId: 'kinetic-gunnery', targetLevel: 1, progressMs: 0 },
      // ② 真级联：取消「货舱管理」⇒ 依赖它的「深空物流学」才失效
      { skillId: 'hold-management', targetLevel: 1, progressMs: 0 },
      { skillId: 'deep-space-logistics', targetLevel: 1, progressMs: 0 },
    ]
    const impact = skillCancelImpact(state, ctx.skills, 1)
    expect(impact!.also.map((it) => it.skillId), '只列因本次取消才坏的').toEqual(['deep-space-logistics'])
    expect(removeQueueAt(state, 1, ctx.skills)).toBe(true)
    expect(state.skills.queue.map((it) => it.skillId), '基线项留着，新坏的删掉').toEqual(['kinetic-gunnery'])
  })
})
