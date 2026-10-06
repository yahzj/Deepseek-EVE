/** 新虫洞完整旅程读数。只建合成状态，不读个人档。
 * 游戏v0.1.0 / 档v31；2026-10-05。用法：npx tsx tools/wormhole-expedition-journey.ts [--quick] [--baseline]。
 * 配置在wormhole-expedition-fixture.ts冻结；未达十层也保留失败报告，不改敌或途中补料。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serializeSaveFile, loadSaveFile } from '../packages/core/src/save'
import { wormholeLeave, wormholeResume } from '../packages/core/src/wormhole'
import { wormholeRunExpeditionPolicy } from '../packages/core/src/wormholeExpeditionPolicy'
import { EXPEDITION_FLEETS, expeditionContext as ctx, makeExpeditionFixture } from './wormhole-expedition-fixture'
import type { WormholeFamily } from '../packages/core/src/state'

const quick = process.argv.includes('--quick')
const baseline = process.argv.includes('--baseline')
const heavy = process.argv.includes('--heavy')
const rows: object[] = []
for (const family of ['A', 'C', 'D', 'E', 'G'] as WormholeFamily[]) for (const fleet of heavy ? ['heavy'] as const : quick ? ['drones'] as const : EXPEDITION_FLEETS) for (const seed of quick ? [19] : [19, 61, 107, 211, 421]) for (const policy of quick ? ['deep'] as const : ['deep', 'recovery'] as const) {
  const fixture = makeExpeditionFixture(family, seed, fleet, baseline)
  const result = wormholeRunExpeditionPolicy(fixture.state, ctx, {
    policy,
    checkpoint(state) {
      wormholeLeave(state)
      const saved = loadSaveFile(serializeSaveFile(loadSaveFile(serializeSaveFile(state, 0)).state, 0)).state
      if (!wormholeResume(saved, ctx).ok) throw new Error('checkpoint-resume-failed')
      return saved
    },
  })
  const { state, ...report } = result
  const row = { family, fleet, seed, policy, baseline, ...report, configuration: { definitions: fixture.definitions, manifest: fixture.manifest, skills: fixture.skills, research: fixture.research }, settlement: state.wormhole.lastSettle }
  rows.push(row)
  console.log(JSON.stringify({ family, fleet, seed, policy, depth: result.reachedDepth, guard: result.guardClearedDepth, extracted: result.extracted, failure: result.failure, battles: result.battles }))
}
const directory = resolve('tools/_ui-artifacts')
mkdirSync(directory, { recursive: true })
writeFileSync(resolve(directory, `wormhole-journey-${baseline ? 'baseline' : 'challenge'}${heavy ? '-heavy' : ''}${quick ? '-quick' : ''}.json`), JSON.stringify(rows, null, 2), 'utf8')
console.log(`完成 ${rows.length} 趟真实旅程，未跳层、未清敌、未途中补给。`)
