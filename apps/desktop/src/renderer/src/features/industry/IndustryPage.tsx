import { industryAvailable, RARE_WRECK_VOLUME_M3, recycleMineralPoolOf, recycleProfileOf, refineRate, visibleItemDefs, ITEM_KIND_LABELS, blueprintProducingItem } from '@whale/core'
import type { ItemDef } from '@whale/core'
import { Panel } from '@whale/ui'
import { useEffect, useState } from 'react'
import { BlueprintShelfPanel, ManufacturingPanel } from '../../panels/Industry'
import { ShipyardPanel } from '../../panels/Shipyard'
import { setSessionPick, sessionPick } from '../../ui/sessionView'
import '../../styles-unbox-ledger.css'
import { pinMarked } from '../../ui/marks'
import { AiSlotText } from '../../ui/aiSlots'
import { WRECK_SUBS, SUB_ALL, presentSubs, wreckTierOf, subText } from '../../ui/itemSubs'
import { useL10n } from '../../i18n/locale'
import { HintIcon } from '../../ui/Hint'
import type { PageProps } from '../../pages/common'
import { tr } from '../../i18n/locale'
import { ORE_KIND_LABEL, FURNACE_TABS } from './classicFilters'
import type { FurnaceTab, SubOpt } from './classicFilters'
import { IndPane } from './IndPane'
import { FurnaceCard } from './FurnaceCard'
import { LabPanel } from './LabPanel'

