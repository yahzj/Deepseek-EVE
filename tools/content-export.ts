/**
 * 内容工作台 · 导出（Phase A，2026-09-05 船长确认方案①）：
 * 把 data 包七张内容表导出为 UTF-8 + BOM 的 CSV（Excel/WPS 双击即开、中文不乱码），
 * 供船长快速浏览/筛选/排序，并在 Excel 中修改后由 tools/content-import.ts 安全回写。
 *
 * 用法：npm run content:export [输出目录]   （默认 content-csv/，已 gitignore）
 *
 * 输出约定（与 import 端一致）：
 * - 每表一个文件，第一列 = id（导入匹配键，只读）；
 * - 全部列为"引擎原值"：小数原值（0.2 = 20%）、枚举英文原值、时长毫秒/秒原值；
 *   对照说明见 docs/content-workbench.md；
 * - 嵌套结构压成紧凑字符串（| 分隔）：精炼配方 `矿物id×单位数|…`、复合产出 `物品id×权重|…`；
 * - 空单元格 = 该字段未填（引擎缺省生效）；
 * - 布尔列：是/否/空（空 = 未填 = 引擎默认）。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ANOMALIES,
  BELTS,
  ITEMS,
  MARKET_GOODS,
  MODULES,
  SHIPS,
  SKILLS,
} from '@whale/data'

type Cell = string | number | boolean | undefined | null
type Row = Record<string, Cell>
type Col = { head: string; get: (r: Row) => Cell }

const outDir = process.argv[2] ?? 'content-csv'

function esc(v: Cell): string {
  if (v === undefined || v === null) return ''
  const s = typeof v === 'boolean' ? (v ? '是' : '否') : String(v)
  return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s
}

function toCsv(heads: string[], rows: string[][]): string {
  return [heads, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n'
}

function rowsToCsv(cols: Col[], rows: Row[]): string {
  return toCsv(
    cols.map((c) => c.head),
    rows.map((r) => cols.map((c) => esc(c.get(r)))),
  )
}

/** 紧凑列表：{itemId, ...}[] → `id×单位数|id×单位数`（键名见 call） */
function packList(rows: unknown, keyName: string, valKey: string): string {
  if (!Array.isArray(rows)) return ''
  return rows.map((x) => `${(x as Record<string, unknown>)[keyName]}×${(x as Record<string, unknown>)[valKey]}`).join('|')
}

function fmt(n: unknown): Cell {
  return n === undefined || n === null ? '' : Number(n)
}

/* ═══════════ 1. 技能 ═══════════ */
const skillsCols: Col[] = [
  { head: 'id', get: (r) => r.id },
  { head: '名称', get: (r) => r.name },
  { head: '组', get: (r) => r.group },
  { head: 'rank(难度系数)', get: (r) => fmt(r.rank) },
  { head: '描述(⟦⟧高亮段须与引擎接线一致，改动后需人工复核)', get: (r) => r.description },
]

/* ═══════════ 2. 物品 ═══════════ */
const itemCols: Col[] = [
  { head: 'id', get: (r) => r.id },
  { head: '名称', get: (r) => r.name },
  { head: 'kind(ore矿石/mineral矿物/gas气体/ice冰矿/ammo弹药/drone无人机)', get: (r) => r.kind },
  { head: '单位体积m³', get: (r) => fmt(r.unitM3) },
  { head: '空间站收购价ISK', get: (r) => fmt(r.baseSellPriceIsk) },
  { head: '精炼配方(mineralId×每单位产出|…)', get: (r) => packList(r.refine, 'mineralId', 'perOre') },
  { head: '精炼批量(单位/批)', get: (r) => fmt(r.refineBatchUnits) },
  { head: '精炼周期ms', get: (r) => fmt(r.refineCycleMs) },
  { head: '伤害类型(kinetic动能/explosive高爆/plasma能量)', get: (r) => r.damageType },
  { head: '伤害基数dmg', get: (r) => fmt(r.dmg) },
  { head: 'CPU占用cpuUse(无人机)', get: (r) => fmt(r.cpuUse) },
  { head: '修理恢复repairRestore(0~1)', get: (r) => fmt(r.repairRestore) },
  { head: '描述', get: (r) => r.description },
]

