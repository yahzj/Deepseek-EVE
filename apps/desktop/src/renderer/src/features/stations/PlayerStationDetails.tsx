import { Ban, Building2, Factory, FlaskConical, HeartPulse, Pause, Play, Zap, Wrench, GraduationCap, Radar } from 'lucide-react'
import type { PlayerStationAction, PlayerStationText, PlayerStationView } from './PlayerStationPanel'

export type FacilityKind = keyof PlayerStationView['facilityBills']
export const FACILITIES = ['power', 'life-support', 'service', 'refinery', 'research', 'manufacturing', 'training', 'warning'] as const satisfies readonly FacilityKind[]
export const FACILITY_ICONS = { power: Zap, 'life-support': HeartPulse, service: Building2, refinery: Factory, research: FlaskConical, manufacturing: Wrench, training: GraduationCap, warning: Radar }
export const STATION_NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

const REASONS: Record<string, string> = {
  materials: 'ui.playerStation.materialsMissing',
  power: 'ui.playerStation.powerMissing',
  engineer: 'ui.playerStation.engineerMissing',
  research: 'ui.playerStation.researchMissing',
  'body-required': 'ui.playerStation.bodyRequired',
}

export function facilityReason(view: PlayerStationView, kind: FacilityKind, cellIndex: number) {
  if (view.cells.some((cell) => cell.cellIndex === cellIndex)
    || view.projects.some((project) => project.cellIndex === cellIndex)) return 'ui.playerStation.occupied'
  const option = view.facilityOptions[kind]
  return option.canBuild ? undefined : REASONS[option.reason ?? ''] ?? 'ui.playerStation.unavailable'
}

export function MaterialBill({ rows, facility = false, text }: {
  rows: PlayerStationView['bill'] | PlayerStationView['facilityBills'][FacilityKind]
  facility?: boolean
  text: PlayerStationText
}) {
  return <table className="app-player-station-bill">
    <caption className="app-player-station-sr-only">{text(facility ? 'ui.playerStation.facilityMaterials' : 'ui.playerStation.bodyMaterials')}</caption>
    <thead><tr>
      <th scope="col">{text('ui.playerStation.material')}</th>
      <th scope="col">{text('ui.playerStation.need')}</th>
      <th scope="col">{text(facility ? 'ui.playerStation.available' : 'ui.playerStation.delivered')}</th>
      <th scope="col">{text('ui.playerStation.missing')}</th>
    </tr></thead>
    <tbody>{rows.map((row) => {
      const amount = 'delivered' in row ? row.delivered : row.available
      const missing = 'remaining' in row ? row.remaining : Math.max(0, row.need - row.available)
      return <tr key={row.itemId}>
        <th scope="row">{row.itemName}</th>
        <td>{STATION_NUMBER.format(row.need)}</td>
        <td>{STATION_NUMBER.format(amount)}</td>
        <td className={missing > 0 ? 'is-missing' : undefined}>{STATION_NUMBER.format(missing)}</td>
      </tr>
    })}</tbody>
  </table>
}

