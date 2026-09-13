/**
 * **虫洞族专属内容·按族总览**（正式入库 · 2026-09-13）——把 A/C/D/E/G 五族的**装备 + 舰船**
 * 从代码里原样导出成一份可交付的清单（装备全字段 + 舰船"特色与加成"）。
 *
 * 用法：
 *   npx tsx tools/wh-family-review.ts            # 打印摘要
 *   npx tsx tools/wh-family-review.ts --write    # 另写 docs/design/wormhole-family-review-20260913.md
 *
 * 口径：**只读代码**（`packages/data/src/{modules,ships}.ts`），不手抄；字段按"元信息 / 效果"分组输出，
 * 新增字段会自动出现在清单里（不需要改本工具）。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0** · 存档结构：**v25**（`CURRENT_STATE_VERSION`）
 *   - 最后核对：**2026-09-13**（当日核对：五族装备 28 件 · 舰船 15 艘 · 三条船体新机制字段）
 *   - 判据：`CURRENT_STATE_VERSION − v25 ≥ 2` ⇒ 必须重跑核对
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MODULES, SHIPS } from '@whale/data'
import type { ModuleDef, ShipDef } from '@whale/core'

const FAMS = ['a', 'c', 'd', 'e', 'g'] as const
const FAM_NAME: Record<string, string> = {
  a: 'A 族 · 掠袭（海盗掠夺）',
  c: 'C 族 · 巢群（生体甲壳）',
  d: 'D 族 · 陵墓（护盾堡垒）',
  e: 'E 族 · 巨构（自建支援）',
  g: 'G 族 · 亡军（隐身机群）',
}
const META = new Set(['id', 'name', 'description', 'slot', 'rack', 'unreleased', 'exclusive'])
const SHIP_META = new Set([
  'id', 'name', 'description', 'tier', 'role', 'subClass', 'unreleased', 'priceIsk',
  'cycleSeconds', 'oreUnitsPerCycle', 'warpSpeedAus', 'massKg',
])

const fmtVal = (v: unknown): string =>
  typeof v === 'number' ? String(v) : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)

/** 装备的"效果字段"（元信息之外的键） */
function moduleEffects(m: ModuleDef): string {
  const rec = m as unknown as Record<string, unknown>
  const parts = Object.keys(rec)
    .filter((k) => !META.has(k) && rec[k] !== undefined)
    .map((k) => `${k}=${fmtVal(rec[k])}`)
  return parts.join(' · ')
}
/** 舰船的"特色与加成"（战斗相关字段） */
function shipPerks(s: ShipDef): string {
  const rec = s as unknown as Record<string, unknown>
  const parts: string[] = []
  if (rec.weaponFamilyBonus) parts.push(`族武 ${JSON.stringify(rec.weaponFamilyBonus)}`)
  if (rec.droneDmgBonus) parts.push(`无人机伤害 +${fmtVal(rec.droneDmgBonus)}`)
  if (rec.weaponRangeBonusPct) parts.push(`武器射程 ${JSON.stringify(rec.weaponRangeBonusPct)}`)
  if (rec.fleetDamageBonusPct) parts.push(`**全舰单发 +${fmtVal(rec.fleetDamageBonusPct)}（编队光环，取最高）**`)
  if (rec.wormholeScanRadiusBonus) parts.push(`**虫洞扫码 +${fmtVal(rec.wormholeScanRadiusBonus)} 圈（编队即生效、可叠加）**`)
  if (rec.hitBonus) parts.push(`命中 +${fmtVal(rec.hitBonus)}`)
  if (rec.powerBonus) parts.push(`电力 +${fmtVal(rec.powerBonus)}`)
  const res = ['shieldResist', 'armorResist', 'hullResist']
    .map((k) => (rec[k] ? `${k.replace('Resist', '')} ${JSON.stringify(rec[k])}` : ''))
    .filter(Boolean)
  if (res.length) parts.push(`抗性：${res.join(' / ')}`)
  return parts.join(' · ')
}
const shipBars = (s: ShipDef): string => {
  const rec = s as unknown as Record<string, unknown>
  const parts: string[] = []
  if (rec.evasion !== undefined) parts.push(`回避 ${fmtVal(rec.evasion)}`)
  if (rec.maxSpeedMps !== undefined) parts.push(`速 ${fmtVal(rec.maxSpeedMps)}`)
  if (rec.agility !== undefined) parts.push(`机动 ${fmtVal(rec.agility)}`)
  if (rec.cargoM3 !== undefined) parts.push(`货舱 ${fmtVal(rec.cargoM3)}`)
  if (rec.droneBayM3 !== undefined) parts.push(`机巢 ${fmtVal(rec.droneBayM3)}m³`)
  return parts.join(' · ')
}