/* ═══════════ 3. 装备(模块) ═══════════ */
const moduleCols: Col[] = [
  { head: 'id', get: (r) => r.id },
  { head: '名称', get: (r) => r.name },
  { head: '家族slot(miner采矿/cargo货舱/turret动能炮/missile导弹架/laser激光炮/shield护盾/armor装甲/propulsion推进/drone-rack甲板扩展/drone-tac战术导控/support支援)', get: (r) => r.slot },
  { head: '物理槽rack(high/mid/low)', get: (r) => r.rack },
  { head: 'bonus原值(采矿产量/货舱容量加成；0.2=+20%)', get: (r) => fmt(r.bonus) },
  { head: '护盾容量加成shieldHpBonus(0.15=+15%)', get: (r) => fmt(r.shieldHpBonus) },
  { head: '护盾抗性动能shieldResistAdd.kinetic', get: (r) => fmt((r.shieldResistAdd as Row | undefined)?.kinetic) },
  { head: '护盾抗性高爆shieldResistAdd.explosive', get: (r) => fmt((r.shieldResistAdd as Row | undefined)?.explosive) },
  { head: '护盾抗性能量shieldResistAdd.plasma', get: (r) => fmt((r.shieldResistAdd as Row | undefined)?.plasma) },
  { head: '装甲容量加成armorHpBonus', get: (r) => fmt(r.armorHpBonus) },
  { head: '装甲抗性动能armorResistAdd.kinetic', get: (r) => fmt((r.armorResistAdd as Row | undefined)?.kinetic) },
  { head: '装甲抗性高爆armorResistAdd.explosive', get: (r) => fmt((r.armorResistAdd as Row | undefined)?.explosive) },
  { head: '装甲抗性能量armorResistAdd.plasma', get: (r) => fmt((r.armorResistAdd as Row | undefined)?.plasma) },
  { head: '速度加成speedBonusPct(推进)', get: (r) => fmt(r.speedBonusPct) },
  { head: '开火失稳命中削减hitPenalty(0~0.5)', get: (r) => fmt(r.hitPenalty) },
  { head: '弹种damageType(kinetic/explosive/plasma)', get: (r) => r.damageType },
  { head: '最大射程m', get: (r) => fmt(r.maxRangeM) },
  { head: '最小射程m(近盲)', get: (r) => fmt(r.minRangeM) },
  { head: '基础命中率hitRate(0~1)', get: (r) => fmt(r.hitRate) },
  { head: '命中衰减falloff(0~1)', get: (r) => fmt(r.falloff) },
  { head: '装填时间ms', get: (r) => fmt(r.reloadMs) },
  { head: '单发倍率dmgMult', get: (r) => fmt(r.dmgMult) },
  { head: 'CPU占用cpuUse', get: (r) => fmt(r.cpuUse) },
  { head: '无人机甲板扩容m³', get: (r) => fmt(r.droneBayBonusM3) },
  { head: '无人机伤害加成droneDmgBonus', get: (r) => fmt(r.droneDmgBonus) },
  { head: '按系伤害加成动能damageTypeBonusPct.kinetic', get: (r) => fmt((r.damageTypeBonusPct as Row | undefined)?.kinetic) },
  { head: '按系伤害加成高爆damageTypeBonusPct.explosive', get: (r) => fmt((r.damageTypeBonusPct as Row | undefined)?.explosive) },
  { head: '按系伤害加成功量damageTypeBonusPct.plasma', get: (r) => fmt((r.damageTypeBonusPct as Row | undefined)?.plasma) },
  { head: '射速缩短reloadCutPct(0.05=装填÷1.05)', get: (r) => fmt(r.reloadCutPct) },
  { head: '命中提升hitBonusPct(0.08=命中×1.08)', get: (r) => fmt(r.hitBonusPct) },
  { head: '闪避缺口削减evasionGapPct(0.1=被命中×0.9)', get: (r) => fmt(r.evasionGapPct) },
  { head: '描述', get: (r) => r.description },
]

