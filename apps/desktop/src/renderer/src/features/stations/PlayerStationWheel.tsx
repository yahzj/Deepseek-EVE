import { useEffect } from 'react'
import type { PlayerStationPanelProps } from './PlayerStationPanel'
import { FACILITIES, FACILITY_ICONS, FacilityDetails, facilityReason } from './PlayerStationDetails'
import { PlayerStationWheelMenu } from './PlayerStationWheelMenu'
import type { StationInputMode, StationWheelOption } from './PlayerStationWheelMenu'

export type { StationInputMode } from './PlayerStationWheelMenu'
interface WheelProps extends Pick<PlayerStationPanelProps, 'view' | 'text' | 'onCommand'> {
  cellIndex: number
  anchor: HTMLButtonElement
  inputMode: StationInputMode
  onClose(): void
}

const PLACEMENT = {
  power: { slot: 0, tone: 'amber' },
  'life-support': { slot: 1, tone: 'green' },
  service: { slot: 2, tone: 'blue' },
  refinery: { slot: 3, tone: 'amber' },
  research: { slot: 4, tone: 'blue' },
  manufacturing: { slot: 5, tone: 'amber' },
  training: { slot: 6, tone: 'green' },
  warning: { slot: 7, tone: 'blue' },
} as const

export function PlayerStationWheel({ view, text, onCommand, cellIndex, anchor, inputMode, onClose }: WheelProps) {
  useEffect(() => {
    if (view.cells.some((cell) => cell.cellIndex === cellIndex) || view.projects.some((project) => project.cellIndex === cellIndex)) onClose()
  }, [view.cells, view.projects, cellIndex, onClose])

  const options: StationWheelOption[] = FACILITIES.map((kind) => {
    const reason = facilityReason(view, kind, cellIndex)
    return {
      id: kind, ...PLACEMENT[kind], Icon: FACILITY_ICONS[kind], name: text(view.facilityOptions[kind].nameId),
      buildLabel: text('ui.playerStation.buildFacility', { p1: text(view.facilityOptions[kind].nameId) }),
      details: <FacilityDetails view={view} kind={kind} text={text} />,
      unavailable: reason ? text(reason) : undefined,
    }
  })
  return <PlayerStationWheelMenu options={options} anchor={anchor} inputMode={inputMode} onClose={onClose}
    title={text('ui.playerStation.cell', { p1: cellIndex + 1 })} groupLabel={text('ui.playerStation.facilityKind')}
    detailLabel={text('ui.playerStation.facilityDetails')} closeLabel={text('ui.playerStation.closeWheel')}
    onBuild={(id) => {
      const kind = FACILITIES.find((entry) => entry === id)
      if (kind && !facilityReason(view, kind, cellIndex)) onCommand({ kind: 'build', facility: kind, cellIndex })
    }} />
}
