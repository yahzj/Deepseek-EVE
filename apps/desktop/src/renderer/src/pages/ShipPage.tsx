import { memo, useEffect, useRef, useState } from 'react'
import { Check, Plus, Wrench } from '../ui/layoutIcons'
import { RangeEwFleet } from '../features/combat/RangeEwPanel'
import { FleetPresets } from '../features/ships/FleetPresets'
import type { ReactNode } from 'react'
import {
  AI_CORE_ORDER,
  aiCoreCap,
  aiCoreUsed,
  aiCoreShipUsed,
  aiCoreIndustryUsed,
  aiTaskView,
  aiEfficiency,
  industryAiBonus,
  countAiCore,
  usableAiCoresOf,
  goodLockedReason,
  idleAiShipIds,
  isExplored,
  marketQuote,
  shipCategoryKeyOf,
  missingMaterials,
  industryAvailable,
  shipOperationBlockReason,
  changeShipBlockReason,
  ownsBlueprint,
  manufacturingRunViews,
  visibleItemDefs,
  shipStoredCount,
  shipStorable,
  createPlayerSpec,
  droneBayTotalM3,
  cleanShipDamage,
  plugEffectsOf,
  standingOf,
  DSI_FACTION_ID,
  markedIds,
  commandBudgetOf,
  combatRosterOf,
  shipCommandCostOf,
  JUMP_FUEL_ACTIVITY_TEXT_ID,
  type JumpFuelActivity,
} from '@whale/core'
import { RowGlyph } from '../ui/itemView'
import { IconBtn } from '../ui/hud'
import { AiCoreSelect } from '../ui/aiCoreSelect'
import { FuelTank } from '../ui/FuelTank'
import '../ui/layout-css/_hud-industry.css'
import { bestAiCoreOf } from '@whale/core'
import type { AiCoreType, FleetShipState, GameState } from '@whale/core'
import { durabilityOf, repairCostIsk, shipDisplayName } from '@whale/core'
import { Panel } from '@whale/ui'
import { ShipHover } from '../ui/shipInfo'
import { ShipDamageMods } from '../ui/ShipDamageMods'
import { useSessionScroll } from '../ui/sessionView'
import { reportCompanyFlow } from '../features/exchange/companyReporter'
import type { GameEngine } from '../game/engine'
import type { ShipDef } from '@whale/core'
import { ShipSprite } from '../ui/ShipSprite'
import { AiTaskBar } from '../ui/aiProgress'
import { AiWorkFx, industryWorkKindOf } from '../ui/aiWorkFx'
import type { AiWorkKind } from '../ui/aiWorkFx'
import { Glyph, NAV_TONES, ICO_TONES } from '../ui/Glyphs'
import { MarkStar } from '../ui/marks'
import {
  FLEET_STATE_TABS,
  SHIP_DOMAIN_SUBS,
  SHIP_TIER_SUBS,
  STORE_OWN_TABS,
  SUB_ALL,
  shipRolePasses,
  shipTierPasses, subText } from '../ui/itemSubs'
import type { PageProps } from './common'
import { isk } from './common'
import { tr, cmdText } from '../i18n/locale'
import { fmtCredits } from '../i18n/fmt'
import { aiCoreText, shipRoleText, shipSubClassText } from '../ui/labelsText'

const FleetArt = memo(function FleetArt({ shipId }: { shipId: string }) {
  return <div className="app-fleet-card-art" aria-hidden="true"><ShipSprite shipId={shipId} size={192} engine={false} /></div>
})
function ShipDamageSummary({ engine, uid }: { engine: GameEngine; uid: string }) {
  const damage = cleanShipDamage(engine.state.fleet[uid]?.damagePlugs)
  if (!damage) return null
  return <div className="app-ship-plug-summary">
    <div className="app-bay-title">
      <span className="app-ship-damage-count">{tr('ui.shipDamage.013')} {damage.length}</span>
    </div>
    <div className="app-fit-icongrid">
      <ShipDamageMods ids={damage} management={plugEffectsOf(engine.state, engine.ctx, uid).find(mod => mod.damageManagement)?.damageManagement} />
    </div>
  </div>
}

function rarityLabel(rarity: 'common' | 'rare' | 'exotic'): string {
  return rarity === 'common' ? tr("ui.MarketPage.010") : rarity === 'rare' ? tr("ui.IndustryPage.035") : tr("ui.MarketPage.028")
}

export type ShipTab = 'fleet' | 'ai' | 'store' | 'fuel'

