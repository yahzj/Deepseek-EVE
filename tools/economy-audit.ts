/**
 * **经济跑通体检（正式工具 · 2026-09-28 建 · 二号）**——把"看代码判不了"的五组经济读数打在一张表上：
 *
 * ① **在线 vs 离线**：同一档、同一时长、同一作业，分三条产出线各测一次
 *    （纯随机事件收入 / 采矿自动循环产出 / 技能训练进度）——
 *    离线走 `simulateOffline`（内部 `offlineSplit` + `advanceGame({offline:true})`），
 *    在线走 30 秒一拍（与前台心跳同款）。用来量"离线静默模式"到底少拿了什么。
 * ② **离线时长 × 技能档**：4/8/12/16/24/32/48/72 小时 × 三档（未点 / 离线作业管理学满 /
 *    双满）的实结算时长、未结算时长与折现净值 —— 量"被上限吃掉的时间"。
 *    上限单点 = `offlineCapMsOf(state)`（基础 8h；离线作业管理学 +20%/级；无人值守调度学 +40%/级）。
 * ③ **货币量级与精度**：内容里最贵的舰船/市场商品、设计顶档（「市场老手」L10 = 1e12）、
 *    `Number.MAX_SAFE_INTEGER` 余量、以及"多大金额上 +1 信用点会被吞掉"，
 *    外加"按各条实测产率攒到 1e12 要多久"。
 * ④ **采矿收入曲线**：满配矿舰（鲸王级 + 3×精密采集器 MK3 + 相关技能 Lv5）逐矿带的
 *    单位/时 → ISK/时。**这是"玩家收入曲线"最上端那一档**，也是与 `liquidity:audit`
 *    覆盖比（**基准 = 座头鲸级 · 0 技能 · 满装备**；2026-09-30 船长令换基准，旧为掘洞级 + 2×MK1）对读的那一列。
 * ⑤ **卖矿变现实收单价**：满技能满舱一轮卖货仓的实收 ÷ 现货 base 价（含收购档与税）。
 *
 * 用法：`npm run econ:audit`（挂 script）。
 * ⚠ 本工具只读数、不改档：全部状态都在内存里 `createInitialState` 现造，不碰真档。
 */
import {
  addShipToFleet,
  advanceGame,
  createInitialState,
  enqueueSkill,
  getMiningParams,
  marketGoodOf,
  offlineCapMsOf,
  sellAll,
  setMiningAutoCycle,
  simulateOffline,
  startMining,
} from '@whale/core'
import type { GameState, SimContext } from '@whale/core'
import { buildSimContext } from '@whale/data'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 读数存档（与 `mine-refine-balance` 同款：落 `tools/_ui-artifacts/`，便于随时看尾） */
const ARCHIVE = join(process.cwd(), 'tools', '_ui-artifacts', 'economy-audit.txt')
const out: string[] = []
const say = (line = ''): void => {
  console.log(line)
  out.push(line)
}

const ctx: SimContext = buildSimContext()
/** 1 小时（毫秒） */
const H = 60 * 60 * 1000
/** 在线拍的步长：与前台心跳同款 */
const STEP = 30_000
/** 固定墙钟基准（免日历/限时倍率污染读数） */
const BASE_WALL = 1_760_000_000_000
/** 参照矿带：母港门口（沙猫级可直达，与开局一致） */
const BELT = 'belt-fortune'
const ORE = 'ore-veldspar'

/** 一份可比的起点：可选把采矿自动循环打开 */
function freshState(mining: boolean): GameState {
  const s = createInitialState({ seed: 2025 })
  if (mining) {
    setMiningAutoCycle(s, true)
    startMining(s, BELT, ctx)
  }
  s.wallMs = BASE_WALL
  s.savedAtWallMs = BASE_WALL
  return s
}

/** 直接写已练等级（探针不占训练队列；技能效果一律 Lv5 封顶与引擎同款） */
function setSkills(s: GameState, lv: Record<string, number>): void {
  for (const [id, n] of Object.entries(lv)) s.skills.trained[id] = n
}

