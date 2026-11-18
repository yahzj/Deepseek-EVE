import { calcBuildDurationMs, countWare, manufacturingLoopOf, manufacturingRunViews, marketLockedReason, matNeedCount, missingMaterials, ownsBlueprint, usableAiCoresOf, recipeCapability, canStartBlueprint, WORMHOLE_SCAN_UNLOCK_STANDING, standingOf, DSI_FACTION_ID, materialDisplayIdOf, materialGroupIdsOf } from '@whale/core'
import { bestAiCoreOf } from '@whale/core'
import type { AiCoreType, MaterialNeed } from '@whale/core'
import { memo, useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { GameEngine } from '../../game/engine'
import type { ToastFn } from '../../pages/common'
import { MarkStar } from '../../ui/marks'
import { aiCoreText, kindLabelText, ownedWhereText } from '../../ui/labelsText'
import { RowGlyph } from '../../ui/itemView'
import { GoodsLine, marginPctOf, marketPriceOf, NetIncomeLine } from '../../ui/yieldView'
import { MatSourceLink } from '../../ui/matSourceLink'
import { MATS_COLLAPSE_OVER, MatListToggle } from '../../ui/matList'
import { AiCoreSelect } from '../../ui/aiCoreSelect'
import { useLoopGoalDraft } from '../../ui/useLoopGoalDraft'
import { cmdText } from '../../i18n/locale'
import { tr } from '../../i18n/locale'
import { fmtDuration } from '../../i18n/fmt'
import { bpGoodKey } from './blueprintValue'
import { factionPlugBlueprintKind, isWormholeBlueprint, manualBuildNote } from './blueprintPolicy'

export const BlueprintCard = memo(function BlueprintCard({
  engine,
  onToast,
  blueprintId,
  name,
  description,
  materials,
  buildSeconds,
  productLabel,
  productNode,
  kindLabel,
  productGlyph,
  productTone,
  productRef,
  productUnits,
  countOwned,
  ownedWhere,
  onNeedMineral,
  onGotoMarket,
  onGotoWormhole,
  onGotoPlugExchange,
  onGotoShelf,
  highlighted,
  learnless,
}: {
  engine: GameEngine
  onToast: ToastFn
  blueprintId: string
  name: string
  description: string
  materials: readonly MaterialNeed[]
  buildSeconds: number
  productLabel: string
  productNode?: ReactNode
  kindLabel: string
  productGlyph: string
  productTone?: string
  productBase: number
  productRef?: { kind: 'module' | 'ship' | 'item'; refId: string }
  productUnits?: number
  countOwned: () => number
  ownedWhere: string
  onNeedMineral?: (itemId: string) => void
  onGotoMarket?: (goodKey: string) => void
  onGotoWormhole?: () => void
  onGotoPlugExchange?: () => void
  onGotoShelf?: (blueprintId: string) => void
  highlighted?: boolean
  learnless?: boolean
  liveKey?: string
}) {
  const state = engine.state
  const runs = manufacturingRunViews(state, engine.ctx).filter((v) => v.blueprintId === blueprintId)
  const running = runs.length > 0
  const owned = learnless === true || ownsBlueprint(state, blueprintId)
  const spec = { materials, buildSeconds, buildCostIsk: 0 }
  const buildMs = calcBuildDurationMs(state, engine.ctx, spec)
  const bookCount = state.blueprintStock[blueprintId] ?? 0
  const bpDef = engine.ctx.blueprints.get(blueprintId) ?? engine.ctx.shipBlueprints.get(blueprintId)
  const singleUse = bpDef?.singleUse === true
  const cap = recipeCapability(state, blueprintId, singleUse)
  const canBuild = canStartBlueprint(state, engine.ctx, blueprintId)
  const oneTimeNote = !singleUse
    ? null
    : owned
      ? tr("ui.Industry.028")
      : cap.kind === 'exhausted'
        ? tr("ui.Industry.029")
        : cap.kind !== 'ok'
          ? tr("ui.Industry.030")
          : null
  const short = missingMaterials(state, engine.ctx, spec)
  const ownedCount = countOwned()
  const goodKey = bpGoodKey(engine, blueprintId)
  const lock = !owned && goodKey ? marketLockedReason(state, engine.ctx, goodKey) : null
  const bookBuyable = goodKey !== null && engine.ctx.marketGoods.get(goodKey)?.playerBuyable !== false
  const blackMarketBlueprint = !bookBuyable && goodKey !== null && engine.ctx.marketGoods.get(goodKey)?.blackMarketBuyable === true
    && engine.ctx.marketGoods.get(goodKey)?.playerSellable === false
  const factionPlugKind = factionPlugBlueprintKind(engine.ctx, blueprintId)
  const whBlueprint = isWormholeBlueprint(blueprintId) || factionPlugKind === 'single'
  const plugBlueprint =
    engine.ctx.modules.get(engine.ctx.blueprints.get(blueprintId)?.moduleId ?? '')?.slot === 'plug' && factionPlugKind === null
  const whStanding = standingOf(state, DSI_FACTION_ID)
  const whUnlocked = whStanding >= WORMHOLE_SCAN_UNLOCK_STANDING
  const [coreSel, setCoreSel] = useState<AiCoreType>(() => bestAiCoreOf(state) ?? 'basic')
  const usableCores = usableAiCoresOf(state)
  const core = usableCores.includes(coreSel) ? coreSel : (usableCores[0] ?? null)
  const manualNote = manualBuildNote(state, engine)

  function handleGotoMarket(): void {
    if (!goodKey) {
      onToast(tr("ui.Industry.100"), true)
      return
    }
    if (!onGotoMarket) {
      onToast(tr("ui.Industry.101"), true)
      return
    }
    onGotoMarket(goodKey)
  }

  function handleGotoWormhole(): void {
    if (!whUnlocked) {
      onToast(tr("ui.Industry.102", { WORMHOLE_SCAN_UNLOCK_STANDING: WORMHOLE_SCAN_UNLOCK_STANDING, whStanding: whStanding }), true)
      return
    }
    if (!onGotoWormhole) {
      onToast(tr("ui.Industry.103"), true)
      return
    }
    onGotoWormhole()
  }

  function handleLearnFromShelf(): void {
    const r = engine.learnBlueprintAt(blueprintId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Industry.130'), true)
    else onToast(tr("ui.Industry.104"))
  }

  function runWith(worker: AiCoreType | 'pilot'): void {
    const r = engine.startManufacturingAt(blueprintId, worker)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.Industry.131'), true)
      return
    }
    if (r.queued) { onToast(tr('core.busy.020')); return }
    onToast(
      worker === 'pilot'
        ? tr("ui.Industry.031")
        : tr("ui.Industry.105", { p1: aiCoreText(worker) }),
    )
  }

  function handleCancel(runId: number): void {
    const r = engine.cancelManufacturingAt(runId)
    if (!r.ok) onToast(r.error ?? tr('ui.Industry.132'), true)
    else
      onToast(
        tr('ui.Industry.157'),
      )
  }

  const loop = manufacturingLoopOf(state, blueprintId)
  const { draft: goalDraft, typeDraft, clearDraft, clearTouched } = useLoopGoalDraft((n) =>
    engine.setManufacturingLoopAt(blueprintId, true, n),
  )
  const matsListId = useId()
  const [matsOpen, setMatsOpen] = useState(false)
  const matsCollapsible = materials.length > MATS_COLLAPSE_OVER
  function commitLoop(on: boolean, goalText: string): void {
    clearTouched()
    const n = Number.parseInt(goalText, 10)
    const goal = Number.isFinite(n) && n > 0 ? n : null
    const r = engine.setManufacturingLoopAt(blueprintId, on, on ? goal : null)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Industry.133'), true)
  }

  const feedTxt = short.length > 0 ? short.join('；') : ''
  const manualTitle =
    manualNote ??
    feedTxt ??
    (running
      ? tr("ui.Industry.032")
      : tr("ui.Industry.033"))
  const aiTitle = feedTxt
    ? feedTxt
    : core
      ? running
        ? tr("ui.Industry.034")
        : tr("ui.Industry.035")
      : tr("ui.Industry.036")

  return (
    <div className={`app-belt-card is-assembler${highlighted ? ' is-goto' : ''}`}>
      <div className="app-belt-head">
        <span className="app-belt-name">
          <RowGlyph glyph={productGlyph} tone={productTone} /> {name}
          {running ? (
            <em className="app-belt-flag is-run">
              {kindLabel === '舰船' ? tr("ui.Industry.037") : tr("ui.Industry.038")} {/* l10n-keep：kindLabel 是内容层联合 key（不是文案），渲染处照 id 取词 */}
              {runs.length > 1 ? ` ×${runs.length}` : ''}
            </em>
          ) : null}
        </span>
        {/* 卡头右侧：标记星标（2026-09-10 船长） + 状态徽标（已学会/蓝图书存量/市场门槛提示/类型）
            ⚠ 「市场门槛」这枚**只是提示**（2026-09-14 船长：组装机不再用声望挡启动）——它不挡任何按钮 */}
        <span className="app-belt-head-right">
          <MarkStar engine={engine} kind="blueprints" id={blueprintId} />
          {learnless ? (
            <span className="app-chip" title={tr('ui.Industry.144')}>
              {tr('ui.Industry.145')}
            </span>
          ) : owned ? (
            <span className="app-chip">{tr('ui.Industry.039')}</span>
          ) : singleUse && bookCount > 0 ? (
            <span className="app-chip is-stock" title={tr("ui.Industry.040")}>
              {tr("ui.Industry.041")}{bookCount}
            </span>
          ) : bookCount > 0 ? (
            <span className="app-chip">{tr("ui.Industry.042")}{bookCount}</span>
          ) : lock ? (
            <span className="app-chip is-exotic" title={tr("ui.Industry.107", { lock: lock })}>
              ✕ {lock}
            </span>
          ) : (
            <span className="app-chip">{kindLabelText(kindLabel)}</span>
          )}
        </span>
      </div>
      <div className="app-belt-desc">{description}</div>

      <div className="app-belt-ore">
        {tr("ui.Handbook.013")}{productNode ?? productLabel}
        <span className="app-dim" title={tr("ui.Industry.108", { ownedWhere: ownedWhereText(ownedWhere) })}>
          （{ownedWhereText(ownedWhere)} {ownedCount.toLocaleString('zh-CN')}）
        </span>
        {running ? (
          <>
            {' '}
            {tr('ui.Industry.121', { n: runs.length })} {tr("ui.Industry.043")} {fmtDuration(Math.min(...runs.map((v) => v.remainingMs)))} {tr("ui.Industry.044")}
          </>
        ) : (
          <>{tr('ui.Industry.122', { d: fmtDuration(buildMs) })}{tr("ui.Industry.045")}</>
        )}
      </div>
      <ul className="app-bp-mats" id={matsListId}>
        {/* 原材料列表折叠（2026-10-01 船长令：味数 > 2 ⇒ 只留这一行开关，点开才拉开全部） */}
        {matsCollapsible ? (
          <MatListToggle
            count={materials.length}
            open={matsOpen}
            shortCount={short.length}
            running={running}
            listId={matsListId}
            onToggle={() => setMatsOpen((v) => !v)}
          />
        ) : null}
        {matsCollapsible && !matsOpen
          ? null
          : materials.map((need) => {
          const needCount = matNeedCount(state, need.count, blueprintId) // 预览与实际投料共用需求
          /**
           * **等价组**（**2026-09-29 船长报障**：「组装机中，舰船插件材料消耗列表中还是显示了墨潮黑匣
           * （**应该显示通用黑匣**）」）：
           * ① **名字**按 `materialDisplayIdOf`（有哪种报哪种、都没有报组内第一种 = 通用黑匣）；
           * ② **"现有"读数与缺口判据按组内合计**（`materialGroupIdsOf`）——与开工真扣料、
           *    与引擎的缺料提示**同一把尺**（此前这里只数"配方写的那个 id"，手上全是通用黑匣时
           *    会被误判成缺料、且行名写着旗舰黑匣）；
           * ③ 组内多于一种时补一句**分项**（`现有 3（通用 1 · 其他 2）`），换装/换料前看得清手里是什么。
           */
          const groupIds = materialGroupIdsOf(need.itemId)
          const displayId = materialDisplayIdOf(state, need.itemId)
          const have = groupIds.reduce((sum, id) => sum + countWare(state, id), 0)
          const enough = have >= needCount
          const matName = engine.ctx.items.get(displayId)?.name ?? displayId
          const split =
            groupIds.length > 1
              ? groupIds
                  .map((id) => ({ id, n: countWare(state, id) }))
                  .filter((x) => x.n > 0)
                  .map((x) => `${engine.ctx.items.get(x.id)?.name ?? x.id} ${x.n.toLocaleString('zh-CN')}`)
                  .join(tr('ui.MatterTechTab.017'))
              : ''
          // 空闲态才标红缺口；制造中仓库余量只影响「加开一条线」，红色会误读成故障
          return (
            <li key={need.itemId} className={`app-bp-mat${!enough && !running ? ' is-short' : ''}`}>
              {matName} ×{needCount.toLocaleString('zh-CN')}
              {needCount !== need.count ? (
                <span className="app-dim">{tr("ui.Industry.046")}{need.count.toLocaleString('zh-CN')}{tr('ui.Industry.123')}</span>
              ) : null}
              <span className="app-dim">
                {tr("ui.IndustryPage.029")} {have.toLocaleString('zh-CN')}
                {split !== '' ? `（${split}）` : ''}）
              </span>
              {/* 2026-09-22 船长令：「组装机和造船厂需要零件时，提示不是去组装机，而是去市场」⇒
                 「希望提示玩家去组装机生产零件，不要提示去市场」＋「高级零件依旧去相应的组装机」。
                 四支（优先级从上到下）：**声望商店有 ⇒ 去声望商店** · 有精炼源 ⇒ 去精炼炉 ·
                 **能在这台机器上造出来（如零件）⇒ 去组装机** · 既炼不出也造不出 ⇒ 去市场。
                 文案按 §十三.5 不写原因解释（旧文案那句「无法经精炼炉产出」属解释，已随本次改写删掉）。
                 ⚠ **新增第一支的由来**（**2026-09-29 船长报障**）：「通用黑匣」只有章鱼人声望商店
                 一条来路（市场**只收不卖**、价格表里没有它的卖单）⇒ 原先落进第四支、显示
                 「要到市场购买——点击跳转」是**指错路**（点过去只会看到一个空行情）。
                 ⚠ 判据按**等价组**（`groupIds.includes(通用黑匣)`）而不是 `need.itemId === …`：
                 配方里写的是 `blackbox-h`，直接比 id 永远不成立（实测踩到，读数照旧"去市场"）。
                 **2026-10-01**：这四支连同 `refineSourcesOf` 已搬进公共件 `ui/matSourceLink.tsx`
                 （实验室卡要对齐同一套 ⇒ 两处各写一份必然漂），本卡行为逐字不变。 */}
              <MatSourceLink
                engine={engine}
                itemId={need.itemId}
                matName={matName}
                groupIds={groupIds}
                onNeedMineral={onNeedMineral}
                onGotoPlugExchange={onGotoPlugExchange}
              />
            </li>
          )
        })}
      </ul>
      <div className="app-belt-econ">
        <div>
          {tr("ui.Industry.049")}
          {running && feedTxt ? <span className="app-dim">{tr("ui.Industry.050")}</span> : null}
        </div>
        {/**
         * **产物读数换口径**（**2026-09-23 船长令**）：「各个有收益的卡牌上写着的收入预估…会严重误导玩家……
         * **如果是装备和舰船的话，就单纯显示市场当前价格**」⇒ 原「净 ≈N 信用点/h」（产物基准价 − 材料收价
         * 折算每小时）**整段删掉**，改为**产物当前行情价**一行（取数与市场页同源，见 `ui/yieldView.tsx`）。
         */}
        {productRef !== undefined
          ? (() => {
              const price = marketPriceOf(state, engine.ctx, productRef.refId)
              /** 材料成本按**当前行情价**（取不到行情的材料回落物品基准价），与产物行情同一把尺 */
              const matCost = materials.reduce(
                (sum, m) =>
                  sum +
                  matNeedCount(state, m.count, blueprintId) *
                    (marketPriceOf(state, engine.ctx, m.itemId) ?? engine.ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0),
                0,
              )
              /**
               * **利润率按"整批"算**（船长 2026-09-24 报障：「组装机是一次性生产 10 个的，现在的利润只计算
               * 一个」）：`materials` 是整批的料 ⇒ 收入必须 `单价 × 一次产出件数`（零件 10 / 消耗品 N 发 /
               * 装备与舰船 1）。卡面显示的行情价仍是**每单位**（与市场页折线图同尺）。
               */
              return (
                <>
                  <GoodsLine
                    name={productLabel}
                    price={price}
                    marginPct={marginPctOf(price, matCost, productUnits ?? 1)}
                    unitsPerRun={productUnits ?? 1}
                  />
                  {/* **净收益/h**（**2026-09-29 船长令**：只在调试模式下显示）——与上面那行同一把尺 */}
                  <NetIncomeLine price={price} costIsk={matCost} buildMs={buildMs} unitsPerRun={productUnits ?? 1} />
                </>
              )
            })()
          : null}
      </div>

      <div className="app-belt-actions">
        {/* 循环制造（2026-09-10 船长定：开关与目标批数**单独领出来挂在生产卡上**，不再逐线各一份）——
            作用于本卡全部制造线（含主控亲自那条），新开的线自动继承；目标批数 = 全卡合计口径（2026-09-18 船长定：按「批」不按件） */}
        {/* 一次性图纸不循环**（2026-09-12 船长：「只能制造一次」）⇒ 该开关对它不适用，整块不渲染 */}
        {(owned || running) && !singleUse ? (
          <div className="app-belt-loop">
            <label
              className="app-toggle"
              title={tr("ui.Industry.112", { p1: loop.on ? tr("ui.Industry.055") : tr("ui.Industry.056") })}
            >
              <input
                type="checkbox"
                className="app-toggle-input"
                checked={loop.on}
                onChange={(e) => commitLoop(e.target.checked, e.target.checked ? (goalDraft || (loop.goal > 0 ? String(loop.goal) : '')) : '')}
              />
              <span className="app-toggle-track" aria-hidden="true" />
              <span className="app-toggle-label">{tr("ui.Industry.057")}</span>
            </label>
            {loop.on ? (
              <span className="app-mf-goal">
                {tr("ui.Industry.058")}
                <input
                  type="number"
                  min={1}
                  className="app-mf-goal-input"
                  placeholder="∞"
                  value={goalDraft !== '' ? goalDraft : loop.goal > 0 ? String(loop.goal) : ''}
                  onChange={(e) => typeDraft(e.target.value)}
                  onBlur={(e) => {
                    clearDraft()
                    commitLoop(true, e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      clearDraft()
                      commitLoop(true, (e.target as HTMLInputElement).value)
                    }
                  }}
                  title={tr("ui.Industry.059")}
                />
                {tr('ui.MarketPage.117')}<em className="app-dim">{tr("ui.Industry.060")}</em>
              </span>
            ) : null}
            {loop.produced > 0 ? <span className="app-mf-made">{tr("ui.Industry.061")} {loop.produced.toLocaleString('zh-CN')} {tr('ui.MarketPage.117')}</span> : null}
            {loop.stopWhy.length > 0 ? <span className="app-mf-why">{tr("ui.Industry.062")}{loop.stopWhy}</span> : null}
            <span className="app-dim app-mf-note">
              {tr("ui.Industry.063")}{runs.length > 0 ? tr("ui.Industry.113", { p1: runs.length }) : ''}
            </span>
          </div>
        ) : null}
        {/* 该蓝图逐条制造线名册（每行：劳动者 + 剩余 + 进度 + 取消）——精炼炉运转名册同款结构；
            2026-09-10 起循环开关已在卡片级，行内不再各带一份 */}
        {runs.length > 0 ? (
          <div className="app-belt-workers" style={{ marginTop: 'var(--wui-sp-2)' }}>
            {runs.map((v) => (
              <span key={v.id} className="app-belt-worker">
                <span
                  className="app-belt-worker-name"
                  // l10n-keep：下面比较用的 kindLabel（'舰船'/'装备'/'消耗品'）是**内容层联合 key**，不是文案
                  title={tr("ui.Industry.114", { p1: fmtDuration(v.durationMs), p2: kindLabel === '舰船' ? tr("ui.Industry.064") : tr("ui.Industry.065"), p3: v.worker === null ? tr("ui.Industry.066") : '' })}
                >
                  {v.worker === null ? tr("ui.Industry.067") : v.worker === 'pilot' ? tr("ui.Industry.068") : tr("ui.Industry.115", { p1: v.workerLabel })}
                  {tr('ui.Industry.137', { p1: fmtDuration(v.remainingMs) })}
                </span>
                <span className="app-progress-mini" title={tr("ui.Industry.116", { p1: v.percent })}>
                  <i style={{ width: `${v.percent}%` }} />
                </span>
                <button
                  className="app-btn is-small is-warn"
                  onClick={() => handleCancel(v.id)}
                  title={tr('ui.Industry.147')}
                >
                  {tr("ui.Industry.070")}
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {canBuild ? (
          <>
            <button
              className="app-btn is-small is-primary"
              disabled={manualNote !== null || short.length > 0}
              title={oneTimeNote ?? manualTitle}
              onClick={() => runWith('pilot')}
            >
              {tr("ui.Industry.071")}
            </button>
            {/* AI 工位：核心下拉常驻（无可用核心时置灰并在控件里写明，卡面不跳动；船长 2026-09-10）——
                2026-10-02 起走公共件 `ui/aiCoreSelect.tsx`（行为与旧实现逐字一致） */}
            <div className="app-belt-ai">
              <AiCoreSelect
                engine={engine}
                value={core}
                onPick={setCoreSel}
                titleReady={tr("ui.Industry.072")}
                titleEmpty={tr("ui.IndustryPage.051")}
                emptyLabel={tr("ui.ShipPage.070")}
              />
              <button
                className="app-btn is-small"
                disabled={!core || short.length > 0}
                title={oneTimeNote ?? (core ? aiTitle : tr("ui.IndustryPage.055"))}
                onClick={() => core && runWith(core)}
              >
                {tr("ui.Industry.073")}
              </button>
            </div>
          </>
        ) : !singleUse && bookCount > 0 ? (
          /* 书已在书架（尚未学习）：就地学习（2026-09-14 船长裁定「乙」）——与「蓝图书架」的「学习」
             同一个引擎出口与话术；书不消耗、也不占制造位。
             ⚠ 顺序上提到「去哪买/去哪捞」之前：手里有书就该先能学（这正是上一批"拿着书却只看到需要声望"的坑）。 */
          <>
            <button
              className="app-btn is-small"
              title={tr("ui.Industry.117", { bookCount: bookCount })}
              onClick={handleLearnFromShelf}
            >
              {tr("ui.Industry.074")}
            </button>
            {/**
             * **反向入口「去书架」**（**2026-09-26 船长令**：「优化工业界面」→ 采纳"优3"）。
             * 书架那边一直有「去组装机」，反向没有 ⇒ 玩家在组装机看到"手上有 2 本书"却只能自己切子页。
             * 落款是**次级按钮**（主行动仍是左边的「学习」），点了切到蓝图书架并把这一本高亮居中。
             */}
            {onGotoShelf ? (
              <button
                className="app-btn is-small"
                title={tr('ui.IndustryPage.132')}
                onClick={() => onGotoShelf(blueprintId)}
              >
                {tr('ui.IndustryPage.131')}
              </button>
            ) : null}
          </>
        ) : blackMarketBlueprint ? (
          <span className="app-dim">{tr('ui.ammoMk3.001')}</span>
        ) : plugBlueprint ? (
          /**
           * **舰船插件图纸 ⇒ 去声望商店兑换**（**2026-09-26 船长令**：「**没有蓝图的舰船插件组装机应该
           * 显示去商店兑换，点击后跳转到章鱼人声望商店。而不是无市场渠道（本来就不在市场购买）**」
           * ＋（同日改口）「**组装机这边不应该是前往章鱼人兑换，而是前往声望商店兑换**」）。
           *
           * 为什么必须排在这里：这类图的产物插件**从来不在市场卖**（`playerBuyable: false`）⇒
           * `bookBuyable` 恒假 ⇒ 原先会掉进最后一支兜底的「**✕ 无市场渠道**」死路（船长点名的就是它）。
           * 落款用 `ui.IndustryPage.126`（「前往声望商店兑换」）——**与通讯里那句分开**：
           * 通讯是章鱼人主动发信、口吻是"来我这儿"，组装机是玩家在工业页看图纸 ⇒ 说"声望商店"更准。
           */
          <button
            className="app-btn is-small is-primary"
            title={tr('ui.IndustryPage.117')}
            onClick={onGotoPlugExchange}
          >
            {tr('ui.IndustryPage.126')}
          </button>
        ) : whBlueprint ? (
          /**
           * **虫洞专属图纸 ⇒ 去虫洞（遗迹打捞）**（船长 2026-09-14：「虫洞专属的蓝图市场上没有卖，建议改为
           * 跳转虫洞。**如果玩家声望不达标，就无法跳转**」）——这类图（`bp-wh-*` / `sbp-wh-*`）的市场行是
           * "只收不卖"，点「市场求购」进去也买不到 ⇒ 死路；改成跳**星图 · 出港 · 扫描虫洞**（真正能拿图的地方：
           * 洞内遗迹打捞 / 图纸货柜 / 安全货柜），并以**虫洞解锁声望**为闸（未达标一律禁用 + 写明还差多少）。
           */
          <button
            className={`app-btn is-small${whUnlocked ? ' is-primary' : ''}`}
            disabled={!whUnlocked}
            title={
              whUnlocked
                ? tr("ui.Industry.075")
                : tr("ui.Industry.118", { WORMHOLE_SCAN_UNLOCK_STANDING: WORMHOLE_SCAN_UNLOCK_STANDING, whStanding: whStanding })
            }
            onClick={handleGotoWormhole}
          >
            {whUnlocked ? tr("ui.Industry.076") : tr("ui.Industry.077")}
          </button>
        ) : singleUse && bookBuyable ? (
          /* 一次性图纸（2026-09-14 船长：「组装机的一次性蓝图制造如果没有蓝图，也改为跳转市场，
             和其他组装机一样」）——**在市场流通的一次性图纸**（`sbp-once-*`：稀有订单层 / 奇货）
             缺书与名额已用尽都只差"再拿一张图" ⇒ 一律指路市场；买不买、按什么价挂单由玩家在详情里定。 */
          <button
            className="app-btn is-small"
            title={
              cap.kind === 'exhausted'
                ? tr("ui.Industry.078")
                : tr("ui.Industry.079")
            }
            onClick={handleGotoMarket}
          >
            {tr("ui.Industry.080")}{cap.kind === 'exhausted' ? tr("ui.Industry.081") : ''}
          </button>
        ) : singleUse ? (
          /* 一次性图纸**不在市场流通**的（既非虫洞线、市场目录里也没有它）：写清唯一来源，不挂死路按钮 */
          <button
            className="app-btn is-small"
            disabled
            title={
              cap.kind === 'exhausted'
                ? tr("ui.Industry.082")
                : tr("ui.Industry.083")
            }
          >
            {cap.kind === 'exhausted' ? tr("ui.Industry.084") : tr("ui.Industry.085")}
          </button>
        ) : bookBuyable ? (
          /* 求购 = 只跳市场行情详情，不替玩家下单（2026-09-14 船长口径） */
          <button className="app-btn is-small" title={tr("ui.Industry.086")} onClick={handleGotoMarket}>
            {tr("ui.Industry.080")}
          </button>
        ) : (
          /* 市场目录里根本没有这张图（可获得的渠道不在市场）：别给死路按钮 */
          <button className="app-btn is-small" disabled title={tr("ui.Industry.087")}>
            {tr("ui.Industry.088")}
          </button>
        )}
      </div>
    </div>
  )
})
