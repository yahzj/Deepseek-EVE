/**
 * 全流程模拟验证（2026-09-05 船长需求）——AI 玩家从零开始跑完整内容链：
 * 技能训练 / 采矿 / 精炼 / 制造 / 市场买卖 / 换船配装 / 悬赏远征 / 声望 / 星系探索扫描 /
 * AI 副船 / 随机事件 / 低安遭遇，直到「全部星系点亮 + DSI 声望 ≥13 +
 * 稳定击败最高 threat 96 的 ano-vault-sentinel（连打 5 局）」。
 *
 * 运行：tsx tools/playthrough-sim.ts [--max-days 60] [--real-training] [--seed 1] [--report out.json]
 *       [--goal boss|tril|collect|all]（目标制，2026-09-05 船长：boss=通关连打 5/5；
 *       tril=现金 ≥1 万亿 ISK；collect=全收集（全舰船/全可造蓝图/全装备）；all=三者都要；默认 boss）
 * 默认 debugQuick=true（技能 1s/级、扫描 1s）——聚焦系统链一致性（平衡归二号 C4）。
 * 在独立副本钉死基线运行；主仓库并行开发不受干扰。
 * v1.1（B3 + 目标制）：AI 打捞任务（轮换、单趟自动返港）+ 主控低频打捞会话 + 残骸回收炉
 *   （打捞五技能效果随实际作业被触发：整备/漂流物/富集识别走打捞，回收/提纯走炉）；
 *   目标达成或天数上限/终局受阻黑洞即止。v1.0：主链 = 训练/采矿/市场/精炼/制造/换船/战斗/声望/探索/AI 采矿。
 */
import { writeFileSync } from 'node:fs'
import {
  aiCoreCapBlock,
  aiCoreShipUsed,
  cpuBudgetOf,
  fittedCpuUsed,
  droneCpuUsed,
  droneLoadM3,
  refillDroneLoadTo,
  cargoOfShip,
  aiCoreIndustryUsed,
  industryAiBonus,
  assignAiMining,
  assignAiSalvage,
  battleWinPreview,
  buildEvalState,
  estimateBountyWinOn,
  bountyCooldownRemainingMs,
  buyAtMarket,
  buyBasicAiCore,
  buyShip,
  cancelAiTask,
  cancelStandby,
  changeShip,
  countAiCore,
  countItem,
  countModule,
  countWare,
  createInitialState,
  advanceGame,
  enqueueSkill,
  fitModule,
  findBuildable,
  fleetDefOf,
  frontierGalaxyIds,
  goStandbyAt,
  HOME_GALAXY_ID,
  idleAiShipIds,
  isAtHome,
  isExplored,
  learnBlueprint,
  marketGoodOf,
  marketSellHolding,
  aiCoreCap,
  missingMaterials,
  oreAvailable,
  ownsBlueprint,
  recallExpedition,
  salvagerCyclesOf,
  setMiningAutoCycle,
  setAmmoTier,
  startExpedition,
  startManufacturing,
  startMining,
  startRecycleRun,
  startSalvageOp,
  startRefineRun,
  standingOf,
  startScan,
  startTransitHome,
  stopMining,
  stopSalvageOp,
  stopScan,
  unfitAt,
  unloadCargoToWarehouse,
  addShipToFleet,
  repairShip,
  calcPower,
  repairDeprecatedModules,
  DSI_FACTION_ID,
  sellShipAtMarket,
} from '@whale/core'
import type { GameState, SimContext, AnomalyDef, ShipDef } from '@whale/core'
import { buildSimContext } from '@whale/data'
import { SHIP_BLUEPRINTS } from '@whale/data'
import { advanceBattleFor, startBattleFor, startFleetBattleFor } from '../packages/core/src/combat'
/**
 * **虫洞手动趟**要用的入口（船长 2026-09-21：成就走真流程）——
 * 与 `tools/wormhole-econ.ts` 用的是同一批公开 API，不碰任何内部状态。
 */
import {
  wormholeAdmission,
  wormholeDescend,
  wormholeEnter,
  wormholeExtract,
  wormholeGridScan,
  wormholeShipAllowed,
  wormholeScanBonusOf,
} from '../packages/core/src/wormhole'
import { wormholeCardIdForRun } from '../packages/core/src/wormholeFoes'
import { advanceWormhole, wormholeActivateAt, wormholeTravelTo } from '../packages/core/src/wormholeBattle'
import { matterTechWhBuffs } from '../packages/core/src/matterTech'
import {
  gridCellAt,
  gridNebulaTargets,
  gridScanTargets,
  hexDistance,
  hexKey,
  hexLine,
  hexNeighbors,
  isExitCell,
  wormholePathInterceptAt,
} from '../packages/core/src/wormholeGrid'
import type { HexCell, WormholeGridState } from '../packages/core/src/wormholeGrid'

const ARGS = process.argv.slice(2)
const argVal = (name: string, dflt: number): number => {
  const i = ARGS.indexOf(name)
  return i >= 0 && ARGS[i + 1] !== undefined ? Number(ARGS[i + 1]) : dflt
}
const MAX_DAYS = argVal('--max-days', 60)
const SEED = argVal('--seed', 20260905)
const REAL_TRAINING = ARGS.includes('--real-training')
/** 资产/战斗力增长快照间隔（游戏天）；默认 real-training 1 天、debugQuick 0.02 天 */
const SNAP_DAYS = argVal('--snap-days', REAL_TRAINING ? 1 : 0.02)
const SNAP_MS = Math.max(60_000, Math.round(SNAP_DAYS * 86_400_000))
const REPORT_IDX = ARGS.indexOf('--report')
const REPORT = REPORT_IDX >= 0 ? ARGS[REPORT_IDX + 1] : null

/**
 * 目标制（`--goal`，可逗号组合；**默认 `bounties,whach,isk1b` = 船长 2026-09-21 定的三条**）：
 * - `bounties`（**新增**）：**完成所有悬赏** = `completedBounties` 收全 23 张可见悬赏卡；
 * - `whach`（**新增**）：**虫洞的成就** = 六枚虫洞里程碑（层深 2/3/4/5 ＋ 击破层末守卫 2/4）；
 * - `isk1b`（**新增**）：**赚到 10 亿 ISK**（钱包）；
 * - `boss` / `tril` / `collect` / `all`：旧口径原样保留（`boss` = 终局连打 5/5 · `tril` = 万亿 ·
 *   `collect` = 全收集）——**只在显式指定时才跑**，不再当默认。
 */
const GOAL_IDX = ARGS.indexOf('--goal')
const GOAL_RAW = GOAL_IDX >= 0 ? ARGS[GOAL_IDX + 1] : 'bounties,whach,isk1b'
const goalSet = new Set(GOAL_RAW.split(',').map((s) => s.trim()))
const WANTS = {
  boss: goalSet.has('all') || goalSet.has('boss'),
  tril: goalSet.has('all') || goalSet.has('tril'),
  collect: goalSet.has('all') || goalSet.has('collect'),
  /** **新增三条**（船长 2026-09-21）；`all` 也把它们带上 */
  bounties: goalSet.has('all') || goalSet.has('bounties'),
  whach: goalSet.has('all') || goalSet.has('whach'),
  isk1b: goalSet.has('all') || goalSet.has('isk1b'),
}
const GOAL_NAMES: Record<'boss' | 'tril' | 'collect' | 'bounties' | 'whach' | 'isk1b', string> = {
  boss: '通关：终局悬赏连打 5/5',
  tril: '万亿现金：钱包 ≥1,000,000,000,000 ISK',
  collect: '全收集：全舰船 + 全可造蓝图 + 全装备',
  bounties: '完成所有悬赏：23 张可见卡全部首胜',
  whach: '虫洞成就：层深 5 层 + 击破层末守卫 4 个（六枚里程碑全拿）',
  isk1b: '赚到 10 亿：钱包 ≥1,000,000,000 ISK',
}

const ctx: SimContext = buildSimContext()
const state: GameState = createInitialState({ nowWallMs: Date.now(), seed: SEED })
state.debugQuick = !REAL_TRAINING
const MAX_MS = MAX_DAYS * 86_400_000
const STEP_MS = 60_000

/* ═══════════ 目录与计划 ═══════════ */
const GALAXY_IDS = [...ctx.galaxies.keys()]
const BELT_LIST = [...ctx.belts.values()]
  .map((b) => ({ b, value: beltValue(b) }))
  .sort((a, b) => b.value - a.value)
const ANOMALY_LIST = [...ctx.anomalies.values()].filter((a) => !a.hidden)
const SHIP_LIST = [...ctx.ships.values()].filter((s) => s.role === 'armed' || s.role === 'armored').sort((a, b) => a.priceIsk - b.priceIsk)
const AMMO_KEYS = ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']
const AMMO_GOODS = [...ctx.marketGoods.values()].filter((g) => AMMO_KEYS.includes(g.refId))
/** 弹药 **MK2** 三族的市场行（`items.ts`：`ammo-<族>-2`，纯数值上级、**+33% 单发**） */
const AMMO_MK2_GOODS = [...ctx.marketGoods.values()].filter((g) =>
  ['ammo-kinetic-2', 'ammo-explosive-2', 'ammo-plasma-2'].includes(g.refId),
)
/**
 * **"可以开始花钱换战力"的现金门槛**（2026-09-21 第十批定）。
 *
 * 为什么需要这道闸：第五轮两个隔离实验（装船体维修装置 / 换 MK2 弹药）**都因为挤占早期现金
 * 而整体退化**（维修装置 ⇒ 现金 −34%；MK2 弹药 ⇒ 现金掉到 4.5 万、层深 0）。
 * 而本模拟的经济是**前紧后松**：第 12 天 8 亿、第 60 天 **286 亿**
 * ⇒ 把"多花钱换战力"的支出**推迟到 10 亿目标基本达成之后**，就能既拿战力、又不拖垮那条目标。
 * 取 **8 亿**（留安全边际；实测第 12 天左右越过）。
 */
const SPEND_FOR_POWER_ISK = 800_000_000

function beltValue(b: { oreId: string; outputs?: ReadonlyArray<{ itemId: string; weight: number }> }): number {
  const rows = b.outputs?.length ? b.outputs : [{ itemId: b.oreId, weight: 1 }]
  const ws = rows.reduce((s, r) => s + r.weight, 0)
  return rows.reduce((s, r) => s + (ctx.items.get(r.itemId)?.baseSellPriceIsk ?? 0) * (r.weight / ws), 0)
}

function standing(): number {
  return standingOf(state, DSI_FACTION_ID)
}
function exploredCount(): number {
  return GALAXY_IDS.filter((g) => isExplored(state, g)).length
}
function isHome(): boolean {
  return isAtHome(state)
}
function meBusy(): boolean {
  return (
    state.mining.active ||
    state.expedition.active ||
    state.scanning.active ||
    state.standby.active ||
    state.transit.active ||
    pilotLineBusy() ||
    state.encounter.active
  )
}

/** 手动工作位（劳动者制 2026-09：主控亲自的精炼炉/回收炉/制造线互斥占位） */
function pilotLineBusy(): boolean {
  return (
    (state.refineRuns ?? []).some((r) => r.active && r.worker === 'pilot') ||
    (state.manufacturingRuns ?? []).some((r) => r.active && r.worker === 'pilot')
  )
}

/* ═══════════ 收集与里程碑 ═══════════ */
const issuesRaw = new Map<string, number>()
function issue(text: string): void {
  issuesRaw.set(text, (issuesRaw.get(text) ?? 0) + 1)
}
const milestones: string[] = []
const milestoneSeen = new Set<string>()
let lastLogIdx = 0
let lastAuditMs = -300_000
let soldTotal = 0
const LOG_KINDS = new Set(['info', 'warn', 'error', 'trade', 'queue', 'levelup', 'combat', 'explore', 'system', 'encounter'])

function day(): number {
  return state.gameMs / 86_400_000
}
function mark(msg: string): void {
  if (milestoneSeen.has(msg)) return
  milestoneSeen.add(msg)
  milestones.push(`[${day().toFixed(2)}d] ${msg}`)
}

/** 市场瞬态卖出失败（收购簿空/暂无收购/无可卖库存）= 正常行情波动，不算引擎异常——
 * debugQuick 下产量远超市场吸收时高频出现（2026-09-06 观察：簿空修复 90eb8c2 后由吞货
 * bug 掩盖的真实报错浮出水面，属模拟器需容忍的瞬态） */
const BENIGN_SELL_ERRS = ['没有可卖的库存。', '收购簿为空', '暂时无人收购']
function isBenignSellErr(err?: string): boolean {
  return !!err && BENIGN_SELL_ERRS.some((p) => err.includes(p))
}
/** 叙事性 warn（低安首入提示/遭遇横幅等引擎按设计发 warn 的玩家向日志）不计引擎异常
 * 2026-09-09：补「被劫」——低安被抢结算的另一种措辞（有货被劫/无货被洗劫同档，AI 副船亦适用） */
const BENIGN_NARRATIVE_WARN = ['首次进入低安', '低安遭遇', '被盯上了', '被咬下一块装甲', '被洗劫', '被劫']

function auditLogs(): void {
  for (let i = lastLogIdx; i < state.logs.length; i++) {
    const l = state.logs[i]!
    if (!LOG_KINDS.has(l.kind)) issue(`日志未知 kind「${l.kind}」：${l.text.slice(0, 100)}`)
    else if (l.kind === 'error' || (l.kind === 'warn' && !BENIGN_NARRATIVE_WARN.some((p) => l.text.includes(p))))
      issue(`引擎[${l.kind}] ${l.text.slice(0, 150)}`)
  }
  lastLogIdx = state.logs.length
}

function audit(): void {
  const bad = (label: string, v: number): void => {
    if (!Number.isFinite(v) || v < 0 || v > 1e15) issue(`${label} 异常 ${v}`)
  }
  bad('钱包', state.wallet.isk)
  for (const [k, v] of Object.entries(state.warehouse.items)) {
    if (v < 0 || !Number.isFinite(v)) issue(`仓库 ${k} = ${v}`)
    // B3 乙案：残骸计数 = 体积（打捞单轮可为小数 m³）——残骸类允许小数，其余物品仍须整数
    const isWreck = ctx.items.get(k)?.kind === 'wreck'
    if (!isWreck && !Number.isInteger(v)) issue(`仓库 ${k} = ${v}`)
    if (!ctx.items.has(k)) issue(`仓库引用缺失 ${k}`)
  }
  for (const [uid, f] of Object.entries(state.fleet)) {
    bad(`船${uid}耐久`, f.durability)
    for (const [k, v] of Object.entries(f.cargo ?? {})) {
      if (!ctx.items.has(k)) issue(`货仓引用缺失 ${k}`)
      if (v < 0) issue(`货仓 ${k} = ${v}`)
    }
    for (const slot of ['high', 'mid', 'low'] as const) {
      for (const m of f.fitted[slot] ?? []) {
        if (m !== null && !ctx.modules.has(m)) issue(`装配引用缺失 ${m}`)
      }
    }
  }
  for (const [k, v] of Object.entries(state.moduleBay)) {
    if (!ctx.modules.has(k)) issue(`装备库引用缺失 ${k}`)
    if (v < 0) issue(`装备库 ${k} = ${v}`)
  }
  for (const o of state.orders) {
    if (!ctx.marketGoods.has(o.good)) issue(`挂单引用缺失 ${o.good}`)
  }
  for (const k of Object.keys(state.escrowItems)) {
    if (!ctx.marketGoods.has(k)) issue(`escrow 引用缺失 ${k}`)
  }
  for (const k of Object.keys(state.blueprintStock)) {
    if (!ctx.blueprints.has(k) && !ctx.shipBlueprints.has(k)) issue(`蓝图库存引用缺失 ${k}`)
  }
  for (const k of Object.keys(state.bountyCooldowns)) {
    if (!ctx.anomalies.has(k)) issue(`冷却引用缺失 ${k}`)
  }
  for (const uid of Object.keys(state.aiAssignments)) {
    if (!state.fleet[uid]) issue(`AI 指派引用缺失 ${uid}`)
  }
}

/* ═══════════ 玩家决策动作 ═══════════ */
const TRAIN_ORDER: string[] = []
function buildTrainOrder(): void {
  if (TRAIN_ORDER.length > 0) return
  TRAIN_ORDER.push('ai-expert') // 先出 AI 名额，副船尽早开工
  const groups = ['舰船', '工业', '战斗', '工程', '贸易', '探索', '物流']
  for (const g of groups) {
    for (const s of ctx.skills.values()) {
      if (s.group === g && s.id !== 'ai-expert') TRAIN_ORDER.push(s.id)
    }
  }
}

function refillSkills(): void {
  if (state.skills.queue.length > 0) return
  buildTrainOrder()
  while (true) {
    const next = TRAIN_ORDER.shift()
    if (!next) break
    const cur = state.skills.trained[next] ?? 0
    if (cur >= 5) continue
    // 一次只排一级（T2 连锁），排队放满无妨
    const r = enqueueSkill(state, next, cur + 1, ctx.skills)
    if (!r.ok) issue(`入队失败 ${next} Lv${cur + 1}：${r.error}`)
    else if (state.skills.queue.length > 60) break
    else continue
    break
  }
  if (TRAIN_ORDER.length === 0 && state.skills.queue.length === 0) {
    // 全部练满：兜底重扫一遍（可能有失败的技能）
    for (const s of ctx.skills.values()) {
      const cur = state.skills.trained[s.id] ?? 0
      if (cur < 5) TRAIN_ORDER.push(s.id)
    }
  }
}

/** 当前待造蓝图（最便宜、有市场书、未造过）对某材料的最高需求；
 * 只保留当前一张的量（全量囤积会掐死早期现金流——2026-09-05 模拟器缺陷#2 修正） */
function currentCraftNeed(itemId: string): number {
  const bp = [...ctx.blueprints.values()]
    .filter((b) => goodOf('blueprint', b.id) !== undefined)
    .sort((a, b) => a.priceIsk - b.priceIsk)
    .find((b) => !craftedOnce.has(b.id))
  if (!bp) return 0
  for (const n of bp.materials) if (n.itemId === itemId) return n.count
  return 0
}

function sellEverything(): void {
  const moved = unloadCargoToWarehouse(state)
  if (moved > 0) mark('卸载入仓')
  for (const g of ctx.marketGoods.values()) {
    if (g.kind === 'ship' || g.kind === 'aicore' || g.kind === 'blueprint' || g.kind === 'module') continue // 装备不卖
    const def = ctx.items.get(g.refId)
    if (!def || def.kind === 'ammo' || def.kind === 'drone') continue // 弹药/无人机自用不卖
    const keep = def.kind === 'mineral' ? Math.max(120, currentCraftNeed(g.refId)) : def.kind === 'ore' || def.kind === 'gas' || def.kind === 'ice' ? 150 : 0
    const avail = Math.max(0, countWare(state, g.refId) - keep) + Math.max(0, countItem(state, g.refId) - keep)
    if (avail <= 0) continue
    const res = marketSellHolding(state, ctx, g.key, avail)
    if (!res.ok && !isBenignSellErr(res.error)) issue(`卖出 ${g.key} 失败：${res.error}`)
    else if (res.sold > 0) {
      soldTotal += res.total
      mark(`市价卖出 ${g.key}`)
    }
  }
}

function doMine(): void {
  if (state.mining.active) return
  if (pilotLineBusy()) return
  if (state.expedition.active || state.scanning.active || state.standby.active || state.transit.active) return
  // 任意已探索星系的高价值矿带（本地带价值低，远程带采矿会自动往返）
  const pick = BELT_LIST.find(({ b }) => {
    if ((b.standingReq ?? 0) > standing()) return false
    if (b.galaxyId !== undefined && b.galaxyId !== HOME_GALAXY_ID && !isExplored(state, b.galaxyId)) return false
    return true
  })
  if (!pick) return
  const r = startMining(state, pick.b.id, ctx)
  if (r.ok) {
    setMiningAutoCycle(state, false) // 单趟：满舱返航后停下，回港决策
    mark(`采矿 ${pick.b.name}`)
  } else issue(`采矿 ${pick.b.id} 失败：${r.error}`)
}

let lastRefineDay = -99
function doRefineCraft(): void {
  // pilot 精炼限频：每 6h 至多一轮（验证链即可，避免长期占主控挡采矿/远征）
  if (day() - lastRefineDay < 0.25) return
  if (state.refineRuns.length === 0) {
    const cand = [...ctx.items.values()].find(
      (i) => (i.kind === 'gas' || i.kind === 'ice' || i.kind === 'ore') && i.refine && i.refine.length > 0 && oreAvailable(state, i.id) >= 200 && isHome(),
    )
    if (cand) {
      const r = startRefineRun(state, cand.id, 'pilot', ctx)
      if (r.ok) {
        lastRefineDay = day()
        mark(`精炼 ${cand.name}`)
      } else issue(`精炼 ${cand.id} 失败：${r.error}`)
    }
  }
  // 制造链统一由 doLearnCraft 走（市场买书→学习→造一件）；此处不再另起制造，避免同 bp 重复占产线
}

function doExplore(): void {
  if (state.scanning.active) return
  if (pilotLineBusy()) return // 主控开炉时不出港扫描
  const f = frontierGalaxyIds(state, ctx).find((g) => !isExplored(state, g))
  if (f) {
    const r = startScan(state, f, ctx)
    if (r.ok) mark(`扫描 ${f}`)
    else issue(`扫描 ${f} 失败：${r.error}`)
  }
}

/** 下一个解锁链上但星系未探的悬赏 → 返回其星系（用于指引扫描优先） */
function nextUnseenBountyGalaxy(): string | null {
  const next = ANOMALY_LIST.filter((a) => a.standingReq <= standing() + 2 && !isExplored(state, a.galaxyId)).sort((a, b) => a.standingReq - b.standingReq)[0]
  return next?.galaxyId ?? null
}

