import { ceilFinalQuantity } from '../../quantity'
import { matterTechWreckYield } from '../../matterTech'
import { addLog } from '../../state'
import type { GameState } from '../../state'
import { bumpFirst } from '../../firstTasks'
import { wormholeDeliverRelics, wormholeRareBoxThemeGroupsOf, wormholeRareBoxThemePoolOf, wormholeUnboxRoll } from '../../wormholeSalvage'
import { encryptedBlueprintGroups, encryptedFamilyOf } from '../../encryptedContainer'
import type { SimContext } from '../../types'
import { addWare, countItem, countWare, removeItem, removeWare } from '../../inventory'
import { aiCoreName, gainAiCore, releaseAiCore } from '../../ai'
import { shipActuallyDocked } from '../../shipActionPolicy'
import { composeLog, logParamsOf } from '../../logParts'
import { fragmentItemIdOf, isRareWreck, recycleProfileOf, rollRecycleGuarantee, rollRareBoxExtra, rollRecycleLoot, rollRecycleCoreGain } from '../../salvage'
import { addAiIncome, addAiRefineBatch, type SettleStats } from '../../settleStats'
import { refundClaimedUnits } from './refund'
import { industryAvailable, RARE_UNIT_M3, refineBatchOutputOf } from './params'
import { yieldNoteFor } from './yieldNote'

/** 货柜拆解的一件货柜产物；仅供渲染层会话记录，不进入 GameState。 */
export interface UnboxResultRow {
  boxItemId: string
  grants: readonly { itemId: string; units: number }[]
}

/**
 * 引擎内部：推进全部精炼炉工位（每次时间推进后调用；v20：原料不锁定，
 * 每批到点从仓库实时扣取 min(单批, 仓库余量)——余量不足自然成尾批，耗尽自动停炉并归还核心。
 * 同资源多台并行时按数组顺序各自扣料，公平近似。
 * stats = 离线结算统计器（可选；AI 核心驱动的批数与收入见 settleStats.ts）
 */
