import { activityOverview, activePromos, activeTunings, aiCoreIndustryUsed, aiCoreShipUsed, scanAwaitingView, scanStatus, SYNAPTIC_ACCELERANT_MUL } from '@whale/core'
import type { ActivityView } from '@whale/core'
import { useEffect, useState } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { Glyph, NAV_TONES, ICO_TONES } from '../ui/Glyphs'
import { aiIndustrySlots, aiSlotTip } from '../ui/aiSlots'
import { stopLabel, doStop } from './activityStopLabel'
import { tr } from '../i18n/locale'
import { explorationActivityText } from '../ui/explorationActivityText'
import { goFor } from '../ui/activityGo'
import { fmtDate, fmtDuration, fmtDurationShort } from '../i18n/fmt'
import '../styles-activity-invasion.css'

const KIND_ICON: Record<string, string> = {
  train: 'nav-skills',
  mining: 'nav-mine',
  scan: 'ico-scan',
  salvage: 'nav-salvage',
  manufacture: 'nav-industry',
  refine: 'nav-industry',
  expedition: 'nav-bounty',
  ai: 'nav-ai',
  return: 'nav-ship',
  transit: 'ico-home',
  loop: 'ico-loop',
  'invasion-loop': 'ico-loop',
  courier: 'nav-task',
  hauling: 'nav-haul',
  wormhole: 'nav-wormhole',
  whscan: 'nav-wormhole',
  whauto: 'nav-wormhole',
  lab: 'nav-industry',
}



