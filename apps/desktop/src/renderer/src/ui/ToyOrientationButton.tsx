import { Monitor, RotateCw, Smartphone } from 'lucide-react'
import { tr } from '../i18n/locale'
import { nextToyOrientation } from './toyOrientation'
import type { ToyOrientation } from './toyOrientation'

const LABELS = {
  auto: 'ui.toyOrientation.001', landscape: 'ui.toyOrientation.002', portrait: 'ui.toyOrientation.003',
} as const
const ICONS = { auto: RotateCw, landscape: Monitor, portrait: Smartphone }

export function ToyOrientationButton({ mode, onChange }: { mode: ToyOrientation; onChange(mode: ToyOrientation): void }) {
  const next = nextToyOrientation(mode)
  const Icon = ICONS[mode]
  const label = tr('ui.toyOrientation.004', { p1: tr(LABELS[mode]) })
  return <button type="button" className="app-btn" data-toy-orientation={mode}
    style={{ width: 72, minWidth: 72, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, flexShrink: 0 }}
    aria-label={label} title={tr('ui.toyOrientation.005', { p1: tr(LABELS[mode]), p2: tr(LABELS[next]) })}
    onClick={() => onChange(next)}>
    <Icon size={14} aria-hidden="true" /><span>{tr(LABELS[mode])}</span>
  </button>
}
