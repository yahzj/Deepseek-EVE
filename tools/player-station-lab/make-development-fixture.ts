/** 完整经营验收快照及成本读数；只使用合成新状态，不读取个人档。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEVELOPMENT_RULES, PLAYER_FACILITIES } from '../../packages/core/src/playerStation/index'
import { developmentFixture } from './development-fixture'
import { importSnapshot, materialInfo } from './model'

const model = developmentFixture()
const directory = fileURLToPath(new URL('../_ui-artifacts/player-station-lab/', import.meta.url))
mkdirSync(directory, { recursive: true })
const ready = model.snapshot()
assert.equal(importSnapshot(ready).snapshot(), ready)
writeFileSync(`${directory}/development-ready.json`, ready, 'utf8')
assert(model.developmentCommand({ kind: 'expand' }).ok); model.advance(240)
assert(model.developmentCommand({ kind: 'power-upgrade', cellIndex: 0 }).ok); model.advance(60)
assert(model.developmentCommand({ kind: 'life-upgrade', cellIndex: 1 }).ok); model.advance(90)
for (const [facility, cellIndex, minutes] of [['manufacturing', 9, 90], ['training', 10, 90], ['warning', 11, 60]] as const) {
  assert(model.command({ kind: 'build', facility, cellIndex }).ok); model.advance(minutes)
}
const completed = model.snapshot()
assert.equal(importSnapshot(completed).snapshot(), completed)
writeFileSync(`${directory}/development-built.json`, completed, 'utf8')
const costs = [
  ...Object.entries(DEVELOPMENT_RULES).map(([id, rule]) => ({ id, ...rule })),
  ...(['manufacturing', 'training', 'warning'] as const).map(id => ({ id, ...PLAYER_FACILITIES[id] })),
].map(rule => ({ id: rule.id, minutes: rule.durationMs / 60_000,
  value: Object.entries(rule.bill).reduce((sum, [id, n]) => sum + materialInfo(id).price * n, 0),
  volumeM3: Object.entries(rule.bill).reduce((sum, [id, n]) => sum + materialInfo(id).unitM3 * n, 0), bill: rule.bill }))
writeFileSync(`${directory}/development-costs.json`, JSON.stringify(costs, null, 2), 'utf8')
console.log(JSON.stringify(costs.map(({ bill: _bill, ...row }) => row)))
console.log(`已生成完整经营快照：${directory}`)
