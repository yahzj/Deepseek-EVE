/** 独立第二阶段验收场景；筹备/培养/行动全部使用正式模块命令，不读取个人档。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { stageTwoFixture } from './stageTwoFixture'
import { StageTwoSession } from './StageTwoSession'
import { SECURITY_SHIPS } from './security-baseline'
import { stageTwoChoiceFixture } from './stageTwoChoiceFixture'

const session = stageTwoFixture()
const directory = fileURLToPath(new URL('../_ui-artifacts/second-stage/', import.meta.url))
mkdirSync(directory, { recursive: true })
function save(name: string) {
  const snapshot = session.snapshot()
  assert.equal(StageTwoSession.load(snapshot).snapshot(), snapshot)
  writeFileSync(`${directory}/${name}.json`, snapshot, 'utf8')
}
save('stage-two-ready')
const made = session.crewCommand({ kind: 'create', name: '先锋舰员队', shipId: SECURITY_SHIPS[2].id })
assert(made.ok)
session.advance(30)
const id = session.crew.teams[0].id
assert(session.crewCommand({ kind: 'plan', teamId: id, course: 'fire-control' }).ok)
session.advance(120)
assert(session.crewCommand({ kind: 'idle', teamId: id }).ok)
save('stage-two-trained')
assert(session.securityCommand({ kind: 'start', missionKind: 'escort', teamIds: [id] }).ok)
session.advance(30)
for (const source of session.security.sources) {
  assert(session.securityCommand({ kind: 'start', missionKind: 'clear', sourceId: source.id, teamIds: [id] }).ok)
  session.advance(30)
  assert(source.cleared)
}
assert(session.securityCommand({ kind: 'guard', teamIds: [id] }).ok)
session.advance(30)
save('stage-two-before-independence')
assert(session.declare().ok)
save('stage-two-complete')
const choice = stageTwoChoiceFixture().snapshot()
assert.equal(StageTwoSession.load(choice).snapshot(), choice)
writeFileSync(`${directory}/stage-two-choice.json`, choice, 'utf8')
console.log(`已生成第二阶段独立验收快照：${directory}`)
