/**
 * 命中对照表（放宽武器命中口径时用；2026-09-10 二号建，C6 无人机命中调整配套）。
 *
 * 用法：npx tsx tools/hit-profile.ts
 *
 * 打印内容（口径 = 引擎 hitChance，与战斗同源）：
 * ① 我方无人机的放飞命中在**各距离 / 各中继配置**下的值（含 100% 上限截断与守方回避扣除）；
 * ② 炮台对照行（同船同技能），用于比对"距离衰减对无人机 vs 炮台"的不同手感；
 * ③ 我方 hitBonus / hitMul 明细（船体加成 × 瞄准集成）。
 *
 * 关键口径：命中 = clamp(0, 1, (hitRate + 攻方加成) × 距离衰减 − 守方回避)；
 * 距离衰减 df = 1 − t×(1−falloff)，**falloff = 1 → 恒为 1（不随距离衰减）**。
 * 所以"无衰减 + 中继天线延长射程带"= 射程带内命中恒定；"有衰减 + 拉长射程带"= 同距离命中上升。
 */
import { addShipToFleet, createInitialState, repairDeprecatedModules } from '@whale/core'
import { buildSimContext } from '@whale/data'
import { createFoeSpecs, createPlayerSpec, hitChance } from '../packages/core/src/combat'

const ctx = buildSimContext()
const SHIP = 'sh-sentinel'
const SKILLS: Record<string, number> = Object.fromEntries(
  ['gunnery', 'kinetic-gunnery', 'fire-control', 'reload-drills', 'drone-warfare', 'drone-servicing', 'targeting-integration'].map(
    (k) => [k, 5],
  ),
)
/** 参考卡：威胁 96 穹顶守卫（主敌回避 0.12，与多数卡同值） */
const REF_CARD = 'ano-vault-sentinel'
const DISTS = [500, 1500, 2500, 3500, 5000, 7000, 9000]
/** 中继天线倍率：无 / MK3×1（+80%）/ MK3×2（+160%） */
const RELAYS: Array<{ label: string; mult: number }> = [
  { label: '无中继', mult: 1 },
  { label: '中继MK3×1', mult: 1.8 },
  { label: '中继MK3×2', mult: 2.6 },
]
const DRONE_IDS = ['drone-scout', 'drone-assault', 'drone-heavy', 'drone-sentry'] as const

const state = createInitialState({ nowWallMs: 0, seed: 1 })
addShipToFleet(state, SHIP)
state.shipId = SHIP
for (const [k, v] of Object.entries(SKILLS)) state.skills.trained[k] = v
state.fleet[SHIP]!.fitted = {
  high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3', null, null],
  mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'],
  low: ['mod-stab-kin-2', 'mod-rof-2', 'mod-armor-kin-2'],
}
repairDeprecatedModules(state, ctx)
const me = createPlayerSpec(state, ctx, SHIP)!
console.log(`我方：hitBonus ${me.hitBonus.toFixed(3)}（船体加成 × 瞄准集成满级）、hitMul ${me.hitMul ?? 1}`)
const foe = createFoeSpecs(ctx.anomalies.get(REF_CARD)!, ctx.balance.battle)[0]!
console.log(`参考敌：${ctx.anomalies.get(REF_CARD)!.name}（威胁 ${ctx.anomalies.get(REF_CARD)!.threat}）回避 ${foe.evasion}`)

for (const id of DRONE_IDS) {
  const def = ctx.items.get(id)!
  const rate = def.hitRate ?? 0.6
  const falloff = def.falloff ?? 0.35
  for (const r of RELAYS) {
    const maxR = Math.round((def.maxRangeM ?? 2600) * r.mult)
    const cells: string[] = []
    for (const d of DISTS) {
      if (d > maxR) continue
      const h = hitChance(
        { hitRate: rate, minRangeM: 200, maxRangeM: maxR, falloff },
        me,
        foe,
        d,
        ctx.balance.battle,
      )
      cells.push(`${d}m ${(h * 100).toFixed(0)}%`)
    }
    const tag = falloff >= 1 ? '无衰减' : `衰减 ${falloff}`
    console.log(
      `${def.name}（命中 ${(rate * 100).toFixed(0)}%｜${tag}｜${r.label}：射程 200~${maxR}m）\t${cells.join('　')}`,
    )
  }
}

// 炮台对照（同船同技能；换成 6 门攻坚炮台 MK3 的命中档位）
const stateGun = createInitialState({ nowWallMs: 0, seed: 1 })
addShipToFleet(stateGun, SHIP)
stateGun.shipId = SHIP
for (const [k, v] of Object.entries(SKILLS)) stateGun.skills.trained[k] = v
stateGun.fleet[SHIP]!.fitted = { high: Array(6).fill('mod-turret-kin-3'), mid: [], low: [] }
repairDeprecatedModules(stateGun, ctx)
const gunSpec = createPlayerSpec(stateGun, ctx, SHIP)!
const w = gunSpec.weapons.find((x) => x.src === 'turret')!
console.log(
  `\n对照·攻坚炮台MK3（基础命中 ${w.hitRate.toFixed(2)}｜衰减 ${w.falloff}｜射程 ${w.minRangeM}~${w.maxRangeM}m）`,
)
const gunCells: string[] = []
for (const d of [1200, 2000, 3000, 5000, 7350]) {
  const h = hitChance(w, gunSpec, foe, d, ctx.balance.battle)
  gunCells.push(`${d}m ${(h * 100).toFixed(0)}%`)
}
console.log(gunCells.join('　'))
