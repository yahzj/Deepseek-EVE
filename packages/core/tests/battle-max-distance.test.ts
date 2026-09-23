/**
 * **战场距离上限把我队全队算进来**（2026-09-22 船长令）。
 *
 * 船长原话：「**虫洞内交战距离上限不应该只看玩家操作的舰船和敌人，应该将队伍里所有舰船都考虑到。**」
 * 口径（船长两答）：**取我队全队最远射程**（全局生效，洞内与星图/赏金同一把尺）；
 * **不动开战距离与期望距离**（他明确：「不是期望距离也不是初始距离，而是战斗场景的距离上限」）。
 */
import { describe, expect, it } from 'vitest'
import { battleMaxDistanceM } from '../src/combat'
import type { UnitSpec } from '../src/combat'
import { buildSimContext } from '@whale/data'
import type { BattleState } from '../src/state'

const ctx = buildSimContext()
const bal = ctx.balance.battle

const gun = (maxRangeM: number): UnitSpec['weapons'][number] =>
  ({ minRangeM: 0, maxRangeM, reloadMs: 3000, dmg: 10, src: 'gun' }) as unknown as UnitSpec['weapons'][number]
const spec = (tag: string, maxRangeM: number): UnitSpec => ({ tag, weapons: [gun(maxRangeM)] }) as unknown as UnitSpec

/** 空战斗态足够本函数使用（它只读双方射程相关的字段） */
const emptyBattle = (): BattleState => ({}) as BattleState

describe('战场距离上限 · 我队全队参与（船长 2026-09-22 令）', () => {
  it('僚舰射程更远 ⇒ 上限随之抬高（原先只看主控）', () => {
    const main = spec('player', 7_350) // 主控炮塔 MK3
    const escort = spec('ally-1', 14_880) // 僚舰导弹 MK3
    const foes: UnitSpec[] = []
    const before = battleMaxDistanceM(emptyBattle(), main, foes, bal)
    const after = battleMaxDistanceM(emptyBattle(), main, foes, bal, [main, escort])
    expect(after).toBeGreaterThan(before)
    // 上限 ≈ 14,880 × factor + 缓冲（与 8,000 量级拉开，说明确实按全队算）
    expect(after).toBeGreaterThan(14_000)
  })

  it('不传 `ours` ⇒ 逐字等于旧行为（老调用零改动）', () => {
    const main = spec('player', 7_350)
    const foes: UnitSpec[] = []
    expect(battleMaxDistanceM(emptyBattle(), main, foes, bal, [main])).toBe(
      battleMaxDistanceM(emptyBattle(), main, foes, bal),
    )
  })

  it('全队射程都不超过主控 ⇒ 上限不变（幂等，不虚高）', () => {
    const main = spec('player', 10_500)
    const escorts = [spec('ally-1', 7_350), spec('ally-2', 7_350)]
    const foes: UnitSpec[] = []
    expect(battleMaxDistanceM(emptyBattle(), main, foes, bal, [main, ...escorts])).toBe(
      battleMaxDistanceM(emptyBattle(), main, foes, bal),
    )
  })
})