/* ═══════════ 4. 舰船 ═══════════ */
const shipCols: Col[] = [
  { head: 'id', get: (r) => r.id },
  { head: '名称', get: (r) => r.name },
  { head: '档次tier(1~4)', get: (r) => fmt(r.tier) },
  { head: '角色role(industrial工业/armed武装/armored重装/hauler航运)', get: (r) => r.role },
  { head: '货舱m³', get: (r) => fmt(r.cargoM3) },
  { head: '采集循环s', get: (r) => fmt(r.cycleSeconds) },
  { head: '每循环产量', get: (r) => fmt(r.oreUnitsPerCycle) },
  { head: '空间站售价ISK(0=自带/仅制造)', get: (r) => fmt(r.priceIsk) },
  { head: '动力agility(0~1，逃生/跃迁充能)', get: (r) => fmt(r.agility) },
  { head: '火力加成powerBonus', get: (r) => fmt(r.powerBonus) },
  { head: '护盾量', get: (r) => fmt(r.shieldHp) },
  { head: '装甲量', get: (r) => fmt(r.armorHp) },
  { head: '结构量', get: (r) => fmt(r.hullHp) },
  { head: '盾抗动能', get: (r) => fmt((r.shieldResist as Row | undefined)?.kinetic) },
  { head: '盾抗高爆', get: (r) => fmt((r.shieldResist as Row | undefined)?.explosive) },
  { head: '盾抗能量', get: (r) => fmt((r.shieldResist as Row | undefined)?.plasma) },
  { head: '甲抗动能', get: (r) => fmt((r.armorResist as Row | undefined)?.kinetic) },
  { head: '甲抗高爆', get: (r) => fmt((r.armorResist as Row | undefined)?.explosive) },
  { head: '甲抗能量', get: (r) => fmt((r.armorResist as Row | undefined)?.plasma) },
  { head: '结构抗动能', get: (r) => fmt((r.hullResist as Row | undefined)?.kinetic) },
  { head: '结构抗高爆', get: (r) => fmt((r.hullResist as Row | undefined)?.explosive) },
  { head: '结构抗能量', get: (r) => fmt((r.hullResist as Row | undefined)?.plasma) },
  { head: 'CPU总量', get: (r) => fmt(r.cpu) },
  { head: '高槽数', get: (r) => fmt((r.slots as Row | undefined)?.high) },
  { head: '中槽数', get: (r) => fmt((r.slots as Row | undefined)?.mid) },
  { head: '低槽数', get: (r) => fmt((r.slots as Row | undefined)?.low) },
  { head: '无人机舱m³', get: (r) => fmt(r.droneBayM3) },
  { head: '速度m/s', get: (r) => fmt(r.maxSpeedMps) },
  { head: '跃迁AU/s', get: (r) => fmt(r.warpSpeedAus) },
  { head: '质量kg', get: (r) => fmt(r.massKg) },
  { head: '锁定范围m', get: (r) => fmt(r.lockRangeM) },
  { head: '信号半径m', get: (r) => fmt(r.signatureM) },
  { head: '扫描分辨率mm', get: (r) => fmt(r.scanResMm) },
  { head: '回避evasion(0~0.9)', get: (r) => fmt(r.evasion) },
  { head: '命中加成hitBonus(0~0.5)', get: (r) => fmt(r.hitBonus) },
  { head: '描述', get: (r) => r.description },
]

