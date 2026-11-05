import type { UnitSpec } from '@whale/core'
import { tr } from '../../../i18n/locale'
import './fittingOverview.css'

const fmt = (value: number): string => value.toLocaleString('zh-CN')

/** 沿用装配台原有名义火力与三系平均抗性承伤读数，不参与战斗结算。 */
export function FittingSummary({ spec }: { spec: UnitSpec | null }) {
  let weaponDps = 0
  let droneDps = 0
  if (spec) for (const weapon of spec.weapons) {
    if (weapon.label === '基础舰炮') continue // l10n-keep：既有武器来源判据，不是显示文本
    const damage = weapon.kind === 'gun' ? Object.values(weapon.shotsByType ?? {})[0] ?? 0 : weapon.shotDmg ?? 0
    const dps = damage * (weapon.count ?? 1) / Math.max(0.1, weapon.reloadMs / 1000)
    if (weapon.src === 'drone') droneDps += dps
    else weaponDps += dps
  }
  const ehp = (layer: 's' | 'a' | 'h'): number => {
    if (!spec) return 0
    const resist = spec.resists[layer === 's' ? 'shield' : layer === 'a' ? 'armor' : 'hull'] ?? {}
    const average = Math.min(0.95, ((resist.kinetic ?? 0) + (resist.explosive ?? 0) + (resist.plasma ?? 0)) / 3)
    return Math.round(spec.hp[layer] / Math.max(0.05, 1 - average))
  }
  const shield = ehp('s'), armor = ehp('a'), hull = ehp('h')
  return <div className="hud-fit-summary-strip" data-fitting-summary>
    <div className="hud-fit-kpi is-dps">
      <div className="hud-fit-kpi-header"><span className="hud-fit-kpi-tag">{tr('ui.fitKpi.001')}<small> // FIREPOWER</small></span></div>
      <div className="hud-fit-kpi-body"><span className="hud-fit-kpi-val">{fmt(Math.round(weaponDps + droneDps))}</span><span className="hud-fit-kpi-unit">DPS</span></div>
      <div className="hud-fit-kpi-sub">{droneDps > 0
        ? tr('ui.fitOverview.003', { p1: Math.round(weaponDps), p2: Math.round(droneDps) })
        : tr('ui.fitOverview.004')}</div>
    </div>
    <div className="hud-fit-kpi is-ehp">
      <div className="hud-fit-kpi-header"><span className="hud-fit-kpi-tag">{tr('ui.fitKpi.002')}<small> // DEFENSE</small></span></div>
      <div className="hud-fit-kpi-body"><span className="hud-fit-kpi-val">{fmt(shield + armor + hull)}</span><span className="hud-fit-kpi-unit">EHP</span></div>
      <div className="hud-fit-kpi-sub">{tr('ui.fitOverview.005', { p1: fmt(shield), p2: fmt(armor), p3: fmt(hull) })}</div>
    </div>
  </div>
}
