/** 功能域职责拆分，保持原计算与顺序。 */
import type { SimContext } from '../../types'
import type { WormholeRunState } from '../../wormhole'
import { wormholeLootValueIsk, wormholeCoreTypeOfItemId, wormholeDeliverRelics, WORMHOLE_ESSENCE_PER_DEVICE, WORMHOLE_ESSENCE_ITEM_ID } from '../../wormholeSalvage'
import { type GameState, addLog } from '../../state'
import { gainAiCore, aiCoreName } from '../../ai'
import { addWare } from '../../inventory'

/**
 * **洞内推进（每拍调用一次）**：战斗步进 + 战斗收口 + 撤离收口（`extracting` 分支）。
 * 放在 `advanceGame` 管线里（`engine.ts`），与远征/AI/遭遇同款"每拍一次"节奏。
 * `freezeBattle`（调试快进）时**不推进战斗**，与既有口径一致。
 */
/** **背包估值**（母矿按基础卖价 + 残骸按回收炉拆解口径；货柜不计 ISK —— 内容物待拆解） */
export function bagValueIsk(ctx: SimContext, run: WormholeRunState): number {
  let v = 0
  for (const slot of run.bag) {
    const units = Math.max(0, Math.floor(slot.units))
    if (units <= 0) continue
    if (slot.itemId.startsWith('wreck-')) v += wormholeLootValueIsk(ctx, slot.itemId, units)
    else v += units * (ctx.items.get(slot.itemId)?.baseSellPriceIsk ?? 0)
  }
  return v
}

/**
 * **把带回的 AI 核心接入核心库**（2026-09-14 船长：「AI 核心单独占 1 格」＋ 落地答
 * 「撤离成功自动入核心库，不进仓库」）。
 *
 * 为什么抽成导出函数：这条语义（**入核心账本、仓库里没有**）是船长明确裁定的口径，
 * 但它原本埋在 `deliverExtraction` 里 —— 要验它就得跑完一整趟撤离战。抽出来之后用例可以直接钉住
 * （见 `tests/wormhole-core-drop.test.ts`），也保证"撤离带回"与"自动探索带回"两条路同源。
 *
 * 非核心 id 一律**原样跳过**（货柜/谜质仍走各自那条入库路径）。
 * @returns 各档枚数（本批没有核心 = 空对象）
 */
export function deliverWormholeCores(
  state: GameState,
  ids: readonly string[],
): Partial<Record<'gamma' | 'beta' | 'alpha', number>> {
  const cores: Partial<Record<'gamma' | 'beta' | 'alpha', number>> = {}
  for (const id of ids) {
    const type = wormholeCoreTypeOfItemId(id)
    if (!type) continue
    gainAiCore(state, type)
    cores[type] = (cores[type] ?? 0) + 1
  }
  if (Object.keys(cores).length > 0) {
    const text = (['alpha', 'beta', 'gamma'] as const)
      .filter((t) => (cores[t] ?? 0) > 0)
      .map((t) => `${aiCoreName(t)}×${cores[t]}`)
      .join('、')
    addLog(
      state,
      'combat',
      `🕳 带回 ${text}：已直接接入核心库（不占货仓、不入仓库）。`,
      'core.wormholeBattle.021',
      { p1: text },
    )
  }
  return cores
}

/**
 * **撤离成功的收口**（船长 2026-09-13 的收口点之一）：
 * ① **发起撤离后的收口那一拍**（`advanceWormhole` 的 `extracting` 分支 —— 2026-09-15 起撤离不再有
 *    战斗；**2026-09-27 起渲染层在点撤离那一刻就当拍调用它**，正常路径不再"等下一拍"）；
 * ② 老档里**已经在打的撤离战打赢**（`settleWormholeBattle` 的 `'extract'` 分支，仅兼容旧档）。
 * ⇒ 抽成一个函数，免得两条路各写一遍（历史上这种"收口少抄一步"在本文件踩过三次：弹药退款 / 机群战损 / 货柜入库）。
 *
 * 做四件事：散货入港 → 随行战利品入库 → **货柜（形状件）入港** → 写**结算单** + 写日志。
 */
