/**
 * 离线结算 · 重复清剿（重复清剿）离线续跑（2026-09-08 玩家反馈：清剿期间离线无战斗无收益）。
 * 在线自动再出发由心跳驱动，离线原为大推进不触发——现按分片推进并在片边界同条件尝试再出发。
 *
 * 2026-09-22 追加（**船长选「甲」**）：分片那条路的墙钟**跟着片走** ⇒ 离线跨 0 点时，
 * 0 点前那段仍按**离线前**那版「敌对派系活跃」判、0 点后才换到**上线日**那版（见文件末那条 describe）。
 */
import { describe, expect, it } from 'vitest'
import type { AnomalyDef, SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { addModule, fitModule } from '../src/equipment'
import { simulateOffline } from '../src/simulation'
import { anomaly, galaxy, makeTestCtx, moduleDef } from './helpers'

describe('离线结算：重复清剿续跑', () => {
  it('清剿开启且空闲时离线按分片自动再出发：多轮战斗有战果入账，开关保持', () => {
    const tur = moduleDef('tur-b', 'turret', 0.5, {
      maxRangeM: 4000,
      minRangeM: 0,
      hitRate: 0.9,
      falloff: 0.3,
      reloadMs: 1200,
      dmgMult: 4,
    })
    const ctx: SimContext = makeTestCtx({
      modules: [tur],
      anomalies: [anomaly('ano-w', 'galaxy-hub', { threat: 1, reward: 1_000 })],
    })
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 11 })
    state.wallet.isk = 200_000
    state.warehouse.items['ammo-kinetic-l'] = 2_000
    addModule(state, 'tur-b', 1)
    expect(fitModule(state, 'tur-b', ctx).ok).toBe(true)
    state.autoLoopAnomalyId = 'ano-w' // 开启重复清剿（本地目标）
    const walletBefore = state.wallet.isk

    // 离线 20 分钟：应自动打多轮（本地目标：战斗 + 120s 返港 + 冷却后自动再出发）
    simulateOffline(state, 5_000_000, 5_000_000 + 20 * 60_000, ctx)

    expect(state.wallet.isk).toBeGreaterThan(walletBefore + 2_000) // ≥3 轮战果入账
    expect(state.autoLoopAnomalyId).toBe('ano-w') // 未因耐久/货仓/弹药耗尽停环
    expect(state.logs.some((l) => l.text.includes('战报'))).toBe(true)
  })
})

/**
 * **离线跨 0 点：「敌对派系活跃」按哪一天算**（**2026-09-22 船长选「甲」**）。
 *
 * 船长之问：「假设玩家挂机活跃敌人星系后离线，第二天再上线，那么会计算前一天刷了多少活跃敌人吗？
 * 还是说刷了多少敌人只在上线时计算此时刷了多少敌人（因为换天了，活跃敌人的星系换了）」
 *
 * 口径：分片那条路**墙钟跟着片走** ⇒ 0 点前那些片按**离线前**那版日板判、0 点后的片按**上线日**那版；
 * 离线前已在打的那一场不受影响（出发那一刻就锁定了 `exp.factionActive`，另有用例）。
 *
 * 读数判据（**确定性，不靠概率**）：稀有残骸**只有"派系活跃那场胜利"才掷骰**，且**连开 10 场未出即保底
 * 必掉**（`FACTION_RARE_DROP_PITY_ROLLS`）⇒ 只要某一段窗口里累计 ≥10 场"吃加成"的胜利，
 * 该星系 `galaxyWrecks[星系].rare` 必 > 0；一场都没吃着则恒为 0。
 * 窗口取 21:00 → 次日 02:00（0 点前 3 小时、0 点后 2 小时，两侧都够 10 场）。
 */
