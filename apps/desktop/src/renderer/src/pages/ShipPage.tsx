/**
 * 舰船页：我的舰队（耐久/维修/切换驾驶）+ AI 指挥中心 + 空间站商店。
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  marketGoodOf,
  marketQuote,
  allFittedIds,
  shipRoleLabel,
  missingMaterials,
  oreAvailable,
  ownsBlueprint,
  manufacturingRunViews,
  isAtHomeLike,
} from '@whale/core'
import type { AiCoreType, FleetShipState, ShipRole } from '@whale/core'
import { durabilityOf, repairCostIsk, shipDisplayName } from '@whale/core'
import { Panel } from '@whale/ui'
import { ShipHover } from '../ui/shipInfo'
import { ShipSprite } from '../ui/ShipSprite'
import { AiTaskBar } from '../ui/aiProgress'
import { AiWorkFx } from '../ui/aiWorkFx'
import type { AiWorkKind } from '../ui/aiWorkFx'
import { Glyph, NAV_TONES, ICO_TONES } from '../ui/Glyphs'
import { MarkStar, pinMarked } from '../ui/marks'
import type { PageProps } from './common'
import { isk } from './common'

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
  return rarity === 'common' ? '常驻' : rarity === 'rare' ? '稀有' : '限定奇货'
}

/** 舰船页标签（MapPage/IndustryPage 同款 app-subtabs 规范，2026-09-05） */
export type ShipTab = 'fleet' | 'ai' | 'shop'
/** 舰队检索（2026-09-10 船长：排序 + 筛选 + 搜索，控件样式与仓库/技能目录统一） */
type FleetFilter = 'all' | 'pilot' | 'ai' | 'idle' | 'damaged'
type FleetSort = 'default' | 'name' | 'durability' | 'role'
const FLEET_FILTER_TABS: Array<{ key: FleetFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pilot', label: '驾驶中' },
  { key: 'ai', label: 'AI 执勤' },
  { key: 'idle', label: '空闲' },
  { key: 'damaged', label: '待维修' },
]
const FLEET_ROLE_ORDER = ['industrial', 'armed', 'armored', 'hauler']

/** AI 指挥中心可指派的任务类型（2026-09-10 船长：统一全部 AI 可执行活动）——
 *  副船三类：采矿/打捞/掩护巡逻；站内工业两类：精炼炉与回收炉/组装机制造。
 *  远征不在其列（引擎软下线，一律拒绝受理）。 */
