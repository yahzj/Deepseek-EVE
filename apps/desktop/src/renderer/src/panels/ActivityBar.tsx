/**
 * T1 顶部活动窗口：常驻显示「玩家活动」与「技能训练」两个分区（各带待机文案），
 * 提供统一终止入口；AI 活动不逐条显示，用两枚小图标徽标（副船 / 工业，各自跳转）。
 * 布局：垂直排布，固定高度上限，内容多时内部滚动（船长 2026-09-05）。
 *
 * **星系扫描条**（船长 2026-09-15）：「玩家扫描星系将不再占用玩家的主控活动（也不显示在主控活动里，
 * 而是在 AI 活动的图标右侧显示一个进度条，当扫描完成后这个进度条依旧存在并高亮，直到玩家进入星图
 * 界面查看后才移除）」⇒ 扫描不再是"玩家活动"行，改为头部 AI 徽标右侧一条常驻进度条
 * （进行中 = 进度 + 剩余；完成待查看 = 满格金色高亮，进「星图」或点它即收）。
 */
import { activityOverview, activePromos, activeTunings, aiCoreIndustryUsed, aiCoreShipUsed, scanAwaitingView, scanStatus } from '@whale/core'
import type { ActivityView } from '@whale/core'
import { formatDurationMs, formatDurationShort } from '@whale/core'
import { useEffect, useState } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { Glyph, NAV_TONES, ICO_TONES } from '../ui/Glyphs'
import { aiIndustrySlots, aiSlotTip } from '../ui/aiSlots'
import { tr } from '../i18n/locale'

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
  courier: 'nav-task',
  hauling: 'nav-haul',
  // 虫洞探索（船长 2026-09-13「活动栏显示」）：图标 = 虫洞专属「空间裂隙」（同日船长定案），
  // 与星图·行动区的虫洞入口行同一枚，不再借 ico-flag / ico-scan
  wormhole: 'nav-wormhole',
  /** 主控活动「扫描虫洞」（2026-09-14）：与洞内活动同一个图标，色调用其自身色调 */
  whscan: 'nav-wormhole',
  whauto: 'nav-wormhole',
}

function stopLabel(v: ActivityView): string {
  switch (v.stop) {
    case 'remove-training':
      return tr("ui.ActivityBar.007")
    case 'stop-mining':
      return tr("ui.ActivityBar.005")
    case 'stop-scan':
      return tr("ui.ActivityBar.008")
    case 'stop-whscan':
      return tr("ui.ActivityBar.031")
    case 'stop-whauto':
      return tr("ui.ActivityBar.009")
    case 'stop-salvage':
      return tr("ui.ActivityBar.005")
    case 'cancel-manufacture':
      return tr("ui.ActivityBar.004")
    case 'stop-refine':
      return tr("ui.ActivityBar.010")
    case 'recall-expedition':
      return tr("ui.ActivityBar.009")
    case 'recall-standby':
      return tr("ui.ActivityBar.011")
    case 'retreat-battle':
      return tr("ui.ActivityBar.012")
    case 'cancel-ai':
      return tr("ui.ActivityBar.004")
    case 'cancel-deliver-trip':
      return tr("ui.ActivityBar.013")
    case 'stop-loop':
      return tr("ui.ActivityBar.032")
    case 'stop-hauling':
      return tr("ui.ActivityBar.014")
    default:
      return ''
  }
}

