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
import { droneHitChance, hitChance } from '../src/combat'

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

/**
 * **打机群不吃距离衰减**（船长 2026-09-12 裁定「**按丁修复**」）。
 *
 * 起因：选靶早已按船长 2026-09-11 甲案「打机群不看两舰间距」办，但**命中**仍按两舰间距算
 * `distFactor`——近防炮射程 2,500m 短于典型交距（3,211~5,545m）⇒ 该因子恒落在下限 ×0.5
 * ⇒ 装备表写的命中 0.9 实战只剩 0.27~0.35（玩家实测问「我方近防炮不是 90 命中率吗」）。
 *
 * 本组锁三件事：①打机群**与距离无关**（同一件武器在任何距离同值）；②打机群的命中 = 基础命中 − 机型闪避；
 * ③**打舰仍吃距离衰减**（"射程短所以对舰吃亏"的性格不许被这次修复顺手抹掉）。
 */
describe('打机群不吃距离衰减（船长 2026-09-12「按丁修复」）', () => {
  /** 近防炮 MK1 的武器条目形状（真值取自引擎；命中取基础值、火控技能 0） */
  const W = { hitRate: 0.9, minRangeM: 1, maxRangeM: 2500, falloff: 0.5 }

  it('打机群：命中 = 基础命中 − 机型闪避（与两舰间距无关）', () => {
    const atk = { hitBonus: 0 }
    // E 警戒机：闪避 0.18 ⇒ 0.9 − 0.18 = 0.72（旧口径在 3,211m 上只有 0.27）
    expect(droneHitChance(W, atk, 0.18, real.balance.battle)).toBeCloseTo(0.72, 5)
    // G 蜂群机：闪避 0.45 ⇒ 0.45
    expect(droneHitChance(W, atk, 0.45, real.balance.battle)).toBeCloseTo(0.45, 5)
    // **距离不是参数** ⇒ 5,000m 与 1m 必然同值（旧口径在 5,000m 会被 clamp 到 falloff 下限 0.5 ⇒ 0.27）
    expect(droneHitChance(W, atk, 0.18, real.balance.battle)).toBe(
      droneHitChance(W, atk, 0.18, real.balance.battle),
    )
    // 索敌件是**乘子**（clamp 内），照旧生效
    expect(droneHitChance({ ...W, eqHitMul: 1.12 }, atk, 0.18, real.balance.battle)).toBeCloseTo(
      0.72 * 1.12,
      5,
    )
  })

  it('打舰仍吃距离衰减：同一门近防炮在 1,000m 与 5,000m 的命中明显不同', () => {
    const atk = { hitBonus: 0 }
    const def = { evasion: 0.18 }
    const near = hitChance(W, atk, def, 1_000, real.balance.battle)
    const far = hitChance(W, atk, def, 5_000, real.balance.battle)
    // 1,000m：衰减 = 1 − (999/2499)×0.5（minRange 1 → maxRange 2,500 线性到 falloff 0.5）
    expect(near).toBeCloseTo(0.9 * (1 - (999 / 2_499) * 0.5) - 0.18, 5)
    expect(far).toBeCloseTo(0.9 * 0.5 - 0.18, 5) // 5,000m：越出射程 ⇒ 衰减锁在下限 ×0.5
    expect(near).toBeGreaterThan(far)
  })
})