/* ═══════════ 5. 异常(敌人/悬赏) ═══════════ */
const anomalyCols: Col[] = [
  { head: 'id', get: (r) => r.id },
  { head: '名称', get: (r) => r.name },
  { head: '星系galaxyId', get: (r) => r.galaxyId },
  { head: '威胁threat(总战力标尺；涉C4平衡)', get: (r) => fmt(r.threat) },
  { head: '战术tactic(brawl贴脸/orbit环绕/kite风筝)', get: (r) => r.tactic },
  { head: '血型defProfile(shield盾/armor甲/balanced均衡)', get: (r) => r.defProfile },
  { head: '声望要求', get: (r) => fmt(r.standingReq) },
  { head: '胜利声望增长', get: (r) => fmt(r.standingGain) },
  { head: '奖励ISK', get: (r) => fmt(r.rewardIsk) },
  { head: '战利品(itemId×单位数|…)', get: (r) => packList(r.loot, 'itemId', 'units') },
  { head: '交火展示时长s', get: (r) => fmt(r.combatSeconds) },
  { head: '僚机数escorts(0~2)', get: (r) => fmt(r.escorts) },
  { head: '伤害权重·动能', get: (r) => fmt((r.dmgMix as Row | undefined)?.kinetic) },
  { head: '伤害权重·高爆', get: (r) => fmt((r.dmgMix as Row | undefined)?.explosive) },
  { head: '伤害权重·能量', get: (r) => fmt((r.dmgMix as Row | undefined)?.plasma) },
  { head: '敌速m/sfoeSpeedMps(空=按体积缺省)', get: (r) => fmt(r.foeSpeedMps) },
  { head: '隐藏模板hidden(低安遭遇用，非悬赏)', get: (r) => r.hidden },
  { head: '描述', get: (r) => r.description },
]

/* ═══════════ 6. 矿带 ═══════════ */
const beltCols: Col[] = [
  { head: 'id', get: (r) => r.id },
  { head: '名称', get: (r) => r.name },
  { head: '星系galaxyId(空=母港本地)', get: (r) => r.galaxyId },
  { head: '主产物oreId', get: (r) => r.oreId },
  { head: '复合产出池outputs(itemId×权重|…)', get: (r) => packList(r.outputs, 'itemId', 'weight') },
  { head: '声望要求standingReq', get: (r) => fmt(r.standingReq) },
  { head: '描述', get: (r) => r.description },
]

/* ═══════════ 7. 市场 ═══════════ */
const marketCols: Col[] = [
  { head: 'key(=refId；与其它表id对应)', get: (r) => r.key },
  { head: 'kind(item物品/module装备/ship舰船/blueprint蓝图/aicore核心)', get: (r) => r.kind },
  { head: 'rarity(common常驻/rare稀有/exotic限定)', get: (r) => r.rarity },
  { head: '基准价basePrice(池商品=均衡价；单件=供应价)', get: (r) => fmt(r.basePrice) },
  { head: '常驻·目标库存poolTarget', get: (r) => fmt(r.poolTarget) },
  { head: '常驻·供应流量supplyFlow', get: (r) => fmt(r.supplyFlow) },
  { head: '稀有/限定·供应倍数supplyMultiplier', get: (r) => fmt(r.supplyMultiplier) },
  { head: '收购出价倍数demandMultiplier(空=平价)', get: (r) => fmt(r.demandMultiplier) },
  { head: '可否卖出playerSellable(空=默认可)', get: (r) => r.playerSellable },
  { head: '可否买入playerBuyable(空=默认可)', get: (r) => r.playerBuyable },
  { head: '声望要求standingReq', get: (r) => fmt(r.standingReq) },
]

const tables: Array<[string, Col[], Row[]]> = [
  ['skills', skillsCols, SKILLS as unknown as Row[]],
  ['items', itemCols, ITEMS as unknown as Row[]],
  ['modules', moduleCols, MODULES as unknown as Row[]],
  ['ships', shipCols, SHIPS as unknown as Row[]],
  ['anomalies', anomalyCols, ANOMALIES as unknown as Row[]],
  ['belts', beltCols, BELTS as unknown as Row[]],
  ['market', marketCols, MARKET_GOODS as unknown as Row[]],
]

mkdirSync(outDir, { recursive: true })
for (const [name, cols, rows] of tables) {
  const path = join(outDir, `${name}.csv`)
  writeFileSync(path, '\uFEFF' + rowsToCsv(cols, rows), 'utf8')
  console.log(`· ${name}.csv  ${rows.length} 行（${cols.length} 列）`)
}
console.log(`✅ 已导出到 ${outDir}/（7 张表；UTF-8+BOM，Excel/WPS 可直接打开编辑）`)
console.log('编辑后回写请用 tools/content-import.ts（Phase B）；列对照见 docs/content-workbench.md')