function doStop(v: ActivityView, engine: GameEngine, onToast: ToastFn): void {
  const run = (r: { ok: boolean; error?: string } | boolean, okText: string): void => {
    const ok = typeof r === 'boolean' ? r : r.ok
    if (!ok) onToast((typeof r === 'object' && r.error) || '操作失败。', true)
    else onToast(okText)
  }
  switch (v.stop) {
    case 'remove-training':
      run(engine.dequeueAt(0), tr("ui.ActivityBar.038"))
      break
    case 'stop-mining':
      run(engine.stopMiningNow(), tr("ui.MapPage.080"))
      break
    case 'stop-scan':
      run(engine.stopScanNow(), tr("ui.ActivityBar.039"))
      break
    case 'stop-whscan':
      run(engine.wormholeScanStop(), tr("ui.ActivityBar.040"))
      break
    case 'stop-whauto':
      if (v.stopParam) run(engine.wormholeAutoStop(v.stopParam), tr("ui.ActivityBar.041"))
      break
    case 'stop-salvage':
      run(engine.stopSalvageOpNow(), tr("ui.ActivityBar.042"))
      break
    case 'cancel-manufacture':
      if (v.stopParam) run(engine.cancelManufacturingAt(v.stopParam), tr("ui.ActivityBar.043"))
      break
    case 'stop-refine':
      if (v.stopParam) run(engine.stopRefineRunAt(v.stopParam), tr("ui.ActivityBar.044"))
      break
    case 'recall-expedition':
      run(engine.recallExpeditionNow(), tr("ui.ActivityBar.045"))
      break
    case 'recall-standby':
      run(engine.recallStandbyNow(), tr("ui.ActivityBar.046"))
      break
    case 'retreat-battle':
      run(engine.retreatNow(), tr("ui.ActivityBar.047"))
      break
    case 'cancel-ai':
      if (v.stopParam) run(engine.cancelAiTaskAt(v.stopParam), tr("ui.ShipPage.177"))
      break
    case 'cancel-deliver-trip':
      run(engine.cancelDeliverTripNow(), tr("ui.ActivityBar.048"))
      break
    case 'stop-loop':
      run(engine.bountyLoopAt(null), tr("ui.ActivityBar.049"))
      break
    case 'stop-hauling':
      run(engine.stopHaulingNow(), tr("ui.ActivityBar.050"))
      break
  }
}

/**
 * 活动项 → 跳转目标页面（可带星图二级标签）——船长 2026-09-05 点击跳转。
 *
 * ⚠️ 扩展约定（新增活动时务必同步）：以后若新增活动项目 / 新增页面，
 * 必须在本函数补充对应 `case`（kind → { page, mapTab? }），否则新活动点下去
 * 会回退到默认 `{ page: 'map' }`（星图页），跳转失效。
 * 映射关系建议遵循：采矿→星图·矿带开采；扫描/远征/返航/待命→星图·远征；
 * 制造/精炼→工业；训练→技能页。跳转实现经 App 传入的 onGoPage（setPage + setMapTab）。
 */
function goFor(kind: string): { page: string; mapTab?: string } {
  switch (kind) {
    case 'mining':
      return { page: 'map', mapTab: 'mine' }
    case 'scan':
    case 'salvage':
    case 'expedition':
    case 'return':
    case 'transit':
    case 'standby':
      return { page: 'map', mapTab: 'star' }
    case 'courier':
      return { page: 'map', mapTab: 'task' }
    case 'hauling':
      return { page: 'map', mapTab: 'haul' }
    case 'loop':
      return { page: 'map', mapTab: 'bounty' }
    // 虫洞探索（船长 2026-09-13「活动栏显示」）：跳到星图·星图页——虫洞入口行就在那一页的行动区
    case 'wormhole':
      return { page: 'map', mapTab: 'star' }
    case 'manufacture':
    case 'refine':
      return { page: 'industry' }
    case 'train':
      return { page: 'skills' }
    default:
      return { page: 'map' }
  }
}

