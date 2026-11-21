import { LogIn, Orbit } from 'lucide-react'
import type { GameState, SimContext } from '@whale/core'
import { ancientStationDiscovered, ANCIENT_STATION_ID } from '../../../../../../packages/core/src/playerStation/discovery'
import { POPULATION_SOURCE_COUNT } from '../../../../../../packages/core/src/playerStation/population'
import { debugEnabled } from '../game/debugFlag'
import { tr } from '../i18n/locale'

export function AncientStationCard({ state, ctx }: { state: GameState; ctx: SimContext }) {
  if (!ancientStationDiscovered(state, ctx)) return null
  const people = state.playerStation?.population.people
  const residents = people?.filter(person => person.status === 'resident').length ?? 0
  const reserved = people?.filter(person => person.status !== 'dormant' && person.status !== 'resident').length ?? 0
  const protectedCount = people?.filter(person => person.status === 'protected').length ?? 0

  // 名称优先、人口读数其次；沿用星系行动行及主题间距，仅保留一个调试入口。
  return (
    <section className="app-ga-row" data-station-id={ANCIENT_STATION_ID}
      style={{ flexWrap: 'wrap', gap: 'var(--wui-sp-8)' }} aria-label={tr('ui.playerStation.002')}>
      <div className="app-ga-main" style={{ flex: '1 1 220px', overflowWrap: 'anywhere' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--wui-sp-6)', fontWeight: 600 }}
          title={tr('ui.playerStation.009')}>
          <Orbit size={16} aria-hidden="true" style={{ flex: 'none', color: 'rgb(var(--wui-accent))' }} />
          {tr('ui.playerStation.002')}
        </span>
        <span className="app-dim app-ga-desc">{tr('ui.playerStation.003')}</span>
        <div className="app-ga-desc" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--wui-sp-4) var(--wui-sp-10)', fontVariantNumeric: 'tabular-nums' }}>
          <span>{tr('ui.playerStation.005', { p1: people?.length ?? POPULATION_SOURCE_COUNT })}</span>
          <span>{tr('ui.playerStation.006', { p1: residents })}</span>
          <span>{tr('ui.playerStation.007', { p1: reserved })}</span>
          <span>{tr('ui.playerStation.008', { p1: protectedCount })}</span>
        </div>
      </div>
      {debugEnabled() && (
        <button type="button" className="app-btn" title={tr('ui.playerStation.004')}
          onClick={() => {
            if (debugEnabled()) window.dispatchEvent(new Event('whale-open-player-station'))
          }}>
          <span className="app-ico"><LogIn size={13} aria-hidden="true" /></span>{tr('ui.playerStation.004')}
        </button>
      )}
    </section>
  )
}
