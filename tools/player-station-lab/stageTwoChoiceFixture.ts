import { stageTwoFixture } from './stageTwoFixture'
import { SECURITY_SHIPS } from './security-baseline'

/** 只通过自然培养寻找待答样本，不直接改随机种子、计数或奖励。 */
export function stageTwoChoiceFixture() {
  const session = stageTwoFixture()
  for (let attempt = 0; attempt < 40; attempt++) {
    const made = session.crewCommand({ kind: 'create', shipId: SECURITY_SHIPS[2].id, name: `值班舰员队${attempt + 1}` })
    if (!made.ok) throw new Error(`二择夹具组建失败：${made.reason}`)
    session.advance(30)
    const team = session.crew.teams[0]
    session.crewCommand({ kind: 'plan', teamId: team.id, course: attempt % 2 === 0 ? 'fire-control' : 'damage-control' })
    for (let tick = 0; tick < 72; tick++) {
      session.advance(10)
      if (team.pending) {
        session.crewCommand({ kind: 'pause', teamId: team.id })
        return session
      }
    }
    session.crewCommand({ kind: 'idle', teamId: team.id })
    session.crewCommand({ kind: 'disband', teamId: team.id })
  }
  throw new Error('自然培养样本未产生待答二择')
}