describe('离线跨 0 点：派系活跃按哪一天算（船长选「甲」）', () => {
  const TARGET = 'ano-faction'
  /** 目标悬赏所在星系 = **低安**（派系活跃只选中安/低安，高安不可能当选）*/
  const TARGET_GALAXY = 'galaxy-lo'

  const at = (d: number, h: number, mi = 0): number => new Date(2026, 8, d, h, mi, 0).getTime()

  /**
   * 造上下文。
   * `withCandidate` = 让目标卡**能当窝点候选**（有核心词）⇒ 当日派系抽签的候选池里只有它
   * ⇒ 换天必定抽中它（确定性）；传 `false` 则候选池为空 ⇒ 换天后是"今日无活跃"（同样确定）。
   */
  function seedCtx(withCandidate: boolean): SimContext {
    const tur = moduleDef('tur-b', 'turret', 0.5, {
      maxRangeM: 4000,
      minRangeM: 0,
      hitRate: 0.9,
      falloff: 0.3,
      reloadMs: 1200,
      dmgMult: 4,
    })
    const card: AnomalyDef = anomaly(TARGET, TARGET_GALAXY, {
      threat: 1,
      reward: 1_000_000,
      ...(withCandidate ? { lairCore: '测试窝点', foeFamily: 'A' as const } : {}),
    })
    return makeTestCtx({
      modules: [tur],
      galaxies: [galaxy(TARGET_GALAXY, '低安星', { security: 0 })],
      // 新星系必须**接进航路**（否则重复清剿一开就停环："目标星系不在已知航路内"）
      edges: [{ from: 'galaxy-hub', to: TARGET_GALAXY, travelMinutes: 2 }],
      anomalies: [card],
    })
  }

  /**
   * 建一份"玩家把重复清剿挂在目标悬赏上、离线前那版日板 = 给定星系"的档。
   * `bountyWindow` 用**离线前那一天**的 0 点 ⇒ 窗口里的 0 点会让日板按新的一天重抽。
   */
  function seedState(ctx: SimContext, factionGalaxy: string | null): GameState {
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 11 })
    state.wallet.isk = 200_000
    state.warehouse.items['ammo-kinetic-l'] = 5_000
    addModule(state, 'tur-b', 1)
    expect(fitModule(state, 'tur-b', ctx).ok).toBe(true)
    state.autoLoopAnomalyId = TARGET
    state.exploredGalaxies.push(TARGET_GALAXY) // 低安目标：先探明才允许出击
    state.sideTasks.bountyWindow = at(21, 0) // 离线前那一天（9/21）的 0 点
    state.sideTasks.faction = factionGalaxy
      ? {
          id: 1,
          kind: 'faction',
          goodKey: '',
          refId: '',
          need: 0,
          rewardIsk: 1_100_000,
          anomalyId: TARGET,
          galaxyId: factionGalaxy,
          factionAnomalyName: '测试主题悬赏',
        }
      : null
    return state
  }

  /** 该星系的稀有残骸存量（只有"派系活跃那场胜利"才会掷骰/进保底） */
  const rareIn = (state: GameState, galaxyId: string): number => state.galaxyWrecks[galaxyId]?.rare ?? 0

  it('① 离线前那版活跃 = 目标星系 ⇒ 0 点前那 3 小时的战果照吃加成（稀有残骸 > 0）', () => {
    const ctx = seedCtx(false) // 无候选 ⇒ 换天后"今日无活跃"（确定性）
    const state = seedState(ctx, TARGET_GALAXY)
    simulateOffline(state, at(21, 21), at(22, 2), ctx)
    expect(state.sideTasks.faction, '换天后的活跃已被重抽（本场景抽不出候选）').toBeNull()
    expect(rareIn(state, TARGET_GALAXY), '0 点前那段的胜利应进派系活跃掷骰链（靠保底必掉）').toBeGreaterThan(0)
  })

  it('② 对照：离线前那版不是它 ⇒ 0 点前那 3 小时一场都不吃（稀有残骸 = 0）', () => {
    const ctx = seedCtx(false)
    const state = seedState(ctx, null)
    simulateOffline(state, at(21, 21), at(22, 2), ctx)
    expect(rareIn(state, TARGET_GALAXY), '没吃到加成就不会掷骰').toBe(0)
  })

  it('③ 上线日那版 = 目标星系 ⇒ 0 点后那 2 小时的战果吃的是**今天**这版', () => {
    const ctx = seedCtx(true) // 唯一候选 = 目标星系所在 ⇒ 换天必抽中它（确定性）
    const state = seedState(ctx, null)
    simulateOffline(state, at(21, 21), at(22, 2), ctx)
    expect(state.sideTasks.faction?.galaxyId, '换天后抽中的就是目标星系').toBe(TARGET_GALAXY)
    expect(rareIn(state, TARGET_GALAXY), '0 点后那段的胜利应进派系活跃掷骰链').toBeGreaterThan(0)
  })
})
