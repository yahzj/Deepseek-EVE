/**
 * **敌人明细导出（Excel）**——船长 2026-09-17：「**能否将所有敌人的详细数据单独输出一个excel表格
 * （之前的工具输出都太过粗糙，数据不详细）**」⇒ 追问后收窄：「**只需要敌舰明细。**」
 *
 * 产出（默认目录 `foe-csv/`，可传参改）：
 *   - `enemy-ships.xlsx` —— 主格式：**一张「敌舰明细」sheet**，每个敌舰级一行（列见下）；
 *     另含 **H 族三张 sheet**（2026-09-25 加，见下「②」）：`H 族 · 卡条目` / `H 族 · 逐波` / `H 族 · 挂载件`
 *   - `enemy-ships.csv` —— 同列同序的纯文本版（公式列在此按引擎口径算成数值），便于 git diff / 检索。
 *   - `h-cards.csv` —— H 族「卡条目」表的同列同序文本版（同上）。
 *
 * **② H 族 · 入侵卡（2026-09-25 船长：「将 H 族敌人同步进 excel 表内，我打算微调」）**
 *   H 族敌人只在**4 张 hidden 入侵卡**里出场（`ink-harass / ink-raid / ink-main / ink-flagship`），
 *   而 `npm run bounty:stats` **只统计可见悬赏卡** ⇒ 它们的条目级倍率与逐波读数在别的表里看不到。
 *   两张 sheet 的列都分三块：**输入**（data 里逐字那些字段，要改就改这些）· **实算**（引擎建档
 *   `combat.activeFoeSpecsOf` 的那一份：血/单发/射程/实速，含多舰补偿与越线折扣）· **试算**
 *   （Excel 公式，改倍率即重算；逐波表用 SUMIFS/SUMPRODUCT 汇总条目表）。
 *   ⚠ 两处整场覆写不在表里：遇袭 ×0.75（`WEEKEND_ASSAULT_STRENGTH_MUL`）· 旗舰战波表覆写成
 *   4×`{units:4, hpShare:0.25}` 且母舰血条 = 池子剩余（`bossHp`/`bossHpMax`）。
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
 * - 游戏版本：**v31**（`CURRENT_STATE_VERSION` · 本工具只读目录，不碰存档）
 * - 本工具最后核对：**2026-09-25**（第二版：＋H 族入侵卡三张 sheet —— 输入/实算/试算三块列、
 *   逐波 SUMIFS 汇总、挂载件读数；首版 2026-09-17：25 条敌舰级 · 单 sheet · 公式试算列 · CSV 同名同列）
 * - 本工具最后跑过：**2026-09-25**（30 条敌舰级 ＋ H 族 4 张卡 12 行条目 / 10 行逐波）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { buildSimContext, FOE_SHIPS } from '@whale/data'
import { FOE_MOUNTS, foeDesiredRange, resolveFoeMounts, type AnomalyDef, type DamageType, type FoeShipDef, type FoeShipSlot, type UnitSpec } from '@whale/core'
// ⚠ H 族那 4 张入侵卡的**唯一清单**（`@whale/data` 的包入口没再导出它 ⇒ 走深路径，
//   与 `bounty-stats.ts` 深引 core 的 `foeHpOfThreat` 同一处置：宁可深引，也不在这里写死 id）
import { WEEKEND_FOE_CARDS } from '../packages/data/src/wormholeFoes'
// ⚠ 引擎侧"当前这一波的敌阵"取法（与 `advanceBattleFor` / `battleArcsFor` 同一处）——
//   包入口没导出它，故深引 core 源；**不许在本工具里手写一份 createFoeSpecs 的等价物**
import { activeFoeSpecsOf } from '../packages/core/src/combat'

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

/* ══════════════════════════════════════════════════════════════════════════
 * ② **H 族 · 入侵卡**（weekend 专用 · **hidden** 卡）——2026-09-25 船长：
 *    「**将 H 族敌人同步进 excel 表内，我打算微调**」。
 *
 * 为什么要单开两张 sheet：这 4 张卡是 `hidden: true`（`npm run bounty:stats` **只统计可见悬赏卡**）
 * ⇒ 它们的**条目级倍率**（`hpMul` / `dmgMul` / 各种覆写）与"逐波读数"在任何既有表里都看不到；
 * 而 H 族敌人的**实战数值** = **舰级裸值 × 卡面条目倍率**（再吃多舰补偿与"越线 15% 折扣"）。
 *
 * 每张 sheet 的列分三块（与上面那张舰级表同一套口径）：
 * - **输入列** = `packages/data/src/wormholeFoes.ts` 里**逐字**那些字段（**要微调就改这些**）；
 * - **实算列** = 引擎自己的建档函数 `combat.activeFoeSpecsOf`（= `createFoeSpecs` ＋ 波前缀）
 *   ⇒ 血 / 单发 / 射程 / 实速都是**真的进战斗的那一份**（含多舰补偿与越线折扣），不是手推近似；
 * - **试算列** = **Excel 公式**（引用本行）⇒ 在表里改 `hpMul` / `dmgMul` 就能就地看变化。
 *
 * ⚠ 两处**整场覆写**不在这两张表里（要调得去 core）：① 遇袭场次整队强度 ×`WEEKEND_ASSAULT_STRENGTH_MUL`
 * （现 0.75）；② 旗舰战把波表覆写成 4×`{units:4, hpShare:0.25}`（`weekendFlagshipWavesOf`）
 * ＋ 母舰血条 = 池子剩余（`bossHp`/`bossHpMax`，池子 = `WEEKEND_FLAGSHIP_POOL_HP`）。
 * ══════════════════════════════════════════════════════════════════════════ */

