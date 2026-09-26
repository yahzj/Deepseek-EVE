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
import type { ModuleDef, SimContext } from './types'
import { addLog } from './state'
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
): { ok: true } | { ok: false; errorId?: string; error?: string } {
  const def = ctx.modules.get(moduleId)
  if (!def) return { ok: false, error: `未知装备：${moduleId}。`, errorId: 'core.equipment.001' }
  if (!isPlugOf(def)) {
    return { ok: false, error: `「${def.name}」不是舰船插件。`, errorId: 'core.plug.002' }
  }
  const ship = state.fleet[shipId]
  if (!ship) return { ok: false, error: '舰队里找不到这艘舰船。', errorId: 'core.plug.003' }
  const cap = plugSlotsOf(state, ctx, shipId)
  const have = plugsOf(state, shipId)
  if (cap <= 0) {
    return { ok: false, error: `「${ctx.ships.get(ship.defId ?? '')?.name ?? shipId}」没有舰船插件槽。`, errorId: 'core.plug.004' }
  }
  if (have.length >= cap) {
    return { ok: false, error: `插件槽已满：本舰 ${cap} 格，且插件装上去就拆不下来。`, errorId: 'core.plug.005' }
  }
  if (have.includes(moduleId)) {
    return { ok: false, error: `本舰已经装了一件「${def.name}」——同型插件不能重复装。`, errorId: 'core.plug.006' }
  }
  if ((state.moduleBay[moduleId] ?? 0) < 1) {
    return { ok: false, error: `装备库里没有「${def.name}」，先去组装机造一件。`, errorId: 'core.equipment.002' }
  }
  // 扣库 + 装入（复用装备库的扣减单点口径：够就减 1）
  const rest = (state.moduleBay[moduleId] ?? 0) - 1
  if (rest === 0) delete state.moduleBay[moduleId]
  else state.moduleBay[moduleId] = rest
  ship.plugs = [...have, moduleId]
  addLog(
    state,
    'fleet',
    `已为「${state.fleet[shipId]?.customName ?? ctx.ships.get(ship.defId ?? '')?.name ?? shipId}」装上插件：${def.name}（插件装上后无法拆下）。`,
    'core.plug.001',
    { p1: def.name },
  )
  return { ok: true }
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
export function plugBlockReasonOf(state: GameState, shipId: string): string | null {
  const plugs = plugsOf(state, shipId)
  if (plugs.length === 0) return null
  return '这艘船装有舰船插件，插件装上去就拆不下来——不能放入舰船仓库，也不能挂卖。'
}

/** 打捞自己的舰船残骸时：**插件按数量换算成黑匣**（船长：「**玩家回收按插件数量直接回收成黑匣**」） */
export const PLUG_BLACKBOX_ITEM_ID = 'blackbox-h'

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