/** 参照矿的持有量（当前船货仓 ＋ 仓库） */
function oreUnits(s: GameState): number {
  let n = s.warehouse.items[ORE] ?? 0
  for (const f of Object.values(s.fleet)) n += f?.cargo?.[ORE] ?? 0
  return n
}

const isk = (n: number): string => Math.floor(n).toLocaleString('zh-CN')

/* ───────── ① 在线 vs 离线 ───────── */
say('════════ 一、在线 8 小时 vs 离线 8 小时（同起点 · 三条产出线各测一次）════════')
{
  const hours = 8
  const runOnline = (s: GameState): GameState => {
    for (let t = 0; t < hours * H; t += STEP) advanceGame(s, STEP, ctx, { nowWallMs: BASE_WALL + t + STEP })
    return s
  }
  const runOffline = (s: GameState): GameState => {
    simulateOffline(s, BASE_WALL, BASE_WALL + hours * H, ctx)
    return s
  }
  const rows: Array<[string, GameState, GameState]> = [
    ['① 纯随机事件（不开采矿）', runOnline(freshState(false)), runOffline(freshState(false))],
    ['② 采矿自动循环（沙猫级 + 母港矿带）', runOnline(freshState(true)), runOffline(freshState(true))],
  ]
  for (const [label, on, off] of rows) {
    say(
      `· ${label}\n    在线：钱包 ${isk(on.wallet.isk)} · 矿石 ${isk(oreUnits(on))} 件 · 日志 ${on.logs.length} 条` +
        `\n    离线：钱包 ${isk(off.wallet.isk)} · 矿石 ${isk(oreUnits(off))} 件 · 日志 ${off.logs.length} 条` +
        `\n    差额：钱包 ${isk(on.wallet.isk - off.wallet.isk)} ISK · 矿石 ${isk(oreUnits(on) - oreUnits(off))} 件`,
    )
  }
  // ③ 技能训练：队列推进是否与在线一致（前置链一起排，否则入队即被拒）
  const son = freshState(false)
  const soff = freshState(false)
  const failed: string[] = []
  for (const s of [son, soff]) {
    const plan: Array<[string, number]> = [
      ['astro-geology', 1],
      ['mining', 1],
      ['mining', 2],
      ['mining', 3],
      ['refining', 1],
      ['refining', 2],
      ['refining', 3],
    ]
    for (const [id, lv] of plan) {
      const r = enqueueSkill(s, id, lv, ctx.skills)
      if (!r.ok) failed.push(`${id}→Lv${lv}：${r.error ?? ''}`)
    }
  }
  const dump = (s: GameState): string =>
    `已练 采矿技术 ${s.skills.trained['mining'] ?? 0} 级 / 精炼学 ${s.skills.trained['refining'] ?? 0} 级 · 队列 ` +
    (s.skills.queue.length === 0
      ? '（空）'
      : s.skills.queue.map((q) => `${q.skillId}→Lv${q.level} ${(q.progressMs / 60_000).toFixed(1)}分`).join('、'))
  runOnline(son)
  runOffline(soff)
  say(
    `· ③ 技能训练队列（星质地质学→1、采矿技术→3、精炼学→3）${failed.length > 0 ? `\n    ⚠ ${failed.join('；')}` : ''}` +
      `\n    在线：${dump(son)}\n    离线：${dump(soff)}`,
  )
}

/* ───────── ② 离线时长 × 技能档 ───────── */
say('\n════════ 二、离线时长 × 技能档 → 实结算时长与产出 ════════')
{
  const profiles: Array<[string, Record<string, number>]> = [
    ['未点技能', {}],
    ['离线作业管理学 Lv5', { 'offline-ops': 5 }],
    ['双满（离线作业 + 无人值守调度）', { 'offline-ops': 5, 'unattended-dispatch': 5 }],
  ]
  say('| 技能档 | 离线时长 | 小时上限 | 实结算 | 未结算 | 仓库矿石 | 折现净值 ISK |')
  say('|---|---|---|---|---|---|---|')
  for (const [label, lv] of profiles) {
    const capProbe = freshState(true)
    setSkills(capProbe, lv)
    const capH = offlineCapMsOf(capProbe) / H
    for (const gap of [4, 8, 12, 16, 24, 32, 48, 72]) {
      const s = freshState(true)
      setSkills(s, lv)
      simulateOffline(s, BASE_WALL, BASE_WALL + gap * H, ctx)
      const settled = s.gameMs / H
      const ore = oreUnits(s)
      const price = marketGoodOf(ctx, 'item', ORE)?.basePrice ?? ctx.items.get(ORE)?.baseSellPriceIsk ?? 0
      say(
        `| ${label} | ${gap}h | ${capH.toFixed(0)}h | ${settled.toFixed(2)}h | ${(gap - settled).toFixed(2)}h | ${isk(ore)} | ${isk(s.wallet.isk + ore * price)} |`,
      )
    }
  }
}

