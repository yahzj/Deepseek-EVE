/**
 * **舰船插件**（**2026-09-26 船长令**，设计稿 `docs/design/ship-plug-20260926.md`）。
 *
 * 船长原话（照抄）：「**在工业-组装机的门类筛选中，添加舰船插件的新分类，打算依靠黑匣来生产舰船插件。
 * 舰船插件是一种类似装备的东西，同样装备在舰船上，但是不可拆卸，不可替换。装有插件的舰船无法放入舰船仓库。
 * 玩家打捞自己的舰船残骸时，总能回收舰船插件。**」＋「**玩家回收按插件数量直接回收成黑匣。**」
 *
 * ## 三条不可逆口径
 * 1. **不可拆、不可替换** —— 本模块**只提供 `installPlug`，没有 `removePlug`**（结构性保证：
 *    连函数都不存在，界面与会话都没得调）；装配页插件槽不给按钮。
 * 2. **装了插件 ⇒ 不许进舰船仓库、不许挂市场卖** —— 判据单点 `plugBlockReasonOf`，
 *    由 `shipyard.shipStorable` 与市场挂卖两处消费。
 * 3. **唯一失去途径 = 船被打沉** —— 插件随 `fleet` 条目一起消失（`loseShip` 删条目时自然带走），
 *    但**打捞自己的残骸能把它们换回黑匣**（`plugsToBlackBoxesOf`，见下）。
 *
 * ## 与既有装备的关系
 * 插件**共用 `ModuleDef`**（船长：「**是一种类似装备的东西**」），但**不走高/中/低槽位数组** ——
 * 它有自己的槽位（`ShipDef.plugSlots`，按船型档 T1=5 / T2=4 / T3=3 / T4=2 / T5=1）。
 * 因此 `allFittedModules`（只扫 `fitted`）**看不见插件**，插件效果由战斗建档侧单独一段累加
 * （⇒ 天然**不吃多件递减**，与船长「**③不吃**」一致）。
 */
import type { GameState } from './state'
import type { ModuleDef, ShipSlots, SimContext } from './types'
import { addLog } from './state'
import { addWare } from './inventory'
import { shipSlotsOf } from './labels'
// ⚠ 本模块被 `combat.ts`（建档）· `shipyard.ts` / `market.ts`（入仓与挂卖的闸门）反向引用
//   ⇒ 依赖方向要保守：**只依赖 `state` / `types`**。原先还 import 了 `equipment.countModule`，
//   但那只是一行取表（`state.moduleBay[id] ?? 0`），为省掉 `equipment → labels → …` 这条可能成环的
//   依赖边，这里就地取表（`equipment.countModule` 仍是"装备库余量"的语义单点，本文件只是复读同一份账）。

/** 插件模块 id 的语义判别（等价于「这件是插件」，判据单点） */
export function isPlugOf(def: Pick<ModuleDef, 'slot'> | undefined): boolean {
  return def?.slot === 'plug'
}

/** 该船的插件槽数（船型给；无档船 / 缺省 = 0 ⇒ 一件都装不了） */
export function plugSlotsOf(state: GameState, ctx: SimContext, shipId: string): number {
  const ship = state.fleet[shipId]
  const defId = ship?.defId
  if (defId === undefined) return 0
  return Math.max(0, ctx.ships.get(defId)?.plugSlots ?? 0)
}

/** 该船当前已装的插件 id 列表（无 = 空表） */
export function plugsOf(state: GameState, shipId: string): string[] {
  return state.fleet[shipId]?.plugs ?? []
}

/** 该船已装插件的定义列表（按装入顺序；未知 id 跳过） */
export function plugModulesOf(state: GameState, ctx: SimContext, shipId: string): ModuleDef[] {
  const out: ModuleDef[] = []
  for (const id of plugsOf(state, shipId)) {
    const def = ctx.modules.get(id)
    if (def && isPlugOf(def)) out.push(def)
  }
  return out
}

/** 装配页插件槽只读区要的两份数（槽位上限 + 已装的插件定义，按装入顺序） */
export function plugInfoOf(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): { slots: number; installed: ModuleDef[] } {
  return { slots: plugSlotsOf(state, ctx, shipId), installed: plugModulesOf(state, ctx, shipId) }
}

/**
 * **扩槽插件加成**（`midSlotsAdd` / `lowSlotsAdd`，**2026-09-27 船长令「修」**）——
 * 多件加算、不吃递减（与插件批其余字段同口径）。
 */