export function IndustryPage({ engine, onToast, onGotoMarket, onGotoMap, onGotoWormhole, onGotoPlugExchange, plugExchangeFocus, focusSec = null }: PageProps & {
  onGotoMarket?: (goodKey: string) => void
  onGotoMap?: (tab: 'mine' | 'salvage', ids: string[]) => void
  /** 「去虫洞（遗迹打捞）」：跳星图 · 出港 · 扫描虫洞（船长 2026-09-14：虫洞专属图纸市场买不到；
   *  声望不达标时组装机那张卡自己会置灰，不会走到这里） */
  onGotoWormhole?: () => void
  /** 「前往章鱼人兑换」：开**章鱼人声望商店**（**2026-09-26 船长令**：插件图纸缺书的卡走这里）。
   *  由 App 持有的统一窗口状态开，与首匣那封通讯**同一个出口**。 */
  onGotoPlugExchange?: () => void
  /** 兑换窗口开过的次数（自增序号）：变化时组装机自动切到「舰船插件」档（船长要的"跳转到筛选内"） */
  plugExchangeFocus?: number
  /** **内层段定位**（船长 2026-09-18：「第一次」卡片的跳转按钮要直达精炼炉 / 组装机）——
   *  页在切走时重挂载（`key={page}`）⇒ 取初值即可，不必 seq 机制。 */
  focusSec?: 'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab' | null
}) {
  const state = engine.state
  const rate = refineRate(state, engine.ctx)

  const [sec, setSecState] = useState<'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab'>(
    /**
     * 初值优先级：**程序化定位**（「第一次」卡片的跳转）> **会话级记忆**（2026-09-26 船长令）> 默认「精炼炉」。
     * 记忆只在本进程内有效（见 `ui/sessionView.ts`）；程序化跳转落定后同样写进记忆（见下面的 `setSec`）。
     */
    () => focusSec ?? ((sessionPick('industry.sec') as 'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab' | null) ?? 'refine'),
  )
  /** 切子页（五个签）＝ 写会话记忆；程序化跳转也走它 ⇒ 记的永远是"玩家最后看到的那个子页" */
  const setSec = (v: 'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab'): void => {
    setSecState(v)
    setSessionPick('industry.sec', v)
  }
  /**
   * **已经进过的子页**（2026-09-22 第 2 步）：进过一次就常驻，切换只切显示（详见下面渲染处的说明）。
   * 初值 = 当前那一栏（含 `focusSec` 程序化跳转进来的落点），保证首屏只挂一个面板、不做无谓冷启动。
   */
  const [seenSec, setSeenSec] = useState<ReadonlySet<'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab'>>(
    () => new Set(['refine', 'shelf', 'craft', 'shipyard', 'lab'].filter((k) => k === (focusSec ?? 'refine')) as Array<'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab'>),
  )
  useEffect(() => {
    setSeenSec((s) => (s.has(sec) ? s : new Set(s).add(sec)))
  }, [sec])
  /**
   * **首访实验室**（**2026-09-30 船长令**：「当玩家第一次进入实验室页面时，给玩家发送一封通讯，
   * 来源不能是官方（毕竟信号发射器是违法的），为玩家详细说明下信号发射器和突触加速剂」）。
   *
   * 只置随档标记（`engine.noteLabOpened()`，内部幂等）——通讯由 `advanceComms` 按标记送达并弹窗；
   * HUD 版实验室页签同一处口径（见 `IndustryHudPage.tsx`）。
   */
  useEffect(() => {
    if (sec === 'lab') engine.noteLabOpened()
  }, [sec, engine])
  useL10n()
  /**
   * **精炼炉的两级筛选**（2026-09-14 船长：「精炼炉和组装机一样，添加筛选标签」）：
   * `furnaceTab` = 一级（活计大类）· `sub` = 二级（资源大类 / 残骸档位；`''` = 全部子类）。
   * 切一级标签即回「全部子类」——与组装机、市场页 `changeKind` 同款口径。
   */
  const [furnaceTab, setFurnaceTabState] = useState<FurnaceTab>(() => {
    const v = sessionPick('industry.furnace.tab')
    return v === 'all' || v === 'ore' || v === 'wreck' || v === 'box' ? v : 'all'
  })
  const [sub, setSubState] = useState<string>(() => sessionPick('industry.furnace.sub') ?? SUB_ALL)
  /**
   * 炉子两级筛选的写入口 —— **两个都做会话级记忆**（2026-09-26 船长令，裁定「两级都记，但是不记搜索」）：
   * 切走再回来仍是"上次看的那一档 ＋ 那一子类"；`fKw`（搜索词）**刻意不记**。
   */
  const setFurnaceTab = (v: FurnaceTab): void => {
    setFurnaceTabState(v)
    setSessionPick('industry.furnace.tab', v)
  }
  const setSub = (v: string): void => {
    setSubState(v)
    setSessionPick('industry.furnace.sub', v)
  }
  /**
   * **精炼炉搜索栏**（船长 2026-09-19：「也给精炼炉和组装机添加搜索栏」；追问后定范围 =
   * **名称 ＋ 产物/材料 ＋ 说明**）：搜资源/残骸/货柜名、它们的说明，以及**产出侧的名字**
   * ——可精炼资源搜精炼产物、残骸搜保底矿物池（"某材料由什么炼出来"也搜得到）。与筛选取「与」。
   */
  const [fKw, setFKw] = useState('')
  const fq = fKw.trim().toLowerCase()
  const runViews = engine.refineRunViews()
  // 组装机「去精炼」跳转目标（矿石卡 id；高亮数秒后自清；2026-09-08 船长定）
  const [focusOreId, setFocusOreId] = useState<string | null>(null)
  /**
   * **蓝图书架 → 组装机**跳转目标（蓝图 id；船长 2026-09-14：「蓝图书架内，玩家可以通过蓝图直接跳转
   * 对应组装机」）——与 `focusOreId` 同一套高亮机制（`.app-belt-card.is-goto` + 居中滚动 + 3.5 秒自清），
   * 只是目标在组装机那一栏，所以跳的时候要**同时把组装机的三级筛选清掉**（`craftFocus` 透传给面板，
   * 面板在自己的 effect 里复位 tab/sub/useKind —— 否则目标卡可能正被筛掉，跳过去是一片空白）。
   */
  const [craftFocus, setCraftFocus] = useState<string | null>(null)
  /**
   * **组装机 → 蓝图书架的反向定位目标**（**2026-09-26 船长令**：优化工业界面 → 优3）。
   * 与 `craftFocus` 完全对称：那一头是"书架点蓝图书 → 跳组装机并高亮那张卡"，
   * 这一头是"组装机点「去书架」→ 跳蓝图书架并高亮那一本"。两者共用下面同一个滚动/自清 effect
   * （它按 `.app-belt-card.is-goto` 找当前显示栏里的高亮卡）。
   */
  const [bookFocus, setBookFocus] = useState<string | null>(null)
  useEffect(() => {
    if (!focusOreId && !craftFocus && !bookFocus) return
    // ⚠ 只找**当前显示**那一栏里的高亮卡：第 2 步保活之后，`page-stack` 下同时挂着多个 `.ind-pane`，
    //   隐藏栏里若还留着上一次的高亮（3.5 秒自清之前），全页 querySelector 可能先命中它 ⇒ 滚了个看不见的卡。
    document.querySelector('.ind-pane:not(.is-off) .app-belt-card.is-goto')?.scrollIntoView({ block: 'center' })
    const t = window.setTimeout(() => {
      setFocusOreId(null)
      setCraftFocus(null)
      setBookFocus(null) // 反向定位与正向同一套自清（3.5 秒后摘掉高亮）
    }, 3500)
    return () => window.clearTimeout(t)
  }, [focusOreId, craftFocus, bookFocus])

  /** 组装机/造船厂需求材料点击（**2026-09-22 船长令**：「**希望提示玩家去组装机生产零件，不要提示去市场**」
   *  ＋「**高级零件依旧去相应的组装机**」）——三支，优先级从上到下：
   *  ① **有精炼源矿石** ⇒ 精炼 tab 并定位该矿石卡；
   *  ② **能在这台机器上造出来**（零件 14 种 / 任何"产物是物品"的蓝图）⇒ **切到组装机并定位那张零件卡**；
   *  ③ 既炼不出也造不出 ⇒ 跳市场（原行为）。
   *  ⚠ 源矿石同样只看"玩家可见目录"：未上线矿石（如虚空母矿）不能作为跳转目标出现。
   *  ⚠ 2026-09-14：加了筛选标签之后，**必须同时把一级/二级筛选让开**——否则跳到一张被筛掉的卡上，
   *  高亮根本看不见（`setFurnaceTab('ore')` + `setSub(SUB_ALL)`）。 */
  function handleNeedMineral(itemId: string): void {
    let src = ''
    for (const def of visibleItemDefs(engine.ctx)) {
      if (def.kind === 'wreck') continue
      if ((def.refine ?? []).some((r) => r.mineralId === itemId)) {
        src = def.id
        break
      }
    }
    if (src) {
      setSec('refine')
      setFurnaceTab('ore')
      setSub(SUB_ALL)
      setFocusOreId(src)
      return
    }
    /** ② 造得出来（零件等）⇒ 去组装机那张卡（面板常驻 ⇒ 切显示 ＋ 定位高亮；零件图都在 `ctx.blueprints`） */
    const madeBy = blueprintProducingItem(engine.ctx, itemId)
    if (madeBy) {
      setSec('craft')
      setCraftFocus(madeBy.id)
      return
    }
    for (const g of engine.ctx.marketGoods.values()) {
      if (g.kind === 'item' && g.refId === itemId) {
        onGotoMarket?.(g.key)
        return
      }
    }
    onToast(tr("ui.IndustryPage.097", { p1: engine.ctx.items.get(itemId)?.name ?? itemId }), true)
  }

  /** 带精炼配方的全部矿石/气体/冰矿（2026-09-08 船长定：精炼炉默认显示所有可精炼资源；空料卡提示引导）
   *  ⚠ **走"玩家可见目录"**（`visibleItemDefs`）：未上线资源（标 `ItemDef.unreleased`，如虫洞线的虚空母矿）
   *  不进这张网格——首版直接扫 `ctx.items` 全目录，导致未上线矿连卡带描述一起挂在工业页上（2026-09-13 实测）。 */
  const allItemDefs = visibleItemDefs(engine.ctx)
  const oreDefs = allItemDefs.filter(
    (def) => def.kind !== 'wreck' && def.refine !== undefined && def.refine.length > 0,
  )
  /** B3：可回收的残骸（货仓+仓库有货或在炉中；残骸计数 = 体积 m³）。
   *  ⚠ 残骸定义按敌群运行时生成、只存在于 ctx.items——engine.items(静态目录) 里没有，
   *  之前从这里取列表导致回收卡永远不出现（2026-09-06 玩家上报）。
   *  **稀有残骸已解禁**（船长 2026-09-10：二号五族专属装备齐备后开放）——与普通残骸同列表，
   *  卡片带「高级箱」徽标；区别只在"首批触发一次高级箱"（一炉一箱）。
   *  ⚠ **H 族（墨潮帮）残骸的回收闸门已于 2026-09-26 退役**（船长 2026-09-25 曾令关炉、
   *  等势力装备；2026-09-26 三件定稿 ⇒ 理由消失）⇒ 原先那层摘卡过滤一并删除，H 族卡片照常出现。 */
  const wreckDefs = allItemDefs.filter(
    (def) =>
      def.kind === 'wreck' &&
      (industryAvailable(state, engine.ctx, def.id, 'pilot') > 0 || industryAvailable(state, engine.ctx, def.id) > 0 || runViews.some((v) => v.itemId === def.id)),
  )

  /**
   * **F4d：可拆解的货柜**（货仓 + 仓库有货、或在炉中就算一张卡）。
   *
   * ⚠ **2026-09-14 船长解闸**：原话「**虫洞已经做完了，正在微调，所以允许对玩家开放**」——
   * 这里原先沿用入口那把 `debugEnabled()` 开关（施工期只有调试模式可见），现已**改为常显**。
   * ⚠ 仍走 `engine.ctx.items` 全表（不走 `visibleItemDefs`）：这一档要认**所有** `container` 类，
   * 将来再加货柜种类也不会漏（2026-09-14 虫洞正式上线后，货柜的物品卡本身也已摘掉 `unreleased`）。
   */
  const boxDefs = [...engine.ctx.items.values()].filter(
    (def) =>
      def.kind === 'container' &&
      (industryAvailable(state, engine.ctx, def.id, 'pilot') > 0 || industryAvailable(state, engine.ctx, def.id) > 0 || runViews.some((v) => v.itemId === def.id) || engine.unboxLedgerOf(def.id) !== undefined),
  )
  const runningCount = runViews.length

  /* ── 两级筛选（2026-09-14 船长：「精炼炉和组装机一样，添加筛选标签」）──────────────────
   * 一级 = 活计大类（全部 / 可精炼资源 / 残骸回收 / 货柜拆解）；
   * 二级 = 按当前一级给候选：「可精炼资源」按**资源大类**（原矿/气体/冰矿）、
   *       「残骸回收」按**档位**（普通 / 稀有残骸）；「全部」与「货柜拆解」不带二级（同组装机）。 */
  const oreSubs: SubOpt[] = Object.keys(ORE_KIND_LABEL)
    .filter((k) => oreDefs.some((d) => d.kind === k))
    .map((k) => ({ key: k, label: ORE_KIND_LABEL[k]! }))
  /**
   * **二级候选只列真有内容的档**（2026-09-20 船长「明显不存在的子类筛选隐藏」）：
   * 可精炼资源按资源大类现算（oreDefs 里真有该大类）；残骸按档位现算（没有稀有残骸时不列「稀有」档）。
   */
  const subOptions: SubOpt[] =
    furnaceTab === 'ore'
      ? oreSubs
      : furnaceTab === 'wreck'
        ? presentSubs(WRECK_SUBS, (key) =>
            wreckDefs.some((d) => (key === 'rare' ? wreckTierOf(d.id) === 'rare' : wreckTierOf(d.id) !== 'rare')),
          )
        : []
  /**
   * **内容没了 ⇒ 原选择可能已经空档**：残骸列表是**动态**的（货仓/仓库里没有的那种残骸就不列卡）——
   * 玩家把最后一块稀有残骸投炉后，「稀有」档随之消失，若选择还停在它上面就成了**看不见的筛选**（卡片全空且无提示）。
   * 故与蓝图书架同一口径：选择不在候选里就回落到「全部子类」。
   */
  const subMissing = sub !== SUB_ALL && !subOptions.some((s) => s.key === sub)
  useEffect(() => {
    if (subMissing) setSub(SUB_ALL)
  }, [subMissing])
  /**
   * **搜索命中**（名称 ＋ 产物/材料 ＋ 说明）：`fq` 为空 ⇒ 恒真。
   * 产出侧名字：可精炼资源取 `def.refine` 的精炼产物名；残骸取 `recycleMineralPoolOf(profile)` 的保底矿物名
   * （"某材料由什么炼/拆出来"也能搜到）；货柜只按名称与说明。
   */
  const fHit = (def: ItemDef): boolean => {
    if (fq.length === 0) return true
    if (def.name.toLowerCase().includes(fq)) return true
    if ((def.description ?? '').toLowerCase().includes(fq)) return true
    // 大类名也入索引（与物品页仓库的搜索同口径）——否则搜「冰矿」会 0 命中：冰类物品名是
    // 蓝霜冰 / 寒髓冰 / 暗星冰，**不含「冰矿」二字**（2026-09-19 探针实测）
    if ((ITEM_KIND_LABELS[def.kind] ?? '').toLowerCase().includes(fq)) return true
    const outs: string[] = (def.refine ?? []).map((r) => engine.ctx.items.get(r.mineralId)?.name ?? r.mineralId)
    const prof = def.kind === 'wreck' ? recycleProfileOf(engine.ctx, def.id) : null
    if (prof) for (const [mineralId] of recycleMineralPoolOf(prof)) outs.push(engine.ctx.items.get(mineralId)?.name ?? mineralId)
    return outs.some((n) => n.toLowerCase().includes(fq))
  }
  const oreFiltered = sub === SUB_ALL ? oreDefs : oreDefs.filter((d) => d.kind === sub)
  /** 残骸档位：判据 = `wreckTierOf`（= core `isRareWreck`，与卡上的「稀有」徽标同源单点） */
  const wreckFiltered =
    sub === 'rare'
      ? wreckDefs.filter((d) => wreckTierOf(d.id) === 'rare')
      : sub === 'common'
        ? wreckDefs.filter((d) => wreckTierOf(d.id) !== 'rare')
        : wreckDefs
  const oreShownF = pinMarked(state, 'recipes', oreFiltered.filter(fHit), (def) => def.id)
  const wreckShownF = pinMarked(state, 'recipes', wreckFiltered.filter(fHit), (def) => def.id)
  const boxShownF = boxDefs.filter(fHit)
  /** 一级标签实际要渲染哪几组（「全部」= 四组都渲染，其余只渲染对应那一组） */
  const showOre = furnaceTab === 'all' || furnaceTab === 'ore'
  const showWreck = furnaceTab === 'all' || furnaceTab === 'wreck'
  const showBox = furnaceTab === 'all' || furnaceTab === 'box'
  /** 当前筛选/搜索下"一共几张卡"（读数行用；与组装机的「· 当前 N 张」同款） */
  const shownCount =
    (showOre ? oreShownF.length : 0) + (showWreck ? wreckShownF.length : 0) + (showBox ? boxShownF.length : 0)
  const totalCount = oreDefs.length + wreckDefs.length + boxDefs.length

  return (
    <div className="page-stack page-fill app-industry-page">
      {/* 功能标签页（与星图页同款 app-subtabs 规范）：精炼炉 / 蓝图书架 / 组装机 */}
      <div className="app-subtabs" role="tablist">
        <button
          role="tab"
          aria-selected={sec === 'refine'}
          className={`app-subtab${sec === 'refine' ? ' is-active' : ''}`}
          onClick={() => setSec('refine')}
        >
          <span>♨</span>
          <span>{tr("ui.ShipPage.097")}</span>
        </button>
        <button
          role="tab"
          aria-selected={sec === 'craft'}
          className={`app-subtab${sec === 'craft' ? ' is-active' : ''}`}
          onClick={() => setSec('craft')}
        >
          <span>⚒</span>
          <span>{tr("ui.IndustryPage.059")}</span>
        </button>
        <button
          role="tab"
          aria-selected={sec === 'shipyard'}
          className={`app-subtab${sec === 'shipyard' ? ' is-active' : ''}`}
          onClick={() => setSec('shipyard')}
        >
          <span>⚓</span>
          <span>{tr("ui.IndustryPage.110")}</span>
        </button>
        {/* **实验室**（**2026-09-29 船长令**）：**门槛后才出现**（首座空间站建成 ⇒ `labUnlocked`）——
            不是灰掉，是不渲染（船长口径：门槛前"看不到相关内容"）。
            ⚠ **2026-10-01 船长令**：「将实验室的子页面标签移动到蓝图书架前面」⇒ 本块整体上移到
            蓝图书架之前（顺序：精炼炉 → 组装机 → 造船厂 → **实验室** → 蓝图书架）。 */}
        {engine.labUnlocked() ? (
          <button
            role="tab"
            aria-selected={sec === 'lab'}
            className={`app-subtab${sec === 'lab' ? ' is-active' : ''}`}
            onClick={() => setSec('lab')}
          >
            <span>⚗</span>
            <span>{tr("ui.lab.001")}</span>
          </button>
        ) : null}
        <button
          role="tab"
          aria-selected={sec === 'shelf'}
          className={`app-subtab${sec === 'shelf' ? ' is-active' : ''}`}
          onClick={() => setSec('shelf')}
        >
          <span>▦</span>
          <span>{tr("ui.IndustryPage.060")}</span>
        </button>
      </div>

      {/* ═══ 四个子页**保活**（2026-09-22 工业页卡顿修复第 2 步）═══
          原先这里是 `sec === 'craft' ? … : sec === 'shipyard' ? …` 的三元链：同一时刻只挂载一个子页，
          ⇒ 每次切换 = 旧面板整棵卸载 + 新面板从零重建（实测组装机 151 张卡 8298 节点：1× 花 75 ms、
          弱机档 700 ms，"数秒的卡顿"正是它）。现在改成**首次进入才挂载、之后常驻**，切换只切显示：
          `.ind-pane` 用 `display: contents`（面板照旧直接参与 `.page-stack` 的 flex 布局，不引入多余盒子），
          隐藏时 `display: none`（不占位、不参与布局与绘制）。
          ⚠ 与第 3 步配套：面板常驻后每次心跳仍会重渲染 ⇒ 靠卡片的实时指纹 `memo` 兜住，否则代价 ×4。
          ⚠ 行为变化（已报船长）：面板内部的筛选/搜索/滚动位置**不再因切换而复位**。 */}
      {seenSec.has('craft') ? (
        <IndPane scrollKey="industry.craft.scroll" off={sec !== 'craft'}>
          <ManufacturingPanel
            engine={engine}
            onToast={onToast}
            onNeedMineral={handleNeedMineral}
            onGotoMarket={onGotoMarket}
            onGotoWormhole={onGotoWormhole}
            onGotoPlugExchange={onGotoPlugExchange}
            /**
             * **组装机 → 蓝图书架的反向入口**（**2026-09-26 船长令**：优化工业界面 → 优3）：
             * 与书架→组装机**同一套手法**（切子页 ＋ 定位高亮），只是方向反过来。
             */
            onGotoShelf={(bpId) => {
              setSec('shelf')
              setBookFocus(bpId)
            }}
            plugExchangeFocus={plugExchangeFocus}
            focusBlueprintId={craftFocus}
          />
        </IndPane>
      ) : null}
      {seenSec.has('shipyard') ? (
        <IndPane scrollKey="industry.shipyard.scroll" off={sec !== 'shipyard'}>
          <ShipyardPanel
            engine={engine}
            onToast={onToast}
            onNeedMineral={handleNeedMineral}
            onGotoMarket={onGotoMarket}
            onGotoWormhole={onGotoWormhole}
            focusBlueprintId={craftFocus}
          />
        </IndPane>
      ) : null}
      {seenSec.has('shelf') ? (
        <IndPane scrollKey="industry.shelf.scroll" off={sec !== 'shelf'}>
          <BlueprintShelfPanel
            engine={engine}
            onToast={onToast}
            onGotoMarket={onGotoMarket}
            focusBookId={bookFocus}
            onGotoCraft={(bpId) => {
              // 2026-09-20 零件体系：舰船书跳造船厂、其余书跳组装机；切栏 + 定位高亮那张卡
              setSec(engine.ctx.shipBlueprints.has(bpId) ? 'shipyard' : 'craft')
              setCraftFocus(bpId)
            }}
          />
        </IndPane>
      ) : null}
      {seenSec.has('refine') ? (
      <IndPane scrollKey="industry.refine.scroll" off={sec !== 'refine'}>
        <Panel
          className="is-fill win-fixed-body"
          title={tr("ui.ShipPage.097")}
          hint={
            <HintIcon
              tip={tr("ui.IndustryPage.098", { RARE_WRECK_VOLUME_M3: RARE_WRECK_VOLUME_M3 })}
            />
          }
          right={
            <>
              {/* 搜索栏（船长 2026-09-19）：与物品页/货仓/技能/舰船页/手册同款（标题行右侧） */}
              <span className="app-head-search-wrap">
                <input
                  className="app-head-search"
                  type="text"
                  placeholder={tr('ui.IndustryPage.111')}
                  value={fKw}
                  onChange={(e) => setFKw(e.target.value)}
                  spellCheck={false}
                />
              </span>
              <span
                className="app-dim"
                title={tr("ui.IndustryPage.061")}
              >
                {tr("ui.IndustryPage.062")} {Math.round(rate * 100)}{tr('ui.IndustryPage.102', { n: runningCount })} {tr("ui.IndustryPage.063")} {oreDefs.length}{tr('ui.IndustryPage.103', { n: wreckDefs.length })}
                {boxDefs.length > 0 ? tr("ui.IndustryPage.099", { p1: boxDefs.length }) : ''}
                {/* 搜索/筛选生效时补读数（与组装机同款：免得玩家对着收窄后的网格数不清） */}
                {fq.length > 0
                  ? tr('ui.IndustryPage.108', { n: shownCount })
                  : shownCount !== totalCount
                    ? tr("ui.IndustryPage.100", { shownCount: shownCount })
                    : ''}
              </span>
              <AiSlotText state={state} ctx={engine.ctx} />
            </>
          }
        >
          {/* 筛选固定、说明进标题后的圆形感叹号（固定头 + 下滚）：一级标签行 / 二级子筛选行常驻，
              卡网格独立内滚 —— 与组装机逐项同款（`.app-task-tabs` + `.app-tasktab`，二级行去下边框） */}
          <div className="app-task-tabs" role="tablist">
            {FURNACE_TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={furnaceTab === t.key}
                className={`app-tasktab${furnaceTab === t.key ? ' is-active' : ''}`}
                onClick={() => {
                  setFurnaceTab(t.key)
                  setSub(SUB_ALL) // 换一级标签即回「全部子类」（与组装机、市场页 changeKind 同款）
                }}
              >
                {subText(t)}
              </button>
            ))}
          </div>
          {subOptions.length > 0 ? (
            <div className="app-task-tabs app-fleet-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={sub === SUB_ALL}
                className={`app-tasktab${sub === SUB_ALL ? ' is-active' : ''}`}
                onClick={() => setSub(SUB_ALL)}
              >
                {tr("ui.IndustryPage.064")}
              </button>
              {subOptions.map((s) => (
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
          ) : null}
          <div className="app-win-body">
          {totalCount === 0 ? (
            <div className="app-dim app-inv-empty">
              {tr("ui.IndustryPage.065")}
            </div>
          ) : null}
          {shownCount === 0 && totalCount > 0 ? (
            <div className="app-dim app-exp-idle">{tr("ui.IndustryPage.066")}</div>
          ) : null}

          {showOre && oreShownF.length > 0 ? (
            <div className="app-belt-grid">
              {oreShownF.map((def) => (
                <FurnaceCard key={def.id} def={def} engine={engine} onToast={onToast} highlight={focusOreId === def.id} onGotoMap={onGotoMap} />
              ))}
            </div>
          ) : null}

          {showWreck && wreckShownF.length > 0 ? (
            <div className="app-belt-grid">
              {wreckShownF.map((def) => (
                <FurnaceCard key={def.id} def={def} engine={engine} onToast={onToast} onGotoMap={onGotoMap} />
              ))}
            </div>
          ) : null}

          {showBox && boxShownF.length > 0 ? (
            <div className="app-belt-grid">
              {boxShownF.map((def) => (
                <FurnaceCard key={def.id} def={def} engine={engine} onToast={onToast} onGotoMap={onGotoMap} />
              ))}
            </div>
          ) : null}
          {showBox && boxShownF.length === 0 ? (
            <div className="app-dim app-exp-idle">
              {fq.length > 0
                ? tr('ui.IndustryPage.109')
                : tr("ui.IndustryPage.067")}
            </div>
          ) : null}
          </div>
        </Panel>
      </IndPane>
      ) : null}
      {/* 实验室（**2026-09-29 船长令**）：与其余四页同一套保活手法（`IndPane` + 会话滚动记忆） */}
      {engine.labUnlocked() && seenSec.has('lab') ? (
        <IndPane scrollKey="industry.lab.scroll" off={sec !== 'lab'}>
          <LabPanel
            engine={engine}
            onToast={onToast}
            onGotoMarket={onGotoMarket}
            onNeedMaterial={handleNeedMineral}
            onGotoPlugExchange={onGotoPlugExchange}
          />
        </IndPane>
      ) : null}
    </div>
  )
}