const out: string[] = []
const P = (s = ''): void => out.push(s)
P('# 虫洞族专属内容 · **按族总览**（装备 + 舰船）')
P()
P('> **数据来源**：`tools/wh-family-review.ts` 直读代码导出（非手抄）；重跑即更新。')
P('> 状态：**2026-09-13 全部已落码**（施工期：装备/舰船/图纸均标 `unreleased`，对玩家不可见）。')
P()

for (const f of FAMS) {
  const mods = MODULES.filter((m) => m.id.startsWith(`mod-wh-${f}-`))
  const ships = SHIPS.filter((s) => s.id.startsWith(`sh-wh-${f}-`)).sort((a, b) => a.tier - b.tier)
  P(`## ${FAM_NAME[f]}（装备 ${mods.length} 件 · 舰船 ${ships.length} 艘）`)
  P()
  P('### 装备')
  P()
  P('| 装备 | id | 槽/架 | CPU | 效果字段 | 说明 |')
  P('|---|---|---|---|---|---|')
  for (const m of mods) {
    const rec = m as unknown as Record<string, unknown>
    P(`| **${m.name}** | \`${m.id}\` | ${String(rec.slot ?? '—')}/${String(rec.rack ?? '—')} | ${m.cpuUse} | ${moduleEffects(m)} | ${m.description} |`)
  }
  P()
  P('### 舰船')
  P()
  P('| 舰船 | id | 子分类 | 档/角色 | 槽 高/中/低 | CPU | 盾/甲/壳 | 机巢 | 特色与加成 | 机动侧 |')
  P('|---|---|---|---|---|---|---|---|---|---|')
  for (const s of ships) {
    const sl = s.slots as unknown as Record<string, number>
    P(
      `| **${s.name}** | \`${s.id}\` | ${s.subClass ?? '（无）'} | T${s.tier}/${s.role} | ${sl.high}/${sl.mid}/${sl.low} | ${s.cpu} |` +
        ` ${s.shieldHp}/${s.armorHp}/${s.hullHp} | ${s.droneBayM3 ?? 0} | ${shipPerks(s)} | ${shipBars(s)} |`,
    )
  }
  P()
}

const md = out.join('\r\n') + '\r\n'
if (process.argv.includes('--write')) {
  const path = resolve(process.cwd(), 'docs/design/wormhole-family-review-20260913.md')
  writeFileSync(path, md, { encoding: 'utf8' })
  console.log(`✅ 已写出 ${path}（${md.split('\r\n').length - 1} 行）`)
}
for (const f of FAMS) {
  const mods = MODULES.filter((m) => m.id.startsWith(`mod-wh-${f}-`))
  const ships = SHIPS.filter((s) => s.id.startsWith(`sh-wh-${f}-`))
  console.log(`\n【${f.toUpperCase()}】装备 ${mods.length}：${mods.map((m) => m.name).join(' · ')}`)
  for (const s of ships.sort((a, b) => a.tier - b.tier)) {
    console.log(`     舰船 ${s.name}（${s.subClass ?? '无子分类'}）：${shipPerks(s) || '—'}`)
  }
}