/* ───────── ③ 货币量级与精度 ───────── */
say('\n════════ 三、货币量级与精度 ════════')
{
  let maxShip = { id: '', v: 0 }
  for (const [id, def] of ctx.ships) {
    const v = (def as { priceIsk?: number }).priceIsk ?? 0
    if (v > maxShip.v) maxShip = { id, v }
  }
  let maxGood = { key: '', v: 0, kind: '' }
  for (const [key, g] of ctx.marketGoods) {
    if (g.basePrice > maxGood.v) maxGood = { key, v: g.basePrice, kind: g.kind }
  }
  say(`· 最贵舰船：${maxShip.id} = ${isk(maxShip.v)} ISK`)
  say(`· 最贵市场常驻商品：${maxGood.key}（${maxGood.kind}）= ${isk(maxGood.v)} ISK`)
  say('· 设计顶档（「市场老手」L10）= 1,000,000,000,000 ISK = 1e12')
  const safe = Number.MAX_SAFE_INTEGER
  say(`· Number.MAX_SAFE_INTEGER = ${isk(safe)} ≈ ${(safe / 1e12).toFixed(0)} × 1e12`)
  for (const v of [1e9, 1e12, 1e13, 1e14, 1e15, 9.007e15, 9.008e15]) {
    say(
      `  · ${v.toExponential(3)}：+1 ISK ${v + 1 - v === 1 ? '有变化' : '⚠ 被吞掉'}（可表示最小增量 ${(v >= 2 ** 53 ? v * Number.EPSILON : 1).toExponential(1)}）`,
    )
  }
  /** 各条实测产率（ISK/时）——来源见各工具的读数存档 */
  const rates: Array<[string, number]> = [
    ['新档 24h 原矿流（npm run balance）', 58_000],
    ['打捞回收保底 EV（满技能 · npm run salvage:econ）', 1_450_000],
    ['采矿 6 线（沙猫口径 · npm run balance:chains）', 7_020_000],
    ['舰船制造（巨齿鲨 · 现货 · npm run manufacture:econ）', 6_187_500],
    ['制造 MK3 护盾充能力场（变现口径）', 7_198_608],
    ['制造 MK3 护盾充能力场（现货口径）', 13_198_608],
    ['市场池满额吸收（理论天花板 · npm run balance:chains）', 928_762_173],
  ]
  say('· 攒到 1e12 需要多久（不含其它开销）：')
  for (const [label, perH] of rates) {
    const h = 1e12 / perH
    say(
      `  · ${label}（${isk(perH)} ISK/h）⇒ ${isk(h)} 小时 = ${(h / 24).toFixed(1)} 天 = ${(h / 24 / 365).toFixed(2)} 年`,
    )
  }
}

