import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties } from 'react'
import { useL10n } from './i18n/locale'
import {
  activePromos,
  activeTunings,
  moneyDelta,
  shipDisplayName,
  unlocked,
  unlockNeedTitle,
  ONB_AWAKEN,
  weekendFamilyNameId,
  weekendFlagshipBattleActive,
  WEEKEND_COMMS_SETTLE_ID,
} from '@whale/core'
import { LogList, Panel } from '@whale/ui'
import { perfHub, perfAutoEnabled } from './game/perf'
import { saveStorageProbe, subscribeSaveAlert } from './game/saveGuard'
import type { SaveStorageProbe } from './game/saveGuard'
import { saveBridge } from './game/storage'
import { useThemeBootstrap } from './ui/theme'
import { Communicator } from './panels/Expedition'
import { PrologueScreen } from './panels/PrologueScreen'
import { ModeChoice } from './panels/ModeChoice'
import { WeekendInvasionLogRow } from './panels/WeekendInvasionLog'
import { FlagshipFleetActions } from './features/combat/FlagshipFleetActions'
import { WeekendSummaryView } from './panels/WeekendSummary'
import { PlugExchangeModal } from './panels/PlugExchange'
import { InvasionAlarm, InvasionFireworks, ALARM_TOTAL_MS, FIREWORKS_MS } from './panels/InvasionFx'
import { playSfx } from './game/sfx'
import { notifyUiError } from './game/audio/uiFeedback'
import { useSceneAudio } from './game/audio/useSceneAudio'
import { FitPage } from './pages/FitPage'
import { ShipPage, type ShipTab } from './pages/ShipPage'
import { ItemsPage } from './pages/ItemsPage'
import { MarketPage } from './pages/MarketPage'
import { IndustryPage } from './pages/IndustryPage'
import { useExchangeAvailable } from './features/exchange/availability'
import { IndustryHudPage } from './pages/IndustryHudPage'
import { SkillsTreePage } from './pages/SkillsTreePage'
import { MapPage, MAP_TABS, TAB_UNLOCK_KEY } from './pages/MapPage'
import { CommsPage } from './pages/CommsPage'
import { OnlineChatPage } from './pages/OnlineChatPage'
import { CommsEave, CommsScreen } from './panels/CommsReader'
import { TaskCenterPage } from './pages/TaskCenterPage'
import { AchievementsPage } from './pages/AchievementsPage'
import { ExchangePage } from './pages/ExchangePage'
import { useOnlineChat } from './features/cloud/useOnlineChat'
import { useMarketRelay } from './features/market/relay/useMarketRelay'
import type { MapGotoTarget, MapTab, TaskFocusTarget } from './pages/MapPage'
import type { SettingsPageId, ToastFn } from './pages/common'
import type { GameEngine } from './game/engine'
import { SaveManager } from './panels/SaveManager'
import { SaveReconnect } from './panels/SaveReconnect'
import type { ReconnectChoice } from './game/saveReconnect'
import { Handbook } from './panels/Handbook'
import { BattleScreen } from './panels/BattleScreen'
import { BattleRangeConfirm } from './panels/BattleRangeConfirm'
import { debugEnabled as readDebugEnabled } from './panels/DebugPanel'
import { WormholePanel } from './panels/Wormhole'
import { SignalSpacePanel } from './panels/SignalSpace'
import { futureWormholeEnabled, planetaryEnabled } from './game/debugFlag'
import { StellarExplorer } from './panels/StellarExplorer'
import { TooltipLayer, hideTip } from './ui/Tooltip'
import { Glyph, NAV_TONES, ICO_TONES } from './ui/Glyphs'
import { ActivityScreen, activityKindOf } from './ui/ActivityScreen'
import { AppShell } from './ui/AppShell'
import type { LayoutKind } from './ui/AppShell'
import { LAYOUT_KEY, LAYOUT_SET_KEY, readLayoutPref } from './ui/layoutPreference'
import { setSessionPick, sessionPick } from './ui/sessionView'
import { cmdText, logText, tr } from './i18n/locale'
import { fmtDuration } from './i18n/fmt'
import { gameClock, kindOf, LOG_KINDS, KIND_LABEL, KIND_DESC, KIND_DOT, PREFS_KEY, readLogPrefs, SettingsPanel, PerfListener, PerfHud } from './panels/appSettings'
import type { LogFilter } from './panels/appSettings'
import { CLASSIC_LOG_FADE_MS, useClassicLogVisibility } from './ui/classicSidebars'

const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: string }> = [
  { key: 'map', label: 'ui.App.001', icon: 'nav-map' },
  { key: 'ship', label: 'ui.App.002', icon: 'nav-ship' },
  { key: 'fit', label: 'ui.App.003', icon: 'nav-fit' },
  { key: 'items', label: 'ui.App.004', icon: 'nav-items' },
  { key: 'market', label: 'ui.App.005', icon: 'nav-market' },
  { key: 'industry', label: 'ui.App.006', icon: 'nav-industry' },
  { key: 'skills', label: 'ui.App.007', icon: 'nav-skills' },
  { key: 'task', label: 'ui.App.008', icon: 'nav-task' },
  { key: 'achieve', label: 'ui.App.119', icon: 'ach-first' },
  { key: 'comms', label: 'ui.App.009', icon: 'nav-mail' },
  { key: 'chat', label: 'ui.chat.019', icon: 'nav-chat' },
  { key: 'exchange', label: '股市', icon: 'nav-exchange' },
]

const DEBUG_NAV_ITEMS: Array<{ key: PageKey; label: string; icon: string }> = [
  { key: 'industryHud', label: 'ui.hud.101', icon: 'nav-industry' },
]

export type PageKey =
  | 'ship'
  | 'fit'
  | 'items'
  | 'market'
  | 'industry'
  | 'industryHud'
  | 'skills'
  | 'map'
  | 'task'
  | 'achieve'
  | 'comms'
  | 'chat'
  | 'exchange'

const PAGE_NO_SCROLL = new Set<string>(['ship', 'fit', 'market', 'map', 'industry', 'industryHud', 'skills', 'items', 'task', 'achieve', 'comms', 'chat', 'exchange'])

const MOB_SEL_MIN_OPEN_MS = 200

const MOB_SEL_MOVE_TOLERANCE_PX = 24

const MOB_SIZE_DEAD_PX = 8
const MOB_BIG_CHANGE_PX = 96
const MOB_RESIZE_SETTLE_MS = 300

