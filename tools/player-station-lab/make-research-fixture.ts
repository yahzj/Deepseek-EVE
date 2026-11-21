/** 独立科研验收快照；只调用本模块命令，不读取正式或个人存档。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LabModel, importSnapshot } from './model'

const model = new LabModel()
assert(model.command({ kind: 'approve' }).ok)
assert(model.deliver(Object.fromEntries(model.view().bill.map(row => [row.itemId, row.remaining]))).ok)
model.advance(120)
for (const [facility, cellIndex, minutes] of [['power', 0, 45], ['life-support', 1, 60], ['service', 2, 30]] as const) {
  assert(model.command({ kind: 'build', facility, cellIndex }).ok)
  model.advance(minutes)
}
model.sourceKnown = true
assert(model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 3 }).ok)
model.advance(120)
assert(model.trainingCommand({ kind: 'enqueue', course: 'engineer' }).ok)
assert(model.trainingCommand({ kind: 'enqueue', course: 'researcher' }).ok)
model.advance(60)
assert(model.command({ kind: 'build', facility: 'refinery', cellIndex: 3 }).ok)
model.advance(60)
assert(model.command({ kind: 'build', facility: 'research', cellIndex: 4 }).ok)
model.advance(90)
assert.equal(model.populationView().residents, 3)
assert.equal(model.training.qualifications[1], 'researcher')
assert.equal(model.research.progressMs, 0)
assert.equal(model.research.assignment, undefined)
const snapshot = model.snapshot()
assert.equal(importSnapshot(snapshot).snapshot(), snapshot)
const output = fileURLToPath(new URL('../_ui-artifacts/player-station-lab/', import.meta.url))
mkdirSync(output, { recursive: true })
const filename = fileURLToPath(new URL('../_ui-artifacts/player-station-lab/research-preview.json', import.meta.url))
writeFileSync(filename, snapshot, 'utf8')
console.log(`已生成独立科研快照：${filename}`)