export function plugSlotAddsOf(state: GameState, ctx: SimContext, shipId: string): { mid: number; low: number } {
  let mid = 0
  let low = 0
  for (const p of plugModulesOf(state, ctx, shipId)) {
    mid += p.midSlotsAdd ?? 0
    low += p.lowSlotsAdd ?? 0
  }
  return { mid, low }
}

/**
 * 🔴 **该船实际可用槽位**（= 船型布局 ＋ 插件扩槽）——**槽位单点**。
 *
 * 为什么需要它（**2026-09-27 玩家报障批**）：`midSlotsAdd` / `lowSlotsAdd` 原先**全仓无人消费**
 * （只在 `shipInfo` 的说明文字里出现）⇒ 中层舱段 / 下层舱段插件"装上跟没装一样"——与同日修的
 * CPU 上限插件同一个病根（插件字段定义了、没人读）。修法：把"槽位数"的口径收敛到本函数，
 * 装配校验（`equipment.wantedBaysOf`）与装配页格数（`FitPage`）共用同一把尺。
 *
 * ⚠ 槽位数量在本作里 = `fitted.mid` / `fitted.low` 的**数组长度** ⇒ 光算出来不够，
 * `installPlug` 里还要把数组**就地补齐**（插件不可拆 ⇒ 只增不减）。
 */
export function shipSlotsWithPlugsOf(state: GameState, ctx: SimContext, shipId: string): ShipSlots {
  const defId = state.fleet[shipId]?.defId ?? shipId
  const base = shipSlotsOf(ctx.ships.get(defId) ?? {})
  const add = plugSlotAddsOf(state, ctx, shipId)
  return { high: base.high, mid: base.mid + add.mid, low: base.low + add.low }
}

/**
 * **装一件插件**（本模块是唯一入口）。
 *
 * 六道校验：① 船在不在 ⇒ ② 是插件吗（普通装备走 `fitModule`）⇒ ③ 槽满没满
 * （`plugSlotsOf`，T1=5…T5=1；无档船恒 0 = 装不了）⇒ ④ 装备库有没有 ⇒ ⑤ 同型**不许重复装**
 * （不可替换 ⇒ 装第二件同型没有意义）⇒ ⑥ 船只锁（进洞 / AI 执勤等，与 `fitModule` 同一把尺）。
 *
 * ⚠ **没有对应的卸下函数**（船长：「**不可拆卸，不可替换**」）：这是"不可拆"的**结构性**保证，
 * 不是靠界面藏按钮。
 */
export function installPlug(
  state: GameState,
  ctx: SimContext,
  moduleId: string,
  shipId: string = state.shipId,
): { ok: true } | { ok: false; errorId?: string; error?: string; errorParams?: Readonly<Record<string, string | number>> } {
  const def = ctx.modules.get(moduleId)
  if (!def) return { ok: false, error: `未知装备：${moduleId}。`, errorId: 'core.equipment.001', errorParams: { p1: moduleId } }
  if (!isPlugOf(def)) {
    return { ok: false, error: `「${def.name}」不是舰船插件。`, errorId: 'core.plug.002', errorParams: { p1: def.name } }
  }
  const ship = state.fleet[shipId]
  if (!ship) return { ok: false, error: '舰队里找不到这艘舰船。', errorId: 'core.plug.003' }
  const cap = plugSlotsOf(state, ctx, shipId)
  const have = plugsOf(state, shipId)
  if (cap <= 0) {
    return { ok: false, error: `「${ctx.ships.get(ship.defId ?? '')?.name ?? shipId}」没有舰船插件槽。`, errorId: 'core.plug.004', errorParams: { p1: ctx.ships.get(ship.defId ?? '')?.name ?? shipId } }
  }
  if (have.length >= cap) {
    return { ok: false, error: `插件槽已满：本舰 ${cap} 格，且插件装上去就拆不下来。`, errorId: 'core.plug.005', errorParams: { p1: cap } }
  }
  if (have.includes(moduleId)) {
    return { ok: false, error: `本舰已经装了一件「${def.name}」——同型插件不能重复装。`, errorId: 'core.plug.006', errorParams: { p1: def.name } }
  }
  if ((state.moduleBay[moduleId] ?? 0) < 1) {
    return { ok: false, error: `装备库里没有「${def.name}」，先去组装机造一件。`, errorId: 'core.equipment.002', errorParams: { p1: def.name } }
  }
  // 扣库 + 装入（复用装备库的扣减单点口径：够就减 1）
  const rest = (state.moduleBay[moduleId] ?? 0) - 1
  if (rest === 0) delete state.moduleBay[moduleId]
  else state.moduleBay[moduleId] = rest
  ship.plugs = [...have, moduleId]
  /**
   * **扩槽插件装上就生效**：格子数 = `fitted.mid` / `fitted.low` 的**数组长度** ⇒ 装完立刻就地补空位，
   * 否则玩家装完插件、不碰装配页就看不到新格子（与"字段没人读"是同一种体感）。
   * 插件**不可拆、不可替换** ⇒ 只增不减，不需要缩容逻辑；老档（已装插件、数组还是旧长度）
   * 会在下一次装配动作时由 `equipment.ensureRackBays` 按同一把尺幂等补齐。
   */
  const wantSlots = shipSlotsWithPlugsOf(state, ctx, shipId)
  for (const rack of ['mid', 'low'] as const) {
    const bays = ship.fitted?.[rack]
    if (!bays) continue
    while (bays.length < wantSlots[rack]) bays.push(null)
  }
  /**
   * ⟪文案调整 2026-10-01⟫（船长报障「部分随机事件里依旧看到 `{p1}`/`{p2}`」时全仓普查扫出）：
   * 模板 `core.plug.001` 是 `已为 {p1} 装上插件：{p2}。` —— **两个槽**，而这里此前只喂了 `p1`
   * ⇒ 玩家读到的日志是「已为「XX」装上插件：**{p2}**。插件装上后无法拆下。」。
   * ⇒ 补喂 `p2`（插件名）；同时把正文里的插件名去掉 —— 否则补参后会重复印两遍。
   * ⟪文案调整 2026-10-02⟫ 正文再去掉船名外的「」——表文（玩家看到的那句）与英文都没有引号
   * ⇒ 正文与表文逐字一致（见工作文档 `docs/design/return-log-copy-20261002.md` §6 同类普查）。
   */
  const shipName = state.fleet[shipId]?.customName ?? ctx.ships.get(ship.defId ?? '')?.name ?? shipId
  addLog(
    state,
    'fleet',
    `已为 ${shipName} 装上插件：${def.name}。插件装上后无法拆下。`,
    'core.plug.001',
    { p1: shipName, p2: def.name },
  )
  return { ok: true }
}