export function advanceRefining(
  state: GameState,
  ctx: SimContext,
  stats?: SettleStats,
  onUnboxResult?: (result: UnboxResultRow) => void,
): void {
  // 倒序遍历：异常/料尽时从数组移除元素不影响尚未推进的其它工位
  for (let i = state.refineRuns.length - 1; i >= 0; i--) {
    const r = state.refineRuns[i]!
    if (!r.active || r.itemId === null) {
      state.refineRuns.splice(i, 1)
      continue
    }
    const def = ctx.items.get(r.itemId)
    if (!def) {
      // 异常：停炉（私有料账先退回仓库，避免预占的残骸凭空消失；核心归还）
      refundClaimedUnits(state, r)
      if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
      state.refineRuns.splice(i, 1)
      addLog(state, 'industry', '精炼炉运转异常：资源记录缺失，该台已停（AI 核心已归还）。', 'core.industry.033')
      continue
    }
    let guard = 0
    const isRecycle = r.recipe === 'recycle'
    const isUnbox = r.recipe === 'unbox'
    const profile = isRecycle ? recycleProfileOf(ctx, r.itemId) : null
    if (isRecycle && !profile) {
      // 残骸来源异常：停炉（同上，先退私有料账）
      refundClaimedUnits(state, r)
      if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
      state.refineRuns.splice(i, 1)
      addLog(state, 'industry', '残骸回收运转异常：残骸来源记录缺失，该台已停（AI 核心已归还）。', 'core.industry.034')
      continue
    }
    /**
     * **无料即停**（2026-09-24 玩家报障「没有东西了还在拆。取消就消失」）：
     * "料尽"原先只在**批到点**那一刻判 ⇒ 料若在**批中途**消失（卖掉/搬走/被另一台炉抢走），
     * 那一台会继续转到本批结束（拆解线最长 90 秒）才停，玩家看到的就是"没料了还在拆"。
     * ⇒ 每拍先算一次余量，**不足一批就把到点时间拨到"现在"**，交回既有的停炉分支处理
     * （退私有料账 / 记「原料耗尽 / 货柜已拆完」/ 归还 AI 核心，口径一字不变）。
     */
    {
      const nowUsesClaim = r.claimedUnits !== undefined
      const nowStock = nowUsesClaim ? Math.max(0, r.claimedUnits ?? 0) : industryAvailable(state, ctx, r.itemId)
      const nowAvail = r.lockUnits !== undefined ? Math.min(nowStock, r.lockUnits) : nowStock
      if (nowAvail < r.batchUnits && r.finishAtGameMs > state.gameMs) r.finishAtGameMs = state.gameMs
    }
    while (r.active && state.gameMs >= r.finishAtGameMs) {
      if (++guard > 100_000) break // 防失控循环
      // v20 实时扣料：仓库/货仓余量决定本批能炼多少；
      // **私有料账**（稀有残骸 2026-09-11「起炉即预占」）优先：料 = 本炉预占的存量，不再看公共库存
      const usesClaim = r.claimedUnits !== undefined
      const stock = usesClaim ? Math.max(0, r.claimedUnits ?? 0) : industryAvailable(state, ctx, r.itemId)
      const avail = r.lockUnits !== undefined ? Math.min(stock, r.lockUnits) : stock
      if (avail <= 0) {
        // 原料耗尽 / 本轮定额完成：自动停炉（含被卖光/被并行台抢先的情况）
        const doneBatches = r.batchesDone
        // 定额完成口径：有私有料账（稀有残骸）时，**账清即本炉定额完成**（一炉恒等于一件，仓库还剩几件
        // 是"再开一炉"的事）；无私有账时沿用旧口径（锁量用尽但仓库还有料）。
        const lockDone = r.lockUnits !== undefined && (usesClaim || stock > 0)
        refundClaimedUnits(state, r) // 私有料账残余退回仓库（正常走完 = 0，无副作用）
        if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
        const wasCore = r.worker !== 'pilot'
        const accNote = r.recAcc ? yieldNoteFor(ctx, r.recAcc, isRecycle ? 'recycle' : 'refine') : null
        state.refineRuns.splice(i, 1)
        /**
         * **停机标题与原因按产线分岔**（2026-09-15 船长报障「精炼炉拆解货柜的文字显示不对」）：
         * 货柜拆解不是精炼 ⇒ 标题写「货柜拆解停」、原因写「货柜已拆完（共 N 件）」，
         * 不再套用精炼那套「精炼炉停 … 原料耗尽（共 N 批）」。
         */
        const coreSeg = wasCore ? { text: '；AI 核心已归还核心库', id: 'core.state.041' } : null
        const yieldSeg =
          accNote && accNote.text !== ''
            ? {
                // 本段文本是"标签 + 明细"一句：标签走 id，明细（`subs`）逐类走 id
                text: `；${isRecycle ? '回收' : '精炼'}所得：${accNote.text}`,
                id: isRecycle ? 'core.industry.066' : 'core.industry.067',
                params: { p1: accNote.text },
                subs: accNote.parts.map((p) => ({ text: p.text, id: p.id, params: p.params, subs: p.subs })),
              }
            : null
        if (lockDone) {
          const composed = composeLog(
            `残骸回收炉停：${def.name} 本炉料账已烧完（共 ${doneBatches} 批）`,
            [
              yieldSeg,
              coreSeg,
              {
                text: `；不足 ${RARE_UNIT_M3} m³（一个回收单元）的零头不预占、不产出，留在货仓/仓库；想继续就再起一炉。`,
                id: 'core.industry.073',
                params: { p1: RARE_UNIT_M3 },
              },
            ],
          )
          addLog(state, 'industry', composed.text, 'core.industry.072', { p1: def.name, p2: doneBatches, ...logParamsOf(composed) })
        } else {
          const stopTitle = isUnbox
            ? `货柜拆解停：${def.name}`
            : isRecycle
              ? `残骸回收炉停：${def.name}`
              : `精炼炉停：${def.name}`
          const stopWhy = isUnbox ? `货柜已拆完（共 ${doneBatches} 件）` : `原料耗尽（共 ${doneBatches} 批）`
          const composed = composeLog(`${stopTitle} ${stopWhy}`, [yieldSeg, coreSeg, { text: '。', id: 'core.state.042' }])
          addLog(state, 'industry', composed.text, isUnbox ? 'core.industry.075' : isRecycle ? 'core.industry.076' : 'core.industry.077', {
            p1: def.name,
            p2: doneBatches,
            ...logParamsOf(composed),
          })
        }
        break
      }
      // 2026-09-06（船长拍板：余量不足即停工、余料保留）：到批点时余量不足一批 → 立即停工，
      // 不再吃"小批尾料"；余料留在货仓/仓库，与"起炉需 ≥ 一批"对称（凑够一批再开）
      if (avail < r.batchUnits) {
        const doneBatches = r.batchesDone
        refundClaimedUnits(state, r) // 私有料账残余退回仓库（正常走完 = 0，无副作用）
        if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
        const wasCore = r.worker !== 'pilot'
        const accNote = r.recAcc ? yieldNoteFor(ctx, r.recAcc, isRecycle ? 'recycle' : 'refine') : null
        const remainTxt = isRecycle ? `${Math.round(avail * 100) / 100} m³` : `${avail} 单位`
        const unitTxt = isRecycle ? 'm³' : '单位'
        state.refineRuns.splice(i, 1)
        const composed = composeLog(
          `${isRecycle ? `残骸回收炉停：${def.name}` : `精炼炉停：${def.name}`} 余量不足一批（每批 ${r.batchUnits}${isRecycle ? ' m³' : ' 单位'}，余 ${remainTxt}）——已完成 ${doneBatches} 批`,
          [
            accNote && accNote.text !== ''
              ? {
                  text: `；${isRecycle ? '回收' : '精炼'}所得：${accNote.text}`,
                  id: isRecycle ? 'core.industry.066' : 'core.industry.067',
                  params: { p1: accNote.text },
                  subs: accNote.parts.map((p) => ({ text: p.text, id: p.id, params: p.params, subs: p.subs })),
                }
              : null,
            // 尾句是"两段相连"（已停工 + 核心归还）：核心段挂着时尾句留 `{p1}` 槽、核心另占一段
            wasCore
              ? { text: '，已停工、余料保留在货仓/仓库（凑够一批可再开）', id: 'core.industry.078' }
              : { text: '，已停工、余料保留在货仓/仓库（凑够一批可再开）。', id: 'core.industry.079' },
            wasCore ? { text: '；AI 核心已归还核心库。', id: 'core.state.040' } : null,
          ],
        )
        addLog(state, 'industry', composed.text, isRecycle ? 'core.industry.074' : 'core.industry.083', {
          p1: def.name,
          p2: r.batchUnits,
          p3: unitTxt,
          p4: remainTxt,
          p5: doneBatches,
          ...logParamsOf(composed),
        })
        break
      }
      const encryptedFamily = isUnbox && r.itemId ? encryptedFamilyOf(r.itemId) : null
      if (encryptedFamily && !encryptedBlueprintGroups(ctx, encryptedFamily)) {
        refundClaimedUnits(state, r)
        if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
        state.refineRuns.splice(i, 1)
        addLog(state, 'warn', '', 'core.encrypted.001')
        break
      }
      const qty = r.batchUnits // 每批整批扣料（不足一批已在上方停工，不再有小批）
      if (r.lockUnits !== undefined) r.lockUnits -= qty // 本轮锁量递减（≤0 时下一轮走上面的定额完成分支）
      if (usesClaim) {
        // 私有料账：起炉时已把料从公共库存扣出，本批只从私有账扣（不再动货仓/仓库）
        r.claimedUnits = Math.max(0, (r.claimedUnits ?? 0) - qty)
      } else {
        // 从货仓优先扣料，余下取仓库
        const fromCargo = shipActuallyDocked(state, ctx) ? Math.min(countItem(state, r.itemId), qty) : 0
        if (fromCargo > 0) removeItem(state, r.itemId, fromCargo)
        const fromWare = qty - fromCargo
        if (fromWare > 0) removeWare(state, r.itemId, fromWare)
      }
      let batchIncome = 0 // 2026-09-08：离线结算预估收入（原材料按站内收价；彩头装备按市场基准价粗估；碎片不计）
      if (isUnbox && r.itemId) {
        /**
         * **拆解一件货柜**（F4d；2026-09-14 起两台口径分岔）：抽 1 件 → 入库（装备 → 装备库 /
         * 图纸 → 图纸库存 / 物品 → 仓库，走与随行战利品同一条 `wormholeDeliverRelics`）。
         * 安全货柜 = 100% 族专属池；图纸货柜 = 5% 永久图纸 / 95% 一次性图纸（按层档）。
         * 抽不出东西（奖池为空）⇒ 停这一台并说清，不静默丢料。
         */
        const drawn = wormholeUnboxRoll(state, ctx, r.itemId)
        if (drawn) {
          /**
           * **一箱多件**（2026-09-15 新增的贵重品/军用货柜）：主件 + `extra` 合成一份 id 清单，
           * 物品类的数量走 `unitsOf`（奢侈品一叠 10~20 件；其余仍按"一件一格"的默认口径）。
           * 目录/图纸类与模块类不看数量（模块按"清单里出现几次"各入装备库一次）。
           */
          const grants = [{ itemId: drawn.itemId, units: drawn.units }, ...(drawn.extra ?? [])]
          // 记录实际入库增量，不能把抽取数量当成另一套交付规则。
          const receivedCount = (id: string): number => ctx.modules.has(id) ? state.moduleBay[id] ?? 0
            : ctx.blueprints.has(id) || ctx.shipBlueprints.has(id) ? state.blueprintStock[id] ?? 0 : countWare(state, id)
          const beforeGrants = onUnboxResult ? new Map(grants.map(g => [g.itemId, receivedCount(g.itemId)])) : null
          wormholeDeliverRelics(
            state,
            ctx,
            grants.map((g) => g.itemId),
            Object.fromEntries(grants.map((g) => [g.itemId, g.units])),
          )
          if (beforeGrants) onUnboxResult?.({
            boxItemId: r.itemId,
            grants: [...beforeGrants].map(([itemId, before]) => ({ itemId, units: receivedCount(itemId) - before }))
              .filter(g => g.units > 0),
          })
          const nameOf = (id: string): string =>
            ctx.modules.get(id)?.name ??
            ctx.blueprints.get(id)?.name ??
            ctx.shipBlueprints.get(id)?.name ??
            ctx.items.get(id)?.name ??
            id
          /**
           * **产物清单要带数量**（**2026-09-24 船长令**：「拆解货柜的事件日志内，要显示获得的物品数量
           * （比如奢侈品）」）。原先只报名字（「得到 奢侈品」）⇒ 玩家看不出这一箱拿了多少。
           *
           * 归并口径：按 id 合并（一箱可能同型多件——军用柜 1~3 件 MK3 可以重样），数量取 `units` 之和
           * （物品类 = 实得件数：奢侈品一叠 5~30 件、族专属无人机 ×10；装备/图纸类 `units` 恒 1
           * ⇒ 合计即"同型几件"）。**数量恒显示**（`×N`），不再出现"只报名字"的写法。
           */
          const agg: Array<{ itemId: string; n: number }> = []
          for (const g of grants) {
            const n = Math.max(1, Math.floor(g.units))
            const hit = agg.find((x) => x.itemId === g.itemId)
            if (hit) hit.n += n
            else agg.push({ itemId: g.itemId, n })
          }
          const drawnName = agg.map((x) => `${nameOf(x.itemId)} ×${x.n}`).join('、')
          /**
           * 来源后缀：让玩家一眼看出这一箱走的是哪条池（族专属 / 一次性 / 永久 / 奢侈品 / MK3）。
           * ⚠ **保留「（奢侈品）」那一条**：十款奢侈品的**名字各不相同**（星港陈酿 / 贵族香料 / 星图真迹…），
           * 单看名字看不出它是"纯贸易品"，这个后缀有信息量（2026-09-24 一度想去掉，核对数据后保留）。
           */
          const srcTag =
            drawn.source === 'permanent'
              ? '（永久图纸）'
              : drawn.source === 'once'
                ? '（一次性图纸）'
                : drawn.source === 'valuables'
                  ? '（奢侈品）'
                  : drawn.source === 'military'
                    ? '（MK3 装备）'
                    : '（族专属）'
          addLog(state, 'industry', `📦 拆解 ${def.name}：得到 ${drawnName}${srcTag}。`, 'core.industry.035', { p1: def.name, p2: drawnName, p3: srcTag })
        } else {
          onUnboxResult?.({ boxItemId: r.itemId, grants: [] })
          if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
          state.refineRuns.splice(i, 1)
          addLog(state, 'industry', `📦 拆解 ${def.name}：这批料没有产出，已停这一台。`, 'core.industry.036', { p1: def.name })
          break
        }
      } else if (isRecycle && profile) {
        // B3 残骸回收批：保底矿物（体积当量 × 危险度池） + 彩头（基础件/低安 MK2/蓝图碎片）；
        // 所得同时累计进 r.recAcc（停炉/结束日志出明细）
        const acc = r.recAcc ?? { min: {}, mod: {}, frag: {} }
        const volumeM3 = qty * def.unitM3
        // 谜质科技「残骸解析技术」：抬**保底原材料**产出（船长 2026-09-19；概率彩头/碎片/高级箱一律不动）
        const guaranteeMul = 1 + matterTechWreckYield(state, ctx)
        const outRaw = rollRecycleGuarantee(state, ctx, profile, volumeM3)
        const out = guaranteeMul > 1 ? outRaw.map((r) => ({ ...r, units: ceilFinalQuantity(r.units * guaranteeMul) })) : outRaw
        for (const row of out) addWare(state, row.mineralId, row.units)
        batchIncome += out.reduce((s, row) => s + row.units * (ctx.items.get(row.mineralId)?.baseSellPriceIsk ?? 0), 0)
        // 稀有残骸专属：累计已烧体积跨过 `RARE_UNIT_M3`（30 m³）的每一个整数倍，都**必给**一次彩头
        // （2026-09-11 船长定：「每次回收 30 立方米，每次必给彩头」——照普通回收机制走，只把彩头概率提到 100%）。
        const burnedBefore = isRareWreck(r.itemId) ? (state.rareBurnUnits[r.itemId] ?? 0) : 0
        const burnedAfter = burnedBefore + qty
        const rarePayout = profile.rare === true && Math.floor(burnedAfter / RARE_UNIT_M3) > Math.floor(burnedBefore / RARE_UNIT_M3)
        if (rarePayout) {
          /**
           * **开箱账本 ＋ 里程碑计数**（成就系统第二批 · 船长 2026-09-20）。
           *
           * ⚠ **这里补掉一处真缺陷**：`state.rareBoxesOpened`（该型残骸"累计已开箱数"）此前
           * **全仓没有任何业务写入点**——只有读档清洗、初始化与两条测试在写它 ⇒ 那本账一直空转
           * （`state.ts` 的注释与 `save.ts` 的迁移清单都把它当"已在维护的账本"）。本批在
           * **全仓唯一的出箱点**（`rarePayout` = "烧满 30 m³ 必给一次彩头"）补上写入，
           * 顺带把**全局累计**记进 `firstStats.rareBoxes` 供里程碑读取。
           * 口径：`rarePayout` 一次 = **一箱**（稀有残骸每满 `RARE_UNIT_M3` 必给彩头 ⇒ 1:1）。
           */
          if (r.itemId) state.rareBoxesOpened[r.itemId] = (state.rareBoxesOpened[r.itemId] ?? 0) + 1
          bumpFirst(state, 'rareBoxes')
          // 主题件回落池：**2026-09-24 船长令**（「洞内残骸未命中则从 MK2 和 MK3 里抽，MK3 权重降为 0.25」）
          // ⇒ 洞内改走**带权重的两组池**（MK2 w=1 / MK3 w=0.25 ⇒ 出 MK3 实际 20%）；洞外两组皆空 ⇒ 走各族 theme。
          const extra = rollRareBoxExtra(
            state,
            ctx,
            profile,
            wormholeRareBoxThemePoolOf(ctx, profile.region),
            wormholeRareBoxThemeGroupsOf(ctx, profile.region),
          )
          if (extra) {
            for (const modId of extra.modules) {
              state.moduleBay[modId] = (state.moduleBay[modId] ?? 0) + 1
              acc.mod[modId] = (acc.mod[modId] ?? 0) + 1
              for (const g of ctx.marketGoods.values()) {
                if (g.kind === 'module' && g.refId === modId) {
                  batchIncome += g.basePrice ?? 0
                  break
                }
              }
            }
            for (const row of extra.drones) {
              // 专属无人机（2026-09-10 船长）：一次 RARE_BOX_DRONE_UNITS 架进物品仓库（消耗品，非装备）
              addWare(state, row.id, row.count)
              acc.drone = acc.drone ?? {}
              acc.drone[row.id] = (acc.drone[row.id] ?? 0) + row.count
              batchIncome += row.count * (ctx.items.get(row.id)?.baseSellPriceIsk ?? 0)
            }
            for (const bpId of extra.blueprints) {
              // 专属无人机的一次性图纸（2026-09-14 船长）：进**蓝图书架**（到组装机开工，一次出 50 架）
              state.blueprintStock[bpId] = (state.blueprintStock[bpId] ?? 0) + 1
              acc.blueprint = acc.blueprint ?? {}
              acc.blueprint[bpId] = (acc.blueprint[bpId] ?? 0) + 1
              for (const g of ctx.marketGoods.values()) {
                if (g.kind === 'blueprint' && g.refId === bpId) {
                  batchIncome += g.basePrice ?? 0
                  break
                }
              }
            }
            for (const row of extra.minerals) {
              addWare(state, row.mineralId, row.units)
              acc.min[row.mineralId] = (acc.min[row.mineralId] ?? 0) + row.units
              batchIncome += row.units * (ctx.items.get(row.mineralId)?.baseSellPriceIsk ?? 0)
            }
            addLog(state, 'industry', `✦ 额外战利品：稀有残骸解体必给——${extra.note}。`, 'core.industry.037', { p1: extra.note })
          }
        }
        const loot = rollRecycleLoot(state, ctx, profile, qty)
        for (const modId of loot.modules) state.moduleBay[modId] = (state.moduleBay[modId] ?? 0) + 1
        const modCount = new Map<string, number>()
        for (const m of loot.modules) modCount.set(m, (modCount.get(m) ?? 0) + 1)
        for (const [modId, n] of modCount) {
          for (const g of ctx.marketGoods.values()) {
            if (g.kind === 'module' && g.refId === modId) {
              batchIncome += n * (g.basePrice ?? 0)
              break
            }
          }
        }
        const fragUnits = new Map<string, number>()
        for (const m of loot.fragments) fragUnits.set(m, (fragUnits.get(m) ?? 0) + 1)
        for (const [m, n] of fragUnits) addWare(state, fragmentItemIdOf(m), n)
        for (const row of out) acc.min[row.mineralId] = (acc.min[row.mineralId] ?? 0) + row.units
        for (const modId of loot.modules) acc.mod[modId] = (acc.mod[modId] ?? 0) + 1
        for (const [m, n] of fragUnits) acc.frag[m] = (acc.frag[m] ?? 0) + n
        /**
         * **R 族残骸回收的 AI 核心**（**船长 2026-10-01 令**：「**AI 核心为 R 族残骸回收的特色**」＋
         * 追问裁定「核心结算方式…如果是〔回收时抽中〕，**直接入账**」）。
         *
         * 2026-10-04：只在 R 族稀有残骸掷一次（10%，命中后 60/30/10）；抽中直接进核心账本，普通残骸不出。
         * （**不进仓库** —— 核心是一本账，见 `marketCatalog.ts` 那条硬契约），并推一条日志。
         * 掷骰走**独立流**（`rollRecycleCoreGain`，种子含残骸 id ＋ 批序号）⇒ 既有各族的回收产出
         * **逐字不变**；批序号 = 本炉已完批数 + 1（每批唯一、同一档可复现）。
         */
        const coreGain = rollRecycleCoreGain(r.itemId ?? '', r.batchesDone + 1)
        if (coreGain !== undefined) {
          gainAiCore(state, coreGain, 1)
          const coreName = aiCoreName(coreGain)
          addLog(state, 'industry', `✦ 额外产出：${coreName} ×1。`, 'core.industry.045', {
            p1: coreName,
            p2: '1',
          })
        }
        r.recAcc = acc
      } else {
        // 精炼批：产物矿物入库，并累计进 r.recAcc.min（停炉/结束日志出明细）
        const acc = r.recAcc ?? { min: {}, mod: {}, frag: {} }
        // ⚠ 产出算式 = core 单点 `refineBatchOutputOf`（界面悬停卡读同一支 ⇒ 结算与读数不会漂）
        for (const out of refineBatchOutputOf(state, ctx, def, qty)) {
          const mineral = ctx.items.get(out.mineralId)
          addWare(state, out.mineralId, out.units)
          acc.min[out.mineralId] = (acc.min[out.mineralId] ?? 0) + out.units
          batchIncome += out.units * (mineral?.baseSellPriceIsk ?? 0)
        }
        r.recAcc = acc
      }
      // 「一个回收单元 = 一箱」账本（2026-09-11 修订）：开箱时**整单元记账**（上面那处），
      // 收工/停炉时按**实际烧掉的量**把没烧到的部分扣回（见 `refundClaimedUnits`）。
      // 原先在批末逐批核销会让"停炉一次 = 永久少记一整个单元的余料"，余料于是越攒越开不出箱。
      if (r.worker !== 'pilot' && stats) {
        addAiRefineBatch(stats, r.worker, isRecycle)
        if (batchIncome > 0) addAiIncome(stats, r.worker, batchIncome)
      }
      r.batchesDone += 1
      // 「第一次操作精炼炉」与「精炼师」链：**精炼炉**出一批料记一批。
      // ⚠ 2026-09-17 修（教程重做批自查）：原先这行被落在上面的**残骸回收**分支里 ⇒
      //   真正的精炼出料没记、回收反而记了，与任务文案（「让精炼炉出一批料」）对不上。
      //   口径 = 只认精炼炉（残骸回收炉是同一页里的另一台炉，不计入本计数）。
      if (!isRecycle) bumpFirst(state, 'refineBatches')
      if (isRecycle && r.itemId) {
        // 累计已烧体积（稀有残骸每满 30 m³ 必给一次彩头的账本；随存档落盘，起停不重置）
        state.rareBurnUnits[r.itemId] = (state.rareBurnUnits[r.itemId] ?? 0) + qty
      }
      r.finishAtGameMs += r.cycleMs // 下一批到点；届时若余料耗尽/不足一批由上方分支自动停炉
      /**
       * **本批吃完就当场收工，不空转一个批周期**（2026-09-11 玩家反馈「稀有残骸空了精炼炉还在运转」
       * 先只做了私有料账那一档；**2026-09-15 船长报障**「拆解完毕后，货柜为 0 时还是会进行一次拆解」
       * ⇒ 推广到**全部产线**）：私有料账吃完、或公共库存已凑不够下一批（0 / 不足一批）⇒ 把到点时间
       * 拨到"现在"，下一轮循环立刻进上方的「原料耗尽 / 余量不足一批」分支停炉（日志口径不变、只提前）。
       * 口径依据：2026-09-06 船长拍板「余量不足即停工、余料保留，凑够一批再开」。
       */
      const nextUsesClaim = r.claimedUnits !== undefined
      const nextStock = nextUsesClaim ? Math.max(0, r.claimedUnits ?? 0) : industryAvailable(state, ctx, r.itemId)
      const nextAvail = r.lockUnits !== undefined ? Math.min(nextStock, r.lockUnits) : nextStock
      if (nextAvail < r.batchUnits) {
        r.finishAtGameMs = state.gameMs
        continue
      }
    }
  }
}
