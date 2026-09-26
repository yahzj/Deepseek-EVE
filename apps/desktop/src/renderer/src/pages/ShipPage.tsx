/**
 * 舰船页：我的舰队（耐久/维修/切换驾驶）+ AI 指挥中心 + 空间站商店。
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AI_CORE_ORDER,
  aiCoreCap,
  aiCoreUsed,
  aiCoreShipUsed,
  aiCoreIndustryUsed,
  aiCoreName,
  aiTaskView,
  aiEfficiency,
  industryAiBonus,
  countAiCore,
  goodLockedReason,
  idleAiShipIds,
  isExplored,
  marketQuote,
  shipCategoryKeyOf,
  missingMaterials,
  oreAvailable,
  ownsBlueprint,
  manufacturingRunViews,
  // 2026-09-13：站内工业目标只列玩家可见的资源（未上线资源不进 AI 精炼炉下拉）
  visibleItemDefs,
  // 舰船仓库（2026-09-14 船长）：仓库计数 / 入仓逐档判据（core 单点，与引擎同源）
  shipStoredCount,
  shipStorable,
  // 2026-09-26 船长：「舰队页面…悬停舰船时，应该显示舰船的当前属性，而不是基础属性」
  // ⇒ 悬停卡改报装后合成值（与装配页/战斗同源：createPlayerSpec ＋ 有效跃迁速度 ＋ 机舱合计）
  createPlayerSpec,
  droneBayTotalM3,
  warpBonusMult,
  warpSpeedAus,
} from '@whale/core'
// 2026-09-23 船长令：使用 AI 核心时默认选「当前拥有的最高级核心」
import { bestAiCoreOf } from '@whale/core'
import type { AiCoreType, FleetShipState, ShipRole } from '@whale/core'
import { durabilityOf, repairCostIsk, shipDisplayName } from '@whale/core'
import { Panel } from '@whale/ui'
import { ShipHover } from '../ui/shipInfo'
import { useSessionScroll } from '../ui/sessionView'
import type { GameEngine } from '../game/engine'
import type { ShipDef } from '@whale/core'
import { ShipSprite } from '../ui/ShipSprite'
import { AiTaskBar } from '../ui/aiProgress'
import { AiWorkFx } from '../ui/aiWorkFx'
import type { AiWorkKind } from '../ui/aiWorkFx'
import { Glyph, NAV_TONES, ICO_TONES } from '../ui/Glyphs'
import { MarkStar, pinMarked } from '../ui/marks'
import {
  FLEET_STATE_TABS,
  SHIP_SUBS,
  SHIP_TIER_SUBS,
  STORE_OWN_TABS,
  SUB_ALL,
  shipRolePasses,
  shipTierPasses, subText } from '../ui/itemSubs'
import type { PageProps } from './common'
import { isk } from './common'
import { tr, cmdText } from '../i18n/locale'
import { shipRoleText } from '../ui/labelsText'

// ── 舰队卡片左侧舰影（2026-09-10 船长：每艘船的舰船形象放在对应卡片最左侧展示；
//    屏幕宽度不足时隐藏舰船图形）──
/** 舰影列宽（固定尺寸，内容变化不引起卡片跳动） */
const FLEET_ART_W = 132
/** 舰影列与右侧信息列的间距（与 .app-ship-card.is-fleet 的 gap 保持一致） */
const FLEET_ART_GAP = 10
/** 右侧信息列可读下限（名称+徽章行 / 装配工具行 / 耐久与按钮行；再窄就藏舰影） */
const FLEET_MAIN_MIN = 560

/**
 * 舰队卡片舰影（置卡片最左侧）。
 * memo：引擎每 tick 触发整树重渲染（App 层订阅 force），舰影 props 恒定即整棵 SVG 子树跳过 diff，
 * 不为列表里的每艘船每 tick 重算——图形是纯展示件，与引擎状态无关。
 */
const FleetArt = memo(function FleetArt({ shipId, role }: { shipId: string; role: ShipRole }) {
  return (
    <div className="app-ship-art" aria-hidden="true">
      <ShipSprite shipId={shipId} role={role} size={FLEET_ART_W} engine={false} />
    </div>
  )
})

/** 市场稀有度中文标签 */
function rarityLabel(rarity: 'common' | 'rare' | 'exotic'): string {
  return rarity === 'common' ? tr("ui.MarketPage.010") : rarity === 'rare' ? tr("ui.IndustryPage.035") : tr("ui.MarketPage.028")
}

/** 舰船页标签（MapPage/IndustryPage 同款 app-subtabs 规范，2026-09-05）
 *  ⚠ 2026-09-14 船长：「先将舰队页面中的舰船市场换成舰船仓库」⇒ 第三档 `'shop'`（舰船市场）**整档换成**
 *  `'store'`（舰船仓库）；**购买入口不丢**——买卖本来就在市场页，仓/库卡片行内保留「去市场查看 / 下单」。 */
export type ShipTab = 'fleet' | 'ai' | 'store'
/** 舰队检索（2026-09-10 船长：筛选 + 搜索，控件样式与仓库/技能目录统一；
 *  2026-09-11 船长：「**移除排序选项，改为按照舰船级别划分的子筛选**」——
 *  排序下拉（默认/名称/耐久/舰族）整条退场，改由**舰船级别**子筛选（`SHIP_TIER_SUBS`，与组装机同一张单点表）收窄；
 *  列表顺序固定为「机库序 + 已标记置顶」（即原「默认排序」口径，收藏置顶规则继续成立）。
 *  ⚠ 2026-09-19 乙组：「状态」维度表已按基线⑤收编到 `ui/itemSubs.ts`（`FLEET_STATE_TABS`），
 *  类别/级别判据也改读那里的唯一入口（`shipRolePasses` / `shipTierPasses`）。 */

/** AI 指挥中心可指派的任务类型（2026-09-10 船长：统一全部 AI 可执行活动）——
 *  副船三类：采矿/打捞/掩护巡逻；站内工业两类：精炼炉与回收炉/组装机制造。
 *  远征不在其列（引擎软下线，一律拒绝受理）。 */
type AiAssignMode = 'mining' | 'salvage' | 'standby' | 'refine' | 'craft'
/** 站内制造线可选的已学会蓝图（含材料单，供缺料判定与提示） */
// l10n-keep-start：本段的中文全是**联合类型 key / 分组 key**（显示时走 CRAFT_GROUPS 的 id 取词），不是文案
interface CraftOption {
  id: string
  name: string
  group: '装备蓝图' | '舰船蓝图' | '消耗品蓝图'
  materials: readonly { itemId: string; count: number }[]
  buildSeconds: number
}
/** 组装机下拉的分档顺序与译名 id（`CraftOption.group` 是**字面量联合 key**，显示时才按 id 取译名） */
const CRAFT_GROUPS: ReadonlyArray<{ key: CraftOption['group']; id: string }> = [
  { key: '装备蓝图', id: 'ui.ShipPage.115' }, // l10n-keep：联合 key，不是文案（渲染处 tr(id)）
  { key: '舰船蓝图', id: 'ui.ShipPage.116' }, // l10n-keep
  { key: '消耗品蓝图', id: 'ui.ShipPage.114' }, // l10n-keep
]
const SHIP_TABS: Array<{ key: ShipTab; label: string; icon: string; title?: string }> = [
  { key: 'fleet', label: tr("ui.ShipPage.001"), icon: 'nav-ship' },
  { key: 'ai', label: tr("ui.ShipPage.057"), icon: 'nav-ai', title: tr("ui.ShipPage.120") },
  // 2026-09-14 船长：「舰船市场」→「舰船仓库」（图标沿用物品仓库那只箱子，语义 = 存放）
  { key: 'store', label: tr("ui.ShipPage.036"), icon: 'nav-items', title: tr("ui.ShipPage.121") },
]

/** 舰船仓库「拥有」筛选（2026-09-14 船长裁定**乙**：只看**仓库库存**——
 *  仓里有货 = 已拥有；仓里为空 = 未拥有，即使在役舰队有同型）。
 *  ⚠ 2026-09-19 乙组：表已收编到 `ui/itemSubs.ts`（`STORE_OWN_TABS`）。 */

/**
 * **舰队页悬停卡 = 当前属性**（船长 2026-09-26：「我的舰队页面中，玩家鼠标悬停舰船时，
 * 应该显示舰船的当前属性，而不是基础属性」）。
 *
 * 与装配页 / 战斗**同一把尺**：`createPlayerSpec` 合成装后血量·抗性·命中·回避·速度，
 * 跃迁速度走 `warpSpeedAus` / `warpBonusMult`（跃迁计算机加成），机舱走 `droneBayTotalM3`
 * （船体 ＋ 甲板扩展）。图鉴 / 市场 / 船坞的悬停卡**不传** current ⇒ 仍按船长同日裁定
 * 「图鉴内按照基础属性算」报**基础属性**。
 */
