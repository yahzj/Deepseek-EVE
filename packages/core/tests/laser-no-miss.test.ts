/**
 * **激光（`kind: 'beam'`）对高闪避敌舰不会 MISS** —— 2026-09-25 玩家报障的复现与回归锁。
 *
 * 船长转述：「**有玩家反应，激光武器在打 H 族敌人时，会出现 MISS 的情况**」。
 * 本用例用**真实数据**跑一场「我方激光炮 ＋ 动能炮 vs H 族墨潮突击舰（闪避 0.59，全游戏最高）」，
 * 把 `battle.fx` 里我方两种武器的命中逐条数出来：
 * - **能量/激光（plasma ⇒ `kind: 'beam'`，必中）⇒ miss 恒为 0**（本用例的硬断言）；
 * - 同一场里的**动能**（`gun` 0.8 命中 ＋ 舰体基础舰炮 `fixed` 0.5 命中）⇒ 会 MISS（对照读数，软断言）。
 *
 * 口径依据（勿改）：
 * - 2026-09-11 船长裁定⑤「立「能量·掷命中」档」：能量主系**缺省 = 光束必中**，只有显式写
 *   `energyForm: 'spit'` 才掷命中；而**全仓 `spit` 只有 C 族四档敌舰在用**（`foe-ships.ts`）
 *   ⇒ 我方激光一律必中；
 * - 必中的落点：`combat.ts` 的 beam 分支（`dmg = max(1, …)` ＋ `autoHit = true`）与
 *   `hit = dmg > 0 && (autoHit || …)`；
 * - 会掷命中的武器统一走 `hitChance()`：`clamp(hitMin, hitMax, (hitRate + hitBonus − 目标闪避) × 距离衰减 …)`
 *   ⇒ **H 族闪避最高**（墨潮突击舰 0.59；A 族 0.22、其余族 0.1~0.3）⇒ "只有打 H 才明显 MISS" 与数据吻合。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { advanceBattleFor, startBattleFor } from '../src/combat'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'

const ctx = buildSimContext()
/** H 族入侵卡（4 艘墨潮突击舰 · 闪避 0.59）；也是玩家在入侵里真打的那张 */
const FOE_CARD = 'ink-harass'

/**
 * 载入一套高槽并开一场（⚠ 直接写 `fitted`，不走装配校验——本用例只回答"同一场里谁在 MISS"，
 * 不验证装配合法性；`familyModules` 只读 `fitted`，故不受槽位/CPU 限制影响）。
 */
function world(high: string[]): { state: GameState; battle: NonNullable<ReturnType<typeof startBattleFor>> } {
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  const ship = state.fleet[state.shipId]!
  ship.fitted = { high: [...high], mid: [], low: [] } as never
  for (const id of high) state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
  state.warehouse.items['ammo-plasma-l'] = 50_000
  state.warehouse.items['ammo-kinetic-l'] = 50_000
  const battle = startBattleFor(state, ctx as SimContext, state.shipId, FOE_CARD, 0)
  expect(battle, `开不出「${FOE_CARD}」这场战斗`).not.toBeNull()
  return { state, battle: battle! }
}

/** 逐步推进并按 类型 × 命中 计数（fx 环只有 48 条 ⇒ 每步读完就清，自己累计）；
 * `distMin`/`distMax` = 本场交距区间（读数用：MISS 多不多与距离直接相关） */
function countShots(high: string[]): {
  beam: number
  beamMiss: number
  kin: number
  kinMiss: number
  distMin: number
  distMax: number
} {
  const { state, battle } = world(high)
  const out = { beam: 0, beamMiss: 0, kin: 0, kinMiss: 0, distMin: Infinity, distMax: 0 }
  for (let i = 0; i < 240 && !battle.ended; i += 1) {
    state.gameMs += 1_000
    advanceBattleFor(state, ctx as SimContext, battle, state.shipId, FOE_CARD)
    const d = battle.distanceM
    if (d > 0) {
      if (d < out.distMin) out.distMin = d
      if (d > out.distMax) out.distMax = d
    }
    for (const fx of battle.fx) {
      if (fx.side !== 'me') continue
      if (fx.type === 'plasma') {
        out.beam += 1
        if (fx.hit === false) out.beamMiss += 1
      } else {
        out.kin += 1
        if (fx.hit === false) out.kinMiss += 1
      }
    }
    battle.fx.length = 0
  }
  return out
}

/** **玩家报障时的原配装**（船长 2026-09-25 补充）：「同时携带了陵卫连装炮、劫掠转管炮，和 2 个激光 MK3」 */
const PLAYER_FIT = ['mod-lair-turret-a', 'mod-wh-d-turret', 'mod-laser-3', 'mod-laser-3']

const pct = (n: number, total: number): string => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '—')

describe('激光 vs 高闪避敌舰（H 族墨潮突击舰）', () => {
  it('激光（beam/plasma）一发都不会 MISS；同一场的动能会 MISS（对照）', () => {
    // 初始船 sandcat 位：一激光（beam/plasma）＋ 一动能炮（gun/kinetic）；舰体自带基础舰炮（fixed/kinetic）
    const c = countShots(['mod-laser-1', 'mod-turret-kin-1'])
    // 读数（失败时会在报错里带出来）
    expect(c.beam, `这场里激光一发都没打出去（beam=${c.beam}）——用例前提不成立`).toBeGreaterThan(0)
    expect(c.beamMiss, `激光出现 MISS ${c.beamMiss} 次（beam 共 ${c.beam} 发）——与「光束必中」冲突`).toBe(0)
    // 对照读数：动能确实会被闪避掉（不硬断言语义，只要求"有射击发生"）
    expect(c.kin).toBeGreaterThan(0)
    console.log(`  [读数] 激光 ${c.beam} 发 / MISS ${c.beamMiss} · 动能 ${c.kin} 发 / MISS ${c.kinMiss}`)
  })

  /**
   * **复现玩家的原配装**（2026-09-25 船长补充：「同时携带了陵卫连装炮、劫掠转管炮，和 2 个激光 MK3」）。
   * 这三件里**只有激光是必中**：陵卫连装炮（`mod-wh-d-turret`，动能 gun，命中 0.76）与
   * 劫掠者转管炮（`mod-lair-turret-a`，动能 gun，命中 0.84、周期 0.5 秒）都要掷命中，
   * 而墨潮突击舰闪避 0.59 ⇒ 扣完剩 0.17 / 0.25 再乘距离衰减 ⇒ **MISS 全由这两门炮产生**。
   */
  it('玩家原配装（2× 激光 MK3 ＋ 陵卫连装炮 ＋ 劫掠者转管炮）：MISS 全部来自两门动能炮', () => {
    const c = countShots(PLAYER_FIT)
    expect(c.beam, `激光一发未发（beam=${c.beam}）——用例前提不成立`).toBeGreaterThan(0)
    expect(
      c.beamMiss,
      `2 门激光 MK3 共 ${c.beam} 发里出现 ${c.beamMiss} 次 MISS——与「光束必中」冲突`,
    ).toBe(0)
    expect(c.kin, '动能炮一发未发——对照不成立').toBeGreaterThan(0)
    console.log(
      `  [读数·玩家原配装] 激光 ${c.beam} 发 / MISS ${c.beamMiss}（命中 100%）· ` +
        `动能 ${c.kin} 发 / MISS ${c.kinMiss}（命中 ${pct(c.kin - c.kinMiss, c.kin)}）· ` +
        `交距 ${Math.round(c.distMin)}~${Math.round(c.distMax)} m`,
    )
  })
})
