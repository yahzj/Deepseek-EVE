/** 一次性探针（_ 前缀，输出后删）：B3.1 主题件候选目录——列出全部装备的 id/名/槽位/MK 档，供主题分配提案用 */
import { MODULES } from '@whale/data'
import type { ModuleDef } from '@whale/core'

const slotLabel = (m: ModuleDef): string => (m.slot === 'support' ? `支援(${m.rack ?? ''})` : m.slot)
for (const m of [...MODULES].sort((a, b) => a.id.localeCompare(b.id))) {
  const mk = m.id.match(/-(\d)$/)?.[1] ?? (m.id.includes('civ') ? 'civ' : '?')
  console.log(`${m.id}\t${m.name}\t${slotLabel(m)}\tMK${mk}\tCPU${m.cpu ?? '-'}\t${m.damageType ?? ''}`)
}