type AiAssignMode = 'mining' | 'salvage' | 'refine' | 'craft'
interface CraftOption {
  id: string
  name: string
  group: '装备蓝图' | '舰船蓝图' | '消耗品蓝图'
  materials: readonly { itemId: string; count: number }[]
  buildSeconds: number
}
const CRAFT_GROUPS: ReadonlyArray<{ key: CraftOption['group']; id: string }> = [
  { key: '装备蓝图', id: 'ui.ShipPage.115' },
  { key: '舰船蓝图', id: 'ui.ShipPage.116' },
  { key: '消耗品蓝图', id: 'ui.ShipPage.114' },
]
const SHIP_TABS: Array<{ key: ShipTab; label: string; icon: string; title?: string }> = [
  { key: 'fleet', get label() { return tr("ui.ShipPage.001") }, icon: 'nav-ship' },
  { key: 'ai', get label() { return tr("ui.ShipPage.057") }, icon: 'nav-ai', get title() { return tr("ui.ShipPage.120") } },
  { key: 'store', get label() { return tr("ui.ShipPage.036") }, icon: 'nav-items', get title() { return tr("ui.ShipPage.121") } },
  { key: 'fuel', get label() { return tr('ui.jumpFuel.010') }, icon: 'nav-items', get title() { return tr('ui.jumpFuel.011') } },
]


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
        droneBayTotal: droneBayTotalM3(ship, engine.state.fleet[uid]?.fitted, engine.ctx, engine.state.fleet[uid]?.plugs),
      }}
    >
      {children}
    </ShipHover>
  )
}

