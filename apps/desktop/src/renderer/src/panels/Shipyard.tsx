import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Panel } from '@whale/ui'
import type { MaterialNeed } from '@whale/core'
import {
  manufacturingRunViews,
  ownsBlueprint,
  shipOwnedCount,
  sortManuRows,
} from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { ShipHover } from '../ui/shipInfo'
import { pinMarked } from '../ui/marks'
import { AiSlotText } from '../ui/aiSlots'
import { HintIcon } from '../ui/Hint'
import { useL10n } from '../i18n/locale'
import { fmtInt } from '../i18n/fmt'
import {
  BLUEPRINT_LEARN_TABS,
  SHIP_DOMAIN_SUBS,
  SHIP_TIER_SUBS,
  SUB_ALL,
  presentSubs,
  shipRolePasses,
  subText,
  type BlueprintLearnKey,
} from '../ui/itemSubs'
import { BlueprintCard, bookPriceOf, cardLiveKeyOf, productBaseOf } from './Industry'

interface ShipItem {
  id: string
  kindLabel: string
  subKey: string
  shipId: string
  productGlyph: string
  name: string
  description: string
  materials: readonly MaterialNeed[]
  buildSeconds: number
  productLabel: string
  productNode: ReactNode
  productBase: number
  productRef: { kind: 'ship' | 'module' | 'item'; refId: string }
  countOwned: () => number
  ownedWhere: string
  bookPrice: number
  productKey: string
  singleUse: boolean
  learnless: boolean
}