let lastAiRotateDay = -99
function doAi(): void {
  if (state.wallet.isk < 60_000) return
  const max = aiCoreCap(state, ctx)
  if (max <= 0) return
  if (countAiCore(state, 'basic') <= 0) {
    const rb = buyBasicAiCore(state, ctx)
    if (!rb.ok) return
  }
  // AI 采矿是无限循环任务（名额不自动释放）——要派打捞就得主动召回轮换：
  // 无打捞在途且采矿 ≥3 时，每天至多召回一艘采矿船腾名额（B3 打捞链覆盖用）
  if (countAiKind('salvage') < 1 && countAiKind('mining') >= 3 && day() - lastAiRotateDay >= 1.0) {
    const victim = Object.keys(state.aiAssignments).find((uid) => {
      const t = state.aiAssignments[uid]?.task
      return t && t.kind === 'mining'
    })
    if (victim) {
      if (cancelAiTask(state, victim, ctx)) {
        lastAiRotateDay = day()
        mark(`AI 采矿轮换：召回 ${victim} 腾打捞名额`)
      }
    }
  }
  // 副船名额判定与引擎 aiCoreCapBlock 同口径（工业占用先抵工业扩容，超出部分才占共用名额）
  if (aiCoreShipUsed(state) + Math.max(0, aiCoreIndustryUsed(state) - industryAiBonus(state, ctx)) >= max) return
  // ⚠ 2026-09-12 批 4：**主力战船不派给 AI 副船任务**（采矿/打捞）——它要留给驾驶位；
  // 否则会出现"唯一能打的船去挖矿、驾驶位只能蹲采矿艇"的死结（实测见 `ensureFlagship` 注释）。
  const flagshipUid = bestCombatShipUid()
  const idle = idleAiShipIds(state).filter((uid) => uid !== flagshipUid)
  if (idle.length === 0) {
    // 买一艘便宜工业船给 AI 用
    const cheap = [...ctx.ships.values()].filter((s) => s.priceIsk > 0 && s.priceIsk < 400_000).sort((a, b) => a.priceIsk - b.priceIsk)[0]
    if (cheap && state.wallet.isk > cheap.priceIsk * 2) {
      const r = buyShip(state, cheap.id, ctx)
      if (!r.ok) issue(`AI 购船 ${cheap.id} 失败：${r.error}`)
    }
    return
  }
  // B3：有打捞点（星系有残骸池）时采矿只占 3 名，其余名额留给打捞轮换（船没打捞器可现场补装）；
  // 无打捞点时全部名额采矿，避免闲置
  const salvagable = salvageGalaxyPick() !== null
  const reserve = salvagable ? Math.min(2, Math.max(0, max - 3)) : 0
  const miningN = countAiKind('mining')
  if (miningN < max - reserve) {
    // 采矿：只派母港/已探明星系的矿带
    const belt = BELT_LIST.find(({ b }) => {
      if ((b.standingReq ?? 0) > standing()) return false
      if (b.galaxyId !== undefined && b.galaxyId !== HOME_GALAXY_ID && !isExplored(state, b.galaxyId)) return false
      return true
    })
    if (belt) {
      const r = assignAiMining(state, idle[0]!, 'basic', belt.b.id, ctx)
      if (!r.ok) issue(`AI 采矿指派失败：${r.error}`)
      else mark(`AI 副船采矿 ${belt.b.id}`)
    }
    return
  }
  // 打捞名额：优先用已装打捞器的空闲船；没有则现场补装（驾驶切过去装 1 台再切回）后派发
  const gal = salvageGalaxyPick()
  if (!gal) return
  for (let tries = 0; tries < Math.min(3, idle.length); tries++) {
    const ship = idle[tries]!
    const hasGear = (state.fleet[ship]?.fitted?.high ?? []).some((m) => m && ctx.modules.get(m)?.slot === 'salvager')
    if (!hasGear && !fitSalvagersTo(ship)) continue
    const r = assignAiSalvage(state, ship, 'basic', gal, ctx)
    if (r.ok) {
      act.aiSalvage++
      mark(`AI 副船打捞 ${ctx.galaxies.get(gal)?.name ?? gal}`)
      return
    }
    if (r.error?.includes('打捞器')) continue // 换下一艘试（装配没成功的场合）
    issue(`AI 打捞指派失败（${ship} → ${gal}）：${r.error}`)
    return
  }
}

/**
 * **船只战力打分（唯一口径 · 2026-09-21 立）**：`档位 × 100 + 槽位总量 × 2`。
 *
 * 为什么不看 `powerBonus`：**2026-09-17 起装甲舰的 `powerBonus` 一律是 0**（改吃甲层抗性）；
 * 旧口径拿它当"谁更能打"，于是**T3 重装巡舰永远输给 T1 护卫舰** ⇒ 模拟全程不升级战舰、
 * 只会在采矿艇与护卫舰之间来回换驾（实测 50 天：声望卡 10、虫洞 0 进度）。
 * 新尺与引擎侧"同档战斗舰"的思路一致：档位是主序，槽位总量（重装线天生槽多、能堆抗性/容量）作次序。
 */
function shipPowerScore(def: { tier?: number; slots?: { high?: number; mid?: number; low?: number } } | undefined): number {
  if (!def) return -1
  return (def.tier ?? 1) * 100 + ((def.slots?.high ?? 0) + (def.slots?.mid ?? 0) + (def.slots?.low ?? 0)) * 2
}

/**
 * 驾驶船策略：在港空闲时始终换驾舰队里最强武装/装甲船（按 `shipPowerScore`）。
 * 修复 v1.0 缺陷：useFreeFalconet 每次回港都把驾驶切回白送鲣鱼，导致升级船永远只停在仓库、
 * 终局战力被免费艇封顶（顶配 68% 黑洞——2026-09-05 记录，模拟器自身策略缺陷）。
 */
function useFreeFalconet(): void {
  if (meBusy() || !isHome() || (pilotLineBusy())) return
  if (state.mining.active || state.expedition.active || state.scanning.active || state.salvaging.active) return
  // ⚠ 2026-09-12 批 4：**先把手里的船还给主力**——旧逻辑只认"空闲且没在 AI 出勤"的船，
  // 于是"主力战船在挖矿"时驾驶位就被留在采矿艇上（实测：跑满 10 天开着沙猫级采矿艇）。
  // `ensureFlagship` 会把出勤中的主力**召回**再换驾；它换成了就直接返回，不必再挑。
  const before = state.shipId
  ensureFlagship()
  if (state.shipId !== before) return
  const cur = fleetDefOf(state, ctx, state.shipId)
  let best: { uid: string; power: number } | null = null
  for (const [uid, f] of Object.entries(state.fleet)) {
    if (state.aiAssignments[uid]) continue // 副船出勤中的不抢
    const def = fleetDefOf(state, ctx, uid)
    if (!def || (def.role !== 'armed' && def.role !== 'armored')) continue
    const power = shipPowerScore(def)
    if (best === null || power > best.power) best = { uid, power }
  }
  if (!best) return
  const curPower = shipPowerScore(cur)
  if (best.power > curPower && best.uid !== state.shipId) {
    const bdef = fleetDefOf(state, ctx, best.uid)
    const r = changeShip(state, best.uid, ctx)
    if (r.ok) {
      mark(`换驾 ${bdef?.name ?? best.uid}（舰队最强，评分 ${best.power}）`)
      autoFitGear(best.uid)
    }
  }
}

/**
 * **舰队主力战船**（2026-09-12 批 4「工具更新」，**2026-09-21 改用 `shipPowerScore`**）：
 * 舰队里最能打的武装/装甲船 uid。
 * ⚠ 与 `useFreeFalconet` 的候选口径**同源**（只认 `armed`/`armored`），但**不看 AI 出勤**——
 * 出勤中的主力要能被**召回**（见 `ensureFlagship`），而不是被当成"舰队里没有这艘船"。
 */
function bestCombatShipUid(): string | null {
  let best: { uid: string; power: number } | null = null
  for (const [uid, f] of Object.entries(state.fleet)) {
    if (!f) continue
    const def = fleetDefOf(state, ctx, uid)
    if (!def || (def.role !== 'armed' && def.role !== 'armored')) continue
    const power = shipPowerScore(def)
    if (best === null || power > best.power) best = { uid, power }
  }
  return best?.uid ?? null
}

/**
 * **出征前把驾驶位还给主力战船**（2026-09-12 批 4 · 修"AI 蹲在采矿艇上打不动终局"）。
 *
 * 背景（实测 2026-09-12 全流程跑通）：模拟器跑满 10 天**始终驾驶沙猫级采矿艇**（火力 20），
 * 而 1.06d 曾换驾的**牛鲨级突击巡洋舰**被派去 AI 采矿/打捞 ⇒ `useFreeFalconet` 的候选
 * **跳过出勤中的船**（`if (state.aiAssignments[uid]) continue`）⇒ 驾驶位**再也回不到战船** ⇒
 * 对穹顶守卫永久 0%，工具自判「策略黑洞（终局受阻）」。
 * 现口径：**主力战船优先给驾驶位**——它在 AI 出勤就**召回**，然后换驾；在途不可取消则下次再说。
 */
function ensureFlagship(): void {
  if (meBusy() || !isHome()) return
  const best = bestCombatShipUid()
  if (!best || best === state.shipId) return
  const cur = fleetDefOf(state, ctx, state.shipId)
  const bdef = fleetDefOf(state, ctx, best)
  // ⚠ 与 `bestCombatShipUid` / `useFreeFalconet` **同一把尺**（2026-09-21 起为 `shipPowerScore`）
  if (shipPowerScore(bdef) <= shipPowerScore(cur)) return
  if (state.aiAssignments[best]) {
    if (!cancelAiTask(state, best, ctx)) return
    mark(`召回主力战船 ${bdef?.name ?? best}（腾出驾驶位）`)
  }
  const r = changeShip(state, best, ctx)
  if (r.ok) {
    mark(`换驾 ${bdef?.name ?? best}（主力归驾驶位，power ${(bdef?.powerBonus ?? 0).toFixed(2)}）`)
    /**
     * ⚠⚠ **换驾之后必须给这艘战舰配装**（**2026-09-21 修，本批最关键的一处**）。
     *
     * 旧口径只换驾、不管配装，而 `autoFitGear()` 是"装到**当前驾驶船**上"的：
     * 于是每一拍的 `buyShipAndGear()` 都在给**当时驾驶的那条船**买炮装炮 —— 而模拟的驾驶位
     * 大部分时间在**采矿艇**上（采矿/打捞会把驾驶位交回主控）⇒ 实测日志里赫然是
     * 「装配 mod-turret-kin-2（**沙猫级采矿艇**）」「装配 mod-turret-kin-3（**沙猫级采矿艇**）」
     * 而**真正出去打仗的鲣鱼级护卫舰一直是裸的**（第 5/10/15 天快照：驾驶沙猫、0 门），
     * 对 23 张悬赏里威胁 ≥34 的 15 张预估胜率一律 2% ⇒ 声望卡死在 8~10、虫洞深层也打不动。
     * 修法：**换驾到战舰的那一刻就把它配满**（`autoFitGear` 现在支持指定 uid）。
     */
    autoFitGear(best)
  }
}

/** 伤害系 → 抗性件后缀（`mod-shield-kin-2` / `mod-armor-exp-2` …） */
const RESIST_KEY: Record<string, string> = { kinetic: 'kin', explosive: 'exp', plasma: 'pla' }

/**
 * **针对性配装**（2026-09-12 批 4）：按目标卡的混伤构成，把**抗性件**换成对口的。
 *
 * 口径沿用混伤批的「**盾抗主系、甲抗副系**」：动能对甲层本就 ×0.5，在甲层再堆动能抗是低效；
 * 而副系会**绕开主抗**，故甲层用来覆盖副系。
 * 只动**抗性件**（`mod-{shield,armor}-{kin,exp,pla}-*`），推进/陀螺/装甲板一律不碰；
 * 需要的新件若没库存则**照市场价买一件**（买不起就跳过，不硬塞）。
 */
function counterFitFor(cardId: string): void {
  const a = ctx.anomalies.get(cardId)
  const fitted = state.fleet[state.shipId]?.fitted
  if (!a || !fitted) return
  const mix = (a as { dmgMix?: Record<string, number> }).dmgMix ?? { kinetic: 8, explosive: 2 }
  const ranked = Object.entries(mix)
    .filter(([, v]) => (v ?? 0) > 0)
    .sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))
  const mainKey = RESIST_KEY[ranked[0]?.[0] ?? 'kinetic'] ?? 'kin'
  const subKey = RESIST_KEY[ranked[1]?.[0] ?? ranked[0]?.[0] ?? 'kinetic'] ?? mainKey
  const ensureOwned = (id: string): boolean => {
    if ((state.moduleBay[id] ?? 0) > 0) return true
    const g = goodOf('module', id)
    if (!g) return false
    if (state.wallet.isk < g.basePrice * 1.5 + 20_000) return false
    buyAtMarket(state, ctx, g.key, 1)
    return (state.moduleBay[id] ?? 0) > 0
  }
  const swapResist = (rack: 'mid' | 'low', family: string, key: string): void => {
    const id = `mod-${family}-${key}-2`
    if (!ctx.modules.has(id) || !ensureOwned(id)) return
    const arr = fitted[rack]
    const isResist = new RegExp(`^mod-${family}-(kin|exp|pla)-`)
    const at = arr.findIndex((m) => m !== null && isResist.test(m))
    if (at >= 0) {
      if (arr[at] !== id) arr[at] = id
      return
    }
    const free = arr.indexOf(null)
    if (free >= 0) arr[free] = id
  }
  swapResist('mid', 'shield', mainKey)
  swapResist('low', 'armor', subKey)
}

/** 按品质降序找某个装备家族的成员（用于自动配装）。
 *
 * ⚠ **只考虑市场买得到的**（2026-09-12 修卡关 ①）：窝点专属装备（`mod-lair-*`）按「来源唯一契约」
 * **本就没有市场卡**（唯一来源 ＝ 高级箱），而它们的数值往往高于制式件（例：`mod-lair-armor-d`
 * 陵寝装甲层 `armorHpBonus 1.1` ＝ 全表最高，压过 `mod-armor-plate-3` 的 0.8）⇒ 旧写法会把它选中，
 * 随后在 `tryOne` 里取不到市场行而崩。本工具别处一律用 `goodOf('module', …)` 过滤
 * （见 `collectStatus` / 补件处），这里此前是唯一漏网的两处之一。 */
function familyBest(
  slot: string,
  quality: (m: { shieldHpBonus?: number; armorHpBonus?: number }) => number,
): { id: string; name: string } | undefined {
  const pool = [...ctx.modules.values()]
    .filter((m) => m.slot === slot && m.rack !== 'high')
    .filter((m) => goodOf('module', m.id) !== undefined)
    .sort((a, b) => quality(b) - quality(a))
  const top = pool[0]
  return top ? { id: top.id, name: top.name } : undefined
}

/** 给**指定那艘船**自动配装：高槽武器 + 中槽盾 + 低槽甲 + 支援件（逐件尝试，CPU 超了就跳过）
 *
 * ⚠ **2026-09-21 批**：由"只装当前驾驶船"改为**可指定 uid** —— 旧口径只喂驾驶船，于是
 * "驾驶=采矿艇"的那些拍把炮买下来又装不上去（`fitModule` 按**驾驶船**找空槽，采矿艇高槽不够就白买），
 * 而真正要打仗的护卫舰一直**裸着空槽**（实测第 20 天：鲣鱼级护卫舰 高槽 0/3、火力 10）。
 * 现在舰船升级流程显式对**新买的战舰**调用本函数。 */
function autoFitGear(shipUid: string = state.shipId): void {
  const cur = fleetDefOf(state, ctx, shipUid)
  if (!cur) return
  const fitted = state.fleet[shipUid]?.fitted
  if (!fitted) return
  const allFitted = [...fitted.high, ...fitted.mid, ...fitted.low].filter((x): x is string => x !== null)
  const roomIn = (rack: 'high' | 'mid' | 'low'): boolean => fitted[rack].filter((x) => x !== null).length < (cur.slots?.[rack] ?? 0)
  const GUN_TIERS = ['mod-turret-kin-3', 'mod-turret-kin-2', 'mod-turret-kin-1'] // 高档在前
  const gunGood = (id: string): { key: string; price: number } | undefined => {
    const g = [...ctx.marketGoods.values()].find((x) => x.kind === 'module' && x.refId === id)
    return g ? { key: g.key, price: g.basePrice ?? 100_000 } : undefined
  }
  const highCap = cur.slots?.high ?? 1
  /**
   * ⚠ **装炮口径（2026-09-21 修）**：旧写法"空槽先装 1 档、以后逐级升级"在**钱多但档位被
   * CPU/货架卡住**时会把槽位长期占在最低档（实测：40 天里高槽始终只有 1~2 门 1 档炮）。
   * 现改为**每个空槽直接装"当前买得起的最高档"**（同一档买不到再降档试）。这也是玩家会做的事。
   */
  for (let i = 0; i < highCap; i++) {
    if (fitted.high[i]) continue
    const g0 = state.fleet[shipUid]
    void g0
    for (const gunId of GUN_TIERS) {
      const g = gunGood(gunId)
      if (!g) continue
      if (state.wallet.isk < g.price * 1.5 + 20_000) continue
      // 装到**这艘船**上：先把驾驶位切到它（`fitModule` 按驾驶船找槽），装完由调用方决定是否切回
      const prevShip = state.shipId
      if (prevShip !== shipUid) {
        const sw = changeShip(state, shipUid, ctx)
        if (!sw.ok) return
      }
      buyAtMarket(state, ctx, g.key, 1)
      const okFit = fitModuleTo(state, gunId)
      if (prevShip !== shipUid) changeShip(state, prevShip, ctx)
      if (okFit) {
        mark(`装配 ${gunId}（${cur.name}）`)
        break
      }
    }
  }
  // 单件补强：只装一件，已有同 id 或槽满即跳过（防重复购买抽血）
  // ⚠ **买不到就跳过、不许崩**（2026-09-12 修卡关 ①）：`goodOf` 查不到市场行（＝窝点专属件这类
  // "唯一来源 ＝ 高级箱"的装备）时直接 return——旧写法用 `!` 断言取 `.key`，取不到即抛
  // `TypeError: Cannot read properties of undefined (reading 'key')`（调用方却已用 `?.` 兜底价格，
  // 口径本就不一致）。这里是第二道保险：`sup1`/`sup2` 是直接扫 `ctx.modules` 得来的，不受
  // `familyBest` 的过滤保护。
  const sh = familyBest('shield', (m) => m.shieldHpBonus ?? 0)
  const ar = familyBest('armor', (m) => m.armorHpBonus ?? 0)
  const sup1 = [...ctx.modules.values()].find((m) => m.slot === 'support' && (m.damageTypeBonusPct?.kinetic ?? 0) > 0)
  const sup2 = [...ctx.modules.values()].find((m) => m.slot === 'support' && (m.hitBonusPct ?? 0) > 0)
  /**
   * ⚠⚠ **每个空槽都要装，不能只装一件/族**（**2026-09-21 修，本批第二个关键修复**）。
   *
   * 旧写法是"每族只 `tryOne` 一次"，而 `tryOne` 里还有 `allFitted.includes(defId)` 这道闸
   * ⇒ **每艘船最多只装 1 件盾 + 1 件甲 + 2 件支援 = 4 件**，而 T3 巡洋舰的中低槽有 3~9 个、
   * 四舰编队合计 12+ 个。实测读数（编队战力明细）就是这样：
   * `高5/5 中1/2 低1/4` —— **中低槽 3/6 空着**，四舰合计 `炮 20/44 槽`。
   * 空槽 = 白丢的护盾上限与装甲上限，而虫洞第 1 层的余量正是卡在这上面（残血 35% vs 门槛 45%）。
   *
   * 新写法：把"每族一件"改成**反复装到槽满或买不起为止**（每族最多迭代 8 次，防跑飞）。
   * 幂等性由 `roomIn` + `allFitted` 保证；同族多件是同 id 多件，`allFitted.includes` 会挡住重复 ——
   * 所以这里改成"**数同族已装件数**"来判断还能不能再装一件。
   */
  const countFitted = (defId: string): number => allFitted.filter((x) => x === defId).length
  const fillRack = (rack: 'mid' | 'low', defId: string | undefined, priceRef: number, max: number): void => {
    if (!defId) return
    for (let i = 0; i < max; i++) {
      if (!roomIn(rack)) return
      if (state.wallet.isk < priceRef * 1.5 + 20_000) return
      const good = goodOf('module', defId)
      if (!good) return
      const prevShip = state.shipId
      if (prevShip !== shipUid) {
        if (!changeShip(state, shipUid, ctx).ok) return
      }
      buyAtMarket(state, ctx, good.key, 1)
      const ok = fitModuleTo(state, defId)
      if (prevShip !== shipUid) changeShip(state, prevShip, ctx)
      if (!ok) return // 装不上（CPU 超载/槽位限制）⇒ 这件到此为止，别死循环买
      mark(`装配 ${defId}（${cur.name} · 第 ${countFitted(defId)} 件）`)
    }
  }
  // 中槽：先铺护盾，再支援件；低槽：铺装甲。各最多 5 件（T3 中/低槽最多 5）
  fillRack('mid', sh?.id, goodOf('module', sh?.id ?? '')?.basePrice ?? 50_000, 5)
  fillRack('low', ar?.id, goodOf('module', ar?.id ?? '')?.basePrice ?? 50_000, 5)
  fillRack('mid', sup1?.id, goodOf('module', sup1?.id ?? '')?.basePrice ?? 30_000, 3)
  fillRack('mid', sup2?.id, goodOf('module', sup2?.id ?? '')?.basePrice ?? 30_000, 3)
}

const craftedOnce = new Set<string>()
/** 正在为虫洞编队自造的舰型（`refId → 舰名`；纯诊断用，报告里显示"造船中"） */
let whShipBuild: string | null = null

/**
 * **自造舰船补编队**（2026-09-21 新增，解决"稀有现货限速"）。
 *
 * 为什么必须自造：rare 舰船**每 10 分钟抽取窗只出 1 艘**（`spawnRareSupply`），而稀有池有几十种商品
 * 在抢抽取额 ⇒ 实测"一天只凑到 1~2 艘 T3"，4 艘要等好几天；T4（玄武级）现货还要**声望 20**
 * （实测 60 天只到 15）⇒ 想再上一档战力，**现货路是死的**。
 *
 * **一次性舰船蓝图**（`sbp-once-*`，`singleUse: true`）是唯一的量产路：
 * 书在市场有售（声望 8~25），**买书 → 备料 → 开工**，一次造一艘、书当场吃掉，再造就再买一本；
 * 料价约 300~400 万/艘（现货 750~1550 万），且**不受抽取限速**（矿料是 common 池，供给充足）。
 *
 * ⚠ 三条引擎口径（读 `manufacturing.ts` 核过，第一版差点写错）：
 * ① **一次性图纸不能"学习"**——`learnBlueprint` 会**明确报错拒绝**（`core.market.002`）
 *    ⇒ 老 `doLearnCraft` 的 `if (!ownsBlueprint(...)) learn` 这道门会把一次性图纸**永远卡死**
 *    （买书→学习失败→`return`，无限循环）。本函数**不走学习**，直接 `startManufacturing`。
 * ② **`spentOneTimeRecipes` 只记"用过的名额"，不是"永久学会"** ⇒ `recipeCapability` 判据是
 *    "**书架有书**就可用"（书优先于名额）⇒ 再造一次就是**再买一本**。
 * ③ 未学过的普通图纸 `canStartBlueprint` 返回 false，但一次性图纸只要有书就 true ⇒ 走本函数。
 */