type AiAssignMode = 'mining' | 'salvage' | 'standby' | 'refine' | 'craft'
/** 站内制造线可选的已学会蓝图（含材料单，供缺料判定与提示） */
interface CraftOption {
  id: string
  name: string
  group: '装备蓝图' | '舰船蓝图' | '弹药蓝图'
  materials: readonly { itemId: string; count: number }[]
  buildSeconds: number
}
const SHIP_TABS: Array<{ key: ShipTab; label: string; icon: string; title?: string }> = [
  { key: 'fleet', label: '我的舰队', icon: 'nav-ship' },
  { key: 'ai', label: 'AI 指挥中心', icon: 'nav-ai', title: 'AI 副船：指派采矿/打捞/掩护巡逻' },
  { key: 'shop', label: '舰船市场', icon: 'nav-shop' },
]

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
  // T5：当前展开出售确认的船（同时只展开一艘）
  const [sellConfirmId, setSellConfirmId] = useState<string | null>(null)
  // T7：扫描在途换船＝警告确认（模式甲：确认后先终止扫描——进度保留——再切换）
  const [scanSwitchId, setScanSwitchId] = useState<string | null>(null)
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
  // 2026-09-10 舰队检索：搜索词 / 状态筛选 / 排序键
  const [fleetQ, setFleetQ] = useState('')
  const [fleetFilter, setFleetFilter] = useState<FleetFilter>('all')
  const [fleetSort, setFleetSort] = useState<FleetSort>('default')

  // ── 舰影列自适应（2026-09-10 船长：每艘船的舰船形象置卡片最左侧；屏幕宽度不足时隐藏图形）──
  // 判定取舰队列表容器的**实测宽**（clientWidth 已扣竖向滚动条），不用窗口宽猜：
  // 卡片高由右侧信息列决定（舰影更矮），故舰影显示/隐藏不会反过来改变容器宽，无振荡。
  const fleetScrollRef = useRef<HTMLDivElement | null>(null)
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

  /** 舰队检索结果（2026-09-10 船长：先按状态/关键词过滤，再按所选键排序；默认保持机库序） */
  const fq = fleetQ.trim().toLowerCase()
  const fleetShown = (() => {
    const list = fleetEntries.filter(({ uid, ship }) => {
      if (fq.length > 0) {
        const name = shipDisplayName(state, ctx, uid).toLowerCase()
        const defName = (ctx.ships.get(ship.defId ?? uid)?.name ?? '').toLowerCase()
        if (!name.includes(fq) && !defName.includes(fq)) return false
      }
      if (fleetFilter !== 'all') {
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
      return true
    })
    // 2026-09-10 船长定：已标记（收藏）的船在「默认排序」下置顶；按名称/耐久/舰族排序时置顶不生效
    if (fleetSort === 'default') return pinMarked(state, 'ships', list, (x) => x.uid)
    const sorted = [...list]
    sorted.sort((a, b) => {
      if (fleetSort === 'name') {
        return shipDisplayName(state, ctx, a.uid).localeCompare(shipDisplayName(state, ctx, b.uid), 'zh-CN')
      }
      if (fleetSort === 'durability') {
        const da = durabilityOf(state, a.uid)
        const db = durabilityOf(state, b.uid)
        if (da !== db) return da - db // 坏船在前（待修优先）
        return (a.ship.armorPct ?? 1) - (b.ship.armorPct ?? 1)
      }
      const ra = FLEET_ROLE_ORDER.indexOf(a.def.role ?? 'industrial')
      const rb = FLEET_ROLE_ORDER.indexOf(b.def.role ?? 'industrial')
      if (ra !== rb) return ra - rb
      return a.def.tier - b.def.tier
    })
    return sorted
  })()

  function handleSwitch(id: string): void {
    // 扫描探索在途：先弹确认（终止扫描=已扫窗口进度保留，可续扫），确认后才执行
    if (state.scanning.active) {
      setScanSwitchId(id)
      return
    }
    const r = engine.changeShipAt(id)
    if (!r.ok) onToast(r.error ?? '切换失败', true)
    else flashSwitchPilot(id)
  }

  /** 确认：终止扫描（进度保留）→ 切换驾驶 */
  function confirmScanSwitch(id: string): void {
    setScanSwitchId(null)
    const stop = engine.stopScanNow()
    if (!stop.ok) {
      onToast(stop.error ?? '终止扫描失败，未切换。', true)
      return
    }
    const r = engine.changeShipAt(id)
    if (!r.ok) onToast(r.error ?? '切换失败', true)
    else {
      onToast('已终止扫描（进度保留，可续扫）并切换驾驶。')
      flashSwitchPilot(id)
    }
  }

  function handleRepair(id: string): void {
    const r = engine.repairShipAt(id)
    if (!r.ok) onToast(r.error ?? '维修失败', true)
    else onToast('维修完成：结构/装甲已修复。')
  }

  /** T5：锁定/解锁防误售 */
  function handleToggleLock(id: string, currentlyLocked: boolean): void {
    const r = engine.lockShipAt(id, !currentlyLocked)
    if (!r.ok) onToast(r.error ?? '操作失败', true)
    else onToast(currentlyLocked ? '已解锁：恢复可出售。' : '已锁定：此船不可出售（防止误售）。')
  }

  function confirmSell(id: string): void {
    const r = engine.sellShipAt(id)
    if (!r.ok) onToast(r.error ?? '出售失败', true)
    else onToast('出售指令已受理：有收购单即时成交；没有则自动挂卖单（可撤单退回机库）。')
    setSellConfirmId(null)
  }

  /** 开始改名（恢复默认名 = 直接提交 null） */
  function startRename(id: string, currentCustom: string | null | undefined): void {
    setRenameId(id)
    setRenameDraft(currentCustom ?? '')
  }
  function submitRename(id: string, name: string | null): void {
    const r = engine.renameShipAt(id, name)
    if (!r.ok) onToast(r.error ?? '改名失败', true)
    else onToast(name === null ? '已恢复默认船名。' : `已命名为「${name.trim()}」。`)
    setRenameId(null)
    setRenameDraft('')
  }

  /** 出售确认前的本船预检：返回 { 模块名列表, 货仓单位 }（两者有任一即禁售并醒目提示） */
  function sellBlockers(shipState: FleetShipState | undefined): { modules: string[]; cargoUnits: number } {
    const modules: string[] = []
    if (shipState) {
      for (const modId of allFittedIds(shipState.fitted)) {
        modules.push(engine.ctx.modules.get(modId)?.name ?? modId)
      }
    }
    const cargoUnits = Object.values(shipState?.cargo ?? {}).reduce((a, b) => a + b, 0)
    return { modules, cargoUnits }
  }

  return (
    <div className="page-stack page-fill">
      {/* 舰队 / AI 指挥 / 舰船市场（MapPage/IndustryPage 同款 app-subtabs 规范）；标签行固定，活跃面板吸满并 body 内滚 */}
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
        title="我的舰队"
        right={
          <span className="app-dim">
            {Object.keys(state.fleet).length} 艘 · 当前驾驶：
            <span className={`app-pilot-name${switchFxUid !== null ? ' is-pulse' : ''}`}>
              {shipDisplayName(state, ctx, state.shipId)}
            </span>
          </span>
        }
      >
        {/* 舰队工具条（2026-09-10 船长：搜索/状态筛选/排序；样式与仓库、技能目录同款）——固定在列表上方不随滚动 */}
        <div className="app-fleet-toolbar">
          <span className="app-head-search-wrap">
            <input
              className="app-head-search"
              type="text"
              placeholder="搜索舰船…"
              value={fleetQ}
              onChange={(e) => setFleetQ(e.target.value)}
              spellCheck={false}
            />
          </span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            {FLEET_FILTER_TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={fleetFilter === t.key}
                className={`app-tasktab${fleetFilter === t.key ? ' is-active' : ''}`}
                onClick={() => setFleetFilter(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select
            className="app-select"
            value={fleetSort}
            onChange={(e) => setFleetSort(e.target.value as FleetSort)}
            title="排序方式"
          >
            <option value="default">默认排序</option>
            <option value="name">按名称</option>
            <option value="durability">耐久（待修优先）</option>
            <option value="role">按舰船族</option>
          </select>
          <span className="app-dim">
            {fleetShown.length} 艘{fq.length > 0 || fleetFilter !== 'all' ? '（已筛选）' : ''}
          </span>
        </div>
        <div className="app-fleet-scroll" ref={fleetScrollRef}>
        {scanSwitchId ? (
          <div className="app-sell-confirm" style={{ marginTop: 0, marginBottom: 8 }}>
            <div className="app-sell-warn" style={{ background: 'transparent' }}>
              ⚠ 扫描探索进行中：切换驾驶将终止本次扫描（已扫窗口进度保留，可对该星系续扫）。
            </div>
            <div className="app-sell-confirm-title">确认切换至「{shipDisplayName(state, ctx, scanSwitchId)}」？</div>
            <div className="app-sell-confirm-btns">
              <button className="app-btn is-small is-warn" onClick={() => confirmScanSwitch(scanSwitchId)}>
                终止扫描并切换
              </button>
              <button className="app-btn is-small" onClick={() => setScanSwitchId(null)}>
                取消
              </button>
            </div>
          </div>
        ) : null}
        {fleetShown.length === 0 ? (
          <div className="app-dim app-note">
            {Object.keys(state.fleet).length === 0
              ? '机库里还没有舰船。'
              : `没有匹配的舰船${fq.length > 0 ? `（关键词「${fleetQ.trim()}」）` : '（当前筛选）'}——换个关键词或筛选条件试试。`}
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
            const blockers = sellBlockers(shipState)
            const blockCount = blockers.modules.length + (blockers.cargoUnits > 0 ? 1 : 0)
            // 出售估价：当前收购价（无报价就不写死数字）
            const sellGood = marketGoodOf(engine.ctx, 'ship', def.id)
            const sellBuy = sellGood ? marketQuote(state, engine.ctx, sellGood.key).buy : undefined
            const canSell = !isCurrent && !isWorking && !isLockedShip
            return (
              <ShipHover key={uid} ship={def} block>
                <div
                  className={`app-ship-card is-fleet${isCurrent ? ' is-current' : ''}${switchFxUid === uid ? ' is-switch-pulse' : ''}`}
                >
                {/* 舰影列：固定尺寸、置卡片最左侧；容器过窄时整列不渲染（样式 .app-ship-card.is-fleet） */}
                {fleetArt ? <FleetArt shipId={def.id} role={def.role} /> : null}
                <div className="app-ship-main">
                <div className="app-ship-top">
                  <span className="app-ship-name">
                    {displayName}
                    <em className={`app-chip app-role-chip is-${def.role}`}>{shipRoleLabel(def.role)}</em>
                    {def.priceIsk <= 0 && def.id !== 'sandcat' ? <em className="app-belt-flag">定制</em> : null}
                    {isLockedShip ? (
                      <em className="app-chip app-lock-chip" title="已锁定：此船不可出售（防误售）">
                        <span className="app-ico">
                          <Glyph name="ico-lock" size={11} color={ICO_TONES['ico-lock']} />
                        </span>
                        锁定
                      </em>
                    ) : null}
                  </span>
                  <span className="app-ship-top-right">
                    <MarkStar engine={engine} kind="ships" id={uid} />
                    {isCurrent ? (
                      <span className="app-chip">驾驶中</span>
                    ) : isWorking ? (
                      <span className="app-chip">AI 执勤中</span>
                    ) : null}
                    <button
                      className="app-btn is-small"
                      title={`进入「${displayName}」的装配台——可直接为该船装配/卸下装备（不需要切换驾驶）`}
                      onClick={() => onGotoFit?.(uid)}
                    >
                      <span className="app-ico">
                        <Glyph name="nav-fit" size={13} color={NAV_TONES['nav-fit']} />
                      </span>
                      装配
                    </button>
                    {!isRenaming ? (
                      <button
                        className="app-btn is-small"
                        title={shipState.customName ? `已自定义名称——点击改名（或恢复默认）` : '自由改名（免费，10 字内，可重名；同型默认自动带 #N）'}
                        onClick={() => startRename(uid, shipState.customName)}
                      >
                        改名
                      </button>
                    ) : null}
                    <button
                      className={`app-btn is-small app-lock-btn${isLockedShip ? ' is-warn' : ''}`}
                      title={isLockedShip ? '已锁定防误售——点击解锁' : '锁定此船，防止误售（锁定后仍可驾驶/派 AI）'}
                      onClick={() => handleToggleLock(uid, isLockedShip)}
                    >
                      {isLockedShip ? (
                        '解锁'
                      ) : (
                        <>
                          <span className="app-ico">
                            <Glyph name="ico-lock" size={12} color={ICO_TONES['ico-lock']} />
                          </span>
                          锁定
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
                      placeholder="新船名（10 字内，允许重名）"
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
                      确定
                    </button>
                    {shipState.customName ? (
                      <button className="app-btn is-small" onClick={() => submitRename(uid, null)}>
                        恢复默认名
                      </button>
                    ) : null}
                    <button className="app-btn is-small" onClick={() => setRenameId(null)}>
                      取消
                    </button>
                  </div>
                ) : null}
                <div className="app-ship-spec">
                  货舱 {def.cargoM3.toLocaleString('zh-CN')} m³ · 循环 {def.cycleSeconds} 秒 × {def.oreUnitsPerCycle} 单位 · 动力 {Math.round(def.agility * 100)}%
                </div>
                <div className="app-dur-row">
                  <div className="app-dur-track">
                    <div className="app-dur-fill" style={{ width: `${Math.round(dur * 100)}%` }} />
                  </div>
                  <span
                    className={`app-dur-text${dur < 0.5 || armor < 0.5 ? ' is-bad' : dur < 1 || armor < 1 ? ' is-mid' : ''}`}
                    title={`结构（=原耐久，与装甲同为跨场保留的损伤；护盾损失不保留）${dur < 1 ? `：结构 ${Math.round(dur * 100)}%` : ''}${armor < 1 ? `，装甲 ${Math.round(armor * 100)}%` : ''}`}
                  >
                    结构 {Math.round(dur * 100)}%{armor < 1 ? ` · 装甲 ${Math.round(armor * 100)}%` : ''}
                  </span>
                  {(dur < 1 || armor < 1) && !isWorking ? (
                    <button
                      className="app-btn is-small is-warn"
                      onClick={() => handleRepair(uid)}
                      disabled={state.wallet.isk < repairCost}
                      title={`维修需 ${repairCost.toLocaleString('zh-CN')} ISK（结构+装甲一并修复；护盾无需维修）`}
                    >
                      维修 {repairCost.toLocaleString('zh-CN')}
                    </button>
                  ) : null}
                  {isCurrent && (dur < 1 || armor < 1) && kitCount > 0 ? (
                    <button
                      className="app-btn is-small"
                      onClick={() => {
                        const r = engine.useRepairKitNow()
                        if (!r.ok) onToast(r.error ?? '使用修理组件失败', true)
                        else onToast('已使用一枚修理组件（基础 HP×容量增幅，民用30/军用70）。')
                      }}
                      title="消耗驾驶船货仓 1 枚修理组件（民用优先）：基础回复 HP×容量增幅（民用30/军用70）——野外/回港前应急可用"
                    >
                      <span className="app-ico">
                        <Glyph name="ico-cross" size={12} color={ICO_TONES['ico-cross']} />
                      </span>
                      组件修复 ×{kitCount}
                    </button>
                  ) : null}
                </div>
                {canSell ? (
                  sellConfirmId === uid ? (
                    /* T5 二次确认：醒目标出货舱/装配未清空的阻止原因 */
                    <div className="app-sell-confirm">
                      <div className="app-sell-confirm-title">确认出售「{displayName}」？</div>
                      <div className="app-dim app-sell-confirm-note">
                        将按当前市场收购价即时成交；没有收购单时自动转为限价卖单（可随时撤销退回机库）。
                        {sellBuy !== undefined ? ` 预计到手约 ${isk(sellBuy)} ISK（税后以实际成交计）。` : ''}
                      </div>
                      {blockers.modules.length > 0 ? (
                        <div className="app-sell-warn">
                          ⚠ 该船仍装配着装备（{blockers.modules.join('、')}），必须先卸下才能出售！
                        </div>
                      ) : null}
                      {blockers.cargoUnits > 0 ? (
                        <div className="app-sell-warn">
                          ⚠ 货仓里还有 {blockers.cargoUnits.toLocaleString('zh-CN')} 单位货物——请先清空或卸入仓库！
                        </div>
                      ) : null}
                      <div className="app-sell-confirm-btns">
                        <button
                          className="app-btn is-small is-warn"
                          disabled={blockCount > 0}
                          title={blockCount > 0 ? '先卸下装备并清空货仓才能出售' : '确认按上述条件出售'}
                          onClick={() => confirmSell(uid)}
                        >
                          确认出售
                        </button>
                        <button className="app-btn is-small" onClick={() => setSellConfirmId(null)}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="app-ship-bottom">
                      <span className="app-dim">货仓与装备随船保存</span>
                      <div className="app-ship-bottom-btns">
                        <button
                          className="app-btn is-small"
                          onClick={() => setSellConfirmId(uid)}
                          title="出售前需确认；有装备/货物会在此处醒目提示"
                        >
                          市价出售
                        </button>
                        <button className="app-btn is-small is-primary" onClick={() => handleSwitch(uid)}>
                          切换驾驶
                        </button>
                      </div>
                    </div>
                  )
                ) : !isCurrent && !isWorking ? (
                  /* T5-A 修正（船长反馈）：锁定只禁出售——锁定的闲置船仍可切换驾驶 */
                  <div className="app-ship-bottom">
                    <span className="app-dim">货仓与装备随船保存</span>
                    <div className="app-ship-bottom-btns">
                      <span className="app-chip app-lock-chip" title="已锁定：此船不可出售（防误售）">
                        <span className="app-ico">
                          <Glyph name="ico-lock" size={11} color={ICO_TONES['ico-lock']} />
                        </span>
                        已锁定
                      </span>
                      <button className="app-btn is-small is-primary" onClick={() => handleSwitch(uid)}>
                        切换驾驶
                      </button>
                    </div>
                  </div>
                ) : null}
                </div>
                </div>
              </ShipHover>
            )
          })}
        </div>
        )}
        </div>
      </Panel>
      </>
      ) : null}

      {activeTab === 'ai' ? <AiCommandPanel engine={engine} onToast={onToast} /> : null}

      {activeTab === 'shop' ? (
        <Panel
          className="is-fill"
          title="舰船市场"
          right={<span className="app-dim">现货看订单簿 · 无货可挂收购单自动等补货</span>}
        >
        <div className="app-ship-list">
          {engine.ships
            .filter((def) => {
              for (const good of engine.ctx.marketGoods.values()) {
                if (good.kind === 'ship' && good.refId === def.id) return true
              }
              return false
            })
            .map((def) => {
              // v17：可重复拥有同型——统计机库内该型艘数（实例 uid 或以 defId 为键的第 1 艘）
              const ownedCount = Object.keys(state.fleet).filter(
                (k) => state.fleet[k]!.defId === def.id || k === def.id,
              ).length
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
                      <em className={`app-chip app-role-chip is-${def.role}`}>{shipRoleLabel(def.role)}</em>
                    </span>
                    <span className={`app-chip${good?.rarity === 'common' ? '' : good?.rarity === 'rare' ? ' is-rare' : ' is-exotic'}`}>
                      {good ? rarityLabel(good.rarity) : ''}
                    </span>
                  </div>
                  <div className="app-ship-spec">
                    货舱 {def.cargoM3.toLocaleString('zh-CN')} m³ · 循环 {def.cycleSeconds} 秒 × {def.oreUnitsPerCycle} 单位 · 动力 {Math.round(def.agility * 100)}%
                  </div>
                  <div className="app-ship-desc">{def.description}</div>
                  <div className="app-ship-bottom">
                    {ask !== undefined ? (
                      <span className="app-ship-price">现货 {isk(ask)} ISK</span>
                    ) : (
                      <span className="app-dim">暂无现货 · 挂收购单自动等货</span>
                    )}
                    {ownedCount > 0 ? (
                      <span className="app-chip" title="机库里已有同型舰船；可再购一艘（同型多艘自动编号）">
                        机库 ×{ownedCount}
                      </span>
                    ) : null}
                    {lock ? (
                      <span className="app-chip is-exotic" title={lock}>
                        <span className="app-ico">
                          <Glyph name="ico-lock" size={11} color={ICO_TONES['ico-lock']} />
                        </span>
                        {lock}
                      </span>
                    ) : null}
                    {good ? (
                      <button
                        className={`app-btn is-small${lock ? '' : ' is-primary'}`}
                        disabled={!onGotoMarket}
                        title={lock ?? '前往市场页查看该舰船订单——自动聚焦搜索该船，现货/挂单都在市场操作'}
                        onClick={() => onGotoMarket?.(good.key)}
                      >
                        去市场查看 / 下单
                      </button>
                    ) : null}
                  </div>
                  </div>
                </ShipHover>
              )
            })}
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
  const [coreType, setCoreType] = useState<AiCoreType>('basic')
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
  const effCore = usableCores.includes(coreType) ? coreType : (usableCores[0] ?? 'basic')
  /** 副船任务须有共用上限（「AI 核心操作学」）；站内工业另可用「工业自动化」扩容工位——
   *  共用上限为 0 而工业扩容 > 0 时，只允许指派站内工业任务（回落显示制造）。 */
  const shipTasksOk = cap > 0
  const effMode: AiAssignMode =
    shipTasksOk || mode === 'refine' || mode === 'craft' ? mode : 'craft'

  /** 站内工业可指派的目标（与工业页卡片同口径）：
   *  精炼炉 = 全部带精炼配方的资源；回收炉 = 当前有料（货仓或仓库）的残骸；制造线 = 已学会的蓝图。 */
  const allItemDefs = [...engine.ctx.items.values()]
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
        group: '弹药蓝图',
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
      })
    } else {
      craftAll.push({
        id: bp.id,
        name: engine.ctx.modules.get(bp.moduleId ?? '')?.name ?? bp.name,
        group: '装备蓝图',
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
      })
    }
  }
  for (const sbp of engine.shipBlueprints) {
    craftAll.push({
      id: sbp.id,
      name: engine.ctx.ships.get(sbp.shipId)?.name ?? sbp.name,
      group: '舰船蓝图',
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
  /** 指派按钮置灰原因（null = 可指派；文案与下方各下拉一一对应） */
  const assignBlock: string | null =
    usableCores.length === 0
      ? '无可用 AI 核心：先去市场购入「基础 AI 核心」，或先取消占用中的任务、训练「AI 核心操作学」提高上限'
      : isIndustryTask && !isAtHomeLike(state, engine.ctx)
        ? '站内工业（精炼炉/回收炉/制造线）随协会基地网络运转：需停靠空间站（母港或已建成副站）才能开工——先返航停靠'
        : !isIndustryTask && !shipId
          ? idleShips.length === 0
            ? '没有可指派的空闲舰船（舰船均在执勤/出航中）'
            : '先选择一艘空闲舰船'
          : effMode === 'salvage' && !salvageGalaxyId
          ? '先选择打捞目标星系（需已探索且有敌群残骸的星系）'
          : effMode === 'standby' && !standbyGalaxyId
            ? '先选择掩护巡逻的目标星系（需已探索的星系）'
            : effMode === 'refine' && !effRefineId
              ? '当前没有可精炼的资源或可回收的残骸（先去采集/打捞，或从市场买入原料）'
              : effMode === 'refine' && refineHave <= 0
                ? `仓库与货仓里没有「${selRefine?.name ?? ''}」——先补料再开炉`
                : effMode === 'craft' && !effCraftId
                  ? '还没有已学会的蓝图——先到工业页「蓝图书架」学习一张'
                  : effMode === 'craft' && craftShort.length > 0
                    ? `材料不足：${craftShort.join('；')}`
                    : null

  /** 站内工业 AI 名册（只列 AI 核心驱动的：worker 非 'pilot'；老档免占用的旧作业不计） */
  const aiRefineRuns = engine.refineRunViews().filter((v) => v.worker !== 'pilot')
  const aiMakeRuns = manufacturingRunViews(state, engine.ctx).filter((v) => v.worker !== null && v.worker !== 'pilot')


  function handleBuyCore(): void {
    const r = engine.buyBasicCoreAt()
    if (!r.ok) onToast(r.error ?? '购买失败', true)
    else onToast('购买指令已受理：现货立即入核心库；无现货已挂收购单（到货自动入库）。')
  }

  function handleAssign(): void {
    // 站内工业两类：不出舰船，直接把一枚 AI 核心接进炉/线（与工业页卡片同一批引擎命令）
    if (effMode === 'craft') {
      if (!effCraftId) {
        onToast('先在「蓝图」下拉里选一张已学会的蓝图。', true)
        return
      }
      const r = engine.startManufacturingAt(effCraftId, effCore)
      if (!r.ok) onToast(r.error ?? 'AI 制造线开工失败', true)
      else onToast('AI 制造线已开工（核心已占用，完成或取消时自动归还）。')
      return
    }
    if (effMode === 'refine') {
      if (!selRefine) {
        onToast('先在「资源」下拉里选一种可精炼资源或残骸。', true)
        return
      }
      const isWreck = selRefine.kind === 'wreck'
      const r = isWreck
        ? engine.startRecycleRunAt(selRefine.id, effCore)
        : engine.startRefineRunAt(selRefine.id, effCore)
      if (!r.ok) onToast(r.error ?? 'AI 炉开工失败', true)
      else
        onToast(
          isWreck
            ? 'AI 回收炉已开工：每批到点实时扣料，耗尽自动停。'
            : 'AI 精炼炉已开工：每批到点实时扣料，耗尽自动停。',
        )
      return
    }
    if (!shipId) {
      onToast('先选择一艘空闲舰船。', true)
      return
    }
    const r =
      effMode === 'mining'
        ? engine.assignAiMiningAt(shipId, effCore, beltId)
        : effMode === 'salvage'
          ? engine.assignAiSalvageAt(shipId, effCore, salvageGalaxyId)
          : engine.assignAiStandbyAt(shipId, effCore, standbyGalaxyId)
    if (!r.ok) onToast(r.error ?? '指派失败', true)
    else onToast('AI 任务已下达。')
  }

  /** 取消执行中的 AI 任务（船长 2026-09-05：活动栏简略后须在 AI 指挥中心内可直接取消） */
  function handleCancelAi(sid: string): void {
    if (engine.cancelAiTaskAt(sid)) onToast('AI 任务已取消（核心已归还）。')
    else onToast('取消失败：任务状态异常。', true)
  }

  /** 停止站内工业 AI（炉/制造线）——与工业页卡片同一批引擎命令，核心自动归还 */
  function handleStopIndustry(runId: number, isMake: boolean): void {
    const r = isMake ? engine.cancelManufacturingAt(runId) : engine.stopRefineRunAt(runId)
    if (!r.ok) onToast(r.error ?? '停止失败', true)
    else onToast(isMake ? '已取消该条 AI 制造线（核心已归还）。' : '已停该台 AI 炉（核心已归还）。')
  }

  return (
    <Panel
      className="is-fill"
      title="AI 指挥中心"
      right={
        <span className="app-dim">
          AI 核心启用 {used}/{totalCap}
          {industryBonus > 0 ? `（共用 ${cap} + 工业扩容 ${industryBonus}）` : ''}
        </span>
      }
    >
      {/* 名额与核心库 */}
      <div className="app-ai-status">
        <span className="app-dim">
          AI 核心启用上限 {cap} 枚（AI 副船任务与站内精炼炉/回收炉/制造线共用；上限由「AI 核心操作学」决定）
          {industryBonus > 0 ? '；站内产业另获「工业自动化」扩容 '+industryBonus+' 枚工业专用工位（仅炉/线可用——工业占用先抵这 '+industryBonus+' 枚，不占副船名额；超出扩容的部分才占用共用上限）' : '；站内产业可通过「工业自动化」（每级 +2 枚工业专用工位）扩产'}{cap === 0 && industryBonus <= 0 ? '（先到「技能」页训练 AI 核心操作学）' : ''}
        </span>
        <div className="app-core-badges">
          {AI_CORE_ORDER.map((type) => (
            <span key={type} className={`app-chip${countAiCore(state, type) > 0 ? '' : ' is-dim'}`}>
              {aiCoreName(type)} ×{countAiCore(state, type)}（{Math.round(aiEfficiency(state, engine.ctx, type) * 100)}%）
            </span>
          ))}
          <button className="app-btn is-small is-primary" onClick={handleBuyCore}>
            市场购入基础核心{marketQuote(state, engine.ctx, 'core-basic').sell !== undefined ? ` · ${isk(marketQuote(state, engine.ctx, 'core-basic').sell!)} ISK` : '（暂缺货·可挂单）'}
          </button>
        </div>
      </div>

      {/* 指派表单：共用上限与工业扩容只要有一个 > 0 就能开工（工业 AI 可只用扩容工位） */}
      {totalCap > 0 ? (
        <div className="app-ai-assign">
          <select
            className="app-select"
            value={isIndustryTask ? '' : shipId}
            onChange={(e) => setShipId(e.target.value)}
            disabled={isIndustryTask || idleShips.length === 0}
            title={
              isIndustryTask
                ? '站内工业 AI 不需要舰船：核心直接接进精炼炉/回收炉/制造线'
                : idleShips.length === 0
                  ? '当前没有空闲舰船可指派（舰船均在执勤/出航中）'
                  : '选择空闲舰船'
            }
          >
            <option value="">
              {isIndustryTask ? '站内工业无需舰船' : idleShips.length === 0 ? '无空闲舰船' : '— 选择空闲舰船 —'}
            </option>
            {idleShips.map((id) => (
              <option key={id} value={id}>
                {shipDisplayName(state, engine.ctx, id)}（结构 {Math.round(durabilityOf(state, id) * 100)}%）
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
                ? '无可用 AI 核心：核心库为空或全部已在占用中——去市场购入「基础 AI 核心」，或先取消占用中的任务、训练「AI 核心操作学」提高上限'
                : 'AI 核心类型（一枚核心驱动一项任务；无库存的类型不会列出）'
            }
          >
            {usableCores.length === 0 ? (
              <option value="">无可用 AI 核心</option>
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
            title="任务类型：副船任务（采矿/打捞/掩护巡逻）或站内工业（精炼炉与回收炉/组装机制造线）"
          >
            <option value="mining" disabled={!shipTasksOk}>
              副船 · 采矿任务{shipTasksOk ? '' : '（需先训练「AI 核心操作学」解锁共用上限）'}
            </option>
            <option value="salvage" disabled={!shipTasksOk}>
              副船 · 打捞任务{shipTasksOk ? '' : '（需先训练「AI 核心操作学」解锁共用上限）'}
            </option>
            <option value="standby" disabled={!shipTasksOk}>
              副船 · 掩护巡逻{shipTasksOk ? '' : '（需先训练「AI 核心操作学」解锁共用上限）'}
            </option>
            <option value="refine">站内 · 精炼炉/回收炉</option>
            <option value="craft">站内 · 组装机制造线</option>
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
                      ? `✧ ${b.name}（所在星系未探索——先到出港页扫描）`
                      : locked
                        ? `✕ ${b.name}（需声望 ${b.standingReq}，当前 ${standing}）`
                        : `${b.name}（${engine.ctx.items.get(b.oreId)?.name}）`}
                  </option>
                )
              })}
            </select>
          ) : effMode === 'salvage' ? (
            <select className="app-select" value={salvageGalaxyId} onChange={(e) => setSalvageGalaxyId(e.target.value)}>
              <option value="">— 选星系（需已探索且有敌群残骸） —</option>
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
              title="副船前往该星系掩护巡逻并留守（到达后可随时取消召回）"
            >
              <option value="">— 选星系（需已探索） —</option>
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
              title="♨ 精炼炉炼矿石/气体/冰矿；♻ 回收炉拆残骸（仓库或货仓要有料）"
            >
              {refineAll.length === 0 ? <option value="">没有可精炼的资源或残骸</option> : null}
              {refineOres.length > 0 ? (
                <optgroup label="♨ 可精炼资源">
                  {refineOres.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}（货仓+仓库 ×{oreAvailable(state, d.id).toLocaleString('zh-CN')}）
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {refineWrecks.length > 0 ? (
                <optgroup label="♻ 残骸回收">
                  {refineWrecks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}（可拆 {Math.round(oreAvailable(state, d.id) * 10) / 10} m³）
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
              title="只列已学会的蓝图（未学会的先去工业页「蓝图书架」学习）；材料不足会开工失败并提示"
            >
              {craftLearned.length === 0 ? <option value="">没有已学会的蓝图</option> : null}
              {(['装备蓝图', '舰船蓝图', '弹药蓝图'] as const).map((group) =>
                craftLearned.some((o) => o.group === group) ? (
                  <optgroup key={group} label={group}>
                    {craftLearned
                      .filter((o) => o.group === group)
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
            指派任务
          </button>
        </div>
      ) : (
        <div className="app-dim app-inv-empty">
          AI 核心上限为 0（共用上限 0 + 工业扩容 0）：先训练「AI 核心操作学」（rank2 入门向，每级 +1 枚共用上限）即可指派副船任务；
          站内产业也可先练「工业自动化」解锁工业专用工位（每级 +2 枚，仅炉/线可用）。
        </div>
      )}

      {/* 执行中列表：AI 副船任务 + 站内工业 AI（2026-09-10 船长：统一在一处呈现与停止） */}
      <div className="app-bay-title">
        执行中 · AI 副船 {assignN} · 站内工业 {prodN}
      </div>
      {assignN === 0 && prodN === 0 ? (
        <div className="app-dim app-inv-empty">没有正在执行的 AI 任务。</div>
      ) : null}
      {assignN === 0 ? (
        prodN > 0 ? <div className="app-dim app-inv-empty">没有 AI 副船任务。</div> : null
      ) : (
        <ul className="app-inv-list">
          {Object.entries(state.aiAssignments).map(([sid, assignment]) => {
            const task = assignment.task
            const eff = aiEfficiency(state, engine.ctx, assignment.coreType)
            const aiView = aiTaskView(state, engine.ctx, sid)
            let desc = ''
            if (task.kind === 'mining') {
              const belt = engine.ctx.belts.get(task.beltId)
              const phaseLabel = task.phase === 'returning' ? '返航中' : task.phase === 'outbound' ? '出航中' : '采掘中'
              desc = `采矿 ${belt?.name ?? task.beltId} · ${phaseLabel} · 本趟 ${task.tripUnits} 单位`
            } else if (task.kind === 'expedition') {
              // 防御分支：AI 远征已停用（2026-09-05 软下线、2026-09-08 UI 隐藏），理论不出现——老档残留兜底显示
              const a = engine.ctx.anomalies.get(task.anomalyId)
              const remain = Math.max(0, task.finishAtGameMs - state.gameMs)
              desc = `远征 ${a?.name ?? task.anomalyId} · 剩余约 ${Math.floor(remain / 60_000)} 分钟`
            } else if (task.kind === 'salvage') {
              const g = engine.ctx.galaxies.get(task.galaxyId)
              const phaseLabel = task.phase === 'returning' ? '返航卸货' : task.phase === 'outbound' ? '出航' : '打捞中'
              desc = `打捞 ${g?.name ?? task.galaxyId} · ${phaseLabel}（本趟约 ${Math.round(task.tripM3 * 10) / 10} m³）`
            } else {
              const g = engine.ctx.galaxies.get(task.galaxyId)
              desc =
                task.phase === 'out'
                  ? `前往 ${g?.name ?? task.galaxyId} 掩护巡逻（去程中）`
                  : `掩护巡逻：${g?.name ?? task.galaxyId}`
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
                    {desc} · {aiCoreName(assignment.coreType)}（效率 {Math.round(eff * 100)}%）
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
                    title={`取消 ${shipDisplayName(state, engine.ctx, sid)} 的 AI 任务：副船召回，核心归还核心库`}
                  >
                    取消任务
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
            站内工业 AI：可在上方直接指派，参数调整在工业页卡片；这里可随时停止（核心自动归还）。
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
                      {isReclaim ? '回收炉' : '精炼炉'} · {v.itemName}
                    </span>
                    <span className="app-inv-count">
                      {v.workerLabel}核心 · 已 {v.batchesDone} 批（每批 {v.batchUnits.toLocaleString('zh-CN')} 单位）
                    </span>
                    <span className="app-inv-count">
                      <AiTaskBar
                        view={{ kind: 'ai', phase: 'refine', label: '本批', percent: v.percent, remainingMs: v.remainingMs }}
                      />
                    </span>
                    </div>
                  </div>
                  <div className="app-inv-btns">
                    <button
                      className="app-btn is-small is-warn"
                      onClick={() => handleStopIndustry(v.id, false)}
                      title="停这台炉：已完成批保留；原料未锁定无需退回，AI 核心自动归还"
                    >
                      停止
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
                  <span className="app-inv-name">组装机 · {v.productName}</span>
                  <span className="app-inv-count">
                    {/* 循环制造为卡片级（2026-09-10 船长定）：这里显示该卡合计进度，不再按线各写各的 */}
                    {v.workerLabel}核心 ·{' '}
                    {v.loopOn
                      ? `循环制造 · 本卡合计 ${v.loopProduced.toLocaleString('zh-CN')}${v.loopGoal > 0 ? `/${v.loopGoal.toLocaleString('zh-CN')}` : ''} 件`
                      : '单件生产'}
                  </span>
                  <span className="app-inv-count">
                    <AiTaskBar
                      view={{ kind: 'ai', phase: 'make', label: '本件', percent: v.percent, remainingMs: v.remainingMs }}
                    />
                  </span>
                  </div>
                </div>
                <div className="app-inv-btns">
                  <button
                    className="app-btn is-small is-warn"
                    onClick={() => handleStopIndustry(v.id, true)}
                    title="取消这条制造线：材料已扣不退，AI 核心自动归还"
                  >
                    停止
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