function FleetShipHover({
  uid,
  ship,
  engine,
  children,
  block = true,
}: {
  uid: string
  ship: ShipDef
  engine: GameEngine
  children: ReactNode
  block?: boolean
}): ReactNode {
  const spec = createPlayerSpec(engine.state, engine.ctx, uid)
  // 船不在编队里（理论上到不了这里）⇒ 退回基础属性卡，不显示半截合成值
  if (!spec) {
    return (
      <ShipHover ship={ship} block={block}>
        {children}
      </ShipHover>
    )
  }
  return (
    <ShipHover
      ship={ship}
      block={block}
      current={{
        spec,
        battle: engine.ctx.balance.battle,
        effWarp: { aus: warpSpeedAus(engine.state, engine.ctx, uid), bonusPct: warpBonusMult(engine.state, engine.ctx, uid) - 1 },
        droneBayTotal: droneBayTotalM3(ship, engine.state.fleet[uid]?.fitted, engine.ctx),
      }}
    >
      {children}
    </ShipHover>
  )
}

export function ShipPage({
  engine,
  onToast,
  tab,
  onTab,
  onGotoMarket,
  onGotoFit,
}: PageProps & {
  tab?: ShipTab
  onTab?: (t: ShipTab) => void
  onGotoMarket?: (goodKey: string) => void
  /** 进入某船的装配页（船长 2026-09-05：舰队卡片按钮直达该船装配） */
  onGotoFit?: (shipId: string) => void
}) {
  const state = engine.state
  const ctx = engine.ctx
  // 标签页（受控可选：App 跳 AI 中心时切到 ai）
  const [localTab, setLocalTab] = useState<ShipTab>('fleet')
  const activeTab = tab ?? localTab
  const setActiveTab = onTab ?? setLocalTab
  /** 2026-09-14 船长：**移入舰船仓库**替换原先的「市价出售」（出售统一到舰船仓库）。
   *  `storeConfirmId` = 正在展开"入仓会清掉自定义名"确认的那艘船（有名字时才需要确认）。 */
  const [storeConfirmId, setStoreConfirmId] = useState<string | null>(null)
  /**
   * **换驾驶的中断确认**（**2026-09-20 船长令**）：正在跑长途运输时换驾驶会中断本趟
   * （`shipyard.changeShip` 的 `cancelHaulingOnSwitch`）⇒ 第一次点只警告、再点一次才真换。
   * 记的是"正在等确认的那艘 uid"。
   */
  const [switchAskId, setSwitchAskId] = useState<string | null>(null)
  // 2026-09-09 切换驾驶高亮（船长定：无缝切换易误判）：成功后目标船卡 + 「当前驾驶」行做一次约 0.8 秒脉冲
  const [switchFxUid, setSwitchFxUid] = useState<string | null>(null)
  const switchFxTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (switchFxTimer.current !== null) window.clearTimeout(switchFxTimer.current)
  }, [])
  function flashSwitchPilot(uid: string): void {
    setSwitchFxUid(uid)
    if (switchFxTimer.current !== null) window.clearTimeout(switchFxTimer.current)
    switchFxTimer.current = window.setTimeout(() => setSwitchFxUid(null), 800)
  }
  // T5-B：正在改名（输入框展开）的船实例 + 草稿
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  // 2026-09-10 舰队检索：搜索词 / 状态筛选；2026-09-11 船长：排序键退场，改「舰船级别」子筛选 +
  // 「舰船类别」（角色）子筛选；2026-09-12 船长：「将级别和类别筛选对调，玩家先选择类别，再选级别」
  const [fleetQ, setFleetQ] = useState('')
  const [fleetFilter, setFleetFilter] = useState<string>(SUB_ALL)
  const [fleetTier, setFleetTier] = useState<string>(SUB_ALL)
  const [fleetRole, setFleetRole] = useState<string>(SUB_ALL)

  // ── 舰影列自适应（2026-09-10 船长：每艘船的舰船形象置卡片最左侧；屏幕宽度不足时隐藏图形）──
  // 判定取舰队列表容器的**实测宽**（clientWidth 已扣竖向滚动条），不用窗口宽猜：
  // 卡片高由右侧信息列决定（舰影更矮），故舰影显示/隐藏不会反过来改变容器宽，无振荡。
  const fleetScrollRef = useRef<HTMLDivElement | null>(null)
  /**
   * **舰队列表滚动位置 · 会话级记忆**（2026-09-26 船长令：「记住…滚动条位置」，只做主要列表那一条）。
   * 与上面那支量宽 ref **共用同一个 DOM 节点**（`useSessionScroll` 是"接手"ref、不新建）。
   */
  useSessionScroll('ship.fleet.scroll', fleetScrollRef)
  /** 舰船仓库签的主列表滚动位置（同款记忆；仓库签自带一支容器） */
  const storeScrollRef = useRef<HTMLDivElement | null>(null)
  useSessionScroll('ship.store.scroll', storeScrollRef)
  const [fleetArt, setFleetArt] = useState(false)
  useLayoutEffect(() => {
    const el = fleetScrollRef.current
    if (!el) return
    const update = (): void => {
      const show = el.clientWidth >= FLEET_ART_W + FLEET_ART_GAP + FLEET_MAIN_MIN
      setFleetArt((old) => (old === show ? old : show))
    }
    update() // 首帧先量一次（布局阶段、绘制前，无闪烁）
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [activeTab])

  /** 舰队里所有船实例（v17：同型多艘各自成卡；当前驾驶在前） */
  const fleetEntries = Object.entries(state.fleet)
    .map(([uid, entry]) => ({ uid, ship: entry, def: ctx.ships.get(entry.defId ?? uid) }))
    .filter((x): x is { uid: string; ship: FleetShipState; def: NonNullable<ReturnType<typeof ctx.ships.get>> } => x.def !== undefined)
    .sort(
      (a, b) =>
        Number(b.uid === state.shipId) - Number(a.uid === state.shipId) ||
        a.def.tier - b.def.tier ||
        a.uid.localeCompare(b.uid),
    )

  /** 舰队检索结果（2026-09-10 船长：先按状态/关键词过滤；2026-09-11：叠加**舰船级别**与**类别**；
   *  2026-09-12 船长：**类别与级别对调顺序**（先类别、后级别），**两维各自独立判定、不再级联**；
   *  顺序恒为机库序 + 收藏置顶） */
  const fleetTotal = Object.keys(state.fleet).length
  const fq = fleetQ.trim().toLowerCase()
  /** 任一维筛选或搜索词生效（标题行的计数据此在「N 艘 / 匹配 N / 共 M 艘」之间切换） */
  const fleetFiltered = fq.length > 0 || fleetFilter !== SUB_ALL || fleetTier !== SUB_ALL || fleetRole !== SUB_ALL
  const fleetShown = (() => {
    const list = fleetEntries.filter(({ uid, ship }) => {
      if (fq.length > 0) {
        const name = shipDisplayName(state, ctx, uid).toLowerCase()
        const defName = (ctx.ships.get(ship.defId ?? uid)?.name ?? '').toLowerCase()
        if (!name.includes(fq) && !defName.includes(fq)) return false
      }
      if (fleetFilter !== SUB_ALL) {
        const dur = durabilityOf(state, uid)
        const armor = ship.armorPct ?? 1
        const isPilot = uid === state.shipId
        const isAi = uid in state.aiAssignments
        const ok =
          fleetFilter === 'pilot'
            ? isPilot
            : fleetFilter === 'ai'
              ? isAi
              : fleetFilter === 'idle'
                ? !isPilot && !isAi
                : dur < 1 || armor < 1 // damaged：耐久或装甲未满 = 待维修
        if (!ok) return false
      }
      // 舰船类别子筛选（2026-09-12 船长：与级别对调顺序 —— 类别为上位、先选）
      // 键 = **派生类别判据** `shipCategoryKeyOf`（2026-09-16 船长：装甲线 = role 为 armored，
      // 或武装舰里装甲占比 > 护盾占比「丙案：只在武装舰里判」）——判据走唯一入口 `shipRolePasses`
      // （2026-09-19 乙组：舰船仓库与市场原先用原始 role，两处已统一到同一把尺）
      const shipDef = ctx.ships.get(ship.defId ?? uid)
      if (!shipRolePasses(shipDef, fleetRole)) return false
      // 舰船级别子筛选（2026-09-12 船长：为下位、后选）：键 `t<级别>`，与组装机「舰船蓝图」子筛选同一张单点表
      // ⚠ 各维“与”关系、互不重置；两维都选具体值时可能出现**空组合**（T4/T5 无采矿舰与武装舰等），
      // 属船长已确认的取舍（船长选「始终出全五档 + 各类别」，不隐藏空档）
      if (!shipTierPasses(shipDef, fleetTier)) return false
      return true
    })
    // 2026-09-10 船长定：已标记（收藏）的船置顶（原「默认排序」口径；排序键已退场，恒走这一条）
    return pinMarked(state, 'ships', list, (x) => x.uid)
  })()

  function handleSwitch(id: string): void {
    // 2026-09-15 起：星系扫描是无人扫描艇（不占主控、不牵动舰船）⇒ 换驾驶不再需要"先终止扫描"的确认
    /**
     * **长途运输会因换驾驶而中断**（`shipyard.changeShip` 里 `cancelHaulingOnSwitch`）⇒
     * **2026-09-20 船长令**：先弹一次警告（**本趟报酬到站才结，中断就拿不到**），再点一次才真换。
     * 与活动栏「停止运输」/长途运输页那颗按钮同一把尺、同一组文案（`ui.Hauling.033~035`）。
     */
    if (engine.state.hauling.active && switchAskId !== id) {
      setSwitchAskId(id)
      onToast(tr('ui.Hauling.033'), true)
      return
    }
    setSwitchAskId(null)
    const r = engine.changeShipAt(id)
    if (!r.ok) onToast(cmdText(r) || tr('ui.ShipPage.189'), true)
    else flashSwitchPilot(id)
  }

  function handleRepair(id: string): void {
    const r = engine.repairShipAt(id)
    if (!r.ok) onToast(cmdText(r) || tr('ui.ShipPage.190'), true)
    else onToast(tr("ui.ShipPage.153"))
  }

  /** T5：锁定/解锁（2026-09-14 起语义 = **防误移入舰船仓库**：舰队出售按钮已撤） */
  function handleToggleLock(id: string, currentlyLocked: boolean): void {
    const r = engine.lockShipAt(id, !currentlyLocked)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.393'), true)
    else onToast(currentlyLocked ? tr("ui.ShipPage.123") : tr("ui.ShipPage.124"))
  }

  /** 移入舰船仓库（2026-09-14 船长）：有自定义名 ⇒ 先弹确认（入仓会清名），否则直接入仓 */
  function requestStore(id: string, customName: string | null | undefined): void {
    if (customName) {
      setStoreConfirmId(id)
      return
    }
    doStore(id, false)
  }
  function doStore(id: string, clearName: boolean): void {
    const r = engine.storeShipAt(id, clearName)
    setStoreConfirmId(null)
    if (!r.ok) onToast(cmdText(r) || tr('ui.ShipPage.191'), true)
    else onToast(clearName ? tr("ui.ShipPage.125") : tr("ui.ShipPage.126"))
  }

  /** 开始改名（恢复默认名 = 直接提交 null） */
  function startRename(id: string, currentCustom: string | null | undefined): void {
    setRenameId(id)
    setRenameDraft(currentCustom ?? '')
  }
  function submitRename(id: string, name: string | null): void {
    const r = engine.renameShipAt(id, name)
    if (!r.ok) onToast(cmdText(r) || tr('ui.ShipPage.192'), true)
    else onToast(name === null ? tr("ui.ShipPage.127") : tr("ui.ShipPage.154", { p1: name.trim() }))
    setRenameId(null)
    setRenameDraft('')
  }

  /* 2026-09-14 船长：「之后移除我的舰队内舰船的出售按钮」⇒ 原 `sellBlockers`（出售前预检：装备名列表 +
     货仓单位）随出售按钮一起退场；入仓的逐档拒因改由 core 单点 `shipStorable` 给（界面只显示它的 reason）。 */

  /* ─────────── 舰船仓库（2026-09-14 船长：「先将舰队页面中的舰船市场换成舰船仓库」） ───────────
   * 口径：仓里的船 = 组装机产出（同型堆叠计数）；可转入舰队；可直接在市场出售（吃簿即时成交 /
   * 未成交转限价卖单 / 撤单退回仓库）。筛选三维同「我的舰队」，其中「拥有」按船长裁定**只看仓库库存**。 */
  const [storeQ, setStoreQ] = useState('')
  const [storeOwn, setStoreOwn] = useState<string>(SUB_ALL)
  const [storeRole, setStoreRole] = useState<string>(SUB_ALL)
  const [storeTier, setStoreTier] = useState<string>(SUB_ALL)
  /** 正在展开出售确认的船型 id（同时只展开一个） */
  const [storeSellId, setStoreSellId] = useState<string | null>(null)
  /** 舰船仓库全部条目：**有市场行的船型**（沿用原「舰船市场」列表）＋ **仓库里已有的任何船型**
   *  （后者保证洞内定制船这类不上市场的船在仓里也看得见、能提取） */
  const storeAll = engine.ships.filter(
    (def) =>
      shipStoredCount(state, def.id) > 0 ||
      [...engine.ctx.marketGoods.values()].some((g) => g.kind === 'ship' && g.refId === def.id),
  )
  const storeTotalShips = Object.values(state.shipStore ?? {}).reduce((a, b) => a + b, 0)
  const sq = storeQ.trim().toLowerCase()
  const storeFiltered = sq.length > 0 || storeOwn !== SUB_ALL || storeRole !== SUB_ALL || storeTier !== SUB_ALL
  const storeShown = storeAll.filter((def) => {
    const stored = shipStoredCount(state, def.id)
    if (sq.length > 0 && !def.name.toLowerCase().includes(sq) && !def.id.toLowerCase().includes(sq)) return false
    if (storeOwn === 'owned' && stored <= 0) return false
    if (storeOwn === 'unowned' && stored > 0) return false
    /* 类别 / 级别：走**唯一入口**（2026-09-19 乙组）——原先这里用原始 `def.role`，与舰队/虫洞/手册的
     * 派生类别键（`shipCategoryKeyOf`）不一致 ⇒ 已统一（同一型船在各页落进同一类别） */
    if (!shipRolePasses(def, storeRole)) return false
    if (!shipTierPasses(def, storeTier)) return false
    return true
  })
  /** 舰队（机库）里同型艘数——仓库卡上的参考读数（不是筛选判据） */
  function fleetCountOf(defId: string): number {
    return Object.entries(state.fleet).filter(([uid, s]) => (s.defId ?? uid) === defId).length
  }
  function doUnstore(defId: string): void {
    const r = engine.unstoreShipAt(defId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.ShipPage.193'), true)
    else onToast(tr("ui.ShipPage.155"))
  }
  function doSellStored(defId: string): void {
    const r = engine.sellStoredShipAt(defId)
    setStoreSellId(null)
    if (!r.ok) onToast(cmdText(r) || tr('ui.CargoPage.019'), true)
    else onToast(tr("ui.ShipPage.156"))
  }

  return (
    <div className="page-stack page-fill">
      {/* 舰队 / AI 指挥 / 舰船仓库（MapPage/IndustryPage 同款 app-subtabs 规范）；标签行固定，活跃面板吸满并 body 内滚 */}
      <div className="app-subtabs" role="tablist">
        {SHIP_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            className={`app-subtab${activeTab === t.key ? ' is-active' : ''}`}
            onClick={() => setActiveTab(t.key)}
            title={t.title}
          >
            <span className="app-tab-ico">
              <Glyph name={t.icon} size={15} color={NAV_TONES[t.icon]} />
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'fleet' ? (
        <>
      {/* ───── 我的舰队 ───── */}
      <Panel
        className="is-fill app-fleet-panel"
        title={tr("ui.ShipPage.001")}
        right={
          // 搜索栏进标题行（2026-09-11 船长：「将搜索栏移到标题内，目前不够美观」）——
          // 复刻仓库页 / 技能目录同一套写法（`.app-head-search-wrap` + `.app-head-search` + 灰字计数），
          // 计数随筛选切换为「匹配 N / 共 M 艘」，搜索词清空且无筛选时只显示总数
          <span className="app-head-search-wrap">
            <input
              className="app-head-search"
              type="text"
              placeholder={tr("ui.ShipPage.002")}
              value={fleetQ}
              onChange={(e) => setFleetQ(e.target.value)}
              spellCheck={false}
            />
            <span className="app-dim">
              {fleetFiltered ? tr('ui.ShipPage.107', { shown: fleetShown.length, total: fleetTotal }) : tr('ui.ShipPage.108', { total: fleetTotal })}
              {tr('ui.ShipPage.109')}
              <span className={`app-pilot-name${switchFxUid !== null ? ' is-pulse' : ''}`}>
                {shipDisplayName(state, ctx, state.shipId)}
              </span>
            </span>
          </span>
        }
      >
        {/* 舰队工具条（2026-09-10 船长：搜索/状态筛选；样式与仓库、技能目录同款）——固定在列表上方不随滚动
            2026-09-11 船长：「移除排序选项，改为按照舰船级别划分的子筛选」⇒ 排序下拉退场，
            改挂**舰船级别**子筛选（复用组装机那套 `SHIP_TIER_SUBS` 单点表与次级标签样式）；
            同日追加「**级别筛选单列一行，当选择级别后，出现舰船类别（工业战斗那些）筛选**」；
            同日再追加「将搜索栏移到标题内」⇒ 搜索与计数整体上移到面板标题行，工具条只留各维筛选。
            ⚠ **2026-09-12 船长（本批）：「将我的舰队中，级别和类别筛选对调，玩家先选择类别，再选级别」**
            ⇒ **上述「选中级别后才出类别」的旧口径作废**：工具条改为 **第 1 行 状态**、
            **第 2 行 类别**（`SHIP_SUBS`：全部 / 采矿舰 / 货运舰 / 武装舰 / 重装舰）、
            **第 3 行 级别**（`SHIP_TIER_SUBS`：全部 / T1~T5），**两行都常显**（不再隐藏、不再级联重置），
            两维各自独立与其它条件取「与」；
            每行各带灰字前缀，避免多个「全部」混淆（前缀写法同星图页「矿带排序：」） */}
        <div className="app-fleet-toolbar">
          <div className="app-fleet-row">
            <span className="app-dim">{tr("ui.ShipPage.003")}</span>
            <div className="app-task-tabs app-fleet-tabs" role="tablist">
              {FLEET_STATE_TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={fleetFilter === t.key}
                  className={`app-tasktab${fleetFilter === t.key ? ' is-active' : ''}`}
                  onClick={() => setFleetFilter(t.key)}
                >
                  {subText(t)}
                </button>
              ))}
            </div>
            {/* 计数已上移到面板标题行（与仓库页 / 技能目录同口径），工具条只留各维筛选 */}
          </div>
          <div className="app-fleet-row">
            <span className="app-dim">{tr("ui.ShipPage.004")}</span>
            <div className="app-task-tabs app-fleet-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={fleetRole === SUB_ALL}
                className={`app-tasktab${fleetRole === SUB_ALL ? ' is-active' : ''}`}
                onClick={() => setFleetRole(SUB_ALL)}
              >
                {tr("ui.IndustryPage.001")}
              </button>
              {SHIP_SUBS.map((s) => (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={fleetRole === s.key}
                  className={`app-tasktab${fleetRole === s.key ? ' is-active' : ''}`}
                  onClick={() => setFleetRole(s.key)}
                >
                  {subText(s)}
                </button>
              ))}
            </div>
          </div>
          <div className="app-fleet-row">
            <span className="app-dim">{tr("ui.ShipPage.005")}</span>
            <div className="app-task-tabs app-fleet-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={fleetTier === SUB_ALL}
                className={`app-tasktab${fleetTier === SUB_ALL ? ' is-active' : ''}`}
                onClick={() => setFleetTier(SUB_ALL)}
              >
                {tr("ui.IndustryPage.001")}
              </button>
              {SHIP_TIER_SUBS.map((s) => (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={fleetTier === s.key}
                  className={`app-tasktab${fleetTier === s.key ? ' is-active' : ''}`}
                  onClick={() => setFleetTier(s.key)}
                >
                  {subText(s)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="app-fleet-scroll" ref={fleetScrollRef}>
        {fleetShown.length === 0 ? (
          <div className="app-dim app-note">
            {Object.keys(state.fleet).length === 0
              ? tr("ui.ShipPage.006")
              : tr('ui.ShipPage.157', {
                  p1: fq.length > 0 ? tr('ui.ShipPage.158', { p1: fleetQ.trim() }) : '',
                })}
          </div>
        ) : (
        <div className="app-ship-list">
          {fleetShown.map(({ uid, ship: shipState, def }) => {
            const dur = durabilityOf(state, uid)
            const armor = shipState.armorPct ?? 1 // P0 承伤持久化：装甲残余（跨场保留）
            const kitCount = (['repairkit-civ', 'repairkit-mil'] as const).reduce((n, id) => n + (shipState.cargo[id] ?? 0), 0)
            const isCurrent = uid === state.shipId
            const repairCost = repairCostIsk(state, uid, engine.ctx)
            const isWorking = uid in state.aiAssignments
            const isLockedShip = state.shipLocks[uid] === true
            const displayName = shipDisplayName(state, engine.ctx, uid)
            const isRenaming = renameId === uid
            const storable = shipStorable(state, uid) // 入仓逐档判据（core 单点，与引擎同源）
            return (
              <FleetShipHover key={uid} uid={uid} ship={def} engine={engine} block>
                <div
                  className={`app-ship-card is-fleet${isCurrent ? ' is-current' : ''}${switchFxUid === uid ? ' is-switch-pulse' : ''}`}
                >
                {/* 舰影列：固定尺寸、置卡片最左侧；容器过窄时整列不渲染（样式 .app-ship-card.is-fleet） */}
                {fleetArt ? <FleetArt shipId={def.id} role={def.role} /> : null}
                <div className="app-ship-main">
                <div className="app-ship-top">
                  <span className="app-ship-name">
                    {displayName}
                    {/* 2026-09-13 船长：子分类徽标（只有虫洞族专属舰船有 `subClass`）；样式复用同级角色 chip */}
                    {def.subClass ? <em className={`app-chip app-role-chip is-${def.role}`}>{def.subClass}</em> : null}
                    <em className={`app-chip app-role-chip is-${shipCategoryKeyOf(def)}`}>{shipRoleText(shipCategoryKeyOf(def))}</em>
                    {def.priceIsk <= 0 && def.id !== 'sandcat' ? <em className="app-belt-flag">{tr("ui.ShipPage.007")}</em> : null}
                    {isLockedShip ? (
                      <em className="app-chip app-lock-chip" title={tr("ui.ShipPage.008")}>
                        <span className="app-ico">
                          <Glyph name="ico-lock" size={11} color={ICO_TONES['ico-lock']} />
                        </span>
                        {tr("ui.ShipPage.009")}
                      </em>
                    ) : null}
                  </span>
                  <span className="app-ship-top-right">
                    <MarkStar engine={engine} kind="ships" id={uid} />
                    {isCurrent ? (
                      <span className="app-chip">{tr("ui.ShipPage.010")}</span>
                    ) : isWorking ? (
                      <span className="app-chip">{tr("ui.ShipPage.011")}</span>
                    ) : null}
                    <button
                      className="app-btn is-small"
                      title={tr("ui.ShipPage.159", { displayName: displayName })}
                      onClick={() => onGotoFit?.(uid)}
                    >
                      <span className="app-ico">
                        <Glyph name="nav-fit" size={13} color={NAV_TONES['nav-fit']} />
                      </span>
                      {tr("ui.App.003")}
                    </button>
                    {!isRenaming ? (
                      <button
                        className="app-btn is-small"
                        title={shipState.customName ? tr("ui.ShipPage.160") : tr("ui.ShipPage.012")}
                        onClick={() => startRename(uid, shipState.customName)}
                      >
                        {tr("ui.ShipPage.013")}
                      </button>
                    ) : null}
                    <button
                      className={`app-btn is-small app-lock-btn${isLockedShip ? ' is-warn' : ''}`}
                      title={isLockedShip ? tr("ui.ShipPage.014") : tr("ui.ShipPage.015")}
                      onClick={() => handleToggleLock(uid, isLockedShip)}
                    >
                      {isLockedShip ? (
                        tr('ui.ShipPage.198')
                      ) : (
                        <>
                          <span className="app-ico">
                            <Glyph name="ico-lock" size={12} color={ICO_TONES['ico-lock']} />
                          </span>
                          {tr("ui.ShipPage.009")}
                        </>
                      )}
                    </button>
                  </span>
                </div>
                {isRenaming ? (
                  <div className="app-rename-row">
                    <input
                      className="app-input app-rename-input"
                      value={renameDraft}
                      maxLength={10}
                      autoFocus
                      placeholder={tr("ui.ShipPage.016")}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitRename(uid, renameDraft)
                        else if (e.key === 'Escape') setRenameId(null)
                      }}
                    />
                    <button
                      className="app-btn is-small is-primary"
                      disabled={renameDraft.trim().length === 0}
                      onClick={() => submitRename(uid, renameDraft)}
                    >
                      {tr("ui.ShipPage.017")}
                    </button>
                    {shipState.customName ? (
                      <button className="app-btn is-small" onClick={() => submitRename(uid, null)}>
                        {tr("ui.ShipPage.018")}
                      </button>
                    ) : null}
                    <button className="app-btn is-small" onClick={() => setRenameId(null)}>
                      {tr("ui.ActivityBar.004")}
                    </button>
                  </div>
                ) : null}
                <div className="app-ship-spec">
                  {tr("ui.ShipPage.019")} {def.cargoM3.toLocaleString('zh-CN')} {tr("ui.ShipPage.020")} {def.cycleSeconds} {tr("ui.ShipPage.021")} {def.oreUnitsPerCycle} {tr("ui.Handbook.012")} {Math.round(def.agility * 100)}%
                </div>
                <div className="app-dur-row">
                  <div className="app-dur-track">
                    <div className="app-dur-fill" style={{ width: `${Math.round(dur * 100)}%` }} />
                  </div>
                  <span
                    className={`app-dur-text${dur < 0.5 || armor < 0.5 ? ' is-bad' : dur < 1 || armor < 1 ? ' is-mid' : ''}`}
                    title={tr('ui.ShipPage.161', {
                      p1: dur < 1 ? tr('ui.ShipPage.162', { p1: Math.round(dur * 100) }) : '',
                      p2: armor < 1 ? tr('ui.ShipPage.163', { p1: Math.round(armor * 100) }) : '',
                    })}
                  >
                    {tr("ui.ShipPage.023")} {Math.round(dur * 100)}%{armor < 1 ? tr("ui.ShipPage.164", { p1: Math.round(armor * 100) }) : ''}
                  </span>
                  {(dur < 1 || armor < 1) && !isWorking ? (
                    <button
                      className="app-btn is-small is-warn"
                      onClick={() => handleRepair(uid)}
                      disabled={state.wallet.isk < repairCost}
                      title={tr("ui.ShipPage.165", { p1: repairCost.toLocaleString('zh-CN') })}
                    >
                      {tr("ui.ShipPage.024")} {repairCost.toLocaleString('zh-CN')}
                    </button>
                  ) : null}
                  {isCurrent && (dur < 1 || armor < 1) && kitCount > 0 ? (
                    <button
                      className="app-btn is-small"
                      onClick={() => {
                        const r = engine.useRepairKitNow()
                        if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.383'), true)
                        else onToast(tr("ui.ShipPage.166"))
                      }}
                      title={tr("ui.ShipPage.025")}
                    >
                      <span className="app-ico">
                        <Glyph name="ico-cross" size={12} color={ICO_TONES['ico-cross']} />
                      </span>
                      {tr("ui.ShipPage.026")}{kitCount}
                    </button>
                  ) : null}
                </div>
                {storeConfirmId === uid ? (
                  /* 入仓确认（2026-09-14 船长裁定「甲」：有自定义名先弹确认清名，可取消先去改名）——
                     样式沿用原出售确认块（`.app-sell-confirm`），不新造弹层 */
                  <div className="app-sell-confirm">
                    <div className="app-sell-confirm-title">{tr("ui.ShipPage.027")}{displayName}{tr("ui.ShipPage.028")}</div>
                    <div className="app-dim app-sell-confirm-note">
                      {tr("ui.ShipPage.029")}{shipState.customName}{tr('ui.ShipPage.110')}
                    </div>
                    <div className="app-sell-confirm-btns">
                      <button className="app-btn is-small is-warn" onClick={() => doStore(uid, true)}>
                        {tr("ui.ShipPage.030")}
                      </button>
                      <button className="app-btn is-small" onClick={() => setStoreConfirmId(null)}>
                        {tr("ui.ActivityBar.004")}
                      </button>
                    </div>
                  </div>
                ) : null}
                {!isCurrent && !isWorking ? (
                  /* T5-A 修正（船长反馈）：锁定只拦"移出舰队"，锁定的闲置船仍可切换驾驶 */
                  <div className="app-ship-bottom">
                    <span className="app-dim">{tr("ui.ShipPage.031")}</span>
                    <div className="app-ship-bottom-btns">
                      {isLockedShip ? (
                        <span className="app-chip app-lock-chip" title={tr("ui.ShipPage.032")}>
                          <span className="app-ico">
                            <Glyph name="ico-lock" size={11} color={ICO_TONES['ico-lock']} />
                          </span>
                          {tr("ui.ShipPage.033")}
                        </span>
                      ) : null}
                      <button
                        className="app-btn is-small"
                        disabled={!storable.ok}
                        title={
                          storable.ok
                            ? shipState.customName
                              ? tr("ui.ShipPage.167", { p1: shipState.customName })
                              : tr("ui.ShipPage.129")
                            : storable.reason
                        }
                        onClick={() => requestStore(uid, shipState.customName)}
                      >
                        {tr("ui.ShipPage.034")}
                      </button>
                      <button
                        className="app-btn is-small is-primary"
                        title={switchAskId === uid ? tr('ui.Hauling.035') : undefined}
                        onClick={() => handleSwitch(uid)}
                      >
                        {switchAskId === uid ? tr('ui.Hauling.034') : tr("ui.ShipPage.035")}
                      </button>
                    </div>
                  </div>
                ) : null}
                </div>
                </div>
              </FleetShipHover>
            )
          })}
        </div>
        )}
        </div>
      </Panel>
      </>
      ) : null}

      {activeTab === 'ai' ? <AiCommandPanel engine={engine} onToast={onToast} /> : null}

      {activeTab === 'store' ? (
        <Panel
          className="is-fill"
          title={tr("ui.ShipPage.036")}
          right={
            /* 搜索栏进标题行 + 计数（与「我的舰队」同一套写法：`.app-head-search-wrap` + 灰字计数） */
            <span className="app-head-search-wrap">
              <input
                className="app-head-search"
                type="text"
                placeholder={tr("ui.ShipPage.037")}
                value={storeQ}
                onChange={(e) => setStoreQ(e.target.value)}
                spellCheck={false}
              />
              <span className="app-dim">
                {storeFiltered ? tr('ui.ShipPage.111', { shown: storeShown.length, total: storeAll.length }) : tr('ui.ShipPage.112', { total: storeAll.length })}
                {tr('ui.ShipPage.113', { n: storeTotalShips })}
              </span>
            </span>
          }
        >
          {/* 三维筛选（复刻「我的舰队」的工具条样式）：拥有（船长裁定：只看仓库库存）→ 类别 → 级别 */}
          <div className="app-fleet-toolbar">
            <div className="app-fleet-row">
              <span className="app-dim">{tr("ui.ShipPage.038")}</span>
              <div className="app-task-tabs app-fleet-tabs" role="tablist">
                {STORE_OWN_TABS.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={storeOwn === t.key}
                    className={`app-tasktab${storeOwn === t.key ? ' is-active' : ''}`}
                    onClick={() => setStoreOwn(t.key)}
                  >
                    {subText(t)}
                  </button>
                ))}
              </div>
            </div>
            <div className="app-fleet-row">
              <span className="app-dim">{tr("ui.ShipPage.004")}</span>
              <div className="app-task-tabs app-fleet-tabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={storeRole === SUB_ALL}
                  className={`app-tasktab${storeRole === SUB_ALL ? ' is-active' : ''}`}
                  onClick={() => setStoreRole(SUB_ALL)}
                >
                  {tr("ui.IndustryPage.001")}
                </button>
                {SHIP_SUBS.map((s) => (
                  <button
                    key={s.key}
                    role="tab"
                    aria-selected={storeRole === s.key}
                    className={`app-tasktab${storeRole === s.key ? ' is-active' : ''}`}
                    onClick={() => setStoreRole(s.key)}
                  >
                    {subText(s)}
                  </button>
                ))}
              </div>
            </div>
            <div className="app-fleet-row">
              <span className="app-dim">{tr("ui.ShipPage.005")}</span>
              <div className="app-task-tabs app-fleet-tabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={storeTier === SUB_ALL}
                  className={`app-tasktab${storeTier === SUB_ALL ? ' is-active' : ''}`}
                  onClick={() => setStoreTier(SUB_ALL)}
                >
                  {tr("ui.IndustryPage.001")}
                </button>
                {SHIP_TIER_SUBS.map((s) => (
                  <button
                    key={s.key}
                    role="tab"
                    aria-selected={storeTier === s.key}
                    className={`app-tasktab${storeTier === s.key ? ' is-active' : ''}`}
                    onClick={() => setStoreTier(s.key)}
                  >
                    {subText(s)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="app-fleet-scroll" ref={storeScrollRef}>
            {storeShown.length === 0 ? (
              <div className="app-dim app-note">
                {storeAll.length === 0
                  ? tr("ui.ShipPage.039")
                  : tr('ui.ShipPage.168', {
                      p1: sq.length > 0 ? tr('ui.ShipPage.158', { p1: storeQ.trim() }) : '',
                    })}
              </div>
            ) : (
              <div className="app-ship-list">
                {storeShown.map((def) => {
                  const stored = shipStoredCount(state, def.id)
                  const inFleet = fleetCountOf(def.id)
                  const good = [...engine.ctx.marketGoods.values()].find((g) => g.kind === 'ship' && g.refId === def.id)
                  const quote = good ? marketQuote(state, engine.ctx, good.key) : null
                  const ask = quote?.sell
                  const lock = good ? goodLockedReason(state, good) : null
                  return (
                    <ShipHover key={def.id} ship={def} block>
                      <div className="app-ship-card">
                        <div className="app-ship-top">
                          <span className="app-ship-name">
                            {def.name}
                            {/* 2026-09-13 船长：子分类徽标（市场/图纸列同样显示） */}
                            {def.subClass ? <em className={`app-chip app-role-chip is-${def.role}`}>{def.subClass}</em> : null}
                            <em className={`app-chip app-role-chip is-${shipCategoryKeyOf(def)}`}>{shipRoleText(shipCategoryKeyOf(def))}</em>
                            {stored <= 0 ? (
                              <em className="app-chip app-lock-chip" title={tr("ui.ShipPage.040")}>
                                {tr("ui.ShipPage.041")}
                              </em>
                            ) : null}
                          </span>
                          <span className={`app-chip${good?.rarity === 'common' ? '' : good?.rarity === 'rare' ? ' is-rare' : ' is-exotic'}`}>
                            {good ? rarityLabel(good.rarity) : ''}
                          </span>
                        </div>
                        <div className="app-ship-spec">
                          {tr("ui.ShipPage.019")} {def.cargoM3.toLocaleString('zh-CN')} {tr("ui.ShipPage.020")} {def.cycleSeconds} {tr("ui.ShipPage.021")} {def.oreUnitsPerCycle} {tr("ui.Handbook.012")} {Math.round(def.agility * 100)}%
                        </div>
                        <div className="app-ship-desc">{def.description}</div>
                        <div className="app-ship-bottom">
                          <span className={stored > 0 ? 'app-ship-price' : 'app-dim'}>
                            {tr("ui.ShipPage.042")}{stored.toLocaleString('zh-CN')}
                          </span>
                          {inFleet > 0 ? (
                            <span className="app-chip" title={tr("ui.ShipPage.043")}>
                              {tr("ui.ShipPage.044")}{inFleet}
                            </span>
                          ) : null}
                          {ask !== undefined ? <span className="app-dim">{tr("ui.ShipPage.045")} {isk(ask)} {tr("ui.FirstTasks.003")}</span> : null}
                          {lock ? (
                            <span className="app-chip is-exotic" title={lock}>
                              <span className="app-ico">
                                <Glyph name="ico-lock" size={11} color={ICO_TONES['ico-lock']} />
                              </span>
                              {lock}
                            </span>
                          ) : null}
                          <div className="app-ship-bottom-btns">
                            <button
                              className="app-btn is-small"
                              disabled={stored <= 0}
                              title={stored > 0 ? tr("ui.ShipPage.046") : tr("ui.ShipPage.047")}
                              onClick={() => doUnstore(def.id)}
                            >
                              {tr("ui.ShipPage.048")}
                            </button>
                            <button
                              className="app-btn is-small"
                              disabled={stored <= 0}
                              title={
                                stored > 0
                                  ? tr("ui.ShipPage.049")
                                  : tr("ui.ShipPage.047")
                              }
                              onClick={() => setStoreSellId(def.id)}
                            >
                              {tr("ui.ShipPage.050")}
                            </button>
                            {good ? (
                              <button
                                className={`app-btn is-small${lock ? '' : ' is-primary'}`}
                                disabled={!onGotoMarket}
                                title={lock ?? tr("ui.ShipPage.051")}
                                onClick={() => onGotoMarket?.(good.key)}
                              >
                                {tr("ui.ShipPage.052")}
                              </button>
                            ) : null}
                          </div>
                        </div>
                        {storeSellId === def.id ? (
                          /* 出售二次确认（沿用舰队页原「市价出售」确认块的样式与话术结构） */
                          <div className="app-sell-confirm">
                            <div className="app-sell-confirm-title">{tr("ui.ShipPage.053")}{def.name}{tr("ui.ShipPage.054")}</div>
                            <div className="app-dim app-sell-confirm-note">
                              {tr("ui.ShipPage.055")}
                              {quote?.buy !== undefined ? ` 预计到手约 ${isk(quote.buy)} 信用点（税后以实际成交计）。` : ''}
                            </div>
                            <div className="app-sell-confirm-btns">
                              <button className="app-btn is-small is-warn" onClick={() => doSellStored(def.id)}>
                                {tr("ui.ShipPage.056")}
                              </button>
                              <button className="app-btn is-small" onClick={() => setStoreSellId(null)}>
                                {tr("ui.ActivityBar.004")}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </ShipHover>
                  )
                })}
              </div>
            )}
          </div>
        </Panel>
      ) : null}
    </div>
  )
}

/* ═══════════════ AI 指挥中心 ═══════════════ */

function AiCommandPanel({ engine, onToast }: PageProps) {
  const state = engine.state
  const cap = aiCoreCap(state, engine.ctx)
  const industryBonus = industryAiBonus(state, engine.ctx) // 2026-09-08 工业专用扩容（仅站内产业）
  const idleShips = idleAiShipIds(state)
  // 计数口径同源（2026-09-08 玩家反馈"执行中 N 与实际行数对不上"）：总启用数含 AI 副船 +
  // AI 核心驱动的精炼/回收炉与制造线（后者在工业页管理）；本页列表只列副船 → 标题拆分展示，
  // 保证「标题数 = 行数」不被生产条目撑出假差额。
  // 2026-09-09 玩家反馈修复：副船名额只受共用上限约束——站内工业占用先抵工业扩容工位，
  // 超出扩容的部分才计入共用名额（与引擎 aiCoreCapBlock 同口径，见 @whale/core aiCoreCapBlock）
  const assignN = aiCoreShipUsed(state)
  const prodN = aiCoreIndustryUsed(state)
  const used = aiCoreUsed(state)
  const totalCap = cap + industryBonus

  const [shipId, setShipId] = useState('')
  const [coreType, setCoreType] = useState<AiCoreType>(() => bestAiCoreOf(state) ?? 'basic')
  // 任务类型（2026-09-10 船长：AI 指挥中心统一指派「AI 现在能执行的全部活动」）——
  // 副船三类（采矿/打捞/掩护巡逻）+ 站内工业两类（精炼炉与回收炉/组装机制造）。
  // 远征保持隐藏（引擎软下线，一律拒绝受理）。
  const [mode, setMode] = useState<AiAssignMode>('mining')
  const [beltId, setBeltId] = useState(engine.belts[0]?.id ?? '')
  const [salvageGalaxyId, setSalvageGalaxyId] = useState('')
  const [standbyGalaxyId, setStandbyGalaxyId] = useState('')
  const [refineItemId, setRefineItemId] = useState('')
  const [craftBpId, setCraftBpId] = useState('')
  // 2026-09-08 紧急修复（玩家反馈"无法用伽马 AI 核心采矿"）：核心下拉只列有库存类型，
  // 但 state 初值/记忆可能已无库存（如 basic 用光、只剩伽马）→ 提交与实际显示脱节，
  // 引擎仍按旧类型(basic)指派被拒。归一为"当前有库存的类型"再用于显示与提交
  // （与工业页炉卡 usableCores 同款写法）。
  const usableCores = AI_CORE_ORDER.filter((t) => countAiCore(state, t) > 0)
  const effCore = usableCores.includes(coreType) ? coreType : (usableCores[usableCores.length - 1] ?? 'basic')
  /** 副船任务须有共用上限（「AI 核心操作学」）；站内工业另可用「工业自动化」扩容工位——
   *  共用上限为 0 而工业扩容 > 0 时，只允许指派站内工业任务（回落显示制造）。 */
  const shipTasksOk = cap > 0
  const effMode: AiAssignMode =
    shipTasksOk || mode === 'refine' || mode === 'craft' ? mode : 'craft'

  /** 站内工业可指派的目标（与工业页卡片同口径）：
   *  精炼炉 = 全部带精炼配方的资源（**只列玩家可见的**——未上线资源不进下拉，见 `visibleItemDefs`）；
   *  回收炉 = 当前有料（货仓或仓库）的残骸；制造线 = 已学会的蓝图。 */
  const allItemDefs = visibleItemDefs(engine.ctx)
  const refineOres = allItemDefs.filter((d) => d.kind !== 'wreck' && (d.refine?.length ?? 0) > 0)
  const refineWrecks = allItemDefs.filter((d) => d.kind === 'wreck' && oreAvailable(state, d.id) > 0)
  const refineAll = [...refineOres, ...refineWrecks]
  const effRefineId = refineAll.some((d) => d.id === refineItemId) ? refineItemId : (refineAll[0]?.id ?? '')
  const craftAll: CraftOption[] = []
  for (const bp of engine.blueprints) {
    if (bp.itemId !== undefined) {
      const units = bp.outputUnits ?? 1
      craftAll.push({
        id: bp.id,
        name: `${engine.ctx.items.get(bp.itemId)?.name ?? bp.itemId} ×${units}`,
        group: '消耗品蓝图', // l10n-keep：`CraftOption.group` 是**字面量联合 key**（不是文案）⇒ 保持中文原样，
        //   显示译名在渲染处按 id 取（见 `CRAFT_GROUPS`，2026-09-19 本地化）
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
      })
    } else {
      craftAll.push({
        id: bp.id,
        name: engine.ctx.modules.get(bp.moduleId ?? '')?.name ?? bp.name,
        group: '装备蓝图', // l10n-keep
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
      })
    }
  }
  for (const sbp of engine.shipBlueprints) {
    craftAll.push({
      id: sbp.id,
      name: engine.ctx.ships.get(sbp.shipId)?.name ?? sbp.name,
      group: '舰船蓝图', // l10n-keep
      materials: sbp.materials,
      buildSeconds: sbp.buildSeconds,
    })
  }
  const craftLearned = craftAll.filter((o) => ownsBlueprint(state, o.id))
  const effCraftId = craftLearned.some((o) => o.id === craftBpId) ? craftBpId : (craftLearned[0]?.id ?? '')
  const selCraft = craftLearned.find((o) => o.id === effCraftId) ?? null
  const selRefine = refineAll.find((d) => d.id === effRefineId) ?? null

  /** 站内工业两类不需要舰船；副船三类需要 */
  const isIndustryTask = effMode === 'refine' || effMode === 'craft'
  /** 站内制造线缺料（与工业页卡片同口径 missingMaterials；缺料时不开工并给出清单） */
  const craftShort =
    effMode === 'craft' && selCraft
      ? missingMaterials(state, engine.ctx, {
          materials: selCraft.materials,
          buildSeconds: selCraft.buildSeconds,
          buildCostIsk: 0,
        })
      : []
  const refineHave = effMode === 'refine' && effRefineId ? oreAvailable(state, effRefineId) : 0
  /** 指派按钮置灰原因（null = 可指派；文案与下方各下拉一一对应）
   *  ⚠ **站内工业不看玩家位置**（2026-09-14 船长报障修复）：本页指派的都是 **AI 核心**驱动
   *  （没有"亲自"这一路），而 AI 核心是留在站内替你干活的分身 ⇒ 原来的
   *  「需停靠空间站（母港或已建成副站）才能开工」那一条**已删**：跑长途运输/远征时照常能开炉开线
   *  （判据单点 = core `stationIndustryBlocked`，亲自操作那一路仍要求在基地网络内，见工业页）。 */
  const assignBlock: string | null =
    usableCores.length === 0
      ? tr("ui.ShipPage.130")
      : !isIndustryTask && !shipId
        ? idleShips.length === 0
          ? tr("ui.ShipPage.131")
          : tr("ui.ShipPage.132")
        : effMode === 'salvage' && !salvageGalaxyId
          ? tr("ui.ShipPage.133")
          : effMode === 'standby' && !standbyGalaxyId
            ? tr("ui.ShipPage.134")
            : effMode === 'refine' && !effRefineId
              ? tr("ui.ShipPage.135")
              : effMode === 'refine' && refineHave <= 0
                ? tr("ui.ShipPage.169", { p1: selRefine?.name ?? '' })
                : effMode === 'craft' && !effCraftId
                  ? tr("ui.ShipPage.136")
                  : effMode === 'craft' && craftShort.length > 0
                    ? tr("ui.ShipPage.170", { p1: craftShort.join('；') })
                    : null

  /** 站内工业 AI 名册（只列 AI 核心驱动的：worker 非 'pilot'；老档免占用的旧作业不计） */
  const aiRefineRuns = engine.refineRunViews().filter((v) => v.worker !== 'pilot')
  const aiMakeRuns = manufacturingRunViews(state, engine.ctx).filter((v) => v.worker !== null && v.worker !== 'pilot')


  function handleBuyCore(): void {
    const r = engine.buyBasicCoreAt()
    if (!r.ok) onToast(cmdText(r) || tr('ui.ShipPage.200'), true)
    else onToast(tr("ui.ShipPage.171"))
  }

  function handleAssign(): void {
    // 站内工业两类：不出舰船，直接把一枚 AI 核心接进炉/线（与工业页卡片同一批引擎命令）
    if (effMode === 'craft') {
      if (!effCraftId) {
        onToast(tr("ui.ShipPage.172"), true)
        return
      }
      const r = engine.startManufacturingAt(effCraftId, effCore)
      if (!r.ok) onToast(cmdText(r) || tr('ui.ShipPage.194'), true)
      else onToast(tr("ui.ShipPage.173"))
      return
    }
    if (effMode === 'refine') {
      if (!selRefine) {
        onToast(tr("ui.ShipPage.174"), true)
        return
      }
      const isWreck = selRefine.kind === 'wreck'
      const r = isWreck
        ? engine.startRecycleRunAt(selRefine.id, effCore)
        : engine.startRefineRunAt(selRefine.id, effCore)
      if (!r.ok) onToast(cmdText(r) || tr('ui.ShipPage.195'), true)
      else
        onToast(
          isWreck
            ? tr("ui.ShipPage.137")
            : tr("ui.ShipPage.138"),
        )
      return
    }
    if (!shipId) {
      onToast(tr("ui.ShipPage.175"), true)
      return
    }
    const r =
      effMode === 'mining'
        ? engine.assignAiMiningAt(shipId, effCore, beltId)
        : effMode === 'salvage'
          ? engine.assignAiSalvageAt(shipId, effCore, salvageGalaxyId)
          : engine.assignAiStandbyAt(shipId, effCore, standbyGalaxyId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.ShipPage.196'), true)
    else onToast(tr("ui.ShipPage.176"))
  }

  /** 取消执行中的 AI 任务（船长 2026-09-05：活动栏简略后须在 AI 指挥中心内可直接取消） */
  function handleCancelAi(sid: string): void {
    if (engine.cancelAiTaskAt(sid)) onToast(tr("ui.ShipPage.177"))
    else onToast(tr("ui.MapPage.077"), true)
  }

  /** 停止站内工业 AI（炉/制造线）——与工业页卡片同一批引擎命令，核心自动归还 */
  function handleStopIndustry(runId: number, isMake: boolean): void {
    const r = isMake ? engine.cancelManufacturingAt(runId) : engine.stopRefineRunAt(runId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.ShipPage.197'), true)
    else onToast(isMake ? tr("ui.ShipPage.139") : tr("ui.ShipPage.140"))
  }

  return (
    <Panel
      className="is-fill"
      title={tr("ui.ShipPage.057")}
      right={
        <span className="app-dim">
          {tr("ui.ShipPage.058")} {used}/{totalCap}
          {industryBonus > 0 ? tr("ui.ShipPage.178", { cap: cap, industryBonus: industryBonus }) : ''}
        </span>
      }
    >
      {/* 名额与核心库 */}
      <div className="app-ai-status">
        <span className="app-dim">
          {tr("ui.ShipPage.059")} {cap} {tr("ui.ShipPage.060")}
          {industryBonus > 0 ? tr('ui.ShipPage.199', { p1: industryBonus }) : tr("ui.ShipPage.061")}{cap === 0 && industryBonus <= 0 ? tr("ui.ShipPage.062") : ''}
        </span>
        <div className="app-core-badges">
          {AI_CORE_ORDER.map((type) => (
            <span key={type} className={`app-chip${countAiCore(state, type) > 0 ? '' : ' is-dim'}`}>
              {aiCoreName(type)} ×{countAiCore(state, type)}（{Math.round(aiEfficiency(state, engine.ctx, type) * 100)}%）
            </span>
          ))}
          <button className="app-btn is-small is-primary" onClick={handleBuyCore}>
            {tr("ui.ShipPage.063")}{marketQuote(state, engine.ctx, 'core-basic').sell !== undefined ? tr("ui.ShipPage.179", { p1: isk(marketQuote(state, engine.ctx, 'core-basic').sell!) }) : tr("ui.ShipPage.064")}
          </button>
        </div>
      </div>

      {/* 指派表单：共用上限与工业扩容只要有一个 > 0 就能开工（工业 AI 可只用扩容工位） */}
      {totalCap > 0 ? (
        <div className="app-ai-assign">
          <select
            className="app-select"
            /* AI 指派表单的舰船下拉框：`data-ai-ship` 是稳定的识别钩子（不涉及样式）；
               原为教程光圈定位用（2026-09-11），光圈随线性教程退场后保留（2026-09-17） */
            data-ai-ship
            value={isIndustryTask ? '' : shipId}
            onChange={(e) => setShipId(e.target.value)}
            disabled={isIndustryTask || idleShips.length === 0}
            title={
              isIndustryTask
                ? tr("ui.ShipPage.065")
                : idleShips.length === 0
                  ? tr("ui.ShipPage.141")
                  : tr("ui.ShipPage.142")
            }
          >
            <option value="">
              {isIndustryTask ? tr("ui.ShipPage.066") : idleShips.length === 0 ? tr("ui.ShipPage.143") : tr("ui.ShipPage.144")}
            </option>
            {idleShips.map((id) => (
              <option key={id} value={id}>
                {shipDisplayName(state, engine.ctx, id)}{tr("ui.ShipPage.067")} {Math.round(durabilityOf(state, id) * 100)}%）
              </option>
            ))}
          </select>
          {/* 核心下拉常驻：无可用核心时置灰并直接显示原因（船长 2026-09-10：无核心必须提示玩家） */}
          <select
            className="app-select"
            value={usableCores.length === 0 ? '' : effCore}
            onChange={(e) => setCoreType(e.target.value as AiCoreType)}
            disabled={usableCores.length === 0}
            title={
              usableCores.length === 0
                ? tr("ui.ShipPage.068")
                : tr("ui.ShipPage.069")
            }
          >
            {usableCores.length === 0 ? (
              <option value="">{tr("ui.ShipPage.070")}</option>
            ) : (
              usableCores.map((t) => (
                <option key={t} value={t}>
                  {aiCoreName(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）
                </option>
              ))
            )}
          </select>
          <select
            className="app-select"
            value={effMode}
            onChange={(e) => setMode(e.target.value as AiAssignMode)}
            title={tr("ui.ShipPage.071")}
          >
            <option value="mining" disabled={!shipTasksOk}>
              {tr("ui.ShipPage.072")}{shipTasksOk ? '' : tr("ui.ShipPage.073")}
            </option>
            <option value="salvage" disabled={!shipTasksOk}>
              {tr("ui.ShipPage.074")}{shipTasksOk ? '' : tr("ui.ShipPage.073")}
            </option>
            <option value="standby" disabled={!shipTasksOk}>
              {tr("ui.ShipPage.075")}{shipTasksOk ? '' : tr("ui.ShipPage.073")}
            </option>
            <option value="refine">{tr("ui.ShipPage.076")}</option>
            <option value="craft">{tr("ui.ShipPage.077")}</option>
          </select>
          {effMode === 'mining' ? (
            <select className="app-select" value={beltId} onChange={(e) => setBeltId(e.target.value)}>
              {engine.belts.map((b) => {
                const standing = standingOfState(state)
                // 与星图页矿带卡片同一套锁定：声望 或 所在星系未探索（V13）
                const unexplored = b.galaxyId ? !isExplored(state, b.galaxyId) : false
                const locked = (b.standingReq ?? 0) > standing || unexplored
                return (
                  <option key={b.id} value={b.id} disabled={locked}>
                    {unexplored
                      ? tr("ui.ShipPage.180", { p1: b.name })
                      : locked
                        ? tr("ui.ShipPage.181", { p1: b.name, p2: b.standingReq ?? 0, standing: standing })
                        : `${b.name}（${engine.ctx.items.get(b.oreId)?.name}）`}
                  </option>
                )
              })}
            </select>
          ) : effMode === 'salvage' ? (
            <select className="app-select" value={salvageGalaxyId} onChange={(e) => setSalvageGalaxyId(e.target.value)}>
              <option value="">{tr("ui.ShipPage.078")}</option>
              {[...engine.ctx.galaxies.values()]
                .filter((g) => isExplored(state, g.id) && engine.anomalies.some((a) => a.galaxyId === g.id))
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          ) : effMode === 'standby' ? (
            <select
              className="app-select"
              value={standbyGalaxyId}
              onChange={(e) => setStandbyGalaxyId(e.target.value)}
              title={tr("ui.ShipPage.079")}
            >
              <option value="">{tr("ui.ShipPage.080")}</option>
              {[...engine.ctx.galaxies.values()]
                .filter((g) => isExplored(state, g.id))
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          ) : effMode === 'refine' ? (
            <select
              className="app-select"
              value={effRefineId}
              onChange={(e) => setRefineItemId(e.target.value)}
              title={tr("ui.ShipPage.081")}
            >
              {refineAll.length === 0 ? <option value="">{tr("ui.ShipPage.082")}</option> : null}
              {refineOres.length > 0 ? (
                <optgroup label={tr("ui.ShipPage.083")}>
                  {refineOres.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}{tr("ui.ShipPage.084")}{oreAvailable(state, d.id).toLocaleString('zh-CN')}）
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {refineWrecks.length > 0 ? (
                <optgroup label={tr("ui.ShipPage.085")}>
                  {refineWrecks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}{tr("ui.ShipPage.086")} {Math.round(oreAvailable(state, d.id) * 10) / 10} m³）
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          ) : (
            <select
              className="app-select"
              value={effCraftId}
              onChange={(e) => setCraftBpId(e.target.value)}
              title={tr("ui.ShipPage.087")}
            >
              {craftLearned.length === 0 ? <option value="">{tr("ui.ShipPage.088")}</option> : null}
              {CRAFT_GROUPS.map(({ key, id }) =>
                craftLearned.some((o) => o.group === key) ? (
                  <optgroup key={key} label={tr(id)}>
                    {craftLearned
                      .filter((o) => o.group === key)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </optgroup>
                ) : null,
              )}
            </select>
          )}
          <button
            className="app-btn is-primary is-small"
            onClick={handleAssign}
            disabled={assignBlock !== null}
            title={assignBlock ?? undefined}
          >
            {tr("ui.ShipPage.089")}
          </button>
        </div>
      ) : (
        <div className="app-dim app-inv-empty">
          {tr('ui.ShipPage.106')}
        </div>
      )}

      {/* 执行中列表：AI 副船任务 + 站内工业 AI（2026-09-10 船长：统一在一处呈现与停止） */}
      <div className="app-bay-title">
        {tr("ui.ShipPage.090")} {assignN}{tr('ui.ShipPage.152', { n: prodN })}
      </div>
      {assignN === 0 && prodN === 0 ? (
        <div className="app-dim app-inv-empty">{tr("ui.ShipPage.091")}</div>
      ) : null}
      {assignN === 0 ? (
        prodN > 0 ? <div className="app-dim app-inv-empty">{tr("ui.ShipPage.092")}</div> : null
      ) : (
        <ul className="app-inv-list">
          {Object.entries(state.aiAssignments).map(([sid, assignment]) => {
            const task = assignment.task
            const eff = aiEfficiency(state, engine.ctx, assignment.coreType)
            const aiView = aiTaskView(state, engine.ctx, sid)
            let desc = ''
            if (task.kind === 'mining') {
              const belt = engine.ctx.belts.get(task.beltId)
              const phaseLabel = task.phase === 'returning' ? tr("ui.ShipPage.145") : task.phase === 'outbound' ? tr("ui.MapPage.056") : tr("ui.ShipPage.146")
              desc = tr("ui.ShipPage.182", { p1: belt?.name ?? task.beltId, phaseLabel: phaseLabel, p3: task.tripUnits })
            } else if (task.kind === 'expedition') {
              // 防御分支：AI 远征已停用（2026-09-05 软下线、2026-09-08 UI 隐藏），理论不出现——老档残留兜底显示
              const a = engine.ctx.anomalies.get(task.anomalyId)
              const remain = Math.max(0, task.finishAtGameMs - state.gameMs)
              desc = tr("ui.ShipPage.183", { p1: a?.name ?? task.anomalyId, p2: Math.floor(remain / 60_000) })
            } else if (task.kind === 'salvage') {
              const g = engine.ctx.galaxies.get(task.galaxyId)
              const phaseLabel = task.phase === 'returning' ? tr("ui.ShipPage.147") : task.phase === 'outbound' ? tr("ui.ShipPage.148") : tr("ui.ShipPage.149")
              desc = tr("ui.ShipPage.184", { p1: g?.name ?? task.galaxyId, phaseLabel: phaseLabel, p3: Math.round(task.tripM3 * 10) / 10 })
            } else {
              const g = engine.ctx.galaxies.get(task.galaxyId)
              desc =
                task.phase === 'out'
                  ? tr("ui.ShipPage.185", { p1: g?.name ?? task.galaxyId })
                  : tr("ui.ShipPage.186", { p1: g?.name ?? task.galaxyId })
            }
            // 工作动画差分（2026-09-10 船长定 6 类，判据取引擎真值 task.kind）：远征已软下线，
            // 老档残留兜底显示时按掩护巡逻呈现（不新造第七种动画）
            const fxKind: AiWorkKind =
              task.kind === 'mining' ? 'mining' : task.kind === 'salvage' ? 'salvage' : 'standby'
            return (
              <li key={sid} className="app-inv-row">
                <div className="app-inv-main is-aiwork">
                  <AiWorkFx kind={fxKind} />
                  <div className="app-inv-text">
                  <span className="app-inv-name">{shipDisplayName(state, engine.ctx, sid)}</span>
                  <span className="app-inv-count">
                    {desc} · {aiCoreName(assignment.coreType)}{tr("ui.ShipPage.093")} {Math.round(eff * 100)}%）
                  </span>
                  <span className="app-inv-count">
                    <AiTaskBar view={aiView} />
                  </span>
                  </div>
                </div>
                <div className="app-inv-btns">
                  <button
                    className="app-btn is-small is-warn"
                    onClick={() => handleCancelAi(sid)}
                    title={tr("ui.ShipPage.187", { p1: shipDisplayName(state, engine.ctx, sid) })}
                  >
                    {tr("ui.ShipPage.094")}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* 站内工业 AI 名册（精炼炉/回收炉 + 制造线）：指派在上方或工业页卡片，这里就地停止 */}
      {prodN > 0 ? (
        <>
          <div className="app-dim app-inv-empty">
            {tr("ui.ShipPage.095")}
          </div>
          <ul className="app-inv-list">
            {aiRefineRuns.map((v) => {
              // 回收炉 vs 精炼炉：料是残骸即回收炉——同一判据同时驱动文案与动画差分（只写一处）
              const isReclaim = v.itemId !== null && engine.ctx.items.get(v.itemId)?.kind === 'wreck'
              return (
                <li key={`rf-${v.id}`} className="app-inv-row">
                  <div className="app-inv-main is-aiwork">
                    <AiWorkFx kind={isReclaim ? 'reclaim' : 'refine'} />
                    <div className="app-inv-text">
                    <span className="app-inv-name">
                      {isReclaim ? tr("ui.ShipPage.096") : tr("ui.ShipPage.097")} · {v.itemName}
                    </span>
                    <span className="app-inv-count">
                      {v.workerLabel}{tr("ui.ShipPage.098")} {v.batchesDone} {tr("ui.ShipPage.099")} {v.batchUnits.toLocaleString('zh-CN')} {tr("ui.ShipPage.100")}
                    </span>
                    <span className="app-inv-count">
                      <AiTaskBar
                        view={{ kind: 'ai', phase: 'refine', label: tr("ui.ShipPage.150"), percent: v.percent, remainingMs: v.remainingMs }}
                      />
                    </span>
                    </div>
                  </div>
                  <div className="app-inv-btns">
                    <button
                      className="app-btn is-small is-warn"
                      onClick={() => handleStopIndustry(v.id, false)}
                      title={tr("ui.ShipPage.101")}
                    >
                      {tr("ui.ActivityBar.005")}
                    </button>
                  </div>
                </li>
              )
            })}
            {aiMakeRuns.map((v) => (
              <li key={`mf-${v.id}`} className="app-inv-row">
                <div className="app-inv-main is-aiwork">
                  <AiWorkFx kind="craft" />
                  <div className="app-inv-text">
                  <span className="app-inv-name">{tr("ui.ShipPage.102")} {v.productName}</span>
                  <span className="app-inv-count">
                    {/* 循环制造为卡片级（2026-09-10 船长定）：这里显示该卡合计进度，不再按线各写各的 */}
                    {v.workerLabel}{tr("ui.ShipPage.103")}{' '}
                    {v.loopOn
                      ? tr("ui.ShipPage.188", { p1: v.loopProduced.toLocaleString('zh-CN'), p2: v.loopGoal > 0 ? `/${v.loopGoal.toLocaleString('zh-CN')}` : '' })
                      : tr("ui.ShipPage.104")}
                  </span>
                  <span className="app-inv-count">
                    <AiTaskBar
                      view={{ kind: 'ai', phase: 'make', label: tr("ui.ShipPage.151"), percent: v.percent, remainingMs: v.remainingMs }}
                    />
                  </span>
                  </div>
                </div>
                <div className="app-inv-btns">
                  <button
                    className="app-btn is-small is-warn"
                    onClick={() => handleStopIndustry(v.id, true)}
                    title={tr("ui.ShipPage.105")}
                  >
                    {tr("ui.ActivityBar.005")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Panel>
  )
}

function standingOfState(state: { standings: Record<string, number> }): number {
  return state.standings['dsi'] ?? 0
}
// l10n-keep-end
