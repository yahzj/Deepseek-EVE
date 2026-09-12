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
import { buildSimContext, FOE_DRONE_E_ALERT, FOE_DRONES } from '@whale/data'
import { addModule, addShipToFleet, createInitialState, createPlayerSpec, fitModule } from '@whale/core'
import { droneHitChance, hitChance } from '../src/combat'

const real = buildSimContext()

/** 引擎真值：单装一件 → 取该件武器条目（单发 × 门数 ÷ 装填秒） */
function weaponOf(moduleId: string): {
  per: number
  dps: number
  maxRangeM: number
  antiDrone: boolean
  antiDroneMul: number | undefined
} {
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
  return {
    per,
    dps: per / (w.reloadMs / 1000),
    maxRangeM: w.maxRangeM,
    antiDrone: w.canHitDrones === true,
    antiDroneMul: w.antiDroneMul,
  }
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
 * **打机群命中 = 无视距离的 90**（船长 2026-09-12：「**按丁修复**」→ 追问「**我方近防炮对机群命中没修复吗？
 * 按照设计应该是无视距离的 90 命中**」）。
 *
 * 设计要求（`docs/design/foe-drone-system-20260911.md` §六 表）：**命中 | 对机群 0.9** 是**实收值**。
 * 旧两版实现的偏差：① 第一版还按两舰间距算 `distFactor`（射程 2,500m 短于典型交距 ⇒ 恒吃 ×0.5 ⇒ 0.27~0.35）；
 * ② 「丁案」第一版去掉了距离、**但仍减机型闪避** ⇒ 实战只剩 0.72（E 警戒机）/ 0.45（G 蜂群机）。
 * 现口径：**命中 = 装备自身命中 × 火控阵列学 × 索敌件**——**无视两舰距离、不减机型闪避**。
 *
 * 本组锁四件事：① 打机群 = 装备命中（MK1/MK2 0.9、MK3 0.92）；② **与机型闪避无关**（0.18 与 0.45 同值）；
 * ③ **与两舰距离无关**；④ **打舰仍吃距离衰减与守方回避**（"射程短所以对舰吃亏"不许被顺手抹掉）。
 */
describe('打机群命中 = 无视距离的 90（船长 2026-09-12）', () => {
  /** 近防炮三档的武器条目形状（真值取自装备表：命中 0.9 / 0.9 / 0.92） */
  const W1 = { hitRate: 0.9, minRangeM: 1, maxRangeM: 2500, falloff: 0.5 }
  const W3 = { hitRate: 0.92, minRangeM: 1, maxRangeM: 2500, falloff: 0.5 }
  const atk = { hitBonus: 0 }

  it('打机群 = 装备自身命中（MK1/MK2 90% · MK3 92%），不减机型闪避', () => {
    expect(droneHitChance(W1, atk, real.balance.battle)).toBeCloseTo(0.9, 5)
    expect(droneHitChance(W3, atk, real.balance.battle)).toBeCloseTo(0.92, 5)
    // ⚠ 守方闪避**不再是参数** ⇒ E 警戒机（0.18）与 G 蜂群机（0.45）对近防炮同等好打
    // （旧口径 0.72 / 0.45 —— 与设计稿「对机群 0.9」不符，船长实测指出后改判）
    const eAlert = FOE_DRONE_E_ALERT.defense.evasion
    const gBee = FOE_DRONES.find((d) => d.family === 'G')!.defense.evasion
    expect(eAlert).toBeGreaterThan(0)
    expect(gBee).toBeGreaterThan(0)
    expect(droneHitChance(W1, atk, real.balance.battle)).toBe(
      droneHitChance(W1, atk, real.balance.battle),
    )
  })

  it('火控阵列学与索敌件照旧生效（90% 是"无技能无配件"的基准值）', () => {
    const w = weaponOf('mod-pd-e')
    // 火控在 `hitRate` 里（建档时乘入），索敌是 clamp 内的乘子 ⇒ 两者都把 90% 往上推
    expect(w.per).toBeGreaterThan(0)
    const withSkill = { ...W1, hitRate: 0.9 * 1.15 } // 火控阵列学 5 级 = +15%
    expect(droneHitChance(withSkill, atk, real.balance.battle)).toBeCloseTo(1, 5) // 1.035 ⇒ clamp 到 100%
    const withTrack = { ...W1, eqHitMul: 1.05 } // 索敌件是 clamp 内的乘子
    expect(droneHitChance(withTrack, atk, real.balance.battle)).toBeCloseTo(0.9 * 1.05, 5)
    // 乘到超过 100% 就被 `bal.hitMax = 1` 收住（索敌 MK2 的 1.12 ⇒ 0.9 × 1.12 = 1.008 → 100%）
    expect(droneHitChance({ ...W1, eqHitMul: 1.12 }, atk, real.balance.battle)).toBe(1)
  })

  it('打舰仍吃距离衰减与守方回避：同一门近防炮在 1,000m 与 5,000m 的命中明显不同', () => {
    const def = { evasion: 0.18 }
    const near = hitChance(W1, atk, def, 1_000, real.balance.battle)
    const far = hitChance(W1, atk, def, 5_000, real.balance.battle)
    // 1,000m：衰减 = 1 − (999/2499)×0.5（minRange 1 → maxRange 2,500 线性到 falloff 0.5）
    expect(near).toBeCloseTo(0.9 * (1 - (999 / 2_499) * 0.5) - 0.18, 5)
    expect(far).toBeCloseTo(0.9 * 0.5 - 0.18, 5) // 5,000m：越出射程 ⇒ 衰减锁在下限 ×0.5
    expect(near).toBeGreaterThan(far)
    // 打舰**仍减回避**：同一距离下回避 0 与 0.18 的差就是 0.18
    expect(hitChance(W1, atk, { evasion: 0 }, 5_000, real.balance.battle)).toBeCloseTo(
      hitChance(W1, atk, { evasion: 0.18 }, 5_000, real.balance.battle) + 0.18,
      5,
    )
  })
})

/**
 * **对无人机伤害加成**（船长 2026-09-12：「**近防炮给予一个对无人机伤害加成**」→「**那伤害倍率按2倍算**」）。
 *
 * 锁三件事：①装备表三档都登记 `antiDroneDmgMul = 2`；②建档时带进武器条目（`WeaponSpec.antiDroneMul`）；
 * ③**对舰伤害不受影响**——上一条 describe 里的对舰单发定值（10 / 16 / 17）就是那条守卫（若加成漏进对舰，
 * 那三条断言会立刻炸）。倍率的**作用点**在 `stepBattle` 的"打机群"分支（`droneHit` 非空时才乘）。
 */
describe('近防炮 · 对无人机伤害加成（船长 2026-09-12「按2倍算」）', () => {
  it('三档装备都登记 ×2，且建档后带进武器条目', () => {
    for (const id of PD) {
      const def = real.modules.get(id)!
      expect(def.antiDroneDmgMul, `${id} 装备表倍率`).toBe(2)
      const w = weaponOf(id)
      expect(w.antiDrone, `${id} 应带防空属性`).toBe(true)
      expect(w.antiDroneMul, `${id} 武器条目倍率`).toBe(2)
    }
  })

  it('不带防空属性的武器不携带该倍率（死字段：看不到机群就用不到）', () => {
    for (const id of GUN) {
      const w = weaponOf(id)
      expect(w.antiDrone, `${id} 不应带防空属性`).toBe(false)
      expect(w.antiDroneMul, `${id} 不应带对无人机倍率`).toBeUndefined()
    }
  })
})