/* ───────── ④ 采矿收入曲线（逐矿带 · 满配矿舰） ───────── */
say('\n════════ 四、采矿收入曲线：逐矿带 × 满配矿舰（单位/时 → ISK/时）════════')
{
  const s = createInitialState({ nowWallMs: 0, seed: 1 })
  const uid = addShipToFleet(s, 'whale-king')
  s.shipId = uid
  s.fleet[uid]!.fitted = { high: ['mod-miner-3', 'mod-miner-3', 'mod-miner-3'], mid: [], low: [] }
  // 只点亮采矿侧技能（与 `mine-refine-balance` 同口径）
  for (const id of [
    'mining',
    'mining-frigate',
    'astro-geology',
    'industrial-ops',
    'deep-hole-blasting',
    'deep-space-harvesting',
  ]) {
    s.skills.trained[id] = 5
  }
  const beltDef = ctx.ships.get('whale-king')
  say(
    `· 基准船：${beltDef?.name ?? 'whale-king'} ＋ 3×精密采集器 MK3 ＋ 采矿侧技能 Lv5（货舱 ${isk(beltDef?.cargoM3 ?? 0)} m³ · 高槽 ${beltDef?.slots.high ?? 0}）`,
  )
  const rows: Array<{ belt: string; ore: string; perH: number; iskPerH: number; cover: number }> = []
  for (const [id, b] of ctx.belts) {
    s.mining.beltId = id
    const p = getMiningParams(s, ctx)
    if (!p) continue
    const perH = (p.unitsPerCycle * 3_600_000) / p.cycleMs
    // 复合带按 outputs 权重取平均单价；单产带直接取 oreId 单价
    const outs = (b as { outputs?: Array<{ itemId: string; weight: number }> }).outputs
    let price = 0
    if (outs && outs.length > 0) {
      const w = outs.reduce((a, o) => a + o.weight, 0)
      price = outs.reduce((a, o) => a + (o.weight / w) * (ctx.items.get(o.itemId)?.baseSellPriceIsk ?? 0), 0)
    } else {
      price = ctx.items.get(b.oreId)?.baseSellPriceIsk ?? 0
    }
    /**
     * **满配覆盖比** = 池日吸收 ÷ 这艘满配矿舰的日产（与 `liquidity:audit` 同一把尺，
     * 只是把那边的基准船从"座头鲸·0 技能·满装备"换成**满配矿舰**。<1 = 挖出来的矿市场一天吃不下。
     */
    const good = ctx.marketGoods.get(b.oreId)
    const flow = good?.supplyFlow ?? Math.max(1, Math.round((good?.poolTarget ?? 0) / 120))
    const cover = (flow * 1440) / (perH * 24)
    rows.push({ belt: b.name, ore: b.oreId, perH, iskPerH: perH * price, cover })
  }
  rows.sort((a, b) => b.iskPerH - a.iskPerH)
  say('| 矿带 | 主产物 | 单位/时 | 单价口径 ISK/时 | 满配覆盖比 |')
  say('|---|---|---|---|---|')
  for (const r of rows) {
    say(
      `| ${r.belt} | ${ctx.items.get(r.ore)?.name ?? r.ore} | ${isk(r.perH)} | ${isk(r.iskPerH)} | ${r.cover < 1 ? '⚠ ' : ''}${r.cover.toFixed(2)}× |`,
    )
  }
  const worst = rows.reduce((a, b) => (b.cover < a.cover ? b : a))
  say(
    `· 满配覆盖比 < 1 的矿带：${rows.filter((r) => r.cover < 1).length} / ${rows.length}（最低 ${worst.belt} ${worst.cover.toFixed(2)}×）`,
  )
  const best = rows[0]!
  say(`· 单船满配最赚：${best.belt} ⇒ ${isk(best.iskPerH)} ISK/时`)
  const h = 1e12 / best.iskPerH
  say(
    `· 以单船 ${isk(best.iskPerH)} ISK/时 攒 1e12：${isk(h)} 小时 = ${(h / 24).toFixed(0)} 天 = ${(h / 24 / 365).toFixed(2)} 年`,
  )
}

/* ───────── ⑤ 卖矿变现实收单价 ───────── */
say('\n════════ 五、卖矿变现：满舱一轮的实收单价 ════════')
{
  const s = freshState(false)
  setMiningAutoCycle(s, false)
  setSkills(s, { 'mining': 5, 'astro-geology': 5, 'mining-frigate': 5 })
  startMining(s, BELT, ctx)
  for (let t = 0; t < 8 * H; t += STEP) advanceGame(s, STEP, ctx, { nowWallMs: BASE_WALL + t + STEP })
  const cargo = s.fleet[s.shipId]?.cargo?.[ORE] ?? 0
  const r = sellAll(s, ORE, ctx)
  const base = marketGoodOf(ctx, 'item', ORE)?.basePrice ?? 0
  say(
    `· 8 小时（满技能 · 手动循环，满舱即停）=> 船上 ${isk(cargo)} 件；卖货仓${r.ok ? '成功' : `失败（${r.error ?? ''}）`} · 入账 ${isk(r.ok ? r.gainedIsk : 0)} ISK`,
  )
  say(
    `  · 现货 base 价 ${isk(base)} ISK/件 ⇒ 货仓实收单价 ${cargo > 0 ? ((r.ok ? r.gainedIsk : 0) / cargo).toFixed(2) : '—'} ISK（含收购档与交易税）`,
  )
}

