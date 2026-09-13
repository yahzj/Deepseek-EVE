/**
 * **虫洞舰船数值审查表**（正式入库 · 2026-09-13）——把 15 艘虫洞专属舰船的**全字段**导出成
 * 一张可审的 Markdown 表，并机械标注两类问题：
 *   ① **越界**：该字段超出「同角色 × 同档既有船」的区间（既有船 = 27 艘非虫洞船）；
 *   ② **缺项**：既有船**普遍有**、而本批**全空**的字段（船体三层抗性 / 族系武器加成）——
 *      这类"整批缺一层"靠逐艘看是看不出来的，必须机器点名。
 *
 * 用法：
 *   npx tsx tools/wh-ships-review.ts                 # 打印摘要
 *   npx tsx tools/wh-ships-review.ts --write         # 另写 docs/design/wormhole-ships-review-20260913.md
 *
 * 口径：
 * - 数据**只读代码**（`packages/data/src/ships.ts` / `shipBlueprints.ts`），不手抄、不算派生值；
 * - 区间 = 既有船中同 `tier` 同 `role` 的最小~最大（该组合只有 1 艘时区间退化为单值，仍会标越界）；
 * - 越界**不等于错**（族签名允许刻意分化），只是"要船长看一眼"的清单。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v25**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-13**（当日核对：`ShipDef` 字段表 · 15 艘 `sh-wh-*` · 27 艘既有船 · 一次性船图纸字段 `shipId`）
 *   - 判据：`CURRENT_STATE_VERSION − v25 ≥ 2` ⇒ **必须重跑核对**（存档结构跨了一个大版本）
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SHIPS, SHIP_BLUEPRINTS } from '@whale/data'
import type { ShipDef } from '@whale/core'

const WH_PREFIX = 'sh-wh-'
const FAMS = ['a', 'c', 'd', 'e', 'g'] as const
const FAM_NAME: Record<string, string> = {
  a: 'A 族 · 掠袭（海盗掠夺）',
  c: 'C 族 · 巢群（生体甲壳）',
  d: 'D 族 · 陵墓（重装炮台）',
  e: 'E 族 · 巨构（自建支援）',
  g: 'G 族 · 亡军（隐身机群）',
}
/** 审查列（顺序即表格列序） */
const NUM_COLS: Array<{ key: string; label: string; get: (s: ShipDef) => number }> = [
  { key: 'high', label: '高槽', get: (s) => slotOf(s).high ?? 0 },
  { key: 'mid', label: '中槽', get: (s) => slotOf(s).mid ?? 0 },
  { key: 'low', label: '低槽', get: (s) => slotOf(s).low ?? 0 },
  { key: 'cpu', label: 'CPU', get: (s) => s.cpu ?? 0 },
  { key: 'power', label: '电力', get: (s) => s.powerBonus ?? 0 },
  { key: 'shield', label: '盾血', get: (s) => s.shieldHp ?? 0 },
  { key: 'armor', label: '甲血', get: (s) => s.armorHp ?? 0 },
  { key: 'hull', label: '壳血', get: (s) => s.hullHp ?? 0 },
  { key: 'bay', label: '机巢m³', get: (s) => s.droneBayM3 ?? 0 },
  { key: 'hit', label: '命中', get: (s) => s.hitBonus ?? 0 },
  { key: 'evasion', label: '回避', get: (s) => s.evasion ?? 0 },
  { key: 'speed', label: '速度', get: (s) => s.maxSpeedMps ?? 0 },
  { key: 'agility', label: '机动', get: (s) => s.agility ?? 0 },
  { key: 'signal', label: '信号', get: (s) => s.signatureM ?? 0 },
  { key: 'cargo', label: '货舱', get: (s) => s.cargoM3 },
]

function slotOf(s: ShipDef): Record<string, number | undefined> {
  return s.slots as unknown as Record<string, number | undefined>
}

const wh = SHIPS.filter((s) => s.id.startsWith(WH_PREFIX))
const base = SHIPS.filter((s) => !s.id.startsWith(WH_PREFIX))
/** 同档同角色的既有船（判越界用的参照组） */
const bandOf = (s: ShipDef): ShipDef[] =>
  base.filter((b) => b.tier === s.tier && b.role === s.role)

/** 该舰在某一列是否越界（无参照组 ⇒ 不算越界，标"无参照"） */
function outOfBand(s: ShipDef, col: (typeof NUM_COLS)[number]): '越界' | '无参照' | '' {
  const peers = bandOf(s)
  if (peers.length === 0) return '无参照'
  const v = col.get(s)
  const vals = peers.map(col.get)
  if (v < Math.min(...vals)) return '越界'
  if (v > Math.max(...vals)) return '越界'
  return ''
}

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2))

