/**
 * **敌人明细导出（Excel）**——船长 2026-09-17：「**能否将所有敌人的详细数据单独输出一个excel表格
 * （之前的工具输出都太过粗糙，数据不详细）**」⇒ 追问后收窄：「**只需要敌舰明细。**」
 *
 * 产出（默认目录 `foe-csv/`，可传参改）：
 *   - `enemy-ships.xlsx` —— 主格式：**一张「敌舰明细」sheet**，每个敌舰级一行（列见下）；
 *   - `enemy-ships.csv` —— 同列同序的纯文本版（公式列在此按引擎口径算成数值），便于 git diff / 检索。
 *
 * **口径（重要）**：本表是**舰级裸值** ——
 * ① 登记原值取 `packages/data/src/foe-ships.ts`（`hp` / `split` / `shotDmg` / `reloadMs` / `hitRate` /
 *    射程带 / `falloff` / `blindDmgMul` / `dmgMix` / `energyForm` / `tactic` / 三层三系抗性 / `evasion` /
 *    `speedRatio` / `mounts` / `repairPct` / `drones` / `elite`）；
 * ② 派生列走引擎**同一把尺**：三层血 = `hp × split`；名义 DPS = `单发 × 1000 ÷ 装填`（**不含命中率与
 *    距离衰减**，与 `bounty:stats` 同口径）；伤害分系按 `dmgMix` 归一后摊分；实速 = 舰种基准速度
 *    （`balance.battle.hullClassBaseSpeedMps`）× `speedRatio` 取整；期望交距 = `desireRangeM` ??
 *    `round(射程下限 + tacticDesireFactor × 带宽)`（夹 `minDistanceM` 下限，与 `combat.foeDesiredRange` 同式）；
 *    挂载件走 `foeMounts.resolveFoeMounts`（解析冲锋/冷却/无人机与炮台射程倍率/捕获网）。
 * ③ **不含卡级覆写**：同一舰级在不同卡上还会有条目级 `hpMul` / `dmgMul` / `rangeMul` / `split` /
 *    `tactic` / `mounts` / `droneFireShare`、多舰补偿与"舰体越线折扣"——那些是**每卡实算值**，
 *    要看它们请跑 `npm run bounty:stats`（本表刻意不做卡，免得两套口径混在一张表里）。
 * ④ 最右四列是 **Excel 公式"试算列"**（引用本行左侧单元格）——改单发/装填/总血/占比即可就地看变化；
 *    它们**不是引擎算的**，引擎口径的对应列在左侧。
 *
 * 用法：`npx tsx tools/foe-export.ts [输出目录]`（等价 `npm run foe:export`）
 *
 * **版本自检**
 * - 游戏版本：**v25**（`CURRENT_STATE_VERSION` · 本工具只读目录，不碰存档）
 * - 本工具最后核对：**2026-09-17**（首版：25 条敌舰级 · 单 sheet · 公式试算列 · CSV 同名同列）
 * - 本工具最后跑过：**2026-09-17**
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { buildSimContext, FOE_SHIPS } from '@whale/data'
import { resolveFoeMounts, type FoeShipDef, type DamageType } from '@whale/core'

const OUT_DIR = process.argv[2] ?? 'foe-csv'
const ctx = buildSimContext()
const bal = ctx.balance.battle

/** 三系中文名（与 `wormholeFoes.ts` 的展示表同字） */
const DMG_TEXT: Record<DamageType, string> = { kinetic: '动能', explosive: '高爆', plasma: '能量' }
const DMG_ORDER: readonly DamageType[] = ['kinetic', 'explosive', 'plasma']
const TACTIC_TEXT: Record<string, string> = { brawl: '贴身（brawl）', orbit: '环绕（orbit）', kite: '放风筝（kite）' }
const HULL_TEXT: Record<number, string> = { 1: '护卫舰', 2: '驱逐舰', 3: '巡洋舰', 4: '战列舰', 5: '旗舰' }
/** 舰种基准速度（引擎唯一出处；敌我共用） */
const baseSpeed = (tier: number): number => bal.hullClassBaseSpeedMps[tier as 1 | 2 | 3 | 4 | 5] ?? 0
const pct = (v: number | undefined): number => (Number.isFinite(v) ? (v as number) : 0)
const round1 = (v: number): number => Math.round(v * 10) / 10
const round2 = (v: number): number => Math.round(v * 100) / 100
const RESIST_KEY: Record<DamageType, 'kinetic' | 'explosive' | 'plasma'> = {
  kinetic: 'kinetic',
  explosive: 'explosive',
  plasma: 'plasma',
}