export function deliverExtraction(state: GameState, ctx: SimContext, run: WormholeRunState): void {
  if (run.supplyVersion === 1 && run.supplies) {
    for (const [id, n] of Object.entries(run.supplies.items)) addWare(state, id, n)
  }
  let isk = 0
  let recycle = 0
  let oreUnits = 0
  for (const slot of run.bag) {
    const units = Math.floor(slot.units)
    const isWreck = slot.itemId.startsWith('wreck-')
    const price = ctx.items.get(slot.itemId)?.baseSellPriceIsk ?? 0
    // **残骸的报账走拆解口径**（基础价只有 1 ISK/单位，写出来等于没写）
    isk += isWreck ? 0 : units * price
    if (!isWreck) oreUnits += units
    if (isWreck) recycle += wormholeLootValueIsk(ctx, slot.itemId, units)
    if (units > 0) addWare(state, slot.itemId, units)
  }
  addLog(
    state,
    'combat',
    `🕳 撤离成功：货仓 ${run.bag.length} 类物资入港` +
      (isk > 0 ? `（按基础价约 ${Math.round(isk).toLocaleString('zh-CN')} 信用点）` : '') +
      (recycle > 0 ? `（残骸拆解估值约 ${Math.round(recycle).toLocaleString('zh-CN')} 信用点）` : '') +
      `，第 ${run.depth} 层撤离。`,
  )
  // **随行战利品入库**（遗迹专属掉落：图纸进蓝图书架、装备进装备库）——只有撤离成功才到手
  const relics = [...(run.relics ?? [])]
  if (relics.length > 0) wormholeDeliverRelics(state, ctx, relics)
  /**
   * **货柜（形状件）随趟带回**（船长 §12.2-3：「撤离成功 ⇒ 货柜进仓库；失败 ⇒ 随趟一起丢」）。
   *
   * ⚠ 2026-09-13 修：形状件**不在 `run.bag`**（它们走 `run.hold.placements`），"背包入港"
   * 的循环因此看不到它们 ⇒ F4 起打捞到的「遗迹安全货柜」会在撤离成功那一刻**静默消失**。
   *
   * ⚠ 2026-09-14 修（一号核验查出的缺陷）：**谜质储存器与货柜共用同一套形状件账本**（都记
   * `kind: 'box'`），原来按 `p.kind === 'box'` 取件 ⇒ 装置被当货柜交去入库，与物品说明
   * 「本趟结束随趟消失（不进仓库、不拆解）· 离开虫洞即失效」相反 ⇒ 现在**按物品 kind 排除 `matter`**。
   */
  const boxes = (run.hold?.placements ?? [])
    .filter((p) => p.kind === 'box')
    .map((p) => p.itemId)
    .filter((id) => ctx.items.get(id)?.kind !== 'matter')
  /**
   * **临时空间里的东西「撤离时全部丢弃」**（**船长 2026-09-20**：「**撤离时临时空间的东西全部丢弃。**」）。
   *
   * ⚠ 本条**推翻** 2026-09-13 的旧口径（原文：「大件货先进临时空间，让玩家协调」＋「临时空间是"船上的缓冲"，
   * 不是船外的地方 ⇒ 撤离成功一并入港」）——旧口径下临时空间的东西会随趟入港，现改为**撤离即丢弃**：
   * 核心不入核心账、货柜不进拆解池、散货不入仓库、**谜质装置也不折成虫洞谜质**（"全部"含装置）。
   * 界面侧仍是"撤离前必须清空（丢掉 或 放回）"那道闸（船长 2026-09-14）⇒ 玩家有一次挽回机会；
   * 但**凡是真的走到本函数**（撤离成功结算），临时空间里的件一律不再随趟回来。
   * 半路全损那条路径本来也是随趟丢 ⇒ 两条路径现在一致。
   *
   * ⚠ 2026-09-14 修（一号核验查出的缺陷）：账本 2026-09-14 已从**老档只读字段** `run.temp`
   * （一种物品一条的列表）迁到 **`run.tempGrid`**（4×8 格子账本）⇒ 原来读 `run.temp` 恒读空，
   * 临时空间里的件会在"撤离成功"那一刻**凭空消失**（当时被界面规则「撤离前必须清空临时空间」
   * 挡成不可达，所以没炸）。本条按 `tempGrid` 现算件数——**只用于日志与丢弃提示，不再投递**。
   */
  const tempPlacements = run.tempGrid?.placements ?? []
  /** 临时空间里的散货按物品合并单位数（一件一格 ⇒ 同一物品可能有多件） */
  const tempUnits = new Map<string, number>()
  for (const p of tempPlacements) {
    tempUnits.set(p.itemId, (tempUnits.get(p.itemId) ?? 0) + Math.max(0, Math.floor(p.units ?? 0)))
  }
  /**
   * **AI 核心单独走一条**（2026-09-14 船长定：「AI 核心单独占 1 格」＋ 落地答「撤离成功自动入核心库，
   * 不进仓库」）：它们是**形状件**（1×1），撤离成功那一刻按枚数 `gainAiCore` 直接入核心账，
   * **绝不能进 `wormholeDeliverRelics`**（那条会 `addWare` 进仓库 ⇒ 变成"仓库里有 3 个核心却不能用"
   * 的两本账）。半路全损根本走不到这里 ⇒ 核心随背包一起丢（现成口径）。
   */
  const coreIds = boxes.filter((id) => wormholeCoreTypeOfItemId(id) !== null)
  const cores = deliverWormholeCores(state, coreIds)
  /** 行价参考估值（唯一出处 = 市场卡；核心账本那本 key 是 `core-<type>`） */
  const coresIsk = (['gamma', 'beta', 'alpha'] as const).reduce(
    (s, t) => s + (cores[t] ?? 0) * (ctx.marketGoods.get(`core-${t}`)?.basePrice ?? 0),
    0,
  )
  /**
   * **谜质装置 ⇒ 虫洞谜质**（2026-09-15 船长定：「谜质在虫洞结束时不再删除，而是转化成虫洞谜质
   * 存入仓库。……该物品只收不卖。且具备较高价值，目前纯粹作为虫洞的金钱收益」）。
   *
   * 口径：**只有撤离成功才折算**（本函数 = 撤离成功的收口点）⇒ 半路全损走的是"随趟丢"那条路，
   * 谜质一枚都拿不到；装置给的增益本趟照旧生效（折算是结算动作，不改 `run` 里的任何账目）。
   * 台数按**件**算（形状件一件一格，`p.units` 缺省即 1）。
   * ⚠ **只算背包里的**（船长 2026-09-20「撤离时临时空间的东西全部丢弃」）⇒ 临时空间里的装置
   * 随趟丢、**不折谜质**。
   */
  const matterDevices = (run.hold?.placements ?? []).reduce(
    (n, p) => n + (ctx.items.get(p.itemId)?.kind === 'matter' ? Math.max(1, Math.floor(p.units ?? 1)) : 0),
    0,
  )
  const essences = matterDevices * WORMHOLE_ESSENCE_PER_DEVICE
  if (essences > 0) {
    addWare(state, WORMHOLE_ESSENCE_ITEM_ID, essences)
    const essenceName = ctx.items.get(WORMHOLE_ESSENCE_ITEM_ID)?.name ?? '虫洞谜质'
    addLog(
      state,
      'combat',
      `谜质装置${matterDevices}件析出${essences}枚${essenceName}，已入仓库。`,
      'core.explorationStatus.006',
      { p1: matterDevices, p2: essences, p3: essenceName },
    )
  }
  /** 谜质行价参考估值（与核心同一口径：唯一出处 = 市场卡；**不计入「到手合计」**） */
  const essenceIsk = essences * (ctx.marketGoods.get(WORMHOLE_ESSENCE_ITEM_ID)?.basePrice ?? 0)
  /** 货柜/形状件：**只算背包里的**（临时空间那批按船长 2026-09-20 的裁定随趟丢） */
  const boxesAll = boxes
    .filter((id) => wormholeCoreTypeOfItemId(id) === null)
    .filter((id) => ctx.items.get(id)?.kind !== 'matter') // 谜质装置：上面已折成谜质入库，不再走"入库/拆解"这条路
  if (boxesAll.length > 0) wormholeDeliverRelics(state, ctx, boxesAll)
  /**
   * **临时空间里的东西就地丢弃**（船长 2026-09-20）：不入仓库、不进核心账、不进拆解池、不折谜质；
   * 写一条 warn 让玩家在日志里看得见（界面那道"撤离前必须清空"的闸是挽回机会，这里是既成事实的落账）。
   */
  if (tempPlacements.length > 0) {
    addLog(
      state,
      'combat',
      `🕳 撤离放弃：临时空间里的 ${tempUnits.size} 类物资留在洞里（未整理的按丢弃处理）。`,
      'core.wormholeBattle.022',
      { p1: tempUnits.size },
    )
  }
  // **结算单**（界面弹层用；玩家确认后清掉）
  state.wormhole.lastSettle = {
    kind: 'extract',
    ...(run.expeditionRules === 2 ? { expeditionGoal: run.expeditionGoal, expeditionProgress: run.expeditionProgress } : {}),
    ...(run.supplyVersion === 1 && run.supplies ? {
      suppliesReturned: { ...run.supplies.items }, suppliesUsed: { ...run.supplies.consumed },
      suppliesFound: { ...run.supplies.found },
    } : {}),
    depth: run.depth,
    oreUnits,
    oreIsk: isk,
    wreckIsk: recycle,
    boxes: boxesAll,
    relics,
    ...(coreIds.length > 0 ? { cores, coresIsk } : {}),
    ...(essences > 0 ? { essences, ...(essenceIsk > 0 ? { essenceIsk } : {}) } : {}),
    shipsLost: [],
    lostIsk: 0,
  }
}
