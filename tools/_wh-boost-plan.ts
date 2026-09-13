/**
 * 临时探针：按船长 2026-09-13 口径（族签名强增 + 少量削弱 + **平均强度 +10%** + 每艘 +1 槽位）
 * 算出**逐艘建议值**（只打印，不写任何数据）：
 *   - Σ血目标 = 参照中位 × 族签名比（平均 ≥1.10；无同档同角色参照时退化用"同档全体中位"）
 *   - CPU 目标 = max(参照中位 ×1.10, 现 CPU + 该族装备池平均 CPU)  ⇒ 保证多出的槽装得上自家件
 * 用法：npx tsx tools/_wh-boost-plan.ts
 */
import { MODULES, SHIPS } from '@whale/data'
import type { ShipDef } from '@whale/core'

const FAMS = ['a', 'c', 'd', 'e', 'g'] as const
/** 族签名：Σ血目标比 + 加槽位 + 签名强增/削弱（文案，供船长审） */
const SIG: Record<string, { hpRatio: number; slot: 'high' | 'mid' | 'low'; up: string; down: string }> = {
  a: { hpRatio: 1.15, slot: 'mid', up: '速度 +8% · 机动 +8% · 货舱 +25% · 机巢 +1 档 · 命中 +0.01', down: '结构血占比最低（薄壳）· 信号 +10%（好战显眼）' },
  c: { hpRatio: 1.25, slot: 'low', up: '甲/壳血全批最厚 · 三层抗性（甲爆炸 0.5 + 壳动能 0.25）· 机巢 +1 档', down: '速度 −12% · 机动 −12% · 护盾极薄 · 命中 −0.01' },
  d: { hpRatio: 1.28, slot: 'high', up: 'CPU 全批最高 · 命中/锁定 +15% · 甲血最厚 · 抗性双层（甲爆炸 0.5 + 盾等离子 0.25）', down: '速度 −15% · 机动 −15% · 回避 −0.01' },
  e: { hpRatio: 1.15, slot: 'low', up: '机巢全批最大 · CPU 起步高 · 护盾血占比高 · 抗性双层（盾动能 0.5 + 壳等离子 0.25）', down: '速度 −8% · 货舱 −20%（空间让给机库）' },
  g: { hpRatio: 1.12, slot: 'high', up: '回避 +0.03 · 信号 −15%（难锁定）· 速度 +5% · 无人机伤害加成最高 · 机巢 +1 档', down: '甲/壳血 −8%（轻装）· 货舱 −15%' },
}
/** T1 三艘（现比 0.60~0.72，先补到不弱于官方）单独给口径 */
const T1_RATIO: Record<string, number> = { a: 1.05, c: 1.15, d: 1.12, e: 1.12, g: 1.1 }

const slotOf = (s: ShipDef): Record<string, number | undefined> => s.slots as unknown as Record<string, number | undefined>
const sumHp = (s: ShipDef): number => (s.shieldHp ?? 0) + (s.armorHp ?? 0) + (s.hullHp ?? 0)
const median = (xs: number[]): number => {
  const v = [...xs].sort((a, b) => a - b)
  if (v.length === 0) return 0
  const m = Math.floor(v.length / 2)
  return v.length % 2 === 1 ? (v[m] as number) : ((v[m - 1] as number) + (v[m] as number)) / 2
}
const r5 = (n: number): number => Math.max(5, Math.round(n / 5) * 5)

const wh = SHIPS.filter((s) => s.id.startsWith('sh-wh-'))
const base = SHIPS.filter((s) => !s.id.startsWith('sh-wh-'))
const famOf = (s: ShipDef): string => s.id.split('-')[2] ?? '?'

console.log('| 舰船 | 档/角色 | 现 Σ血 | 参照中位 | 现比 | Σ血建议 | 现 CPU | CPU 建议 | +槽位 | 建议后比 |')
console.log('|---|---|---|---|---|---|---|---|---|---|')
const ratios: number[] = []
for (const s of wh.sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id))) {
  const fam = famOf(s)
  const sig = SIG[fam]!
  const peersExact = base.filter((b) => b.tier === s.tier && b.role === s.role)
  // 无"同档同角色"官方船时（如 T1 重装护卫）退化用**同档武装舰**——绝不用"同档全体"
  // （那会把采矿船 18 血算进参照，导致比例虚高）
  const peers =
    peersExact.length > 0
      ? peersExact
      : base.filter((b) => b.tier === s.tier && b.role === 'armed').length > 0
        ? base.filter((b) => b.tier === s.tier && b.role === 'armed')
        : base.filter((b) => b.tier === s.tier)
  const refHp = median(peers.map(sumHp))
  const refCpu = median(peers.map((p) => p.cpu ?? 0))
  const ratio = s.tier === 1 ? T1_RATIO[fam]! : sig.hpRatio
  const targetHp = r5(refHp * ratio)
  const newHp = Math.max(sumHp(s), targetHp) // 只增不减（已超标的 C/D 保留）
  const k = sumHp(s) === 0 ? 1 : newHp / sumHp(s)
  const famCpu = MODULES.filter((m) => m.id.startsWith(`mod-wh-${fam}-`)).reduce((a, m) => a + m.cpuUse, 0) /
    Math.max(1, MODULES.filter((m) => m.id.startsWith(`mod-wh-${fam}-`)).length)
  const targetCpu = Math.max(r5(refCpu * 1.1), r5((s.cpu ?? 0) + famCpu))
  ratios.push(newHp / refHp)
  console.log(
    `| ${s.name} \`${s.id}\` | T${s.tier}/${s.role} | ${sumHp(s)} | ${refHp} | ${(sumHp(s) / refHp).toFixed(2)} |` +
      ` **${newHp}**（×${k.toFixed(2)}） | ${s.cpu ?? 0} | **${targetCpu}** | ${sig.slot === 'high' ? '高槽' : sig.slot === 'mid' ? '中槽' : '低槽'} | ${(newHp / refHp).toFixed(2)} |`,
  )
}
const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length
console.log(`\n**平均强度（Σ血 / 同档中位）**：现 ${(1.038).toFixed(3)} ⇒ 建议后 **${avg.toFixed(3)}**（船长口径 ≥1.10）`)
console.log('\n族签名（强增 / 削弱）：')
for (const f of FAMS) {
  const sig = SIG[f]!
  console.log(`  ${f.toUpperCase()} · +1 ${sig.slot === 'high' ? '高槽' : sig.slot === 'mid' ? '中槽' : '低槽'} · 强增：${sig.up}\n      削弱：${sig.down}`)
}