/** **这艘船为什么不能进舰船仓库 / 不能挂卖**（`null` = 可以）——一份**结构化的拒因**，不是一句写死的文案 */
export interface ShipPlugBlock {
  /** 本地化 id（界面走 `t(textId, params)`；见约定 §十一之三的 id 映射制） */
  textId: string
  /** 插值参数（`{p1}` = 已装插件数） */
  params?: Record<string, string | number>
  /** 中文原文（引擎日志 / 测试断言用；界面**不要**直接渲染它） */
  text: string
}

/**
 * **这艘船为什么不能进舰船仓库 / 不能挂卖**（`null` = 可以）。
 *
 * 船长原话：「**装有插件的舰船无法放入舰船仓库。**」⇒ 有插件就一条都不许
 * （不是"插件留在船上"那种折中：船进了仓库就等于把整船冻结保存，插件会跟着被雪藏）。
 * 消费方两处：`shipyard.shipStorable`（入库）与 `market.shipSellable`（挂卖 / 市价卖船）。
 *
 * ⚠ **船型定义不参与判定**：只要 `plugs` 非空即拒——清洗器已经把非法值滤净（`save.cleanPlugIds`），
 * 这里再查一遍 `ctx.ships` 只会让"船型表查不到"变成一条**绕过闸门**的路。
 * ⚠ 拒因文案**不列插件名**（船长 2026-09-26「**除非非常有必要，否则不要用括号进行额外说明**」：
 * 理由本身就是通行规则，念名字属于额外说明）。想看装了哪几件走 `plugInfoOf`（装配页只读区）。
 */
export function plugBlockReasonOf(state: GameState, shipId: string): ShipPlugBlock | null {
  const plugs = plugsOf(state, shipId)
  if (plugs.length === 0) return null
  return {
    textId: 'core.plug.007',
    params: { p1: plugs.length },
    text: `这艘船装有 ${plugs.length} 件舰船插件，插件装上去就拆不下来——不能放入舰船仓库，也不能挂卖。`,
  }
}

/**
 * 一具玩家残骸里的插件 → 黑匣件数。
 *
 * 口径（船长：「**按插件数量直接回收成黑匣**」）：**1 件插件 = 1 个黑匣**，
 * **无条件、不掷骰**（与"其余件逐件掷骰"是两本账 ⇒ 插件总能拿回，符合船长原话
 * 「**玩家打捞自己的舰船残骸时，总能回收舰船插件**」）。
 */
export function plugsToBlackBoxesOf(plugIds: readonly string[]): number {
  return Math.max(0, plugIds.filter((id) => id.length > 0).length)
}