function ensureWhShipBuild(): void {
  if (!WANTS.whach || goalDone.whach) return
  if (whCapableShips().length >= WH_FLEET_SIZE) {
    whShipBuild = null
    return
  }
  if (state.manufacturingRuns.length > 0) return // 一次只开一条线
  if (meBusy() || !isHome()) return
  if (state.expedition.active || state.scanning.active || state.transit.active || state.standby.active) return
  const mine = new Set<string>()
  for (const f of Object.values(state.fleet)) if (f?.defId) mine.add(f.defId)
  const cands = SHIP_BLUEPRINTS.filter((b) => {
    if (b.singleUse !== true) return false
    const good = goodOf('blueprint', b.id)
    if (!good) return false
    const s = ctx.ships.get(b.shipId)
    if (!s) return false
    if (s.role !== 'armed' && s.role !== 'armored') return false
    if (!wormholeShipAllowed(s)) return false
    if ((s.tier ?? 1) < WH_FLEET_TIER) return false
    if (mine.has(b.shipId)) return false // 同型一艘就够（4 艘全同型没必要）
    return true
  }).sort((a, b) => {
    const sa = ctx.ships.get(a.shipId)
    const sb = ctx.ships.get(b.shipId)
    return (sa?.tier ?? 1) - (sb?.tier ?? 1) || a.priceIsk - b.priceIsk
  })
  if (cands.length === 0) return
  const pick = cands[0]!
  const good = goodOf('blueprint', pick.id)!
  const sdef = ctx.ships.get(pick.shipId)
  const stock = state.blueprintStock[pick.id] ?? 0
  if (stock <= 0) {
    if (state.wallet.isk < good.basePrice + 30_000) return
    buyAtMarket(state, ctx, good.key, 1)
    return
  }
  const bld = findBuildable(ctx, pick.id)
  if (!bld) return
  // 备料：缺什么买什么（矿料是 common 池、供给充足；买完 return，下一拍再看够不够）
  const missing = bld.spec.materials.filter((n) => countWare(state, n.itemId) < n.count)
  if (missing.length > 0) {
    let cost = 0
    for (const n of missing) {
      const g = [...ctx.marketGoods.values()].find((x) => x.kind === 'item' && x.refId === n.itemId)
      cost += (g?.basePrice ?? 10) * (n.count - countWare(state, n.itemId))
    }
    // 现金策略：先满足 10 亿目标（≥3 亿）再造船；两个目标并行时不把造舰挤掉
    if (state.wallet.isk < cost + 300_000_000) return
    for (const n of missing) {
      const g = [...ctx.marketGoods.values()].find((x) => x.kind === 'item' && x.refId === n.itemId)
      if (g) buyAtMarket(state, ctx, g.key, n.count - countWare(state, n.itemId))
    }
    return
  }
  const basicFree = countAiCore(state, 'basic') > 0 && aiCoreCapBlock(state, ctx, 'industry') === null
  const worker: 'pilot' | 'basic' = basicFree ? 'basic' : 'pilot'
  if (worker === 'pilot' && pilotLineBusy()) return
  const r = startManufacturing(state, pick.id, worker, ctx)
  if (r.ok) {
    whShipBuild = sdef?.name ?? pick.shipId
    act.craft++
    mark(`🐟 自造舰船开工：${sdef?.name ?? pick.shipId}（一次性蓝图 · 书 ${Math.round(good.basePrice / 1000)}k · 耗时 ${Math.round(pick.buildSeconds / 3600)}h）`)
  } else issue(`自造舰船 ${pick.id} 开机失败：${r.error}`)
}

/**
 * 蓝图：市场买书 → 学习 → 制造一件（制造链验证一次；防重复造抽血）。
 * 只处理市场有书可购的配方（碎片/原型专属配方无书，模拟不代打碎片）；无书配方跳过不卡循环。
 */
function doLearnCraft(): void {
  if (state.manufacturingRuns.length > 0) return
  /** **虫洞备战优先**：编队缺船时把唯一的制造线让给"自造舰船"（见 `ensureWhShipBuild`） */
  if (WANTS.whach && !goalDone.whach && whCapableShips().length < WH_FLEET_SIZE) {
    ensureWhShipBuild()
    return
  }
  const bp = [...ctx.blueprints.values()]
    .filter((b) => goodOf('blueprint', b.id) !== undefined)
    .sort((a, b) => a.priceIsk - b.priceIsk)
    .find((b) => !craftedOnce.has(b.id))
  if (!bp) return
  const book = [...ctx.marketGoods.values()].find((x) => x.kind === 'blueprint' && x.refId === bp.id)
  if (book) {
    const stock = state.blueprintStock[bp.id] ?? 0
    if (stock <= 0) {
      if (state.wallet.isk < book.basePrice + 30_000) return
      buyAtMarket(state, ctx, book.key, 1)
      return
    }
  }
  if (!ownsBlueprint(state, bp.id)) {
    const r = learnBlueprint(state, ctx, bp.id)
    if (r.ok) {
      act.learnBp++
      mark(`学习蓝图 ${bp.name}`)
    } else issue(`学习蓝图 ${bp.id} 失败：${r.error}`)
    return
  }
  // 缺料直接市场补：材料条目从蓝图定义取（missingMaterials 只返回人话提示，不能当数据用——
  // 一号 v1.0 的 m.itemId/m.count 循环从不买料，导致制造永不启动：模拟器自身缺陷，2026-09-05 修）
  const bld = findBuildable(ctx, bp.id)
  if (!bld) return
  if (state.wallet.isk < 50_000) return // 留现金缓冲（制造费已于 2026-09-08 取消；此处为日常开销保底）
  if (bld.spec.materials.some((n) => countWare(state, n.itemId) < n.count)) {
    for (const n of bld.spec.materials) {
      const have = countWare(state, n.itemId)
      const want = n.count - have
      if (want <= 0) continue
      const g = [...ctx.marketGoods.values()].find((x) => x.kind === 'item' && x.refId === n.itemId)
      if (g && state.wallet.isk > (g.basePrice ?? 10) * want * 2) buyAtMarket(state, ctx, g.key, want)
    }
    return
  }
  // 劳动者制（2026-09：pilot 开线占手动工作位、互斥采矿/远征/精炼）——
  // 有闲置 AI 核心优先用核心驱动（不挡主控），否则由主控亲自开（忙时下轮再试）
  // 2026-09-09：口径对齐引擎 aiCoreCapBlock('industry')——仅核心库存>0 不够，
  // 启用上限（技能 AI 核心操作学）已满时引擎会拒单，此前误报制造失败
  const basicFree = countAiCore(state, 'basic') > 0 && aiCoreCapBlock(state, ctx, 'industry') === null
  const worker: 'pilot' | 'basic' = basicFree ? 'basic' : 'pilot'
  if (worker === 'pilot' && pilotLineBusy()) return
  const r = startManufacturing(state, bp.id, worker, ctx)
  if (r.ok) {
    craftedOnce.add(bp.id)
    act.craft++
    mark(`制造 ${bp.name}`)
  } else issue(`制造 ${bp.id} 失败：${r.error}`)
}

let lastShipUpgradeDay = -99

/**
 * **把无人机库里的机装进各舰机舱**（2026-09-21 新写；见 `buyShipAndGear` 里的调用点注释）。
 *
 * 顺序：① 先补齐货架（三种制式机各备几架，缺了才买）→ ② 给**舰队里每艘有舱的船**按
 * "单发伤害高者优先"算出目标装载 → ③ 走引擎自己的 `refillDroneLoadTo` 落库
 * （它自己做舱容 + CPU 双重校验，并从**船上货仓优先、其次物品仓库**取货，不自动买）。
 *
 * ⚠ `refillDroneLoadTo` 只对**当前驾驶船**生效（它读 `state.fleet[shipId]`）⇒ 这里要先切驾驶位；
 * 与 `autoFitGear` 同一手法（切过去 → 装 → 切回来）。切不回去也没关系，主循环每拍会 `ensureFlagship`。
 */
function ensureDroneLoads(): void {
  if (meBusy() || !isHome()) return
  if (state.expedition.active || state.scanning.active || state.salvaging.active) return
  /** 制式机优先级 = 单发伤害降序（每 m³ 伤害三档相同 ⇒ 大机先装、小机补空隙） */
  const DRONE_ORDER = ['drone-heavy', 'drone-assault', 'drone-scout']
  const droneDefs = DRONE_ORDER.map((id) => ctx.items.get(id)).filter((d): d is NonNullable<typeof d> => !!d)
  if (droneDefs.length === 0) return
  for (const uid of Object.keys(state.fleet)) {
    const f = state.fleet[uid]
    const def = fleetDefOf(state, ctx, uid)
    if (!f || !def) continue
    if (def.role !== 'armed' && def.role !== 'armored') continue
    const bay = def.droneBayM3 ?? 0
    if (bay <= 0) continue
    const cap = cpuBudgetOf(state, ctx, uid)
    const used = fittedCpuUsed(f.fitted, ctx, def) + droneCpuUsed(f.droneLoad, ctx)
    let freeCpu = cap > 0 ? cap - used : 0
    let freeM3 = bay - droneLoadM3(f.droneLoad, ctx)
    if (freeM3 <= 0) continue
    /** 目标装载：贪心按"伤害降序"填，装不下就换小一档继续填（尾隙不浪费） */
    const target: Record<string, number> = {}
    for (const d of droneDefs) {
      const m3 = d.unitM3 ?? 1
      const cpu = d.cpuUse ?? 0
      while (freeM3 - m3 >= -1e-6 && (cap <= 0 || freeCpu - cpu >= -1e-6)) {
        // 先补齐货架（缺了才买：船上货仓 + 物品仓库 + 市场余额三道一起看）
        const have = (f.cargo?.[d.id] ?? 0) + countWare(state, d.id)
        const want = (target[d.id] ?? 0) + 1
        if (have < want) {
          const g = [...ctx.marketGoods.values()].find((x) => x.kind === 'item' && x.refId === d.id)
          const price = g?.basePrice ?? d.baseSellPriceIsk ?? 5_000
          if (!g || state.wallet.isk < price * 10 + 100_000) break // 留钱：别为无人机把现金抽干
          buyAtMarket(state, ctx, g.key, want - have)
        }
        target[d.id] = want
        freeM3 -= m3
        freeCpu -= cpu
      }
    }
    if (Object.keys(target).length === 0) continue
    /**
     * ⚠ **必须让货在"船上货仓"或"物品仓库"里**：`refillDroneLoadTo` 只从这两处取（不自动买）。
     * 市场买进来是 `addWare`（物品仓库）⇒ `countWare` 查得到，天然满足。
     */
    const prevShip = state.shipId
    if (prevShip !== uid) {
      if (!changeShip(state, uid, ctx).ok) continue
    }
    const r = refillDroneLoadTo(state, ctx, uid, target)
    if (prevShip !== uid) changeShip(state, prevShip, ctx)
    const added = Object.values(r.added).reduce((s, n) => s + n, 0)
    if (added > 0) mark(`装无人机 ${added} 架（${def.name}）`)
  }
}/**
 * **升级舰船与配装**（2026-09-21 批大改；旧口径有三个叠加缺陷，实测导致"50 天只有 1 门炮"）：
 *
 * ① **升级目标太窄**：旧写法只买 `role === 'armed'` 且 `powerBonus` **更高**的船，且"已拥有就不买"⇒
 *    模拟手里那条**白送鲣鱼**（power 0.15）会把 0.15 的同级船全过滤掉，而更高档的船都卡在声望门槛上
 *    ⇒ 全程买不到第二条战舰、只能开着采矿艇出去打（第 20 天火力 10）。
 *    现改为：**目标 = 能买得起、声望够、且比手上这条更强**（按 `tier → powerBonus → 价` 综合评分），
 *    允许买**同型第二艘**（虫洞四舰编队正需要），并把"能不能带进虫洞"也算进评分。
 * ② **买完不配装**：旧写法买船即换驾、**从不给它配炮** ⇒ 新船是裸的，战力反而更低。现在买完立刻
 *    `autoFitGear(新船)`（并把驾驶位留在它身上）。
 * ③ **只在 `homeLull()` 里调用**：模拟长期在远征/采矿循环里 ⇒ 这条路径经常整段跑不到。现在主循环
 *    每拍都会调一次（内部自带"每天至多一次买船"的节流与"在忙就跳过"的守卫）。
 */
/**
 * **战力阶梯：攒钱 → 买下一档战舰 → 当场配满 → 再打更高威胁的卡**
 * （**2026-09-21 批**，本批最关键的一处修复）。
 *
 * 为什么必须显式写一条阶梯：旧口径只会"拟合手里最强的那条船"，而模拟长期只有
 * **白送鲣鱼级护卫舰（tier 1 / power 0.15）** ⇒ 对 23 张悬赏里**威胁 ≥34 的 15 张**预估胜率一律
 * **2%**（实测 35 天读数）⇒ 声望永远停在 10、虫洞深层也打不动。而它其实**攒得起**钱
 * （实测第 45 天 22.7 亿），只是**没有"把钱换成战力"这一步**：
 *   · 灰鲭鲨级驱逐舰（T2 / power 0.2 / 48 万 / 无声望门槛）—— 第一道门槛
 *   · 大白鲨级炮舰（T2 / power 0.35 / 110 万 / 声望 7）
 *   · 长尾鲨级导弹巡洋舰（T3 / power 0.25 / 900 万 / 声望 8）
 *   · 锤头鲨级炮击巡洋舰（T3 / power 0.25 / 1100 万 / 声望 8）
 * 阶梯按"够得着的最强"逐级推进；买完**立刻配装**（否则裸船出航反而更弱），并把驾驶位留在它身上。
 */
function buyShipAndGear(): void {
  if (meBusy() || !isHome() || state.mining.active) return
  /**
   * **把低档件升级成高档**（2026-09-21 新加，第四批）。
   *
   * 为什么必须单独有一条"升级"通道：`autoFitGear` 的装炮循环是
   * "遇到第一个空槽 → 从高档往下试 → **装上就 break**" ⇒ 钱不够时它会**装上 MK1**，
   * 而此后那个槽**永远不再是空槽**、再也不会被升级。
   * 实测证据：`电鳐级激光巡洋舰(高5/5 CPU60/444)` —— 5 门炮只花 60 CPU，
   * 而 MK3 炮一台就要 52 ⇒ 这 5 门全是 **MK1**（10~12 CPU/门），
   * 且 CPU 余量 384 完全够换 MK3（**不是 CPU 卡的，是没这条通道**）。
   *
   * 口径：**每拍最多升 1 门**（每次升级要真花钱），先升最便宜的那门（把整队铺满高档优先于
   * 单舰顶配）；只升不降，且必须"新件比旧件强"才动（按 `dmgMult` 比）。
   */
  upgradeGunsOneStep()
  if (meBusy() || !isHome() || state.mining.active) return
  /**
   * ⚠ **只在"没有在途远征/扫描/打捞"时动手**：本函数内部会**切驾驶位**（给僚舰装件要先切过去，
   * 见 `autoFitGear`）——在航活动中切驾驶会与引擎的互斥打架。这三条守卫是 2026-09-21 把本函数
   * 从 `homeLull()` 里搬出来时补的（旧位置天然满足，搬出来就必须自己判）。
   */
  if (state.expedition.active || state.scanning.active || state.salvaging.active) return
  const curDef = fleetDefOf(state, ctx, state.shipId)
  if (curDef && day() - lastShipUpgradeDay >= 1) {
    /**
     * **打分口径（2026-09-21 修）**：旧写法是 `tier*10 + powerBonus*20` —— 而 **2026-09-17 起
     * 装甲舰的 `powerBonus` 一律是 0**（改成吃甲层抗性了）⇒ 在那把尺下 **T3 重装巡舰永远输给
     * T1 护卫舰**，模拟于是全程不升级。现改为"**档位 + 槽位总量**"：与引擎侧"同档战斗舰"口径一致
     * （重装线天生槽多、血厚），**不看 `powerBonus`**。
     */
    const scoreOf = (s: { tier?: number; slots?: { high?: number; mid?: number; low?: number } }): number =>
      (s.tier ?? 1) * 100 + ((s.slots?.high ?? 0) + (s.slots?.mid ?? 0) + (s.slots?.low ?? 0)) * 2
    const curScore = scoreOf(curDef)
    const owned = new Set<string>()
    for (const f of Object.values(state.fleet)) if (f?.defId) owned.add(f.defId)
    const target = [...ctx.ships.values()]
      .filter((s) => {
        if (s.role !== 'armed' && s.role !== 'armored') return false
        if (!wormholeShipAllowed(s)) return false // 带不进洞的船对"虫洞成就"这条目标没用
        if (scoreOf(s) <= curScore + 0.01) return false // 不比手上这条强就不买
        const g = [...ctx.marketGoods.values()].find((x) => x.kind === 'ship' && x.refId === s.id)
        if (!g) return false
        if ((g.standingReq ?? 0) > standing()) return false
        return state.wallet.isk > s.priceIsk * 1.3 + 400_000
      })
      /**
       * **排"够得着的最强"**：先比综合评分（tier → 火力加成），同分再挑**便宜的**。
       * ⚠ 与旧口径的差别在"允许买**同型第二艘**"：`owned` 只在"同型已满编（4 条）"时才排除
       * （虫洞四舰编队正需要同型多艘），否则留着它会把所有能打的船都挡在门外。
       */
      .filter((s) => Object.values(state.fleet).filter((f) => f?.defId === s.id).length < 4)
      .sort((a, b) => scoreOf(b) - scoreOf(a) || a.priceIsk - b.priceIsk)[0]
    if (target) {
      const g = [...ctx.marketGoods.values()].find((x) => x.kind === 'ship' && x.refId === target.id)
      if (g) {
        const got = buyAtMarket(state, ctx, g.key, 1)
        if (got.shipUid) {
          const r = changeShip(state, got.shipUid, ctx)
          if (r.ok) {
            lastShipUpgradeDay = day()
            mark(`换驾 ${target.name}（tier ${target.tier ?? 1} · power ${target.powerBonus ?? 0}）`)
            // ② 买完立刻配装（否则裸船出航，战力还不如旧的）
            autoFitGear(got.shipUid)
          }
        }
      }
    } else if (!owned.has(state.fleet[state.shipId]?.defId ?? '')) {
      // 手上这条不在手里（异常态）⇒ 至少把自己配起来
      autoFitGear(state.shipId)
    }
  }
  // 弹药补货
  for (const g of AMMO_GOODS) {
    if (countWare(state, g.refId) < 500) {
      const want = 1000 - countWare(state, g.refId)
      if (state.wallet.isk > want * g.basePrice * 2 + 30_000) buyAtMarket(state, ctx, g.key, want)
    }
  }
  /**
   * **弹药选高档 MK2**（2026-09-21 第十批 · 隔离实验 3，**带现金门槛**）。
   *
   * 引擎口径（`combat.resolveAmmoTier`）：开战按"**同族取能装得最多的一档**"装载，
   * 平局才看"本船 `ammoPref` ＞ 基础弹 ＞ 其余"；而本工具**从没设过 `ammoPref`**、
   * 也只买基础弹 ⇒ 平局永远落在基础弹上（白丢 **+33% 单发**：动能 6→8 / 爆破 7→9 / 能量 9→12）。
   *
   * ⚠ 第五轮**不带门槛**地做过一次，结果**前期经济被打崩**（现金 4.5 万、层深 0）
   * ⇒ 现加 `SPEND_FOR_POWER_ISK` 闸：**只在 10 亿目标基本达成后才开始换高档弹**。
   * 备货量要**高于基础弹**（MK2 备 2000、基础弹 1000）：排序第一键是"可装量最大者优先"，
   * MK2 少于基础弹时平局规则救不了它；`ammoPref` 是第二道保险。
   */
  if (state.wallet.isk >= SPEND_FOR_POWER_ISK) {
    for (const g of AMMO_MK2_GOODS) {
      if (countWare(state, g.refId) < 1500) {
        const want = 2000 - countWare(state, g.refId)
        buyAtMarket(state, ctx, g.key, want)
      }
    }
    for (const uid of Object.keys(state.fleet)) {
      const def = fleetDefOf(state, ctx, uid)
      if (!def || (def.role !== 'armed' && def.role !== 'armored')) continue
      const pref = state.fleet[uid]?.ammoPref ?? {}
      for (const [type, id] of [
        ['kinetic', 'ammo-kinetic-2'],
        ['explosive', 'ammo-explosive-2'],
        ['plasma', 'ammo-plasma-2'],
      ] as const) {
        if (pref[type] === id) continue
        if (countWare(state, id) < 100) continue
        setAmmoTier(state, ctx, type, id, uid)
      }
    }
  }
  // 无人机补给（装配外战力：bay 自动放飞；drone-sentry/assault/heavy 各备 5 架）
  for (const droneId of ['drone-sentry', 'drone-heavy', 'drone-assault']) {
    if (countWare(state, droneId) < 5 && state.wallet.isk > 1_000_000) {
      const g = [...ctx.marketGoods.values()].find((x) => x.kind === 'item' && x.refId === droneId)
      if (g) buyAtMarket(state, ctx, g.key, 5 - countWare(state, droneId))
    }
  }
  // ⚠ 每拍都补装一次**当前驾驶船**（受"已装同件/槽满"保护 ⇒ 幂等、不会重复抽血）
  autoFitGear(state.shipId)
  /**
   * **无人机舱装载**（2026-09-21 新写）。
   *
   * 背景（实测读数）：编队战力明细里 **无人机 0 架**，而编队每艘 T3 都有 50~160 m³ 的机舱空着
   * （鹦鹉螺 160 m³、牛鲨/电鳐 50 m³）—— 无人机是**独立于槽位的火力通道**，
   * 不放飞就是纯浪费（`droneLoad` 从来没被写过：工具只买过无人机，从没装上船）。
   *
   * 选型口径 = **每立方米伤害最高**（重舱优先），实测三种制式机每 m³ 伤害是平的 0.6，
   * 所以按"单发伤害高的先装"就能自然填满（猎鹰 20m³/12 伤 ＞ 赤鸢 10m³/6 伤 ＞ 蜂鸟 5m³/3 伤），
   * 小舱恰好用轻型机补满、不留空隙。装填走引擎自己的 `refillDroneLoadTo`（舱容 + CPU 双重校验）。
   */
  ensureDroneLoads()
  /**
   * **逐舰补装**（**2026-09-21 补**）：`autoFitGear` 只装"传进去的那一艘"，而虫洞要的是
   * **整队**（最多 4 艘）⇒ 实测编队里 T3 主舰有炮、三艘 T1 僚舰全是**裸的**，
   * `whReady` 的真跑门于是稳定"0 秒团灭"、一趟都进不去。
   * ⚠ 原写法"**每拍只补一艘**"太慢：一艘 13 槽要 13 拍才算配齐，4 艘就是几十拍，
   * 而备战的窗口期本来就不长（买船受现货限制）。现改为**按档位从高到低、每拍最多补 3 艘**
   * （仍然限量：每条 `autoFitGear` 会真花钱买件，一次全配会把现金抽干、把 10 亿目标挤掉）。
   * 优先补 `whCapableShips()` 里的船（= 能进洞的那批），再从剩下能带进洞的战斗舰里挑。
   */
  const order = whCapableShips().sort(
    (a, b) => (fleetDefOf(state, ctx, b)?.tier ?? 0) - (fleetDefOf(state, ctx, a)?.tier ?? 0),
  )
  for (const uid of Object.keys(state.fleet)) {
    if (order.includes(uid) || uid === state.shipId) continue
    const def = fleetDefOf(state, ctx, uid)
    if (def && (def.role === 'armed' || def.role === 'armored') && wormholeShipAllowed(def)) order.push(uid)
  }
  let fittedNow = 0
  for (const uid of order) {
    /**
     * ⚠ **不能跳过"已配满高槽"的船**：同型 4 艘买齐后 `shipPowerScore` 完全相同 ⇒
     * `ensureFlagship` / `useFreeFalconet` 的 `>` 比较**不会**换驾（也不该换）⇒
     * 主控永远开着第 1 艘、后买的 3 艘**永远不是驾驶船**。若这里按"驾驶船已在高槽里配好"就跳过，
     * 那 3 艘就再也轮不到配装（第一版就是这么写的，实测会卡住）。所以**每艘都试**，
     * "已装同件/槽满"由 `autoFitGear` 自己幂等挡掉（不重复花钱）。
     */
    if (uid === state.shipId) continue
    if (state.aiAssignments[uid]) continue
    const f = state.fleet[uid]
    const def = fleetDefOf(state, ctx, uid)
    if (!f || !def) continue
    const guns = (f.fitted?.high ?? []).filter(Boolean).length
    if (guns >= (def.slots?.high ?? 0)) continue
    if (state.wallet.isk < 300_000) break // 现金保底：不把最后一笔钱全变成炮
    autoFitGear(uid)
    fittedNow += 1
    if (fittedNow >= 3) break
  }
}

