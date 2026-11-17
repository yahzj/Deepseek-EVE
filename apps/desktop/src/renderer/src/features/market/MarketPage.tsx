import { useEffect, useMemo, useRef, useState } from 'react'
import { goodName } from '@whale/core'
import { Panel } from '@whale/ui'
import { marketGoodDisplayName as goodDisplayName } from '../../ui/marketGoodHover'
import type { PageProps } from '../../pages/common'
import { isk } from '../../pages/common'
import { Glyph } from '../../ui/Glyphs'
import { HintIcon } from '../../ui/Hint'
import { SUB_ALL, DOMAIN_ALL, DOMAIN_ITEM, DOMAIN_SHIP, ITEM_DOMAIN_SUBS, SHIP_DOMAIN_SUBS, MARKET_DOMAIN_TABS, SUBS_OF_KIND, SHIP_TIER_SUBS, RACK_SUBS, rackPasses, marketDomainPasses, subText } from '../../ui/itemSubs'
import type { SubOption } from '../../ui/itemSubs'
import { tr } from '../../i18n/locale'
import { blackMarketUnlocked, marketTradingGoods } from '@whale/core'
import { BlackMarketPage } from '../../pages/BlackMarketPage'
import { stockedFirst, rareOrderRows } from './sorting'
import { domainPasses, KIND_OPTIONS } from './filters'
import type { KindFilter } from './filters'
import { MarketColumn } from './MarketColumn'
import { MyOrders } from './MyOrders'
import { fmtClock, nextSupplyIn, taxTipText } from './readouts'
import { MarketDetail } from './MarketDetail'