/** H 族那 4 张入侵卡（清单来自 data，不在这里写死 id） */
const H_CARDS: readonly AnomalyDef[] = WEEKEND_FOE_CARDS.filter((a) => a.foeFamily === 'H')
const SHIP_BY_ID = new Map(FOE_SHIPS.map((s) => [s.id, s]))

/** 一条"卡 × 波 × 条目"的取值（xlsx 与 csv 共用） */
interface EntryRow {
  /** 卡级 */
  cardId: string
  cardName: string
  threat: number
  family: string
  region: string
  targeting: string
  /** 波次（1 基）与**波内序**（1 基；⚠ 第 1 条 = 该波"敌方期望距离"的取数依据） */
  wave: number
  order: number
  slot: FoeShipSlot
  /** 引擎建档后的那一条（下标与 `enumerateShipUnits` 对齐） */
  spec: UnitSpec | undefined
  /** 该波的期望距离（只写在波内第 1 条那一行） */
  waveDesire: number | null
  waveDesireFrom: string
  /** 本波声明（units / hpShare 来自卡的 `waves[]`；舰级路径**不吃 hpShare**） */
  waveUnits: number
  waveHpShare: number
  /** 本波编制（舰级 ×数量，顺序即取数顺序） */
  waveComp: string
  /** 本波实算读数（求和；同样只写在第 1 条那一行） */
  waveHp: number | null
  waveDps: number | null
  waveDroneDps: number | null
}

/** 该条目的"武器组"（H 族舰级路径：`weapons[0]` = 舰体武器组，其余是机群） */
const gunOf = (spec: UnitSpec | undefined): { shot: number; reload: number; minM: number; maxM: number } => {
  const w = spec?.weapons.find((x) => x.src !== 'drone')
  return { shot: w?.shotDmg ?? 0, reload: w?.reloadMs ?? 0, minM: w?.minRangeM ?? 0, maxM: w?.maxRangeM ?? 0 }
}
/** **整卡缩放系数**（导出这一刻的实测值）= 实算单发 ÷ (舰级裸单发 × dmgMul)：多舰补偿 ＋ 越线折扣 */
const cardScaleOf = (baseShot: number, dmgMul: number, shotActual: number): number => {
  const raw = baseShot * dmgMul
  return raw > 0 ? shotActual / raw : 1
}
/** 名义 DPS（与 `bounty:stats` 同口径：Σ 单发 × 门数 × 1000 ÷ 装填；不含命中率与距离衰减） */
const nominalDpsOf = (spec: UnitSpec | undefined, drone: boolean): number => {
  let d = 0
  for (const w of spec?.weapons ?? []) {
    if ((w.src === 'drone') !== drone) continue
    d += ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
  }
  return d
}