export function ShipyardPanel({
  engine,
  onToast,
  onNeedMineral,
  onGotoMarket,
  onGotoWormhole,
  focusBlueprintId,
}: {
  engine: GameEngine
  onToast: ToastFn
  onNeedMineral?: (itemId: string) => void
  onGotoMarket?: (goodKey: string) => void
  onGotoWormhole?: () => void
  focusBlueprintId?: string | null
}) {
  const state = engine.state
  const runViews = manufacturingRunViews(state, engine.ctx)
  const { t } = useL10n()
  const [sub, setSub] = useState<string>(SUB_ALL)
  const [cat, setCat] = useState<string>(SUB_ALL)
  const [learn, setLearn] = useState<BlueprintLearnKey>(SUB_ALL)
  const [kw, setKw] = useState('')
  const kq = kw.trim().toLowerCase()

  useEffect(() => {
    if (!focusBlueprintId) return
    setSub(SUB_ALL)
    setCat(SUB_ALL)
    setLearn(SUB_ALL)
  }, [focusBlueprintId])

  const items = useMemo<ShipItem[]>(() => {
    const out: ShipItem[] = []
    for (const sbp of engine.shipBlueprints) {
      const shipDef = engine.ctx.ships.get(sbp.shipId)
      const prodName = shipDef?.name ?? sbp.shipId
      const prodLabel = prodName
      const prodParams = shipDef
        ? t('ui.shipInfo.213', {
            cargo: fmtInt(shipDef.cargoM3),
            cycle: shipDef.cycleSeconds,
            perCycle: shipDef.oreUnitsPerCycle,
          })
        : ''
      const prodText = <span className="app-gold">{prodName}</span>
      const shipId = sbp.shipId
      out.push({
        id: sbp.id,
        kindLabel: '舰船',
        subKey: shipDef ? `t${shipDef.tier}` : '',
        shipId,
        productGlyph: shipDef?.role ?? 'blueprint',
        name: sbp.name,
        description: sbp.description,
        materials: sbp.materials,
        buildSeconds: sbp.buildSeconds,
        productLabel: prodLabel,
        productNode: shipDef ? (
          <ShipHover ship={shipDef} note={shipDef.description}>
            {prodText}
            {prodParams}
          </ShipHover>
        ) : (
          <>
            {prodText}
            {prodParams}
          </>
        ),
        productBase: shipDef ? (productBaseOf(engine, 'ship', shipId) || shipDef.priceIsk || 0) : 0,
        productRef: { kind: 'ship' as const, refId: shipId },
        countOwned: () => shipOwnedCount(engine.state, shipId),
        ownedWhere: '仓库＋机库',
        bookPrice: bookPriceOf(engine, sbp.id, 0),
        productKey: `ship:${shipId}`,
        singleUse: sbp.singleUse === true,
        learnless: false,
      })
    }
    return out
  }, [engine.ctx, engine.shipBlueprints])

  const tierShown = presentSubs(SHIP_TIER_SUBS, (key) => items.some((it) => it.subKey === key))
  const catShown = presentSubs(SHIP_DOMAIN_SUBS, (key) =>
    items.some((it) => shipRolePasses(engine.ctx.ships.get(it.shipId), key)),
  )

  const visible = items
    .filter((it) => {
      if (kq.length === 0) return true
      if (it.name.toLowerCase().includes(kq)) return true
      if (it.productLabel.toLowerCase().includes(kq)) return true
      if ((it.description ?? '').toLowerCase().includes(kq)) return true
      return it.materials.some((m) => (engine.ctx.items.get(m.itemId)?.name ?? m.itemId).toLowerCase().includes(kq))
    })
    .filter((it) => {
      if (learn === SUB_ALL) return true
      const learned = ownsBlueprint(state, it.id)
      if (learn === 'learned') return learned
      if (learn === 'unlearned') return !learned
      return !learned && it.singleUse
    })
    .filter((it) => sub === SUB_ALL || it.subKey === sub)
    .filter((it) => shipRolePasses(engine.ctx.ships.get(it.shipId), cat))
  const sorted = pinMarked(state, 'blueprints', sortManuRows(visible), (it) => it.id)
  const runSigByBp = new Map<string, string>()
  for (const v of runViews) {
    if (v.blueprintId === null) continue
    runSigByBp.set(v.blueprintId, `${runSigByBp.get(v.blueprintId) ?? ''}${v.id}.${Math.round(v.remainingMs / 1000)}.${Math.round(v.percent)}.${v.worker ?? '-'}|`)
  }
  const liveKeyOf = (it: ShipItem): string =>
    cardLiveKeyOf(engine, it.id, it.materials, runSigByBp.get(it.id) ?? '', it.countOwned())
  const learnedN = items.filter((i) => ownsBlueprint(state, i.id)).length

  return (
    <Panel
      className="is-fill win-fixed-body"
      title={t('ui.IndustryPage.114')}
      hint={
        <HintIcon tip={t('ui.IndustryPage.115')} />
      }
      right={
        <>
          <span className="app-head-search-wrap">
            <input
              className="app-head-search"
              type="text"
              placeholder={t('ui.Shipyard.001')}
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              spellCheck={false}
            />
          </span>
          <span className="app-dim">
            {t('ui.Shipyard.005', {
              p1: runViews.filter((v) => items.some((i) => i.id === v.blueprintId)).length,
              p2: items.length,
              p3: learnedN,
            })}
            {kq.length > 0
              ? t('ui.IndustryPage.108', { n: sorted.length })
              : learn !== SUB_ALL || cat !== SUB_ALL || sub !== SUB_ALL
                ? t('ui.Industry.127', { n: sorted.length })
                : ''}
          </span>
          <AiSlotText state={state} ctx={engine.ctx} />
        </>
      }
    >
      <div className="app-filter-block">
        {/* 第 1 行「蓝图」＝原「学会」行（2026-09-26 船长令改名，并把原第 3 行「图纸」的两档并进来） */}
        <div className="app-fleet-row">
          <span className="app-dim">{t('ui.Industry.136')}</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            {BLUEPRINT_LEARN_TABS.map((l) => (
              <button
                key={l.key}
                role="tab"
                aria-selected={learn === l.key}
                className={`app-tasktab${learn === l.key ? ' is-active' : ''}`}
                onClick={() => setLearn(l.key)}
              >
                {/* ⚠ 筛选档一律走 `subText`（有 id 取当前语言）；直接写 `l.label` 会在英文界面漏中文 */}
                {subText(l)}
              </button>
            ))}
          </div>
        </div>
        {/* 第 2 行「类别」＝手册舰船图鉴那一维，插在「子类」上一级（2026-09-26 船长令） */}
        <div className="app-fleet-row">
          <span className="app-dim">{t('ui.ShipPage.004')}</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={cat === SUB_ALL}
              className={`app-tasktab${cat === SUB_ALL ? ' is-active' : ''}`}
              onClick={() => setCat(SUB_ALL)}
            >
              {t('ui.IndustryPage.001')}
            </button>
            {catShown.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={cat === s.key}
                className={`app-tasktab${cat === s.key ? ' is-active' : ''}`}
                onClick={() => setCat(s.key)}
              >
                {subText(s)}
              </button>
            ))}
          </div>
        </div>
        {/* 第 3 行「子类」＝舰船级别（与组装机旧「舰船蓝图」子筛选同一张单点表） */}
        <div className="app-fleet-row">
          <span className="app-dim">{t('ui.Industry.129')}</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={sub === SUB_ALL}
              className={`app-tasktab${sub === SUB_ALL ? ' is-active' : ''}`}
              onClick={() => setSub(SUB_ALL)}
            >
              {t('ui.IndustryPage.001')}
            </button>
            {tierShown.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={sub === s.key}
                className={`app-tasktab${sub === s.key ? ' is-active' : ''}`}
                onClick={() => setSub(s.key)}
              >
                {subText(s)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="app-win-body">
        <div className="app-belt-grid">
          {sorted.map((it) => (
            <BlueprintCard
              key={it.id}
              engine={engine}
              onToast={onToast}
              blueprintId={it.id}
              name={it.name}
              description={it.description}
              materials={it.materials}
              buildSeconds={it.buildSeconds}
              productLabel={it.productLabel}
              productNode={it.productNode}
              kindLabel="舰船" /* l10n-keep：内容层联合 key（渲染处走 Industry 的 kindLabelText） */
              productGlyph={it.productGlyph}
              productBase={it.productBase}
              productRef={it.productRef}
              countOwned={it.countOwned}
              ownedWhere={it.ownedWhere}
              onNeedMineral={onNeedMineral}
              onGotoMarket={onGotoMarket}
              onGotoWormhole={onGotoWormhole}
              highlighted={focusBlueprintId === it.id}
              liveKey={liveKeyOf(it)}
            />
          ))}
        </div>
        {sorted.length === 0 ? (
          <div className="app-dim app-exp-idle">{t('ui.Shipyard.006')}</div>
        ) : null}
      </div>
    </Panel>
  )
}