/* ═══════════ 章鱼人兑换（**2026-09-26 船长令**）═══════════
 * 船长原话：「**找章鱼人用声望兑换**」＋「**声望真扣**」
 * ⇒ 单张图纸 **8 点声望**、**真扣**（只扣可支配那本；累计那本不动 ⇒ 门槛不会被扣回去）。
 * ⚠ **2026-09-26 晚船长改判**：「**我从来没有说过"开局能换 5 张"，所以要清理，并且还要削减累计声望**」
 * ⇒ 新档**不再赠送初始声望**（两条账都从 0 起步）⇒ 第一张图纸要自己攒到 8 点；单张 8 点的价目不变。 */

/** 单张插件图纸的声望价（**8 点**；真扣可支配那本，累计那本不动） */
export const PLUG_BLUEPRINT_COST = 8

/**
 * **通用黑匣的声望价**（**2026-09-27 船长令**：「**玩家可以用30声望换一个通用黑匣**」）——
 * 与图纸同口径：**只扣可支配那本**、门槛仍读累计；**可无限次兑换**（不像图纸会"已学会即隐藏"）。
 */
export const UNIVERSAL_BLACKBOX_COST = 30

/** 通用黑匣的物品 id（**2026-09-27 船长令**；与 `blackbox-h` 互为制造替代料，见 `manufacturing.MATERIAL_GROUPS`） */
export const UNIVERSAL_BLACKBOX_ITEM_ID = 'blackbox-universal'

/**
 * **用声望换一枚通用黑匣**（唯一入口；兑换窗口那张卡调它）。
 *
 * 三道校验：① 可支配声望够不够（不够则一点不动）⇒ ② 扣 30 点 ⇒ ③ **入物品仓库**
 * （`addWare`；与"黑匣入库"同口径 —— 玩家在「物品」页就能看到，不进驾驶船货舱）。
 * ⚠ 与图纸那支**不是一回事**：图纸是"兑换即学会"（消耗品性质），本件是**实物**（进仓库的制造料）。
 */
export function exchangeUniversalBlackBox(
  state: GameState,
  count = 1,
): { ok: true; count: number } | { ok: false; errorId: string; error: string; errorParams?: Readonly<Record<string, string | number>> } {
  const n = Math.max(1, Math.floor(count))
  const price = UNIVERSAL_BLACKBOX_COST * n
  const have = spendableStandingOf(state)
  if (have < price) {
    return {
      ok: false,
      errorId: 'core.plug.013',
      errorParams: { p1: n, p2: price, p3: have },
      error: `声望不足：换通用黑匣 ×${n} 要 ${price} 点，当前可支配 ${have} 点。`,
    }
  }
  spendStanding(state, price)
  addWare(state, UNIVERSAL_BLACKBOX_ITEM_ID, n)
  addLog(
    state,
    'trade',
    /** ⟪文案调整 2026-10-02⟫ 正文与表文（`core.plug.012`）对齐：原正文「花…点协会声望换到…（已存入物品仓库）。」
     * 与表文（玩家看到的那句）措辞不同 ⇒ 按表文改写，**玩家可见零变化**。见 `docs/design/return-log-copy-20261002.md` §6。 */
    `章鱼人兑换：花掉 ${price} 点协会声望，换到通用黑匣 ×${n}，已存入物品仓库。`,
    'core.plug.012',
    { p1: price, p2: n },
  )
  return { ok: true, count: n }
}

/** 一件插件的图纸 id 约定（`data/blueprints.ts` 的 12 张按它派生） */
export function plugBlueprintIdOf(moduleId: string): string {
  return `bp-${moduleId}`
}

/**
 * **用声望换一张插件图纸**（唯一入口；兑换窗口那张卡调它）。
 *
 * 四道校验：① 是插件吗 ⇒ ② 图纸在不在目录里 ⇒ ③ **已经学会了吗**（学会了就不该再花声望）
 * ⇒ ④ **可支配声望够不够**（不够则两本账都不动）。
 * 成功 = 扣 8 点可支配声望 ＋ **图纸直接学会**（`learnedRecipes`，2026-09-26 船长令「兑换即学会」）
 * ＋ 一条 `trade` 日志。⚠ 不再发"蓝图书"⇒ 蓝图书架上不会出现插件图纸。
 */