/** 一行的全部取值（写 xlsx 与 csv 共用，避免两处漂移） */
interface Row {
  cells: Array<string | number>
  /** 试算列（Excel 公式）：{ 列下标（0 基）, 公式（含行号占位 {r}） } */
  formulas: Array<{ col: number; formula: string }>
}

function rowOf(s: FoeShipDef): Row {
  const mix = s.dmgMix ?? {}
  const mixSum = DMG_ORDER.reduce((a, t) => a + pct(mix[t]), 0)
  const share = (t: DamageType): number => (mixSum > 0 ? pct(mix[t]) / mixSum : t === 'kinetic' ? 1 : 0)
  const dps = (s.shotDmg * 1000) / Math.max(1, s.reloadMs)
  const isBeam = share('plasma') >= share('kinetic') && share('plasma') >= share('explosive') && (s.energyForm ?? 'beam') === 'beam'
  const mount = resolveFoeMounts(s.mounts)
  const band = { min: s.rangeMinM, max: s.rangeMaxM }
  const pos = Math.min(0.95, Math.max(0.05, bal.tacticDesireFactor[s.tactic] ?? 0.5))
  const desire = Number.isFinite(s.desireRangeM)
    ? Math.round(s.desireRangeM as number)
    : Math.max(bal.minDistanceM, Math.round(band.min + pos * (band.max - band.min)))
  /** 挨打后射程倍率：挂载件优先、旧字段兜底（与 `createFoeSpecsFromShips` 同一优先级） */
  const droneRangeMul = mount.foeDroneRangeMulOnHit ?? s.droneRangeMulOnHit
  const gunRangeMul = mount.foeGunRangeMulOnHit ?? s.gunRangeMulOnHit
  const charge = mount.foeCanCharge === true || s.foeCanCharge === true
  const chargeMul = mount.foeChargeMul ?? s.foeChargeMul ?? bal.foeChargeMul
  const chargeCoolMs = mount.foeChargeCooldownMs ?? bal.foeChargeCooldownMs
  const drones = s.drones ?? []
  const droneText = drones
    .map((d) => `${d.drone.name}×${d.count}（单发 ${d.drone.dmg} · ${d.drone.reloadMs / 1000} 秒 · 射程 ${d.drone.maxRangeM}）`)
    .join('；')
  const droneDps = drones.reduce((a, d) => a + (d.count * d.drone.dmg * 1000) / Math.max(1, d.drone.reloadMs), 0)
  const mixText =
    mixSum > 0
      ? DMG_ORDER.filter((t) => pct(mix[t]) > 0)
          .map((t) => `${DMG_TEXT[t]} ${round2(share(t))}`)
          .join(' : ')
      : '纯动能'

  const cells: Array<string | number> = [
    // ── A 标识 ──
    s.id,
    s.name,
    s.family,
    s.hullClassTier,
    HULL_TEXT[s.hullClassTier] ?? String(s.hullClassTier),
    s.elite === true ? '是' : '',
    TACTIC_TEXT[s.tactic] ?? s.tactic,
    // ── B 血量 ──
    round1(s.hp),
    round1(s.hp * s.split.s),
    round1(s.hp * s.split.a),
    round1(s.hp * s.split.h),
    round2(s.split.s),
    round2(s.split.a),
    round2(s.split.h),
    // ── C 抗性（三层×三系）──
    round2(pct(s.shieldResist?.[RESIST_KEY.kinetic])),
    round2(pct(s.shieldResist?.[RESIST_KEY.explosive])),
    round2(pct(s.shieldResist?.[RESIST_KEY.plasma])),
    round2(pct(s.armorResist?.[RESIST_KEY.kinetic])),
    round2(pct(s.armorResist?.[RESIST_KEY.explosive])),
    round2(pct(s.armorResist?.[RESIST_KEY.plasma])),
    round2(pct(s.hullResist?.[RESIST_KEY.kinetic])),
    round2(pct(s.hullResist?.[RESIST_KEY.explosive])),
    round2(pct(s.hullResist?.[RESIST_KEY.plasma])),
    // ── D 火力 ──
    s.shotDmg,
    s.reloadMs,
    round1(s.reloadMs / 1000),
    round2(s.hitRate),
    isBeam ? '能量光束 · 必中' : '掷命中 · 吃命中率与距离衰减',
    mixText,
    round1(dps),
    round1(dps * share('kinetic')),
    round1(dps * share('explosive')),
    round1(dps * share('plasma')),
    s.rangeMinM,
    s.rangeMaxM,
    desire,
    s.desireRangeM !== undefined ? '卡/舰级覆写' : '按战术推导',
    round2(s.falloff ?? bal.foeFalloff),
    round2(s.blindDmgMul ?? 0.3),
    round2(s.evasion ?? 0.12),
    Math.round(baseSpeed(s.hullClassTier) * s.speedRatio),
    round2(s.speedRatio),
    // ── E 挂载与特性 ──
    s.mounts && s.mounts.length > 0 ? `${s.mounts.join('、')}（${mount.names.join('、')}）` : '',
    charge ? '是' : '',
    charge ? round2(chargeMul) : '',
    charge ? Math.round(chargeCoolMs / 1000) : '',
    mount.foeCaptureWeb ? `是（机动 ×${mount.foeCaptureWeb.mobilityMul} · ${Math.round(mount.foeCaptureWeb.durationMs / 1000)} 秒）` : '',
    droneRangeMul !== undefined ? round2(droneRangeMul) : '',
    gunRangeMul !== undefined ? round2(gunRangeMul) : '',
    s.repairPct !== undefined ? round2(s.repairPct) : '',
    droneText,
    droneDps > 0 ? round1(droneDps) : '',
    // ── F 试算列（公式；值先占位，写完行号后回填）──
    0,
    0,
    0,
    0,
  ]
  return { cells, formulas: [] }
}