export function App({ engine }: { engine: GameEngine }) {
  useMarketRelay(engine)
  useThemeBootstrap()

  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const changed = () => force()
    window.addEventListener('whale-future-wormhole-change', changed)
    return () => window.removeEventListener('whale-future-wormhole-change', changed)
  }, [])
  const { locale } = useL10n()
  useEffect(() => {
    engine.setLocale(locale)
  }, [engine, locale])

  const [mobileRot, setMobileRot] = useState(false)
  const [mobileLand, setMobileLand] = useState(false)
  const [mobileLayout, setMobileLayout] = useState(false)
  const [mobileLogOpen, setMobileLogOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const mobSizeRef = useRef<{ w: number; h: number } | null>(null)
  const mobPendRef = useRef<{ h: number; since: number } | null>(null)
  const mobTimerRef = useRef(0)
  const [mobSel, setMobSel] = useState<{ el: HTMLSelectElement; opts: { value: string; label: string }[]; sel: string } | null>(null)
  useEffect(() => {
    const update = (): void => {
      const coarse = window.matchMedia('(pointer: coarse)').matches
      setMobileLayout(coarse && Math.min(window.screen.width || window.innerWidth, window.screen.height || window.innerHeight) < 900)
      const orientation = window.screen.orientation?.type
      const portrait = orientation ? orientation.startsWith('portrait') : window.innerHeight > window.innerWidth
      const rot = coarse && portrait && window.innerWidth < 900
      const land = coarse && !portrait && window.innerWidth < 1000 && window.innerHeight < 520
      setMobileRot(rot)
      setMobileLand(land)
      const el = rootRef.current
      if (!el) return
      if (!rot && !land) {
        el.style.removeProperty('--mob-w')
        el.style.removeProperty('--mob-h')
        el.style.removeProperty('--mob-scale')
        el.style.removeProperty('--mob-x')
        el.style.removeProperty('--mob-y')
        mobSizeRef.current = null
        mobPendRef.current = null
        return
      }
      const vv = window.visualViewport
      const visW = vv ? vv.width : window.innerWidth
      const visH = vv ? vv.height : window.innerHeight
      const visX = vv ? vv.offsetLeft : 0
      const visY = vv ? vv.offsetTop : 0
      const zoomed = (vv?.scale ?? 1) > 1.05
      const cur = mobSizeRef.current
      let size = cur ?? { w: visW, h: visH }
      const widthChanged = cur !== null && Math.abs(cur.w - visW) > 1
      if (cur === null || (widthChanged && !zoomed)) {
        size = { w: visW, h: visH }
        mobPendRef.current = null
      } else if (!zoomed) {
        const dh = visH - cur.h
        if (Math.abs(dh) >= MOB_BIG_CHANGE_PX) {
          size = { w: visW, h: visH }
          mobPendRef.current = null
        } else if (Math.abs(dh) >= MOB_SIZE_DEAD_PX) {
          const p = mobPendRef.current
          if (p === null || Math.abs(p.h - visH) > 0.5) mobPendRef.current = { h: visH, since: Date.now() }
          else if (Date.now() - p.since >= MOB_RESIZE_SETTLE_MS) {
            size = { w: visW, h: visH }
            mobPendRef.current = null
          }
          if (mobPendRef.current !== null && mobTimerRef.current === 0) {
            mobTimerRef.current = window.setTimeout(() => {
              mobTimerRef.current = 0
              update()
            }, MOB_RESIZE_SETTLE_MS + 20)
          }
        } else {
          mobPendRef.current = null
        }
      }
      mobSizeRef.current = size
      const designW = 1200
      const scale = land ? size.w / designW : size.h / designW
      const vh = land ? size.h / scale : designW * size.w / size.h
      el.style.setProperty('--mob-w', `${designW}px`)
      el.style.setProperty('--mob-h', `${vh}px`)
      el.style.setProperty('--mob-scale', String(scale))
      el.style.setProperty('--mob-x', `${visX}px`)
      el.style.setProperty('--mob-y', land ? `${visY}px` : `${visY + size.h}px`)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    const vv = window.visualViewport
    if (vv) {
      vv.addEventListener('resize', update)
      vv.addEventListener('scroll', update)
    }
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      const v2 = window.visualViewport
      if (v2) {
        v2.removeEventListener('resize', update)
        v2.removeEventListener('scroll', update)
      }
      if (mobTimerRef.current !== 0) {
        window.clearTimeout(mobTimerRef.current)
        mobTimerRef.current = 0
      }
    }
  }, [])

  useEffect(() => {
    if (!mobileRot) {
      setMobSel(null)
      return
    }
    let pending: { el: HTMLSelectElement; at: number; x: number; y: number } | null = null
    let timer = 0
    let raf = 0
    const clearPending = (): void => {
      pending = null
      if (timer !== 0) {
        window.clearTimeout(timer)
        timer = 0
      }
      if (raf !== 0) {
        window.cancelAnimationFrame(raf)
        raf = 0
      }
    }
    const fire = (el: HTMLSelectElement): void => {
      if (raf !== 0) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        if (!el.isConnected) return
        const opts = Array.from(el.options).map((o) => ({
          value: o.value,
          label: (o.textContent ?? '').trim() || o.value,
        }))
        setMobSel({ el, opts, sel: el.value })
      })
    }
    const onPointerDown = (e: PointerEvent): void => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('.app-mob-sel-mask')) return
      const sel = t?.closest?.('select') as HTMLSelectElement | null
      if (!sel || sel.disabled || sel.options.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      clearPending()
      pending = { el: sel, at: Date.now(), x: e.clientX, y: e.clientY }
    }
    const onPointerUp = (e: PointerEvent): void => {
      const p = pending
      if (!p) return
      pending = null
      if (
        Math.abs(e.clientX - p.x) > MOB_SEL_MOVE_TOLERANCE_PX ||
        Math.abs(e.clientY - p.y) > MOB_SEL_MOVE_TOLERANCE_PX
      ) {
        return
      }
      const wait = MOB_SEL_MIN_OPEN_MS - (Date.now() - p.at)
      if (wait <= 0) fire(p.el)
      else timer = window.setTimeout(() => {
        timer = 0
        fire(p.el)
      }, wait)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', clearPending, true)
    return () => {
      clearPending()
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', clearPending, true)
    }
  }, [mobileRot])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent): void => {
      const el = e.target as HTMLElement | null
      const btn = el?.closest?.('button') as HTMLButtonElement | null
      if (!btn || !btn.disabled) return
      const reason = btn.title || btn.dataset.disabledReason
      showToast(reason ? tr("ui.App.106", { reason: reason }) : tr("ui.App.053"), true)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  const [pendingOpen, setPendingOpen] = useState<string | null>(null)
  const pd = engine.state.pendingDialogue
  useEffect(() => {
    if (pd && pendingOpen !== pd) {
      const r = engine.openDialogue(pd)
      if (r.ok) setPendingOpen(pd)
    }
  }, [pd, pendingOpen])

  const state = engine.state
  const commsUnread = engine.commsUnread()
  const [page, setPage] = useState<PageKey>('map')
  const exchangeAvailable = useExchangeAvailable()
  const [navBeat, setNavBeat] = useState<{ key: PageKey; seq: number } | null>(null)
  const navBeatTimer = useRef<number | null>(null)
  const bountyNew = page === 'task' ? 0 : engine.bountyNewCount()
  useEffect(() => {
    if (page === 'task') engine.markBountyBoardSeen()
  }, [engine, page])
  const firstTaskNew = page === 'task' ? null : engine.firstTaskNotice()
  useEffect(() => {
    if (page === 'task') engine.markFirstTaskSeen()
  }, [engine, page])
  const [mapTab, setMapTab] = useState<MapTab>('star')
  const [shipTab, setShipTab] = useState<ShipTab>(() => (sessionPick('ship.tab') as ShipTab | null) ?? 'fleet')
  const [mktFocus, setMktFocus] = useState<{ key: string; seq: number } | null>(null)
  const [fitShipId, setFitShipId] = useState<string | null>(null)
  const [indFocus, setIndFocus] = useState<'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab' | null>(null)
  const [mapGoto, setMapGoto] = useState<MapGotoTarget | null>(null)
  const [taskFocus, setTaskFocus] = useState<TaskFocusTarget | null>(null)
  const [commsFocus, setCommsFocus] = useState<{ id: string; seq: number } | null>(null)
  const [skillsFocus, setSkillsFocus] = useState<{ group: string; branch?: string; seq: number } | null>(null)
  const [whOpen, setWhOpen] = useState(false)
  const [whStockPick, setWhStockPick] = useState<string | null>(null)
  const [whAutoPick, setWhAutoPick] = useState<string | null>(null)
  const selectedRun = state.wormhole.run
  const selectedStock = state.wormholeStock?.find(s => s.id === (whAutoPick ?? whStockPick))
  const futurePanel = whAutoPick !== null ? futureWormholeEnabled() && selectedStock?.expeditionRules === 2 : selectedRun ? selectedRun.expeditionRules === 2 || selectedRun.supplyVersion === 1 : state.wormhole.lastSettle?.expeditionProgress !== undefined || state.wormhole.lastSettle?.suppliesReturned !== undefined || futureWormholeEnabled() && selectedStock?.expeditionRules === 2
  const ExplorationPanel = futurePanel ? WormholePanel : SignalSpacePanel
  const openWormhole = (stockId?: string): void => {
    setWhStockPick(stockId ?? null)
    setWhAutoPick(null)
    changePage('map')
    setWhOpen(true)
  }
  const openWormholeAuto = (stockId: string): void => {
    setWhStockPick(null)
    setWhAutoPick(stockId)
    changePage('map')
    setWhOpen(true)
  }
  useEffect(() => {
    hideTip()
  }, [page])
  const lowSecPrev = useRef(state.lowSecNotified)
  useEffect(() => {
    if (state.lowSecNotified && !lowSecPrev.current) {
      showToast(tr("ui.App.107"), true)
    }
    lowSecPrev.current = state.lowSecNotified
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lowSecNotified])
  const [debugOn, setDebugOn] = useState<boolean>(readDebugEnabled)

const POPUP_ARM_MS = 450
const [layoutKind] = useState<LayoutKind>(readLayoutPref)
const [layoutPending, setLayoutPending] = useState<LayoutKind | null>(null)
function chooseLayout(k: LayoutKind): void {
  if (k === layoutKind) return
  setLayoutPending(k)
}
async function applyLayoutAndReload(): Promise<void> {
  const k = layoutPending
  if (k === null) return
  try {
    localStorage.setItem(LAYOUT_KEY, k)
    localStorage.setItem(LAYOUT_SET_KEY, '1')
  } catch {
  }
  const ok = await engine.persist()
  if (!ok) {
    showToast(tr('ui.App.055'), true)
    return
  }
  try {
    location.reload()
  } catch {
    showToast(tr('ui.App.167'), true)
  }
}
  useState(() => {
    if (perfAutoEnabled()) perfHub.activate()
    return false
  })
  const [perfOpen, setPerfOpen] = useState(false)

  const [tuningTick, setTuningTick] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setTuningTick(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  const promosNow = activePromos(tuningTick)
  const promoClaimedKeys = new Set<string>(promosNow.flatMap((p) => [...p.claims]))
  const tuningsNow = activeTunings(tuningTick).filter((tn) => !promoClaimedKeys.has(tn.key))
  const [toast, setToast] = useState<{ text: string; warn: boolean } | null>(null)
  const toastTimer = useRef<number | null>(null)
  const showToast: ToastFn = (text, warn = false) => {
    if (warn) notifyUiError()
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    setToast({ text, warn })
    toastTimer.current = window.setTimeout(() => setToast(null), warn && text.includes('\n') ? 15_000 : 3200)
  }
  const onlineChat = useOnlineChat(locale, showToast)
  const dismissToast = (): void => {
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current)
      toastTimer.current = null
    }
    setToast(null)
  }

  useEffect(() => {
    engine.onSystemNotice = (msg) => showToast(msg, true)
    return () => {
      engine.onSystemNotice = null
    }
  }, [engine])


  const [saveState, setSaveState] = useState<'ok' | 'paused' | 'unavailable'>(() => engine.saveWriteState())
  const [storageProbe] = useState<SaveStorageProbe | null>(() => saveStorageProbe())

  useEffect(() => {
    const st = engine.saveWriteState()
    setSaveState(st)
    if (st === 'unavailable') showToast(tr('ui.saveGuard.008'), true)
    else if (st === 'paused') showToast(tr('ui.saveGuard.010'), true)
    return subscribeSaveAlert((msg) => showToast(msg, true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  useEffect(() => {
    const flush = (): void => {
      void engine.persist()
    }
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [engine])

  const allowSaveNow = (): void => {
    void engine.allowSaveAfterLoadError().then((ok) => {
      setSaveState(engine.saveWriteState())
      showToast(ok ? tr('ui.App.054') : tr('ui.App.055'), !ok)
    })
  }


  const [saveFile, setSaveFile] = useState<SaveFileStatus | null>(null)
  const [reconnectChoice, setReconnectChoice] = useState<ReconnectChoice | null>(null)
  const [fileBusy, setFileBusy] = useState(false)
  const refreshSaveFile = (): void => {
    const api = saveBridge.saveFile
    if (!api) {
      setSaveFile(null)
      return
    }
    void api
      .status()
      .then(setSaveFile)
      .catch(() => setSaveFile(null))
  }

  const bindSaveFileNow = (): void => {
    const api = saveBridge.saveFile
    if (!api || fileBusy || reconnectChoice) return
    setFileBusy(true)
    void api.bind().then((r) => {
      refreshSaveFile()
      if (r.ok) {
        showToast(tr('ui.saveGuard.021', { p1: r.name ?? '' }))
        void engine.persist()
      } else if (!r.canceled) {
        showToast(tr('ui.saveGuard.023', { p1: r.error ?? '' }), true)
      }
    }).catch((err) => showToast(String(err), true)).finally(() => setFileBusy(false))
  }
  const reconnectSaveFileNow = (): void => {
    if (fileBusy) return
    setFileBusy(true)
    void engine.reconnectLocalSave().then((r) => {
      refreshSaveFile()
      if (r.choice) setReconnectChoice(r.choice)
      else showToast(r.ok ? tr('ui.saveGuard.025', { p1: saveFile?.name ?? '' }) : r.error ?? tr('ui.saveReconnect.008'), !r.ok)
    }).catch((err) => showToast(String(err), true)).finally(() => setFileBusy(false))
  }
  const unbindSaveFileNow = (): void => {
    const api = saveBridge.saveFile
    if (!api || fileBusy || reconnectChoice) return
    setFileBusy(true)
    void api.unbind().then((r) => {
      refreshSaveFile()
      showToast(r.ok ? tr('ui.saveGuard.022') : tr('ui.saveGuard.023', { p1: r.error ?? '' }), !r.ok)
    }).catch((err) => showToast(String(err), true)).finally(() => setFileBusy(false))
  }

  const [showSaveManager, setShowSaveManager] = useState(false)
  const [modeChoiceImportHold, setModeChoiceImportHold] = useState(false)
  const [showHandbook, setShowHandbook] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsInitialPage, setSettingsInitialPage] = useState<SettingsPageId>('interface')
  const [battleOpen, setBattleOpen] = useState(false)

  const [qqCopied, setQqCopied] = useState(false)
  const QQ_GROUP = '621172698'
  const copyQqGroup = (): void => {
    void navigator.clipboard
      ?.writeText(QQ_GROUP)
      .then(() => {
        setQqCopied(true)
        window.setTimeout(() => setQqCopied(false), 1600)
      })
      .catch(() => undefined)
  }

  const inBattle =
    (state.expedition.active && state.expedition.phase === 'battle') ||
    !!state.wormhole.run?.battle ||
    weekendFlagshipBattleActive(state) || !!(state.encounter.active && state.encounter.battle && (state.encounter.pirate || state.encounter.automatic))

  const [battleMounted, setBattleMounted] = useState(false)
  const prevInBattleRef = useRef(false)
  const battleWatchedRef = useRef(false)
  useLayoutEffect(() => {
    if (inBattle && !prevInBattleRef.current) {
      setBattleMounted(true)
      battleWatchedRef.current = false
      setBattleOpen(!engine.autoSortieNow() && !state.encounter.pirate && !state.encounter.automatic)
    }
    prevInBattleRef.current = inBattle
  }, [inBattle])
  if (inBattle && battleOpen) battleWatchedRef.current = true

  const activityKind = activityKindOf(state)
  const [activityOpen, setActivityOpen] = useState(false)
  const prevActivityRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevActivityRef.current
    prevActivityRef.current = activityKind
    if (activityKind === null) {
      setActivityOpen(false)
      return
    }
    if (prev === null && !inBattle) setActivityOpen(true)
  }, [activityKind, inBattle])

  const hideActivityWin = (): void => {
    setActivityOpen(false)
    setMobileLogOpen(false)
  }

  const activityWinOn = activityKind !== null
  const activityOnStage = activityWinOn && activityOpen
  const winOnStage = activityOnStage

  const windowRestore: { title: string; onRestore: () => void } | null =
    activityWinOn && !activityOpen
      ? { title: tr('ui.ActivityWin.008'), onRestore: () => setActivityOpen(true) }
      : null

  const [logCollapsed, setLogCollapsed] = useState<boolean>(() => readLogPrefs().collapsed)
  const [logFilter, setLogFilter] = useState<LogFilter>(() => readLogPrefs().filter)
  const logDrawerRef = useRef<HTMLElement>(null)
  const logHandleRef = useRef<HTMLButtonElement>(null)
  const classicLog = useClassicLogVisibility(logCollapsed, layoutKind === 'classic' && !mobileLayout)
  const logClosed = mobileLayout ? !mobileLogOpen : classicLog.closed
  const closeLog = (): void => {
    if (mobileLayout) setMobileLogOpen(false)
    else setLogCollapsed(true)
  }
  useLayoutEffect(() => {
    const drawer = logDrawerRef.current
    if (!drawer) return
    const hidden = layoutKind === 'classic' && !mobileLayout && logClosed
    const heldFocus = drawer.contains(document.activeElement)
    drawer.inert = hidden
    if (hidden && heldFocus) logHandleRef.current?.focus()
  }, [layoutKind, mobileLayout, logClosed])
  useEffect(() => {
    if (!mobileLayout) { setMobileLogOpen(false); return }
    if (!mobileLogOpen) return
    const previous = document.activeElement as HTMLElement | null
    logDrawerRef.current?.focus()
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); setMobileLogOpen(false) }
      if (event.key !== 'Tab') return
      const controls = Array.from(logDrawerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? [])
      if (!controls.length) { event.preventDefault(); logDrawerRef.current?.focus(); return }
      const index = controls.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0]?.focus() }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      if (previous?.isConnected) previous.focus()
    }
  }, [mobileLayout, mobileLogOpen])
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ collapsed: logCollapsed, filter: logFilter }))
    } catch {
    }
  }, [logCollapsed, logFilter])

  const visibleLogs = state.logs.filter((l) => logFilter === 'all' || kindOf(l.kind) === logFilter)
  const hiddenAll = visibleLogs.length === 0 && state.logs.length > 0

  const [reportDismissed, setReportDismissed] = useState(false)
  const offlineReport = engine.offlineReport
  const showOfflineReport = offlineReport !== null && !reportDismissed

  function gotoFromComms(p: string, tab?: string, shipTab?: string, taskTab?: string, skillBranch?: string): void {
    if (p === 'map' && tab) changeMapTab(tab as MapTab)
    if ((p === 'task' || (p === 'map' && tab === 'task')) && taskTab) focusTaskTab(taskTab)
    if (p === 'ship' && shipTab) changeShipTab(shipTab as ShipTab)
    if (p === 'skills' && tab) focusSkillGroup(tab, skillBranch)
    changePage(p as PageKey)
  }

  const popupId = engine.commsPopups()[0] ?? null
  const battleOnStage = battleMounted && battleOpen
  useSceneAudio({ state: engine.state, battleOnStage })
  const [alarmKind, setAlarmKind] = useState<'start' | 'flagship' | null>(null)
  useEffect(() => {
    const kind = engine.takeInvasionAlarm()
    if (kind === null) return
    setAlarmKind(kind)
    playSfx('invasion-alarm')
  })
  useEffect(() => {
    if (alarmKind === null) return
    const t = window.setTimeout(() => setAlarmKind(null), ALARM_TOTAL_MS)
    return () => window.clearTimeout(t)
  }, [alarmKind])
  const popupMsg =
    popupId !== null && !showOfflineReport && !battleOnStage && alarmKind === null
      ? (engine.commsInboxView().find((e) => e.id === popupId) ?? null)
      : null
  const settleSeq =
    popupMsg !== null && popupMsg.id === WEEKEND_COMMS_SETTLE_ID ? Number(popupMsg.textParams?.['seq'] ?? -1) : null
  const [fireworksOn, setFireworksOn] = useState(false)
  const fireworksSeqRef = useRef<number | null>(null)
  useEffect(() => {
    if (settleSeq === null || fireworksSeqRef.current === settleSeq) return
    fireworksSeqRef.current = settleSeq
    setFireworksOn(true)
    playSfx('invasion-end')
  }, [settleSeq])
  useEffect(() => {
    if (!fireworksOn) return
    const t = window.setTimeout(() => setFireworksOn(false), FIREWORKS_MS)
    return () => window.clearTimeout(t)
  }, [fireworksOn])
  useEffect(() => {
    if (popupMsg === null) return
    playSfx('comms-received')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popupMsg?.id])
  const [sumOpen, setSumOpen] = useState(false)
  const [bountyShopSeq, setBountyShopSeq] = useState(0)
  const [plugExchangeOpen, setPlugExchangeOpen] = useState(false)
  const [plugExchangeSeq, setPlugExchangeSeq] = useState(0)
  const openPlugExchange = (): void => {
    setPage('map')
    changeMapTab('bounty')
    setBountyShopSeq((n) => n + 1)
    setPlugExchangeSeq((n) => n + 1)
  }
  const [popupArmed, setPopupArmed] = useState(false)
  useEffect(() => {
    if (popupMsg === null) {
      setPopupArmed(false)
      return
    }
    setPopupArmed(false)
    const t = window.setTimeout(() => setPopupArmed(true), POPUP_ARM_MS)
    return () => window.clearTimeout(t)
  }, [popupMsg?.id])

  const [eventToast, setEventToast] = useState<{ id: number; text: string } | null>(null)
  const lastSeenLogId = useRef<number>(state.logs[state.logs.length - 1]?.id ?? 0)
  const eventTimer = useRef<number | null>(null)
  const logTailId = state.logs[state.logs.length - 1]?.id ?? 0
  useEffect(() => {
    const logs = state.logs
    for (let i = logs.length - 1; i >= 0; i--) {
      const l = logs[i]!
      if (l.id <= lastSeenLogId.current) break
      if (l.kind === 'event' || l.text.startsWith('✦')) {
        setEventToast({ id: l.id, text: logText(l) })
        if (eventTimer.current !== null) window.clearTimeout(eventTimer.current)
        eventTimer.current = window.setTimeout(() => setEventToast(null), 6000)
        break
      }
    }
    const tail = logs[logs.length - 1]
    if (tail) lastSeenLogId.current = tail.id
  }, [logTailId])

  const dismissEventToast = (): void => {
    if (eventTimer.current !== null) {
      window.clearTimeout(eventTimer.current)
      eventTimer.current = null
    }
    setEventToast(null)
  }

  async function handleSave(): Promise<void> {
    const ok = await engine.persist()
    showToast(ok ? tr("ui.App.054") : tr("ui.App.055"), !ok)
  }

  function handleReset(): void {
    if (!window.confirm(tr("ui.App.108"))) return
    void engine.resetGame()
    showToast(tr("ui.App.109"))
  }

  const openSettingsPage = (page: SettingsPageId = 'interface'): void => {
    setSettingsInitialPage(page)
    setShowSettings(true)
  }

  const pageProps = { engine, onToast: showToast, onOpenSettings: openSettingsPage }

  const tutStep = engine.state.onboarding.step
  const tabLocked = (t: MapTab): boolean => {
    const k = TAB_UNLOCK_KEY[t]
    return k !== undefined && !unlocked(state, k)
  }
  const tabLockSig = MAP_TABS.map((t) => (tabLocked(t.key) ? '0' : '1')).join('')
  useEffect(() => {
    if (tabLocked(mapTab)) setMapTab('star')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapTab, tabLockSig])

  const pulseNav = (key: PageKey): void => {
    if (navBeatTimer.current !== null) window.clearTimeout(navBeatTimer.current)
    setNavBeat((b) => ({ key, seq: (b?.seq ?? 0) + 1 }))
    navBeatTimer.current = window.setTimeout(() => {
      setNavBeat(null)
      navBeatTimer.current = null
    }, 220)
  }
  useEffect(
    () => () => {
      if (navBeatTimer.current !== null) window.clearTimeout(navBeatTimer.current)
    },
    [],
  )
  const changePage = (p: PageKey): void => {

    if (!unlocked(state, p)) {
      showToast(tr("ui.App.110", { p1: unlockNeedTitle(p) ?? tr('ui.App.116') }), true)
      return
    }
    if (p === page) pulseNav(p)
    else setNavBeat(null)
    hideActivityWin()
    if (p !== 'skills') setSkillsFocus(null)
    setPage(p)
  }
  const changeMapTab = (t: MapTab): void => {

    if (tabLocked(t)) {
      const k = TAB_UNLOCK_KEY[t]
      showToast(tr("ui.App.110", { p1: (k ? unlockNeedTitle(k) : undefined) ?? tr('ui.App.116') }), true)
      return
    }
    if (t !== 'bounty') setBountyShopSeq(0)
    setMapTab(t)
  }
  useEffect(() => {
    if (page === 'map' && mapTab === 'star') engine.ackScanView()
  }, [page, mapTab])
  const gotoMapTab = (tab: 'mine' | 'salvage', ids: string[]): void => {
    changePage('map')
    changeMapTab(tab)
    setMapGoto((p) => ({ tab, ids, seq: (p?.seq ?? 0) + 1 }))
  }
  const focusTaskTab = (tab: string): void => {
    setTaskFocus((p) => ({ tab, seq: (p?.seq ?? 0) + 1 }))
  }
  const focusSkillGroup = (group: string, branch?: string): void => {
    setSkillsFocus((p) => ({ group, branch, seq: (p?.seq ?? 0) + 1 }))
  }
  const changeShipTab = (t: ShipTab): void => {
    setShipTab(t)
    setSessionPick('ship.tab', t)
  }
  const prevObStep = useRef(engine.state.onboarding.step)
  const [planetOpen, setPlanetOpen] = useState(false)
  useEffect(() => {
    const open = (): void => { if (planetaryEnabled()) setPlanetOpen(true) }
    window.addEventListener('whale-planetary-open', open)
    return () => window.removeEventListener('whale-planetary-open', open)
  }, [])
  useEffect(() => {
    const onPageChange = (e: Event): void => {
      const ce = e as CustomEvent<{ page: PageKey }>
      if (ce.detail?.page) {
        changePage(ce.detail.page)
      }
    }
    window.addEventListener('whale-page-change', onPageChange)
    return () => window.removeEventListener('whale-page-change', onPageChange)
  }, [changePage])
  useEffect(() => {
    const s = engine.state.onboarding.step
    if (prevObStep.current === ONB_AWAKEN && s !== ONB_AWAKEN) {
      setSessionPick('task.tab', 'important')
      setPage('task')
    }
    prevObStep.current = s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutStep])

  return (
    <div ref={rootRef} className={`app-root${mobileRot ? ' is-mobile-rot' : ''}${mobileLand ? ' is-mobile-land' : ''}${mobileLayout ? ' is-mobile-layout' : ''} is-layout-${layoutKind}`}>
      {/* 引擎订阅：正常异步渲染；性能监测激活时改 flushSync 同步刷新并实测整树提交耗时 */}
      <PerfListener engine={engine} force={force} />
      {/* ───── 顶栏 ───── */}
      {/* ───── 外壳（顶栏 / 工作区 / 底部导航 / 日志坞；两套布局见 ui/AppShell.tsx）───── */}
      <AppShell
        layoutKind={layoutKind}
        state={state}
        engine={engine}
        changePage={changePage}
        handleSave={handleSave}
        handleReset={handleReset}
        setShowSaveManager={setShowSaveManager}
        changeMapTab={changeMapTab}
        focusTaskTab={focusTaskTab}
        changeShipTab={changeShipTab}
        showToast={showToast}
        hideActivityWin={hideActivityWin}
        openWormhole={openWormhole}
        windowRestore={windowRestore}
        unlocked={unlocked}
        commsUnread={commsUnread}
        bountyNew={bountyNew}
        firstTaskNew={firstTaskNew}
        navBeat={navBeat}
        page={page}
        setShowSettings={(open) => { setSettingsInitialPage('interface'); setShowSettings(open) }}
        mobileLog={mobileLayout ? { open: mobileLogOpen, onToggle: () => setMobileLogOpen((open) => !open) } : null}
        setShowHandbook={setShowHandbook}
        copyQqGroup={copyQqGroup}
        qqCopied={qqCopied}
        setReportDismissed={setReportDismissed}
        setPerfOpen={setPerfOpen}
        debugOn={debugOn}
        promosNow={promosNow}
        tuningsNow={tuningsNow}
        tuningTick={tuningTick}
        navItems={exchangeAvailable ? NAV_ITEMS : NAV_ITEMS.filter((item) => item.key !== 'exchange')}
        debugNavItems={[...DEBUG_NAV_ITEMS, { key: 'stellar', label: 'ui.stellar.054', icon: 'nav-map',
          onSelect: () => { if (planetaryEnabled()) { hideActivityWin(); setPlanetOpen(true) } } }]}
        readDebugEnabled={readDebugEnabled}
        qqGroup={QQ_GROUP}
        pageMain={(
          <>
            {/**
            * ───── **主控活动窗口：嵌入主区、顶掉那一页**（2026-09-21 船长令）─────
            *
            * 船长原话：「我的意思是**取消悬浮，直接嵌入主窗口**，玩家如果点击最小化或者切换导航栏
            * 之类的时候就隐藏并最小化。」
            * ⇒ 窗口就是主区里的一个正常块，上屏时**页面整块让位**
            * （`.app-page-content.is-win-hidden { display:none }`，
            * ⚠ **只是不上屏、不是卸载**：页里的检索词 / 滚动位置 / 弹层状态都留住，回来时原样）。
            * ⚠ 战斗屏**不在**这套机制里（2026-09-22 船长令已把它回滚成全屏覆盖层）。
            *
            * **挂载 vs 上屏**：活动窗口"上屏"= 顶掉那一页；战斗屏是**自己的全屏覆盖层**（2026-09-22 回滚），
            * 不在这套"嵌入"机制里 —— 它的挂载条件单独写在文件末弹层那段（`inBattle || battleOpen`，
            * 为的是保住战后战报）。`.app-win-host` 用 `display: contents` ⇒ 本身不产生盒子，
            * 窗口直接参与主区的 flex 排布，因此"挂着但不上屏"时它不会白占地方。
            */}
            <div className="app-win-host">
            {/* 主控活动窗口：嵌入主区、顶掉那一页（船长 2026-09-21 令；战斗屏不在这条链上，见文件末弹层那段） */}
            {activityOnStage ? (
            <ActivityScreen
            state={state}
            ctx={engine.ctx}
            open
            onMinimize={() => setActivityOpen(false)}
            />
            ) : null}
            </div>
            {/* 一级页不滚：已按 docs/design/page-scroll-layout.md 完成转换的页进 no-scroll（整页不滚，滚动在二级窗）。
            `key={page}` ⇒ 换页即重挂载并立即显示；点当前页不重挂载，走 `is-beat` 的脉冲（见 pulseNav）。 */}
            <div
            className={`app-page-content${PAGE_NO_SCROLL.has(page) ? ' no-scroll' : ''}${navBeat?.key === page ? ' is-beat' : ''}${winOnStage ? ' is-win-hidden' : ''}`}
            key={page}
            /**
             * **当前页的机器可读标记**（**2026-09-27 · 三号核验批**）：
             * 内容区此前只有类名、没有"这是哪一页"的标记 ⇒ 无头工具（`tools/l10n-en-scan.ts`）
             * 判不出"切页到底生效没有"，只能靠固定等待 + 猜，实测因此出现**整页读数缺失、
             * 上一页的读数在好几个页名下重复**（读数失真）。
             * 这个属性只为"读得出、核对得了"而存在：不改样式、不改行为、不参与任何逻辑分支。
             */
            data-page={page}
            >
            {page === 'ship' ? (
            <ShipPage
            {...pageProps}
            tab={shipTab}
            onTab={changeShipTab}
            onGotoMarket={(goodKey) => {
            setMktFocus((p) => ({ key: goodKey, seq: (p?.seq ?? 0) + 1 }))
            changePage('market')
            }}
            onGotoFit={(shipId) => {
            setFitShipId(shipId)
            changePage('fit')
            }}
            /**
             * **「前往实验室」**（**2026-09-29 船长令**：跃迁燃料页要能直接跳到工业的实验室）——
             * 与「第一次」卡片的段定位同一套手法：切页 ＋ 喂 `focusSec`（页在切走时重挂载 ⇒ 取初值即可）。
             */
            onGotoIndustryLab={() => {
            setIndFocus('lab')
            changePage('industry')
            }}
            />
            ) : null}
            {page === 'fit' ? <FitPage {...pageProps} fitShipId={fitShipId} /> : null}
            {page === 'items' ? (
            <ItemsPage
            {...pageProps}
            onGotoMarket={(goodKey) => {
            setMktFocus((p) => ({ key: goodKey, seq: (p?.seq ?? 0) + 1 }))
            changePage('market')
            }}
            />
            ) : null}
            {page === 'market' ? (
            <MarketPage
            {...pageProps}
            focusKey={mktFocus?.key ?? null}
            focusSeq={mktFocus?.seq ?? 0}
            onFocusUsed={() => setMktFocus(null)} // 一次性聚焦：应用后即清，避免每次进市场都带出上次的物品
            />
            ) : null}
            {page === 'industryHud' ? (
              /* **工业 HUD 页（调试）**（2026-09-30 船长令）：另起一页，现有工业页一字不动 */
              <IndustryHudPage
                {...pageProps}
                onGotoMarket={(goodKey) => {
                  setMktFocus((p) => ({ key: goodKey, seq: (p?.seq ?? 0) + 1 }))
                  changePage('market')
                }}
              />
            ) : null}
            {page === 'exchange' ? <ExchangePage {...pageProps} /> : null}
            {page === 'industry' ? (
            <IndustryPage
            {...pageProps}
            focusSec={indFocus}
            /**
             * **组装机「前往章鱼人兑换」**（**2026-09-26 船长令**：「没有蓝图的舰船插件组装机应该显示
             * 去商店兑换，点击后跳转到章鱼人声望商店」）⇒ 就地开统一的那张窗口（与首匣通讯同源）。
             * ⚠ 这里**不切页**：组装机就在工业页上，窗口是覆盖层，收起后玩家还停在原处。
             */
            onGotoPlugExchange={openPlugExchange}
            plugExchangeFocus={plugExchangeSeq}
            onGotoMarket={(goodKey) => {
            setMktFocus((p) => ({ key: goodKey, seq: (p?.seq ?? 0) + 1 }))
            changePage('market')
            }}
            onGotoMap={gotoMapTab}
            /**
            * **组装机「去虫洞（遗迹打捞）」**（船长 2026-09-14：虫洞专属图纸市场买不到）⇒
            * 跳**星图 · 出港 · 扫描虫洞**页（进洞与库存都在那儿）。走既有的 `changePage` + `changeMapTab`
            * 两个入口，教程锁与标签口径自动跟随（与星图内部跳转同一把尺）。
            */
            onGotoWormhole={() => {
            changePage('map')
            changeMapTab('whscan')
            }}
            />
            ) : null}
            {page === 'skills' ? <SkillsTreePage {...pageProps} focusGroup={skillsFocus} /> : null}
            {page === 'map' ? (
            <MapPage
            {...pageProps}
            mapTab={mapTab}
            onMapTab={changeMapTab}
            mapGoto={mapGoto}
            onOpenWormhole={openWormhole}
            onExploreWormhole={(stockId) => openWormhole(stockId)}
            onAutoExploreWormhole={(stockId) => openWormholeAuto(stockId)}
            /** 声望商店定位信号（船长 2026-09-27）：变化即让「常驻悬赏」切到「声望商店」子页 */
            bountyShopSeq={bountyShopSeq}
            /** 打捞页「打捞需要打捞器」那行的「去装配」按钮（船长 2026-09-20）：与舰船页同一落点 */
            onGotoFit={(shipId) => {
            setFitShipId(shipId)
            changePage('fit')
            }}
            />
            ) : null}
            {/* 任务中心（2026-09-14 从星图页搬来的一级页）：内层标签定位仍走 taskFocus */}
            {page === 'task' ? (
            <TaskCenterPage
            {...pageProps}
            taskFocus={taskFocus}
            // 「第一次」卡片上的「看情报」：切到通讯页并选中那封情报信（沿用既有的 commsFocus 定位机制）
            onOpenComms={(messageId) => {
            setCommsFocus((p) => ({ id: messageId, seq: (p?.seq ?? 0) + 1 }))
            setPage('comms')
            }}
            /**
            * 「第一次」卡片的**跳转按钮**（船长 2026-09-18：「所有的'第一次'任务，添加一个跳转界面的按钮」）：
            * 一律走既有的 `changePage` / `changeMapTab` / `changeShipTab` 三把尺——
            * 「第一次」前置锁与页签白名单自动跟随（未解锁时给提示而不是硬跳），工业页再带上内层段。
            */
            onJump={(t) => {
            if (t.industrySec) setIndFocus(t.industrySec)
            if (t.skillGroup) focusSkillGroup(t.skillGroup)
            // 教程的装配入口始终选当前驾驶船，不沿用上次浏览的其他舰船。
            if (t.page === 'fit') setFitShipId(engine.state.shipId)
            changePage(t.page as PageKey)
            if (t.mapTab) changeMapTab(t.mapTab as MapTab)
            if (t.shipTab) changeShipTab(t.shipTab as ShipTab)
            }}
            />
            ) : null}
            {/* 成就（2026-09-20 一级页）：页内是固定头 + 内容内滚的二级子窗口容器 */}
            {page === 'achieve' ? <AchievementsPage engine={engine} /> : null}
            {page === 'comms' ? (
            <CommsPage
            {...pageProps}
            // 顶部引导条「看详情」的定位请求（seq 变化即重新选中对应那封）
            focus={commsFocus}
            // 消息提示的跳转出口（③ 只给提示 + 跳转）：与弹窗共用同一套落点规则
            onGoto={gotoFromComms}
            /**
             * 「前往章鱼人兑换」（**2026-09-26 船长令**）：走**唯一开窗入口** ⇒ 与弹窗版、与组装机
             * 那张卡三处行为完全一致（开窗 ＋ 组装机切到「舰船插件」档）。
             */
            onOpenPlugExchange={openPlugExchange}
            />
            ) : null}
            {page === 'chat' ? (
              <OnlineChatPage chat={onlineChat} onToast={showToast} onOpenSettings={() => { setSettingsInitialPage('account'); setShowSettings(true); hideActivityWin() }} />
            ) : null}
            </div>
          </>
        )}
        logDock={(
            <div className={`app-log-dock${mobileLayout ? ' is-mobile-drawer' : ''}${mobileLayout && mobileLogOpen ? ' is-open' : ''}`}>
            {mobileLayout && mobileLogOpen ? <button className="app-mobile-log-mask" onClick={closeLog} aria-label={tr('ui.App.086')} /> : null}
            <aside ref={logDrawerRef} className={`app-log-side${logClosed ? ' is-collapsed' : ''}${layoutKind === 'classic' && !mobileLayout && classicLog.faded ? ' is-fading' : ''}`}
              style={layoutKind === 'classic' ? { '--classic-log-fade-ms': `${CLASSIC_LOG_FADE_MS}ms` } as CSSProperties : undefined}
              aria-hidden={layoutKind === 'classic' && logClosed || undefined}
              role={mobileLayout && mobileLogOpen ? 'dialog' : undefined} aria-modal={mobileLayout && mobileLogOpen ? true : undefined}
              aria-label={mobileLayout ? tr('ui.App.067') : undefined} id="mobile-log-drawer" tabIndex={mobileLayout ? -1 : undefined}>
            <Panel
            title={tr("ui.App.067")}
            /* 周末入侵：**日志面板底部的活动框**（2026-09-24 船长按截图指定位置），点击跳星图 */
            footer={
            <WeekendInvasionLogRow
            engine={engine}
            onGoto={() => {
            changePage('map')
            changeMapTab('star')
            }}
            />
            }
            right={
            <div className="app-log-head-right">
            <span className="app-dim">{tr("ui.App.068")}</span>
            <button className="app-btn is-small" onClick={closeLog} title={tr("ui.App.069")}>
            {tr("ui.App.070")}
            </button>
            </div>
            }
            >
            <div className="app-log-filters" title={tr("ui.App.071")}>
            {/* 2026-09-26 船长令：**单选**——点哪一类就只显示那一类；「全部」= 不过滤 */}
            <button
            className={`app-log-filter${logFilter === 'all' ? '' : ' is-off'}`}
            title={tr("ui.App.163")}
            onClick={() => setLogFilter('all')}
            >
            {tr("ui.App.158")}
            </button>
            {LOG_KINDS.map((kind) => {
            const on = logFilter === kind
            return (
            <button
            key={kind}
            className={`app-log-filter${on ? '' : ' is-off'}`}
            title={KIND_DESC[kind]}
            onClick={() => setLogFilter(kind)}
            >
            <span className="app-log-dot" style={{ background: KIND_DOT[kind] }} />
            {KIND_LABEL[kind]}
            </button>
            )
            })}
            </div>
            {hiddenAll ? (
            <div className="app-dim app-log-empty">{tr("ui.App.072")}</div>
            ) : (
            <LogList
              emptyText={tr('ui.App.176')}
            logs={visibleLogs.map((l) => ({ id: l.id, kind: kindOf(l.kind), text: logText(l), timeLabel: gameClock(l.atGameMs) }))}
            limit={220}
            />
            )}
            </Panel>
            </aside>
            {!mobileLayout && logClosed ? (
            <button ref={logHandleRef} className="app-log-handle" onClick={() => setLogCollapsed(false)} title={tr("ui.App.073")} aria-label={tr("ui.App.073")}>
            «
            </button>
            ) : null}
            </div>
        )}
      />



        {/* 两种底部提示**整条可点 = 立即关闭**（2026-09-13 船长；见 dismissToast 注释） */}
        {toast ? (
          <div
            className={`app-toast${toast.warn ? ' is-warn' : ''}`}
            title={tr("ui.App.074")}
            onClick={dismissToast}
          >
            {toast.text}
          </div>
        ) : null}
        {eventToast ? (
          <div className="app-event-toast" title={tr("ui.App.074")} onClick={dismissEventToast}>
            {eventToast.text}
          </div>
        ) : null}
        {/**
         * B1 低安遭遇横幅：待决（迎战/快速脱离，60s 超时自动脱离）与遭遇战进行中。
         *
         * ⚠ **2026-09-25 船长报障**：「关闭战斗后，屏幕顶部显示『遭遇战中：[WKtest] 巨 vs H 族旗舰 ·
         * 墨潮旗舰部队（引擎自动推演，战报稍后）』」——**入侵旗舰战**也承载在遭遇槽，但它是
         * **玩家亲自观战的编队战**（全屏战斗屏 + 「⚔ 战斗中」浮动入口）⇒ 这条"引擎自动推演、战报稍后"
         * 的横幅措辞与实际完全不符。现按宿主分流：**旗舰战进行中不挂这条横幅**（入口由战斗屏承担），
         * 普通遭遇（待决 / 后台自动打完）照旧。
         */}
        {state.encounter.active && !weekendFlagshipBattleActive(state) ? (
          <div className={`app-enc-banner${state.encounter.battle ? ' is-fight' : ''}`}>
            {state.encounter.battle ? (
              <span className="app-enc-title">
                {tr("ui.App.075")}{shipDisplayName(state, engine.ctx, state.encounter.shipId ?? state.shipId)} vs{' '}
                {state.encounter.name}{tr("ui.App.076")}
              </span>
            ) : (
              <>
                <span className="app-enc-title">{tr("ui.App.077")} {state.encounter.name}</span>
                <span className="app-enc-sub">
                  {shipDisplayName(state, engine.ctx, state.encounter.shipId ?? state.shipId)}（{state.encounter.origin}{tr('ui.App.103')}{' '}
                  {Math.max(1, Math.ceil((state.encounter.deadlineGameMs - state.gameMs) / 1000))} {tr("ui.App.078")}
                </span>
                <button
                  className="app-btn is-small is-primary"
                  title={tr("ui.App.079")}
                  onClick={() => {
                    const r = engine.fightEncounterNow()
                    if (!r.ok) showToast(cmdText(r) || tr('ui.App.117'), true)
                  }}
                >
                  <span className="app-ico"><Glyph name="nav-bounty" size={14} color={NAV_TONES["nav-bounty"]} /></span>{tr("ui.App.080")}
                </button>
                <button
                  className="app-btn is-small"
                  title={tr("ui.App.081")}
                  onClick={() => {
                    const r = engine.fleeEncounterNow()
                    if (!r.ok) showToast(cmdText(r) || tr('ui.App.118'), true)
                  }}
                >
                  <span className="app-ico"><Glyph name="ico-swap" size={14} color={ICO_TONES["ico-swap"]} /></span>{tr("ui.App.082")}
                </button>
              </>
            )}
          </div>
        ) : null}
        {pendingOpen ? (() => {
          const s = engine.dialogues.find((d) => d.id === pendingOpen)
          return s ? <Communicator script={s} onClose={() => setPendingOpen(null)} /> : null
        })() : null}

      {/**
       * ───── 交火中：浮动还原标（2026-09-20 改造后**由窗口壳统一渲染**） ─────
       * 原先这里是一枚独立按钮；观战窗口改非全屏后，最小化与浮动还原标收进 `ui/WinBox.tsx`
       * （一处实现两处消费：战斗窗口 + 主控活动窗口）⇒ 本层只决定"窗口开不开、哪个在跑"。
       */}

      {/* ───── 离线简报（启动后一次性显示） ───── */}
      {showOfflineReport ? (
        <div className="app-report-card">
          <div className="app-report-head">
            <span className="app-report-title">{tr("ui.App.085")}</span>
            <button className="app-btn is-small" onClick={() => setReportDismissed(true)}>
              {tr("ui.App.086")}
            </button>
          </div>
          <div className="app-report-body">
            <div className="app-dim">
              {tr("ui.App.087")} {fmtDuration(offlineReport.wallAwayMs)}{tr('ui.App.115', { d: fmtDuration(offlineReport.settledMs) })}
              {offlineReport.overflowMs > 0 ? tr('ui.App.104', { d: fmtDuration(offlineReport.overflowMs) }) : ''}
            </div>
            <div className="app-report-line">
              {tr("ui.App.088")}
              <b className={offlineReport.iskDelta >= 0 ? 'app-trend-up' : 'app-trend-down'}>
                {moneyDelta(offlineReport.iskDelta, locale === 'en' ? 'en' : 'zh')}
              </b>{' '}
              {tr("ui.FirstTasks.003")}
              {/**
               * ⚠ 这里**保留全精度**（不走万/亿分级）：离线结算报告是"玩家要看清楚这趟挣了多少"的地方，
               * 与左侧栏那个"一眼扫过"的余额栏用途不同（船长 2026-09-13 只要求处理"钱位数过多"的显示）。
               */}
            </div>
            {offlineReport.items.length > 0 ? (
              <div className="app-report-line">
                {tr("ui.App.089")}{offlineReport.items.map((i) => `${i.name}×${i.delta.toLocaleString('zh-CN')}`).join(tr("ui.MatterTechTab.017"))}
              </div>
            ) : null}
            {offlineReport.modules.length > 0 ? (
              <div className="app-report-line">
                {tr("ui.App.090")}{offlineReport.modules.map((m) => `${m.name}×${m.delta}`).join(tr("ui.MatterTechTab.017"))}
              </div>
            ) : null}
            {offlineReport.shipsIn.length > 0 ? (
              <div className="app-report-line"><span className="app-ico"><Glyph name="nav-ship" size={13} color={NAV_TONES["nav-ship"]} /></span>{tr("ui.App.091")}{offlineReport.shipsIn.join(tr("ui.MatterTechTab.017"))}</div>
            ) : null}
            {offlineReport.shipsStored.length > 0 ? (
              <div className="app-report-line"><span className="app-ico"><Glyph name="nav-ship" size={13} color={NAV_TONES["nav-ship"]} /></span>{tr("ui.App.092")}{offlineReport.shipsStored.map((s) => `${s.name}×${s.delta}`).join(tr("ui.MatterTechTab.017"))}{tr("ui.App.093")}</div>
            ) : null}
            {offlineReport.skillsUp.length > 0 ? (
              <div className="app-report-line">{tr("ui.App.094")}{offlineReport.skillsUp.join(tr("ui.MatterTechTab.017"))}</div>
            ) : null}
            {offlineReport.learnedIn.length > 0 ? (
              <div className="app-report-line"><span className="app-ico"><Glyph name="ico-cross" size={13} color={ICO_TONES["ico-cross"]} /></span>{tr("ui.App.095")}{offlineReport.learnedIn.join(tr("ui.MatterTechTab.017"))}</div>
            ) : null}
            {offlineReport.coreJobs.length > 0 ? (
              <>
                <div className="app-report-line"><span className="app-ico"><Glyph name="nav-ai" size={13} color={NAV_TONES["nav-ai"]} /></span>{tr("ui.App.096")}</div>
                {offlineReport.coreJobs.map((row, i) => (
                  <div key={i} className="app-report-line">{row}</div>
                ))}
                <div className="app-dim app-report-tail">{tr("ui.App.097")}</div>
              </>
            ) : null}
            {(offlineReport.combatLines ?? []).map((line, i) => <div key={`combat-${i}`} className="app-report-line">{line}</div>)}
            {offlineReport.highlights.map((h, i) => (
              <div key={i} className={`app-report-highlight is-${h.kind}`}>
                {h.kind === 'warn' ? '⚠' : '¥'} {h.text}
              </div>
            ))}
            <div className="app-dim app-report-tail">
              {tr("ui.App.098")} {offlineReport.logCount.toLocaleString('zh-CN')} {tr("ui.App.099")}
            </div>
          </div>
        </div>
      ) : null}

      {/* ───── 送达弹窗（船长 2026-09-14：除新手教程外所有通讯都弹；外形 = 通讯页右栏那块屏） ───── */}
      {popupMsg ? (
        <div className="app-ann-mask" onClick={() => (popupArmed ? engine.dismissCommsPopup(popupMsg.id) : undefined)}>
          <div className="app-comm-pop" onClick={(e) => e.stopPropagation()}>
            <div className="app-comms-body-col">
              <CommsScreen entry={popupMsg} itemNameOf={(id) => engine.ctx.items.get(id)?.name ?? id} />
              <CommsEave
                entry={popupMsg}
                onGoto={(p, tab, shipTab, taskTab, skillBranch) => {
                  engine.dismissCommsPopup(popupMsg.id)
                  gotoFromComms(p, tab, shipTab, taskTab, skillBranch)
                }}
                /**
                 * **弹面板的动作**（2026-09-25 · 入侵结算信「查看详细奖励」）——
                 * **船长 2026-09-25 令**：「**玩家点击下方的跳转时应该直接弹出结算公告。**」
                 * ⇒ 收掉弹窗、**就地弹出结算面板**（复用通讯页那一处同源的 `WeekendSummaryView`
                 * ＋ 全仓既有的 `.app-modal-*` 族；原先只是"跳到通讯页、还要再点一次"）。
                 */
                onAction={(a) => {
                  if (a === 'weekendSummary') {
                    engine.dismissCommsPopup(popupMsg.id)
                    setSumOpen(true)
                    return
                  }
                  /**
                   * **首匣那封信的「前往」**（**2026-09-26 船长报障**：「跳转界面不正确」）。
                   *
                   * 漏点在这里：通讯页（`CommsPage`）那份 `onAction` 处理了 `plug-exchange`，
                   * 但**送达弹窗这一份漏了** ⇒ 玩家从弹窗点「前往」**什么都不会发生**
                   * （而弹窗正是这封信的正常到达方式）。现在两处行为一致：
                   * 收掉弹窗 ＋ 就地弹出「章鱼人兑换」窗口。
                   */
                  if (a === 'plug-exchange') {
                    engine.dismissCommsPopup(popupMsg.id)
                    openPlugExchange()
                  }
                }}
                extra={
                  <button className="app-btn is-small" onClick={() => engine.dismissCommsPopup(popupMsg.id)}>
                    {tr("ui.App.100")}
                  </button>
                }
              />
            </div>
          </div>
        </div>
      ) : null}

      {/**
       * **"旗舰现身"一次性弹窗**（2026-09-25 船长令：「希望当核心星系收复敌人旗舰现身时，出现一次弹窗，
       * 玩家可以通过弹窗直接前往准备」）：引擎在旗舰首次现身那一拍立待办（内存、不随档）⇒ 这里弹一次；
       * 「战前准备」直开准备界面、「知道了」只关窗。弹层复用全仓既有的 `.app-modal-*` 族。
       */}
      {engine.flagshipPopupPending ? (
        <div className="app-modal-mask" onClick={() => engine.dismissFlagshipPopup()}>
          <div className="app-modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="app-modal-head">
              <span className="app-report-title">{tr('ui.weekend.090')}</span>
              <button className="app-btn is-small" onClick={() => engine.dismissFlagshipPopup()}>
                {tr('ui.App.086')}
              </button>
            </div>
            <div className="app-modal-body">
              <div className="app-note">
                {tr('ui.weekend.091', {
                  p1: engine.ctx.galaxies.get(engine.state.weekendEvent?.coreId ?? '')?.name ?? '',
                  p2: tr(weekendFamilyNameId(engine.state.weekendEvent?.family ?? 'H') ?? 'core.weekend.023'),
                })}
              </div>
              <div className="app-wh-actions">
                <FlagshipFleetActions engine={engine} onStarted={() => engine.dismissFlagshipPopup()} />
                <button className="app-btn is-small" onClick={() => engine.dismissFlagshipPopup()}>
                  {tr('ui.App.100')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {/* 旗舰沿用当前编队；距离变化仍需原有独立确认。 */}
      {state.pendingBattleRange ? <BattleRangeConfirm key={state.pendingBattleRange.signature} engine={engine} /> : null}
      {/**
       * **入侵结算面板**（船长 2026-09-25 令：「玩家点击下方的跳转时应该直接弹出结算公告」）：
       * 从**通讯弹窗**的「查看详细奖励」直接开到这里（组件与通讯页那一处同源：`WeekendSummaryView`）；
       * 弹层结构复用全仓既有的 `.app-modal-*` 族与通讯页那处的类名（不自造窗口观感）。
       */}
      {sumOpen && state.weekendLastResult !== undefined ? (
        <div className="app-modal-mask" onClick={() => setSumOpen(false)}>
          <div className="app-modal app-modal-wide app-weekend-sum" onClick={(e) => e.stopPropagation()}>
            <WeekendSummaryView engine={engine} onClose={() => setSumOpen(false)} />
          </div>
        </div>
      ) : null}
      {/**
       * **旧「章鱼人兑换」弹层**（**2026-09-26 船长令**立；**2026-09-27 甲案**撤入口）。
       *
       * ⚠ **现在没有任何入口会打开它**：三条入口（通讯弹窗/通讯页/组装机）一律走
       * `openPlugExchange()` → 跳到**星图页 · 常驻悬赏 · 「声望商店」子页**。
       * 这一层与 `plugExchangeOpen` 状态**暂时留着**（船长要先看子页观感、确认后再删）；
       * 删的时候把本块、那个状态、`PlugExchangeModal` 一起删掉即可（内容体 `PlugExchangeBody` 不动）。
       */}
      {plugExchangeOpen ? (
        <PlugExchangeModal engine={engine} onToast={showToast} onClose={() => setPlugExchangeOpen(false)} />
      ) : null}
      {/**
       * **入侵演出**（船长 2026-09-25 令）：警报红灯（开局 ＋ 旗舰现身各一次）与结束庆祝烟火。
       * 两者都 `pointer-events: none` ＋ `z-index 110`（压在战场之上）——见 `styles.css` 那一族与
       * `panels/InvasionFx.tsx` 的口径。
       */}
      {alarmKind !== null ? <InvasionAlarm kind={alarmKind} /> : null}
      {fireworksOn ? <InvasionFireworks /> : null}
      {/**
       * **交火中：右上角悬浮入口**（主动进入战斗页，不自动切换页面）。
       *
       * ⚠ **2026-09-22 船长令「界面回滚，战斗界面回滚到全屏显示」**：战斗屏回到自己的全屏覆盖层
       * （`.app-battle-screen { position: fixed; inset: 0 }`），入口也就回到这枚浮动按钮上 ——
       * 窗口化那阵子改用的"左上角小窗「⤢」角标"只管**主控活动窗口**，不再管战斗。
       */}
      {inBattle && !battleOpen ? (
        <button className="app-battle-float" onClick={() => setBattleOpen(true)} title={tr('ui.App.083')}>
          {tr('ui.App.084')}
        </button>
      ) : null}
      {/**
       * 战斗屏：**挂载看 `battleMounted`、上屏看 `battleOpen`**（两者的分工与理由见上方那段注释）。
       * - 挂载条件不能写 `inBattle`：结算与 `inBattle` 变假同拍 ⇒ 那一拍卸载就把战报丢了。
       * - 上屏由 `visible` 管：玩家点「← 最小化」真的关屏（战斗后台照打），浮动入口随时点回来。
       * - 战报到达时 `onReport` 把屏叫回来（只对"玩家看过这一场"的情况），看完由 `onDone` 收尾卸载。
       */}
      {battleMounted ? (
        <BattleScreen
          engine={engine}
          onToast={showToast}
          visible={battleOpen}
          onReport={() => {
            if (!battleWatchedRef.current) return false
            setBattleOpen(true)
            return true
          }}
          onClose={() => {
            // 2026-09-10 修复（船长定位）：最小化战场 = 仅关闭观看界面——战斗后台照常推进、
            // 重复清剿照常继续（原实现在连击自动发起的战斗中退出会顺手停环，属 bug）；
            // 若要中止战斗请用战场内「⚑ 撤退」（撤退才停环）。
            setBattleOpen(false)
          }}
          onDone={() => {
            // 子组件收尾完了（战报关掉了 / 没有战报可播）⇒ 可以卸载，别再挂着空跑 33ms 循环
            setBattleOpen(false)
            setBattleMounted(false)
          }}
        />
      ) : null}
      {/* 虫洞面板（终局玩法 · 已上线）：挂在这一层 ⇒ 不依赖星图选中星系 */}
      {whOpen ? (
          <ExplorationPanel
            engine={engine}
            onToast={showToast}
            stockId={whStockPick}
            autoStockId={whAutoPick}
            onClose={() => {
              setWhOpen(false)
              setWhStockPick(null)
              setWhAutoPick(null)
            }}
          />
        ) : null}
      {showSaveManager ? <SaveManager engine={engine} onToast={showToast} onClose={() => setShowSaveManager(false)} /> : null}
      {showHandbook ? (
        <Handbook
          engine={engine}
          onClose={() => setShowHandbook(false)}
          /* 图鉴条目 → 市场（2026-09-14 船长）：与舰船页 / 物品页 / 货舱页 / 工业页**同一个入口**
             （一次性聚焦 + 切页），跳过去只展开行情详情、不替玩家下单。 */
          onGotoMarket={(goodKey) => {
            setMktFocus((p) => ({ key: goodKey, seq: (p?.seq ?? 0) + 1 }))
            changePage('market')
          }}
        />
      ) : null}
      {showSettings ? (
        <SettingsPanel
          initialPage={settingsInitialPage}
          root={rootRef}
          onClose={() => setShowSettings(false)}
          engine={engine}
          onSave={() => void handleSave()}
          onReset={handleReset}
          onOpenSaveManager={() => setShowSaveManager(true)}
          debugOnState={debugOn}
          onDebugChange={setDebugOn}
          layoutKind={layoutKind}
          layoutPending={layoutPending}
          onApplyLayoutReload={() => void applyLayoutAndReload()}
          onCancelLayout={() => setLayoutPending(null)}
          onLayoutChange={chooseLayout}
          saveState={saveState}
          storageProbe={storageProbe}
          onAllowSave={allowSaveNow}
          saveFileStatus={saveFile}
          saveFileBusy={fileBusy || reconnectChoice !== null}
          onBindSaveFile={bindSaveFileNow}
          onReconnectSaveFile={reconnectSaveFileNow}
          onUnbindSaveFile={unbindSaveFileNow}
          onRefreshSaveFileStatus={refreshSaveFile}
        />
      ) : null}
      {reconnectChoice ? <SaveReconnect engine={engine} choice={reconnectChoice} onChoice={setReconnectChoice}
        onClose={() => {
          engine.cancelReconnectLocalSave()
          setReconnectChoice(null)
          refreshSaveFile()
          showToast(tr('ui.saveReconnect.008'))
        }} onDone={(loaded, paused) => {
          setReconnectChoice(null)
          refreshSaveFile()
          setSaveState(engine.saveWriteState())
          const done = loaded ? tr('ui.SaveManager.032') : tr('ui.saveGuard.025', { p1: saveFile?.name ?? '' })
          showToast(paused ? `${done} ${tr('ui.saveReconnect.008')}` : done, paused)
        }} /> : null}
      {/**
       * ⚠ **这一层为什么没有窗口**（两次改动叠加的结果，别再把窗口挪回来）：
       * - 2026-09-20：原先那枚独立的「⚔ 战斗中」浮动按钮撤掉，最小化与还原统一走 `ui/WinBox.tsx`；
       * - 2026-09-21（船长令「改为覆盖在当前的主窗口上」）：战斗窗口与主控活动窗口**都挂进 `<main>`**
       *   （见上方 `</main>` 之前那段）——本层是 `.app-root` 直下、整屏坐标系，
       *   窗口若留在这里就会重新变成"盖住左导航与顶栏的整屏悬浮层"。
       * 本层现在只剩"何时开、开哪个"的状态与其它弹层。
       */}

      {/* 序章·苏醒：新档演出覆盖层（step 0；演出期间引擎时间冻结） */}
      {engine.state.onboarding.step === 0 ? <PrologueScreen engine={engine} /> : null}

      {/**
       * **模式选择框**（**2026-09-24 船长令**「对至今未选择的旧档进行模式选择弹窗」＋「进游戏后要二选一」）。
       * 判据 = `engine.modeChoiceNeeded()`（同步读内存档：没开过铁人、也没选过普通）。
       * ⚠ 由 `onboarding.step !== 0` 守着 ⇒ **只在进游戏之后**弹（序章自己那张模式卡在前）；
       * 选完那一刻引擎 `notify()` ⇒ 整树重渲染 ⇒ 本层自动卸载，此后不再出现。
       */}
      {engine.state.onboarding.step !== 0 && (engine.modeChoiceNeeded() || modeChoiceImportHold) ? (
        <ModeChoice engine={engine} onDone={force} onImportedChange={setModeChoiceImportHold} />
      ) : null}

      {/* 手机横屏：自绘下拉选项面板（值写回原生 select 并派发 change，保持各页 onChange 原样生效） */}
      {mobSel ? (
        <div className="app-mob-sel-mask" onClick={() => setMobSel(null)}>
          <div className="app-mob-sel" onClick={(e) => e.stopPropagation()}>
            {mobSel.opts.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`app-mob-sel-opt${o.value === mobSel.sel ? ' is-sel' : ''}`}
                onClick={() => {
                  const cur = mobSel
                  setMobSel(null)
                  if (!cur || !cur.el.isConnected) return
                  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(cur.el, o.value)
                  cur.el.dispatchEvent(new Event('change', { bubbles: true }))
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* 性能监测 HUD（debug 开关下由顶栏「⏱ 性能」唤出） */}
      {perfOpen ? <PerfHud onClose={() => setPerfOpen(false)} /> : null}

      {/* 全局悬停提示层（置于最上） */}
      <TooltipLayer />
      {planetOpen && planetaryEnabled() && engine.ctx.planetary ? <StellarExplorer engine={engine} catalog={engine.ctx.planetary}
        onClose={() => setPlanetOpen(false)} onCommand={(action, args) => engine.planetaryCommand(action, args)} /> : null}
    </div>
  )
}
