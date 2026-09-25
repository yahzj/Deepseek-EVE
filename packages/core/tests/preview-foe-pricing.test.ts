/**
 * **预估口径：敌血 = 卡面属性建档 · 敌方火力 = 各波取最大**（船长 2026-09-25 两令：「改」+「按"各波取最大"改」）。
 *
 * 背景：`combat.steadyPreview`（带伤预警 / `bountyWinPercentGuarded` / AI 门槛 的共同输入）原先两侧都按
 * **威胁曲线**走，而舰级路径（写了 `ships[]`）的真实战斗是**绝对值建档**：
 * - **血**：`foeHpOfThreat(威胁)` vs `ship.hp × hpMul`——穹顶守卫 真 5,729 vs 曲线价 F(110)=1,435（×3.99）
 *   ⇒ 预估系统性偏乐观，且**动威胁标签就会牵动这些显示读数**；
 * - **火力**：`createFoeSpecsFromShips` 忽略 `units`、按 `tagPrefix` 取波（缺省 = 波 0）⇒ 多波卡只按
 *   **波 0** 算（噬口猎杀令：波 0 = 10.0 DPS vs 头目波 107.8 DPS，差 ×10.78）。
 *
 * 本文件钉两条，都用**合成卡**隔离变量（旧口径下这两条都会红）：
 * ① 血：同一张舰级路径卡，只改 `hpMul` ⇒ 预计损耗**必须随真实总血变**（旧口径两者相同）；
 * ② 火力：把"火力最大的那一波"放在**末波** ⇒ 预计损耗必须**高于**同血同波 0、但末波无火力的版本
 *    （旧口径只看波 0 ⇒ 两者相同）。
 *
 * ⚠ 距离口径**故意不跟着改**：`foes` 仍取波 0 编制（实战的开战距离就由波 0 首个主体单位决定）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addWare } from '../src/inventory'
import { addShipToFleet } from '../src/shipyard'
import { createInitialState } from '../src/state'
import type { AnomalyDef, FoeShipDef, ShipDef } from '../src/types'
import type { GameState } from '../src/state'
import { bountyDamageForecast } from '../src/combat'
import { anomaly } from './helpers'

const ctx = buildSimContext()
const SHIP: ShipDef['id'] = 'sh-whiteshark'

/** 探针敌舰：只关心血与单发（射程够远 ⇒ 距离不是变量） */
function probeShip(id: string, hp: number, shotDmg: number): FoeShipDef {
  return {
    id,
    name: id,
    family: 'A',
    hullClassTier: 1,
    speedRatio: 1,
    hp,
    split: { s: 0.2, a: 0.55, h: 0.25 },
    shotDmg,
    hitRate: 1,
    reloadMs: 4_000, // 与实战敌舰同档（`battle.foeReloadMs`）——写 1000 会让合成卡射速 ×4、两侧直接打满
    rangeMinM: 1,
    rangeMaxM: 30_000,
    falloff: 1,
    dmgMix: { kinetic: 8, explosive: 2 },
    tactic: 'orbit',
  }
}

function world(): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 3 })
  const u = addShipToFleet(s, SHIP)
  s.shipId = u
  s.fleet[u]!.fitted = { high: ['mod-turret-kin-3'], mid: [], low: [] }
  addWare(s, 'ammo-kinetic-l', 5_000)
  return s
}

const lossSum = (card: AnomalyDef): number => {
  const f = bountyDamageForecast(world(), ctx, card, SHIP)
  return f.armorLoss + f.hullLoss
}

describe('预估口径：敌血按属性建档 · 火力取各波最大（船长 2026-09-25）', () => {
  it('① 敌血：同一张舰级路径卡，只改 `hpMul` ⇒ 预计损耗随真实总血变', () => {
    // 参数由探针扫出（两侧都落在不饱和区间：×3 ⇒ 0.37 · ×4 ⇒ 1.12）
    const ship = probeShip('t-pv-hp', 300, 6)
    const mk = (hpMul: number): AnomalyDef => ({
      ...anomaly(`ano-pv-hp-${hpMul}`, 'galaxy-hub', { threat: 40 }),
      ships: [{ ship, count: 1, hpMul }],
    })
    const light = lossSum(mk(3))
    const heavy = lossSum(mk(4))
    // 血更多 ⇒ 打得更久 ⇒ 承伤更多（旧口径两侧都按 F(40)=222 定价 ⇒ 本条会红）
    expect(heavy).toBeGreaterThan(light)
    expect(light).toBeGreaterThan(0) // 轻的那版也确有损耗（不是两侧都为 0 的假绿）
  })

  it('② 敌方火力：火力最大的那一波在**末波** ⇒ 预计损耗高于"末波无火力"的同血版本', () => {
    /** ⚠ 两侧的**峰值波单位数必须相同**（都 = 2）——否则减员修正 `(N+1)/(2N)` 会跟着变，
     *  用例就分不清"换了哪一波"还是"换了单位数"（第一次写时正是这个坑）。 */
    const weak = probeShip('t-pv-weak', 150, 4)
    const boss = probeShip('t-pv-boss', 150, 12) // = 弱 ×3
    const waves = [
      { units: 2, hpShare: 1 },
      { units: 2, hpShare: 1 },
    ]
    /** A：波 0 = 弱 ×2、波 1 = **强 ×2**（火力最大的那波在末波） */
    const withBoss: AnomalyDef = {
      ...anomaly('ano-pv-boss-on', 'galaxy-hub', { threat: 40 }),
      ships: [
        { ship: weak, count: 2, wave: 0 },
        { ship: boss, count: 2, wave: 1 },
      ],
      waves,
    }
    /** B：同血、同编制、同单位数，但末波那两艘**无火力**（`dmgMul: 0` ⇒ 单发落到下限 1） */
    const withoutBossFire: AnomalyDef = {
      ...anomaly('ano-pv-boss-off', 'galaxy-hub', { threat: 40 }),
      ships: [
        { ship: weak, count: 2, wave: 0 },
        { ship: boss, count: 2, wave: 1, dmgMul: 0 },
      ],
      waves,
    }
    // A 与 B 的血量、编制、单位数**逐项相同**，唯一差别是"末波火力" ⇒ 损耗差只能来自
    // 「火力取各波最大」（旧口径只看波 0 ⇒ 两侧相等，本条会红）
    expect(lossSum(withBoss)).toBeGreaterThan(lossSum(withoutBossFire))
  })
})