/** 列定义（表头 + 口径批注 + 列宽 + 数字格式），顺序与 `rowOf` 的 cells 一致 */
interface Col {
  head: string
  note: string
  width: number
  fmt?: string
}
const COLS: Col[] = [
  { head: 'id', note: '舰级 id（data/foe-ships.ts）', width: 26 },
  { head: '名称', note: '玩家可见舰级名', width: 20 },
  { head: '敌族', note: 'A 海盗 / C 异形 / D 守墓 / E 巨构 / G 亡军 …', width: 8 },
  { head: '舰种档', note: '1 护卫舰 · 2 驱逐舰 · 3 巡洋舰 · 4 战列舰 · 5 旗舰（决定速度基准与编成）', width: 9 },
  { head: '舰种名', note: '', width: 9 },
  { head: '精锐', note: '头目档：显示名加「精锐」前缀', width: 7 },
  { head: '战术', note: 'brawl 贴身 / orbit 环绕 / kite 放风筝（决定期望交距与接近速度）', width: 16 },
  { head: '总血', note: 'hp（舰级裸值；卡上可再乘条目级 hpMul 与多舰补偿）', width: 10, fmt: '#,##0' },
  { head: '结构血', note: '= 总血 × 结构占比（引擎不取整，本表留 1 位小数）', width: 10, fmt: '#,##0.0' },
  { head: '装甲血', note: '= 总血 × 装甲占比', width: 10, fmt: '#,##0.0' },
  { head: '护盾血', note: '= 总血 × 护盾占比', width: 10, fmt: '#,##0.0' },
  { head: '结构占比', note: 'split.s', width: 9, fmt: '0%' },
  { head: '装甲占比', note: 'split.a', width: 9, fmt: '0%' },
  { head: '护盾占比', note: 'split.h（三层占比之和 = 1）', width: 9, fmt: '0%' },
  { head: '护盾抗·动能', note: '整层受到的动能伤害 ×(1 − 本值)；空 = 0', width: 12, fmt: '0%' },
  { head: '护盾抗·高爆', note: '', width: 12, fmt: '0%' },
  { head: '护盾抗·能量', note: '', width: 12, fmt: '0%' },
  { head: '装甲抗·动能', note: '', width: 12, fmt: '0%' },
  { head: '装甲抗·高爆', note: '', width: 12, fmt: '0%' },
  { head: '装甲抗·能量', note: '', width: 12, fmt: '0%' },
  { head: '结构抗·动能', note: '', width: 12, fmt: '0%' },
  { head: '结构抗·高爆', note: '', width: 12, fmt: '0%' },
  { head: '结构抗·能量', note: 'C 族三层各 25% 高爆抗即写在这里', width: 12, fmt: '0%' },
  { head: '单发', note: 'shotDmg（舰级裸值；卡上条目级 dmgMul 与越线折扣不在此表）', width: 8, fmt: '#,##0' },
  { head: '装填(毫秒)', note: 'reloadMs', width: 11, fmt: '#,##0' },
  { head: '装填(秒)', note: '= 装填 ÷ 1000', width: 9, fmt: '0.0' },
  { head: '命中率', note: 'hitRate（**能量光束必中时不消费本值**，见下「命中模型」列）', width: 8, fmt: '0%' },
  { head: '命中模型', note: '能量主系且 energyForm=beam ⇒ 必中；否则掷命中 + 距离衰减', width: 24 },
  { head: '伤害构成', note: 'dmgMix 归一后占比（空白 = 纯动能）', width: 22 },
  { head: '名义DPS', note: '= 单发 × 1000 ÷ 装填；**不含命中率与距离衰减**（与 bounty:stats 同口径）', width: 10, fmt: '#,##0.0' },
  { head: 'DPS·动能', note: '名义 DPS × 动能在 dmgMix 中的占比', width: 10, fmt: '#,##0.0' },
  { head: 'DPS·高爆', note: '', width: 10, fmt: '#,##0.0' },
  { head: 'DPS·能量', note: '', width: 10, fmt: '#,##0.0' },
  { head: '射程下限', note: 'rangeMinM（贴到比它更近 ⇒ 敌进入近盲带，伤害 ×近盲倍率）', width: 10, fmt: '#,##0' },
  { head: '射程上限', note: 'rangeMaxM', width: 10, fmt: '#,##0' },
  { head: '期望交距', note: '= desireRangeM ?? round(下限 + tacticDesireFactor × 带宽)，夹 minDistanceM', width: 10, fmt: '#,##0' },
  { head: '交距来源', note: '「覆写」= 舰级写了 desireRangeM；「按战术推导」= 引擎默认式', width: 12 },
  { head: '远端衰减', note: 'fixed 走命中衰减（远端 = 本值）；光束走威力衰减（本值越大越轻）', width: 10, fmt: '0%' },
  { head: '近盲倍率', note: '玩家进敌近盲带时敌伤害 ×本值（缺省 0.3）', width: 10, fmt: '0%' },
  { head: '闪避', note: '我方武器命中率 = (武器命中 + 加成 − 本值) × 距离折减（缺省 0.12）', width: 8, fmt: '0%' },
  { head: '实速(m/s)', note: '= 舰种基准速度 × speedRatio，取整（编成条目 speedMul 不在此表）', width: 10, fmt: '#,##0' },
  { head: '速度倍率', note: 'speedRatio（data 里写成精确分数，本列是它的数值）', width: 10, fmt: '0.000' },
  { head: '挂载件', note: 'id（名称）；解析口径 = foeMounts.resolveFoeMounts（条目级覆写不在此表）', width: 34 },
  { head: '冲锋', note: '挂载件或旧字段给的冲锋资格（不受全局开关与威胁门槛约束）', width: 8 },
  { head: '冲锋倍率', note: '触发后自身机动 ×本值；缺省 = 全局 foeChargeMul', width: 10, fmt: '0.00' },
  { head: '冲锋冷却(秒)', note: '命中我方后解除冲锋并进入本冷却', width: 12, fmt: '#,##0' },
  { head: '捕获网', note: '挂载件「劫掠捕获网」：命中后网住目标（机动×/时长）', width: 30 },
  { head: '挨打后机群射程×', note: '母舰被命中一次 ⇒ 全部机群射程 ×本值（本场永久）；挂载件优先、旧字段兜底', width: 16, fmt: '0.00' },
  { head: '挨打后炮台射程×', note: '同上，作用面是炮台', width: 16, fmt: '0.00' },
  { head: '后勤修理', note: 'repairPct：开火伤害 ×(1−本值)，扣下的那半按秒转修理（详见 types.ts 注）', width: 10, fmt: '0%' },
  { head: '机群', note: '机型 × 架数（含机型单发/装填/射程）；打光不补充', width: 46 },
  { head: '机群名义DPS', note: '各机型 架数 × 单发 × 1000 ÷ 装填 之和（名义，不含命中与衰减）', width: 12, fmt: '#,##0.0' },
  { head: 'DPS(试算)', note: '**Excel 公式**：= 单发 × 1000 ÷ 装填(毫秒)。改左侧数字即可就地试算', width: 11, fmt: '#,##0.0' },
  { head: '结构血(试算)', note: '**Excel 公式**：= 总血 × 结构占比', width: 12, fmt: '#,##0.0' },
  { head: '装甲血(试算)', note: '**Excel 公式**：= 总血 × 装甲占比', width: 12, fmt: '#,##0.0' },
  { head: '护盾血(试算)', note: '**Excel 公式**：= 总血 × 护盾占比', width: 12, fmt: '#,##0.0' },
]

