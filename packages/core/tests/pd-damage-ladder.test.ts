/**
 * **近防炮攻击口径**（2026-09-12 船长裁定「丙」：「**提高近防炮伤害，且因为其射程更短，威力应该提高**」）。
 *
 * 背景（玩家反馈 + 实测取证）：旧口径 `dmgMult 0.5/0.8/1.05`（单发 3/5/6）⇒ 对舰名义 DPS 只有同档主炮的
 * 39~44%；打机群更是**整场只开 3~20 炮、对 E 族警戒机群（644 血）一架都打不下来**。
 * 新口径 = **短射程补偿**：近防炮射程统一 2,500m（同档炮台 3,220 / 5,740 / 7,350m）⇒
 * **对舰名义 DPS 反超同档主炮约 1.2~1.3 倍**，代价是只能在 2.5km 内发挥（并仍占一个高槽）。
 *
 * **作废**旧条款「单发 = 同档主炮的 ~40% ⇒ 对舰明显偏弱、不是主炮替代品」
 * （`docs/design/foe-drone-system-20260911.md` §六 表；该稿已就地标注作废）。
 *
 * 本文件锁住：三档单发/名义 DPS 的绝对值、与同档主炮的强弱关系、射程与防空属性不退让。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addModule, addShipToFleet, createInitialState, createPlayerSpec, fitModule } from '@whale/core'

const real = buildSimContext()

/** 引擎真值：单装一件 → 取该件武器条目（单发 × 门数 ÷ 装填秒） */
function weaponOf(moduleId: string): { per: number; dps: number; maxRangeM: number; antiDrone: boolean } {
  const def = real.modules.get(moduleId)!
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const uid = addShipToFleet(state, 'whale') // 鲸吞级：高槽 2 / CPU 130，足够逐件单测
  state.shipId = uid
  addModule(state, moduleId, 1)
  const fit = fitModule(state, moduleId, real, { shipId: uid })
  expect(fit.ok, `${def.name} 应装得上：${fit.error ?? ''}`).toBe(true)
  const me = createPlayerSpec(state, real, uid)!
  const w = me.weapons.find((x) => x.label.startsWith(def.name))!
  const per = w.kind === 'gun' ? (Object.values(w.shotsByType ?? {})[0] ?? 0) : (w.shotDmg ?? 0)
  return { per, dps: per / (w.reloadMs / 1000), maxRangeM: w.maxRangeM, antiDrone: w.canHitDrones === true }
}

const PD = ['mod-pd-e', 'mod-pd-e-2', 'mod-pd-e-3'] as const
const GUN = ['mod-turret-kin-1', 'mod-turret-kin-2', 'mod-turret-kin-3'] as const

describe('近防炮攻击口径（船长 2026-09-12 裁定「丙」：短射程 ⇒ 威力更高）', () => {
  it('三档单发与名义 DPS 取新值（10 / 16 / 17 单发；6.67 / 11.43 / 13.08 DPS）', () => {
    const per = [10, 16, 17]
    const dps = [6.67, 11.43, 13.08]
    PD.forEach((id, i) => {
      const w = weaponOf(id)
      expect(w.per, `${id} 单发`).toBe(per[i])
      expect(w.dps, `${id} 名义 DPS`).toBeCloseTo(dps[i]!, 1)
    })
  })

  it('短射程补偿：对舰名义 DPS 反超同档炮台 1.2~1.3 倍（射程只有其 1/1.3~1/3）', () => {
    for (let i = 0; i < 3; i++) {
      const pd = weaponOf(PD[i]!)
      const gun = weaponOf(GUN[i]!)
      const ratio = pd.dps / gun.dps
      expect(ratio, `第 ${i + 1} 档 DPS 比`).toBeGreaterThanOrEqual(1.2)
      expect(ratio, `第 ${i + 1} 档 DPS 比`).toBeLessThanOrEqual(1.35)
      // 射程仍是短的那一档（远距离打不到 —— 这就是它换来高威力的代价）
      expect(pd.maxRangeM).toBe(2500)
      expect(pd.maxRangeM).toBeLessThan(gun.maxRangeM)
    }
  })

  it('防空本职不退让：三档都带防空属性、射程仍 ≤ 2,500m（防空契约）', () => {
    for (const id of PD) {
      const def = real.modules.get(id)!
      const w = weaponOf(id)
      expect(def.canHitDrones, `${id} 应带防空属性`).toBe(true)
      expect(w.antiDrone).toBe(true)
      expect(def.maxRangeM, `${id} 射程`).toBe(2500)
      expect(def.maxRangeM!).toBeLessThanOrEqual(2500)
    }
  })

  it('旧口径已作废：单发不再「同档主炮的 ~40%」，MK1 单发已高于同档炮台', () => {
    expect(weaponOf('mod-pd-e').per).toBeGreaterThan(weaponOf('mod-turret-kin-1').per)
    expect(weaponOf('mod-pd-e-3').per).toBe(17)
    // 仍**不是**主炮的上位替代：MK2/MK3 的单发明显低于同档炮台（靠射速与近距离换 DPS）
    expect(weaponOf('mod-pd-e-2').per).toBeLessThan(weaponOf('mod-turret-kin-2').per)
    expect(weaponOf('mod-pd-e-3').per).toBeLessThan(weaponOf('mod-turret-kin-3').per)
  })
})