/** 逐卡 × 波 × 条目铺平成行（同时把"逐波读数"另存一份给第二张 sheet） */
function hRows(): { entries: EntryRow[]; waves: EntryRow[] } {
  const entries: EntryRow[] = []
  const waves: EntryRow[] = []
  for (const card of H_CARDS) {
    const decl = card.waves && card.waves.length > 0 ? card.waves : null
    const n = decl ? decl.length : 1
    for (let wi = 0; wi < n; wi++) {
      const foes = activeFoeSpecsOf(card, bal, wi)
      const slots = (card.ships ?? []).filter((s) => (s.wave ?? 0) === wi)
      const waveUnits = decl ? (decl[wi]!.units ?? foes.length) : foes.length
      const waveHpShare = decl ? (decl[wi]!.hpShare ?? 1) : 1
      const waveComp = (() => {
        const byId = new Map<string, number>()
        for (const f of foes) byId.set(f.foeShipId ?? f.name, (byId.get(f.foeShipId ?? f.name) ?? 0) + 1)
        return [...byId].map(([id, c]) => `${SHIP_BY_ID.get(id)?.name ?? id}×${c}`).join(' ＋ ')
      })()
      const waveDesire = foes.length > 0 ? foeDesiredRange(foes[0]!, foes, bal, 0) : null
      const waveDesireFrom = foes[0]?.foeShipId ?? ''
      const waveHp = foes.reduce((s, f) => s + f.hp.s + f.hp.a + f.hp.h, 0)
      const waveDps = foes.reduce((s, f) => s + nominalDpsOf(f, false), 0)
      const waveDroneDps = foes.reduce((s, f) => s + nominalDpsOf(f, true), 0)
      const base = {
        cardId: card.id,
        cardName: card.name,
        threat: card.threat,
        family: card.foeFamily ?? '',
        region: card.region ?? '',
        targeting: card.foeTargeting ?? 'random',
        wave: wi + 1,
        waveUnits,
        waveHpShare,
        waveComp,
        waveDesire,
        waveDesireFrom,
        waveHp,
        waveDps,
        waveDroneDps,
      }
      /** 条目 ↔ 建档单位的对齐：`enumerateShipUnits` 按 `ships[]` 顺序逐条展开 `count` 个 */
      let cursor = 0
      slots.forEach((slot, si) => {
        const count = Math.max(1, Math.floor(slot.count ?? 1))
        for (let k = 0; k < count; k++) {
          const spec = foes[cursor]
          cursor += 1
          entries.push({ ...base, order: si + 1, slot, spec, waveDesire: si === 0 && k === 0 ? waveDesire : null, waveDesireFrom, waveHp: si === 0 && k === 0 ? waveHp : null, waveDps: si === 0 && k === 0 ? waveDps : null, waveDroneDps: si === 0 && k === 0 ? waveDroneDps : null })
        }
      })
      waves.push({ ...base, order: 0, slot: slots[0] ?? ({ ship: { id: '' } } as FoeShipSlot), spec: foes[0], waveDesire, waveDesireFrom, waveHp, waveDps, waveDroneDps })
    }
  }
  return { entries, waves }
}

