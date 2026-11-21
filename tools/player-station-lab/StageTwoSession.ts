import { LabModel, importSnapshot } from './model'
import { createStationCampaign, reconcileStationCampaign, declareStationIndependence, cleanStationCampaign, STATION_STAGE_GOALS } from '../../packages/core/src/playerStation/campaign'
import type { StationCampaignHost } from '../../packages/core/src/playerStation/campaign'
import { createStationCrew, stationCrewCommand, stationCrewView, stationCrewNextEventMs, advanceStationCrew,
  cleanStationCrew, crewBusyPeople, crewTeamBonuses, markCrewDuty, awardCrewExperience } from '../../packages/core/src/playerStation/crew'
import type { StationCrewHost, StationCrewAction } from '../../packages/core/src/playerStation/crew'
import { createStationSecurity, stationSecurityCommand, stationSecurityNextEventMs, advanceStationSecurity,
  stationSecurityView, cleanStationSecurity } from '../../packages/core/src/playerStation/security'
import type { StationSecurityHost, StationSecurityAction } from '../../packages/core/src/playerStation/security'
import { SECURITY_SHIPS, resolveSecurityBattle, securitySourceName } from './security-baseline'
import { readStageEnvelope, stageRecord, STAGE_TWO_FORMAT, STAGE_TWO_MAX_BYTES } from './stageTwoStorage'

