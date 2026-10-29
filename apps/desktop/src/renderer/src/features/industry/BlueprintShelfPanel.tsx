import { marketGoodOf, ownsBlueprint } from '@whale/core'
import { RedeemFragmentButton } from '../../ui/fragmentRedeem'
import { Panel } from '@whale/ui'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { GameEngine } from '../../game/engine'
import type { ToastFn } from '../../pages/common'
import { HintIcon } from '../../ui/Hint'
import { useL10n, cmdText } from '../../i18n/locale'
import { BLUEPRINT_USE_TABS, MANU_TABS, SUB_ALL, bpFilterKeysOf, manuSubsOf, type BlueprintUseKey, type ManuTabKey } from '../../ui/itemSubs'
import { tr } from '../../i18n/locale'
import { bpGoodKey } from './blueprintValue'

/* ═══════════════ 蓝图书架（紧凑小卡网格：书+数量+状态+学习/出售；船长 2026-09-05 定形态） ═══════════════ */

/** 蓝图书架：持有的蓝图书（学习 → 永久学会；多余的书市价出售） */
export function BlueprintShelfPanel({
  engine,
  onToast,
  onGotoCraft,
  onGotoMarket,
  focusBookId,
}: {
  engine: GameEngine
  onToast: ToastFn
  /** 「去组装机」：切到组装机标签并定位那张蓝图卡（船长 2026-09-14：「蓝图书架内，玩家可以通过蓝图
   *  直接跳转对应组装机」）——由工业页透传（跳转时会**清掉组装机的三级筛选**，否则目标卡可能被筛掉） */
  onGotoCraft?: (blueprintId: string) => void
  /** 打开该蓝图市场详情；这里只导航，不出售或扣书。 */
  onGotoMarket?: (goodKey: string) => void
  /** **反向定位**（**2026-09-26 船长令**：「优化工业界面」→ 采纳"优3"）：组装机那边点「去书架」
   *  跳过来时，这一本要高亮（页面层同一套 `.app-belt-card.is-goto` ＋ 居中滚动）。 */
  focusBookId?: string | null
}) {
  const state = engine.state
  useL10n()
  const entries = Object.entries(state.blueprintStock).filter(([, n]) => n > 0)
  /**
   * **与组装机同样的筛选**（船长 2026-09-14：「蓝图书架也加入组装机同样的筛选」）：
   * 一级类别（`MANU_TABS`）/ 二级子类（`manuSubsOf`）/ 三级一次性-永久（`BLUEPRINT_USE_TABS`），
   * 三项都走 `bpFilterKeysOf` 同一个单点；三级同样**只在选了子类后才出现**（与组装机逐字同款口径）。
   */
  const [kind, setKind] = useState<ManuTabKey>('all')
  const [sub, setSub] = useState<string>(SUB_ALL)
  const [useKind, setUseKind] = useState<BlueprintUseKey>(SUB_ALL)
  /** 蓝图书卡（未筛选）：书架 = **手上还没学的书** */
  const bookCards = entries.map(([id, n]) => ({ id, n, keys: bpFilterKeysOf(engine.ctx, id) }))
  /**
   * **碎片逆向卡（2026-09-19 船长：「蓝图书架内确实没有显示可以合并的蓝图碎片。是否忘记添加到蓝图书架了？」）**：
   * 书架原先**只列"手上持有的蓝图书"**，而碎片是"还没有书"的那条路 ⇒ 玩家在这里看不到任何可合并的碎片。
   * 现补一类卡：**碎片进度 > 0 且尚未掌握、且手上没有这本书**的逆向蓝图，卡上直接给「逆向解锁 N/M」。
   * 读数走 core 单点 `fragmentRedeemRows()`（与兑命令同源）；门类归属走 `bpFilterKeysOf`（与蓝图书同一把尺）。
   */
  const fragCards = engine
    .fragmentRedeemRows()
    .filter((r) => !r.learned && r.have > 0 && (state.blueprintStock?.[r.blueprintId] ?? 0) <= 0)
    .map((r) => ({ r, keys: bpFilterKeysOf(engine.ctx, r.blueprintId) }))
  const cards = [...bookCards, ...fragCards]
  /**
   * **筛选项按"书架上真有卡片"出**（2026-09-19 报障修复 · 船长：「如果选择舰船蓝图或者消耗品蓝图，
   * 卡片列表会变空」）：书架只列"还没学的书"＋"可逆向的碎片卡"，而**学习一本吃一本书**
   * （`market.learnBlueprint`）⇒ 把某一门类学完的档，书架上那一门类就是空的。
   * 旧口径把三个标签**静态全列** ⇒ 选「舰船蓝图」/「消耗品蓝图」必然一张卡都不剩，
   * 正是 2026-09-14 那条「避免看不见的筛选」要防的坑。现改为**只列真有卡片的档**：
   * 「全部 / 全部子类 / 全部图纸」三项**常显**，其余按现有卡片现算（键与顺序仍取既有单点表）。
   */
  const tabsShown = MANU_TABS.filter((tb) => tb.key === 'all' || cards.some((c) => c.keys.tab === tb.key))
  const subsShown = manuSubsOf(kind).filter((s) => cards.some((c) => c.keys.tab === kind && c.keys.subKey === s.key))
  const usesShown = BLUEPRINT_USE_TABS.filter((u) =>
    u.key === SUB_ALL
      ? true
      : cards.some(
          (c) =>
            (kind === 'all' || c.keys.tab === kind) &&
            (sub === SUB_ALL || c.keys.subKey === sub) &&
            (u.key === 'single' ? c.keys.singleUse : !c.keys.singleUse),
        ),
  )
  /**
   * **卡片集合变了 ⇒ 原选择可能已经无卡**（学掉最后一张该类书 / 逆向解锁 / 新书到架）：
   * 回落到「全部」，别让玩家卡在永远空的档（与"不出空标签"同一目的）。
   */
  const kindMissing = kind !== 'all' && !tabsShown.some((x) => x.key === kind)
  const subMissing = !kindMissing && sub !== SUB_ALL && !subsShown.some((x) => x.key === sub)
  useEffect(() => {
    if (kindMissing) {
      setKind('all')
      setSub(SUB_ALL)
      setUseKind(SUB_ALL)
      return
    }
    if (subMissing) {
      setSub(SUB_ALL)
      setUseKind(SUB_ALL)
    }
  }, [kindMissing, subMissing])
  /** 三级筛选判定（与上面两张"现算表"同一把尺） */
  const passKeys = (k: { tab: ManuTabKey; subKey: string; singleUse: boolean }): boolean =>
    (kind === 'all' || k.tab === kind) &&
    (sub === SUB_ALL || k.subKey === sub) &&
    (useKind === SUB_ALL || (useKind === 'single' ? k.singleUse : !k.singleUse))
  const shown = bookCards.filter((c) => passKeys(c.keys))
  const fragShown = fragCards.filter((c) => passKeys(c.keys))
  /**
   * **可逆向解锁的碎片卡置顶**（船长 2026-09-19：「蓝图书架内，已经可以逆向解析的蓝图置顶」）：
   * 「已集齐」判据 = `have >= need`（与卡面进度、`RedeemFragmentButton` 的可点判定同源）⇒ 排到书架**最前**；
   * 未集齐的碎片卡留在蓝图书之后（原位置不动）。
   */
  const fragReady = fragShown.filter((c) => c.r.have >= c.r.need)
  const fragRest = fragShown.filter((c) => c.r.have < c.r.need)

  function handleLearn(blueprintId: string): void {
    const r = engine.learnBlueprintAt(blueprintId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Industry.130'), true)
    else onToast(tr("ui.Industry.095"))
  }

  function handleSell(blueprintId: string): void {
    const key = bpGoodKey(engine, blueprintId)
    if (!key) {
      onToast(tr("ui.Industry.096"), true)
      return
    }
    const r = engine.sellHoldingAt(key)
    if (!r.ok) onToast(cmdText(r) || tr('ui.CargoPage.019'), true)
    else onToast(tr("ui.Industry.097"))
  }

  /**
   * **碎片逆向卡**（2026-09-19 船长：「蓝图书架内确实没有显示可以合并的蓝图碎片。是否忘记添加到蓝图书架了？」）
   * ——与蓝图书**同网格**（同一份 JSX 供"置顶区"与"常规区"共用），卡面标明碎片来源与进度，
   * 动作 = 「逆向解锁 N/M」（`RedeemFragmentButton` 与物品详情弹层共用同一个出口）。
   *
   * ⚠ **卡头不挂数量标签**（船长 2026-09-19 追问「为什么在蓝图名称右边加一个碎片数量的标签」）：
   * 片数在**按钮**（`逆向解锁 N/M`）与**说明行**（还差 N 片 / 已集齐）里已经有了，卡头再挂一颗
   * 「碎片 N/M」= 同一信息第三次出现；原先那颗是照蓝图书卡的「×N」抄的版式，而书卡的 ×N 是
   * **重复本数**（决定"学习还是出售"）、碎片没有对应的"本数"概念 ⇒ 版式不必对齐，已删。
   */
  function fragCard(r: ReturnType<GameEngine['fragmentRedeemRows']>[number]): ReactNode {
    return (
      <div key={`frag-${r.fragmentItemId}`} className="app-belt-card app-shelf-card is-frag">
        <div className="app-belt-head">
          <span className="app-belt-name" title={r.blueprintName}>
            ▦ {r.blueprintName}
          </span>
        </div>
        <div className="app-belt-desc">
          {r.have >= r.need
            ? tr("ui.Industry.020")
            : tr("ui.Industry.099", { p1: r.need - r.have })}
        </div>
        <div className="app-belt-actions">
          <RedeemFragmentButton engine={engine} itemId={r.fragmentItemId} onToast={onToast} />
        </div>
      </div>
    )
  }

  if (cards.length === 0) {
    return (
      <Panel
        title={tr("ui.IndustryPage.060")}
        hint={
          // 空态只留"还没有书"这句状态；怎么弄到书的常驻引导收进标题后的圆形感叹号（2026-09-13 船长口径）
          // 2026-09-14 船长：虫洞专属图纸市场买不到 ⇒ 组装机那张卡改「去虫洞（遗迹打捞）」，这里同步改口径
          <HintIcon tip={tr('ui.Industry.138')} />
        }
        right={<span className="app-dim">{tr("ui.Industry.006")}</span>}
      >
        <div className="app-dim app-inv-empty">{tr("ui.Industry.007")}</div>
      </Panel>
    )
  }

  return (
    <Panel
      className="is-fill"
      title={tr("ui.IndustryPage.060")}
      right={
        <span className="app-dim">
          {tr("ui.Industry.008")}
          {/* 筛选生效时补"当前 N 本"（与组装机/精炼炉同款，免得对着收窄后的网格数不清） */}
          {kind !== 'all' || sub !== SUB_ALL || useKind !== SUB_ALL ? ` · 当前 ${shown.length} 本` : ''}
        </span>
      }
    >
      {/* 三级筛选与组装机**同一套**（同表、同顺序、同"选了子类才出三级"的规则）——
          样式逐字复用这两行（`app-task-tabs` + `app-fleet-tabs` + `app-tasktab`）；
          ⚠ **标签集合是现算的**（2026-09-19 报障修复）：只列"书架上真有卡片"的档，
          「全部 / 全部子类 / 全部图纸」常显——详见上面 `tabsShown / subsShown / usesShown` 的注释；
          文案 = 裸「全部」+ 同行灰字前缀（基线①，2026-09-19 丙组补） */}
      <div className="app-fleet-row">
        <span className="app-dim">{tr('ui.Industry.134')}</span>
        <div className="app-task-tabs app-fleet-tabs" role="tablist">
          {tabsShown.map((tb) => (
            <button
              key={tb.key}
              role="tab"
              aria-selected={kind === tb.key}
              className={`app-tasktab${kind === tb.key ? ' is-active' : ''}`}
              onClick={() => {
                setKind(tb.key)
                setSub(SUB_ALL) // 换一级标签即回「全部子类」（与组装机同款）
                setUseKind(SUB_ALL)
              }}
            >
              {tr(tb.id)}
            </button>
          ))}
        </div>
      </div>
      {subsShown.length > 0 ? (
        <div className="app-fleet-row">
          <span className="app-dim">{tr('ui.Industry.129')}</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={sub === SUB_ALL}
              className={`app-tasktab${sub === SUB_ALL ? ' is-active' : ''}`}
              onClick={() => {
                setSub(SUB_ALL)
                setUseKind(SUB_ALL)
              }}
            >
              {tr('ui.IndustryPage.001')}
            </button>
            {subsShown.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={sub === s.key}
                className={`app-tasktab${sub === s.key ? ' is-active' : ''}`}
                onClick={() => {
                  setSub(s.key)
                  setUseKind(SUB_ALL)
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {sub !== SUB_ALL ? (
        <div className="app-fleet-row">
          <span className="app-dim">{tr('ui.Industry.135')}</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            {usesShown.map((u) => (
              <button
                key={u.key}
                role="tab"
                aria-selected={useKind === u.key}
                className={`app-tasktab${useKind === u.key ? ' is-active' : ''}`}
                onClick={() => setUseKind(u.key)}
              >
                {tr(u.id)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="app-shelf-grid">
        {/* **可逆向解锁的碎片卡置顶**（船长 2026-09-19）——排在蓝图书之前 */}
        {fragReady.map((c) => fragCard(c.r))}
        {shown.map(({ id, n }) => {
          // 蓝图书架按**持有的书**列条目 ⇒ 走全目录（施工期闸门下未上线的图纸只有调试才可能持有）
          const bp = engine.allBlueprints.find((b) => b.id === id) ?? engine.allShipBlueprints.find((b) => b.id === id)
          const learned = ownsBlueprint(state, id)
          const su = bp?.singleUse === true
          const willConsume = su && !learned && (state.spentOneTimeRecipes ?? []).includes(id)
          const kindShip = (bp && 'shipId' in bp) || (!bp && engine.allShipBlueprints.some((b) => b.id === id))
          // 2026-09-20 零件体系：舰船书「去造船厂」、其余「去组装机」
          const isShipBook = kindShip
          const marketGood = marketGoodOf(engine.ctx, 'blueprint', id)
          const noResale = marketGood?.playerSellable === false
          return (
            <div
              key={id}
              className={`app-belt-card app-shelf-card${learned ? ' is-learned' : ''}${focusBookId === id ? ' is-goto' : ''}`}
            >
              <div className="app-belt-head">
                <span className="app-belt-name" title={bp?.name ?? id}>
                  {kindShip ? '◈ ' : '▦ '}
                  {bp?.name ?? id}
                </span>
                <span className="app-chip" style={{ marginLeft: 'auto' }}>
                  ×{n}
                </span>
              </div>
              <div className="app-belt-desc">
                {su
                  ? learned
                    ? tr("ui.Industry.009")
                    : willConsume
                      ? tr("ui.Industry.010")
                      : tr("ui.Industry.011")
                  : learned
                    ? tr(noResale ? 'ui.ammoMk3.002' : 'ui.Industry.012')
                    : tr("ui.Industry.013")}
              </div>
              <div className="app-belt-actions">
                {/* **去组装机 / 去造船厂**（船长 2026-09-14：「蓝图书架内，玩家可以通过蓝图直接跳转对应组装机」；
                    2026-09-20 零件体系：舰船书改跳造船厂）——切到对应标签并定位这张卡 */}
                {onGotoCraft ? (
                  <button
                    className="app-btn is-small"
                    title={
                      isShipBook
                        ? tr('ui.Industry.139')
                        : tr('ui.Industry.140')
                    }
                    onClick={() => onGotoCraft(id)}
                  >
                    {isShipBook ? tr('ui.Industry.141') : tr('ui.Industry.015')}
                  </button>
                ) : null}
                {!learned && !su ? (
                  <button className="app-btn is-small is-primary" onClick={() => handleLearn(id)}>
                    {tr("ui.Industry.016")}
                  </button>
                ) : null}
                {!su && !noResale ? (
                  <button className="app-btn is-small" onClick={() => handleSell(id)} title={tr("ui.Industry.017")}>
                    {tr("ui.Industry.018")}
                  </button>
                ) : null}
                {/* ⟪文案调整 2026-10-08⟫ 复用市场查看入口，可交易的一次性图纸同样可达。 */}
                {onGotoMarket && marketGood && marketGood.unreleased !== true && marketGood.playerSellable !== false ? (
                  <button
                    className="app-btn is-small"
                    title={tr('ui.CargoPage.002')}
                    onClick={() => onGotoMarket(marketGood.key)}
                  >
                    {tr('ui.CargoPage.001')}
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
        {/* 未集齐的碎片卡：留在蓝图书之后（原位置） */}
        {fragRest.map((c) => fragCard(c.r))}
      </div>
      {shown.length === 0 && fragShown.length === 0 ? (
        <div className="app-dim app-inv-empty">{tr("ui.Industry.094")}</div>
      ) : null}
    </Panel>
  )
}
