/**
 * 临时探针：① 每族虫洞装备的槽位分布与 CPU 占用（决定"+1 槽位加在哪"）
 *          ② 每族装备池的定位标签（判断"族签名强增方向"）
 * 用法：npx tsx tools/_wh-fam-racks.ts
 */
import { MODULES } from '@whale/data'

const FAMS = ['a', 'c', 'd', 'e', 'g'] as const
for (const f of FAMS) {
  const list = MODULES.filter((m) => m.id.startsWith(`mod-wh-${f}-`))
  const byRack = new Map<string, string[]>()
  for (const m of list) {
    const rack = String((m as unknown as { rack?: string }).rack ?? '—')
    byRack.set(rack, [...(byRack.get(rack) ?? []), `${m.name}(CPU${m.cpuUse})`])
  }
  const total = list.reduce((a, m) => a + m.cpuUse, 0)
  console.log(
    `\n【${f.toUpperCase()} 族】装备 ${list.length} 件 · CPU 占用合计 ${total} · 平均 ${(total / Math.max(1, list.length)).toFixed(1)}`,
  )
  for (const [rack, names] of [...byRack.entries()].sort()) {
    console.log(`  ${rack.padEnd(6)} ${names.length} 件：${names.join(' · ')}`)
  }
}