function JumpFuelPanel({
  engine,
  onToast,
  onGotoLab,
}: {
  engine: GameEngine
  onToast: PageProps['onToast']
  onGotoLab?: () => void
}): ReactNode {
  const supply = engine.jumpFuelSupply()
  const stock = supply.ware
  const railRef = useRef<HTMLDivElement | null>(null)
  const mainRef = useRef<HTMLDivElement | null>(null)
  const [tank, setTank] = useState({ w: 84, h: 320 })
  useEffect(() => {
    const rail = railRef.current
    const main = mainRef.current
    if (!rail || !main || typeof ResizeObserver === 'undefined') return
    const sync = (): void => {
      const railH = rail.clientHeight
      const mainH = main.clientHeight
      const h = Math.max(140, Math.min(mainH > 0 ? mainH : railH, railH > 0 ? railH : mainH))
      const w = Math.max(28, Math.min(rail.clientWidth, Math.round(h * 0.46)))
      setTank((prev) => (prev.h === h && prev.w === w ? prev : { w, h }))
    }
    const ro = new ResizeObserver(sync)
    ro.observe(rail)
    ro.observe(main)
    sync()
    return () => ro.disconnect()
  }, [])
  const activities: ReadonlyArray<{ k: JumpFuelActivity; g: string }> = [
    { k: 'mine', g: 'miner' },
    { k: 'salvage', g: 'salvager' },
    { k: 'expedition', g: 'nav-bounty' },
    { k: 'ai', g: 'nav-ai' },
  ]
  return (
    <Panel className="is-fill" title={tr('ui.jumpFuel.010')}>
      <div className="hud hud-embed hud-fuel-split">
        {/* ═══ 左：**燃料罐整列**（**2026-09-30 船长手改稿「大致效果.png」**：罐体放大成靠左整列、
            与右列**等高**、罐内零文字）═══
            ⚠ 尺寸由上面那段实测给出（罐高跟着**右列内容高**走，取 `min(右列高, 罐列盒高)`）。 */}
        <div className="hud-fuel-rail" ref={railRef}>
          <FuelTank
            units={stock}
            capacity={supply.cap}
            tickUnits={Math.round(supply.cap / 2)}
            width={tank.w}
            height={tank.h}
            label={tr('ui.jumpFuel.010')}
          />
        </div>

        {/* ═══ 右：读数 → 规格 → 开关（自上而下一条竖读线）═══ */}
        <div className="hud-fuel-main" ref={mainRef}>
          <div className="hud-panel">
            <div className="hud-tank-side">
              {/* ① 主读数（最大号）= **仓库量 / 上限 单位**（船长 2026-09-30 令：显示上限多少）。
                  ⚠ **⟪文案调整 2026-09-30⟫ 船长报障「上限 6000 单位出现两次，而且'单位'还重复出现」**：
                  原来这里在读数后面又跟了一枚 `.hud-tiny` 的「单位」（模板里已经带"单位"⇒ 变成"…单位 单位"），
                  下面还另挂了一枚「上限 6,000 单位」的 chip（上限被说了第二遍）⇒ **两处都删**，单位只在模板里出现一次。 */}
              <span className="hud-row" style={{ gap: 8 }} title={tr('ui.jumpFuel.025')}>
                <Glyph name="consumable" size={18} color="currentColor" />
                <span className="hud-fuel-num">
                  {tr('ui.jumpFuel.019', {
                    p1: stock.toLocaleString('zh-CN'),
                    p2: supply.cap.toLocaleString('zh-CN'),
                  })}
                </span>
              </span>
              {/* ② 规格：**直接写在页面上**（**船长令**：「'1 单位 = 1 秒 / ×10 速度 / 每趟扣一次'这三个可以移除，
                  直接将其悬浮窗内的说明写在外面」）——原来那三枚 chip 的悬停内容（`ui.jumpFuel.014`）现在整句可见。 */}
              <p className="hud-tiny" style={{ margin: '2px 0 0', lineHeight: 1.65 }}>
                {tr('ui.jumpFuel.014')}
              </p>
              {/* ③ 动作 ＋ **在产速率**（船长 2026-09-30 令：实验室按钮边上显示现在燃料大概的生产速度/h） */}
              <div className="hud-row" style={{ gap: 8 }}>
                <IconBtn
                  glyph="ico-lab"
                  label={tr('ui.hud.202')}
                  title={tr('ui.jumpFuel.017')}
                  disabled={onGotoLab === undefined}
                  onClick={() => onGotoLab?.()}
                />
                <span
                  className={`hud-chip${supply.status === 'flowing' ? ' is-ok' : supply.status === 'full' ? ' is-acc' : ''}`}
                  title={tr('ui.jumpFuel.026')}
                >
                  <Glyph name="ico-eff" size={12} color="currentColor" />{' '}
                  {supply.status === 'flowing'
                    ? tr('ui.jumpFuel.020', { p1: supply.perHour.toLocaleString('zh-CN') })
                    : supply.status === 'full'
                      ? tr('ui.jumpFuel.022')
                      : supply.status === 'locked'
                        ? tr('ui.jumpFuel.024')
                        : tr('ui.jumpFuel.021')}
                </span>
                {stock <= 0 ? (
                  <span className="hud-tiny" style={{ color: 'var(--hud-warn)' }}>
                    {tr('ui.jumpFuel.018')}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* 四个活动开关（真 checkbox ＋ HUD 视觉件；状态另给 chip 双保险） */}
          <div className="hud-panel">
            <h3>
              <Glyph name="ico-loop" size={13} color="currentColor" /> {tr('ui.hud.207')}
            </h3>
            {activities.map(({ k, g }) => {
              const on = engine.jumpFuelEnabled(k)
              return (
                <label key={k} className="hud-sw-row" title={tr('ui.jumpFuel.016')}>
                  <span className="hud-row" style={{ gap: 8 }}>
                    <RowGlyph glyph={g} />
                    <span>{tr(JUMP_FUEL_ACTIVITY_TEXT_ID[k])}</span>
                  </span>
                  <span className="hud-row" style={{ gap: 8 }}>
                    <span className={`hud-chip${on ? ' is-ok' : ''}`}>{on ? tr('ui.hud.208') : tr('ui.hud.209')}</span>
                    <input
                      type="checkbox"
                      className="hud-sw"
                      checked={on}
                      onChange={(e) => {
                        const res = engine.setJumpFuel(k, e.target.checked)
                        if (!res.ok) onToast(cmdText(res) || tr('ui.jumpFuel.015'), true)
                      }}
                    />
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      </div>
    </Panel>
  )
}

export function ShipPage({
  engine,
  onToast,
  tab,
  onTab,
  onGotoMarket,
  onGotoFit,
  onGotoIndustryLab,
}: PageProps & {
  tab?: ShipTab
  onTab?: (t: ShipTab) => void
  onGotoMarket?: (goodKey: string) => void
  onGotoFit?: (shipId: string) => void
  onGotoIndustryLab?: () => void
}) {
  const state = engine.state
  const ctx = engine.ctx
  const [localTab, setLocalTab] = useState<ShipTab>('fleet')
  const activeTab = tab ?? localTab
  const setActiveTab = onTab ?? setLocalTab
  const [storeConfirmId, setStoreConfirmId] = useState<string | null>(null)
  const [switchAskId, setSwitchAskId] = useState<string | null>(null)
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
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [fleetQ, setFleetQ] = useState('')
  const [fleetFilter, setFleetFilter] = useState<string>(SUB_ALL)
  const [fleetTier, setFleetTier] = useState<string>(SUB_ALL)
  const [fleetRole, setFleetRole] = useState<string>(SUB_ALL)
  const [repairFleetOpen, setRepairFleetOpen] = useState(false)
  const [repairFleetPlan, setRepairFleetPlan] = useState({
    repairableShipIds: [] as string[],
    totalCost: 0,
    fullCount: 0,
    blockedCount: 0,
  })
  const [repairFleetBalance, setRepairFleetBalance] = useState(state.wallet.isk)
  const [repairFleetChanged, setRepairFleetChanged] = useState(false)
  const displayedRepairPlanRef = useRef({ plan: repairFleetPlan, balance: repairFleetBalance })

  const fleetScrollRef = useRef<HTMLDivElement | null>(null)
  useSessionScroll('ship.fleet.scroll', fleetScrollRef)
  const storeScrollRef = useRef<HTMLDivElement | null>(null)
  useSessionScroll('ship.store.scroll', storeScrollRef)
  const fleetFormationOrderRef = useRef<string[] | null>(null)
  const fleetFormationHistoryRef = useRef<Set<string> | null>(null)

  const fleetEntries = Object.entries(state.fleet)
    .map(([uid, entry]) => ({ uid, ship: entry, def: ctx.ships.get(entry.defId ?? uid) }))
    .filter((x): x is { uid: string; ship: FleetShipState; def: NonNullable<ReturnType<typeof ctx.ships.get>> } => x.def !== undefined)
    .sort((a, b) => a.def.tier - b.def.tier || a.uid.localeCompare(b.uid))

  const fleetFormationOrder = (() => {
    const known = new Set(fleetEntries.map(entry => entry.uid))
    const current = fleetFormationOrderRef.current
    if (current === null) {
      const history = state.preparationSquads?.combat ?? []
      const historySet = new Set(history.filter(uid => known.has(uid)))
      const favorites = markedIds(state, 'ships')
      const pilot = state.shipId
      const seen = new Set<string>()
      const initialOrder: string[] = []
      const append = (uid: string): void => {
        if (known.has(uid) && !seen.has(uid)) {
          seen.add(uid)
          initialOrder.push(uid)
        }
      }
      history.forEach(append)
      append(pilot)
      favorites.forEach(append)
      fleetEntries.forEach(entry => append(entry.uid))
      fleetFormationHistoryRef.current = historySet
      fleetFormationOrderRef.current = initialOrder
    } else {
      const inOrder = new Set(current)
      for (const entry of fleetEntries) {
        if (inOrder.has(entry.uid)) continue
        current.push(entry.uid)
        inOrder.add(entry.uid)
      }
    }
    return fleetFormationOrderRef.current ?? []
  })()
  const fleetBusy = state.awayGalaxy !== null || state.expedition.active || state.encounter.active || state.mining.active || state.salvaging.active || state.hauling.active || state.transit.active || state.standby.active || state.sideTasks.deliver !== null
  const combatRoster = combatRosterOf(state)
  const combatRosterSet = new Set(combatRoster)
  const commandBudget = commandBudgetOf(state, ctx, combatRoster)
  function toggleCombatShip(uid: string): void {
    if (fleetBusy || uid === state.shipId) return
    const roster = combatRosterOf(state)
    const isSelected = roster.includes(uid)
    if (!isSelected && shipOperationBlockReason(state, engine.ctx, uid, 'configure')) return
    const maxShips = commandBudgetOf(state, engine.ctx, roster).maxShips
    if (!isSelected && roster.length >= maxShips) {
      onToast(tr('core.command.003', { p1: maxShips }), true)
      return
    }
    const next = isSelected ? roster.filter(id => id !== uid) : [...roster, uid]
    engine.rememberPreparationSquad('combat', next)
  }

  const fleetTotal = Object.keys(state.fleet).length
  const currentFleetRepairPlan = engine.fleetRepairPlan()
  const repairShortfall = Math.max(0, repairFleetPlan.totalCost - repairFleetBalance)
  const fq = fleetQ.trim().toLowerCase()
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
                : dur < 1 || armor < 1
        if (!ok) return false
      }
      const shipDef = ctx.ships.get(ship.defId ?? uid)
      if (!shipRolePasses(shipDef, fleetRole)) return false
      if (!shipTierPasses(shipDef, fleetTier)) return false
      return true
    })
    const rank = new Map(fleetFormationOrder.map((uid, index) => [uid, index]))
    return list.sort((a, b) => (rank.get(a.uid) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.uid) ?? Number.MAX_SAFE_INTEGER))
  })()

  function handleSwitch(id: string): void {
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

  function openFleetRepair(): void {
    const plan = engine.fleetRepairPlan()
    const balance = engine.state.wallet.isk
    displayedRepairPlanRef.current = { plan, balance }
    setRepairFleetPlan(plan)
    setRepairFleetBalance(balance)
    setRepairFleetChanged(false)
    setRepairFleetOpen(true)
  }

  function confirmFleetRepair(): void {
    const currentPlan = engine.fleetRepairPlan()
    const currentBalance = engine.state.wallet.isk
    const displayed = repairFleetChanged
      ? { plan: repairFleetPlan, balance: repairFleetBalance }
      : displayedRepairPlanRef.current
    const samePlan =
      currentPlan.repairableShipIds.length === displayed.plan.repairableShipIds.length &&
      currentPlan.repairableShipIds.every((id, index) => id === displayed.plan.repairableShipIds[index]) &&
      currentPlan.totalCost === displayed.plan.totalCost &&
      currentPlan.fullCount === displayed.plan.fullCount &&
      currentPlan.blockedCount === displayed.plan.blockedCount

    if (!samePlan || currentBalance !== displayed.balance) {
      setRepairFleetPlan(currentPlan)
      setRepairFleetBalance(currentBalance)
      setRepairFleetChanged(true)
      return
    }
    if (currentPlan.repairableShipIds.length === 0 || currentBalance < currentPlan.totalCost) return

    const result = engine.repairFleetAt()
    if (!result.ok || !('repairedCount' in result)) {
      onToast(cmdText(result) || tr('ui.shipPageFleetRepair.012'), true)
      setRepairFleetOpen(false)
      return
    }
    if (result.totalCost > 0) reportCompanyFlow('repair-service', 'buy', result.totalCost)
    setRepairFleetOpen(false)
    onToast(tr('ui.shipPageFleetRepair.011', {
      p1: result.repairedCount,
      p2: fmtCredits(result.totalCost),
      p3: result.fullCount,
      p4: result.blockedCount,
    }))
  }

  function handleToggleLock(id: string, currentlyLocked: boolean): void {
    const r = engine.lockShipAt(id, !currentlyLocked)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.393'), true)
    else onToast(currentlyLocked ? tr("ui.ShipPage.123") : tr("ui.ShipPage.124"))
  }

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


  const [storeQ, setStoreQ] = useState('')
  const [storeOwn, setStoreOwn] = useState<string>(SUB_ALL)
  const [storeRole, setStoreRole] = useState<string>(SUB_ALL)
  const [storeTier, setStoreTier] = useState<string>(SUB_ALL)
  const [storeSellId, setStoreSellId] = useState<string | null>(null)
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
    if (!shipRolePasses(def, storeRole)) return false
    if (!shipTierPasses(def, storeTier)) return false
    return true
  })
  const fleetRoles = SHIP_DOMAIN_SUBS
  const fleetTiers = SHIP_TIER_SUBS
  const storeRoles = SHIP_DOMAIN_SUBS.filter((s) => storeAll.some((def) => shipRolePasses(def, s.key)))
  const storeTiers = SHIP_TIER_SUBS.filter((s) => storeAll.some((def) => shipRolePasses(def, storeRole) && shipTierPasses(def, s.key)))
  const fleetRoleMissing = fleetRole !== SUB_ALL && !fleetRoles.some((s) => s.key === fleetRole)
  const fleetTierMissing = fleetTier !== SUB_ALL && !fleetTiers.some((s) => s.key === fleetTier)
  const storeRoleMissing = storeRole !== SUB_ALL && !storeRoles.some((s) => s.key === storeRole)
  const storeTierMissing = storeTier !== SUB_ALL && !storeTiers.some((s) => s.key === storeTier)
  useEffect(() => {
    if (fleetRoleMissing) { setFleetRole(SUB_ALL); setFleetTier(SUB_ALL) }
    if (fleetTierMissing) setFleetTier(SUB_ALL)
    if (storeRoleMissing) { setStoreRole(SUB_ALL); setStoreTier(SUB_ALL) }
    if (storeTierMissing) setStoreTier(SUB_ALL)
  }, [fleetRoleMissing, fleetTierMissing, storeRoleMissing, storeTierMissing])
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
          /** 燃料那一档只在解锁后出现（`labUnlocked` = 首座空间站建成） */
          t.key === 'fuel' && !engine.labUnlocked() ? null : (
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
          )
        ))}
      </div>

      {activeTab === 'fleet' ? (
        <>
      {/* ───── 我的舰队 ───── */}
      <Panel
        className="is-fill app-fleet-panel"
        title={tr("ui.ShipPage.001")}
        right={
          <span className="app-fleet-head-tools">
            <span className={`app-fleet-command-summary${commandBudget.ok ? '' : ' is-over'}`} title={fleetBusy ? tr('ui.command.004') : undefined}>
              <span>{tr('ui.command.002', { p1: commandBudget.cost, p2: commandBudget.capacity, p3: combatRoster.length, p4: commandBudget.maxShips })}</span>
              <i aria-hidden="true"><b style={{ width: `${Math.min(100, commandBudget.capacity > 0 ? commandBudget.cost / commandBudget.capacity * 100 : 0)}%` }} /></i>
              {fleetBusy ? <Glyph name="ico-lock" size={12} color={ICO_TONES['ico-lock']} /> : null}
            </span>
            <input
              className="app-head-search"
              type="text"
              placeholder={tr("ui.ShipPage.002")}
              value={fleetQ}
              onChange={(e) => setFleetQ(e.target.value)}
              spellCheck={false}
            />
            <span className="app-dim app-fleet-count">
              {fleetFiltered ? tr('ui.ShipPage.107', { shown: fleetShown.length, total: fleetTotal }) : tr('ui.ShipPage.108', { total: fleetTotal })}
              {tr('ui.ShipPage.109')}
              <span className={`app-pilot-name${switchFxUid !== null ? ' is-pulse' : ''}`}>
                {shipDisplayName(state, ctx, state.shipId)}
              </span>
            </span>
          </span>
        }
      >
        {!commandBudget.ok ? <div className="app-warn app-fleet-command-warning">{cmdText(commandBudget)}</div> : null}
        <FleetPresets engine={engine} busy={fleetBusy} onToast={onToast} />
        <RangeEwFleet state={state} ctx={ctx} ids={combatRoster} />
        {fleetBusy ? <div className="app-dim app-fleet-command-warning">{tr('ui.command.004')}</div> : null}
        {/* 舰队工具条（2026-09-10 船长：搜索/状态筛选；样式与仓库、技能目录同款）——固定在列表上方不随滚动
            2026-09-11 船长：「移除排序选项，改为按照舰船级别划分的子筛选」⇒ 排序下拉退场，
            改挂**舰船级别**子筛选（复用组装机那套 `SHIP_TIER_SUBS` 单点表与次级标签样式）；
            同日追加「**级别筛选单列一行，当选择级别后，出现舰船类别（工业战斗那些）筛选**」；
            同日再追加「将搜索栏移到标题内」⇒ 搜索与计数整体上移到面板标题行，工具条只留各维筛选。
            ⚠ **2026-09-12 船长（本批）：「将我的舰队中，级别和类别筛选对调，玩家先选择类别，再选级别」**
            ⇒ **上述「选中级别后才出类别」的旧口径作废**：工具条改为 **第 1 行 状态**、
            **第 2 行 类别**（`SHIP_SUBS`：全部 / 采矿舰 / 货运舰 / 武装舰 / 重装舰）、
            **第 3 行 级别**（`SHIP_TIER_SUBS`：全部 / T1~T5），**两行都常显**；
            切换类别（包括「全部」）时将级别重置为「全部」，各维筛选与其它条件取「与」；
            每行各带灰字前缀，避免多个「全部」混淆（前缀写法同星图页「矿带排序：」） */}
        <div className="app-fleet-toolbar">
          <div className="app-fleet-row">
            <span className="app-dim">{tr("ui.ShipPage.003")}</span>
            <button
              type="button"
              className="app-btn is-small is-warn"
              disabled={currentFleetRepairPlan.repairableShipIds.length === 0}
              title={currentFleetRepairPlan.repairableShipIds.length === 0 ? tr('ui.shipPageFleetRepair.013') : tr('ui.shipPageFleetRepair.001')}
              onClick={openFleetRepair}
            >
              <Wrench size={13} aria-hidden="true" />
              {tr('ui.shipPageFleetRepair.001')}
            </button>
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
                onClick={() => { setFleetRole(SUB_ALL); setFleetTier(SUB_ALL) }}
              >
                {tr("ui.IndustryPage.001")}
              </button>
              {fleetRoles.map((s) => (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={fleetRole === s.key}
                  className={`app-tasktab${fleetRole === s.key ? ' is-active' : ''}`}
                  onClick={() => { setFleetRole(s.key); setFleetTier(SUB_ALL) }}
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
              {fleetTiers.map((s) => (
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
        <div className="app-ship-list app-fleet-card-grid" data-fleet-card-grid>
          {fleetShown.map(({ uid, ship: shipState, def }) => {
            const dur = durabilityOf(state, uid)
            const armor = shipState.armorPct ?? 1 // P0 承伤持久化：装甲残余（跨场保留）
            const kitCount = (['repairkit-civ', 'repairkit-mil'] as const).reduce((n, id) => n + (shipState.cargo[id] ?? 0), 0)
            const isCurrent = uid === state.shipId
            const repairCost = repairCostIsk(state, uid, engine.ctx)
            const repairBlock = shipOperationBlockReason(state, engine.ctx, uid, 'repair')
            const switchBlock = isCurrent ? null : changeShipBlockReason(state, uid, engine.ctx)
            const isWorking = uid in state.aiAssignments
            const isLockedShip = state.shipLocks[uid] === true
            const displayName = shipDisplayName(state, engine.ctx, uid)
            const isRenaming = renameId === uid
            const storable = shipStorable(state, uid) // 入仓逐档判据（core 单点，与引擎同源）
            const formationOn = combatRosterSet.has(uid)
            const formationBlocked = isCurrent ? null : shipOperationBlockReason(state, ctx, uid, 'configure')
            return (
              <FleetShipHover key={uid} uid={uid} ship={def} engine={engine} block>
                <div
                  className={`app-ship-card is-fleet${isCurrent ? ' is-current' : ''}${fleetFormationHistoryRef.current?.has(uid) ? ' is-formation-history' : ''}${combatRosterSet.has(uid) ? ' is-combat-selected' : ''}${switchFxUid === uid ? ' is-switch-pulse' : ''}`}
                  data-fleet-ship={uid}
                >
                <div className="app-ship-main">
                <div className="app-fleet-card-pickbar">
                  <button
                    type="button"
                    className={`app-btn is-small app-fleet-select-btn${formationOn ? ' is-selected' : ''}`}
                    disabled={fleetBusy || (!!formationBlocked && !formationOn) || isCurrent}
                    aria-pressed={formationOn}
                    data-command-ship={uid}
                    title={fleetBusy ? tr('ui.command.004') : isCurrent ? tr('ui.ShipPage.010') : formationBlocked && !formationOn ? cmdText(formationBlocked) : formationOn ? tr('ui.Wormhole.024') : tr('ui.Wormhole.137')}
                    onClick={() => toggleCombatShip(uid)}
                  >
                    {formationOn ? <Check size={13} aria-hidden /> : <Plus size={13} aria-hidden />}
                    <span>{formationOn ? (isCurrent ? tr('ui.Wormhole.091') : tr('ui.command.006')) : tr('ui.Wormhole.204')}</span>
                  </button>
                  {isCurrent ? <span className="app-chip">{tr('ui.ShipPage.010')}</span> : isWorking ? <span className="app-chip">{tr('ui.ShipPage.011')}</span> : null}
                  <MarkStar engine={engine} kind="ships" id={uid} />
                </div>
                <FleetArt shipId={def.id} />
                <div className="app-ship-top">
                  <span className="app-ship-name">
                    {displayName} <span className="app-ship-callsign" title={`呼号 #${uid.slice(-4).toUpperCase()}`}>#{uid.slice(-4).toUpperCase()}</span>
                    {/* 2026-09-13 船长：子分类徽标（只有虫洞族专属舰船有 `subClass`）；样式复用同级角色 chip */}
                    {def.subClass ? <em className={`app-chip app-role-chip is-${def.role}`}>{shipSubClassText(def.subClass)}</em> : null}
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
                <div className="app-fleet-card-cost"><span>{tr('ui.command.003')}</span><strong>{shipCommandCostOf(def)}</strong><span>T{def.tier}</span></div>
                <div className="app-ship-spec">
                  {tr("ui.ShipPage.019")} {def.cargoM3.toLocaleString('zh-CN')} {tr("ui.ShipPage.020")} {def.cycleSeconds} {tr("ui.ShipPage.021")} {def.oreUnitsPerCycle} {tr("ui.Handbook.012")} {Math.round(def.agility * 100)}%
                </div>
                <ShipDamageSummary engine={engine} uid={uid} />
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
                      disabled={state.wallet.isk < repairCost || repairBlock !== null}
                      title={repairBlock ? cmdText(repairBlock) : tr("ui.ShipPage.165", { p1: repairCost.toLocaleString('zh-CN') })}
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
                            : cmdText({ error: storable.reason, errorId: storable.reasonId, errorParams: storable.reasonParams })
                        }
                        onClick={() => requestStore(uid, shipState.customName)}
                      >
                        {tr("ui.ShipPage.034")}
                      </button>
                      <button
                        className="app-btn is-small is-primary"
                        disabled={switchBlock !== null}
                        title={switchBlock ? cmdText(switchBlock) : switchAskId === uid ? tr('ui.Hauling.035') : undefined}
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
        {repairFleetOpen ? (
          <div className="app-modal-mask" onClick={() => setRepairFleetOpen(false)}>
            <section
              className="app-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="fleet-repair-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="app-modal-head">
                <strong id="fleet-repair-title">{tr('ui.shipPageFleetRepair.002')}</strong>
              </div>
              <div className="app-modal-body">
                <div>{tr('ui.shipPageFleetRepair.003', { p1: repairFleetPlan.repairableShipIds.length })}</div>
                <div>{tr('ui.shipPageFleetRepair.004', { p1: repairFleetPlan.fullCount })}</div>
                <div>{tr('ui.shipPageFleetRepair.005', { p1: repairFleetPlan.blockedCount })}</div>
                <div>{tr('ui.shipPageFleetRepair.006', { p1: fmtCredits(repairFleetPlan.totalCost) })}</div>
                <div>{tr('ui.shipPageFleetRepair.007', { p1: fmtCredits(repairFleetBalance) })}</div>
                {repairShortfall > 0 ? (
                  <div className="app-warn" role="alert">
                    {tr('ui.shipPageFleetRepair.008', { p1: fmtCredits(repairShortfall) })}
                  </div>
                ) : null}
                {repairFleetChanged ? (
                  <div className="app-warn" role="status">
                    {tr('ui.shipPageFleetRepair.009')}
                  </div>
                ) : null}
                <div className="app-save-actions" style={{ marginTop: 'var(--wui-sp-10)' }}>
                  <button className="app-btn" onClick={() => setRepairFleetOpen(false)}>
                    {tr('ui.shipPageFleetRepair.014')}
                  </button>
                  <button
                    className="app-btn is-primary"
                    disabled={repairFleetPlan.repairableShipIds.length === 0 || repairFleetBalance < repairFleetPlan.totalCost}
                    title={repairFleetBalance < repairFleetPlan.totalCost ? tr('ui.shipPageFleetRepair.008', { p1: fmtCredits(repairShortfall) }) : undefined}
                    onClick={confirmFleetRepair}
                  >
                    {tr('ui.shipPageFleetRepair.010')}
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </Panel>
      </>
      ) : null}

      {activeTab === 'ai' ? <AiCommandPanel engine={engine} onToast={onToast} /> : null}

      {/* **跃迁燃料**（2026-09-29 船长令）：剩余数值 ＋ 四个活动开关 ＋ 「前往实验室」跳转 */}
      {activeTab === 'fuel' && engine.labUnlocked() ? (
        <JumpFuelPanel engine={engine} onToast={onToast} onGotoLab={onGotoIndustryLab} />
      ) : null}

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
                {storeRoles.map((s) => (
                  <button
                    key={s.key}
                    role="tab"
                    aria-selected={storeRole === s.key}
                    className={`app-tasktab${storeRole === s.key ? ' is-active' : ''}`}
                    onClick={() => { setStoreRole(s.key); setStoreTier(SUB_ALL) }}
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
                {storeTiers.map((s) => (
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
                            {def.subClass ? <em className={`app-chip app-role-chip is-${def.role}`}>{shipSubClassText(def.subClass)}</em> : null}
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
                              {/* ⚠ 金额与单位都按语言（`fmtCredits` 出口，2026-09-29 批 0）：原来是中文字面量拼 `isk()` */}
                              {quote?.buy !== undefined ? tr("ui.ShipPage.201", { p1: fmtCredits(quote.buy) }) : ''}
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


function AiCommandPanel({ engine, onToast }: PageProps) {
  const state = engine.state
  const cap = aiCoreCap(state, engine.ctx)
  const industryBonus = industryAiBonus(state, engine.ctx)
  const idleShips = idleAiShipIds(state)
  const assignN = aiCoreShipUsed(state)
  const prodN = aiCoreIndustryUsed(state)
  const used = aiCoreUsed(state)
  const totalCap = cap + industryBonus

  const [shipId, setShipId] = useState('')
  const [coreType, setCoreType] = useState<AiCoreType>(() => bestAiCoreOf(state) ?? 'basic')
  const [mode, setMode] = useState<AiAssignMode>('mining')
  const [beltId, setBeltId] = useState(engine.belts[0]?.id ?? '')
  const [salvageGalaxyId, setSalvageGalaxyId] = useState('')
  const [refineItemId, setRefineItemId] = useState('')
  const [craftBpId, setCraftBpId] = useState('')
  const usableCores = usableAiCoresOf(state)
  const effCore = usableCores.includes(coreType) ? coreType : (usableCores[usableCores.length - 1] ?? 'basic')
  const shipTasksOk = cap > 0
  const effMode: AiAssignMode =
    shipTasksOk || mode === 'refine' || mode === 'craft' ? mode : 'craft'

  const allItemDefs = visibleItemDefs(engine.ctx)
  const refineOres = allItemDefs.filter((d) => d.kind !== 'wreck' && (d.refine?.length ?? 0) > 0)
  const refineWrecks = allItemDefs.filter((d) => d.kind === 'wreck' && industryAvailable(state, engine.ctx, d.id) > 0)
  const refineAll = [...refineOres, ...refineWrecks]
  const effRefineId = refineAll.some((d) => d.id === refineItemId) ? refineItemId : (refineAll[0]?.id ?? '')
  const craftAll: CraftOption[] = []
  for (const bp of engine.blueprints) {
    if (bp.itemId !== undefined) {
      const units = bp.outputUnits ?? 1
      craftAll.push({
        id: bp.id,
        name: `${engine.ctx.items.get(bp.itemId)?.name ?? bp.itemId} ×${units}`,
        group: '消耗品蓝图',
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

  const isIndustryTask = effMode === 'refine' || effMode === 'craft'
  const craftShort =
    effMode === 'craft' && selCraft
      ? missingMaterials(state, engine.ctx, {
          materials: selCraft.materials,
          buildSeconds: selCraft.buildSeconds,
          buildCostIsk: 0,
        })
      : []
  const refineHave = effMode === 'refine' && effRefineId ? industryAvailable(state, engine.ctx, effRefineId) : 0
  const assignBlock: string | null =
    usableCores.length === 0
      ? tr("ui.ShipPage.130")
      : !isIndustryTask && !shipId
        ? idleShips.length === 0
          ? tr("ui.ShipPage.131")
          : tr("ui.ShipPage.132")
        : effMode === 'salvage' && !salvageGalaxyId
          ? tr("ui.ShipPage.133")
          : effMode === 'refine' && !effRefineId
              ? tr("ui.ShipPage.135")
              : effMode === 'refine' && refineHave <= 0
                ? tr("ui.ShipPage.169", { p1: selRefine?.name ?? '' })
                : effMode === 'craft' && !effCraftId
                  ? tr("ui.ShipPage.136")
                  : effMode === 'craft' && craftShort.length > 0
                    ? tr("ui.ShipPage.170", { p1: craftShort.join('；') })
                    : null

  const aiRefineRuns = engine.refineRunViews().filter((v) => v.worker !== 'pilot')
  const aiMakeRuns = manufacturingRunViews(state, engine.ctx).filter((v) => v.worker !== null && v.worker !== 'pilot')


  function handleBuyCore(): void {
    const r = engine.buyBasicCoreAt()
    if (!r.ok) onToast(cmdText(r) || tr('ui.ShipPage.200'), true)
    else onToast(tr("ui.ShipPage.171"))
  }

  function handleAssign(): void {
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
    const r = effMode === 'mining'
      ? engine.assignAiMiningAt(shipId, effCore, beltId)
      : engine.assignAiSalvageAt(shipId, effCore, salvageGalaxyId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.ShipPage.196'), true)
    else onToast(tr("ui.ShipPage.176"))
  }

  function handleCancelAi(sid: string): void {
    if (engine.cancelAiTaskAt(sid)) onToast(tr("ui.ShipPage.177"))
    else onToast(tr("ui.MapPage.077"), true)
  }

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
              {aiCoreText(type)} ×{countAiCore(state, type)}（{Math.round(aiEfficiency(state, engine.ctx, type) * 100)}%）
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
          {/* 核心下拉常驻：无可用核心时置灰并直接显示原因（船长 2026-09-10：无核心必须提示玩家）——
              2026-10-02 起走公共件 `ui/aiCoreSelect.tsx`（行为与旧实现逐字一致） */}
          <AiCoreSelect
            engine={engine}
            value={effCore}
            onPick={setCoreType}
            titleReady={tr("ui.ShipPage.069")}
            titleEmpty={tr("ui.ShipPage.068")}
            emptyLabel={tr("ui.ShipPage.070")}
          />
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
                      {d.name}{tr("ui.ShipPage.084")}{industryAvailable(state, engine.ctx, d.id).toLocaleString('zh-CN')}）
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {refineWrecks.length > 0 ? (
                <optgroup label={tr("ui.ShipPage.085")}>
                  {refineWrecks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}{tr("ui.ShipPage.086")} {Math.round(industryAvailable(state, engine.ctx, d.id) * 10) / 10} m³）
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
                    {desc} · {aiCoreText(assignment.coreType)}{tr("ui.ShipPage.093")} {Math.round(eff * 100)}%）
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
              // 回收炉 vs 精炼炉：料是残骸即回收炉——同一判据同时驱动文案与动画差分（单点见 `aiWorkFx.industryWorkKindOf`）
              const isReclaim = industryWorkKindOf(v.itemId, engine.ctx.items) === 'reclaim'
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

function standingOfState(state: GameState): number {
  return standingOf(state, DSI_FACTION_ID)
}