export function MarketPage({
  engine,
  onToast,
  focusKey,
  focusSeq,
  onFocusUsed,
}: PageProps & { focusKey?: string | null; focusSeq?: number; onFocusUsed?: () => void }) {
  const state = engine.state
  const goods = useMemo(() => marketTradingGoods(engine.ctx), [engine])
  const [blackMarketOpen, setBlackMarketOpen] = useState(false)
  const common = goods.filter((g) => g.rarity === 'common')
  const rareCol = goods.filter((g) => g.rarity === 'rare')
  const exoticCol = goods.filter((g) => g.rarity === 'exotic')
  const [mktTab, setMktTab] = useState<'mine' | 'common' | 'rare' | 'exotic'>('common')
  const [kw, setKw] = useState('')
  const [selKey, setSelKey] = useState<string | null>(null)
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1180px)').matches,
  )
  const [detailOpen, setDetailOpen] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1180px)')
    const sync = (): void => setNarrow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  const defaultSelKey = narrow ? null : stockedFirst(engine, common)[0]?.key ?? null
  const activeSelKey = selKey ?? defaultSelKey
  const listSelKey = narrow ? null : activeSelKey
  const activeGood = activeSelKey ? goods.find((g) => g.key === activeSelKey) ?? null : null
  useEffect(() => {
    if (narrow && selKey !== null) setDetailOpen(true)
  }, [narrow, selKey])
  const closeDetail = (): void => {
    setDetailOpen(false)
    setSelKey(null)
  }
  const lastFocusSeq = useRef(0)
  useEffect(() => {
    if (focusKey && focusSeq !== undefined && focusSeq !== lastFocusSeq.current) {
      lastFocusSeq.current = focusSeq
      setKw(focusKey)
      setSelKey(focusKey)
      setKind(DOMAIN_ALL)
      setSub(SUB_ALL)
      setDetail(SUB_ALL)
      setRack(SUB_ALL)
      onFocusUsed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq])

  const [kind, setKind] = useState<KindFilter>(DOMAIN_ALL)
  const [sub, setSub] = useState<string>(SUB_ALL)
  const [detail, setDetail] = useState(SUB_ALL)
  const [rack, setRack] = useState(SUB_ALL)
  const domainText = Object.fromEntries(MARKET_DOMAIN_TABS.map((tab) => [tab.key, subText(tab)]))
  const query = kw.trim().toLowerCase()
  const filterActive = query.length > 0 || kind !== DOMAIN_ALL
  const itemNameOf = (id: string): string | undefined => engine.ctx.items.get(id)?.name
  const kindSubs: SubOption[] | undefined =
    kind === DOMAIN_ITEM
      ? ITEM_DOMAIN_SUBS.filter((s) => goods.some((g) => domainPasses(engine.ctx, g, DOMAIN_ITEM, s.key)))
      : kind === DOMAIN_SHIP
        ? SHIP_DOMAIN_SUBS.filter((s) => goods.some((g) => domainPasses(engine.ctx, g, DOMAIN_SHIP, s.key)))
      : undefined
  const changeKind = (v: KindFilter): void => {
    setKind(v)
    setSub(SUB_ALL)
    setDetail(SUB_ALL)
    setRack(SUB_ALL)
  }
  const changeMarketTab = (tab: typeof mktTab): void => {
    setKw('')
    changeKind(DOMAIN_ALL)
    setMktTab(tab)
  }
  const changeCategory = (v: string): void => {
    setSub(v)
    setDetail(SUB_ALL)
    setRack(SUB_ALL)
  }
  const rackOptions = kind === DOMAIN_ITEM && sub === 'module'
    ? RACK_SUBS.filter((s) => goods.some((g) => marketDomainPasses(engine.ctx, g, kind, sub) && rackPasses(engine.ctx, g.refId, s.key)))
    : []
  const details = sub !== SUB_ALL ? (kind === DOMAIN_SHIP ? SHIP_TIER_SUBS : SUBS_OF_KIND[sub] ?? []) : []
  const detailOptions = details.filter((s) => s.key === 'learned' || s.key === 'unlearned' ||
    goods.some((g) => marketDomainPasses(engine.ctx, g, kind, sub, engine.state, s.key, rack)))
  const detailMissing = detail !== SUB_ALL && !detailOptions.some((s) => s.key === detail)
  const subMissing = sub !== SUB_ALL && !kindSubs?.some((s) => s.key === sub)
  const rackMissing = rack !== SUB_ALL && !rackOptions.some((s) => s.key === rack)
  useEffect(() => {
    if (subMissing) { setSub(SUB_ALL); setDetail(SUB_ALL); setRack(SUB_ALL) }
    if (detailMissing) setDetail(SUB_ALL)
    if (rackMissing) { setRack(SUB_ALL); setDetail(SUB_ALL) }
  }, [subMissing, detailMissing, rackMissing])
  const jumpToOrder = (goodKey: string): void => {
    setKw(goodKey)
    changeKind(DOMAIN_ALL)
    setSelKey(goodKey)
    if (narrow) setDetailOpen(true)
  }
  const onPickGood = (goodKey: string): void => {
    setSelKey(goodKey)
    if (narrow) setDetailOpen(true)
  }
  const filteredAll = useMemo(    () =>
      stockedFirst(
        engine,
        goods.filter((good) => {
          if (!marketDomainPasses(engine.ctx, good, kind, sub, engine.state, detail, rack)) return false
          if (query.length > 0) {
            const name = goodDisplayName(engine.ctx, good.key).toLowerCase()
            if (!name.includes(query) && !good.key.toLowerCase().includes(query)) return false
          }
          return true
        }),
      ),
    [goods, engine, kind, sub, detail, rack, query, engine.state.gameMs],
  )

  if (blackMarketOpen) return <BlackMarketPage engine={engine} onToast={onToast} onBack={() => setBlackMarketOpen(false)} />

  return (
    <div className="page-stack page-fill app-mkt-page">
      {/* 常驻双栏：左 = 搜索 + 标签 + 商品列表；右 = 市场详情大盘（常驻，无选中时显示引导） */}
      <div className="app-mkt-split">
        <div className="app-mkt-left">
          {/* 页面级全局搜索栏：同时检索常驻 + 稀有 + 限定奇货（三档商品不重叠） */}
          <div className="app-mkt-search app-fleet-row">
            <input
              className="app-mkt-search-input"
              type="search"
              placeholder={tr("ui.MarketPage.098")}
              value={kw}
              onChange={(e) => setKw(e.target.value)}
            />
            <select className="app-mkt-kind" value={kind} onChange={(e) => changeKind(e.target.value as KindFilter)}>
              <option value={DOMAIN_ALL}>{tr("ui.MarketPage.099")}</option>
              {KIND_OPTIONS.filter((k) => k !== DOMAIN_ALL).map((k) => (
                <option key={k} value={k}>
                  {domainText[k]}
                </option>
              ))}
            </select>
            {kindSubs ? (
              <select
                className="app-mkt-kind"
                value={sub}
                onChange={(e) => changeCategory(e.target.value)}
                title={tr("ui.MarketPage.169", { p1: domainText[kind] })}
              >
                <option value={SUB_ALL}>{tr("ui.IndustryPage.001")}{domainText[kind]}</option>
                {kindSubs.map((s) => (
                  <option key={s.key} value={s.key}>
                    {/* 消耗品桶里有「道具逐件档」（档名 = 那件道具自己的名字）⇒ 第二参数给物品名解析器 */}
                    {subText(s, itemNameOf)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {rackOptions.length > 0 || detailOptions.length > 0 ? <div className="app-fleet-row">
            {rackOptions.length > 0 ? <select className="app-mkt-kind" value={rack} title={tr('ui.hintAudit.004')} onChange={(e) => { setRack(e.target.value); setDetail(SUB_ALL) }}>
              <option value={SUB_ALL}>{tr('ui.hintAudit.006')}</option>
              {rackOptions.map((s) => <option key={s.key} value={s.key}>{subText(s)}</option>)}
            </select> : null}
            {detailOptions.length > 0 ? <select className="app-mkt-kind" value={detail} title={tr('ui.hintAudit.005')} onChange={(e) => setDetail(e.target.value)}>
              <option value={SUB_ALL}>{tr(kind === DOMAIN_SHIP ? 'ui.hintAudit.008' : sub === 'module' ? 'ui.hintAudit.007' : 'ui.hintAudit.009')}</option>
              {detailOptions.map((s) => <option key={s.key} value={s.key}>{subText(s, itemNameOf)}</option>)}
            </select> : null}
          </div> : null}

          <div className="app-subtabs app-mkt-tabs" role="tablist">
            <button role="tab" aria-selected={mktTab === 'mine' && !filterActive} className={`app-subtab${mktTab === 'mine' && !filterActive ? ' is-active' : ''}`} onClick={() => changeMarketTab('mine')}>
              <span>▤</span><span>{tr('ui.MarketPage.113')}</span>
            </button>
            <button role="tab" aria-selected={mktTab === 'common' && !filterActive} className={`app-subtab${mktTab === 'common' && !filterActive ? ' is-active' : ''}`} onClick={() => changeMarketTab('common')}>
              <span>≡</span><span>{tr('ui.MarketPage.101')}</span>
            </button>
            <button role="tab" aria-selected={mktTab === 'rare' && !filterActive} className={`app-subtab${mktTab === 'rare' && !filterActive ? ' is-active' : ''}`} onClick={() => changeMarketTab('rare')} title={tr('ui.MarketPage.102')}>
              <span>✦</span><span>{tr('ui.MarketPage.103')}</span>
            </button>
            <button role="tab" aria-selected={mktTab === 'exotic' && !filterActive} className={`app-subtab${mktTab === 'exotic' && !filterActive ? ' is-active' : ''}`} onClick={() => changeMarketTab('exotic')} title={tr('ui.MarketPage.104')}>
              <span>◈</span><span>{tr('ui.MarketPage.028')}</span>
            </button>
            {blackMarketUnlocked(state) ? <button className="app-subtab app-bm-entry" role="tab" aria-selected={false} onClick={() => { engine.openBlackMarketAt(); setBlackMarketOpen(true) }}>
              <Glyph name="nav-shop" size={16} /><span>{tr('ui.blackMarket.001')}</span>
            </button> : null}
          </div>
          {filterActive ? (
            /* ── 搜索/过滤激活：跨档合并结果（常驻 + 稀有 + 限定奇货一次搜全；GoodRow 自带稀有度徽标区分） ── */
            // ⟪文案调整 2026-10-04⟫ 标题包含全部已选条件，避免细分筛选被隐藏。
            <MarketColumn
              engine={engine}
              title={
                [query.length > 0 ? tr('ui.MarketPage.170', { p1: kw.trim() }) : tr('ui.hintAudit.002'),
                  kind !== DOMAIN_ALL ? domainText[kind] : '',
                  sub !== SUB_ALL ? subText(kindSubs?.find((s) => s.key === sub) ?? { label: sub }, itemNameOf) : '',
                  rack !== SUB_ALL ? subText(rackOptions.find((s) => s.key === rack) ?? { label: rack }) : '',
                  detail !== SUB_ALL ? subText(detailOptions.find((s) => s.key === detail) ?? { label: detail }, itemNameOf) : '',
                ].filter(Boolean).join(' · ')
              }
              hint={<HintIcon tip={tr('ui.MarketPage.034')} />}
              right={<span className="app-dim">{tr("ui.MarketPage.100")}</span>}
              rows={filteredAll}
              selKey={listSelKey}
              onSelect={onPickGood}
            />
          ) : (
            <>
              {mktTab === 'mine' ? (
                /**
                 * **「我的挂单」子页面**（船长 2026-09-22：与常驻订单同级、排第一位）。
                 * 面板头右侧放**托管**读数——船长同日原话：「**钱包删除，托管挪到子标签页内的标题里**」
                 * （钱包额顶栏本来就常显，页内不再重复一份；托管数原先只在右栏那行里，宽窄屏都看不见了
                 * ⇒ 现在跟着这一页走）。
                 * ⚠ 面板体高度由 CSS 的 `flex: 1 1 auto` 吃满左栏，超出部分在面板体内滚动；
                 * 可见行数由 `MyOrders` 量成「整行」（船长 2026-09-14 报障「第七条被遮住一半」）。
                 */
                <Panel
                  className="is-fill"
                  title={tr("ui.MarketPage.113")}
                  right={
                    <span className="app-dim">
                      {tr("ui.MarketPage.179")} {isk(Object.values(state.escrowItems).reduce((a, b) => a + b, 0))}
                      {tr('ui.MarketPage.135')}
                    </span>
                  }
                >
                  <MyOrders engine={engine} onToast={onToast} onJump={jumpToOrder} />
                </Panel>
              ) : mktTab === 'common' ? (
                <MarketColumn
                  engine={engine}
                  title={tr("ui.MarketPage.105")}
                  hint={<HintIcon tip={tr('ui.MarketPage.034')} />}
                  right={
                    <span className="app-dim" title={tr("ui.MarketPage.106")}>
                      {tr("ui.MarketPage.107")} {fmtClock(nextSupplyIn(engine))}{tr('ui.MarketPage.134')}
                    </span>
                  }
                  rows={stockedFirst(engine, common)}
                  selKey={listSelKey}
                  onSelect={onPickGood}
                />
              ) : mktTab === 'rare' ? (
                <MarketColumn
                  engine={engine}
                  title={tr("ui.MarketPage.103")}
                  hint={<HintIcon tip={tr('ui.MarketPage.034')} />}
                  right={<span className="app-dim">{tr("ui.MarketPage.108")}</span>}
                  rows={rareOrderRows(engine, rareCol)}
                  selKey={listSelKey}
                  onSelect={onPickGood}
                />
              ) : (
                <MarketColumn
                  engine={engine}
                  title={tr("ui.MarketPage.028")}
                  hint={<HintIcon tip={tr('ui.MarketPage.034')} />}
                  right={<span className="app-dim">{tr("ui.MarketPage.109")}</span>}
                  rows={rareOrderRows(engine, exoticCol)}
                  empty={tr('ui.MarketPage.177')}
                  selKey={listSelKey}
                  onSelect={onPickGood}
                />
              )}
            </>
          )}
        </div>

        <div className="app-mkt-right">
          {/**
           * **窄屏（单栏）⇒ 不渲染"市场详情"**（船长 2026-09-21）：单栏时它会被压到订单列表**下方**，
           * 玩家要翻很久才够得着 ⇒ 改为点订单**弹浮窗**（见本文件末尾那一段）。
           * ⚠ **2026-09-22 起右栏只有这一块**：船长令「我的挂单」搬进左栏子标签页 ⇒ 详情卡**吃满右栏**
           * （CSS `.app-mkt-right > .wui-panel:only-child`）；原先"详情卡 + 我的挂单"的纵向堆叠不复存在。
           * 09-21 那条「我的挂单留在栏内、宽窄都要一眼看到钱包与托管额」的做法被同日的新令取代
           * （钱包不再在页内重复、托管跟着「我的挂单」页走）。
           */}
          {!narrow ? (
            activeGood ? (
              <MarketDetail engine={engine} onToast={onToast} good={activeGood} />
            ) : (
              <Panel
                title={tr("ui.MarketPage.110")}
                hint={<HintIcon tip={taxTipText(state, engine.ctx)} />}
                right={<span className="app-dim">{tr("ui.MarketPage.111")}</span>}
              >
                <div className="app-dim app-inv-empty">
                  {tr("ui.MarketPage.112")}
                </div>
              </Panel>
            )
          ) : null}
        </div>
      </div>
      {/**
       * **窄屏的「市场详情」浮窗**（船长 2026-09-21：手机/窄屏下点订单 ⇒ 悬浮窗弹出）。
       *
       * 复刻全仓既有的弹层结构（`.app-modal-mask` / `.app-modal` / `.app-modal-head` / `.app-modal-body`，
       * 与「存档管理」「放弃虫洞」同一套）：点遮罩或「✕ 关闭」都只关窗、**不动任何账**
       * （关窗顺带清掉选中 ⇒ 列表上不留一行莫名其妙的高亮）。
       * 内容与宽屏右栏**逐字同源**（同一个 `<MarketDetail>` 组件）——不另做一套窄屏版，
       * 免得"两个地方各改一半"（挂单/买入按钮的可用态都在那个组件里）。
       * 只在 `narrow && detailOpen && activeGood` 时渲染 ⇒ 宽屏整条路径不存在。
       */}
      {narrow && detailOpen && activeGood ? (
        <div className="app-modal-mask" onClick={closeDetail}>
          <div className="app-modal app-modal-wide app-mkt-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-modal-head">
              <span className="app-report-title">{goodName(engine.ctx, activeGood.key)}</span>
              <button className="app-btn is-small" onClick={closeDetail}>
                {tr('ui.App.086')}
              </button>
            </div>
            <div className="app-modal-body">
              <MarketDetail engine={engine} onToast={onToast} good={activeGood} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
