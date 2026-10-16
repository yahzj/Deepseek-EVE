import { mountNamesTextOf } from '../i18n/locale'
import { mountEffectTextByName } from '../ui/foeBrief'
import { UI_TONES } from '../ui/tones'
import { tr } from '../i18n/locale'
import type { GravekeeperStatus } from '@whale/core'

/** 名称与效果分开渲染，同一件独立成行；两处战斗富详情共用。 */
export function BattleMountLines({ names, pairs, statuses }: { names: readonly string[]; pairs?: ReadonlyArray<readonly [string, string]>; statuses?: readonly GravekeeperStatus[] }) {
  const shown = mountNamesTextOf(names, pairs)
  return <div className="app-battle-mount-lines">
    {names.map((name, index) => {
      const effect = mountEffectTextByName(name)
      return <div key={name} className="app-info-note" data-battle-mount>
        <strong style={{ color: UI_TONES.matBattle }}>{shown[index] ?? name}</strong>
        {effect ? <>: {effect}</> : null}
      </div>
    })}
    {statuses?.map((status, index) => <div key={`${status.kind}-${index}`} className="app-info-note">
      {status.kind === 'rebirth' ? tr('ui.gravekeeper.005', { p1: status.name, p2: status.used ? tr('ui.gravekeeper.009') : tr('ui.battleCycles.006'), p3: ((status.lockMs ?? 0) / 1000).toFixed(1), p4: ((status.repairMs ?? 0) / 1000).toFixed(1) })
        : status.kind === 'coating' ? tr('ui.gravekeeper.006', { p1: status.name, p2: status.layers ?? 0 })
        : tr('ui.gravekeeper.007', { p1: status.name, p2: status.active ? tr('ui.gravekeeper.008') : tr('ui.battleCycles.006'), p3: status.attacks ?? 0, p4: (status.damageMul ?? 1).toFixed(2), p5: (status.reloadMul ?? 1).toFixed(2) })}
    </div>)}
  </div>
}