const colLetter = (i: number): string => {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
/** 试算列要引用的列下标（按表头取，改列序不会错位） */
const idxOf = (head: string): number => {
  const i = COLS.findIndex((c) => c.head === head)
  if (i < 0) throw new Error(`列定义里没有「${head}」`)
  return i
}
const I_SHOT = idxOf('单发')
const I_RELOAD = idxOf('装填(毫秒)')
const I_HP = idxOf('总血')
const I_SHARE_S = idxOf('结构占比')
const I_SHARE_A = idxOf('装甲占比')
const I_SHARE_H = idxOf('护盾占比')
const F_DPS = idxOf('DPS(试算)')
const F_HS = idxOf('结构血(试算)')
const F_HA = idxOf('装甲血(试算)')
const F_HH = idxOf('护盾血(试算)')

const rows = [...FOE_SHIPS]
  .sort((a, b) => a.family.localeCompare(b.family) || a.hullClassTier - b.hullClassTier || a.id.localeCompare(b.id))
  .map((s) => ({ ship: s, row: rowOf(s) }))

async function main(): Promise<void> {
mkdirSync(OUT_DIR, { recursive: true })

/* ── ① xlsx（一张 sheet：敌舰明细） ── */
const wb = new ExcelJS.Workbook()
wb.creator = '大鲸鱼-深空放置 · tools/foe-export.ts'
const ws = wb.addWorksheet('敌舰明细', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] })
ws.columns = COLS.map((c) => ({ header: c.head, width: c.width }))
const head = ws.getRow(1)
COLS.forEach((c, i) => {
  const cell = head.getCell(i + 1)
  cell.font = { bold: true }
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3F8' } }
  if (c.note.length > 0) cell.note = c.note
})
head.height = 30
rows.forEach(({ row }, ri) => {
  const excelRow = ws.getRow(ri + 2)
  row.cells.forEach((v, ci) => {
    const cell = excelRow.getCell(ci + 1)
    cell.value = v as ExcelJS.CellValue
    const fmt = COLS[ci]?.fmt
    if (fmt !== undefined && typeof v === 'number') cell.numFmt = fmt
  })
  // 试算列：Excel 公式（引用本行左侧单元格 ⇒ 改数即重算）
  const r = ri + 2
  excelRow.getCell(F_DPS + 1).value = { formula: `${colLetter(I_SHOT)}${r}*1000/${colLetter(I_RELOAD)}${r}` }
  excelRow.getCell(F_HS + 1).value = { formula: `${colLetter(I_HP)}${r}*${colLetter(I_SHARE_S)}${r}` }
  excelRow.getCell(F_HA + 1).value = { formula: `${colLetter(I_HP)}${r}*${colLetter(I_SHARE_A)}${r}` }
  excelRow.getCell(F_HH + 1).value = { formula: `${colLetter(I_HP)}${r}*${colLetter(I_SHARE_H)}${r}` }
  for (const ci of [F_DPS, F_HS, F_HA, F_HH]) excelRow.getCell(ci + 1).numFmt = COLS[ci]!.fmt!
})
ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: COLS.length } }
const xlsxPath = join(OUT_DIR, 'enemy-ships.xlsx')
await wb.xlsx.writeFile(xlsxPath)

