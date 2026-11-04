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
  // 2026-09-14 船长：奇货从稀有订单里独立成第三个标签（「限定奇货」· 图标 ◈ · 常态显示）
  const rareCol = goods.filter((g) => g.rarity === 'rare')
  const exoticCol = goods.filter((g) => g.rarity === 'exotic')
  /**
   * **子标签**（船长 2026-09-22：「**市场内，将我的挂单放入和常驻订单同级的子页面内，位置排在第一位，
   * 但是玩家进入市场时，默认还是打开常驻订单。**」）：
   * ⇒ 「我的挂单」成了同级子页面、排第一位；**初值仍是 `'common'`**（位置变了、默认没变）。
   * 它原先挂在右栏详情卡下方（2026-09-08 那次改判），本轮搬进左栏标签页（挂单列表因此独占一页）。
   */
  const [mktTab, setMktTab] = useState<'mine' | 'common' | 'rare' | 'exotic'>('common')
  // 外部聚焦（如舰船页"去市场"）：focusSeq 递增时把搜索词设为指定商品 key（像玩家自己搜的一样）
  const [kw, setKw] = useState('')
  // 行情详情选中商品（船长 2026-09-05：行内「 详情」/外部聚焦展开）
  const [selKey, setSelKey] = useState<string | null>(null)
  /**
   * **窄屏（视口 ≤1180px）＝ 单栏**：此时"市场详情"改**悬浮窗**（船长 2026-09-21）——
   * 原话：「**在手机或者窄屏的情况下，很难翻到市场详细，建议，当出现将市场详细压缩到订单列表下方时，
   * 隐藏市场详细。玩家点击某个订单时，以悬浮窗的形式弹出。（仅限手机或者窄屏）**」
   *
   * ⚠ **断点必须与 CSS 同源**：单栏由 `styles.css` 的 `@media (max-width: 1180px) { .app-mkt-split
   * { grid-template-columns: 1fr } }` 决定 ⇒ 这里用**同一个 1180**（改一处必改另一处，`ui:rot-check`
   * 的窄窗白名单与这条断点同尺）。用 `max-width` 而非测量容器：CSS 用的是视口查询，量容器会在
   * "窗口恰好 1180"这类边界上与 CSS 判得不一样。
   */
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1180px)').matches,
  )
  /** 窄屏下的详情浮窗（只有点了订单才开；宽屏恒为 false、整条路径不参与） */
  const [detailOpen, setDetailOpen] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1180px)')
    const sync = (): void => setNarrow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  /**
   * 窄屏 ⇒ **不默认选中**（否则"隐藏了详情却还高亮第一行"看着莫名其妙）；
   * `focusSeq`（外部聚焦，如舰船页「去市场」）仍会把 `selKey` 写上 ⇒ 窄屏那条路径直接开浮窗。
   */
  const defaultSelKey = narrow ? null : stockedFirst(engine, common)[0]?.key ?? null
  const activeSelKey = selKey ?? defaultSelKey
  /**
   * **列表高亮用的选中键**：窄屏恒为 `null`（详情在浮窗里，列表上再留一行高亮反而误导——船长 2026-09-21 口径），
   * 而浮窗仍读 `activeGood`（由 `selKey` 推出）⇒ 两者共用同一个 `selKey`，只在**传给列表**这一路掐掉。
   */
  const listSelKey = narrow ? null : activeSelKey
  const activeGood = activeSelKey ? goods.find((g) => g.key === activeSelKey) ?? null : null
  useEffect(() => {
    if (narrow && selKey !== null) setDetailOpen(true)
  }, [narrow, selKey])
  /** 详情浮窗的开关（关闭 = 连选中一起清掉，行高亮不留在屏幕上） */
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
      // 一次性聚焦（2026-09-08 修复）：应用后通知 App 清空，避免每次进市场都默认带出上次查看的物品
      onFocusUsed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq])

  // 页面级全局搜索（船长 2026-09-05）：搜索栏从各栏内取出；输入/类型过滤时同时检索常驻 / 稀有 / 限定奇货
  // （三档商品集互不重叠——rarity 单值归属，跨档合并不会重复条目）。
  const [kind, setKind] = useState<KindFilter>(DOMAIN_ALL)
  const [sub, setSub] = useState<string>(SUB_ALL)
  const [detail, setDetail] = useState(SUB_ALL)
  const [rack, setRack] = useState(SUB_ALL)
  const domainText = Object.fromEntries(MARKET_DOMAIN_TABS.map((tab) => [tab.key, subText(tab)]))
  const query = kw.trim().toLowerCase()
  const filterActive = query.length > 0 || kind !== DOMAIN_ALL
  /** **道具逐件档的档名解析器**（2026-10-02 船长令）：档名 = 那件道具自己的名字，从物品表单点取，
   *  中英随物品表走 ⇒ 不在 `ui/itemSubs.ts` 里再抄一份名字（`subText` 的第二个参数）。 */
  const itemNameOf = (id: string): string | undefined => engine.ctx.items.get(id)?.name
  /**
   * **二级子分类：只列该类型下真有商品的档**（2026-09-20 船长「明显不存在的子类筛选隐藏」）——
   * 船长点名的例子：「市场-高槽装备-护盾」（护盾是中槽件，高槽下恒空）⇒ 该档不再出现；
   * 判据复用市场自己的两把尺（kindPasses + subPasses），「全部」档常显（基线②）。
   */
  const kindSubs: SubOption[] | undefined =
    kind === DOMAIN_ITEM
      ? ITEM_DOMAIN_SUBS.filter((s) => goods.some((g) => domainPasses(engine.ctx, g, DOMAIN_ITEM, s.key)))
      : kind === DOMAIN_SHIP
        ? SHIP_DOMAIN_SUBS.filter((s) => goods.some((g) => domainPasses(engine.ctx, g, DOMAIN_SHIP, s.key)))
      : undefined
  /** 切换主类型时子分类回到"全部子类" */
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
  /** 「我的挂单」行内跳转：按该商品搜索（跨栏合并显示）并打开行情详情（2026-09-08 船长定） */
  const jumpToOrder = (goodKey: string): void => {
    setKw(goodKey)
    changeKind(DOMAIN_ALL)
    setSelKey(goodKey)
    if (narrow) setDetailOpen(true)
  }
  /**
   * **点一行订单**（船长 2026-09-21）：宽屏 = 照旧把它送进右栏常驻详情；**窄屏 = 弹详情浮窗**。
   *
   * ⚠ **2026-09-21 修复（船长报障「手机模式下，市场页面，点击订单不会弹出订单详细」）**：
   * 初版窄屏这条路**只开窗、不写 `selKey`**，而浮窗的渲染条件是 `narrow && detailOpen && activeGood`，
   * 其中 `activeGood` 由 `selKey ?? defaultSelKey` 推出——**窄屏的 `defaultSelKey` 恒为 null**
   * （窄屏不默认选中）⇒ `activeGood` 永远是 null ⇒ **浮窗一个都不渲染**（点了没反应）。
   * 现在两条路都写 `selKey`（浮窗靠它取商品）；「窄屏列表不留行高亮」那一半改由
   * `listSelKey`（窄屏恒 null）在**传参**那侧掐掉，语义各归各位。
   */
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
    // `app-mkt-page`：窄窗（≤1180px，单栏）时本页**放开「一级页不滚」**——船长 2026-09-14：
    // 「放宽闸门，允许市场页面在这种情况下出现滚动条。让所有子窗口完整显示」（见 styles.css 同名断点块）
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