export function ActivityBarClassic({
  engine,
  onToast,
  onAiCenter,
  onGoPage,
  onOpenWormhole,
}: {
  engine: GameEngine
  onToast: ToastFn
  onAiCenter?: () => void
  onGoPage?: (page: string, mapTab?: string, taskTab?: string) => void
  onOpenWormhole?: () => void
}) {
  const state = engine.state
  const all = activityOverview(state, engine.ctx).map(explorationActivityText)
  const aiShips = aiCoreShipUsed(state)
  const aiProd = aiCoreIndustryUsed(state)
  const aiSlotsNote = aiSlotTip(aiIndustrySlots(state, engine.ctx))
  const playerItems = all.filter((i) => i.kind !== 'ai' && i.kind !== 'train')
  const trainItems = all.filter((i) => i.kind === 'train')
  const aiLinesOf = (items: ActivityView[]): string => {
    if (items.length === 0) return tr("ui.ActivityBar.033")
    const lines = items.slice(0, 8).map((v) => {
      const tail =
        v.remainingMs !== null && v.remainingMs > 0
          ? ` · 剩 ${fmtDuration(v.remainingMs)}`
          : v.percent !== null
            ? ` · ${Math.round(v.percent)}%`
            : ''
      return `· ${v.label}——${v.sub}${tail}`
    })
    if (items.length > 8) lines.push(tr("ui.ActivityBar.051", { p1: items.length - 8 }))
    return lines.join('\n')
  }
  const aiShipItems = all.filter((i) => i.kind === 'ai' && i.aiGroup === 'ship')
  const aiProdItems = all.filter((i) => i.kind === 'ai' && i.aiGroup === 'industry')
  const scan = scanStatus(state)
  const scanAck = scanAwaitingView(state)
  const scanBar = scan.active
    ? { done: false, galaxyId: scan.galaxyId, percent: scan.percent, remainingMs: scan.remainingMs }
    : scanAck
      ? { done: true, galaxyId: scanAck.galaxyId, percent: 100, remainingMs: 0 }
      : null
  const scanName = (id: string | null): string => (id ? (engine.ctx.galaxies.get(id)?.name ?? id) : tr("ui.ActivityBar.015"))
  const [tuningTick, setTuningTick] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setTuningTick(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [])
  const promos = activePromos(tuningTick)
  const promoClaimedKeys = new Set<string>(promos.flatMap((p) => [...p.claims]))
  const tunings = activeTunings(tuningTick).filter((t) => !promoClaimedKeys.has(t.key))
  const [retreatAsk, setRetreatAsk] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const hasRetreatActivity = playerItems.some((i) => i.stop === 'retreat-battle')
  useEffect(() => {
    if (retreatAsk && !hasRetreatActivity) setRetreatAsk(false)
  }, [retreatAsk, hasRetreatActivity])
  const [haulAsk, setHaulAsk] = useState(false)
  const hasHaulActivity = playerItems.some((i) => i.stop === 'stop-hauling')
  useEffect(() => {
    if (haulAsk && !hasHaulActivity) setHaulAsk(false)
  }, [haulAsk, hasHaulActivity])

  const renderItem = (v: ActivityView) => {
    const target = goFor(v.kind)
    const handleItemClick = (): void => {
      if (v.kind === 'wormhole' && onOpenWormhole) {
        onOpenWormhole()
        return
      }
      if (onGoPage) onGoPage(target.page, target.mapTab, target.taskTab)
    }
    const goText = tr(target.labelId)
    return (
    <div
      key={v.id}
      className={`app-activitybar-item is-${v.kind}`}
      title={v.stopReason ?? tr("ui.ActivityBar.052", { goText: goText })}
      onClick={handleItemClick}
    >
      <span className="app-activitybar-icon"><Glyph name={KIND_ICON[v.kind] ?? 'fallback'} size={15} color={NAV_TONES[KIND_ICON[v.kind]] ?? ICO_TONES[KIND_ICON[v.kind]]} /></span>
      <div className="app-activitybar-main">
        <div className="app-activitybar-line">
          <span className={`app-activitybar-label${v.badge === 'invasion' ? ' is-invasion' : ''}`}>
            {v.badge === 'invasion' ? <span className="app-chip is-danger app-activitybar-badge">{tr('ui.invasionActivity.001')}</span> : null}
            <span>{v.label}</span>
          </span>
          <span className="app-dim app-activitybar-sub">{v.sub}</span>
          {v.percent !== null ? (
            <span className="app-activitybar-track">
              <span className="app-activitybar-fill" style={{ width: `${v.percent}%` }} />
            </span>
          ) : null}
          <span className="app-activitybar-time">
            {v.percent !== null ? `${Math.round(v.percent)}%` : ''}
            {v.remainingMs !== null && v.remainingMs > 0 ? v.badge === 'invasion'
              ? ` · ${tr('ui.boost.005', { p1: fmtDuration(v.remainingMs) })}`
              : ` · 剩 ${fmtDuration(v.remainingMs)}` : ''}
          </span>
        </div>
      </div>
      {v.stopable && v.stop ? (
        <button
          className="app-btn is-small is-warn"
          title={
            v.stop === 'cancel-manufacture'
              ? tr("ui.ActivityBar.017")
              : v.stop === 'stop-refine'
                ? tr("ui.ActivityBar.018")
                : v.stop === 'stop-lab'
                  ? tr("ui.ActivityBar.069")
                  : v.stop === 'recall-expedition'
                  ? tr("ui.ActivityBar.019")
                  : v.stop === 'cancel-deliver-trip'
                    ? tr("ui.ActivityBar.020")
                    : v.stop === 'stop-whscan'
                    ? tr("ui.ActivityBar.034")
                    : v.stop === 'stop-scan'
                    ? tr("ui.ActivityBar.021")
                    : v.stop === 'stop-salvage'
                      ? tr("ui.ActivityBar.035")
                      : v.stop === 'remove-training'
                        ? tr("ui.ActivityBar.022")
                        : v.stop === 'retreat-battle'
                          ? tr("ui.ActivityBar.023")
                          : undefined
          }
          onClick={(e) => {
            e.stopPropagation() // 点击"停止/移除/撤退"不触发行跳转
            /**
             * **长途运输：先警告、再确认**（船长 2026-09-20）——中断本趟 = 这一趟的报酬拿不到。
             * 与下面撤退那支同款两讨伐确认（第一次点只亮警告 + 提示，第二次点才执行）。
             */
            if (v.stop === 'stop-hauling') {
              if (!haulAsk) {
                setHaulAsk(true)
                onToast(tr('ui.Hauling.033'), true)
                return
              }
              setHaulAsk(false)
              doStop(v, engine, onToast)
              return
            }
            if (v.stop !== 'retreat-battle') {
              doStop(v, engine, onToast)
              return
            }
            if (!retreatAsk) {
              setRetreatAsk(true)
              onToast(tr("ui.ActivityBar.053"), true)
              return
            }
            setRetreatAsk(false)
            doStop(v, engine, onToast)
          }}
        >
          {v.stop === 'stop-hauling' && haulAsk
            ? tr('ui.Hauling.034')
            : v.stop === 'retreat-battle' && retreatAsk
              ? tr("ui.ActivityBar.024")
              : stopLabel(v)}
        </button>
      ) : null}
    </div>
    )
  }

  return (
    <div className={`app-activitybar${collapsed ? ' is-collapsed' : ''}`}>
      <div className="app-activitybar-hd">
        {/* 最小化 / 展开按钮：**标题行最左端**（船长 2026-10-02 补答："最小化按钮要放到最左侧"）。
            收起后这一行整行保留（标题 ＋ 两枚 AI 徽标 ＋ 星系扫描条 ＋ 限时加成全在这一行里），
            只是下面两组不再渲染。 */}
        <button
          className="app-activitybar-min"
          aria-expanded={!collapsed}
          title={collapsed ? tr('ui.ActivityBar.071') : tr('ui.ActivityBar.070')}
          onClick={() => setCollapsed((v) => !v)}
        >
          {/* 字形 = **SVG 线稿折叠/展开对**（`ui/Glyphs.tsx` 的 `ico-fold` / `ico-unfold`，
              2026-09-30 船长令为「面板正文收进标题栏」造的一对；工业 HUD 工位窗口同款用法 =
              **画动作**：折叠态显示"展开"）。2026-10-02 船长报障「按钮太小了」前这里是
              10.5px 的文本三角 `▾` / `▸`，几像素大 ⇒ 换成 14px 线稿（方块同批 18→24px，见样式）。 */}
          <Glyph name={collapsed ? 'ico-unfold' : 'ico-fold'} size={14} color="currentColor" />
        </button>
        <span className="app-activitybar-title">{tr("ui.ActivityBar.025")}</span>
        {/* AI 徽标（2026-09-10 船长：拆成两枚，图标 / 配色 / 去处各不相同）——
            ① 副船：AI 核心图标（粉）+「副船 ×N」，点进「舰船」的 AI 指挥中心；
            ② 工业：工业页图标（薄荷）+「工业 ×N」，点进「工业」页（AI 炉/线的停止在那儿）。
            计数为 0 的那一枚不显示（无事可看时不占位）。 */}
        {aiShips > 0 ? (
          <button
            className="app-activitybar-ai is-ship"
            title={tr("ui.ActivityBar.056", { aiShips: aiShips, p2: aiLinesOf(aiShipItems), aiSlotsNote: aiSlotsNote })}
            onClick={() => onAiCenter?.()}
          >
            <span className="app-ico">
              <Glyph name="nav-ai" size={13} color={NAV_TONES['nav-ai']} />
            </span>
            {tr("ui.ActivityBar.026")}{aiShips}
          </button>
        ) : null}
        {aiProd > 0 ? (
          <button
            className="app-activitybar-ai is-industry"
            title={tr("ui.ActivityBar.057", { aiProd: aiProd, p2: aiLinesOf(aiProdItems), aiSlotsNote: aiSlotsNote })}
            onClick={() => onGoPage?.('industry')}
          >
            <span className="app-ico">
              <Glyph name="nav-industry" size={13} color={NAV_TONES['nav-industry']} />
            </span>
            {tr("ui.ActivityBar.027")}{aiProd}
          </button>
        ) : null}
        {/* 星系扫描条（船长 2026-09-15）：摆在 AI 两枚徽标**右侧**；扫描不占主控 ⇒ 不列进「玩家活动」 */}
        {scanBar ? (
          <button
            className={`app-activitybar-scan${scanBar.done ? ' is-done' : ''}`}
            title={
              scanBar.done
                ? tr("ui.ActivityBar.055", { p1: scanName(scanBar.galaxyId) })
                : tr("ui.ActivityBar.058", { p1: scanName(scanBar.galaxyId), p2: fmtDuration(scanBar.remainingMs) })
            }
            onClick={() => {
              // 完成态点一下 = 看过（收条）；进行中点一下 = 纯跳转（星图页有「终止扫描」）
              if (scanBar.done && scanAck) engine.ackScanView()
              onGoPage?.('map', 'star')
            }}
          >
            <span className="app-ico">
              <Glyph name="ico-scan" size={13} color={ICO_TONES['ico-scan']} />
            </span>
            <span className="app-activitybar-scan-name">{scanName(scanBar.galaxyId)}</span>
            <span className="app-activitybar-track">
              <span className="app-activitybar-fill" style={{ width: `${Math.min(100, Math.max(0, scanBar.percent))}%` }} />
            </span>
            <span className="app-activitybar-scan-time">
              {scanBar.done ? tr("ui.ActivityBar.036") : `${Math.round(scanBar.percent)}%`}
            </span>
          </button>
        ) : null}
        {/* 突触加速剂生效中（**2026-09-30 船长令**「读数放进活动窗口、和 AI 核心一样用图标、图标带倍率」）：
            与扫描条同一套类名（不自造样式），不可点；倍率由 core 乘区反算 ⇒ 与引擎同源 */}
        {engine.synapticAccelerantRemainMs() > 0 ? (
          <span
            className="app-activitybar-scan"
            title={tr('ui.ActivityBar.067', { p1: fmtDuration(engine.synapticAccelerantRemainMs()) })}
          >
            <span className="app-ico">
              <Glyph name="ico-eff" size={13} color={ICO_TONES['ico-eff']} />
            </span>
            <span className="app-activitybar-scan-name">
              {tr('ui.ActivityBar.066', { p1: Math.round(1 / SYNAPTIC_ACCELERANT_MUL) })}
            </span>
            <span className="app-activitybar-scan-time">{fmtDuration(engine.synapticAccelerantRemainMs())}</span>
          </span>
        ) : null}
        {/* 限时活动（2026-09-16 促销）：与限时加成同一处、同一族样式 —— 游戏内说法 + 剩余时间；
            被它认领的倍率键已在上面从 `tunings` 里滤掉，同一件事只显示这一枚。
            点击去向由促销表的 `open` 决定（船长 2026-09-16：「点击后，不会跳转扫描虫洞界面」
            ⇒ 「虫洞大量生成」写到「扫描虫洞」选项卡；不写则与限时加成同款走「星图」）。
            时间列用**紧凑时长**（两级单位）：全量格式在 4 天档要 10 个汉字，会把标题挤成省略号。 */}
        {promos.map((p) => (
          <button
            key={`promo-${p.id}-${p.untilMs}`}
            className="app-activitybar-tuning app-activitybar-promo"
            title={
              `${p.label}${p.detail ? `\n${p.detail}` : ''}\n` +
              tr("ui.ActivityBar.054", { p1: fmtDate(p.untilMs - 1), p2: fmtDuration(Math.max(0, p.untilMs - tuningTick)) }) +
              tr("ui.ActivityBar.059", { p1: p.open === 'wormhole-scan' ? tr("ui.MapPage.007") : tr("ui.ActivityBar.006") })
            }
            onClick={() => {
              if (p.open === 'wormhole-scan') {
                onGoPage?.('map', 'whscan')
                return
              }
              onGoPage?.('map', 'star')
            }}
          >
            <span className="app-ico">
              <Glyph name="ico-scan" size={13} color={ICO_TONES['ico-scan']} />
            </span>
            <span className="app-activitybar-tuning-name">{p.label}</span>
            <span className="app-activitybar-tuning-time">{fmtDurationShort(Math.max(0, p.untilMs - tuningTick))}</span>
          </button>
        ))}
        {/* 限时加成（2026-09-15 船长）：摆在**扫描条右侧** —— 生效中的加成项 + 剩余时间；无加成不渲染 */}
        {tunings.map((t) => (
          <button
            key={`${t.key}-${t.untilMs}`}
            className="app-activitybar-tuning"
            title={
              tr("ui.ActivityBar.060", { p1: t.name, p2: t.mul, p3: t.note ? `\n${t.note}` : '' }) +
              tr("ui.ActivityBar.054", { p1: fmtDate(t.untilMs - 1), p2: fmtDuration(Math.max(0, t.untilMs - tuningTick)) })
            }
            onClick={() => onGoPage?.('map', 'star')}
          >
            <span className="app-ico">
              <Glyph name="ico-scan" size={13} color={ICO_TONES['ico-scan']} />
            </span>
            <span className="app-activitybar-tuning-name">
              {t.name} ×{t.mul}
            </span>
            {/* 时间列同样用紧凑时长：全量格式会把"名称 ×倍率"挤成省略号（见促销徽标同处注释） */}
            <span className="app-activitybar-tuning-time">{fmtDurationShort(Math.max(0, t.untilMs - tuningTick))}</span>
          </button>
        ))}
      </div>
      {collapsed ? null : (
        <>
          <div className="app-activitybar-group">
            <div className="app-activitybar-gtitle">{tr("ui.ActivityBar.028")}</div>
            {playerItems.length > 0 ? (
              playerItems.map(renderItem)
            ) : (
              <span className="app-activitybar-idle">{tr("ui.ActivityBar.029")}</span>
            )}
          </div>
          <div className="app-activitybar-group">
            <div className="app-activitybar-gtitle">{tr("ui.ActivityBar.030")}</div>
            {trainItems.length > 0 ? (
              trainItems.map(renderItem)
            ) : (
              <span className="app-activitybar-idle">{tr("ui.ActivityBar.037")}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