/** 「H 族 · 卡条目」列定义 */
const E_COLS: Col[] = [
  { head: '卡id', note: 'data/wormholeFoes.ts 的卡 id（H 族 4 张入侵卡；hidden ⇒ bounty:stats 里没有它们）', width: 16 },
  { head: '卡名', note: '', width: 18 },
  { head: '威胁', note: '卡面 threat（旗舰战另会被运行时覆写）', width: 8, fmt: '#,##0' },
  { head: '族', note: '', width: 5 },
  { head: '地区', note: '卡级 region 覆写', width: 6 },
  { head: '选靶', note: 'foeTargeting', width: 9 },
  { head: '波次', note: '1 基', width: 6 },
  { head: '波内序', note: '⚠ 1 基；**第 1 条 = 该波"敌方期望距离"的取数依据**（`foeDesiredRange` 取 foes[0]）', width: 8 },
  { head: '舰级id', note: '条目引用的舰级', width: 24 },
  { head: '舰级名', note: '', width: 18 },
  { head: '舰种档', note: '1 护卫舰 · 2 驱逐舰 · 3 巡洋舰 · 4 战列舰 · 5 旗舰', width: 8 },
  { head: '条目数', note: 'count（同一条目展开成几个单位）', width: 8 },
  { head: 'hpMul', note: '条目级血量倍率：血 = 舰级 hp × 本值（★要微调通常改这里）', width: 10, fmt: '0.0000' },
  { head: 'dmgMul', note: '条目级单发倍率（★要微调通常改这里）', width: 10, fmt: '0.0000' },
  { head: '伤害构成覆写', note: '条目级 dmgMix（空白 = 用舰级）', width: 16 },
  { head: '挂载件', note: '生效的挂载件（条目级 ?? 舰级；见右一列"来源"）', width: 30 },
  { head: '挂载件来源', note: '「条目」= 写在卡面条目上；「舰级」= 写在舰级上（条目没写时回退到它）', width: 9 },
  { head: '射程倍率覆写', note: 'rangeMul（同时缩放上下限）', width: 10, fmt: '0.00' },
  { head: '射程下限覆写', note: 'rangeMinM（绝对值，优先于 rangeMul）', width: 12, fmt: '#,##0' },
  { head: '射程上限覆写', note: 'rangeMaxM（绝对值，优先于 rangeMul）', width: 12, fmt: '#,##0' },
  { head: '期望距离覆写', note: 'desireRangeM（钉死该单位自己的期望交距）', width: 12, fmt: '#,##0' },
  { head: '机群火力占比', note: 'droneFireShare（把条目火力拆给机群的比例）', width: 12, fmt: '0%' },
  { head: '实算tag', note: '建档后的战斗 tag（首波 `foe-0`…／后续波 `w{n}-foe-0`…）', width: 14 },
  { head: '实算护盾血', note: '引擎建档（含条目倍率与三层比例）', width: 11, fmt: '#,##0' },
  { head: '实算装甲血', note: '', width: 11, fmt: '#,##0' },
  { head: '实算结构血', note: '', width: 11, fmt: '#,##0' },
  { head: '实算合计血', note: '三层之和（这个数就是"一只"的实战血）', width: 11, fmt: '#,##0' },
  { head: '实算单发', note: 'engine 建档后的舰体武器组单发（含多舰补偿与越线折扣）', width: 10, fmt: '#,##0' },
  { head: '实算装填(毫秒)', note: '', width: 12, fmt: '#,##0' },
  { head: '实算射程下限', note: '', width: 12, fmt: '#,##0' },
  { head: '实算射程上限', note: '', width: 12, fmt: '#,##0' },
  { head: '实算实速(m/s)', note: '建档速度（舰级基准 × speedRatio）', width: 12, fmt: '#,##0' },
  { head: '实算闪避', note: 'spec.evasion', width: 10, fmt: '0%' },
  { head: '该波期望距离', note: '该波 foes[0] 推出来的敌方期望交距（只在波内第 1 条那一行有值）', width: 12, fmt: '#,##0' },
  { head: '该波期望取数条', note: '上面那个数是按哪个舰级算的', width: 24 },
  { head: '该波实算总血', note: '本波全部单位三层血之和（同上：只写在第 1 条那一行）', width: 12, fmt: '#,##0' },
  { head: '该波名义DPS', note: 'Σ 舰体武器组（不含机群 · 不含命中/衰减）', width: 12, fmt: '#,##0.0' },
  { head: '该波机群DPS', note: 'Σ 机群条目', width: 12, fmt: '#,##0.0' },
  { head: '舰级裸血', note: 'data/foe-ships.ts 的 hp（试算基准列）', width: 11, fmt: '#,##0' },
  { head: '舰级裸单发', note: 'data/foe-ships.ts 的 shotDmg（试算基准列）', width: 11, fmt: '#,##0' },
  {
    head: '整卡缩放系数',
    note: '= 实算单发 ÷ (舰级裸单发 × dmgMul)：引擎的**整卡级**缩放（多舰补偿 ＋ "越线 15% 折扣"）。'
      + '试算列乘上它才与引擎对齐；⚠ 调大 dmgMul 让整卡 DPS 越线后，引擎会给更大的折扣（本表不会自动跟着变）',
    width: 12,
    fmt: '0.0000',
  },
  { head: '有效总血(试算)', note: '**Excel 公式**：= 舰级裸血 × hpMul（与「实算合计血」逐字相等：血不吃补偿/折扣）', width: 13, fmt: '#,##0' },
  { head: '有效单发(试算)', note: '**Excel 公式**：= 舰级裸单发 × dmgMul × 整卡缩放系数（导出时 = 实算单发）', width: 13, fmt: '#,##0' },
  { head: '条目总血(试算)', note: '**Excel 公式**：= 有效总血(试算) × 条目数（逐波表的 SUMIFS 汇总这一列）', width: 13, fmt: '#,##0' },
  { head: '条目DPS(试算)', note: '**Excel 公式**：= 有效单发(试算) × 条目数 × 1000 ÷ 实算装填（装填不吃倍率 ⇒ 用实算值当分母）', width: 13, fmt: '#,##0.0' },
]