function fitModuleTo(state: GameState, moduleId: string): boolean {
  const r = fitModule(state, moduleId, ctx)
  return r.ok
}

/**
 * **把一门低档炮换成同线高档炮**（见 `buyShipAndGear` 里的调用点注释）。
 *
 * 只处理**高槽炮**这一条线（`mod-turret-kin-1/2/3`）：这条线的档位差最直接（MK3 单发 5.13 vs
 * MK1 1.25、约 4 倍），而且实测就是它停在 MK1（5 门 60 CPU）。
 * 做法：挑"当前装着的最低档炮"那一门 → 卸下（`unfitAt`）→ 买高档 → 装回；
 * 装不回就把旧件装回去（避免把槽位弄空）。
 */
function upgradeGunsOneStep(): void {
  if (meBusy() || !isHome()) return
  if (state.expedition.active || state.scanning.active || state.salvaging.active) return
  const TIERS = ['mod-turret-kin-1', 'mod-turret-kin-2', 'mod-turret-kin-3']
  const dmgOf = (id: string | null): number => (id ? (ctx.modules.get(id)?.dmgMult ?? 0) : -1)
  const priceOf = (id: string): number => goodOf('module', id)?.basePrice ?? 0
  /** 找"最低档、且存在更高档可换"的那一门（跨全舰队，优先便宜的高档） */
  let best: { uid: string; slot: number; from: string; to: string } | null = null
  for (const uid of Object.keys(state.fleet)) {
    const f = state.fleet[uid]
    const def = fleetDefOf(state, ctx, uid)
    if (!f || !def) continue
    if (def.role !== 'armed' && def.role !== 'armored') continue
    const high = f.fitted?.high ?? []
    for (let i = 0; i < high.length; i++) {
      const cur = high[i]
      if (!cur) continue
      // 只升这条线的件（别的线不碰）
      const curIdx = TIERS.indexOf(cur)
      if (curIdx < 0) continue
      for (let t = TIERS.length - 1; t > curIdx; t--) {
        const to = TIERS[t]!
        const price = priceOf(to)
        if (price <= 0) continue
        if (state.wallet.isk < price * 1.5 + 100_000) continue
        if (!best || price < priceOf(best.to)) best = { uid, slot: i, from: cur, to }
        break
      }
    }
  }
  if (!best) return
  const { uid, slot, from, to } = best
  const name = fleetDefOf(state, ctx, uid)?.name ?? uid
  const prevShip = state.shipId
  if (prevShip !== uid && !changeShip(state, uid, ctx).ok) return
  // ⚠ 签名是 `unfitAt(state, rack, index, shipId?, ctx?)` 且**返回 boolean**（先写错成 `.ok`）
  const u = unfitAt(state, 'high', slot, uid, ctx)
  if (!u) {
    if (prevShip !== uid) changeShip(state, prevShip, ctx)
    return
  }
  const g = goodOf('module', to)
  if (!g) {
    fitModuleTo(state, from) // 买不到高档 ⇒ 把旧件装回去，别留空槽
    if (prevShip !== uid) changeShip(state, prevShip, ctx)
    return
  }
  buyAtMarket(state, ctx, g.key, 1)
  const ok = fitModuleTo(state, to)
  if (!ok) {
    fitModuleTo(state, from) // 装不上（CPU 等）⇒ 回滚
    if (prevShip !== uid) changeShip(state, prevShip, ctx)
    return
  }
  if (prevShip !== uid) changeShip(state, prevShip, ctx)
  mark(`升级火炮 ${from} → ${to}（${name} · 单发 ${dmgOf(from).toFixed(2)} → ${dmgOf(to).toFixed(2)}）`)
}

function doBounty(): void {
  if (state.expedition.active || state.encounter.active || state.transit.active || state.standby.active || state.scanning.active) return
  if (pilotLineBusy()) return
  // 只打：未首胜（推进声望）+ 门槛达标 + 星系已探索 + 非冷却 + 有把握
  const canDo = ANOMALY_LIST.filter(
    (a) =>
      !state.completedBounties.includes(a.id) &&
      a.standingReq <= standing() &&
      isExplored(state, a.galaxyId) &&
      bountyCooldownRemainingMs(state, a.id) <= 0,
  )
  if (canDo.length === 0) return
  let best: AnomalyDef | null = null
  let bestScore = 0.5
  for (const a of canDo) {
    const w = winOf(state, ctx, a)
    if (w > bestScore) {
      bestScore = w
      best = a
    }
  }
  if (!best) return
  ensureFlagship() // 批 4：出征前把驾驶位还给主力战船（它在 AI 出勤就召回）
  counterFitFor(best.id) // 批 4：按目标卡混伤构成换抗性件（盾抗主系 · 甲抗副系）
  const r = startExpedition(state, best.id, ctx)
  if (r.ok) mark(`远征 ${best.name}`)
  else issue(`远征 ${best.id} 失败：${r.error}`)
}

/** 刷钱：打当前可赢的收益最高悬赏（含已首胜；boss 够强前都可用） */
function doFarm(): void {
  if (state.expedition.active || state.encounter.active || state.transit.active || state.standby.active || state.scanning.active) return
  if (pilotLineBusy()) return
  // 通关目标仍挂起时，boss 达到 85%+ 就留给「最终验证」；通关后（万亿现金目标）boss 悬赏也进刷钱池
  if (WANTS.boss && !goalDone.boss) {
    const boss = ctx.anomalies.get('ano-vault-sentinel')
    if (boss && winOf(state, ctx, boss) >= 0.85) return
  }
  const candidates = ANOMALY_LIST.filter(
    (a) =>
      a.standingReq <= standing() &&
      isExplored(state, a.galaxyId) &&
      bountyCooldownRemainingMs(state, a.id) <= 0,
  )
    .map((a) => ({ a, w: winOf(state, ctx, a) }))
    .filter((x) => x.w > 0.6)
    .sort((x, y) => y.a.rewardIsk * y.w - x.a.rewardIsk * x.w)
  const pick = candidates[0]
  if (!pick) return
  ensureFlagship() // 批 4：刷钱前同样把驾驶位还给主力战船
  counterFitFor(pick.a.id) // 批 4：按目标卡混伤构成换抗性件
  const r = startExpedition(state, pick.a.id, ctx)
  if (r.ok) {
    if (state.gameMs - lastFarmMark > 43_200_000) {
      lastFarmMark = state.gameMs
      mark(`刷钱：远征 ${pick.a.name}（胜率 ${Math.round(pick.w * 100)}%）`)
    }
  } else issue(`刷钱远征 ${pick.a.id} 失败：${r.error}`)
}
let lastFarmMark = -86_400_000

function goHomeIfAway(): void {
  if (state.awayGalaxy === null || state.awayGalaxy === HOME_GALAXY_ID) return
  if (state.standby.active || state.transit.active) return
  if (state.scanning.active || state.expedition.active || state.mining.active) return
  const r = startTransitHome(state, ctx)
  if (!r.ok) {
    const r2 = goStandbyAt(state, HOME_GALAXY_ID, ctx)
    if (!r2.ok) issue(`返航失败：${r.error}`)
  }
}

function homeLull(): boolean {
  // 人在母港且不占着远程作业（采矿往返间歇也允许卖货/购物/开炉由引擎互斥把关）
  return (
    state.awayGalaxy === null &&
    isHome() &&
    !state.expedition.active &&
    !state.scanning.active &&
    !state.standby.active &&
    !state.transit.active &&
    !state.encounter.active
  )
}

/* ═══════════ 虫洞手动趟（船长 2026-09-21：虫洞成就必须走真流程） ═══════════
 * 为什么不能用「自动探索」代替：那一档**不写成就账本**（`wormholeAuto` 全文件没有一处
 * `bumpFirst`/`peakFirst`）——它是"绝不丢船"的挂机收入，不算玩家亲自探索。所以六枚虫洞里程碑
 * （层深 2/3/4/5 ＋ 击破守卫 2/4）只能由**真进洞、真探格、真打守卫**拿到。
 *
 * 本模块**每拍只做一个决策**（与 `doBounty` / `doMine` 同形），时钟仍由主循环的 `advanceGame`
 * 推——这样虫洞战斗也走引擎自己的 `advanceWormhole`（含倍速/慢镜/收口），不另造一套时钟。
 * 决策顺序照抄 `tools/wormhole-econ.ts` 的整趟政策（那份是配平过的）：战斗未收口就等 →
 * 逐层扫描 → 走到出口 → 在出口格激活打守卫 → 按（深度/血量/回合）决定深入或撤离。
 */

/* ═══════════ 虫洞备战：把编队从"1 艘 T3"堆到"4 艘 T3 满配" ═══════════
 *
 * **为什么必须单独有一条备战策略**（2026-09-21 补，船长令三条目标实测暴露）：
 * `buyShipAndGear` 的买船判据是「**比驾驶船更强**才买」——它天生只会把主控那一艘不断往上换，
 * 于是模拟的终态稳定是「**1 艘 T3 重装巡舰 + 一堆 T1 僚舰**」，而虫洞是按 **4×T3 满配**口径
 * 配平的（`tools/wormhole-econ.ts` 参考编队；4×T3 折算质量 14000 ≤ 16000 ⇒ 回合预算 42）：
 * `whReady` 的真跑门于是稳定把每一趟都拦下（读数「进洞 N 次、深入 0 次」）。
 *
 * 本条策略只补"数量"这一维（**档位**由 `buyShipAndGear` 负责往上换、**配装**由逐舰补装负责）：
 * 舰队里 T3 及以上的战斗舰不足 4 艘时，买**同档最便宜**的那一型（不追"更强"——追更强会一路
 * 顶到 T4 玄武级（90M/艘）、把 10 亿目标挤掉，而虫洞只要求"够 T3 档、满配"）。
 *
 * ⚠ 三条硬约束（都会被引擎/工具自己打回，所以在此先判）：
 * ① **引擎侧没有"买船每天一艘"的闸**（2026-09-21 核 `buyAtMarket`：只有 `goodLockedReason`
 *    声望闸 / `bmGateLocked` 暗市闸 / `playerBuyable` / npcSell 库存）——真正的限制是
 *    **库存**：rare 舰船单张只 1 艘、每 10 分钟抽取窗才刷（`spawnRareSupply`），
 *    奇货档 1 艘/张、6 小时寿命。所以 4 艘是"**等货**"等出来的，不是被规则限速；
 * ② **奇货档（如 `ship-hawksbill` 玳瑁级，声望 12）不作为选型**：奇货只 1 艘/张、6h 一刷，
 *    买 4 艘要 4 张奇货单，太靠运气 ⇒ 选型**只取稀有档**（长尾鲨/锤头鲨/牛鲨/鹦鹉螺/电鳐，
 *    声望 8、9~15M 一艘，`rareQtyMul` 与抽取都宽得多）；
 * ③ 钱要留够配装（4 艘 × 13 槽的炮＋抗性件不是小数）：单舰预算按"**留 400 万给装备**"卡。
 */
const WH_FLEET_TIER = 3
const WH_FLEET_SIZE = 4
/** "虫洞备战待购"那条诊断日志的节流日（`mark` 按文本去重、本函数每拍都调 ⇒ 必须自己按天节流） */
let lastWhFleetNoteDay = -99
/** "虫洞待进（门卡在哪）"那条诊断日志的节流日（同理；门每拍都被问一次，且真跑一场很贵） */
let lastWhGateNoteDay = -99
/** 门（`whReady` 的真跑）当天的结果缓存：同一天没过就不重算（编队/装备/技能当天基本不变） */
let lastWhGateDay = -99
let lastWhGateOk = false
/** 最近一次"第 1 层真跑"的我方残血比（`-1` = 没赢/没跑起来）；只给 `whGateReason` 报读数用 */
let lastWhFloor1Hp = -1
/** "无余量进洞"那条告警的节流日（同一天只提醒一次） */
let lastWhDesperateDay = -99
/** 进洞前维修的节流日（不节流会每拍都修、把整段时间卡在维修上，实测过） */
let lastRepairDay = -99
/**
 * **进洞门的血量余量门槛**（2026-09-21 定）：第 1 层打完后我方三层血残值必须 ≥ 本值才敢进洞。
 * 依据：实测"第 1 层剩 4.1% 血"那一趟，第 2 层当场团灭、四艘全沉（不可撤退）。
 *
 * ⚠ **取值沿革**：0.55 起手（先保命），实测层深卡在 2 —— 同样的余量要求也挡住了"往下走"的判断，
 * 深一点就撤 ⇒ 层深上不去。现取 **0.45 = 与"撤退线"（`wormholeHpFrac() < 0.45` 就收口）同一个数**：
 * 门只拦"一进去就必死的编队"，进去之后用撤退线保命。两个数同源，避免"门比撤退线还保守"。
 * 实测该口径下**阵亡 0 艘**（对比 0.55 档：每趟沉 4 艘）。
 */
const WH_ENTRY_HP_MIN = 0.45

/**
 * **虫洞备战还要多少钱**（仅供报告读数）：缺口 = 还差的 T3+ 战斗舰艘数 ×
 * （当前最便宜的现货价 or 该档 `basePrice` 中位）× 1，再加每舰 400 万装备预算。
 * 没有现货时用市场中位价估——这只是"还要攒多少"的量级提示，不是硬闸（硬闸是现货 + 现金）。
 */
function needIskForWhFleet(): number {
  const lack = Math.max(0, WH_FLEET_SIZE - whCapableShips().length)
  const rows = [...ctx.marketGoods.values()].filter((g) => {
    if (g.kind !== 'ship' || g.rarity !== 'rare' || g.playerBuyable === false) return false
    const s = ctx.ships.get(g.refId)
    return !!s && (s.role === 'armed' || s.role === 'armored') && wormholeShipAllowed(s) && (s.tier ?? 1) >= WH_FLEET_TIER
  })
  if (rows.length === 0) return lack * 4_000_000
  const prices = rows.map((g) => g.basePrice).sort((a, b) => a - b)
  const mid = prices[Math.floor(prices.length / 2)] ?? 9_000_000
  return lack * (mid + 4_000_000)
}

/** 舰队里"能带进洞 + 档位 ≥ 3 + 是战斗舰（武装/装甲）"的艘数（`uid` 列表） */
function whCapableShips(): string[] {
  const out: string[] = []
  for (const uid of Object.keys(state.fleet)) {
    const f = state.fleet[uid]
    if (!f) continue
    const def = fleetDefOf(state, ctx, uid)
    if (!def) continue
    if (def.role !== 'armed' && def.role !== 'armored') continue
    if (!wormholeShipAllowed(def)) continue
    if ((def.tier ?? 1) < WH_FLEET_TIER) continue
    out.push(uid)
  }
  return out
}

/**
 * **虫洞备战**：舰队凑够 `WH_FLEET_SIZE` 艘 T3+ 战斗舰（每拍至多买一艘，买不到就等下一张供给单）。
 * 只在"要冲虫洞成就 + 还没凑够"时动手；`whach` 目标一旦达成即自然停手（不再抽血）。
 */
function ensureWhFleet(): void {
  if (!WANTS.whach || goalDone.whach) return
  if (meBusy() || !isHome()) return
  if (state.expedition.active || state.scanning.active || state.salvaging.active || state.mining.active) return
  if (whCapableShips().length >= WH_FLEET_SIZE) return
  /**
   * 候选 = **稀有档 + 声望够 + T3+ 战斗舰**，按"**现货价**"升序（不是 `basePrice`：
   * rare 单是二手市场折价单，实际成交价 = `basePrice × priceJitter × secondhandMul`，
   * 只拿 `basePrice` 当闸会把"其实买得起"的船挡掉——`stockedFirst` 那套排序口径与之一致）。
   *
   * ⚠ **T3 买齐后不再刷新**（2026-09-21 修）：第一版每拍到齐前都在买，实测**编队计数反复从
   * 4/4 掉回 1/4、又买四艘**（船在洞里沉/被卖出/被派 AI 出勤），一路烧掉上亿却始终停在层深 2。
   * 现口径：① 只要没凑齐 4 艘就补（一条一条补）；② **凑齐之后只做"升级到 T4"**（T4 是虫洞允许的
   * 最高档，`WORMHOLE_MAX_TIER = 4`），且**必须换掉编队里最弱的那艘**（否则买了第 5 艘它不进编队，
   * 白花钱）。这条既省钱又提高层深上限——层深 5 靠 4×T3 本来就吃紧（实测最高到层深 2）。
   */
  const cands = [...ctx.marketGoods.values()]
    .filter((g) => {
      if (g.kind !== 'ship') return false
      if (g.rarity !== 'rare') return false
      if (g.playerBuyable === false) return false
      if ((g.standingReq ?? 0) > standing()) return false
      const s = ctx.ships.get(g.refId)
      if (!s) return false
      if (s.role !== 'armed' && s.role !== 'armored') return false
      if (!wormholeShipAllowed(s)) return false
      if ((s.tier ?? 1) < WH_FLEET_TIER) return false
      return (state.market.npcSell[g.key] ?? []).some((o) => o.qty > 0)
    })
    .map((g) => {
      const list = state.market.npcSell[g.key] ?? []
      const cheapest = Math.min(...list.map((o) => o.price))
      const s = ctx.ships.get(g.refId)
      return { g, price: cheapest, tier: s?.tier ?? 1, score: shipPowerScore(s) }
    })
    .sort((a, b) => a.price - b.price)
  /**
   * 留 400 万给这一艘的配装（4 门炮 + 抗性件 + 盾/甲件），别把钱全砸在船体上。
   * T4 的配装更贵（13 槽起），且 T4 单价 90M ⇒ 自动按档位放大预留。
   */
  const reserveOf = (tier: number): number => (tier >= 4 ? 8_000_000 : 4_000_000)
  const owned = whCapableShips()
  const current = owned.length
  const topTier = owned.reduce((m, uid) => Math.max(m, fleetDefOf(state, ctx, uid)?.tier ?? 0), 0)
  /** 已凑齐 ⇒ 只考虑"能提升编队档位"的船（T4 换掉最弱的 T3） */
  const wantTier = current >= WH_FLEET_SIZE ? topTier + 1 : WH_FLEET_TIER
  const eligible = cands.filter((c) => c.tier >= wantTier)
  const pick = eligible.find((c) => state.wallet.isk >= c.price + reserveOf(c.tier))
  if (!pick) {
    /**
     * 买不到/买不起时**每天记一条**为什么等（否则报告里只有"没进洞"、看不出卡在哪）。
     * 三种情形分开报：候选全无（声望/档位/品种不满足）· 有候选但**没现货** · 有现货但**钱不够**。
     * ⚠ 必须自己按天节流：`mark` 是按**文本**去重的，而本函数**每拍**都被调，现金数字每拍都在变
     * ⇒ 直接 mark 会把日志刷爆（第一版实测：0.00~1.50 天刷了 60+ 行）。
     */
    if (day() < lastWhFleetNoteDay + 1) return
    lastWhFleetNoteDay = day()
    const need = needIskForWhFleet()
    mark(
      `虫洞备战待购：编队 T3+ ${current}/${WH_FLEET_SIZE}（最高 T${topTier}）· ` +
        (current >= WH_FLEET_SIZE
          ? eligible.length > 0
            ? `想升 T${wantTier}：现货 ${eligible.length} 型（最便宜 ${Math.round(eligible[0]!.price / 1000)}k）但现金不足`
            : `市场上无 T${wantTier} 现货（T4 玄武级现货要声望 20，当前 ${standing()}）`
          : cands.length > 0
            ? `现货 ${cands.length} 型（最便宜 ${Math.round(cands[0]!.price / 1000)}k）但现金不足`
            : `候选 ${cands.length} 型均无现货`) +
        ` · 现金 ${Math.round(state.wallet.isk / 1000)}k / 参考目标 ${Math.round(need / 1000)}k`,
    )
    return
  }
  // 已满编还要买 = 升级：先卖掉编队里最弱的那艘腾位（否则它不进编队，纯烧钱）
  if (current >= WH_FLEET_SIZE) {
    const weakest = owned.sort(
      (a, b) => (fleetDefOf(state, ctx, a)?.tier ?? 0) - (fleetDefOf(state, ctx, b)?.tier ?? 0),
    )[0]
    if (!weakest || weakest === state.shipId) return
    const sale = sellShipAtMarket(state, ctx, weakest)
    if (!sale.ok) return // 卖不掉就别买（编队位不腾出来，买了也白买）
  }
  const got = buyAtMarket(state, ctx, pick.g.key, 1)
  if (got.shipUid) {
    const s = ctx.ships.get(pick.g.refId)
    mark(
      `虫洞备战 购入 ${s?.name ?? pick.g.refId}（T${s?.tier ?? '?'} ${Math.round(pick.price / 1000)}k · ` +
        `编队 ${whCapableShips().length}/${WH_FLEET_SIZE}）`,
    )
  }
}

