import { describe, expect, it, vi } from 'vitest'
import { StageTwoSession } from './StageTwoSession'
import { stageTwoFixture } from './stageTwoFixture'
import { SECURITY_SHIPS } from './security-baseline'
import { stageTwoChoiceFixture } from './stageTwoChoiceFixture'

function crewed() {
  const session = stageTwoFixture()
  const result = session.crewCommand({ kind: 'create', shipId: SECURITY_SHIPS[2].id, name: '三号舰员队' })
  expect(result.ok).toBe(true)
  session.advance(30)
  expect(session.crew.teams[0].activity).toBe('idle')
  return session
}

describe('第二阶段组合宿主', () => {
  it('成员来自原普通居民，永久占用直至解散，不与生产课程双用', () => {
    const session = crewed(), team = session.crew.teams[0], base = session.base
    expect(team.members).toEqual([3, 4, 5]); expect(base.populationView().residents).toBe(6)
    expect(base.refiningCommand({ kind: 'assign', cellIndex: 3, personIndex: 3, itemId: 'ore-veldspar' }).ok).toBe(false)
    expect(base.academyCommand({ kind: 'assign', cellIndex: 10, personIndex: 4, course: 'engineer' }).ok).toBe(false)
    expect(session.crewCommand({ kind: 'disband', teamId: team.id }).ok).toBe(true)
    expect(base.trainingHost.available(3)).toBe(true)
    expect(base.populationView().residents).toBe(6)
  })
  it('训练占实际舰船与共同培训中心，缺电保有效进度与锁', () => {
    const session = crewed(), team = session.crew.teams[0]
    expect(session.crewCommand({ kind: 'plan', teamId: team.id, course: 'fire-control' }).ok).toBe(true)
    expect(session.combatShips[2].available).toBe(false)
    expect(session.base.academyCommand({ kind: 'assign', cellIndex: 10, personIndex: 4, course: 'engineer' }).ok).toBe(false)
    session.advance(5); const progress = team.progressMs
    session.base.command({ kind: 'toggle', cellIndex: 0 }); session.advance(60)
    expect(team.progressMs).toBe(progress); expect(team.growth).toBe(0)
    session.base.command({ kind: 'toggle', cellIndex: 0 }); session.advance(5)
    expect(team.growth).toBe(1)
    expect(session.crewCommand({ kind: 'idle', teamId: team.id }).ok).toBe(true)
    expect(session.combatShips[2].available).toBe(true)
  })
  it('护航扣有限补给，途中不能解散/训练，返航后才释放船并只发一次经验', () => {
    const session = crewed(), team = session.crew.teams[0], before = session.base.inventoryView()
    expect(session.securityCommand({ kind: 'start', missionKind: 'escort', teamIds: [team.id] }).ok).toBe(true)
    expect(session.base.host.available('ammo-kinetic-l')).toBe(before['ammo-kinetic-l'] - 60)
    expect(StageTwoSession.load(session.snapshot()).snapshot()).toBe(session.snapshot())
    expect(session.crewCommand({ kind: 'disband', teamId: team.id }).ok).toBe(false)
    expect(session.crewCommand({ kind: 'plan', teamId: team.id, course: 'fire-control' }).ok).toBe(false)
    session.advance(29); expect(session.combatShips[2].available).toBe(false)
    session.advance(1); expect(session.security.mission).toBeUndefined(); expect(session.combatShips[2].available).toBe(true)
    expect(team.growth).toBe(2)
    const restored = StageTwoSession.load(session.snapshot()), growth = restored.crew.teams[0].growth
    restored.advance(1); expect(restored.crew.teams[0].growth).toBe(growth)
  })
  it('实际清剿三来源只奖励一次，原居民/舰船不因胜败删除', () => {
    const session = crewed(), team = session.crew.teams[0]
    for (const source of session.security.sources) {
      expect(session.securityCommand({ kind: 'start', missionKind: 'clear', sourceId: source.id, teamIds: [team.id] }).ok).toBe(true)
      session.advance(30)
      expect(source.cleared).toBe(true)
      expect(session.security.mission).toBeUndefined()
      expect(session.securityCommand({ kind: 'start', missionKind: 'clear', sourceId: source.id, teamIds: [team.id] })).toMatchObject({ ok: false, reason: 'cleared' })
    }
    expect(session.base.populationView().residents).toBe(6)
    expect(session.crew.teams).toHaveLength(1); expect(session.combatShips.every(ship => ship.available)).toBe(true)
  })
  it('完整第二阶段目标可达，全部来源清除后仍可通过真实守备工时收束', () => {
    const session = crewed(), team = session.crew.teams[0]
    session.crewCommand({ kind: 'plan', teamId: team.id, course: 'fire-control' }); session.advance(10)
    session.crewCommand({ kind: 'idle', teamId: team.id })
    session.securityCommand({ kind: 'start', missionKind: 'escort', teamIds: [team.id] }); session.advance(30)
    for (const source of session.security.sources) {
      session.securityCommand({ kind: 'start', missionKind: 'clear', sourceId: source.id, teamIds: [team.id] }); session.advance(30)
    }
    session.securityCommand({ kind: 'guard', teamIds: [team.id] }); session.advance(30)
    const inventory = session.base.inventoryView(), population = structuredClone(session.base.population)
    expect(session.declare()).toEqual({ ok: true })
    expect(session.campaign.independent).toBe(true)
    expect(session.base.inventoryView()).toEqual(inventory); expect(session.base.population).toEqual(population)
    expect(session.declare().ok).toBe(false)
    expect(StageTwoSession.load(session.snapshot()).campaign.independent).toBe(true)
  })
  it('有效训练大步与小步、随机状态和整体快照一致', () => {
    const large = crewed(), small = StageTwoSession.load(large.snapshot()), id = large.crew.teams[0].id
    for (const session of [large, small]) session.crewCommand({ kind: 'plan', teamId: id, course: 'fire-control' })
    large.advance(90); for (let n = 0; n < 90; n++) small.advance(1)
    expect(small.snapshot()).toBe(large.snapshot())
  })
  it('整体快照拒绝丢账、岗位冲突、船锁错位和重复行动经验', () => {
    const session = crewed(), id = session.crew.teams[0].id
    session.crewCommand({ kind: 'plan', teamId: id, course: 'fire-control' }); session.advance(10)
    for (const change of [(raw: any) => { delete raw.security }, (raw: any) => { raw.combatShips[2].available = true },
      (raw: any) => { raw.rewardedReportId++ }, (raw: any) => { const base = JSON.parse(raw.base); base.training.qualifications[3] = 'engineer'; raw.base = JSON.stringify(base) },
      (raw: any) => { raw.crew.teams[0].members = [3, 3, 5] }]) {
      const raw = JSON.parse(session.snapshot()); change(raw); expect(() => StageTwoSession.load(JSON.stringify(raw))).toThrow()
    }
  })
  it('原有制造结算异常连同团队工时/随机/船锁与物资一起回滚', () => {
    const session = crewed(), id = session.crew.teams[0].id
    session.crewCommand({ kind: 'plan', teamId: id, course: 'fire-control' })
    session.base.setInventory('ore-veldspar', 100)
    session.base.refiningCommand({ kind: 'assign', cellIndex: 3, personIndex: 0, itemId: 'ore-veldspar' })
    const before = session.snapshot(), spy = vi.spyOn(session.base.refiningHost, 'settle').mockImplementationOnce(() => { throw new Error('stage rollback') })
    expect(() => session.advance(60)).toThrow('stage rollback'); spy.mockRestore()
    expect(session.snapshot()).toBe(before)
  })
  it('任务/返航/守备中整体往返，时间轴和经验账不接受分开回退', () => {
    const session = crewed(), id = session.crew.teams[0].id
    session.securityCommand({ kind: 'start', missionKind: 'escort', teamIds: [id] }); session.advance(3)
    expect(StageTwoSession.load(session.snapshot()).snapshot()).toBe(session.snapshot())
    session.securityCommand({ kind: 'stop' }); session.advance(1)
    expect(StageTwoSession.load(session.snapshot()).snapshot()).toBe(session.snapshot())
    session.advance(3); session.securityCommand({ kind: 'guard', teamIds: [id] })
    expect(StageTwoSession.load(session.snapshot()).snapshot()).toBe(session.snapshot())
    const raw = JSON.parse(session.snapshot()); raw.crew.clockMs++
    expect(() => StageTwoSession.load(JSON.stringify(raw))).toThrow('时间轴')
  })
  it('单次长期推进不丢已完成护航，报告截断与分步推进成果一致', () => {
    const large = crewed(), small = StageTwoSession.load(large.snapshot())
    for (const session of [large, small]) session.securityCommand({ kind: 'start', missionKind: 'escort', teamIds: [session.crew.teams[0].id] })
    large.advance(13000); small.advance(30); small.advance(12970)
    expect(large.campaign.achieved).toContain('logistics')
    expect(small.campaign.achieved).toEqual(large.campaign.achieved)
    expect(large.security.reports.some(report => report.kind === 'escort')).toBe(false)
    expect(StageTwoSession.load(large.snapshot()).campaign.achieved).toEqual(large.campaign.achieved)
  })
  it('无团队时已登记的阶段记忆不会因基础格式回退丢失', () => {
    const session = stageTwoFixture(); session.reconcile()
    session.base.command({ kind: 'toggle', cellIndex: 0 })
    const restored = StageTwoSession.load(session.snapshot()); restored.reconcile()
    expect(restored.campaign.achieved).toEqual(session.campaign.achieved)
    expect(restored.campaign.achieved).toContain('settlement')
  })
  it('只伪造目标枚举不能绕过实际护航/清剿/守备成果独立', () => {
    const session = crewed(), raw = JSON.parse(session.snapshot())
    raw.campaign.achieved = ['settlement', 'industry', 'research', 'expansion', 'crew', 'logistics', 'security', 'defense']
    expect(() => StageTwoSession.load(JSON.stringify(raw))).toThrow('成果依据')
  })
  it('无团队的空档也保存推进时钟，不靠读档重置后续安全检查计划', () => {
    const session = new StageTwoSession()
    session.advance(600)
    const restored = StageTwoSession.load(session.snapshot())
    expect(restored.crew.clockMs).toBe(600 * 60_000)
    expect(restored.security.clockMs).toBe(600 * 60_000)
    expect(restored.security.sources).toEqual(session.security.sources)
  })
  it('自然培养待答场景整档不重抽，实际选择只给一份结果', () => {
    const session = stageTwoChoiceFixture(), restored = StageTwoSession.load(session.snapshot())
    expect(restored.snapshot()).toBe(session.snapshot())
    const team = restored.crew.teams[0], chosen = { ...team.pending!.options[0] }
    expect(restored.crewCommand({ kind: 'reply', teamId: team.id, choice: 0 }).ok).toBe(true)
    expect(chosen.kind === 'skill' ? team.opportunities : team.traits).toContain(chosen.id)
    expect(team.pending).toBeUndefined()
    const saved = restored.snapshot()
    expect(restored.crewCommand({ kind: 'reply', teamId: team.id, choice: 0 }).ok).toBe(false)
    expect(restored.snapshot()).toBe(saved)
  })
  it('整档拒绝不同人口同时占用同一培训中心的舰员和基础课程席位', () => {
    const session = stageTwoFixture()
    session.crewCommand({ kind: 'create', shipId: SECURITY_SHIPS[0].id, name: '单人队' })
    const raw = JSON.parse(session.snapshot()), base = JSON.parse(raw.base)
    base.academy.active = { cellIndex: 10, personIndex: 4, course: 'engineer', progressMs: 0, paused: false }
    raw.base = JSON.stringify(base)
    expect(() => StageTwoSession.load(JSON.stringify(raw))).toThrow('席位重复')
  })
})
