import { marketGoodOf, marketTradingGoods, ownsBlueprint } from '@whale/core'
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


export function BlueprintShelfPanel({
  engine,
  onToast,
  onGotoCraft,
  onGotoMarket,
  focusBookId,
}: {
  engine: GameEngine
  onToast: ToastFn
  onGotoCraft?: (blueprintId: string) => void
  onGotoMarket?: (goodKey: string) => void
  focusBookId?: string | null
}) {
  const state = engine.state
  useL10n()
  const entries = Object.entries(state.blueprintStock).filter(([, n]) => n > 0)
  const [kind, setKind] = useState<ManuTabKey>('all')
  const [sub, setSub] = useState<string>(SUB_ALL)
  const [useKind, setUseKind] = useState<BlueprintUseKey>(SUB_ALL)
  const bookCards = entries.map(([id, n]) => ({ id, n, keys: bpFilterKeysOf(engine.ctx, id) }))
  const fragCards = engine
    .fragmentRedeemRows()
    .filter((r) => !r.learned && r.have > 0 && (state.blueprintStock?.[r.blueprintId] ?? 0) <= 0)
    .map((r) => ({ r, keys: bpFilterKeysOf(engine.ctx, r.blueprintId) }))
  const cards = [...bookCards, ...fragCards]
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
  const passKeys = (k: { tab: ManuTabKey; subKey: string; singleUse: boolean }): boolean =>
    (kind === 'all' || k.tab === kind) &&
    (sub === SUB_ALL || k.subKey === sub) &&
    (useKind === SUB_ALL || (useKind === 'single' ? k.singleUse : !k.singleUse))
  const shown = bookCards.filter((c) => passKeys(c.keys))
  const fragShown = fragCards.filter((c) => passKeys(c.keys))
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
          const noResale = !marketGood || !marketTradingGoods(engine.ctx).some(row => row.key === marketGood.key)
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
                {onGotoMarket && marketGood && marketTradingGoods(engine.ctx).some(row => row.key === marketGood.key) ? (
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