/** 本次虫洞冲刺的目标层深（六枚里程碑要求层深 5 + 击破守卫 4 个） */
const WH_TARGET_DEPTH = 5
/**
 * 整趟最多重试次数（全灭/被拒就再来一趟，不问原因——报告里有失败日志）。
 * ⚠ **2026-09-21 从 40 提到 120**：进洞门放宽 + 无人机装载后，实测 30 天档就**打满 40 次上限**
 * （读数 `进洞 40 次（尝试 40 次）`），随后整段不再进洞 —— 白白浪费了后半程。
 * 每一趟本身很便宜（~0.1 游戏天），真正的限制是游戏时间，所以上限只用来防死循环。
 */
const WH_MAX_TRIES = 120

const whStats = { tries: 0, entries: 0, descends: 0, bossWins: 0, extracts: 0, wipes: 0, scans: 0, moves: 0 }
/** 「第 1 层真跑」的逐次诊断（去重后进报告）：说清门为什么不过——被打死 / 打不完 / 还剩多少血 */
const whFloor1Diag: string[] = []
/** 进洞那一刻的编队名单（`uid → 舰名`）：用来数**洞内沉了几艘**（洞内沉船不写引擎日志） */
let whEnterSnapshot: Map<string, string> | null = null
/** 进洞那一刻**整个舰队**的艘数（收场时对账用：洞内损失的第二条口径，见收场那一段） */
let whEnterFleetSize = 0
/** 进洞那一刻 `state.wormhole.lastFleetLost` 的基线（损失读数 = 它的增量，买替补也抹不掉） */
let whLostBase = 0
/** 最近记过"到达第 N 层"的层深（`mark` 按文本去重，但血/回合数字会变 ⇒ 自己按层深去重） */
let lastWhDepthSeen = -1
/** 上一拍是否在战斗中（`run.battle` 的上升/下降沿各记一条日志，用来定位"这趟怎么结束的"） */
let whBattleSeen = false
/** 已经"下到过 + 入了账"的层深（每档只赚一次；赚到就撤，见 `doWormhole` 的"拿到新层深就撤"） */
const whDepthBanked = new Set<number>()
/** "虫洞在洞内"每日体检的节流日（同上：`mark` 按文本去重，体检数字会变 ⇒ 自己按天节流） */
let lastWhInsideNoteDay = -99

/** 弹药 item id（与 `winEstimate.ts` 里那份**同值**；那边没导出，评估快照要按同一口径补足弹药） */
const AMMO_ITEM_IDS = ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l'] as const

/**
 * **整队战力快照**（**2026-09-21 新写，本批最关键的修复**）。
 *
 * 引擎自带的 `buildEvalState`（`packages/core/src/winEstimate.ts`）**只复制一艘船**——
 * 它是给 `estimateBountyWinOn` 那种**单舰**蒙特卡洛用的。而虫洞战斗走 `startFleetBattleFor`
 * （整队、逐舰血、弹药共池）⇒ 拿"一个只装了主控的快照"去跑整队，**编队里另外 3 艘在快照里
 * 根本不存在**，战斗里我方只有 1 个单位（诊断实证：`我方残血 …（1 单位）`、`编队 4 艘`）。
 * 于是这道"真跑"门一直在判**单舰 vs 第 1 层**，4×T3 满配也稳定 `ended=foe`（步 5~33）——
 * 门永远不过、一趟都进不去（读数：`进洞 0 次`）。
 *
 * 本函数把**整队**搬进同一份快照（口径照抄 `buildEvalState`：只带战力相关的东西——
 * 装配/无人机/耐久/技能/弹药与修理组件给足；仓库/市场/声望不带），返回 `{ ev, uids }`。
 * 不引引擎内部函数：只用 `createInitialState` + `addShipToFleet`（与 `buildEvalState` 同两手）。
 */
function buildFleetEvalState(fleet: readonly string[]): { ev: GameState; uids: string[] } | null {
  const ev = createInitialState({ nowWallMs: 0, seed: 1 })
  const uids: string[] = []
  for (const src of fleet) {
    const real = state.fleet[src]
    if (!real?.defId) continue
    const uid = addShipToFleet(ev, real.defId)
    const f = ev.fleet[uid]!
    f.fitted = JSON.parse(JSON.stringify(real.fitted ?? {})) as typeof f.fitted
    if (real.droneLoad !== undefined) f.droneLoad = { ...real.droneLoad }
    f.armorPct = real.armorPct ?? 1
    f.durability = real.durability ?? 1
    f.customName = real.customName
    f.cargo = {}
    // 评估不计补给耗尽（与 `buildEvalState` 同哲学）：弹药与修理组件给足
    for (const id of AMMO_ITEM_IDS) f.cargo[id] = 1_000_000
    for (const id of ['repairkit-civ', 'repairkit-mil']) f.cargo[id] = 1_000_000
    uids.push(uid)
  }
  if (uids.length === 0) return null
  ev.skills.trained = { ...state.skills.trained }
  ev.skills.queue = []
  ev.shipId = uids[0]!
  return { ev, uids }
}

/**
 * **真跑一遍"这趟洞的第 1 层节点战"**（不碰真状态：在整队快照上跑）。
 * 返回**我方三层血残值比**（1 = 满血过关）；`-1` = 这场根本没跑起来（无卡/建档失败）。
 *
 * 为什么要真跑而不是查 `battleWinPreview`：那条是**单舰**路径，而洞内战斗走的是
 * `startFleetBattleFor`（**整队**、逐舰血、弹药共池）—— 用单舰胜率当门会被高估，
 * 实测"进洞 12 次、深入 0 次"全是第 1 层团灭。这里用**与生产同一条建档入口**跑完一整场。
 *
 * ⚠ **为什么要返回残血、不只返回胜负**（2026-09-21 实测教训）：第 1 趟洞"赢了但只剩 4.1% 血"
 * ⇒ 第 2 层当场团灭、四艘全沉（日志：进洞后编队计数从 4/4 掉回 1/4，模拟又买四艘再送一趟）。
 * 所以"打得过"不等于"进得去"：必须要求**留有余量**（见 `WH_ENTRY_HP_MIN`）。
 */
function whFloor1Outcome(fleet: readonly string[]): number {
  /**
   * ⚠⚠ **必须用"整队快照"**（2026-09-21 修）：`buildEvalState` 只复制主控那一艘 ⇒
   * 拿它跑整队时我方只有 1 个单位，门一直在判"单舰 vs 第 1 层"、永远不过。见 `buildFleetEvalState`。
   */
  const snap = buildFleetEvalState(fleet)
  if (!snap) return -1
  const { ev, uids: evFleet } = snap
  const seed = state.rng.seed
  const cardId = wormholeCardIdForRun({ seed, depth: 1, kind: 'node', nodeIndex: 0 })
  if (!ctx.anomalies.get(cardId)) return -1
  const battle = startFleetBattleFor(ev, ctx, evFleet, cardId, 0, null, { depth: 1, kind: 'node', waves: 1 })
  if (!battle) {
    whFloor1Diag.push(`第 1 层真跑：\`startFleetBattleFor\` 返回 null（编队 ${evFleet.length} 艘 · 卡 ${cardId}）`)
    return -1
  }
  let guard = 0
  while (!battle.ended && guard < 900) {
    ev.gameMs += 1_000
    advanceBattleFor(ev, ctx, battle, evFleet[0]!, cardId)
    guard++
  }
  /**
   * 诊断留档（只为报告）：把"为什么打不过"说清楚——是**被打死**（`ended=foe`）、
   * **回合上限内没打完**（`guard` 触顶、`ended=null`）、还是**我方还剩多少血**。
   * 2026-09-21 实测：编队 4×T3、20 门炮，门仍然不过 ⇒ 不看这三项无法判断是"真打不过"
   * 还是"评估快照本身建错了"（例如没带弹药、没带上僚舰）。
   */
  // ⚠ `battle.units` 是 **Record<string, BattleUnitRt>**（按 tag 建索引），不是数组（2026-09-21 踩到）
  const all = Object.values(battle.units ?? {})
  const mine = all.filter((u) => u.side === 'me')
  const foe = all.filter((u) => u.side !== 'me')
  const frac = (us: typeof mine): number => {
    let cur = 0
    let max = 0
    for (const u of us) {
      cur += Math.max(0, u.hp.s) + Math.max(0, u.hp.a) + Math.max(0, u.hp.h)
      max += Math.max(1, u.hpMax?.s ?? 1) + Math.max(1, u.hpMax?.a ?? 1) + Math.max(1, u.hpMax?.h ?? 1)
    }
    return max > 0 ? cur / max : 0
  }
  const hpFrac = frac(mine)
  whFloor1Diag.push(
    `第 1 层真跑：ended=${String(battle.ended)} 步=${guard} 我方残血 ${(hpFrac * 100).toFixed(1)}%（${mine.length} 单位）· ` +
      `敌方残血 ${(frac(foe) * 100).toFixed(1)}%（${foe.length} 单位）· 编队 ${evFleet.length} 艘`,
  )
  return battle.ended === 'me' ? hpFrac : -1
}

/**
 * **够格进洞吗**（第一版我漏了这道门 ⇒ 模拟第 0 天就开着**沙猫级采矿艇**进洞，两趟全灭、
 * 还把这十天的正常发育全挤掉了 —— 日志里"虫洞内被击沉（沙猫级采矿艇）"就是它）。
 *
 * 判据（都取"保守但够用"）：
 * - **有一艘装了武器槽件的武装/装甲舰**（采矿艇裸船进去必死）；
 * - 声望 ≥ 3（早期那点钱与船根本撑不起一趟洞；顺便让它先把悬赏链跑起来）；
 * - 城里有闲钱修船/补弹（≥ 20 万）；
 * - ⚠ **真跑一遍第 1 层那场、打得过才进**（**2026-09-21 补**）：前一轮实测"进洞 12~17 次、
 *   深入 0 次"—— 全是**第 1 层就团灭**（`extracts` 一次都没涨）。虫洞不可撤退（战斗一开必须打完），
 *   所以进洞前必须先自问"打得过第 1 层吗"，而且要用**整队**口径问。
 */
function whReady(fleet: readonly string[]): boolean {
  if (standing() < 3) return false
  if (state.wallet.isk < 200_000) return false
  let armed = false
  for (const uid of fleet) {
    const f = state.fleet[uid]
    if (!f) continue
    const def = fleetDefOf(state, ctx, uid)
    if (!def || (def.role !== 'armed' && def.role !== 'armored')) continue
    const hasGun = (f.fitted?.high ?? []).some((m) => {
      if (!m) return false
      const slot = ctx.modules.get(m)?.slot
      return slot === 'turret' || slot === 'missile' || slot === 'laser' || slot === 'drone-rack' || slot === 'drone-tac'
    })
    if (hasGun) armed = true
  }
  if (!armed) return false
  /**
   * ⚠ **要够档**（**2026-09-21 补**）：虫洞是按 **4×T3 巡洋舰满配**这档口径配平的
   * （见 `tools/wormhole-econ.ts` 的参考编队），**T1 护卫舰进去必死** ——
   * 实测：`whReady` 的真跑门在 T1 编队上稳定 `ended=foe 秒=4`（第 1 层 4 秒团灭）。
   * 所以除了"打得过第 1 层"这个经验判据，再加一条**硬门槛：编队里至少有一艘 tier ≥ 3 的战斗舰**。
   */
  const topTier = fleet.reduce((m, uid) => {
    const def = fleetDefOf(state, ctx, uid)
    return Math.max(m, def?.tier ?? 0)
  }, 0)
  if (topTier < 3) return false
  /**
   * **第 1 层真跑，且要留有余量**（2026-09-21 加余量判据）。
   * 只要"赢"不够：第 1 层靠 4% 血惨胜 ⇒ 第 2 层当场全灭、四艘全沉（实测日志：进洞后编队计数
   * 从 4/4 掉回 1/4、模拟又买四艘再送一趟，来回烧钱）。所以要求**战后残血 ≥ `WH_ENTRY_HP_MIN`**
   * —— 虫洞是**不可撤退**的连续闯关（战斗一开必须打完），进洞前必须按"最坏那一层"留血量。
   */
  const hp = whFloor1Outcome(fleet)
  lastWhFloor1Hp = hp
  if (hp >= WH_ENTRY_HP_MIN) return true
  /**
   * **"没有余量也要进"的兜底**（2026-09-21 加，为打破死锁）。
   *
   * 背景：进洞门要求第 1 层余量 ≥45%，而 4×T3 满配实测只有 35% ⇒ 门一直拦着、`tries` 停在 0、
   * **六枚里程碑一枚都拿不到**。想提升战力又卡在同一个环上：
   * T4 现货要声望 20 / T4 一次性蓝图要声望 25，而声望**只由悬赏首胜发放**（`expedition.ts` 只给
   * `firstBlood` 加声望）⇒ 剩下 13 张威胁 58~96 的硬卡打不过 ⇒ 声望上不去 ⇒ 战力上不去。
   *
   * 为什么"余量不足也值得进"：本工具的虫洞政策是 **"拿到新层深就撤"**（见上面的分支）——
   * 层深里程碑记在**下潜那一刻**，随后立刻撤离、不硬闯深处。所以残血 35% 也能安全拿到 +1 层深，
   * 而**不进的收益是 0**。风险由两道闸兜住：① 撤退线（残血 <45% 就收口）；
   * ② `whDepthBanked`（每档只赚一次，不会反复送死）。
   */
  if (hp > 0) {
    if (day() >= lastWhDesperateDay + 1) {
      lastWhDesperateDay = day()
      mark(
        `⚠ 虫洞无余量进洞（第 1 层残血仅 ${(hp * 100).toFixed(0)}% < 门槛 45%）：` +
          `战力上不去又不进洞 = 里程碑永远 0 ⇒ 按"拿到层深就撤"赌一趟`,
      )
    }
    return true
  }
  return false
}

/**
 * **进洞门到底卡在哪一条**（只为报告/诊断，不参与决策）——每一条都必须能被单独说出来，
 * 否则报告只会写"进洞 0 次"而看不出是"没编队""不够档"还是"第 1 层打不过"
 * （2026-09-21 实测就吃过这个亏：编队早齐了、却因门不过而"尝试 0 次"，日志里什么都没有）。
 */
function whGateReason(fleet: readonly string[]): string {
  if (fleet.length === 0) return '编队为空（无可派舰船：都在 AI 出勤 / 被 `wormholeAdmission` 拒）'
  if (standing() < 3) return `声望 ${standing()} < 3`
  if (state.wallet.isk < 200_000) return `现金 ${Math.round(state.wallet.isk / 1000)}k < 200k`
  let guns = 0
  let topTier = 0
  for (const uid of fleet) {
    const f = state.fleet[uid]
    const def = fleetDefOf(state, ctx, uid)
    if (!f || !def) continue
    topTier = Math.max(topTier, def.tier ?? 0)
    guns += (f.fitted?.high ?? []).filter((m) => {
      if (!m) return false
      const slot = ctx.modules.get(m)?.slot
      return slot === 'turret' || slot === 'missile' || slot === 'laser' || slot === 'drone-rack' || slot === 'drone-tac'
    }).length
  }
  if (guns === 0) return `编队 ${fleet.length} 艘全无武器槽件`
  if (topTier < 3) return `编队最高档 T${topTier} < T3`
  if (lastWhFloor1Hp < 0) return `第 1 层真跑打不过（编队 ${fleet.length} 艘 · 最高 T${topTier} · 炮 ${guns} 门）`
  return (
    `第 1 层惨胜、余量不足（残血 ${(lastWhFloor1Hp * 100).toFixed(1)}% < 门槛 ${(WH_ENTRY_HP_MIN * 100).toFixed(0)}% · ` +
    `编队 ${fleet.length} 艘 · 炮 ${guns} 门）⇒ 进第 2 层必团灭，先补战力`
  )
}

/**
 * **虫洞编队战力明细**（2026-09-21 加，纯诊断）：把将要进洞的那套编队逐舰摊开——
 * 档位 / 高槽炮数 / 中低槽件数 / 无人机舱内容 / 三层血上限合计。
 *
 * 为什么需要：进洞门只给一个"第 1 层残血 35%"，看不出**缺的是火力还是血**、也看不出
 * **槽位有没有装满**（实测怀疑 `autoFitGear` 因 CPU 超预算而提前 `return`，导致槽位空着）。
 * 有这条才能判断"该换武器 / 该装无人机 / 该堆血"。
 */
function whFleetDigest(fleet: readonly string[]): string {
  const parts: string[] = []
  let totGuns = 0
  let totSlots = 0
  let totHp = 0
  let totDrones = 0
  for (const uid of fleet) {
    const f = state.fleet[uid]
    const def = fleetDefOf(state, ctx, uid)
    if (!f || !def) continue
    const guns = (f.fitted?.high ?? []).filter(Boolean).length
    const mids = (f.fitted?.mid ?? []).filter(Boolean).length
    const lows = (f.fitted?.low ?? []).filter(Boolean).length
    const dl = f.droneLoad ?? {}
    const drones = Object.values(dl).reduce((s, n) => s + n, 0)
    totGuns += guns
    totSlots += (def.slots?.high ?? 0) + (def.slots?.mid ?? 0) + (def.slots?.low ?? 0)
    totHp += (def.shieldHp ?? 0) + (def.armorHp ?? 0) + (def.hullHp ?? 0)
    totDrones += drones
    /**
     * ⚠ **CPU 读数**（2026-09-21 加）：中低槽空着最可能的原因是 **CPU 预算被高槽炮吃满**
     * （MK3 炮一台 cpu 52；5 门 = 260，而 T3 巡洋舰 cpu 只有 330~360）。
     * 这条把"已用/上限"直接写出来 —— 若是 CPU 卡住，那"多装件"这条路就是死的，
     * 只能换低 CPU 的武器或靠无人机（无人机**也吃 CPU**，`cpuUse` 4~16）补战力。
     */
    const cpuCap = cpuBudgetOf(state, ctx, uid)
    const cpuUsed = fittedCpuUsed(f.fitted, ctx, def)
    const bay = def.droneBayM3 ?? 0
    parts.push(
      `${def.name}(高${guns}/${def.slots?.high ?? 0} 中${mids}/${def.slots?.mid ?? 0} 低${lows}/${def.slots?.low ?? 0}` +
        ` 机${drones} 舱${bay}m³ CPU${cpuUsed}/${cpuCap})`,
    )
  }
  return (
    `编队战力明细：炮 ${totGuns}/${totSlots} 槽 · 无人机 ${totDrones} 架 · 三层血上限合计 ${totHp} —— ` +
    parts.join(' · ')
  )
}

/** 人在洞里吗（`run` 存在即"这趟在"，`attending` 才是"人在"） */
function inWormhole(): boolean {
  return !!state.wormhole.run
}

/**
 * **这条直线路上有没有"没清掉的舰船信号格"**（= 会不会被拦截）。
 * 判据与引擎 `wormholePathInterceptAt` **同一把尺**（掐头去尾、未扫描的也算拦、已激活的不算）。
 */
function whLineBlocked(grid: WormholeGridState, from: HexCell, to: HexCell): boolean {
  const line = hexLine(from, to)
  for (let i = 1; i < line.length - 1; i++) {
    const c = gridCellAt(grid, line[i]!)
    if (!c) continue
    if (c.place !== 'ship') continue
    if (grid.activated.includes(c.key)) continue
    return true
  }
  return false
}

/**
 * **绕开节点直奔出口**（2026-09-21 第五批，本批最关键的行为改动）。
 *
 * 为什么：引擎的移动是**两点直线**（`hexLine`），路上撞见未清的舰船信号格会**截断在那格并开战**
 * （`wormholeTravelTo` 的路径拦截），**不能穿过去**。而本工具原来的走法是"每次直接点出口 →
 * 撞上就就地开战" ⇒ 每层都要打好几场节点战，**血就是这样在探路阶段掉光的**：
 * 实测第 2 层到达残血只有 40~49%，而清掉第 2 层守卫还要再掉 ⇒ 清完必 <45%（撤退线）
 * ⇒ 每趟都在第 2 层撤离、**永远拿不到第 3 层**。
 *
 * 改法：**能在不打的情况下就到出口，就绝不打**——
 * ① 出口直线无阻 ⇒ 直达；
 * ② 被阻 ⇒ 找一格**中转格** c（当前格的邻居 ∪ 出口的邻居），要求
 *    `当前→c 无阻` **且** `c→出口 无阻`（两段都是一步代价，共 2 回合，比打一场划算得多）；
 * ③ 两段都找不到 ⇒ 退回直线（该打就打，进度优先）。
 *
 * ⚠ 判据里的"无阻"用的是**引擎同一把尺** `whLineBlocked`；两段都查，避免"绕了半路又撞上"。
 */
function whNextTravelStep(grid: WormholeGridState): HexCell {
  const exit = { q: grid.exit.q, r: grid.exit.r }
  const here = { q: grid.pos.q, r: grid.pos.r }
  if (!whLineBlocked(grid, here, exit)) return exit
  /** 候选中转格：当前格的邻居（优先近的）＋ 出口的邻居 */
  const cands: HexCell[] = []
  const seen = new Set<string>()
  for (const c of [...hexNeighbors(here), ...hexNeighbors(exit)]) {
    const key = hexKey(c.q, c.r)
    if (seen.has(key)) continue
    if (!gridCellAt(grid, c)) continue // 盘外
    if (key === hexKey(here.q, here.r) || key === hexKey(exit.q, exit.r)) continue
    seen.add(key)
    cands.push(c)
  }
  cands.sort((a, b) => hexDistance(here, a) - hexDistance(here, b))
  for (const c of cands) {
    if (whLineBlocked(grid, here, c)) continue
    if (whLineBlocked(grid, c, exit)) continue
    return c
  }
  return exit // 绕不开：照旧直达（该打就打）
}

/**
 * **进洞前把编队修满**（2026-09-21 第五批，本批最关键的一处）。
 *
 * 根因（读数为证）：`armorPct` / `durability` 是**跨趟留存**的——虫洞打完剩 40% 血，
 * 下一趟就**带着 40% 的甲/结构进场**，于是"到达第 1 层"的残血在 **38%~100% 之间乱跳**，
 * 而层末守卫战本身要吃掉约 36% ⇒ 越打越薄，层深永远上不去。
 * 实测证据（同一 20 天档的逐趟读数）：
 * `到达第 1 层：残血 71% / 73% / 100% / 76% / 38% / 54% / 35% / 82% …` —— 进场血就是残的。
 *
 * 而本工具**从来没有调用过 `repairShip`**（全文件搜索无命中）⇒ 甲/结构只降不升。
 * 修法：每次准备进洞前，把编队里"甲或结构不满"的船**在母港修满**（钱不是问题：实测 30 天有几十亿）。
 */
