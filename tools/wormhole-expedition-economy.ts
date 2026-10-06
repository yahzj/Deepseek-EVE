/** 真实旅程实收经济：输入本批合成400趟轨迹，现算物资与战利品基础/拆解估值，不改价或读个人档。
 * 用法：先npm run wormhole:journey及--baseline，再npx tsx tools/wormhole-expedition-economy.ts。
 * 输出tools/_ui-artifacts/wormhole-economy.json；游戏v0.1.0 / 档v31，2026-10-06。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { wormholeLootValueIsk } from '../packages/core/src/wormholeSalvage'
import { wormholeLayerRewardMul } from '../packages/core/src/wormholeFoes'

const ctx = buildSimContext()
const reports: object[] = []
for (const grade of ['challenge', 'baseline']) {
  const rows = JSON.parse(readFileSync(resolve(`tools/_ui-artifacts/wormhole-journey-${grade}.json`), 'utf8')) as Array<{ fleet: string; policy: string; guardClearedDepth: number; settlement?: { oreIsk: number; wreckIsk: number; boxes: string[]; suppliesReturned?: Record<string, number>; suppliesUsed?: Record<string, number>; suppliesFound?: Record<string, number> }; configuration: { manifest: Record<string, number> } }>
  for (const fleet of ['guns', 'drones', 'cargo', 'mixed']) for (const policy of ['deep', 'recovery']) {
    const list = rows.filter(r => r.fleet === fleet && r.policy === policy)
    const average = (fn: (row: typeof rows[number]) => number) => list.reduce((sum, row) => sum + fn(row), 0) / list.length
    const value = (items?: Record<string, number>) => Object.entries(items ?? {}).reduce((sum, [id, n]) => sum + wormholeLootValueIsk(ctx, id, n), 0)
    const report = { grade, fleet, policy, trips: list.length, cleared10: list.filter(r => r.guardClearedDepth >= 10).length,
      carriedReference: average(r => value(r.configuration.manifest)), returnedReference: average(r => value(r.settlement?.suppliesReturned)), consumedReference: average(r => value(r.settlement?.suppliesUsed)), foundReference: average(r => value(r.settlement?.suppliesFound)),
      realizedLootReference: average(r => (r.settlement?.oreIsk ?? 0) + (r.settlement?.wreckIsk ?? 0)), containerCount: average(r => r.settlement?.boxes.length ?? 0),
    }
    reports.push(report)
    console.log(JSON.stringify(report))
  }
}
const curve = [1, 4, 7, 10].map(depth => ({ depth, oldOrdinaryResourceScale: wormholeLayerRewardMul(depth), newOrdinaryResourceScale: wormholeLayerRewardMul(depth, 2) }))
writeFileSync(resolve('tools/_ui-artifacts/wormhole-economy.json'), JSON.stringify({ reports, curve, boundary: 'Carry returns and found supplies are not loot income. Containers count separately, unopened contents have no realized income.' }, null, 2), 'utf8')
console.table(curve)
