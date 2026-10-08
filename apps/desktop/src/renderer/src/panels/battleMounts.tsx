import { mountNamesTextOf } from '../i18n/locale'
import { mountEffectTextByName } from '../ui/foeBrief'
import { UI_TONES } from '../ui/tones'

/** 名称与效果分开渲染，同一件独立成行；两处战斗富详情共用。 */
export function BattleMountLines({ names, pairs }: { names: readonly string[]; pairs?: ReadonlyArray<readonly [string, string]> }) {
  const shown = mountNamesTextOf(names, pairs)
  return <div className="app-battle-mount-lines">
    {names.map((name, index) => {
      const effect = mountEffectTextByName(name)
      return <div key={name} className="app-info-note" data-battle-mount>
        <strong style={{ color: UI_TONES.matBattle }}>{shown[index] ?? name}</strong>
        {effect ? <>: {effect}</> : null}
      </div>
    })}
  </div>
}