function repairWhFleet(): void {
  if (meBusy() || !isHome()) return
  if (state.expedition.active || state.scanning.active || state.salvaging.active) return
  /**
   * ⚠ **必须按天节流**（2026-09-21 踩到）：`doWormhole` 在"准备进洞"时**每拍**都会调到本函数，
   * 而维修失败的船（例如被引擎锁住）会一直"甲不满" ⇒ 本函数每拍都 `return true`，
   * 主循环于是把**整段时间全花在维修上**：实测 30 天档变成"进洞 0 次、首胜 6/23、现金 46k"，
   * 比不修还差得多。按天节流 + 成败都记一次，即可既修得上又不卡进度。
   */
  if (day() < lastRepairDay + 1) return
  lastRepairDay = day()
  let repaired = 0
  const failed: string[] = []
  for (const uid of Object.keys(state.fleet)) {
    const f = state.fleet[uid]
    const def = fleetDefOf(state, ctx, uid)
    if (!f || !def) continue
    if (def.role !== 'armed' && def.role !== 'armored') continue
    if (f.durability >= 1 && (f.armorPct ?? 1) >= 1) continue
    const r = repairShip(state, uid, ctx)
    if (r.ok) repaired += 1
    else failed.push(`${def.name}:${(r.error ?? '').slice(0, 30)}`)
  }
  if (repaired > 0) mark(`进洞备战：维修 ${repaired} 艘（甲/结构回满）`)
  // 修不动的原因只记一次（去重）：多半是"进洞船只锁定"或"不在母港"
  for (const msg of failed.slice(0, 3)) issue(`进洞维修失败 ${msg}`)
}

/**
 * **虫洞冲刺的一拍决策**（返回 true = 本拍做了动作；调用方据此跳过别的活动）。
 *
 * ⚠ 与 `wormhole-econ` 的一处**有意差异**：那里是"一口气跑完整趟"（时钟自己 +1000ms），
 * 这里是**逐拍**推进 ⇒ 本函数必须能被反复调用而不重复副作用（每个分支都先看状态再动作）。
 */
function doWormhole(): boolean {
  const run = state.wormhole.run
  // ① 不在洞里：够格就进洞（门槛由引擎把关，失败只记一次不刷屏）
  if (!run) {
    if (whStats.tries >= WH_MAX_TRIES) return false
    if (meBusy() || !isHome()) return false
    /**
     * ⚠ **先修船，再算门**（2026-09-21 第五批）：门的判据是"真跑一遍第 1 层的残血"，
     * 而残血直接吃 `armorPct`/`durability` —— 上一趟打完剩 40%，不修就带着 40% 进场，
     * 门自然不过、层深也永远上不去。所以**维修必须在门之前**（维修是免费的？不是，但钱不是问题）。
     */
    repairWhFleet()
    const fleetIds = wormholeFleetPick()
    if (fleetIds.length === 0) {
      if (day() >= lastWhGateNoteDay + 1) {
        lastWhGateNoteDay = day()
        mark(`虫洞待进（第 ${whStats.tries} 次尝试后）：${whGateReason(fleetIds)}`)
      }
      return false
    }
    // ⚠ 门要看**这套编队**打不打得过第 1 层（真跑一场，见 `whFloor1Winnable`）
    //    同一天内门没过就**不必重算**：编队/装备/技能当天基本不变，而每拍真跑一场很贵（墙钟实测）
    if (lastWhGateDay === day() && lastWhGateOk === false) return false
    const ok = whReady(fleetIds)
    lastWhGateDay = day()
    lastWhGateOk = ok
    if (!ok) {
      if (day() >= lastWhGateNoteDay + 1) {
        lastWhGateNoteDay = day()
        mark(`虫洞待进（第 ${whStats.tries} 次尝试后）：${whGateReason(fleetIds)}`)
        mark(whFleetDigest(fleetIds))
      }
      return false
    }
    whStats.tries += 1
    /**
     * **进洞前记一份"编队血账"**（2026-09-21 加）：洞内沉船不给引擎日志（`wormholeAuto` 那条
     * 挂机路径才写），所以损失只能靠"进洞前后舰队里这几艘还在不在"来数。这是**整趟冲刺烧了
     * 多少钱/沉了几艘**的唯一读数来源——实测第一版没有它，报告里只能看到"编队计数从 4/4 又变回
     * 1/4"这种二手痕迹。
     */
    whEnterSnapshot = new Map(
      fleetIds.map((uid) => [uid, state.fleet[uid] ? (fleetDefOf(state, ctx, uid)?.name ?? uid) : uid]),
    )
    whEnterFleetSize = Object.keys(state.fleet).length
    whLostBase = state.wormhole.lastFleetLost ?? 0
    const r = wormholeEnter(state, ctx, fleetIds, state.rng.seed)
    if (!r.ok) {
      if (whStats.tries === 1) issue(`虫洞入洞被拒：${r.error ?? ''}`)
      return false
    }
    whStats.entries += 1
    /**
     * ⚠ **进洞时重置两个"上一拍"标记**（2026-09-21 修）：`lastWhDepthSeen` / `whBattleSeen` 是
     * "值变了才记一条"的**跨趟变量**——不重置的话，新一趟的第 1 层（depth 1）与上一趟相同就不记
     * 逐层读数了（实测：第 4 趟之后"到达第 N 层"整段消失，报告里只看得到"收场"，查不动）。
     */
    lastWhDepthSeen = -1
    whBattleSeen = false
    /**
     * ⚠ **进洞时记一份"甲/结构实况"**（2026-09-21 加，为验收维修到底有没有生效）：
     * 层深读数里的"我方残血 %"**包含护盾**（`wormholeHpFrac` 把格内单位的甲+结构比上限），
     * 而护盾每场战斗重置 ⇒ 那个百分比**不是"进场血"**。
     * 真正跨趟留存的是 `armorPct` / `durability` ⇒ 只有把它们打出来，才能判断
     * "到达第 1 层 40%"是"进场就残"还是"打了一场很贵的胜仗"。
     *
     * ⚠⚠ **刻度是 0~1，`1` = 满**（2026-09-21 用原始值实测确认：`甲1/结1`、`甲0/结0.05`、
     * `甲0.5401848541555258/结1`；引擎侧 `repairCostIsk` 也按 `1 - armorPct` 算缺失量）。
     * **所以这里原样打印、不做任何换算** —— 我先前乘过 100、又把"×100 后是 26"读成
     * "存的是 26"，据此按 0~100 去调"残船准入闸"（`>= 0.25` 在 0~1 下本来是对的），
     * 白花了一整轮。教训：**打印原始值**，别在日志里做换算。
     */
    const armor = fleetIds
      .map((uid) => {
        const f = state.fleet[uid]
        if (!f) return null
        const a = f.armorPct ?? 1
        const d = f.durability ?? 1
        return `甲${a.toFixed(2)}/结${d.toFixed(2)}`
      })
      .filter((x): x is string => !!x)
    mark(`虫洞进洞（第 ${whStats.entries} 趟 · 编队 ${fleetIds.length} 艘 · ${armor.join(' ')}）`)
    return true
  }
  // ② 战斗在途：什么都不做，等引擎把这一场打完（`advanceWormhole` 逐拍推进）
  if (run.battle) {
    /**
     * **战斗开打/收场各记一条**（2026-09-21 加，纯诊断）：本模块只能看到"每拍 `run.battle`
     * 在不在"，所以"这趟是怎么结束的"必须靠战斗的进入/离开时刻来定位。实测层深 2 时
     * 每趟都在"第 N 层守卫开打"之后 0.0x 天内收场，而报告里既没有沉船也没有撤离读数。
     */
    if (!whBattleSeen) {
      whBattleSeen = true
      mark(`虫洞 战斗开始（第 ${run.depth} 层 · 在场 ${run.fleet.filter((u) => !!state.fleet[u]).length} 艘）`)
    }
    return true
  }
  if (whBattleSeen) {
    whBattleSeen = false
    mark(
      `虫洞 战斗结束（第 ${run.depth} 层 · 在场 ${run.fleet.filter((u) => !!state.fleet[u]).length}/${run.fleet.length} 艘 · ` +
        `残血 ${(wormholeHpFrac() * 100).toFixed(0)}% · 守卫账本 ${whBoss()})`,
    )
  }
  /**
   * **"人还在洞里"的每日体检**（2026-09-21 加，最后的诊断补充）：实测"第 3 趟进洞之后就再也没有
   * 任何虫洞日志、而模拟继续跑满 25 天"——说明 `state.wormhole.run` **卡住了**（本模块每拍被调、
   * 却一条日志都没写出来）。这条按天打印 run 的全套状态，把"卡在哪一步"钉死。
   */
  if (day() >= lastWhInsideNoteDay + 1) {
    lastWhInsideNoteDay = day()
    mark(
      `虫洞 在洞内（第 ${run.depth} 层 · 相位 ${run.phase} · 守卫 ${run.bossCleared ?? 0}/${run.depth} · ` +
        `回合 ${Math.max(0, Math.round(run.turnsLeft))} · 在场 ${run.fleet.filter((u) => !!state.fleet[u]).length}/${run.fleet.length} 艘 · ` +
        `盘 ${run.grid ? '有' : '无'} · 格 (${run.grid?.pos.q ?? '-'},${run.grid?.pos.r ?? '-'}) 出口 (${run.grid?.exit.q ?? '-'},${run.grid?.exit.r ?? '-'}) · ` +
        `待处理节点 ${run.pendingNode ? '有' : '无'})`,
    )
  }
  /**
   * **这趟刚收口/刚判负**（`run` 变 null 那一拍）：先按"进洞时的编队名单"数一下沉了几艘。
   * 洞内沉船**不写引擎日志**，所以这是唯一的损失读数（见 `whEnterSnapshot` 的注释）。
   */
  if (whEnterSnapshot) {
    /**
     * **损失读数 = 引擎自己的累计账本** `state.wormhole.lastFleetLost`（2026-09-21 改用这条）。
     *
     * 为什么不用"进洞前后的编队名单/艘数"对比（我前两版都这么写、**都漏报**）：模拟在船沉掉之后
     * **当天就把替补买回来**（`ensureWhFleet` 每拍都在跑），于是"收场时舰队又满了"，
     * 名单对比查不出、艘数差也是 0 ⇒ 报告出现"阵亡 0 艘"而实际全灭（实测 16.22d 那趟：
     * 战斗开始 4 艘在场、战斗结束 1 艘在场，报告却写"无损失"）。
     * `lastFleetLost` 是引擎在**击沉那一刻**累加的（`wormholeBattle` 只有两处 `+=`：
     * 击沉的 `sunk.length` ＋ 全灭时剩下的 `run.fleet.length`）⇒ 买替补也抹不掉，是唯一准的数。
     */
    const lostNow = state.wormhole.lastFleetLost ?? 0
    const lostDelta = Math.max(0, lostNow - whLostBase)
    if (lostDelta > 0) {
      whStats.wipes += lostDelta
      issue(`虫洞内损失 ${lostDelta} 艘（引擎账本 lastFleetLost ${whLostBase} → ${lostNow}）`)
    }
    mark(
      `虫洞 这趟收场：损失 ${lostDelta} 艘 · 层深账本 ${whDepth()} · 守卫账本 ${whBoss()} · 已进洞 ${whStats.entries} 次`,
    )
    whEnterSnapshot = null
  }
  if (!run) return false // 这一趟已经判负收场（主循环下一拍会重新尝试进洞）
  // ③ 这趟结束/被判负（`run` 已 null）/ 回合耗尽 / 血量太低 ⇒ 收口
  const hp = wormholeHpFrac()
  /**
   * ⚠ **回合耗尽**与**血量**分开判（2026-09-21 第六批）：两者后果不同 ——
   * 回合耗尽 = 引擎也不让下潜（`wormholeDescend` 会以 `mustExtract` 拒），只能撤离；
   * 低血 = 还能下潜（下潜不耗回合、也不打架），只是**下一层大概率打不动**。
   * 这份区分让下面 ③c 的分支能"在有值得做的事时先做、再按血撤离"。
   */
  const outOfTurns = run.turnsLeft <= 0
  const lowHp = hp < 0.45
  const wantExtract = outOfTurns || lowHp || whAlreadyDone()
  /**
   * **逐层读数**（2026-09-21 加）：每到一个新层深记一条"我方还剩多少血 / 还剩几回合 /
   * 还差多少到目标层深"。没有它，报告里只能看到"层深 2"，看不出是**打不动**（血不够）、
   * **回合不够**（`turnsLeft` 见底）还是**下不去**（`wormholeDescend` 被拒）。
   */
  if (run.depth !== lastWhDepthSeen) {
    lastWhDepthSeen = run.depth
    /**
     * ⚠ 同时记**编队还剩几艘在场**：洞内团灭时 `state.fleet` 会少船（这是"这趟怎么结束的"
     * 最直接的线索）。实测层深 2 之后**连续 10 趟都没到过第 3 层**，而报告里"阵亡 0 艘"——
     * 两个读数是矛盾的，必须靠这条把"到底谁没了"钉死。
     */
    const alive = run.fleet.filter((uid) => !!state.fleet[uid]).length
    mark(
      `虫洞 到达第 ${run.depth} 层：我方残血 ${(hp * 100).toFixed(0)}%（在场 ${alive}/${run.fleet.length} 艘）· ` +
        `剩余回合 ${Math.max(0, Math.round(run.turnsLeft))} · 层末守卫 ${run.bossCleared === run.depth ? '已清' : '未清'} · 目标第 ${WH_TARGET_DEPTH} 层`,
    )
  }
  const ac = run.grid ? wormholeActivateAt(state, ctx, state.gameMs) : null
  const grid = run.grid
  if (!grid) {
    // 老档线性层不参与成就冲刺：直接撤离
    const ex = wormholeExtract(run)
    if (ex.ok) whStats.extracts += 1
    return true
  }
  // ③a 站在出口格上 ⇒ 激活（= 打层末守卫；守卫已清则会被引擎拒，下一拍走 ③b）
  if (isExitCell(grid, grid.pos)) {
    if (ac && !ac.ok) {
      // 守卫已清 / 回合不够这类"预期内的拒因"不记异常：直接进 ③b 的深入/撤离
    } else if (ac && ac.ok) {
      mark(`虫洞 第 ${run.depth} 层守卫开打（层深 ${whDepth()}）`)
      return true
    }
  } else {
    /**
     * ③b 还没到出口：先扫（有盲区就扫），再朝出口走。
     *
     * ⚠ **扫描的必要性**（2026-09-21 复核）：扫描不只是"开图"——**未扫描的格照样拦路**
     * （`wormholePathInterceptAt` 裁定 1 = 乙："看不见的敌人也会挡路"）⇒ 不扫就永远绕不开，
     * 只能一路撞。所以顺序仍是"先把周围扫开、再算无阻路径"，但**路径要按 `whNextTravelStep` 算**
     * （能不打就不打），而不是傻点出口。
     */
    if (gridScanTargets(grid).length > 0 || (gridNebulaTargets(grid).length > 0 && grid.scanned.length < grid.cells.length)) {
      const sc = wormholeGridScan(state)
      if (sc.ok) whStats.scans += 1
      return true
    }
    const target = whNextTravelStep(grid)
    const targetCell = gridCellAt(grid, target)
    const needConfirm = !targetCell || !grid.scanned.includes(targetCell.key)
    /**
     * ⚠ **`confirmIntercept` 只在"确实绕不开"时才带**：带它 = 授权"撞上就开战"。
     * 按 `whNextTravelStep` 的口径，无阻时它不会带（于是引擎也不会拦）；
     * 万一路线仍被拦（比如两段都试过还是不行），带上它保证进度不被卡死。
     */
    const blocked = wormholePathInterceptAt(grid, target) !== undefined
    const isExitTarget = hexKey(target.q, target.r) === hexKey(grid.exit.q, grid.exit.r)
    const res = wormholeTravelTo(state, ctx, target, {
      confirmUnknown: needConfirm,
      ...(blocked ? { confirmIntercept: true } : {}),
    })
    if (res.ok) {
      whStats.moves += 1
      if (res.intercepted) {
        mark(`虫洞 路径拦截：在 (${grid.pos.q},${grid.pos.r}) 就地开战`)
      } else if (!isExitTarget) {
        mark(`虫洞 绕行中转 (${target.q},${target.r})：为避开路上的舰船信号，不硬打`)
      }
      return true
    }
    // 走不动（被拦/回合不够）⇒ 撤离
    const ex = wormholeExtract(run)
    if (ex.ok) whStats.extracts += 1
    else issue(`虫洞撤离被拒：${ex.error ?? ''}`)
    return true
  }
  // ③c 守卫已清 ⇒ 按目标深入 / 撤离
  /**
   * **"下潜即入账，然后立刻撤"**（2026-09-21 定，本段最省的一条）。
   *
   * 引擎的层深里程碑记在**下潜成功那一刻**（`wormholeDescend` 里 `peakFirst(state,'whMaxDepth',depth)`），
   * 而**不是**"在第 N 层打了多少东西"。所以政策是：**清掉本层守卫 → 立刻下潜一层（层深 +1 入账）
   * → 马上撤离保船**。每趟稳拿 +1 层深，4 趟就把四枚层深里程碑（2/3/4/5）收齐，
   * 完全不必冒着在深层团灭（`wormholeBattle` 全灭分支 = 四艘全损）的风险硬闯。
   *
   * ⚠⚠ **顺序必须是"先下潜、再撤离"，不能反过来**（2026-09-21 踩到，白跑一轮）：
   * 第一版写成"守卫一清、层深已在账上就撤"，而**下潜恰恰是让层深入账的那一步** ⇒
   * 逻辑自锁：层深 1 已入账 → 清完守卫直接撤 → **永远下不到第 2 层**（实测 14 趟全在第 1 层收场、
   * 层深账本一直停在 1）。正确顺序：`bossCleared === depth`（本层清完）⇒ **下潜**
   * （层深变 depth+1、里程碑入账）⇒ 下一拍发现 `depth` 已在 `whDepthBanked` 里 ⇒ 撤离。
   */
  if (run.bossCleared === run.depth) {
    if (run.depth >= WH_TARGET_DEPTH) {
      const ex = wormholeExtract(run)
      if (ex.ok) {
        whStats.extracts += 1
        mark(`虫洞 已达目标层深 ${run.depth}（六枚里程碑全拿），撤离`)
      }
      return true
    }
    if (whDepthBanked.has(run.depth + 1)) {
      // 下一层的里程碑已经赚过 ⇒ 这趟到此为止，撤（不硬闯已入账的深层）
      const ex = wormholeExtract(run)
      if (ex.ok) {
        whStats.extracts += 1
        mark(`虫洞 第 ${run.depth} 层守卫已清 · 第 ${run.depth + 1} 层里程碑早已入账 ⇒ 撤离保船`)
      } else issue(`虫洞撤离被拒：${ex.error ?? ''}`)
      return true
    }
    const dn = wormholeDescend(state, state.rng.seed, wormholeScanBonusOf(ctx, run.fleet))
    if (dn.ok) {
      whStats.descends += 1
      whDepthBanked.add(run.depth) // 本层已清并已下潜（层深里程碑随下潜入账）
      mark(`虫洞 第 ${run.depth} 层守卫已清 ⇒ 下潜第 ${run.depth + 1} 层（层深里程碑入账）`)
    } else {
      const ex = wormholeExtract(run)
      if (ex.ok) whStats.extracts += 1
      else issue(`虫洞深入被拒（${dn.error ?? ''}）且撤离失败：${ex.error ?? ''}`)
    }
    return true
  }
  if (wantExtract) {
    const ex = wormholeExtract(run)
    if (ex.ok) whStats.extracts += 1
    else issue(`虫洞撤离被拒：${ex.error ?? ''}`)
    return true
  }
  return true
}

/** 成就账本里的当前层深 / 守卫数（与 `checkGoals` 同一本账） */
function whDepth(): number {
  return (state.firstStats as { whMaxDepth?: number } | undefined)?.whMaxDepth ?? 0
}
function whBoss(): number {
  return (state.firstStats as { whBossClears?: number } | undefined)?.whBossClears ?? 0
}
function whAlreadyDone(): boolean {
  return whDepth() >= WH_TARGET_DEPTH && whBoss() >= 4
}

/**
 * **虫洞编队**：按"战力"排序取最强的几艘（战力 = 档位 + 火力 + 结构残值，够用且不引内部函数），
 * 再**从多到少试编队**、用 `wormholeAdmission`（与进洞同一道门：舰级/质量/回合预算）挑出第一套能进的。
 * ⚠ 不用 `wormholeAutoCandidates`：那张表把"能不能派 AI 副船"（AI 核心预算/占用）也算进去了，
 * 而手动进洞**不吃核心预算** ⇒ 用它会把能带的船错误地剔掉。这里只要"能进洞"这一把尺。
 */
function wormholeFleetPick(): string[] {
  const scoreOf = (uid: string): number => {
    const def = fleetDefOf(state, ctx, uid)
    const f = state.fleet[uid]
    if (!def || !f) return -1
    /**
     * ⚠ **打分必须重罚"残船"**（2026-09-21 第六批）。旧式 `durability*5 + armorPct*3` 只值
     * 8 分的权重，对上 `tier*10` 根本不够看 ⇒ 实测把 **甲 0%、结构 5%** 的船照样编进编队
     * （进洞读数实证：`甲0%结5%`）。而 `wormholeHpFrac()` 是按**格内单位血比上限**算的
     * ⇒ 一艘 0% 甲的船直接把整队血分拉掉一大截（4 艘里 1 艘残到 0% ⇒ 整队读数立刻难看），
     * 于是"第 2 层到达 40%"根本不是打出来的，是**带了一艘废船**拉低的。
     * 现改为：把"甲 + 结构"当百分比直接乘进总分（残船几乎必然排到最后）。
     */
    const hpScale = Math.max(0, Math.min(1, (f.armorPct ?? 1) * 0.6 + (f.durability ?? 1) * 0.4))
    const base = (def.tier ?? 1) * 10 + (def.powerBonus ?? 0) * 20
    return base * hpScale
  }
  const rows = Object.keys(state.fleet)
    // ⚠ **出勤中的船不能编进洞**（`wormholeEnter` 会被引擎以"正在AI 采矿中"拒掉——实测第一版
    //   就是这么失败的：唯一的战舰在挖矿，入洞被拒、虫洞目标全程 0 进度）
    .filter((uid) => !!state.fleet[uid] && !state.aiAssignments[uid])
    /**
     * ⚠ **甲/结构太残的船不许带进洞**（2026-09-21 第六批）：维修一天只跑一次，
     * 而"带一艘甲 0% 的船"等于**白送一个战位**（它几乎打不动、还拉低 `wormholeHpFrac` 读数）。
     * 阈值取 0.25：低于它的船宁可少带（带 3 艘健康的 > 带 4 艘含 1 艘废的）。
     */
    .filter((uid) => {
      const f = state.fleet[uid]
      if (!f) return false
      return (f.armorPct ?? 1) >= 0.25 && (f.durability ?? 1) >= 0.25
    })
    .map((uid) => ({ uid, score: scoreOf(uid) }))
    .sort((a, b) => b.score - a.score || a.uid.localeCompare(b.uid))
    .map((x) => x.uid)
  // 主控若能带 ⇒ 置首（引擎允许编队不含主控，但主控在队里才吃"驾驶舰"那套加成）
  const mainDef = fleetDefOf(state, ctx, state.shipId)
  const mainOk = !!mainDef && wormholeShipAllowed(mainDef)
  const ordered = mainOk ? [state.shipId, ...rows.filter((u) => u !== state.shipId)] : rows
  for (let n = Math.min(4, ordered.length); n >= 1; n--) {
    const fleet = ordered.slice(0, n)
    // ⚠ 入参口径：`wormholeAdmission(ctx, shipIds, techTurnBonus)` —— **没有 state**（第一版我按
    //   `wormholeEnter` 的形状误传了 `state`，于是 `shipIds` 收到了 `ctx` ⇒ `not iterable` 当场崩）
    const adm = wormholeAdmission(ctx, fleet, matterTechWhBuffs(state, ctx).turnBonus)
    if (adm.ok) return fleet
  }
  return []
}