// ─────────────── 生成 Markdown ───────────────
const out: string[] = []
const P = (line = ''): void => out.push(line)

P('# 虫洞专属舰船 · **数值审查表**（15 艘）')
P()
P('> **状态：数据上桌，待船长逐项审改**（2026-09-13 二号导出）')
P('> 数据**只读代码**（`packages/data/src/ships.ts` / `shipBlueprints.ts`），由 `tools/wh-ships-review.ts` 导出，非手抄。')
P('> 越界 = 超出「同档 × 同角色**既有船**（27 艘非虫洞船）」的区间——**不一定错**（族签名允许刻意分化），只是请你过目。')
P()
P('## §0 本表相对上一版补了什么')
P()
P('上一版只列了槽位/CPU/三层血/速度等，**漏了两列**（船长指出）：**无人机舱`droneBayM3`** 与 **舰船加成**')
P('（`hitBonus` 命中 / `weaponFamilyBonus` 族系武器 / `droneDmgBonus` 无人机伤害 / `powerBonus` 电力输出 / `evasion` 回避）。')
P('本表全部列出，并额外列出**船体三层抗性**与**建造图纸材料**。')
P()
P('## §1 逐族明细')
P()
for (const f of FAMS) {
  const list = wh.filter((s) => s.id.startsWith(`${WH_PREFIX}${f}-`)).sort((a, b) => a.tier - b.tier)
  P(`### §1.${FAMS.indexOf(f) + 1} ${FAM_NAME[f]}`)
  P()
  P(`| 舰船 | 档 | 角色 | ${NUM_COLS.map((c) => c.label).join(' | ')} | 命中加成 | 族系武器加成 | 无人机伤害加成 | 船体抗性 | 图纸 | 建造 | 材料 |`)
  P(`|---|---|---|${NUM_COLS.map(() => '---').join('|')}|---|---|---|---|---|---|---|`)
  for (const s of list) {
    const bp = SHIP_BLUEPRINTS.find((b) => b.shipId === s.id)
    P(
      `| **${s.name}**\r\n\`${s.id}\` | T${s.tier} | ${s.role} | ${NUM_COLS.map((c) => {
        const flag = outOfBand(s, c)
        return flag === '越界' ? `**${fmt(c.get(s))}**⚠` : fmt(c.get(s))
      }).join(' | ')} | ${fmt(s.hitBonus ?? 0)} | ${
        s.weaponFamilyBonus ? JSON.stringify(s.weaponFamilyBonus) : '**—（空）**'
      } | ${s.droneDmgBonus ? fmt(s.droneDmgBonus) : '—'} | ${
        s.shieldResist || s.armorResist || s.hullResist
          ? [s.shieldResist && `盾${JSON.stringify(s.shieldResist)}`, s.armorResist && `甲${JSON.stringify(s.armorResist)}`, s.hullResist && `壳${JSON.stringify(s.hullResist)}`]
              .filter(Boolean)
              .join(' · ')
          : '**—（空）**'
      } | ${bp ? `\`${bp.id}\`` : '—'} | ${bp ? `${bp.buildSeconds}s / 造价 ${bp.buildCostIsk} ISK` : '—'} | ${
        bp ? bp.materials.map((m) => `${m.itemId}×${m.count}`).join(' · ') : '—'
      } |`,
    )
  }
  P()
}

P('## §2 同档 × 同角色既有船区间（越界判据）')
P()
P('| 档 / 角色 | 艘数 | 高/中/低槽 | CPU | 电力 | 盾/甲/壳血 | 机巢 | 命中 | 回避 | 速度 |')
P('|---|---|---|---|---|---|---|---|---|---|')
const groups = new Map<string, ShipDef[]>()
for (const s of base) {
  const k = `T${s.tier} / ${s.role}`
  groups.set(k, [...(groups.get(k) ?? []), s])
}
for (const [k, list] of [...groups.entries()].sort()) {
  const rng = (get: (s: ShipDef) => number): string => {
    const v = list.map(get)
    return Math.min(...v) === Math.max(...v) ? fmt(Math.min(...v)) : `${fmt(Math.min(...v))}~${fmt(Math.max(...v))}`
  }
  P(
    `| ${k} | ${list.length} | ${rng((s) => slotOf(s).high ?? 0)}/${rng((s) => slotOf(s).mid ?? 0)}/${rng((s) => slotOf(s).low ?? 0)} |` +
      ` ${rng((s) => s.cpu ?? 0)} | ${rng((s) => s.powerBonus ?? 0)} | ${rng((s) => s.shieldHp ?? 0)}/${rng((s) => s.armorHp ?? 0)}/${rng((s) => s.hullHp ?? 0)} |` +
      ` ${rng((s) => s.droneBayM3 ?? 0)} | ${rng((s) => s.hitBonus ?? 0)} | ${rng((s) => s.evasion ?? 0)} | ${rng((s) => s.maxSpeedMps ?? 0)} |`,
  )
}
P()

P('## §3 机器点名的待你定项')
P()
const baseWithResist = base.filter((s) => s.shieldResist || s.armorResist || s.hullResist)
const whWithResist = wh.filter((s) => s.shieldResist || s.armorResist || s.hullResist)
const baseWithFamily = base.filter((s) => s.weaponFamilyBonus)
const whWithFamily = wh.filter((s) => s.weaponFamilyBonus)
P(`1. **船体三层抗性：本批 ${whWithResist.length}/${wh.length} 艘全空，而既有船 ${baseWithResist.length}/${base.length} 艘都有**`)
P('   （既有口径按角色分：武装舰 盾动能抗 0.5 · 重装舰 甲爆炸抗 0.5 · 采矿/工业 盾动能抗 0.25 · 货舰 壳等离子抗 0.25）。')
P('   ⇒ 要么按角色给这 15 艘补上（推荐，否则"虫洞船比民船还脆"是硬差），要么明确"虫洞船靠装备件拿抗性"。')
P(`2. **族系武器加成：本批 ${whWithFamily.length}/${wh.length} 艘全空，既有船 ${baseWithFamily.length} 艘有**（全部 0.12，且都是 T3 巡洋舰：${baseWithFamily.map((s) => s.id).join(' / ')}）。`)
P('   ⇒ 若沿用既有口径，本批 5 艘 T3 巡洋舰可各给本族主弹种 +0.12；T1/T2 不给（与既有阶梯一致）。')
P(`3. **无人机伤害加成：本批仅 G 族 3 艘有**（0.14/0.10/0.06，与"G 族带蜂巢坞"一致），`)
P('   但 **E 族巨构母舰机巢 95 m³ 却无此加成**、A 族又带「掠袭机库」装备 ⇒ 机群到底归哪几族的签名，请你定。')
P('4. **越界项清单**（见 §1 表中带 ⚠ 的粗体数字）：族签名允许分化，逐项请你过目。')
P()
const flagged: string[] = []
for (const s of wh) {
  const hits = NUM_COLS.filter((c) => outOfBand(s, c) === '越界').map((c) => `${c.label}=${fmt(c.get(s))}`)
  if (hits.length > 0) {
    flagged.push(`   - **${s.name}**（T${s.tier}/${s.role}）：${hits.join(' · ')}（参照 ${bandOf(s).map((b) => `${b.id} ${b.name}`).join('、')}）`)
  }
}
P(flagged.length > 0 ? flagged.join('\r\n') : '   - （无）')
P()
P('## §4 复现')
P()
P('```')
P('npx tsx tools/wh-ships-review.ts --write    # 重出本表（数据只读代码）')
P('```')
P()
P('_维护：本表由工具生成，2026-09-13 二号首出；改数据后重跑即可，不要手改本表。_')

const md = out.join('\r\n') + '\r\n'
if (process.argv.includes('--write')) {
  const path = resolve(process.cwd(), 'docs/design/wormhole-ships-review-20260913.md')
  writeFileSync(path, md, { encoding: 'utf8' })
  console.log(`✅ 已写出 ${path}（${md.split('\r\n').length - 1} 行）`)
}
// 控制台摘要（供快速核对）
console.log(`虫洞舰船 ${wh.length} 艘 · 既有参照 ${base.length} 艘`)
for (const f of FAMS) {
  const list = wh.filter((s) => s.id.startsWith(`${WH_PREFIX}${f}-`))
  console.log(`  ${FAM_NAME[f]}：${list.map((s) => `${s.name}(T${s.tier} 机巢${s.droneBayM3 ?? 0} 命中${s.hitBonus ?? 0}${s.droneDmgBonus ? ` 无人机+${s.droneDmgBonus}` : ''})`).join(' · ')}`)
}
console.log(`缺项点名：船体抗性 ${whWithResist.length}/${wh.length} 有 · 族系武器加成 ${whWithFamily.length}/${wh.length} 有`)
console.log(`越界项：${flagged.length} 艘`)