export function FacilityDetails({ view, kind, text, bill = true }: {
  view: PlayerStationView
  kind: FacilityKind
  text: PlayerStationText
  bill?: boolean
}) {
  const option = view.facilityOptions[kind]
  const Icon = FACILITY_ICONS[kind]
  return <div className="app-player-station-facility-detail" data-facility-detail={kind}>
    <h4 className="app-player-station-title"><Icon size={16} aria-hidden="true" />{text(option.nameId)}</h4>
    <p>{text(option.descriptionId)}</p>
    <dl className="app-player-station-specs">
      <div><dt>{text('ui.playerStation.effect')}</dt><dd>{text(kind === 'power' ? 'ui.playerStation.powerEffect'
        : kind === 'life-support' ? 'ui.playerStation.lifeEffect' : kind === 'refinery' ? 'ui.playerStation.refineryEffect'
          : kind === 'research' ? 'ui.playerStation.researchEffect' : kind === 'manufacturing' ? 'ui.playerStation.manufacturingEffect'
            : kind === 'training' ? 'ui.playerStation.trainingEffect' : kind === 'warning' ? 'ui.playerStation.warningEffect' : 'ui.playerStation.serviceEffect', { p1: STATION_NUMBER.format(option.capacity) })}</dd></div>
      <div><dt>{text('ui.playerStation.footprint')}</dt><dd>{text('ui.playerStation.cellCount', { p1: 1 })}</dd></div>
      <div><dt>{text('ui.playerStation.duration')}</dt><dd>{text('ui.playerStation.minutes', { p1: STATION_NUMBER.format(option.durationMs / 60_000) })}</dd></div>
      <div><dt>{text('ui.playerStation.constructionPower')}</dt><dd>{STATION_NUMBER.format(option.constructionPower)}</dd></div>
      <div><dt>{text('ui.playerStation.runPower')}</dt><dd>{STATION_NUMBER.format(option.runPower)}</dd></div>
      {option.workPower !== option.runPower && <div><dt>{text('ui.playerStation.workPower')}</dt><dd>{STATION_NUMBER.format(option.workPower)}</dd></div>}
      {option.engineers > 0 && <>
        <div><dt>{text('ui.playerStation.engineersRequired')}</dt><dd>{option.engineers}</dd></div>
        <div><dt>{text('ui.playerStation.engineersAvailable')}</dt><dd>{option.availableEngineers}</dd></div>
      </>}
      {option.powerShortfall > 0 && <div className="is-missing" data-power-shortfall={option.powerShortfall}>
        <dt>{text('ui.playerStation.powerShortfall')}</dt><dd>{STATION_NUMBER.format(option.powerShortfall)}</dd>
      </div>}
    </dl>
    {bill && <MaterialBill rows={view.facilityBills[kind]} facility text={text} />}
  </div>
}

type Project = NonNullable<PlayerStationView['project']> | PlayerStationView['projects'][number]

export function projectStatus(project: Project) {
  return project.paused ? 'ui.playerStation.paused'
    : 'blockedReason' in project && project.blockedReason === 'engineer' ? 'ui.playerStation.engineerBlocked'
      : 'blocked' in project && project.blocked ? 'ui.playerStation.powerBlocked' : 'ui.playerStation.building'
}

export function ProjectDetails({ project, name, onCommand, text }: {
  project: Project
  name: string
  onCommand(action: PlayerStationAction): void
  text: PlayerStationText
}) {
  const duration = Math.max(0, project.durationMs)
  const progress = Math.min(Math.max(0, project.progressMs), duration)
  const percent = duration > 0 ? progress / duration * 100 : 0
  // 主体命令不带地块，设施命令始终绑定到该格，不能退回全站操作。
  const target = project.kind === 'body' ? {} : { cellIndex: project.cellIndex }
  return <section className="app-player-station-project" data-project-cell={project.cellIndex ?? 'body'} aria-label={name}>
    <div className="app-player-station-project-head">
      <h4 className="app-player-station-label">{name}</h4>
      <span className={'blocked' in project && project.blocked ? 'is-missing' : 'app-dim'}>{text(projectStatus(project))}</span>
    </div>
    {project.engineerIndex !== undefined && <span className="app-dim" data-project-engineer={project.engineerIndex}>
      {text('ui.playerStation.assignedEngineer', { p1: project.engineerIndex + 1 })}
    </span>}
    <progress value={percent} max={100} aria-label={text('ui.playerStation.progressLabel')} />
    <div className="app-player-station-project-head app-player-station-progress-value">
      <span>{STATION_NUMBER.format(percent)}%</span>
      <span className="app-dim">{text('ui.playerStation.progressValue', {
        p1: STATION_NUMBER.format(progress / 60_000), p2: STATION_NUMBER.format(duration / 60_000),
      })}</span>
    </div>
    <div className="app-player-station-actions">
      <button type="button" className="app-btn is-small" onClick={() => onCommand({ kind: project.paused ? 'resume' : 'pause', ...target })}>
        {project.paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{text(project.paused ? 'ui.playerStation.resume' : 'ui.playerStation.pause')}
      </button>
      <button type="button" className="app-btn is-small is-warn" onClick={() => onCommand({ kind: 'cancel', ...target })}>
        <Ban size={14} aria-hidden="true" />{text('ui.playerStation.cancel')}
      </button>
    </div>
  </section>
}