export function exchangePlugBlueprint(
  state: GameState,
  ctx: SimContext,
  moduleId: string,
): { ok: true; blueprintId: string } | { ok: false; errorId: string; error: string; errorParams?: Readonly<Record<string, string | number>> } {
  const def = ctx.modules.get(moduleId)
  if (!isPlugOf(def)) {
    return { ok: false, errorId: 'core.plug.002', error: `「${moduleId}」不是舰船插件。`, errorParams: { p1: moduleId } }
  }
  const bpId = plugBlueprintIdOf(moduleId)
  const bp = ctx.blueprints.get(bpId)
  if (!bp) {
    return { ok: false, errorId: 'core.plug.008', error: `图纸目录里没有「${bpId}」。` }
  }
  if ((state.learnedRecipes ?? []).includes(bpId)) {
    return { ok: false, errorId: 'core.plug.009', error: `已经学会「${bp.name}」了，不用再换。`, errorParams: { p1: bp.name } }
  }
  const have = spendableStandingOf(state)
  if (have < PLUG_BLUEPRINT_COST) {
    return {
      ok: false,
      errorId: 'core.plug.010',
      errorParams: { p1: bp.name, p2: PLUG_BLUEPRINT_COST, p3: have },
      error: `声望不足：换「${bp.name}」要 ${PLUG_BLUEPRINT_COST} 点，当前可支配 ${have} 点。`,
    }
  }
  // 真扣（只扣可支配那本）；扣款与"记进已学"同一处 ⇒ 不会出现"扣了声望没拿到图纸"
  spendStanding(state, PLUG_BLUEPRINT_COST)
  /**
   * **兑换即学会**（**2026-09-26 船长令**：「**能否让兑换的图纸直接学会？**」→ 问"老档里已换未学的书
   * 要不要顺带归正"⇒ 船长答「**保持原样**」）。
   *
   * 口径：声望一扣 ⇒ 直接进 `learnedRecipes`（**不再发一本书**）。为什么这一步才合理：学习本来
   * 只是"消耗 1 本书 ＋ 记进已学"（`market.learnBlueprint`，无 ISK、无等待）⇒ 中间那道"书上架→再点学会"
   * 对玩家是纯多一步，插件图纸也从来没有"多余的书写来挂市场"这条路。
   * ⚠ **老档保持原样**：先前换到、还没学会的那几本仍留在蓝图书架上，玩家自己点「学会」即可（不自动归正）。
   */
  state.learnedRecipes.push(bpId)
  addLog(
    state,
    'trade',
    /** ⟪文案调整 2026-10-02⟫ 正文与表文（`core.plug.011`）对齐：按表文改写（花掉 / 逗号 / 去掉书名号），
     * **玩家可见零变化**。见 `docs/design/return-log-copy-20261002.md` §6。 */
    `章鱼人兑换：花掉 ${PLUG_BLUEPRINT_COST} 点协会声望，换到并学会 ${bp.name}，可直接在组装机无限次制造。`,
    'core.plug.011',
    { p1: PLUG_BLUEPRINT_COST, p2: bp.name },
  )
  return { ok: true, blueprintId: bpId }
}

/** 兑换窗口一行（界面直接渲染；`affordable` 与 `learned` 由这里算好，界面不再各判一次） */
export interface PlugExchangeRow {
  moduleId: string
  blueprintId: string
  name: string
  /** 图纸名（"XX图纸"） */
  blueprintName: string
  cost: number
  /** 已学会（这一行置灰，且不给换） */
  learned: boolean
  /** 可支配声望够不够 */
  affordable: boolean
}

/** **兑换窗口的 12 行**（顺序 = `ctx.modules` 里插件的登记顺序；只列真的是插件的那些） */
export function plugExchangeRowsOf(state: GameState, ctx: SimContext): PlugExchangeRow[] {
  const have = spendableStandingOf(state)
  const rows: PlugExchangeRow[] = []
  for (const def of ctx.modules.values()) {
    if (!isPlugOf(def)) continue
    const blueprintId = plugBlueprintIdOf(def.id)
    const bp = ctx.blueprints.get(blueprintId)
    if (!bp) continue
    rows.push({
      moduleId: def.id,
      blueprintId,
      name: def.name,
      blueprintName: bp.name,
      cost: PLUG_BLUEPRINT_COST,
      learned: (state.learnedRecipes ?? []).includes(blueprintId),
      affordable: have >= PLUG_BLUEPRINT_COST,
    })
  }
  return rows
}

/** 可支配声望（转发 `expedition.spendableStandingOf`；本模块只认 `dsi`） */
function spendableStandingOf(state: GameState): number {
  return state.standings['dsi'] ?? 0
}

/** 花掉声望（转发 `expedition.spendStanding` 的口径；只扣可支配那本） */
function spendStanding(state: GameState, v: number): boolean {
  const have = state.standings['dsi'] ?? 0
  if (have < v) return false
  state.standings['dsi'] = have - v
  return true
}