/* ── ② csv（同列同序；试算列在这里由本工具按引擎口径算成数值，保证 csv 自洽） ── */
const csvCell = (v: string | number): string => {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csvLines = [COLS.map((c) => csvCell(c.head)).join(',')]
for (const { row } of rows) {
  const vals = [...row.cells]
  const shot = Number(vals[I_SHOT])
  const reload = Number(vals[I_RELOAD])
  const hp = Number(vals[I_HP])
  vals[F_DPS] = round1((shot * 1000) / Math.max(1, reload))
  vals[F_HS] = round1(hp * Number(vals[I_SHARE_S]))
  vals[F_HA] = round1(hp * Number(vals[I_SHARE_A]))
  vals[F_HH] = round1(hp * Number(vals[I_SHARE_H]))
  csvLines.push(vals.map(csvCell).join(','))
}
const csvPath = join(OUT_DIR, 'enemy-ships.csv')
writeFileSync(csvPath, '\ufeff' + csvLines.join('\r\n') + '\r\n', 'utf8')

/* ── ③ 自检读数（顺便给船长几条能一眼核对的数） ── */
const byFamily = new Map<string, number>()
for (const { ship } of rows) byFamily.set(ship.family, (byFamily.get(ship.family) ?? 0) + 1)
const topHp = [...rows].sort((a, b) => b.ship.hp - a.ship.hp)[0]!
const topDps = [...rows].sort(
  (a, b) => (b.ship.shotDmg * 1000) / b.ship.reloadMs - (a.ship.shotDmg * 1000) / a.ship.reloadMs,
)[0]!
const withDrones = rows.filter(({ ship }) => (ship.drones ?? []).length > 0).length
const withMounts = rows.filter(({ ship }) => (ship.mounts ?? []).length > 0).length
console.log(`✅ 敌舰明细已导出（${rows.length} 个舰级 · ${COLS.length} 列）`)
console.log(`   xlsx：${join(process.cwd(), xlsxPath)}`)
console.log(`   csv ：${join(process.cwd(), csvPath)}`)
console.log(`· 按族：${[...byFamily].map(([f, n]) => `${f} ${n}`).join(' · ')}`)
console.log(`· 最高总血：${topHp.ship.name} ${topHp.ship.hp.toLocaleString('zh-CN')}`)
console.log(`· 最高名义 DPS：${topDps.ship.name} ${((topDps.ship.shotDmg * 1000) / topDps.ship.reloadMs).toFixed(1)}`)
console.log(`· 带机群 ${withDrones} 条 · 带挂载件 ${withMounts} 条`)
console.log('· 试算列是 Excel 公式（引用本行），引擎口径的对应列在左侧；卡级实算值请看 npm run bounty:stats')
}

void main().catch((err: unknown) => {
  console.error('导出失败：', err)
  process.exit(1)
})
