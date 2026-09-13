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

// ─────────────── §5 相对官方同档船的强弱（回答"稀有船是否强一档"） ───────────────
const sumHp = (s: ShipDef): number => (s.shieldHp ?? 0) + (s.armorHp ?? 0) + (s.hullHp ?? 0)
const sumSlots = (s: ShipDef): number => {
  const sl = slotOf(s)
  return (sl.high ?? 0) + (sl.mid ?? 0) + (sl.low ?? 0)
}
const median = (xs: number[]): number => {
  const v = [...xs].sort((a, b) => a - b)
  if (v.length === 0) return 0
  const m = Math.floor(v.length / 2)
  return v.length % 2 === 1 ? (v[m] as number) : ((v[m - 1] as number) + (v[m] as number)) / 2
}
const ratio = (a: number, b: number): string => (b === 0 ? '—' : `${a / b >= 1 ? '+' : ''}${((a / b - 1) * 100).toFixed(0)}%`)
P('## §5 相对"官方同档船"的强弱（机械对比：中位数为基准）')
P()
P('> 参照组 = **同 `tier` 同 `role` 的非虫洞船**（官方 27 艘）中位数。正值 = 本批更强。')
P('> Σ血 = 盾+甲+壳；槽合计 = 高+中+低。')
P()
P('| 舰船 | Σ血 本批 / 同档中位 | 差 | CPU 本批 / 中位 | 差 | 槽合计 本批 / 中位 | 差 | 机巢 本批 / 中位 | 差 | 命中差 | 回避差 |')
P('|---|---|---|---|---|---|---|---|---|---|---|')
const verdict = { stronger: 0, same: 0, weaker: 0 }
for (const s of wh.sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id))) {
  const peers = bandOf(s)
  if (peers.length === 0) {
    P(`| ${s.name} \`${s.id}\` | ${sumHp(s)} / **无同档参照** | — | ${s.cpu ?? 0} | — | ${sumSlots(s)} | — | ${s.droneBayM3 ?? 0} | — | — | — |`)
    continue
  }
  const hpM = median(peers.map(sumHp))
  const cpuM = median(peers.map((p) => p.cpu ?? 0))
  const slotM = median(peers.map(sumSlots))
  const bayM = median(peers.map((p) => p.droneBayM3 ?? 0))
  const hitM = median(peers.map((p) => p.hitBonus ?? 0))
  const evaM = median(peers.map((p) => p.evasion ?? 0))
  const r = hpM === 0 ? 1 : sumHp(s) / hpM
  if (r >= 1.1) verdict.stronger++
  else if (r <= 0.95) verdict.weaker++
  else verdict.same++
  P(
    `| ${s.name} \`${s.id}\` | ${sumHp(s)} / ${fmt(hpM)} | **${ratio(sumHp(s), hpM)}** | ${s.cpu ?? 0} / ${fmt(cpuM)} | ${ratio(s.cpu ?? 0, cpuM)} |` +
      ` ${sumSlots(s)} / ${fmt(slotM)} | ${ratio(sumSlots(s), slotM)} | ${s.droneBayM3 ?? 0} / ${fmt(bayM)} | ${ratio(s.droneBayM3 ?? 0, bayM)} |` +
      ` ${((s.hitBonus ?? 0) - hitM >= 0 ? '+' : '') + ((s.hitBonus ?? 0) - hitM).toFixed(2)} | ${((s.evasion ?? 0) - evaM >= 0 ? '+' : '') + ((s.evasion ?? 0) - evaM).toFixed(2)} |`,
  )
}
P()
P(`**判定**：以 Σ血 为准，明显更强（≥ +10%）**${verdict.stronger}** 艘 · 同档（−5%~+10%）**${verdict.same}** 艘 · 偏弱（≤ −5%）**${verdict.weaker}** 艘。`)
P()
P('⇒ **现状 = 与官方同档船基本持平（"+0 档"），没有实现"稀有船强一档"**；若要落实"强一档"，见 §6 待定口径。')
P()
P('## §6 待船长定的加强口径（未动数据）')
P()
P('| 方案 | 内容 | 优点 | 风险 |')
P('|---|---|---|---|')
P('| **A 稀有加成（推荐）** | 全批 **Σ血 +15%**（三层等比）· **CPU +10%** · **机巢 +1 档** · **按角色补船体抗性** · **T3 巡洋舰补族武 +0.12** · 槽位**不动** | 耐打+能装，但不直接抬 DPS；与"稀有"匹配 | 玩家存活更久 ⇒ 洞内难度曲线要同步（一号 `wormhole:econ`） |')
P('| **B 只加防御** | 仅 Σ血 +20% + 船体抗性 + 机巢 | 最不影响输出侧平衡 | 手感"更肉但不更强"，稀有感弱 |')
P('| **C 加火力** | 槽位 +1（高槽）· CPU +15% · Σ血 +15% | 稀有感最强 | 直接抬 DPS ⇒ 与一号的洞内/悬赏难度校准强耦合，回归面最大 |')
P('| **D 不加数值** | 只补抗性/族武/机巢这些"身份件"，靠一次性图纸 + 虚空晶体现稀有 | 零平衡风险 | 你要的"强一档"没落地 |')
P()
P('> ⚠ 三条硬约束（无论选哪个方案）：① 槽位与 CPU 一动就影响**装配可行性**（content:check 的槽位/CPU 契约）；')
P('> ② Σ血一动就影响**战斗时长与胜率**，一号正在跑的洞内难度校准会跟着变；')
P('> ③ 抗性/族武/机巢是"身份加成"，改动面最小、最像"稀有船"。')
P()
P('## §7 复现')
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