type CombatShip = { id: string; available: boolean }
/** 基于原经营宿主组合第二阶段；时间入口仍唯一为 base.advance。 */
export class StageTwoSession {
  crew = createStationCrew()
  security = createStationSecurity()
  campaign = createStationCampaign()
  combatShips: CombatShip[] = SECURITY_SHIPS.map(ship => ({ id: ship.id, available: true }))
  rewardedReportId = 0
  guardServiceMs = 0
  history = { refiningPeak: 0, manufacturingPeak: 0, crewGrowthPeak: 0, escortsReturned: 0, defensesWon: 0 }
  readonly crewHost: StationCrewHost
  readonly securityHost: StationSecurityHost
  readonly campaignHost: StationCampaignHost
  private segmentReady?: boolean
  constructor(readonly base = new LabModel()) {
    this.crewHost = {
      residents: () => base.trainingHost.residents(),
      personAvailable: index => this.personAvailable(index),
      ship: id => {
        const definition = SECURITY_SHIPS.find(ship => ship.id === id), ship = this.combatShips.find(ship => ship.id === id)
        return definition && ship ? { tier: definition.tier, trainingTags: [...definition.trainingTags], home: true, available: ship.available } : undefined
      },
      claimShip: id => {
        const ship = this.combatShips.find(ship => ship.id === id)
        if (!ship?.available) return false
        ship.available = false; return true
      },
      releaseShip: id => {
        const ship = this.combatShips.find(ship => ship.id === id)
        if (!ship) throw new Error('团队船只缺失')
        ship.available = true
      },
      ready: () => this.segmentReady ?? base.populationView().receptionReady,
      trainingReady: () => {
        const cell = this.trainingCell()
        return cell !== undefined && !base.academy.active && base.view().cells.some(entry => entry.cellIndex === cell && entry.operational)
      },
      teamAvailable: id => !this.security.mission?.teamIds.includes(id) && !this.security.guard?.teamIds.includes(id),
    }
    this.securityHost = {
      ready: () => this.segmentReady ?? base.populationView().receptionReady,
      warningOnline: () => base.warningView().online,
      team: id => {
        const team = this.crew.teams.find(team => team.id === id)
        const ship = team && this.combatShips.find(ship => ship.id === team.shipId)
        return team && ship ? { shipId: team.shipId, available: team.activity === 'idle' && ship.available } : undefined
      },
      claimTeams: ids => {
        const teams = ids.map(id => this.crew.teams.find(team => team.id === id))
        if (teams.some(team => !team || team.activity !== 'idle' || !this.combatShips.find(ship => ship.id === team.shipId)?.available)
          || new Set(teams.map(team => team!.shipId)).size !== ids.length) return false
        for (const team of teams) this.combatShips.find(ship => ship.id === team!.shipId)!.available = false
        return true
      },
      releaseTeams: ids => {
        const mission = this.security.mission
        if (mission?.kind === 'escort' && mission.completed && mission.teamIds.every(id => ids.includes(id))) this.history.escortsReturned++
        for (const id of ids) {
          const team = this.crew.teams.find(team => team.id === id)
          if (!team) throw new Error('任务团队缺失')
          this.combatShips.find(ship => ship.id === team.shipId)!.available = true
          markCrewDuty(this.crew, id, 'idle')
        }
      },
      available: base.host.available, take: base.host.take,
      settle: result => base.host.give(result.reward),
      resolve: (ids, sourceId) => {
        const teams = ids.map(id => this.crew.teams.find(team => team.id === id)!)
        return resolveSecurityBattle(teams.map(team => team.shipId), sourceId,
          Object.fromEntries(teams.map(team => [team.shipId, crewTeamBonuses(team)])))
      },
    }
    this.campaignHost = { fulfilled: goal => {
      switch (goal) {
        case 'settlement': return base.populationView().residents >= 3 && base.populationView().receptionReady
        case 'industry': return this.history.refiningPeak > 0 && this.history.manufacturingPeak > 0
        case 'research': return base.researchView().catalog.every(project => project.completed)
        case 'expansion': return base.development.expanded
          && base.station.cells.some(cell => cell.kind === 'power' && base.development.levels[String(cell.cellIndex)] === 2)
          && base.station.cells.some(cell => cell.kind === 'life-support' && base.development.levels[String(cell.cellIndex)] === 2)
        case 'crew': return this.history.crewGrowthPeak > 0
        case 'logistics': return this.history.escortsReturned > 0
        case 'security': return this.security.sources.every(source => source.cleared)
        case 'defense': return this.guardServiceMs >= 30 * 60_000 || this.history.defensesWon > 0
      }
    } }
    base.stageTwo = {
      personBusy: index => crewBusyPeople(this.crew).includes(index),
      workingCells: () => this.crew.teams.some(team => team.activity === 'training' || team.activity === 'qualifying' && !team.paused) && !base.academy.active
        ? this.trainingCell() === undefined ? [] : [this.trainingCell()!] : [],
      trainingBusy: index => index === this.trainingCell() && this.crew.teams.some(team => team.activity === 'training' || team.activity === 'qualifying'),
      nextEventMs: () => Math.min(stationCrewNextEventMs(this.crew, this.crewHost), stationSecurityNextEventMs(this.security, this.securityHost)),
      advance: ms => {
        this.segmentReady = base.populationView().receptionReady
        try {
          if (this.segmentReady && this.security.guard && !this.security.guard.paused) this.guardServiceMs += ms
          advanceStationCrew(this.crew, this.crewHost, ms, true)
          advanceStationSecurity(this.security, this.securityHost, ms)
          this.applyReports()
        } finally { this.segmentReady = undefined }
      },
      snapshot: () => this.extraSnapshot(), restore: value => this.restoreExtra(value),
      afterSegment: () => this.reconcile(),
    }
  }
  personAvailable(index: number) {
    const base = this.base
    return base.trainingHost.residents().includes(index) && base.training.qualifications[index] === null
      && base.training.active?.personIndex !== index && base.academy.active?.personIndex !== index
      && !base.station.projects.some(project => project.engineerIndex === index)
      && !base.development.projects.some(project => project.engineerIndices.includes(index))
      && !base.refining.runs.some(run => run.personIndex === index) && !base.mining.runs.some(run => run.personIndex === index)
      && !base.manufacturing.runs.some(run => run.personIndex === index) && base.research.assignment?.personIndex !== index
  }
  private trainingCell() { return this.base.station.cells.find(cell => cell.kind === 'training')?.cellIndex }
  crewView() { return stationCrewView(this.crew, this.crewHost) }
  crewCommand(action: StationCrewAction) {
    const result = stationCrewCommand(this.crew, this.crewHost, action)
    this.reconcile()
    return result
  }
  securityView() { return stationSecurityView(this.security, this.securityHost) }
  securityCommand(action: StationSecurityAction) {
    const result = stationSecurityCommand(this.security, this.securityHost, action)
    if (result.ok) {
      for (const team of this.crew.teams) {
        if (this.security.guard?.teamIds.includes(team.id)) markCrewDuty(this.crew, team.id, 'guard')
        else if (this.security.mission?.teamIds.includes(team.id)) markCrewDuty(this.crew, team.id, 'mission')
      }
      this.applyReports()
    }
    return result
  }
  advance(minutes: number) { this.base.advance(minutes); this.reconcile() }
  reconcile() {
    this.history.refiningPeak = Math.max(this.history.refiningPeak, ...this.base.refining.runs.map(run => run.batchesDone))
    this.history.manufacturingPeak = Math.max(this.history.manufacturingPeak, ...this.base.manufacturing.runs.map(run => run.batchesDone))
    this.history.crewGrowthPeak = Math.max(this.history.crewGrowthPeak, ...this.crew.teams.map(team => team.growth))
    reconcileStationCampaign(this.campaign, this.campaignHost)
  }
  declare() { this.reconcile(); return declareStationIndependence(this.campaign, this.campaignHost) }
  sourceName(id: string) { return securitySourceName(id) }
  private applyReports() {
    for (const report of this.security.reports) if (report.id > this.rewardedReportId && report.experience > 0) {
      if (report.kind === 'raid' && report.outcome === 'victory') this.history.defensesWon++
      for (const id of report.teamIds) if (this.crew.teams.some(team => team.id === id)) {
        awardCrewExperience(this.crew, id, report.experience, report.kind === 'raid' ? 'guard' : 'mission')
      }
    }
    this.rewardedReportId = this.security.sequence
  }
  private extraSnapshot() { return structuredClone({ crew: cleanStationCrew(this.crew, this.crewHost),
    security: cleanStationSecurity(this.security, this.securityHost), campaign: cleanStationCampaign(this.campaign),
    combatShips: this.combatShips, rewardedReportId: this.rewardedReportId, guardServiceMs: this.guardServiceMs, history: this.history }) }
  private restoreExtra(value: unknown) {
    const raw = stageRecord(value)
    this.crew = cleanStationCrew(raw.crew, this.crewHost)
    this.security = cleanStationSecurity(raw.security, this.securityHost)
    if (this.security.clockMs !== this.crew.clockMs || this.security.clockMs > this.base.station.clockMs) throw new Error('团队与安全时间轴不一致')
    this.campaign = cleanStationCampaign(raw.campaign)
    if (!Array.isArray(raw.combatShips) || raw.combatShips.length !== SECURITY_SHIPS.length) throw new Error('作业舰船账不完整')
    this.combatShips = raw.combatShips.map((value, index) => {
      const ship = stageRecord(value)
      if (ship.id !== SECURITY_SHIPS[index].id || typeof ship.available !== 'boolean') throw new Error('作业舰船账无效')
      return { id: ship.id, available: ship.available }
    })
    if (typeof raw.rewardedReportId !== 'number' || !Number.isSafeInteger(raw.rewardedReportId) || raw.rewardedReportId < 0 || raw.rewardedReportId !== this.security.sequence) throw new Error('行动经验结算账不一致')
    this.rewardedReportId = raw.rewardedReportId
    if (typeof raw.guardServiceMs !== 'number' || !Number.isSafeInteger(raw.guardServiceMs) || raw.guardServiceMs < 0 || raw.guardServiceMs > this.security.clockMs) throw new Error('守备有效工时无效')
    this.guardServiceMs = raw.guardServiceMs
    const history = stageRecord(raw.history)
    const keys = Object.keys(this.history) as (keyof typeof this.history)[]
    if (Object.keys(history).length !== keys.length || keys.some(key => typeof history[key] !== 'number' || !Number.isSafeInteger(history[key]) || Number(history[key]) < 0)) throw new Error('阶段成果依据账无效')
    this.history = Object.fromEntries(keys.map(key => [key, history[key]])) as typeof this.history
    if (this.history.crewGrowthPeak > 72 || this.history.crewGrowthPeak > 0 && this.crew.sequence === 0
      || this.history.escortsReturned > Math.floor(this.security.exposure / (30 * 60_000))
      || this.history.defensesWon > this.security.sequence
      || this.crew.teams.some(team => team.growth > this.history.crewGrowthPeak)
      || this.base.refining.runs.some(run => run.batchesDone > this.history.refiningPeak)
      || this.base.manufacturing.runs.some(run => run.batchesDone > this.history.manufacturingPeak)) throw new Error('阶段历史成果与运行账不一致')
  }
  snapshot() {
    if (this.crew.sequence === 0 && this.crew.clockMs === 0 && this.security.clockMs === 0 && this.security.sequence === 0 && this.security.exposure === 0
      && this.campaign.achieved.length === 0 && Object.values(this.history).every(n => n === 0) && !this.campaign.independent) return this.base.snapshot()
    const output = JSON.stringify({ format: STAGE_TWO_FORMAT, version: 1, base: this.base.snapshot(), ...this.extraSnapshot() }, null, 2)
    if (new TextEncoder().encode(output).length > STAGE_TWO_MAX_BYTES) throw new Error('第二阶段快照超过2MiB')
    return output
  }
  static load(text: string) {
    const raw = stageRecord(JSON.parse(text))
    if (raw.format !== STAGE_TWO_FORMAT) return new StageTwoSession(importSnapshot(text))
    const envelope = readStageEnvelope(text), session = new StageTwoSession(importSnapshot(envelope.base))
    session.restoreExtra(envelope.raw)
    const usedPeople = crewBusyPeople(session.crew)
    if (usedPeople.some(index => !session.personAvailable(index))) throw new Error('团队人口与原岗位冲突')
    if (session.base.academy.active && session.crew.teams.some(team => team.activity === 'training' || team.activity === 'qualifying')) throw new Error('培训中心席位重复占用')
    const duty = [...(session.security.mission?.teamIds ?? []), ...(session.security.guard?.teamIds ?? [])]
    for (const team of session.crew.teams) {
      const expected = session.security.guard?.teamIds.includes(team.id) ? 'guard' : session.security.mission?.teamIds.includes(team.id) ? 'mission' : undefined
      if (expected ? team.activity !== expected : team.activity === 'guard' || team.activity === 'mission') throw new Error('团队活动与守备/外派任务不一致')
    }
    for (const ship of session.combatShips) {
      const team = session.crew.teams.find(team => team.shipId === ship.id)
      const used = !!team && (team.activity === 'training' || duty.includes(team.id))
      if (ship.available === used) throw new Error('船锁与团队活动不一致')
    }
    const proof = (goal: typeof STATION_STAGE_GOALS[number]) => goal === 'settlement'
      ? session.base.populationView().residents >= 3 : session.campaignHost.fulfilled(goal)
    if (session.campaign.achieved.some(goal => !proof(goal))) throw new Error('阶段目标缺少实际成果依据')
    return session
  }
}