/** 当前洞里那支编队的**三层血残值比**（护盾不落档 ⇒ 只看甲/结构口径，与工具既有写法一致） */
function wormholeHpFrac(): number {
  const run = state.wormhole.run
  if (!run) return 1
  let cur = 0
  let max = 0
  for (const uid of run.fleet) {
    const f = state.fleet[uid]
    if (!f) continue
    cur += (f.armorPct ?? 1) + (f.durability ?? 1)
    max += 2
  }
  return max > 0 ? cur / max : 1
}


/* ═══════════ 目标制（boss 通关 / 万亿现金 / 全收集） ═══════════ */
const goalDone = {
  boss: false,
  tril: false,
  collect: false,
  /** **船长 2026-09-21 的三条** */
  bounties: false,
  whach: false,
  isk1b: false,
}
const goalDay: Record<string, string> = {}
/** B3/工业 覆盖计数（报告「活动统计」用） */
const act = { aiSalvage: 0, pilotSalvage: 0, recycle: 0, craft: 0, learnBp: 0 }

function goodOf(kind: string, refId: string): { key: string; basePrice: number } | undefined {
  const g = [...ctx.marketGoods.values()].find((x) => x.kind === kind && x.refId === refId)
  return g ? { key: g.key, basePrice: g.basePrice ?? 0 } : undefined
}

function collectStatus(): { ships: number; shipsTotal: number; bps: number; bpsTotal: number; mods: number; modsTotal: number } {
  const ownedShips = new Set(Object.values(state.fleet).map((f) => f?.defId).filter((x): x is string => !!x))
  const fittedMods = new Set<string>()
  for (const f of Object.values(state.fleet)) {
    for (const rack of ['high', 'mid', 'low'] as const) {
      for (const m of f?.fitted?.[rack] ?? []) if (m) fittedMods.add(m)
    }
  }
  const buyableMods = [...ctx.modules.keys()].filter((id) => goodOf('module', id))
  let ownedMods = 0
  for (const id of buyableMods) {
    if ((state.moduleBay[id] ?? 0) > 0 || fittedMods.has(id)) ownedMods++
  }
  const bpTotal = [...ctx.blueprints.keys()].filter((id) => goodOf('blueprint', id)).length
  const bpOwned = [...ctx.blueprints.keys()].filter((id) => goodOf('blueprint', id) && ownsBlueprint(state, id)).length
  return {
    ships: ownedShips.size,
    shipsTotal: ctx.ships.size,
    bps: bpOwned,
    bpsTotal: bpTotal,
    mods: ownedMods,
    modsTotal: buyableMods.length,
  }
}

/** **完成所有悬赏**：可见悬赏卡全部首胜（`completedBounties` 是引擎的唯一台账） */
function bountyStatus(): { done: number; total: number } {
  const done = ANOMALY_LIST.filter((a) => state.completedBounties.includes(a.id)).length
  return { done, total: ANOMALY_LIST.length }
}

/**
 * **虫洞六枚里程碑的当前进度**（判据 = `firstStats` 的四个 stat，与成就系统**同一本账**——
 * 不给工具开后门、也不自己算一套）：
 * - 层深 `whMaxDepth` ≥ 5 ⇒ 初入深渊/深渊宿将/深渊之主/深渊彼岸 四枚；
 * - 击破层末守卫 `whBossClears` ≥ 4 ⇒ 斩层者/守关终结者 两枚。
 */
function whachStatus(): { depth: number; boss: number; done: boolean } {
  const fs = state.firstStats as { whMaxDepth?: number; whBossClears?: number } | undefined
  const depth = fs?.whMaxDepth ?? 0
  const boss = fs?.whBossClears ?? 0
  return { depth, boss, done: depth >= 5 && boss >= 4 }
}

function checkGoals(): void {
  if (WANTS.tril && !goalDone.tril && state.wallet.isk >= 1_000_000_000_000) {
    goalDone.tril = true
    goalDay.tril = day().toFixed(2)
    mark(`🎯 目标达成【万亿现金】：第 ${day().toFixed(2)}d 现金 ${state.wallet.isk.toLocaleString('zh-CN')} ISK`)
  }
  /** **10 亿 ISK**（船长 2026-09-21）——只认钱包（与"万亿"同一把尺） */
  if (WANTS.isk1b && !goalDone.isk1b && state.wallet.isk >= 1_000_000_000) {
    goalDone.isk1b = true
    goalDay.isk1b = day().toFixed(2)
    mark(`🎯 目标达成【10 亿 ISK】：第 ${day().toFixed(2)}d 钱包 ${state.wallet.isk.toLocaleString('zh-CN')} ISK`)
  }
  /** **完成所有悬赏**（船长 2026-09-21） */
  if (WANTS.bounties && !goalDone.bounties) {
    const b = bountyStatus()
    if (b.total > 0 && b.done >= b.total) {
      goalDone.bounties = true
      goalDay.bounties = day().toFixed(2)
      mark(`🎯 目标达成【完成所有悬赏】：第 ${day().toFixed(2)}d 首胜 ${b.done}/${b.total} 张`)
    }
  }
  /** **虫洞成就（六枚里程碑）**（船长 2026-09-21） */
  if (WANTS.whach && !goalDone.whach) {
    const w = whachStatus()
    if (w.done) {
      goalDone.whach = true
      goalDay.whach = day().toFixed(2)
      mark(`🎯 目标达成【虫洞成就】：第 ${day().toFixed(2)}d 层深 ${w.depth} 层 · 击破守卫 ${w.boss} 个`)
    }
  }
  if (WANTS.collect && !goalDone.collect) {
    const c = collectStatus()
    if (c.ships >= c.shipsTotal && c.bps >= c.bpsTotal && c.mods >= c.modsTotal) {
      goalDone.collect = true
      goalDay.collect = day().toFixed(2)
      mark(`🎯 目标达成【全收集】：第 ${day().toFixed(2)}d 舰船 ${c.ships}/${c.shipsTotal} · 蓝图 ${c.bps}/${c.bpsTotal} · 装备 ${c.mods}/${c.modsTotal}`)
    }
  }
}

function allGoalsDone(): boolean {
  return !(
    (WANTS.boss && !goalDone.boss) ||
    (WANTS.tril && !goalDone.tril) ||
    (WANTS.collect && !goalDone.collect) ||
    (WANTS.bounties && !goalDone.bounties) ||
    (WANTS.whach && !goalDone.whach) ||
    (WANTS.isk1b && !goalDone.isk1b)
  )
}

/** 收集购物（全收集目标：缺的船/装备按最便宜的补；每次最多推进一件，防卡单步） */
function doCollectShop(): void {
  if (!WANTS.collect || goalDone.collect) return
  if (meBusy() || !isHome() || (pilotLineBusy())) return
  const ownedShips = new Set(Object.values(state.fleet).map((f) => f?.defId).filter((x): x is string => !!x))
  const missingShip = [...ctx.ships.values()].filter((s) => !ownedShips.has(s.id)).sort((a, b) => a.priceIsk - b.priceIsk)[0]
  if (missingShip) {
    const g = goodOf('ship', missingShip.id)
    if (g && state.wallet.isk > g.basePrice * 1.3 + 150_000) {
      buyAtMarket(state, ctx, g.key, 1)
      mark(`收集舰船 ${missingShip.name}`)
    }
    return
  }
  const fittedMods = new Set<string>()
  for (const f of Object.values(state.fleet)) {
    for (const rack of ['high', 'mid', 'low'] as const) {
      for (const m of f?.fitted?.[rack] ?? []) if (m) fittedMods.add(m)
    }
  }
  const missingMod = [...ctx.modules.values()]
    .filter((m) => goodOf('module', m.id) && (state.moduleBay[m.id] ?? 0) <= 0 && !fittedMods.has(m.id))
    .sort((a, b) => (goodOf('module', a.id)!.basePrice) - goodOf('module', b.id)!.basePrice)[0]
  if (missingMod) {
    const g = goodOf('module', missingMod.id)!
    if (state.wallet.isk > g.basePrice * 1.2 + 30_000) {
      buyAtMarket(state, ctx, g.key, 1)
      mark(`收集装备 ${missingMod.name}`)
    }
  }
}

/* ═══════════ B3 打捞/回收闭环（2026-09-05：AI 打捞 + 主控低频会话 + 残骸回收炉） ═══════════ */

/** 市场买一件装备入装备库（已有则直接返回 true） */
function buyOneModule(id: string): boolean {
  if (countModule(state, id) > 0) return true
  const g = goodOf('module', id)
  if (!g || state.wallet.isk < g.basePrice * 1.2 + 20_000) return false
  buyAtMarket(state, ctx, g.key, 1)
  return countModule(state, id) > 0
}

/** 已存在且空闲、装了打捞器的非驾驶船（可作为打捞作业船） */
function findSalvageShip(): string | null {
  for (const [uid, f] of Object.entries(state.fleet)) {
    if (uid === state.shipId || state.aiAssignments[uid]) continue
    for (const m of f?.fitted?.high ?? []) {
      if (m && ctx.modules.get(m)?.slot === 'salvager') return uid
    }
  }
  return null
}

/** 给某艘船的高槽装打捞器 MK1（先把驾驶切过去，装完切回；返回是否装上 ≥1 台） */
function fitSalvagersTo(uid: string): boolean {
  const f = state.fleet[uid]
  const def = fleetDefOf(state, ctx, uid)
  if (!f || !def) return false
  const high = f.fitted?.high ?? []
  for (const m of high) if (m && ctx.modules.get(m)?.slot === 'salvager') return true
  const slots = def.slots?.high ?? high.length
  if (high.filter((x) => x !== null).length >= slots) return false
  const prev = state.shipId
  if (prev !== uid) {
    const r = changeShip(state, uid, ctx)
    if (!r.ok) return false
  }
  let done = false
  for (let i = 0; i < slots && i < 4; i++) {
    if (high[i] !== null) continue
    if (!buyOneModule('mod-salvager-1')) break
    const r = fitModule(state, 'mod-salvager-1', ctx, { rack: 'high', index: i })
    if (!r.ok) break
    done = true
  }
  if (prev !== uid) {
    const r = changeShip(state, prev, ctx)
    if (!r.ok) issue(`切回驾驶船失败（${uid} → ${prev}）：${r.error}`)
  }
  return done
}

/** 确保有一艘可用的打捞作业船（缺则买最便宜的高槽船并装打捞器） */
function ensureSalvageFleet(): void {
  if (findSalvageShip()) return
  if (meBusy() || !isHome() || (pilotLineBusy())) return
  const owned = new Set(Object.values(state.fleet).map((x) => x?.defId).filter((x): x is string => !!x))
  const cand = [...ctx.ships.values()]
    .filter((s) => (s.slots?.high ?? 0) > 0 && !owned.has(s.id) && state.wallet.isk > s.priceIsk * 1.5 + 200_000)
    .sort((a, b) => a.priceIsk - b.priceIsk)[0]
  if (!cand) return
  const g = goodOf('ship', cand.id)
  if (!g) return
  const got = buyAtMarket(state, ctx, g.key, 1)
  if (!got.shipUid) return
  if (fitSalvagersTo(got.shipUid)) mark(`购入打捞作业船 ${cand.name}（打捞器 MK1）`)
}

/** 可选打捞目标星系：已探索、非母港、有敌群型号池；低安优先（彩头池更肥） */
function salvageGalaxyPick(): string | null {
  const hasPool = (id: string): boolean => {
    for (const a of ctx.anomalies.values()) if (a.galaxyId === id) return true
    return false
  }
  const list = GALAXY_IDS.filter((id) => id !== HOME_GALAXY_ID && isExplored(state, id) && hasPool(id))
  if (list.length === 0) return null
  return [...list].sort((a, b) => (ctx.galaxies.get(a)?.security ?? 0) - (ctx.galaxies.get(b)?.security ?? 0))[0]!
}

function countAiKind(kind: string): number {
  let n = 0
  for (const a of Object.values(state.aiAssignments)) {
    const t = a?.task
    if (t && t.kind === kind) n++
  }
  return n
}

/** 残骸回收炉：仓库有残骸且炉空闲就整批入炉（料尽自动停）。
 * 优先 AI 核心驱动（背景运转，主控可以继续远征/扫描/打捞；核心不足就买一颗）；
 * 只有买不起核心时才用主控亲自开炉。 */
function doRecycle(): void {
  if (state.refineRuns.length > 0 || state.mining.active || !isHome()) return
  if (countAiCore(state, 'basic') <= 0) {
    if (state.wallet.isk < 100_000) return
    buyBasicAiCore(state, ctx)
    if (countAiCore(state, 'basic') <= 0) return
  }
  const wreckIds = [...ctx.items.values()]
    .filter((i) => i.kind === 'wreck' && oreAvailable(state, i.id) >= 10)
    .sort((a, b) => oreAvailable(state, b.id) - oreAvailable(state, a.id))
  const pick = wreckIds[0]
  if (!pick) return
  const qty = Math.floor(oreAvailable(state, pick.id)) // 先读数再入炉（入炉即锁定出库）
  const r = startRecycleRun(state, pick.id, 'basic', ctx)
  if (r.ok) {
    act.recycle++
    mark(`残骸回收 ${pick.name}（${qty} m³ 入炉，AI 核心驱动）`)
  } else issue(`残骸回收失败 ${pick.id}：${r.error}`)
}

let lastPilotSalvageDay = -99
/** 主控低频打捞会话（通关就绪后隔 0.5 天一次；验证主控打捞状态机/满仓自动返港/技能乘区） */
function doPilotSalvageSession(): void {
  if (WANTS.boss && !goalDone.boss) return // 通关前不占用主控
  if (day() - lastPilotSalvageDay < 0.5) return
  if (state.salvaging.active || state.mining.active || state.expedition.active || (pilotLineBusy())) return
  const uid = findSalvageShip()
  const gal = salvageGalaxyPick()
  if (!uid || !gal) return
  const prev = state.shipId
  if (prev !== uid) {
    const r = changeShip(state, uid, ctx)
    if (!r.ok) return
  }
  const r = startSalvageOp(state, gal, ctx)
  if (!r.ok) {
    issue(`主控打捞失败（${gal}）：${r.error}`)
    if (state.shipId === uid) changeShip(state, prev, ctx)
    return
  }
  mark(`主控打捞会话 ${ctx.galaxies.get(gal)?.name ?? gal}`)
  act.pilotSalvage++
  let guard = 0
  while (state.salvaging.active && guard < 2400) {
    advanceGame(state, STEP_MS, ctx)
    auditLogs()
    guard++
  }
  // 未满仓自动结束（会话上限内截停）→ 回港把残骸卸入仓库
  if (state.salvaging.active) {
    stopSalvageOp(state, ctx)
    let g2 = 0
    while (state.awayGalaxy !== null && !meBusy() && g2 < 600) {
      goHomeIfAway()
      advanceGame(state, STEP_MS, ctx)
      g2++
    }
  }
  if (state.shipId === uid && isHome()) unloadCargoToWarehouse(state)
  if (state.shipId === uid) {
    const r2 = changeShip(state, prev, ctx)
    if (!r2.ok) issue(`打捞会话后切回驾驶失败：${r2.error}`)
  }
  lastPilotSalvageDay = day()
}

/* ═══════════ 胜率口径：多波卡（steady 稳态对长盘多波系统失真，实测 100% vs 预估 11~37%）走
 * 与实战完全同构的蒙特卡洛（winEstimate，N=9），带配置指纹缓存（船+装配+技能+卡，满耐久口径）；
 * 单波卡维持 battleWinPreview（廉价、经实测校准良好）。2026-09-09 船长拍板校准方向。 */
const mcCache = new Map<string, number>()
function winOf(state: GameState, ctx: SimContext, a: AnomalyDef): number {
  if (!a.waves || a.waves.length === 0) return battleWinPreview(state, ctx, a)
  const entry = state.fleet[state.shipId]
  const defId = entry?.defId ?? state.shipId
  const skillKey = Object.entries(state.skills.trained)
    .sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([k, v]) => `${k}@${v}`)
    .join(',')
  const key = `${defId}|${JSON.stringify(entry?.fitted ?? {})}|${skillKey}|${a.id}`
  const hit = mcCache.get(key)
  if (hit !== undefined) return hit
  const snap = buildEvalState(state, state.shipId)
  if (!snap) return battleWinPreview(state, ctx, a)
  const f = snap.ev.fleet[snap.uid]
  if (f) {
    f.armorPct = 1 // 满耐久口径：模拟"修满后挑战"的决策视角
    f.durability = 1
  }
  const r = estimateBountyWinOn(snap.ev, ctx, a, snap.uid, 9)
  mcCache.set(key, r.winRate)
  return r.winRate
}

/* ═══════════ 最终目标（连打 5 局） ═══════════ */
function tryFinalRun(): boolean {
  const boss = ctx.anomalies.get('ano-vault-sentinel')!
  if (standing() < boss.standingReq) return false
  const w0 = winOf(state, ctx, boss)
  if (w0 < 0.85) return false
  mark(`最终验证：预估胜率 ${Math.round(w0 * 100)}% 连打 5 局`)
  for (let i = 0; i < 5; i++) {
    if (!isHome() && state.awayGalaxy !== null) {
      let g = 0
      while (state.awayGalaxy !== null && g < 240 && !meBusy()) {
        goHomeIfAway()
        advanceGame(state, STEP_MS, ctx)
        g++
      }
    }
    if (meBusy()) return false
    const r = startExpedition(state, 'ano-vault-sentinel', ctx)
    if (!r.ok) {
      issue(`最终局 ${i + 1} 出发失败：${r.error}`)
      return false
    }
    let guard = 0
    while (state.expedition.active && guard < 6000) {
      advanceGame(state, STEP_MS, ctx)
      auditLogs()
      guard++
    }
    auditLogs()
    if (state.expedition.active) return false
    const won = [...state.logs].reverse().some((l) => l.text.includes('大捷') && l.atGameMs >= state.gameMs - 86_400_000)
    if (!won) {
      issue(`最终局 ${i + 1} 未胜利`)
      return false
    }
    mark(`最终悬赏击败 ${i + 1}/5`)
    // 2026-09-06：胜利后自动返航回母港（去程并入返航）；连打间隙只需等回港空闲
    if (i < 4) {
      let g = 0
      while (state.awayGalaxy !== null && g < 300 && !meBusy()) {
        goHomeIfAway()
        advanceGame(state, STEP_MS, ctx)
        g++
      }
      if (state.awayGalaxy !== null && g >= 300) return false
    }
  }
  return true
}

/* ═══════════ 策略黑洞：侦测 / 记录 / 分级解救（船长 2026-09-05 定） ═══════════
 * 规则：模拟玩家陷入"黑洞"（无推进的循环）本身要记录进报告（不是引擎 bug）；
 * 但拖太久影响测试时长时按级解救：L1 清仓变现归位 → L2 注资升装 →
 * 终局前置判断：顶配武装仍打不过 boss（疑似平衡项）→ 提前终止并标注转 C4 复核。 */
const holeLogs: string[] = []
let lastMoveDay = 0
let rescueLevel = 0
let lastRescueDay = -99
let lastFp = ''
let holeEarlyExit = false
let topGearDay = -1 // 顶配达成日（终局受阻计时起点）
let topGearPower = 0 // 登记顶配时的舰船 powerBonus（换到更强的船就重新计时）

function progressFingerprint(): string {
  // 主线推进指纹：新首胜/新点亮/换驾驶/现金粗桶（500 万级）——纯赚钱波动不算推进
  return `${state.completedBounties.length}:${exploredCount()}:${state.shipId}:${Math.floor(state.wallet.isk / 5_000_000)}`
}