/** 「H 族 · 逐波」列定义 */
const W_COLS: Col[] = [
  { head: '卡id', note: '', width: 16 },
  { head: '卡名', note: '', width: 18 },
  { head: '威胁', note: '', width: 8, fmt: '#,##0' },
  { head: '波次', note: '1 基', width: 6 },
  { head: '声明单位数', note: '卡面 waves[].units（舰级路径只用它做"预估/命名"，实际入场数 = 条目 count 之和）', width: 11 },
  { head: 'hpShare', note: '卡面 waves[].hpShare（⚠ 舰级路径**不吃**：血 = 舰级 hp × 条目 hpMul）', width: 10, fmt: '0.00' },
  { head: '本波编制', note: '按卡面顺序（第一条决定"敌方期望距离"）', width: 44 },
  { head: '条目数（实际）', note: '本波建档出来的单位数', width: 12 },
  { head: '期望距离取数条', note: '本波第 1 条舰级', width: 24 },
  { head: '期望交距', note: '**本波敌方期望距离**（`foeDesiredRange`，引擎与界面同一把尺）', width: 12, fmt: '#,##0' },
  { head: '本波总血', note: 'Σ 三层血（引擎建档）', width: 12, fmt: '#,##0' },
  { head: '本波名义DPS', note: 'Σ 舰体武器组（不含机群）', width: 12, fmt: '#,##0.0' },
  { head: '本波机群DPS', note: 'Σ 机群条目', width: 12, fmt: '#,##0.0' },
  { head: '血/威胁', note: '= 本波总血 ÷ 威胁（读数）', width: 10, fmt: '0.0' },
  { head: '本波总血(试算)', note: '**Excel 公式**：SUMIFS（按卡id＋波次汇总「H 族 · 卡条目」的「条目总血(试算)」）', width: 14, fmt: '#,##0' },
  { head: '本波名义DPS(试算)', note: '**Excel 公式**：同上汇总「条目DPS(试算)」', width: 16, fmt: '#,##0.0' },
]

/** 挂载件（只列 H 族 4 张卡实际用到的那些） */
const H_MOUNTS = ((): Array<{ id: string; name: string; note: string; nums: string }> => {
  const used = new Set<string>()
  for (const c of H_CARDS) for (const s of c.ships ?? []) for (const m of s.mounts ?? s.ship.mounts ?? []) used.add(m)
  return [...used].map((id) => {
    const def = FOE_MOUNTS[id as keyof typeof FOE_MOUNTS]
    const nums: string[] = []
    if (def?.charge !== undefined) nums.push(`冲锋：机动 ×${def.charge.mul} · 冷却 ${Math.round(def.charge.cooldownMs / 1000)} 秒`)
    if (def?.droneRangeOnHit !== undefined) nums.push(`挨打后机群射程 ×${def.droneRangeOnHit}`)
    if (def?.gunRangeOnHit !== undefined) nums.push(`挨打后炮台射程 ×${def.gunRangeOnHit}`)
    if (def?.web !== undefined) nums.push(`捕获网：机动 ×${def.web.mobilityMul} · ${Math.round(def.web.durationMs / 1000)} 秒`)
    if (def?.repairPulse !== undefined) nums.push(`修理脉冲：每 ${Math.round(def.repairPulse.everyMs / 1000)} 秒 ＋${def.repairPulse.armor} 装甲 / ＋${def.repairPulse.hull} 结构`)
    if (def?.reviveEscort !== undefined) nums.push(`支援召唤：每 ${Math.round(def.reviveEscort.everyMs / 1000)} 秒复活一艘（满血 · 不超本波编成）`)
    if (def?.supportCall !== undefined) nums.push('支援呼叫：延迟入场（洞内专属）')
    return { id, name: def?.name ?? id, note: def?.note ?? '', nums: nums.join(' · ') }
  })
})()

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

