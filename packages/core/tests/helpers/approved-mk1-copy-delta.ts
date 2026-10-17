import type { L10nEntry } from '@whale/data'

/** 船长确认MK1改名及扫描叠加规则后，历史词条守恒只放行这些精确变化。 */
export function approvedMk1CopyDelta(id: string, entry: L10nEntry): L10nEntry {
  const names = new Set(['core.consumable.001', 'core.consumable.013', 'core.consumable.015',
    'core.consumable.016', 'core.consumable.017', 'ui.boost.013', 'ui.ActivityBar.067'])
  if (names.has(id)) return { ...entry,
    zh: entry.zh.replace('突触加速剂', '突触加速剂 MK1'),
    en: entry.en.replace('Synaptic Accelerant', 'Synaptic Accelerant MK1') }
  if (id === 'ui.shipInfo.125') return { ...entry,
    zh: '空间内扫描范围 +{p1} 圈；同类舰船取最高，侦察舰与电子舰可相加',
    en: 'Scan range inside the space +{p1} rings; only the highest bonus in each ship class applies, and scout and EW bonuses add together' }
  return entry
}