export function ActivityBar({
  engine,
  onToast,
  onAiCenter,
  onGoPage,
  onOpenWormhole,
}: {
  engine: GameEngine
  onToast: ToastFn
  onAiCenter?: () => void
  onGoPage?: (page: string, mapTab?: string) => void
  /**
   * **虫洞那条直接开面板**（船长 2026-09-13：「活动栏直接开面板」）：
   * 光跳星图页不够——星图要**先选中一个星系**才渲染「前往星系 · 行动」区，
   * 而人已经进洞时星图默认没有选中星系 ⇒ 那一行里的「进入虫洞」可能根本不出现。
   */
  onOpenWormhole?: () => void
}) {
  const state = engine.state
  const all = activityOverview(state, engine.ctx)
  // 船长 2026-09-05：活动窗口垂直排布；「玩家活动」「技能训练」两个常驻分区，各自待机文案；AI 用徽标
  // 2026-09-08：AI 徽标计数 = AI 副船 + AI 核心驱动的生产线/精炼炉（后者不再占用"玩家活动"行）
  // 2026-09-10 船长：徽标**拆成两枚**——「副船」与「工业」各一枚（图标与配色不同，便于辨识）；
  //   数字取 core 单点（与 AI 指挥中心标题行同源），不再从活动列表反推
  const aiShips = aiCoreShipUsed(state)
  const aiProd = aiCoreIndustryUsed(state)
  /** AI 核心占用说明（与 AI 指挥中心/工业页同源的单点文案，挂在两枚徽标的悬停里） */
  const aiSlotsNote = aiSlotTip(aiIndustrySlots(state, engine.ctx))
  const playerItems = all.filter((i) => i.kind !== 'ai' && i.kind !== 'train')
  const trainItems = all.filter((i) => i.kind === 'train')
  /**
   * **AI 正在干哪些活动**（船长 2026-09-13：「活动界面AI图标的鼠标悬浮提示改为显示AI正在干哪些活动」）：
   * 原先两枚徽标的悬停只写死一句"正在执行采矿 / 打捞 / 掩护巡逻"——玩家看不到**具体在干什么**。
   * 现在直接取 `activityOverview` 里 `kind==='ai'` 的条目（core 已按 `aiGroup` 分好副船 / 工业两组）：
   * 一条一行「· 谁 · 干什么——在哪/什么阶段（还剩多久）」，超过 8 条折成"另有 N 条"。
   * ⚠ 只改悬停文案：**徽标计数、点击去处、渲染结构一律不动**。
   */
  const aiLinesOf = (items: ActivityView[]): string => {
    if (items.length === 0) return tr("ui.ActivityBar.033")
    const lines = items.slice(0, 8).map((v) => {
      const tail =
        v.remainingMs !== null && v.remainingMs > 0
          ? ` · 剩 ${formatDurationMs(v.remainingMs)}`
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
  /**
   * 星系扫描条读数（见文件头注释）：**进行中优先**——正在扫就显示这条扫描的进度；
   * 扫完（且玩家还没看过）才显示"已完成"高亮格。两条都靠 core 单点：
   * `scanStatus`（进行中）/ `scanAwaitingView`（完成待查看）。
   */
  const scan = scanStatus(state)
  const scanAck = scanAwaitingView(state)
  const scanBar = scan.active
    ? { done: false, galaxyId: scan.galaxyId, percent: scan.percent, remainingMs: scan.remainingMs }
    : scanAck
      ? { done: true, galaxyId: scanAck.galaxyId, percent: 100, remainingMs: 0 }
      : null
  const scanName = (id: string | null): string => (id ? (engine.ctx.galaxies.get(id)?.name ?? id) : tr("ui.ActivityBar.015"))
  /**
   * **限时加成徽标**（2026-09-15 船长：「同时拥有限时加成时，还会在活动无人机的右侧
   * （扫描进度条的右侧）显示当前加成项是什么和剩余时间」）。
   *
   * 口径：数据表 `TUNING_RULES`（`packages/core/src/tuning.ts`）× **现实墙钟**；到期自动消失。
   * 剩余时间按**本地日界**算（规则以"当天整天生效"为准）⇒ 这里显示"还剩 N 天 N 小时"。
   * 无加成时**不渲染**（不占位、防头部跳动）。
   *
   * **2026-09-16 促销合并**（船长：「5和虫洞限时缩短写在一起，但是要润色成虫洞大量生成之类的」）：
   * `PROMOS` 里的一条促销（扫描倍率 ＋ 一次性赠送）在这里显示成**一枚**徽标（游戏内说法 + 剩余时间），
   * 被它 `claims` 认领的倍率键（如 `wormholeScanMs`）**不再单列** —— 同一件事不显示两遍。
   */
  const [tuningTick, setTuningTick] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setTuningTick(Date.now()), 60_000) // 每分钟刷新剩余时间
    return () => window.clearInterval(t)
  }, [])
  const promos = activePromos(tuningTick)
  const promoClaimedKeys = new Set<string>(promos.flatMap((p) => [...p.claims]))
  const tunings = activeTunings(tuningTick).filter((t) => !promoClaimedKeys.has(t.key))
  // 撤退需二次确认（轻损但有代价）。
  // 2026-09-11 修复（真 BUG：点「开始教程」后白屏，React #185「Maximum update depth exceeded」）：
  // 原先写成**渲染期派生状态**（`if (retreatAsk && !playerItems.some(...)) setRetreatAsk(false)`）——
  // React 只允许"该组件自己触发的、立即收敛的"渲染期更新；撤退活动消失（如委派 AI 后）时这里每次渲染都会
  // 调一次 setState，生产版在同一提交里累积到阈值就把整棵树卸载（白屏）。搬到 effect：**提交后清理**，语义相同、不参与渲染。
  const [retreatAsk, setRetreatAsk] = useState(false)
  const hasRetreatActivity = playerItems.some((i) => i.stop === 'retreat-battle')
  useEffect(() => {
    if (retreatAsk && !hasRetreatActivity) setRetreatAsk(false)
  }, [retreatAsk, hasRetreatActivity])

  const renderItem = (v: ActivityView) => {
    const target = goFor(v.kind)
    const handleItemClick = (): void => {
      // 虫洞走"直接开面板"那条（见 props 注释）；其余照旧跳页
      if (v.kind === 'wormhole' && onOpenWormhole) {
        onOpenWormhole()
        return
      }
      if (onGoPage) onGoPage(target.page, target.mapTab)
    }
    const goText =
      target.page === 'map'
        ? target.mapTab === 'mine'
          ? tr("ui.MapPage.003")
          : target.mapTab === 'bounty'
            ? tr("ui.ActivityBar.016")
            : target.mapTab === 'task'
              ? tr("ui.App.008")
              : tr("ui.MapPage.002")
        : target.page === 'industry'
          ? tr("ui.App.006")
          : tr("ui.App.007")
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
          <span className="app-activitybar-label">{v.label}</span>
          <span className="app-dim app-activitybar-sub">{v.sub}</span>
          {v.percent !== null ? (
            <span className="app-activitybar-track">
              <span className="app-activitybar-fill" style={{ width: `${v.percent}%` }} />
            </span>
          ) : null}
          <span className="app-activitybar-time">
            {v.percent !== null ? `${Math.round(v.percent)}%` : ''}
            {v.remainingMs !== null && v.remainingMs > 0 ? ` · 剩 ${formatDurationMs(v.remainingMs)}` : ''}
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
          {v.stop === 'retreat-battle' && retreatAsk ? tr("ui.ActivityBar.024") : stopLabel(v)}
        </button>
      ) : null}
    </div>
    )
  }

  return (
    <div className="app-activitybar">
      <div className="app-activitybar-hd">
        <span className="app-activitybar-title">{tr("ui.ActivityBar.025")}</span>
        {/* AI 徽标（2026-09-10 船长：拆成两枚，图标 / 配色 / 去处各不相同）——
            ① 副船：AI 核心图标（粉）+「副船 ×N」，点进「舰船」的 AI 指挥中心；
            ② 工业：工业页图标（薄荷）+「工业 ×N」，点进「工业」页（AI 炉/线的停止在那儿）。
            计数为 0 的那一枚不显示（无事可看时不占位）。 */}
        {aiShips > 0 ? (
          <button
            className="app-activitybar-ai is-ship"
            title={`AI 副船 ${aiShips} 艘——正在执行的活动：\n${aiLinesOf(aiShipItems)}\n${aiSlotsNote}\n点击前往「舰船」的 AI 指挥中心`}
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
            title={`站内 AI 作业 ${aiProd} 条——正在执行的活动：\n${aiLinesOf(aiProdItems)}\n${aiSlotsNote}\n点击前往「工业」页查看或停止`}
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
                ? `扫描完成：「${scanName(scanBar.galaxyId)}」的情报已录入星图——进「星图」看过之后这条才收起。\n点击查看（顺带进「星图」页）`
                : `扫描艇正在扫描「${scanName(scanBar.galaxyId)}」 · 剩 ${formatDurationMs(scanBar.remainingMs)}\n扫描不占主控：期间照常安排别的活动。点击前往「星图」页（可在那儿终止扫描，已扫部分会保留）`
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
              tr("ui.ActivityBar.054", { p1: new Date(p.untilMs - 1).toLocaleDateString('zh-CN'), p2: formatDurationMs(Math.max(0, p.untilMs - tuningTick)) }) +
              `\n点击前往「${p.open === 'wormhole-scan' ? tr("ui.MapPage.007") : tr("ui.ActivityBar.006")}」页`
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
            <span className="app-activitybar-tuning-time">{formatDurationShort(Math.max(0, p.untilMs - tuningTick))}</span>
          </button>
        ))}
        {/* 限时加成（2026-09-15 船长）：摆在**扫描条右侧** —— 生效中的加成项 + 剩余时间；无加成不渲染 */}
        {tunings.map((t) => (
          <button
            key={`${t.key}-${t.untilMs}`}
            className="app-activitybar-tuning"
            title={
              `${t.name}：本期限时加成 ×${t.mul}${t.note ? `\n${t.note}` : ''}\n` +
              tr("ui.ActivityBar.054", { p1: new Date(t.untilMs - 1).toLocaleDateString('zh-CN'), p2: formatDurationMs(Math.max(0, t.untilMs - tuningTick)) })
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
            <span className="app-activitybar-tuning-time">{formatDurationShort(Math.max(0, t.untilMs - tuningTick))}</span>
          </button>
        ))}
      </div>
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
    </div>
  )
}