/* ── ①b H 族 · 入侵卡两张 sheet（同一本工作簿；口径见上方那段注释） ── */
const { entries: hEntries, waves: hWaves } = hRows()
const SHEET_E = 'H 族 · 卡条目'
const SHEET_W = 'H 族 · 逐波'
/** 表头样式（与舰级表同款） */
const styleHead = (sheet: ExcelJS.Worksheet, cols: Col[]): void => {
  sheet.columns = cols.map((c) => ({ header: c.head, width: c.width }))
  const head = sheet.getRow(1)
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1)
    cell.font = { bold: true }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3F8' } }
    if (c.note.length > 0) cell.note = c.note
  })
  head.height = 30
}
const writeRow = (sheet: ExcelJS.Worksheet, cols: Col[], cells: Array<string | number>, ri: number): ExcelJS.Row => {
  const r = sheet.getRow(ri)
  cells.forEach((v, ci) => {
    const cell = r.getCell(ci + 1)
    cell.value = v as ExcelJS.CellValue
    const fmt = cols[ci]?.fmt
    if (fmt !== undefined && typeof v === 'number') cell.numFmt = fmt
  })
  return r
}

const wsE = wb.addWorksheet(SHEET_E, { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] })
styleHead(wsE, E_COLS)
const E_IDX = (head: string): number => E_COLS.findIndex((c) => c.head === head)
const E_HP_BASE = E_IDX('舰级裸血')
const E_SHOT_BASE = E_IDX('舰级裸单发')
const E_HPMUL = E_IDX('hpMul')
const E_DMGMUL = E_IDX('dmgMul')
const E_COUNT = E_IDX('条目数')
const E_RELOAD = E_IDX('实算装填(毫秒)')
const E_SHOT_ACT = E_IDX('实算单发')
const E_SCALE = E_IDX('整卡缩放系数')
const E_F_HP = E_IDX('有效总血(试算)')
const E_F_SHOT = E_IDX('有效单发(试算)')
const E_F_TOTHP = E_IDX('条目总血(试算)')
const E_F_TOTDPS = E_IDX('条目DPS(试算)')
hEntries.forEach((e, i) => {
  const s = SHIP_BY_ID.get(e.slot.ship.id)
  const g = gunOf(e.spec)
  const cells: Array<string | number> = [
    e.cardId, e.cardName, e.threat, e.family, e.region, e.targeting, e.wave, e.order,
    e.slot.ship.id, e.slot.ship.name, e.slot.ship.hullClassTier, Math.max(1, Math.floor(e.slot.count ?? 1)),
    e.slot.hpMul ?? 1, e.slot.dmgMul ?? 1,
    e.slot.dmgMix !== undefined ? DMG_ORDER.filter((t) => pct(e.slot.dmgMix?.[t]) > 0).map((t) => `${DMG_TEXT[t]} ${round2(pct(e.slot.dmgMix?.[t]) / Math.max(1, DMG_ORDER.reduce((a, t2) => a + pct(e.slot.dmgMix?.[t2]), 0)))}`).join(' : ') : '',
    (e.slot.mounts ?? e.slot.ship.mounts ?? []).join('、'),
    e.slot.mounts !== undefined && e.slot.mounts.length > 0 ? '条目' : e.slot.ship.mounts !== undefined && e.slot.ship.mounts.length > 0 ? '舰级' : '',
    e.slot.rangeMul ?? '', e.slot.rangeMinM ?? '', e.slot.rangeMaxM ?? '', e.slot.desireRangeM ?? '', e.slot.droneFireShare ?? '',
    e.spec?.tag ?? '', round1(e.spec?.hp.s ?? 0), round1(e.spec?.hp.a ?? 0), round1(e.spec?.hp.h ?? 0),
    round1((e.spec?.hp.s ?? 0) + (e.spec?.hp.a ?? 0) + (e.spec?.hp.h ?? 0)),
    g.shot, g.reload, g.minM, g.maxM, Math.round(e.spec?.speedMps ?? 0), round2(e.spec?.evasion ?? 0),
    e.waveDesire ?? '', e.waveDesire ? e.waveDesireFrom : '', e.waveHp ?? '', e.waveDps !== null ? round1(e.waveDps) : '', e.waveDroneDps !== null ? round1(e.waveDroneDps) : '',
    round1(s?.hp ?? 0), s?.shotDmg ?? 0,
    round2(cardScaleOf(s?.shotDmg ?? 0, e.slot.dmgMul ?? 1, g.shot)),
    0, 0, 0, 0,
  ]
  const r = writeRow(wsE, E_COLS, cells, i + 2)
  const rowNo = i + 2
  const L = colLetter
  r.getCell(E_F_HP + 1).value = { formula: `${L(E_HP_BASE)}${rowNo}*${L(E_HPMUL)}${rowNo}` }
  r.getCell(E_F_SHOT + 1).value = {
    formula: `${L(E_SHOT_BASE)}${rowNo}*${L(E_DMGMUL)}${rowNo}*${L(E_SCALE)}${rowNo}`,
  }
  r.getCell(E_F_TOTHP + 1).value = { formula: `${L(E_F_HP)}${rowNo}*${L(E_COUNT)}${rowNo}` }
  r.getCell(E_F_TOTDPS + 1).value = {
    formula: `${L(E_F_SHOT)}${rowNo}*${L(E_COUNT)}${rowNo}*1000/IF(${L(E_RELOAD)}${rowNo}=0,1,${L(E_RELOAD)}${rowNo})`,
  }
  for (const ci of [E_SCALE, E_F_HP, E_F_SHOT, E_F_TOTHP, E_F_TOTDPS]) r.getCell(ci + 1).numFmt = E_COLS[ci]!.fmt!
})
wsE.autoFilter = { from: { row: 1, column: 1 }, to: { row: hEntries.length + 1, column: E_COLS.length } }