/** 返回 true = 提前终止（终局受阻判定的黑洞） */
function holeWatch(): boolean {
  const d = day()
  const cur = fleetDefOf(state, ctx, state.shipId)
  const weaponCount = (state.fleet[state.shipId]?.fitted.high ?? []).filter(Boolean).length
  const boss = ctx.anomalies.get('ano-vault-sentinel')
  const bossW = boss ? winOf(state, ctx, boss) : 0
  // 训练毕业（全部 62 技能满 5 级）才算顶配——real-training 下未毕业不算
  const trainingDone = [...ctx.skills.keys()].every((id) => (state.skills.trained[id] ?? 0) >= 5)
  // 顶配达成登记（**2026-09-12 批 4 收紧**）：训练毕业 + **驾驶的是舰队最强战斗船**
  //   （`bestCombatShipUid() === shipId`，即"战船真的在驾驶位"，不是采矿艇）+ ≥3 门武器
  //   + 声望解锁 + 星系全亮。
  //   ⚠ 旧口径只要求"驾驶船 role = armed + ≥3 门武器"，而 debugQuick 下技能秒级毕业 ⇒
  //   会在 **0.1d 就登记"顶配"**，随后 10 天倒计时对着一个"AI 根本打不过的 boss"空转
  //   ⇒ **恒定提前终止**（实测 2026-09-12：报告写"顶配武装（沙猫级采矿艇×1 门，自 0.1d 达成）"，
  //   而 AI 当时明明已经买了牛鲨级突击巡洋舰并配了 MK3 ——指标与事实相反）。
  //   现口径还**每次换到更强的船就重新计时**（给新船一个 10 天窗口，别把"刚升级完"误判成结论）。
  const isFlagshipPilot = bestCombatShipUid() === state.shipId
  const powerNow = cur?.powerBonus ?? 0
  if (topGearDay < 0 && trainingDone && isFlagshipPilot && weaponCount >= 3 && boss && standing() >= boss.standingReq && exploredCount() >= GALAXY_IDS.length) {
    topGearDay = d
    topGearPower = powerNow
  } else if (topGearDay >= 0 && powerNow > topGearPower + 0.05) {
    topGearDay = d
    topGearPower = powerNow
  }
  // 终局受阻判定：顶配达成后 10 天仍打不过 boss（farm 循环黑洞）→ 提前终止（疑似 C4 平衡项）；
  // 仅当通关目标仍挂起时适用（万亿/全收集目标不需要打赢 boss，可继续跑）
  if (WANTS.boss && !goalDone.boss && boss && trainingDone && bossW < 0.85 && topGearDay >= 0 && d - topGearDay >= 10) {
    holeLogs.push(
      `[${d.toFixed(1)}d] 黑洞（终局受阻）：顶配武装（${cur?.name ?? state.shipId}×${weaponCount} 门，自 ${topGearDay.toFixed(1)}d 达成）对 ${boss.name} 胜率仍 ${Math.round(bossW * 100)}% < 85% ——疑似平衡项，提前终止并转 C4 复核`,
    )
    holeEarlyExit = true
    return true
  }
  const fp = progressFingerprint()
  if (fp !== lastFp) {
    lastFp = fp
    lastMoveDay = d
    rescueLevel = 0
    return false
  }
  const stuck = d - lastMoveDay
  if (stuck < 6) return false // 6 天无主线推进才算黑洞
  if (d - lastRescueDay < 3) return false // 救援冷却 3 天
  lastRescueDay = d
  rescueLevel += 1
  if (rescueLevel === 1) {
    holeLogs.push(`[${d.toFixed(1)}d] 黑洞：连续 ${stuck.toFixed(0)} 天无推进（指纹 ${fp}）→ 救援1：召回作业+清仓变现+归位采矿`)
    if (state.expedition.active) recallExpedition(state, ctx)
    if (state.scanning.active) stopScan(state, ctx)
    if (state.standby.active) cancelStandby(state, ctx)
    for (const g of ctx.marketGoods.values()) {
      if (g.kind !== 'item') continue
      const def = ctx.items.get(g.refId)
      if (!def || def.kind === 'ammo' || def.kind === 'drone' || def.kind === 'mineral') continue
      const avail = countWare(state, g.refId)
      if (avail > 0) marketSellHolding(state, ctx, g.key, avail)
    }
    lastFp = progressFingerprint()
  } else {
    const inj = rescueLevel === 2 ? Math.round(800_000 + state.wallet.isk * 0.5) : 2_000_000
    holeLogs.push(`[${d.toFixed(1)}d] 黑洞持续 → 救援${rescueLevel}：注资 ${Math.round(inj / 1000)}k ISK（${rescueLevel === 2 ? '升级船与武器' : '维持继续观察'}）`)
    state.wallet.isk += inj
    lastFp = progressFingerprint()
  }
  return false
}

/* ═══════════ 资产/战斗力增长快照（2026-09-06 船长：记录玩家资产增长与战斗力增长） ═══════════ */
const growthRows: string[] = []
let lastSnapMs = -1

/** 总资产估算（口径与 balance-check 甲案同源：钱包 + 舰队/已装模块/货仓 + 仓库 + 装备库 + 蓝图书架，按市场常驻 base 折算现值） */
function wealthOfLive(): number {
  let v = state.wallet.isk
  const valItem = (id: string, u: number): number => {
    const g = marketGoodOf(ctx, 'item', id)
    const b = g?.basePrice ?? ctx.items.get(id)?.baseSellPriceIsk ?? 0
    return b * u
  }
  for (const [id, u] of Object.entries(state.warehouse.items ?? {})) v += valItem(id, u)
  for (const [id, u] of Object.entries(state.moduleBay ?? {})) v += (marketGoodOf(ctx, 'module', id)?.basePrice ?? 0) * u
  for (const [id, n] of Object.entries(state.blueprintStock ?? {})) if (n > 0) v += (marketGoodOf(ctx, 'blueprint', id)?.basePrice ?? 0) * n
  for (const f of Object.values(state.fleet)) {
    if (!f) continue
    if (f.defId) v += marketGoodOf(ctx, 'ship', f.defId)?.basePrice ?? ctx.ships.get(f.defId)?.priceIsk ?? 0
    for (const [id, u] of Object.entries(f.cargo ?? {})) v += valItem(id, u)
    for (const rack of Object.values(f.fitted)) {
      const list = Array.isArray(rack) ? rack : rack ? [rack] : []
      for (const id of list) if (typeof id === 'string' && id.length > 0) v += marketGoodOf(ctx, 'module', id)?.basePrice ?? 0
    }
  }
  return v
}

/** 实测基准战：独立新档复制当前驾驶船（船型/装配/技能），打合成参考目标（threat 档，orbit），返回 胜率% 与胜局平均击杀秒 */
function refFightOf(threat: number): { winPct: number; winSec: number } {
  const def = fleetDefOf(state, ctx, state.shipId)
  const liveFitted = state.fleet[state.shipId]?.fitted
  if (!def || !liveFitted) return { winPct: 0, winSec: 0 }
  let wins = 0
  let durSum = 0
  for (const seed of [1, 51]) {
    const s = createInitialState({ nowWallMs: 0, seed })
    s.wallet.isk = 500_000_000
    addShipToFleet(s, def.id)
    s.shipId = def.id
    for (const [k, lv] of Object.entries(state.skills.trained)) if ((lv ?? 0) > 0) s.skills.trained[k] = lv
    for (const k of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) s.warehouse.items[k] = 9_000
    const e = s.fleet[def.id]!
    e.fitted = { high: [...(liveFitted.high ?? [])], mid: [...(liveFitted.mid ?? [])], low: [...(liveFitted.low ?? [])] }
    repairDeprecatedModules(s, ctx as SimContext)
    const a: AnomalyDef = {
      id: `ref-${threat}`,
      name: `参考${threat}`,
      galaxyId: HOME_GALAXY_ID,
      threat,
      standingReq: 0,
      standingGain: 0,
      rewardIsk: 1,
      loot: [],
      combatSeconds: 120,
      tactic: 'orbit',
      description: '战力基准靶',
    }
    const actx = { ...ctx, anomalies: new Map([[a.id, a]]) } as SimContext
    const b = startBattleFor(s, actx, def.id, a.id, 0)
    if (!b) continue
    s.gameMs = 600_000 + 5_000
    advanceBattleFor(s, actx, b, def.id, a.id)
    if (b.ended === 'me') {
      wins++
      durSum += Math.max(0, b.lastTickGameMs - b.startedAtGameMs)
    }
  }
  return { winPct: Math.round((wins / 2) * 100), winSec: wins > 0 ? Math.round(durSum / wins / 1000) : 0 }
}

function fmtIsk(n: number): string {
  return n >= 1_000_000_000 ? `${(n / 1_000_000_000).toFixed(2)}B` : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1000)}k` : String(Math.round(n))
}

function growthSnapshot(): void {
  const def = fleetDefOf(state, ctx, state.shipId)
  const fitted = state.fleet[state.shipId]?.fitted
  const weapons = (fitted?.high ?? []).filter((x): x is string => x !== null && x.length > 0)
  const skillsSum = Object.values(state.skills.trained).reduce((a, b) => a + b, 0)
  const r30 = refFightOf(30)
  const r60 = refFightOf(60)
  growthRows.push(
    `d${(state.gameMs / 86_400_000).toFixed(3).padStart(7)} · 现金${fmtIsk(state.wallet.isk).padStart(6)} · 总资产${fmtIsk(wealthOfLive()).padStart(7)}` +
      ` · 声望${standing()} · 星系${exploredCount()}/${GALAXY_IDS.length} · 首胜${state.completedBounties.length}` +
      ` · 技能${skillsSum}级 · 火力${calcPower(state, ctx)}` +
      ` · 驾驶${def?.name ?? state.shipId}(${weapons.length}门)` +
      ` · 实测 T30 ${r30.winPct}%/${r30.winSec > 0 ? r30.winSec + 's' : '—'} · T60 ${r60.winPct}%/${r60.winSec > 0 ? r60.winSec + 's' : '—'}`,
  )
  lastSnapMs = state.gameMs
}

/* ═══════════ 主循环（目标制：通关 / 万亿现金 / 全收集；B3 打捞回收闭环） ═══════════ */
const wall0 = Date.now()

while (state.gameMs < MAX_MS && !allGoalsDone()) {
  auditLogs()
  if (state.gameMs - lastAuditMs > 300_000) {
    audit()
    lastAuditMs = state.gameMs
  }
  refillSkills()
  /**
   * **虫洞冲刺优先**（船长 2026-09-21 目标）：只要还没拿到六枚虫洞里程碑、且这趟没在收口，
   * 每一步都先喂它一拍决策（进洞 / 扫 / 走 / 打守卫 / 深入 / 撤离）。
   * ⚠ 放在最前面**且不看 `homeLull()`**：人一旦进洞，主控就占着"在洞里"这个活动位，
   * `homeLull()` 会一直为假 ⇒ 若挂在它下面，进洞第一拍之后就再也推不动了。
   */
  const whActive = inWormhole()
  if ((WANTS.whach && !goalDone.whach) || whActive) {
    const acted = doWormhole()
    if (acted || whActive) {
      checkGoals()
      if (lastSnapMs < 0 || state.gameMs - lastSnapMs >= SNAP_MS) growthSnapshot()
      advanceGame(state, STEP_MS, ctx)
      continue
    }
  }
  /**
   * **主控固定开那条战舰**（2026-09-21 批）：`doMine` / 主控打捞 / `ensureFlagship` 三者过去
   * 会把驾驶位在主控与采矿艇之间来回搬 —— 结果是"给当时驾驶的那条船买炮装炮"（实测日志：
   * `装配 mod-turret-kin-3（沙猫级采矿艇）`），而**真正打悬赏/进虫洞的那条战舰一直裸着**，
   * 于是声望卡在 8~10、虫洞深层也打不动。现在**每拍先归位到最强战舰**（有就换、在 AI 出勤就召回），
   * 采矿/打捞也用它 —— 引擎的采矿准入只看星带门槛与"不在洞里"，**不要求采集器**（读 `miningPreflight` 核过）。
   * 买船与配装紧随其后 ⇒ 永远作用在**同一条船**上。
   */
  ensureFlagship()
  /**
   * **舰船升级与配装每拍都试**（2026-09-21 批）：旧口径只在 `homeLull()` 分支里调 ⇒ 模拟长期卡在
   * 远征/采矿循环时**整段跑不到**（实测 50 天只买到 1 门炮、始终开着采矿艇）。函数内部自带守卫
   * （在忙/在航/在采矿一律跳过，买船每天至多一次）⇒ 放到这里只是把"有机会就升级"这件事做足。
   */
  buyShipAndGear()
  /**
   * **虫洞备战（凑 4 艘 T3+ 战斗舰）**（2026-09-21 补）：`buyShipAndGear` 只会把**主控那一艘**
   * 往上换（判据是"比驾驶船更强"）⇒ 舰队永远是"1 艘 T3 + 一堆 T1"，而虫洞按 4×T3 满配配平。
   * 这里补"**数量**"这一维，与上面同拍、同样自带守卫（在忙/在航/采矿一律跳过，买不到就每天记一条原因）。
   */
  ensureWhFleet()
  if (homeLull()) {
    if (!state.mining.active) {
      sellEverything()
      useFreeFalconet()
      doRefineCraft()
      doLearnCraft()
      doAi()
      ensureSalvageFleet()
      doRecycle()
      buyShipAndGear()
      if (standing() < 13) {
        doBounty()
        if (!state.expedition.active && !state.scanning.active) {
          doExplore() // 解锁下一批星系（无 frontier 时自然空转）
          if (!state.expedition.active && !state.scanning.active) doFarm() // 打不过新目标时先刷钱升装
        }
      } else if (exploredCount() < GALAXY_IDS.length) {
        doExplore()
      } else if (!state.expedition.active) {
        // 全部点亮 + 声望达标：按目标分流
        const bossDef = ctx.anomalies.get('ano-vault-sentinel')
        const bossW = bossDef ? winOf(state, ctx, bossDef) : 0
        if (WANTS.boss && !goalDone.boss) {
          if (bossW >= 0.85) {
            if (tryFinalRun()) {
              goalDone.boss = true
              goalDay.boss = day().toFixed(2)
              mark(`🎯 目标达成【通关】：第 ${day().toFixed(2)}d 终局悬赏连打 5/5`)
            }
          } else doFarm() // 打不过最终目标：刷高奖悬赏换钱买装备
        } else {
          doPilotSalvageSession() // B3：主控低频打捞会话（打捞技能乘区在真实作业上生效）
          // 剩余目标运营：优先打最高奖悬赏攒钱（通关后 boss 也进池，受冷却约束）；空窗采矿兜底
          if (!state.expedition.active && !state.scanning.active && !state.salvaging.active) {
            if (WANTS.tril && !goalDone.tril) doFarm()
            if (!state.expedition.active && !state.scanning.active && !state.salvaging.active && !state.mining.active) doMine()
          }
        }
      }
      // 采矿兜底（早期未就绪或打赏冷却空窗）；boss 冲刺就绪时不挖矿以免拖延最终验证
      if (!allGoalsDone() && !state.expedition.active && !state.scanning.active && !state.salvaging.active && !state.mining.active) {
        const bossDef2 = ctx.anomalies.get('ano-vault-sentinel')
        const bossW2 = bossDef2 ? winOf(state, ctx, bossDef2) : 0
        if (!(WANTS.boss && !goalDone.boss && bossW2 >= 0.85)) doMine()
      }
    } else if (state.gameMs % 1_800_000 < STEP_MS) {
      sellEverything() // 采矿往返间歇在港时卸货卖货
    }
  } else if (!meBusy()) {
    // 空闲兜底（2026-09-06：野外驻留仅来自掩护巡逻；悬赏/探索优先，随后归位/采矿由上层负责）
    if (WANTS.boss && !goalDone.boss && standing() < 13) doBounty()
    if (!state.expedition.active && standing() >= 13 && exploredCount() < GALAXY_IDS.length) doExplore()
    if (!state.expedition.active && !state.mining.active && !state.salvaging.active) goHomeIfAway()
  }
  // 进度探针（每 0.5 天）
  if (state.gameMs % (43_200_000) < STEP_MS) {
    mark(
      `进度：声望${standing()} 星系${exploredCount()}/${GALAXY_IDS.length} 现金${Math.round(state.wallet.isk / 1000)}k 船${Object.keys(state.fleet).length}艘 打捞船${findSalvageShip() ? '有' : '无'}`,
    )
  }
  // 目标检查（万亿现金 / 全收集）
  checkGoals()
  // 策略黑洞侦测（船长 2026-09-05：黑洞要记录报告；拖太久影响测试时长要分级解救）
  if (holeWatch()) break
  // 资产/战斗力增长快照（船长 2026-09-06：每快照间隔落一行，见报告末节）
  if (lastSnapMs < 0 || state.gameMs - lastSnapMs >= SNAP_MS) growthSnapshot()
  advanceGame(state, STEP_MS, ctx)
}

auditLogs()
audit()
checkGoals()
const wallSec = ((Date.now() - wall0) / 1000).toFixed(1)

/* ═══════════ 报告 ═══════════ */
const lines: string[] = []
lines.push('══════════ 全流程模拟报告 ═══════════')
lines.push(`debugQuick=${!REAL_TRAINING} seed=${SEED} 上限 ${MAX_DAYS} 天 目标=${GOAL_RAW}`)
const resultTxt = allGoalsDone()
  ? '✅ 目标全部达成'
  : holeEarlyExit
    ? '⏹ 提前终止（终局受阻黑洞，见策略黑洞记录）'
    : '❌ 未达成（天数上限）'
lines.push(`结果：${resultTxt}  游戏内 ${(state.gameMs / 86_400_000).toFixed(2)} 天 / 墙钟 ${wallSec}s`)
lines.push(`现金 ${Math.round(state.wallet.isk).toLocaleString('zh-CN')} ISK · DSI 声望 ${standing()} · 星系 ${exploredCount()}/${GALAXY_IDS.length} · 累计卖出 ${Math.round(soldTotal).toLocaleString('zh-CN')} ISK`)
lines.push(`训练总级数 ${Object.values(state.skills.trained).reduce((a, b) => a + b, 0)} · 队列 ${state.skills.queue.length} · 舰船 ${Object.keys(state.fleet).length} 艘 · AI 任务 ${Object.keys(state.aiAssignments).length} · 日志 ${state.logs.length} 条`)
lines.push('')
lines.push('—— 目标达成情况 ——')
for (const k of ['bounties', 'whach', 'isk1b', 'boss', 'tril', 'collect'] as const) {
  if (!WANTS[k]) continue
  const done = goalDone[k]
  const c = collectStatus()
  /** 逐目标的**进度读数**（未达成时告诉人差多少，而不是只给个 ⬜） */
  let extra = ''
  if (k === 'collect') extra = `（舰船 ${c.ships}/${c.shipsTotal} · 蓝图 ${c.bps}/${c.bpsTotal} · 装备 ${c.mods}/${c.modsTotal}）`
  else if (k === 'bounties') {
    const b = bountyStatus()
    extra = `（首胜 ${b.done}/${b.total} 张）`
  } else if (k === 'whach') {
    const w = whachStatus()
    extra = `（层深 ${w.depth}/5 层 · 击破守卫 ${w.boss}/4 个）`
  } else if (k === 'isk1b') extra = `（钱包 ${Math.round(state.wallet.isk).toLocaleString('zh-CN')} / 1,000,000,000）`
  lines.push(`  ${done ? '✅' : '⬜'} ${GOAL_NAMES[k]}${done ? `—— 第 ${goalDay[k]} 天达成` : ` ${extra}`}`)
}
if (WANTS.tril && !goalDone.tril) {
  lines.push('  · 万亿为超长程目标：debugQuick 只压缩等待、不放大收益（奖励按真实口径），达天数上限未竟属预期——重点看全程零引擎异常')
}
lines.push('')
lines.push('—— 虫洞冲刺读数（船长 2026-09-21 目标②）——')
{
  const w = whachStatus()
  lines.push(
    `  进洞 ${whStats.entries} 次（尝试 ${whStats.tries} 次）· 深入 ${whStats.descends} 次 · 撤离收口 ${whStats.extracts} 次 · 扫描 ${whStats.scans} 次 · 移动 ${whStats.moves} 次`,
  )
  lines.push(`  阵亡 ${whStats.wipes} 艘（读数 = 引擎账本 \`wormhole.lastFleetLost\` 的增量，买替补也抹不掉）`)
  lines.push(
    `  成就账本：层深 ${w.depth} 层 · 击破层末守卫 ${w.boss} 个 ⇒ 六枚里程碑${w.done ? '**全拿**' : '未齐'}` +
      `（需要层深 ≥5 且守卫 ≥4）`,
  )
  // 六枚逐条（与成就表同一把尺，逐条打勾）
  const rows: Array<[string, boolean]> = [
    ['初入深渊（层深 ≥2）', w.depth >= 2],
    ['深渊宿将（层深 ≥3）', w.depth >= 3],
    ['深渊之主（层深 ≥4）', w.depth >= 4],
    ['深渊彼岸（层深 ≥5）', w.depth >= 5],
    ['斩层者（击破守卫 ≥2）', w.boss >= 2],
    ['守关终结者（击破守卫 ≥4）', w.boss >= 4],
  ]
  for (const [name, ok] of rows) lines.push(`    ${ok ? '✅' : '⬜'} ${name}`)
  /**
   * **门为什么不过**（2026-09-21 补）：进洞门是"真跑一遍第 1 层"的**经验判据**，
   * 它不过时报告只写"进洞 0 次"是查不动的 —— 这里把每次真跑的结局（打死/打不完/残血）列出来。
   */
  if (whFloor1Diag.length > 0) {
    const uniq = [...new Set(whFloor1Diag)]
    lines.push(`  ⚠ 进洞门（真跑第 1 层）未通过 ${whFloor1Diag.length} 次，去重后 ${uniq.length} 种结局：`)
    for (const d of uniq.slice(0, 6)) lines.push(`    · ${d}`)
  }
}
lines.push('')
lines.push('—— 活动统计（B3/工业 覆盖）——')
lines.push(
  `  AI 打捞派发 ${act.aiSalvage} 次 · 主控打捞会话 ${act.pilotSalvage} 次 · 残骸回收开炉 ${act.recycle} 次 · 制造完工 ${act.craft} 件 · 蓝图学习 ${act.learnBp} 张`,
)
lines.push('')
lines.push(`—— 资产/战斗力增长快照（每 ${SNAP_DAYS} 游戏天；实测 = 复制当前驾驶船打合成 T30/T60 靶，2 种子平均）——`)
for (const r of growthRows) lines.push(`  ${r}`)
lines.push('')
lines.push(`—— 里程碑（共 ${milestones.length} 条，节选前 400 条）——`)
/**
 * ⚠ **不要把 400 调小**：`milestones` 里既有真里程碑、也有每拍/每天的诊断（虫洞逐层读数、
 * 备战待购、进洞门判据…）。上限太小会把**后期**读数整段截掉——2026-09-21 排查"虫洞日志在
 * 10.53 天之后消失"时，真因就是这里的 150 把后半程全截了（探针本身一直在跑、并未卡死）。
 */
for (const m of milestones.slice(0, 400)) lines.push(`  ${m}`)
lines.push('')
lines.push(`—— 策略黑洞记录（${holeLogs.length} 次）——`)
for (const h of holeLogs) lines.push(`  ${h}`)
lines.push('')
lines.push(`—— 异常（去重 ${issuesRaw.size} 类）——`)
let i = 0
for (const [text, n] of issuesRaw) {
  if (i++ >= 120) break
  lines.push(`  ×${n} ${text}`)
}
const bossFinal = ctx.anomalies.get('ano-vault-sentinel')
if (bossFinal) {
  const cur = fleetDefOf(state, ctx, state.shipId)
  lines.push(
    `终局评估：当前驾驶 ${cur?.name ?? state.shipId} 对 ano-vault-sentinel 预估胜率 ${Math.round(winOf(state, ctx, bossFinal) * 100)}%`,
  )
}
const report = lines.join('\n')
console.log(report)
if (REPORT) writeFileSync(REPORT, report, 'utf8')
process.exit((allGoalsDone() || holeEarlyExit) && issuesRaw.size === 0 ? 0 : 1)
