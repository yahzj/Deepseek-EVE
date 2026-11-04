/** 逐卡导出新旧编成血量和基础峰值DPS；不运行战斗、不改玩法、不读取个人档。
 * node --import tsx tools/enemy-formation-report.ts
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { activeFoeSpecsOf, foeStrengthOf } from '../packages/core/src/combat/foes/catalog'
import { nominalWeaponDps } from '../packages/core/src/combat/foes/tactics'
import { applyFoeOverride, wormholeDerivedAnomaly } from '../packages/core/src/combat/cards'
import { lairAnomalyOf, lairNameOf, lairLevelOf } from '../packages/core/src/lairs'
import { WEEKEND_AMBUSH_STRENGTH_MUL, WEEKEND_FLAGSHIP_POOL_HP, weekendFlagshipLayerCaps, weekendFlagshipSlotOf } from '../packages/core/src/weekendEvent'
import { WORMHOLE_FAMILY_CARDS, WORMHOLE_FAMILY_ORDER, WORMHOLE_TIER_UNLOCK_DEPTH, wormholeGuardCardOf, wormholeTierOfCard } from '../packages/core/src/wormholeFoes'
import type { AnomalyDef, FoeSupportBranch } from '../packages/core/src/types'

const ctx = buildSimContext()
const bal = ctx.balance.battle
const output = resolve('docs/design/enemy-fleet-comparison-20261031.md')
type Strength = { hp: number; dps: number; x: number }
type CalibrationRow = { id: string; tier?: 1 | 2 | 3; depth?: number; kind?: 'node' | 'boss' | 'ruins'; before: Strength; after: Strength }
const saved = JSON.parse(readFileSync(resolve('tools/_ui-artifacts/enemy-formation-20261031/report.json'), 'utf8')) as { staticRows: CalibrationRow[] }
assert.equal(saved.staticRows.length, 328)
let verified = 0
let branchRows = 0
let reserveUnits = 0
const number = (value: number): string => value.toLocaleString('en-US', { maximumFractionDigits: 2 })
const pct = (old: number, current: number): string => old === current ? '0%' : `${current > old ? '+' : ''}${((current / old - 1) * 100).toFixed(1)}%`
function measure(card: AnomalyDef, branch?: FoeSupportBranch) {
  const waves = [...new Set((card.ships ?? []).map(slot => slot.wave ?? 0))].sort((a, b) => a - b)
  let hp = 0, dps = 0
  const counts: number[] = []
  for (const wave of waves) {
    const specs = activeFoeSpecsOf(card, bal, wave).filter(spec => !spec.foeReinforceBranch || spec.foeReinforceBranch === branch)
    counts.push(specs.length)
    hp += specs.reduce((sum, spec) => sum + spec.hp.s + spec.hp.a + spec.hp.h, 0)
    dps = Math.max(dps, specs.reduce((sum, spec) => sum + spec.weapons.filter(weapon => !weapon.reserve).reduce((damage, weapon) => damage + nominalWeaponDps(weapon), 0), 0))
    reserveUnits += specs.reduce((sum, spec) => sum + spec.weapons.filter(weapon => weapon.reserve).length, 0)
  }
  return { hp, dps, counts: counts.join('/') }
}
function assertCalibration(row: CalibrationRow, old: AnomalyDef, current: AnomalyDef): void {
  for (const [card, expected] of [[old, row.before], [current, row.after]] as const) {
    const actual = foeStrengthOf(card, bal)
    assert(Math.abs(actual.hp - expected.hp) < .00001 && Math.abs(actual.dps - expected.dps) < .00001, `校准报告与当前代码不符:${row.id}/${row.tier ?? row.depth ?? ''}/${row.kind ?? ''}`)
  }
  verified++
}
const header = '| 目标 | 旧→新舰数（逐波） | 旧总血量 | 新总血量 | 血量变化 | 旧DPS | 新DPS | 输出变化 |'
const divider = '|---|---|---:|---:|---:|---:|---:|---:|'
function rows(name: string, old: AnomalyDef, current: AnomalyDef): string[] {
  const branched = [...old.ships ?? [], ...current.ships ?? []].some(slot => slot.enterBranch)
  const branches: Array<FoeSupportBranch | undefined> = branched ? ['inside', 'outside'] : [undefined]
  return branches.map(branch => {
    const before = measure(old, branch), after = measure(current, branch)
    assert(after.hp >= before.hp && after.dps >= before.dps, `强度下降:${old.id}/${branch ?? ''}`)
    if (branch) branchRows++
    const label = `${name}${branch ? branch === 'inside' ? ' · 近距支援分支' : ' · 远距支援分支' : ''}`
    return `| ${label} | ${before.counts} → ${after.counts} | ${number(before.hp)} | ${number(after.hp)} | ${pct(before.hp, after.hp)} | ${number(before.dps)} | ${number(after.dps)} | ${pct(before.dps, after.dps)} |`
  })
}
const lines = [
  '# 敌卡新旧血量与输出逐卡对照', '',
  '> 二号工作区 `H:\\大鲸鱼\\Deepseek-EVE-d2`，2026-10-31。由 `tools/enemy-formation-report.ts` 生成，328组校准记录逐行与当前代码交叉核对。', '',
  '旧值是本轮调整前的实战建档规格，包含原有多舰补偿、族格加血和DPS折扣；新值是本轮扩编后的规格。数值不随玩家出战舰数变化。', '',
  '- 总血量：各波舰体护盾、装甲、结构之和，不是单舰血量，不含机群血量。',
  '- DPS：各波基础名义DPS取最高一波，含舰炮和常备机群，备用机不计当前火力。没有把先后波次的火力相加。',
  '- 原始校准JSON的定价读数包含备用机并汇总互斥候选；本表排除备用机、拆开互斥分支，因此部分DPS与原始JSON不同，新旧两侧采用相同统计口径。',
  '- DPS未折算命中、距离衰减、玩家抗性、近防、酸爆、连发周期、叠光/聚焦、治疗、孵化和复活等实战效果，不等于战报实伤。',
  '- 舰数中的 `/` 表示先后波次；王庭支援互斥，按两条实际分支分别列出，包含支援入场后舰体。',
  '- 表内显示最多2位小数，百分比按未四舍五入的原值计算。',
  '- 主动入侵表先列卡面血量，后另列4张旗舰使用满额30万共享血池的整场总量。', '',
  '## 常驻悬赏（23张）', '', header, divider,
]
const baseRows = saved.staticRows.filter(row => !row.tier && !row.depth)
const byOldThreat = (a: CalibrationRow, b: CalibrationRow) => ctx.anomalies.get(a.id)!.foeFormation!.baseline.threat - ctx.anomalies.get(b.id)!.foeFormation!.baseline.threat
for (const row of baseRows.filter(row => row.id.startsWith('ano-')).sort(byOldThreat)) {
  const current = ctx.anomalies.get(row.id)!, old = current.foeFormation!.baseline
  assertCalibration(row, old, current)
  lines.push(...rows(`${current.name} · \`${row.id}\``, old, current))
}
lines.push('', '## 主动入侵（16张，卡面值）', '', '旗舰本节使用卡面血量；真实满池挑战见下一表。', '', header, divider)
for (const family of ['ink-', 'corona-', 'alien-', 'gravekeeper-']) for (const row of baseRows.filter(row => row.id.startsWith(family))) {
  const current = ctx.anomalies.get(row.id)!, old = current.foeFormation!.baseline
  assertCalibration(row, old, current)
  lines.push(...rows(`${current.name} · \`${row.id}\``, old, current))
}
lines.push('', '## 旗舰满共享池（4张）', '', '两侧旗舰本体都覆写为300,000血；下表总血量还包含整场其他波次与护航舰。共享血池有损时，整场总血量相应减少，基础DPS不随池内剩余血量改变。', '', header, divider)
for (const id of ['ink-flagship', 'corona-nexus', 'alien-broodmother', 'gravekeeper-flagship']) {
  const current = ctx.anomalies.get(id)!, old = current.foeFormation!.baseline
  const boss = weekendFlagshipSlotOf(current)!
  const cap = weekendFlagshipLayerCaps(WEEKEND_FLAGSHIP_POOL_HP, boss.ship.split)
  const override = { bossShipId: boss.ship.id, bossHp: WEEKEND_FLAGSHIP_POOL_HP, bossHpLayers: cap }
  lines.push(...rows(current.name, applyFoeOverride(old, override), applyFoeOverride(current, override)))
}
lines.push('', '## 被动入侵巡游（12张）', '', '只列实际巡游候选的前三档，保持旧编成和0.75强度；旗舰不进入被动巡游池。', '', header, divider)
for (const row of baseRows.filter(row => !row.id.startsWith('ano-') && !row.id.startsWith('enc-'))) {
  const current = ctx.anomalies.get(row.id)!
  if (weekendFlagshipSlotOf(current)) continue
  const old = current.foeFormation!.baseline
  lines.push(...rows(current.name, applyFoeOverride(old, { strengthMul: WEEKEND_AMBUSH_STRENGTH_MUL }),
    applyFoeOverride(current, { strengthMul: WEEKEND_AMBUSH_STRENGTH_MUL, patrolFormation: true })))
}
lines.push('', '## 低安被动遭遇（4张）', '', header, divider)
for (const row of baseRows.filter(row => row.id.startsWith('enc-'))) {
  const current = ctx.anomalies.get(row.id)!, old = current.foeFormation!.baseline
  assertCalibration(row, old, current)
  lines.push(...rows(`${current.name} · \`${row.id}\``, old, current))
}
lines.push('', '## 每日赏金窝点（20张主题卡，各3档）', '', '“不派发”行仅保留参数核对；实际日板档位仍受该地图上限约束。卡名使用实际窝点名称。', '')
for (const tier of [1, 2, 3] as const) {
  lines.push(`### ${['外围', '核心', '深层'][tier - 1]}`, '', header, divider)
  for (const row of saved.staticRows.filter(row => row.tier === tier).sort(byOldThreat)) {
    const base = ctx.anomalies.get(row.id)!
    const old = lairAnomalyOf(base.foeFormation!.baseline, tier, bal, 0)
    const current = lairAnomalyOf(base, tier, bal, 1, ctx.foeShips)
    assertCalibration(row, old, current)
    lines.push(...rows(`${lairNameOf(base, tier)}${tier > lairLevelOf(base) ? '（该地图不派发此档）' : ''}`, old, current))
  }
  lines.push('')
}
lines.push('## 信号空间（五族15卡）', '',
  '按第1、2、4、7、10层分别列出节点、层末守卫、遗迹守军；未入池组合明确标记，仅供参数核对。层末守卫只使用该族本层已解锁的最深档卡，其余组合仅供参数核对。第1层没有遗迹。', '',
  '原始校准报告对王庭采用全部候选条目汇总；本表改按“本体 + 实际到场的一支”列出两行，因此王庭总量与原始JSON的全候选汇总不同。', '')
for (const depth of [1, 2, 4, 7, 10]) for (const kind of ['node', 'boss', 'ruins'] as const) {
  lines.push(`### 第${depth}层 · ${kind === 'node' ? '普通节点' : kind === 'boss' ? '层末守卫' : '遗迹守军'}${depth === 1 && kind === 'ruins' ? '（本层无遗迹，仅参数核对）' : ''}`, '', header, divider)
  for (const row of saved.staticRows.filter(row => row.depth === depth && row.kind === kind)) {
    const base = ctx.anomalies.get(row.id)!, args = { depth, kind, waves: 1 }
    const old = wormholeDerivedAnomaly(ctx, base, args, 0), current = wormholeDerivedAnomaly(ctx, base, args, 1)
    assertCalibration(row, old, current)
    const unlock = WORMHOLE_TIER_UNLOCK_DEPTH[wormholeTierOfCard(row.id)!]
    const family = WORMHOLE_FAMILY_ORDER.find(f => Object.values(WORMHOLE_FAMILY_CARDS[f]).includes(row.id))
    assert(family, `信号卡未登记族:${row.id}`)
    const availability = depth < unlock ? '（尚未入池，仅参数核对）'
      : kind === 'boss' && wormholeGuardCardOf(family, depth) !== row.id ? '（该层守卫不抽此卡，仅参数核对）' : ''
    lines.push(...rows(`${base.name}${availability}`, old, current))
  }
  lines.push('')
}
assert.equal(verified, 328)
lines.push('## 复核记录', '',
  `- 与最终校准报告交叉核对：${verified}/328组一致。`,
  `- 互斥支援实际分支：${branchRows}行分别列出。`,
  `- 统计到的备用机武器条目：${reserveUnits}；均不计当前在场DPS。`,
  '- 本次仅导出数据，没有修改敌卡、强度公式、奖励或个人档。', '')
writeFileSync(output, lines.join('\n'), 'utf8')
console.log(JSON.stringify({ output, verified, branchRows, reserveUnits, lines: lines.length }))