const wsW = wb.addWorksheet(SHEET_W, { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] })
styleHead(wsW, W_COLS)
const W_IDX = (head: string): number => W_COLS.findIndex((c) => c.head === head)
hWaves.forEach((w, i) => {
  const cells: Array<string | number> = [
    w.cardId, w.cardName, w.threat, w.wave, w.waveUnits, w.waveHpShare, w.waveComp, w.spec !== undefined ? hEntries.filter((e) => e.cardId === w.cardId && e.wave === w.wave).length : 0,
    w.waveDesireFrom, w.waveDesire ?? '', w.waveHp ?? '', w.waveDps !== null ? round1(w.waveDps) : '', w.waveDroneDps !== null ? round1(w.waveDroneDps) : '',
    w.waveHp !== null && w.threat > 0 ? round1(w.waveHp / w.threat) : '', 0, 0,
  ]
  const r = writeRow(wsW, W_COLS, cells, i + 2)
  const rowNo = i + 2
  const L = colLetter
  /**
   * 跨 sheet 汇总：按（卡id ＋ 波次）把「卡条目」里**已经乘过条目数**的两列加总
   * ⇒ 在条目表里改 `hpMul` / `dmgMul` / 条目数，这两格立刻跟着变（这就是"试算"）。
   */
  const sumIf = (col: number): ExcelJS.CellFormulaValue => ({
    formula: `SUMIFS('${SHEET_E}'!${L(col)}:${L(col)},'${SHEET_E}'!${L(0)}:${L(0)},$A${rowNo},'${SHEET_E}'!${L(6)}:${L(6)},$D${rowNo})`,
  })
  const dHead = '本波总血(试算)'
  const pHead = '本波名义DPS(试算)'
  r.getCell(W_IDX(dHead) + 1).value = sumIf(E_F_TOTHP)
  r.getCell(W_IDX(pHead) + 1).value = sumIf(E_F_TOTDPS)
  for (const h of [dHead, pHead]) r.getCell(W_IDX(h) + 1).numFmt = W_COLS[W_IDX(h)]!.fmt!
})
wsW.autoFilter = { from: { row: 1, column: 1 }, to: { row: hWaves.length + 1, column: W_COLS.length } }

/* ── ①c 挂载件（H 族用到的那些）── */
const wsM = wb.addWorksheet('H 族 · 挂载件', { views: [{ state: 'frozen', ySplit: 1 }] })
const M_COLS: Col[] = [
  { head: 'id', note: 'foeMounts.ts 的件 id', width: 30 },
  { head: '名称', note: '', width: 22 },
  { head: '数值', note: '引擎实际消费的那些数（要改去 core/foeMounts.ts）', width: 56 },
  { head: '说明', note: '', width: 60 },
]
styleHead(wsM, M_COLS)
H_MOUNTS.forEach((m, i) => writeRow(wsM, M_COLS, [m.id, m.name, m.nums, m.note], i + 2))

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