/* ───────── ⑥ 每种矿石的精炼收益（2026-09-28 船长令） ───────── */
say('\n════════ 六、每种矿石的精炼收益（每 m³ 与**每台炉每小时**两张账）════════')
{
  /*
   * 船长令：「**调整完后，将每种矿石的精炼收益也贴出来**」＋（追问）「**精炼的增值率收益是按单位时间算吗**」
   * ＋（据此下的令）「**调平炉子的时间，使其单位时间收益率差不多**」。
   *
   * 口径：两条路都以**市场常驻价 `basePrice`**（现货）计，都不含交易税 —— 比的是"同一批矿走哪条路更值"。
   * - 直接卖：`1 单位 × 矿石价`，折成**每 m³**要 ÷ `unitM3`（体积越小、每 m³ 件数越多）；
   * - 炼成矿物卖：`Σ(每单位原矿产出件数 × 矿物价)`，同样折成每 m³。
   * - **精炼增值率 = 精炼 ÷ 直接卖 − 1**（比值 ⇒ 每 m³ 与每小时同值）。
   *
   * ⚠ **每台炉每小时**那一列才是"调平"的判据：炉子是"每 `refineBatchUnits` **单位**一炉"，
   * 而单位体积从 0.5 m³ 到 8 m³ ⇒ 不调周期的话，单炉 m³/时 会差 20 倍。
   *
   * **现行口径（2026-09-29 船长令「不同矿的精炼炉之间单位时间的收益也按照 1~1.3 的比例来调整」）**：
   * `refineCycleMs = unitM3 × 20_000` ⇒ **炉子按体积恒速（满技能下单炉 33,150 m³/时，与矿种无关）**，
   * 于是"单炉 ISK/时"的域极差 = "每 m³ 精炼价值"的域极差 = **1.295×**，与采集带（1~1.3）同比例。
   * ⚠ **旧口径（2026-09-28，已作废）**是把周期调成与 `unitM3 × 每m³精炼价值` 成正比 ⇒ 单炉 1.051×
   * ——那等于把矿石档位的收益差又抹平一层，且方向倒挂（R1 最高、R5 最低）。
   * 虚空母矿（`ore-voidmother`）**不在本口径内**，周期维持 60,000。
   */
  const priceOf = (id: string): number => ctx.marketGoods.get(id)?.basePrice ?? ctx.items.get(id)?.baseSellPriceIsk ?? 0
  /** 主控炉满技能：批容 ×1.3（炉膛扩容学）、周期 ×0.600（炉心熔炼学 ×0.8 × 产线节拍学 ×0.75） */
  /**
   * ⚠ **2026-09-29 补齐乘区**：本表原先只算了「炉膛扩容学 + 炉心熔炼学 + 产线节拍学」三条
   * ⇒ **低估炉子产能**（漏了炉温精调学、恒温炉控学、炉膛倍增学，以及本批新增的炉压调控学、炉膛重构学）。
   * 现行满级：批容 ×1.30×1.20×1.10 = **×1.716** · 周期 ×0.80×0.80×0.85×0.925×0.75 = **×0.3774**。
   */
  const BATCH_MUL = 1.3 * 1.2 * 1.1
  const CYCLE_MUL = 0.8 * 0.8 * 0.85 * 0.925 * 0.75
  /** 鲸王满配 m³/时（实测：369 m³ ÷ 6.80s）——"喂饱一艘船要几台炉"的分母 */
  const KING_M3H = 195_353
  say('| 矿石 | 单价 | unitM3 | **每 m³ 直接卖** | 炼成什么（每单位原矿 → 件数×单价） | **每 m³ 精炼** | 精炼增值率 | 炉周期（基础→满技能） | **单炉 m³/时** | **单炉精炼 ISK/时** | 喂饱 1 艘鲸王要几台炉 |')
  say('|---|---|---|---|---|---|---|---|---|---|---|')
  const rows: Array<{ name: string; raw: number; refined: number; perFurnace: number; m3h: number; gain: number }> = []
  for (const ore of ctx.items.values()) {
    if (ore.kind !== 'ore' && ore.kind !== 'gas' && ore.kind !== 'ice') continue
    const unitM3 = Math.max(0.01, ore.unitM3 ?? 1)
    const rawPerM3 = (ore.baseSellPriceIsk ?? 0) / unitM3
    const parts: string[] = []
    let refinedPerUnit = 0
    for (const r of ore.refine ?? []) {
      const p = priceOf(r.mineralId)
      refinedPerUnit += r.perOre * p
      parts.push(`${ctx.items.get(r.mineralId)?.name ?? r.mineralId} ${r.perOre}×${isk(p)}`)
    }
    const refinedPerM3 = refinedPerUnit / unitM3
    const baseCycleS = (ore.refineCycleMs ?? 0) / 1000
    const cycleS = baseCycleS * CYCLE_MUL
    const batchUnits = (ore.refineBatchUnits ?? 100) * BATCH_MUL
    const m3h = cycleS > 0 ? (batchUnits / cycleS) * 3600 * unitM3 : 0
    const perFurnace = m3h * refinedPerM3
    rows.push({ name: ore.name, raw: rawPerM3, refined: refinedPerM3, perFurnace, m3h, gain: rawPerM3 > 0 ? refinedPerM3 / rawPerM3 - 1 : 0 })
    say(
      `| ${ore.name} | ${isk(ore.baseSellPriceIsk ?? 0)} | ${unitM3} | ${isk(rawPerM3)} | ${parts.join(' ＋ ')} | ${isk(refinedPerM3)} | ` +
        `${(rows[rows.length - 1]!.gain * 100).toFixed(1)}% | ${baseCycleS.toFixed(0)}s → ${cycleS.toFixed(1)}s | ${isk(m3h)} | **${isk(perFurnace)}** | ${(KING_M3H / Math.max(1, m3h)).toFixed(2)} |`,
    )
  }
  const rawAvg = rows.reduce((a, r) => a + r.raw, 0) / Math.max(1, rows.length)
  const refAvg = rows.reduce((a, r) => a + r.refined, 0) / Math.max(1, rows.length)
  say(
    `· 均值：直接卖 ${isk(rawAvg)} ISK/m³ · 精炼 ${isk(refAvg)} ISK/m³ ⇒ 精炼整体 ${(((refAvg / rawAvg) - 1) * 100).toFixed(1)}%`,
  )
  say(`· 单循环价值的域极差（每 m³ 直接卖）：${(Math.max(...rows.map((r) => r.raw)) / Math.min(...rows.map((r) => r.raw))).toFixed(3)}×`)
  say(`· **精炼增值率域极差**：${(Math.max(...rows.map((r) => r.gain)) / Math.min(...rows.map((r) => r.gain))).toFixed(3)}×（目标 ≈ 1）`)
  const pf = rows.map((r) => r.perFurnace)
  say(
    `· **单炉精炼 ISK/时 域极差**：${isk(Math.min(...pf))} ~ ${isk(Math.max(...pf))} ⇒ **${(Math.max(...pf) / Math.min(...pf)).toFixed(3)}×**（2026-09-28 调平前为 19.90×）`,
  )
  const fu = rows.map((r) => KING_M3H / Math.max(1, r.m3h))
  say(`· 喂饱 1 艘鲸王满配所需炉位数：${Math.min(...fu).toFixed(2)} ~ ${Math.max(...fu).toFixed(2)} 台（满配上限 = 主控 1 ＋ AI 核心 5 = 6 台）`)
}

mkdirSync(join(process.cwd(), 'tools', '_ui-artifacts'), { recursive: true })
writeFileSync(ARCHIVE, out.join('\n'), 'utf8')
say()
say('（读数存档：tools/_ui-artifacts/economy-audit.txt）')
