import { useCallback, useId, useRef, useState } from 'react'
import { Ban, Hammer, Pause, Play, Plus, RotateCcw, Truck } from 'lucide-react'
import type { playerStationCommand, playerStationView } from '../../../../../../../packages/core/src/playerStation/index'
import { FACILITY_ICONS, FacilityDetails, MaterialBill, ProjectDetails, projectStatus, STATION_NUMBER as NUMBER } from './PlayerStationDetails'
import { PlayerStationWheel } from './PlayerStationWheel'
import type { StationInputMode } from './PlayerStationWheel'
import './playerStation.css'

export type PlayerStationView = ReturnType<typeof playerStationView>
export type PlayerStationAction = Parameters<typeof playerStationCommand>[2]
export type PlayerStationText = (id: string, params?: Record<string, string | number>) => string

export interface PlayerStationPanelProps {
  view: PlayerStationView
  onCommand(action: PlayerStationAction): void
  onDeliver(): void
  onRecover(): void
  text: PlayerStationText
}

export function PlayerStationPanel({ view, onCommand, onDeliver, onRecover, text }: PlayerStationPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [wheel, setWheel] = useState<{ cellIndex: number; anchor: HTMLButtonElement; inputMode: StationInputMode } | null>(null)
  const inputMode = useRef<StationInputMode>('keyboard')
  const wheelAnchor = useRef<HTMLButtonElement | null>(null)
  const id = useId()
  const project = view.project
  const selectedCell = view.cells.find((cell) => cell.cellIndex === selectedIndex)
  const selectedProject = view.projects.find((entry) => entry.cellIndex === selectedIndex)
  const recoveries = Object.entries(view.recoveryMaterials).filter(([, amount]) => amount > 0)
  const itemNames = new Map([...view.bill, ...Object.values(view.facilityBills).flat()].map((row) => [row.itemId, row.itemName]))
  const closeWheel = useCallback(() => {
    setWheel(null)
    if (wheelAnchor.current?.isConnected) wheelAnchor.current.focus({ preventScroll: true })
  }, [])
  const bodyStatus = project ? projectStatus(project) : view.bodyPaused ? 'ui.playerStation.paused'
    : view.bodyApproved ? 'ui.playerStation.waitingMaterials' : 'ui.playerStation.pending'
  const facilityName = (kind: keyof PlayerStationView['facilityOptions']) => text(view.facilityOptions[kind].nameId)

  if (!view.visible) return null

  return <section className="app-player-station" aria-labelledby={`${id}-title`}>
    <header className="app-player-station-head">
      <h3 id={`${id}-title`} className="app-player-station-title"><Hammer size={17} aria-hidden="true" />{text('ui.playerStation.title')}</h3>
      <span className="app-dim">{text(view.built ? 'ui.playerStation.built' : bodyStatus)}</span>
    </header>

    {!view.built ? <section aria-labelledby={`${id}-materials`}>
      <h4 id={`${id}-materials`} className="app-player-station-label">{text('ui.playerStation.bodyMaterials')}</h4>
      <MaterialBill rows={view.bill} text={text} />
      <div className="app-player-station-actions">
        <button type="button" className="app-btn is-small is-primary" disabled={view.bodyApproved || !!project} onClick={() => onCommand({ kind: 'approve' })}>
          <Hammer size={14} aria-hidden="true" />{text('ui.playerStation.approve')}
        </button>
        <button type="button" className="app-btn is-small" disabled={view.bill.every((row) => row.remaining <= 0)} onClick={onDeliver}>
          <Truck size={14} aria-hidden="true" />{text('ui.playerStation.deliver')}
        </button>
      </div>
      {project ? <ProjectDetails project={project} name={text('ui.playerStation.body')} text={text} onCommand={onCommand} />
        : view.bodyApproved && <>
          <p className="app-dim app-player-station-notice">{text(bodyStatus)}</p>
          <div className="app-player-station-actions">
            <button type="button" className="app-btn is-small" onClick={() => onCommand({ kind: view.bodyPaused ? 'resume' : 'pause' })}>
              {view.bodyPaused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{text(view.bodyPaused ? 'ui.playerStation.resume' : 'ui.playerStation.pause')}
            </button>
            <button type="button" className="app-btn is-small is-warn" onClick={() => onCommand({ kind: 'cancel' })}>
              <Ban size={14} aria-hidden="true" />{text('ui.playerStation.cancel')}
            </button>
          </div>
        </>}
    </section> : <>
      <dl className="app-player-station-stats">
        <div><dt>{text('ui.playerStation.supply')}</dt><dd>{NUMBER.format(view.power.supply)}</dd></div>
        <div><dt>{text('ui.playerStation.demand')}</dt><dd>{NUMBER.format(view.power.demand)}</dd></div>
        <div><dt>{text('ui.playerStation.runningDemand')}</dt><dd>{NUMBER.format(view.power.runningDemand)}</dd></div>
        <div className={view.power.constructionRequested > view.power.constructionDemand ? 'is-missing' : undefined}>
          <dt>{text('ui.playerStation.constructionDemand')}</dt><dd>{text('ui.playerStation.powerAllocation', { p1: NUMBER.format(view.power.constructionDemand), p2: NUMBER.format(view.power.constructionRequested) })}</dd>
        </div>
        <div><dt>{text('ui.playerStation.capacity')}</dt><dd>{NUMBER.format(view.power.populationCapacity)}</dd></div>
      </dl>
      <div className="app-player-station-layout">
        <div className="app-player-station-grid" style={view.cellCount === 16 ? { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' } : undefined} role="group" aria-label={text('ui.playerStation.cells')}>
          {Array.from({ length: view.cellCount }, (_, position) => {
            // 原3x3身份0..8保持原坐标，新右列9..11和底行12..15接在外围。
            const row = Math.floor(position / 4), col = position % 4
            const cellIndex = view.cellCount === 9 ? position : row < 3 ? col < 3 ? row * 3 + col : 9 + row : 12 + col
            const cell = view.cells.find((entry) => entry.cellIndex === cellIndex)
            const cellProject = view.projects.find((entry) => entry.cellIndex === cellIndex)
            const kind = cell?.kind ?? cellProject?.kind
            const Icon = kind && kind !== 'body' ? FACILITY_ICONS[kind] : Plus
            const name = kind && kind !== 'body' ? facilityName(kind) : text('ui.playerStation.empty')
            const statusId = cell ? cell.damaged ? 'ui.playerStation.damaged' : !cell.enabled ? 'ui.playerStation.disabled' : !cell.operational ? 'ui.playerStation.facilityPowerBlocked'
              : cell.working ? 'ui.playerStation.refining.status.running' : cell.kind === 'refinery' || cell.kind === 'research' ? 'ui.playerStation.standby' : 'ui.playerStation.enabled'
              : cellProject ? projectStatus(cellProject) : 'ui.playerStation.vacant'
            const label = `${text('ui.playerStation.cell', { p1: cellIndex + 1 })} ${name} ${text(statusId)}`
            return <button key={cellIndex} type="button" data-cell={cellIndex}
              className={`app-btn app-player-station-cell${selectedIndex === cellIndex ? ' is-selected' : ''}${cell && !cell.enabled ? ' is-off' : ''}${cellProject ? ' is-building' : ''}`}
              aria-pressed={selectedIndex === cellIndex} aria-label={label}
              aria-haspopup={!cell && !cellProject ? 'dialog' : undefined} aria-expanded={!cell && !cellProject ? wheel?.cellIndex === cellIndex : undefined}
              onPointerDown={(event) => { inputMode.current = event.pointerType === 'touch' || event.pointerType === 'pen' ? 'touch' : 'mouse' }}
              onKeyDown={() => { inputMode.current = 'keyboard' }}
              onClick={(event) => {
                setSelectedIndex(cellIndex)
                if (!cell && !cellProject) {
                  wheelAnchor.current = event.currentTarget
                  setWheel({ cellIndex, anchor: event.currentTarget, inputMode: inputMode.current })
                }
              }}>
              <span className="app-player-station-cell-top"><span>{cellIndex + 1}</span><Icon size={22} aria-hidden="true" /></span>
              <span className="app-player-station-cell-name">{name}</span>
              <span className="app-dim app-player-station-cell-status">{text(statusId)}{cellProject && <span> {NUMBER.format(cellProject.progressMs / cellProject.durationMs * 100)}%</span>}</span>
            </button>
          })}
        </div>
        <aside className="app-player-station-selection" aria-labelledby={`${id}-selection`}>
          <h4 id={`${id}-selection`} className="app-player-station-label">{text('ui.playerStation.cell', { p1: selectedIndex + 1 })}</h4>
          {selectedCell ? <>
            <FacilityDetails view={view} kind={selectedCell.kind} text={text} bill={false} />
            {selectedCell.level === 2 && <span className="app-dim">{text('ui.playerStation.upgraded')}</span>}
            <label className="app-player-station-toggle">
              <input type="checkbox" role="switch" checked={selectedCell.enabled}
                aria-label={text('ui.playerStation.toggle', { p1: facilityName(selectedCell.kind) })}
                onChange={() => onCommand({ kind: 'toggle', cellIndex: selectedIndex })} />
              {text(selectedCell.enabled ? 'ui.playerStation.enabled' : 'ui.playerStation.disabled')}
            </label>
          </> : selectedProject ? <ProjectDetails project={selectedProject} name={selectedProject.kind === 'body' ? text('ui.playerStation.body') : facilityName(selectedProject.kind)} text={text} onCommand={onCommand} />
            : <span className="app-dim">{text('ui.playerStation.empty')}</span>}
          <section className="app-player-station-project-list" aria-labelledby={`${id}-projects`}>
            <h4 id={`${id}-projects`} className="app-player-station-label">{text('ui.playerStation.projects', { p1: view.projects.length })}</h4>
            {view.projects.length === 0 ? <span className="app-dim">{text('ui.playerStation.noProjects')}</span> : <ol>
              {view.projects.map((entry) => <li key={entry.cellIndex}>
                <button type="button" className={`app-btn app-player-station-project-link${entry.cellIndex === selectedIndex ? ' is-selected' : ''}`}
                  aria-pressed={entry.cellIndex === selectedIndex} onClick={() => setSelectedIndex(entry.cellIndex!)}>
                  <span>{text('ui.playerStation.cell', { p1: entry.cellIndex! + 1 })} · {entry.kind === 'body' ? text('ui.playerStation.body') : facilityName(entry.kind)}</span>
                  <span className={entry.blocked ? 'is-missing' : 'app-dim'}>{text(projectStatus(entry))} · {NUMBER.format(entry.progressMs / entry.durationMs * 100)}%</span>
                </button>
              </li>)}
            </ol>}
          </section>
        </aside>
      </div>
    </>}

    <section className="app-player-station-recovery" aria-labelledby={`${id}-recovery`}>
      <div className="app-player-station-project-head">
        <h4 id={`${id}-recovery`} className="app-player-station-label">{text('ui.playerStation.recoveryMaterials')}</h4>
        <button type="button" className="app-btn is-small" disabled={recoveries.length === 0} onClick={onRecover}>
          <RotateCcw size={14} aria-hidden="true" />{text('ui.playerStation.recover')}
        </button>
      </div>
      {recoveries.length ? <dl className="app-player-station-recovery-list">{recoveries.map(([itemId, amount]) => <div key={itemId}>
        <dt>{itemNames.get(itemId) ?? itemId}</dt><dd>{NUMBER.format(amount)}</dd>
      </div>)}</dl> : <span className="app-dim">{text('ui.playerStation.noRecovery')}</span>}
    </section>
    {wheel && <PlayerStationWheel {...wheel} view={view} text={text} onCommand={onCommand} onClose={closeWheel} />}
  </section>
}
