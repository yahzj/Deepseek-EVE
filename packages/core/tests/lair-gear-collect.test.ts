/**
 * 敌族专属装备「集齐前不重复掉落」（2026-09-10 船长拍板，乙案）：
 * 开箱掷中专属装备时，若该族池中还有玩家**当前未持有**的件，就只从"未持有"里抽；
 * 该族全部到手后恢复均匀随机（允许重复）。判定口径 = 当前持有（装备库 + 已装配位）。
 * A 族三件（2026-09-10 船长逐件过审）：劫掠者转管炮 / 掠袭导弹巢 / 赃物强化舱。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addModule, createInitialState } from '../src/index'
import { ownedModuleCount } from '../src/equipment'
import { rollRareBoxExtra, type RecycleProfile } from '../src/salvage'
import { FOE_LAIR_GEAR } from '../src/lairs'

const ctx = buildSimContext()
const A_POOL = FOE_LAIR_GEAR.A

function makeState(seed = 7) {
  return createInitialState({ nowWallMs: 0, seed })
}

function profile(pool: readonly string[]): RecycleProfile {
  return {
    anomalyId: 'ano-redring-raiders',
    galaxyId: 'galaxy-redring',
    threat: 88,
    baseDensity: 100,
    tier: 'dire', // 专属装备命中率 0.55，样本足够快
    lowSec: false,
    lairGear: [...pool],
  }
}

/** 抽一件专属装备（非专属结果返回 null） */
function drawGear(state: ReturnType<typeof makeState>, pool: readonly string[]): string | null {
  const extra = rollRareBoxExtra(state, ctx, profile(pool))
  if (!extra) return null
  const gear = extra.modules.find((id) => pool.includes(id))
  return gear ?? null
}

describe('敌族专属装备：集齐前不重复掉落（2026-09-10 船长）', () => {
  it('A 族已配三件（逐件过审结果）', () => {
    expect(A_POOL).toEqual(['mod-lair-turret-a', 'mod-lair-missile-a', 'mod-lair-cargo-a'])
    for (const id of A_POOL) expect(ctx.modules.get(id)).toBeTruthy()
  })

  it('前三次出件必为三件不同装备（集齐前不重复）', () => {
    const state = makeState(11)
    const got: string[] = []
    for (let i = 0; i < 400 && got.length < 3; i += 1) {
      const id = drawGear(state, A_POOL)
      if (!id) continue
      expect(got).not.toContain(id) // 未集齐前不得重复
      got.push(id)
      addModule(state, id, 1) // 视为玩家已获得（当前持有）
    }
    expect(new Set(got).size).toBe(3)
  })

  it('集齐三件之后恢复均匀随机（允许重复）', () => {
    const state = makeState(13)
    for (const id of A_POOL) addModule(state, id, 1)
    const seen = new Set<string>()
    for (let i = 0; i < 200; i += 1) {
      const id = drawGear(state, A_POOL)
      if (id) seen.add(id)
    }
    expect(seen.size).toBeGreaterThanOrEqual(2) // 池内多件都可能出（不再只给"未持有"）
  })

  it('当前持有口径：已装配（不在装备库）的件也算已持有', () => {
    const state = makeState(17)
    const ship = state.fleet[state.shipId]!
    expect(ownedModuleCount(state, A_POOL[0]!)).toBe(0)
    state.moduleBay[A_POOL[0]!] = 1
    expect(ownedModuleCount(state, A_POOL[0]!)).toBe(1)
    // 装到船上后：装备库清零，但"已装配"仍算持有
    delete state.moduleBay[A_POOL[0]!]
    ship.fitted.high[0] = A_POOL[0]!
    expect(ownedModuleCount(state, A_POOL[0]!)).toBe(1)
  })
})