/* ── ②b H 族条目表的 csv（同列同序；试算列在这里算成数值，保证 csv 自洽） ── */
const eBody: Array<Array<string | number>> = hEntries.map((e) => {
  const s = SHIP_BY_ID.get(e.slot.ship.id)
  const g = gunOf(e.spec)
  const count = Math.max(1, Math.floor(e.slot.count ?? 1))
  const scale = cardScaleOf(s?.shotDmg ?? 0, e.slot.dmgMul ?? 1, g.shot)
  const baseHp = s?.hp ?? 0
  const baseShot = s?.shotDmg ?? 0
  return [
    e.cardId, e.cardName, e.threat, e.family, e.region, e.targeting, e.wave, e.order,
    e.slot.ship.id, e.slot.ship.name, e.slot.ship.hullClassTier, count,
    e.slot.hpMul ?? 1, e.slot.dmgMul ?? 1, '', (e.slot.mounts ?? e.slot.ship.mounts ?? []).join('、'),
    e.slot.mounts !== undefined && e.slot.mounts.length > 0 ? '条目' : e.slot.ship.mounts !== undefined && e.slot.ship.mounts.length > 0 ? '舰级' : '',
    e.slot.rangeMul ?? '', e.slot.rangeMinM ?? '', e.slot.rangeMaxM ?? '', e.slot.desireRangeM ?? '', e.slot.droneFireShare ?? '',
    e.spec?.tag ?? '', round1(e.spec?.hp.s ?? 0), round1(e.spec?.hp.a ?? 0), round1(e.spec?.hp.h ?? 0),
    round1((e.spec?.hp.s ?? 0) + (e.spec?.hp.a ?? 0) + (e.spec?.hp.h ?? 0)),
    g.shot, g.reload, g.minM, g.maxM, Math.round(e.spec?.speedMps ?? 0), round2(e.spec?.evasion ?? 0),
    e.waveDesire ?? '', e.waveDesire ? e.waveDesireFrom : '',
    e.waveHp !== null ? round1(e.waveHp) : '', e.waveDps !== null ? round1(e.waveDps) : '', e.waveDroneDps !== null ? round1(e.waveDroneDps) : '',
    round1(baseHp), baseShot, round2(scale),
    round1(baseHp * (e.slot.hpMul ?? 1)),
    round1(baseShot * (e.slot.dmgMul ?? 1) * scale),
    round1(baseHp * (e.slot.hpMul ?? 1) * count),
    round1((baseShot * (e.slot.dmgMul ?? 1) * scale * count * 1000) / Math.max(1, g.reload)),
  ]
})
const eCsvPath = join(OUT_DIR, 'h-cards.csv')
writeFileSync(
  eCsvPath,
  '\ufeff' + [E_COLS.map((c) => csvCell(c.head)).join(','), ...eBody.map((v) => v.map(csvCell).join(','))].join('\r\n') + '\r\n',
  'utf8',
)

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
console.log(`✅ 另附 H 族入侵卡两张 sheet（同一本工作簿）：「${SHEET_E}」${hEntries.length} 行 · 「${SHEET_W}」${hWaves.length} 行 · 「H 族 · 挂载件」${H_MOUNTS.length} 行`)
console.log(`   csv ：${join(process.cwd(), eCsvPath)}（条目表同列同序；试算列已算成数值）`)
for (const w of hWaves) {
  console.log(
    `   · ${w.cardId} 第 ${w.wave} 波：${w.waveComp} · 总血 ${Math.round(w.waveHp ?? 0).toLocaleString('zh-CN')} · ` +
      `名义DPS ${(w.waveDps ?? 0).toFixed(1)}${(w.waveDroneDps ?? 0) > 0 ? `+${(w.waveDroneDps ?? 0).toFixed(1)}(机群)` : ''} · ` +
      `期望交距 ${w.waveDesire ?? 0}（按 ${w.waveDesireFrom}）`,
  )
}
console.log('⚠ H 族敌人的实战值 = 舰级裸值 × 卡面条目倍率；另有整场覆写：遇袭 ×0.75 · 旗舰战波表 4×{units:4,hpShare:0.25} ＋ 母舰血条 = 池子剩余')
}

void main().catch((err: unknown) => {
  console.error('导出失败：', err)
  process.exit(1)
})
