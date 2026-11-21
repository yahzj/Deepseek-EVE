import { STATION_RESEARCH_CATALOG } from '../../packages/core/src/playerStation/index'
import { LabModel } from './model'

/** 仅使用独立模块正常命令建立经营验收场景，不接触正式游戏或个人档。 */
export function developmentFixture() {
  const model = new LabModel()
  const check = (result: { ok: boolean; reason?: string }) => { if (!result.ok) throw new Error(`经营夹具失败：${result.reason}`) }
  check(model.command({ kind: 'approve' }))
  check(model.deliver(Object.fromEntries(model.view().bill.map(row => [row.itemId, row.remaining])))); model.advance(120)
  for (const [facility, cellIndex, minutes] of [['power', 0, 45], ['life-support', 1, 60], ['service', 2, 30]] as const) {
    check(model.command({ kind: 'build', facility, cellIndex })); model.advance(minutes)
  }
  model.sourceKnown = true
  check(model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 6 })); model.advance(120)
  for (const course of ['engineer', 'researcher', 'engineer'] as const) check(model.trainingCommand({ kind: 'enqueue', course }))
  model.advance(90)
  check(model.command({ kind: 'build', facility: 'refinery', cellIndex: 3 })); model.advance(60)
  check(model.command({ kind: 'build', facility: 'research', cellIndex: 4 })); model.advance(90)
  check(model.researchCommand({ kind: 'assign', cellIndex: 4, personIndex: 1 }))
  for (const project of STATION_RESEARCH_CATALOG.slice(1)) check(model.researchCommand({ kind: 'enqueue', projectId: project.id }))
  model.advance(STATION_RESEARCH_CATALOG.reduce((sum, project) => sum + project.durationMs / 60_000, 0))
  return model
}
