/**
 * **「扫描虫洞」页**（2026-09-14 船长：「将扫描虫洞放入出港界面的选项卡内。新增主控活动：'扫描虫洞'。
 * 玩家需要在扫描虫洞界面内开始。…进度条满后。玩家就可以发现一个虫洞。玩家最多可以囤积5个未开始探索的虫洞。」）。
 *
 * 口径（design §三/§五/§六 已确认）：
 * - **主控活动**：开始/停止都只在本页（进度保留，停扫不清零）；与采矿/打捞/远征等互斥；
 * - **窗口 = 12 小时 × 三技能乘算 × 星际奇遇学**（信号分析学/星图测绘学/信号过滤学，与星图扫描同源；
 *   再乘一项虫洞专属的**星际奇遇学**（**每级 −4%、满级 −20%**；2026-09-17 船长由阶跃改线性）；不吃舰船属性）；
 * - 进度满 ⇒ 发现一处虫洞进库存（**上限 5**，满了**停机并提示**）；
 * - 库存每处带**种子 + 内容原型 + 敌族**（起始层**恒 1**：船长 2026-09-14「所有虫洞都是从1层开始探索」）；
 *   卡片只显示「**原型名，发现于 X月X日**」（船长 2026-09-14）；「探索这一处」⇒ 打开准备页选编队进洞（**消耗**该处）；
 * - **自动探索**（批次 3 · 船长逐条定案）：每处一个「自动探索」——自动配置最多 4 条非主控船（每条占 1 枚
 *   AI 核心，可手动改）、**5 分钟**、完成后停止；产出 = **手动一趟期望 × 40%**（**直入仓库**、不保底）；
 *   参与舰**结构/装甲各受损 −40%~−80%** 但**绝不丢船**、任务期间锁定；
 * - **结算**：日志 ＋ 一份**需要确认的报告**（就在本页列出：收益清单 + 损伤读数）——船长允许本页出现"虫洞"字样；
 * - **入口（2026-09-14 上线后）**：本选项卡在星图**常显**（不再依赖调试开关）；未达声望门槛时页内写明还差多少。
 */
import { useEffect, useState } from 'react'
import { Panel } from '@whale/ui'
import { Glyph, ICO_TONES } from '../ui/Glyphs'
import { formatDurationMs } from '@whale/core'
import {
  WORMHOLE_AUTO_DURATION_MS,
  WORMHOLE_AUTO_MAX_SHIPS,
  WORMHOLE_SCAN_BASE_MS,
  WORMHOLE_SCAN_UNLOCK_STANDING,
  wormholeStockMaxOf,
  aiCoreName,
  // 子页「谜质科技」的读数（标题行右侧 + 面板内都要用）
  matterTechEssenceHeld,
} from '@whale/core'
import type { GameState, WormholeArchetype, WormholeFamily } from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { HintIcon } from '../ui/Hint'
// ⚠ 原型名走本地化单点（2026-09-26 乙批）——core 的 `WORMHOLE_ARCHETYPE_LABELS` 是纯中文表
import { archetypeText } from '../ui/labelsText'
import { MatterTechTab } from './MatterTechTab'
import { wormholeIntelLine, wormholeIntelTip } from '../ui/wormholeIntel'
import { tr, cmdText } from '../i18n/locale'

/**
 * **「发现于 9月14日」**（船长 2026-09-14：卡片上不要相对时间，要日期）。
 *
 * 口径：发现时刻 = **开局墙钟**（`character.startedAtWallMs`，建档那一刻）+ **游戏内已过时间**
 * （`foundAtGameMs`；游戏时间与墙钟同速，离线结算也算进 `gameMs`）⇒ 得到玩家真实日历上的月/日。
 * 显示成绝对日期 ⇒ **不再每秒跳动**（旧文案「57秒前」会一直变）。
 */
function foundDateLabel(state: GameState, foundAtGameMs: number): string {
  const d = new Date((state.character?.startedAtWallMs ?? 0) + Math.max(0, foundAtGameMs))
  return tr("ui.WormholeScan.044", { p1: d.getMonth() + 1, p2: d.getDate() })
}

/** 库存项的**标准一行**（卡片与放弃弹窗共用同一口径）：族徽 + 「原型名，发现于 X月X日」 */
function stockLineOf(
  state: GameState,
  item: { family: WormholeFamily; archetype: WormholeArchetype; foundAtGameMs: number },
): { glyph: string; text: string } {
  const glyph = `fam-${item.family.toLowerCase()}`
  return { glyph, text: tr("ui.WormholeScan.045", { p1: archetypeText(item.archetype), p2: foundDateLabel(state, item.foundAtGameMs) }) }
}

export function WormholeScanTab({
  engine,
  onToast,
  onExplore,
  onAutoExplore,
  onReturn,
}: {
  engine: GameEngine
  onToast: ToastFn
  onExplore: (stockId: string) => void
  /** 「自动探索」⇒ 打开**与主控探索同一个准备页**（`WormholePanel` 的自动模式；船长 2026-09-14） */
  onAutoExplore: (stockId: string) => void
  /**
   * **返回虫洞**（船长 2026-09-14：「建议在扫描虫洞内额外给玩家一个返回虫洞的按钮」）：
   * 手上有一趟探索（临时离开中）时，本页给一个直达入口 —— 与活动栏那条走同一个 `openWormhole()`。
   */
  onReturn?: () => void
}) {
  const state = engine.state
  /** 每秒重算一次读数（进度条/剩余时间跟手；引擎本身按拍推进） */
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  /** 正在确认「放弃」的那一处（null = 没在确认） */
  const [discardAsk, setDiscardAsk] = useState<string | null>(null)
  const scan = state.wormholeScan ?? { active: false, progressMs: 0 }
  const stock = engine.wormholeStock()
  const runs = engine.wormholeAutoRuns()
  const reports = engine.wormholeAutoReports()
  const pending = engine.wormholeAutoPending()
  const windowMs = engine.wormholeScanWindow()
  const done = Math.min(windowMs, scan.progressMs)
  const percent = Math.max(0, Math.min(100, Math.round((done / windowMs) * 100)))
  const blocked = engine.wormholeScanBlockReason()
  /** **当前保存上限**（2026-09-16 船长改判「星图记录学，应该为每级+2，满级+10」⇒ 基础 5 ＋ 每级 2 ⇒ 满级 15） */
  const stockMax = wormholeStockMaxOf(state)
  const full = stock.length >= stockMax
  /** 手上那趟探索（非空 = 人在洞里 / 临时离开中）；「返回虫洞」按钮与"扫描被挡"的说明都用它 */
  const run = state.wormhole.run
  /** 解锁门槛（船长 2026-09-14：需要协会声望 40；解锁时会收到一封通讯 + 直接弹窗） */
  const unlocked = engine.wormholeScanUnlocked()
  const standing = engine.wormholeScanStanding()
  /**
   * **两个子页**（船长 2026-09-19：「将现有的扫描虫洞分出 2 个子页面：虫洞探索和谜质科技」）：
   * `explore` = 原页面一字不动；`matter` = 谜质科技树（`MatterTechTab`）。
   * 子页切换**不落档**（会话内存；默认进「虫洞探索」= 老行为）。
   */
  const [sec, setSec] = useState<'explore' | 'matter'>('explore')
  /** 谜质读数（子页标题行右侧换口径用） */
  const essence = matterTechEssenceHeld(state)

  return (
    <Panel
      className="is-fill win-fixed-body"
      title={tr("ui.MapPage.007")}
      /* 常驻说明进标题后的 ⓘ（2026-09-14 船长：「和外面的其他页面一样，添加圆形感叹号用于进行说明」；
         与同页「残骸打捞」的写法一致，原先那行可见的 `.app-note` 收进提示、不再占版面） */
      hint={
        <HintIcon
          tip={tr("ui.WormholeScan.046", { p1: formatDurationMs(WORMHOLE_SCAN_BASE_MS), stockMax: stockMax })}
        />
      }
      right={
        sec === 'matter' ? (
          <span className="app-dim">
            {tr("ui.MatterTechTab.005")} {essence.toLocaleString('zh-CN')} {tr("ui.WormholeScan.001")}
          </span>
        ) : (
          <span className="app-dim">
            {tr("ui.WormholeScan.002")} {tr("ui.WormholeScan.064", { p1: `${stock.length}/${stockMax}` })}
            {runs.length > 0 ? ` ${tr("ui.WormholeScan.068", { p1: runs.length })}` : ''}
            {pending > 0 ? ` · 待确认报告 ${pending} 份` : ''}{tr('ui.WormholeScan.056', { d: formatDurationMs(windowMs) })}
          </span>
        )
      }
    >
      <div className="app-win-body">
        {/* **子页标签**（船长 2026-09-19）：虫洞探索（现有内容）/ 谜质科技（研究树）——
            与「工业」「物品」两页同一套 app-subtabs 写法。 */}
        <div className="app-subtabs" role="tablist">
          <button
            role="tab"
            aria-selected={sec === 'explore'}
            className={`app-subtab${sec === 'explore' ? ' is-active' : ''}`}
            onClick={() => setSec('explore')}
          >
            {tr("ui.MatterTechTab.001")}
          </button>
          <button
            role="tab"
            aria-selected={sec === 'matter'}
            className={`app-subtab${sec === 'matter' ? ' is-active' : ''}`}
            title={tr("ui.WormholeScan.003")}
            onClick={() => setSec('matter')}
          >
            {tr("ui.WormholeScan.004")}
          </button>
        </div>
        {sec === 'matter' ? <MatterTechTab engine={engine} onToast={onToast} /> : null}
        {/* ───── 以下 = 「虫洞探索」子页（原页面内容，一字未动） ───── */}
        <div className={`app-subpage${sec === 'explore' ? '' : ' is-hidden'}`}>
        {!unlocked ? (
          <div className="app-wh-scanbar">
            <div className="app-wh-scanbar-label">
              <span className="app-wh-hold-warn">
                {tr("ui.WormholeScan.005")} {WORMHOLE_SCAN_UNLOCK_STANDING}{tr("ui.WormholeScan.006")} {standing}）
              </span>
            </div>
            <div className="app-dim">
              {tr("ui.WormholeScan.007")}
            </div>
          </div>
        ) : null}

        <div className="app-wh-scanbar">
          <div className="app-wh-scanbar-label">
            {tr("ui.WormholeScan.008")} <b>{percent}%</b>
            <span className="app-dim">
              {' '}
              {tr('ui.WormholeScan.057', { a: formatDurationMs(done), b: formatDurationMs(windowMs) })}
              {scan.active ? ` · 还需 ${formatDurationMs(Math.max(0, windowMs - done))}` : ''}
            </span>
          </div>
          <div className="app-wh-scanbar-track">
            <div className="app-wh-scanbar-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="app-wh-scanbar-actions">
            {scan.active ? (
              <button
                className="app-btn is-small"
                onClick={() => {
                  const r = engine.wormholeScanStop()
                  if (!r.ok) onToast(cmdText(r) || tr('ui.WormholeScan.059'), true)
                  else onToast(tr("ui.WormholeScan.047"))
                }}
              >
                {tr("ui.WormholeScan.009")}
              </button>
            ) : (
              <button
                className="app-btn is-small is-primary"
                disabled={blocked !== null}
                title={blocked ?? tr("ui.WormholeScan.010")}
                onClick={() => {
                  const r = engine.wormholeScanStart()
                  if (!r.ok) onToast(cmdText(r) || tr('ui.WormholeScan.060'), true)
                  else onToast(tr("ui.WormholeScan.048"))
                }}
              >
                {tr("ui.WormholeScan.011")}
              </button>
            )}
            {full ? <span className="app-wh-hold-warn">{tr("ui.WormholeScan.012")}</span> : null}
          </div>
          {blocked !== null && !scan.active ? <div className="app-dim">{blocked}</div> : null}
        </div>

        {/**
         * **有一趟探索在洞里 ⇒ 给一个「返回虫洞」按钮**（船长 2026-09-14：「建议在扫描虫洞内
         * 额外给玩家一个返回虫洞的按钮」）。为什么放在本页：人在洞里时**扫描是被挡的**
         * （`wormholeScanBlockReason` 的「已经在虫洞里了」），玩家落到本页多半就是想回洞
         * ⇒ 把出口摆在挡住他的那句话旁边。样式复用同页未解锁横幅那条 `.app-wh-scanbar`。
         */}
        {run ? (
          <div className="app-wh-scanbar">
            <div className="app-wh-scanbar-label">
              <span className="app-wh-hold-warn">{tr("ui.WormholeScan.013")}</span>
            </div>
            <div className="app-wh-scanbar-actions">
              <button
                className="app-btn is-small is-primary"
                disabled={!onReturn}
                title={tr("ui.WormholeScan.014")}
                onClick={() => onReturn?.()}
              >
                {tr("ui.WormholeScan.015")}
              </button>
            </div>
          </div>
        ) : null}

        {/* 船长 2026-09-14：标题里要显示**最多能保留多少** ⇒ 写成 `X/Y 处`（Y 随「星图记录学」满级变化） */}
        <div className="app-bay-title">{tr("ui.WormholeScan.016")} {tr("ui.WormholeScan.064", { p1: `${stock.length}/${stockMax}` })}</div>
        {stock.length === 0 ? (
          <div className="app-dim app-inv-empty">{tr("ui.WormholeScan.017")}</div>
        ) : (
          <ul className="app-inv-list">
            {stock.map((item) => {
              const line = stockLineOf(state, item)
              const famName = engine.wormholeFamilyName(item.family)
              const archName = archetypeText(item.archetype)
              return (
                <li key={item.id} className="app-inv-row">
                  <div className="app-inv-main">
                    <span className="app-inv-name">
                      <span className="app-ico">
                        <Glyph name={line.glyph} size={14} color={ICO_TONES[line.glyph]} />
                      </span>
                      {tr("ui.Expedition.005")}
                    </span>
                    {/**
                     * 卡片只留「**原型名，发现于 X月X日**」（船长 2026-09-14：「只需要显示'遗迹密集，
                     * 发现于XX月XX日'」）——族名/深度说明/相对时间一律撤下，完整口径进悬停。
                     */}
                    <span
                      className="app-inv-count"
                      title={
                        wormholeIntelTip(engine, item.family, archName) +
                        tr("ui.WormholeScan.049", { famName: famName })
                      }
                    >
                      {line.text}
                    </span>
                    {/**
                     * **敌情一行**（船长 2026-09-16：「给虫洞卡片添加更多信息（虫洞内是什么敌人，
                     * 以什么类型伤害为主）」）：一句话 = 浅层卡名（族名）+ 主系；三档构成进悬停。
                     * 与 2026-09-14「卡片只显示原型名+发现日期」不冲突——那一条说的是**第二行**的内容，
                     * 本行是**新增的第三行**（`.app-inv-main` 是纵向 flex ⇒ 自然换行，无需改样式）。
                     */}
                    <span className="app-inv-count" title={wormholeIntelTip(engine, item.family, archName)}>
                      {wormholeIntelLine(engine, item.family)}
                    </span>
                  </div>
                  <div className="app-inv-btns">
                    <button className="app-btn is-small is-primary" onClick={() => onExplore(item.id)}>
                      {tr("ui.WormholeScan.018")}
                    </button>
                    <button
                      className="app-btn is-small"
                      disabled={runs.some((r) => r.stockId === item.id)}
                      title={
                        runs.some((r) => r.stockId === item.id)
                          ? tr("ui.WormholeScan.019")
                          : tr("ui.WormholeScan.050", { WORMHOLE_AUTO_MAX_SHIPS: WORMHOLE_AUTO_MAX_SHIPS, p2: Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000) })
                      }
                      onClick={() => onAutoExplore(item.id)}
                    >
                      {tr("ui.Wormhole.002")}
                    </button>
                    <button
                      className="app-btn is-small is-warn"
                      disabled={runs.some((r) => r.stockId === item.id)}
                      title={
                        runs.some((r) => r.stockId === item.id)
                          ? tr("ui.WormholeScan.020")
                          : tr("ui.WormholeScan.021")
                      }
                      onClick={() => setDiscardAsk(item.id)}
                    >
                      {tr("ui.Expedition.006")}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {/**
         * **放弃确认走弹窗**（船长 2026-09-14：「**放弃虫洞的警告改用弹窗形式。**」）——
         * 与站内其它确认弹窗同一套结构（`.app-modal-mask` / `.app-modal` / `.app-modal-head` /
         * `.app-modal-body`，对齐「存档管理」那种写法）：点遮罩或「✕ 关闭」都等于先留着，
         * 只有点红色的「确认放弃」才真的放弃（一次一处、说明不可恢复）。
         */}
        {discardAsk !== null
          ? (() => {
              const item = stock.find((x) => x.id === discardAsk)
              if (!item) return null
              const line = stockLineOf(state, item)
              return (
                <div className="app-modal-mask" onClick={() => setDiscardAsk(null)}>
                  <div className="app-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="app-modal-head">
                      <span className="app-report-title">{tr("ui.WormholeScan.022")}</span>
                      <button className="app-btn is-small" onClick={() => setDiscardAsk(null)}>
                        {tr("ui.App.086")}
                      </button>
                    </div>
                    <div className="app-modal-body">
                      <div className="app-inv-name">
                        <span className="app-ico">
                          <Glyph name={line.glyph} size={14} color={ICO_TONES[line.glyph]} />
                        </span>
                        {line.text}
                      </div>
                      <div className="app-dim" style={{ marginTop: 'var(--wui-sp-6)' }}>
                        {tr("ui.WormholeScan.023")}<b>{tr("ui.WormholeScan.024")}</b>{tr('ui.WormholeScan.058')}
                      </div>
                      <div className="app-wh-scanbar-actions" style={{ marginTop: 'var(--wui-sp-10)' }}>
                        <button
                          className="app-btn is-small is-warn"
                          onClick={() => {
                            const r = engine.wormholeStockDiscard(item.id)
                            if (!r.ok) onToast(cmdText(r) || tr('ui.WormholeScan.061'), true)
                            else onToast(tr("ui.WormholeScan.051"))
                            setDiscardAsk(null)
                          }}
                        >
                          {tr("ui.WormholeScan.025")}
                        </button>
                        <button className="app-btn is-small" onClick={() => setDiscardAsk(null)}>
                          {tr("ui.WormholeScan.026")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()
          : null}

        {/**
         * 自动探索的编队选择**不再在本页就地勾选**（船长 2026-09-14：「自动探索采取和我们主控探索
         * 相同的准备界面。」）——库存格的「自动探索」直接打开虫洞面板的**准备页**（`WormholePanel`
         * 的 `autoStockId` 模式），那边与手动进洞共用同一套搜索/筛选/舰船卡片/读数结构。
         */}

        {runs.length > 0 ? (
          <>
            <div className="app-bay-title">{tr("ui.WormholeScan.027")} {tr("ui.WormholeScan.065", { p1: runs.length })}</div>
            <ul className="app-inv-list">
              {runs.map((run) => {
                const span = Math.max(1, run.finishAtGameMs - run.startedAtGameMs)
                const prog = Math.max(0, Math.min(100, Math.round(((state.gameMs - run.startedAtGameMs) / span) * 100)))
                return (
                  <li key={run.id} className="app-inv-row">
                    <div className="app-inv-main">
                      <span className="app-inv-name">{tr("ui.WormholeScan.028")}</span>
                      <span className="app-inv-count">
                        {run.shipIds.length} {tr("ui.WormholeScan.029")}{' '}
                        {formatDurationMs(Math.max(0, run.finishAtGameMs - state.gameMs))}
                      </span>
                    </div>
                    <div className="app-inv-btns">
                      <span className="app-dim">{prog}%</span>
                      <button
                        className="app-btn is-small is-warn"
                        title={tr("ui.WormholeScan.030")}
                        onClick={() => {
                          const r = engine.wormholeAutoStop(run.id)
                          if (!r.ok) onToast(cmdText(r) || tr('ui.WormholeScan.062'), true)
                          else onToast(tr("ui.WormholeScan.052"))
                        }}
                      >
                        {tr("ui.ActivityBar.009")}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        ) : null}

        {reports.length > 0 ? (
          <>
            <div className="app-bay-title">
              {tr("ui.WormholeScan.031")} {tr("ui.WormholeScan.066", { p1: reports.length })}{pending > 0 ? tr("ui.WormholeScan.053", { pending: pending }) : ''}
            </div>
            {pending > 1 ? (
              <div className="app-wh-scanbar-actions">
                <button
                  className="app-btn is-small"
                  onClick={() => {
                    const n = engine.wormholeAutoConfirmAll()
                    onToast(n > 0 ? tr("ui.WormholeScan.054", { n: n }) : tr("ui.WormholeScan.032"))
                  }}
                >
                  {tr("ui.WormholeScan.033")}
                </button>
              </div>
            ) : null}
            <ul className="app-inv-list">
              {reports.map((rep) => (
                <li key={rep.id} className="app-inv-row">
                  <div className="app-inv-main">
                    <span className="app-inv-name">
                      {tr("ui.WormholeScan.034")} {rep.confirmed ? tr("ui.WormholeScan.035") : tr("ui.WormholeScan.036")}
                    </span>
                    <span className="app-inv-count">
                      {tr("ui.WormholeScan.037")}
                      {rep.gains.length > 0
                        ? rep.gains.map((g) => `${engine.ctx.items.get(g.itemId)?.name ?? g.itemId} ×${g.units}`).join(tr("ui.MatterTechTab.017"))
                        : tr("ui.WormholeScan.038")}
                    </span>
                    {/* AI 核心（2026-09-14）：**不进仓库**（直接进核心库）⇒ 与「收益」分行单列，别混在一起 */}
                    {rep.cores && rep.cores.length > 0 ? (
                      <span className="app-inv-count">
                        {tr("ui.WormholeScan.039")}
                        {rep.cores.map((c) => `${aiCoreName(c.type)} ×${c.n}`).join(tr("ui.MatterTechTab.017"))}
                        {tr("ui.WormholeScan.040")}
                      </span>
                    ) : null}
                    <span className="app-inv-count">
                      {tr("ui.WormholeScan.041")}
                      {rep.damage.length > 0
                        ? rep.damage
                            .map(
                              (d) =>
                                tr("ui.WormholeScan.055", { p1: d.name, p2: d.durabilityLossPct, p3: d.durabilityPct, p4: d.armorLossPct, p5: d.armorPct }),
                            )
                            .join('；')
                        : tr("ui.BattleScreen.001")}
                    </span>
                    <span className="app-inv-count">
                      {rep.shipIds.length} {tr("ui.WormholeScan.042")} {rep.coresReleased} {tr("ui.WormholeScan.043")}{' '}
                      {tr("ui.WormholeScan.067", { p1: formatDurationMs(Math.max(0, state.gameMs - rep.finishedAtGameMs)) })}
                    </span>
                  </div>
                  <div className="app-inv-btns">
                    {rep.confirmed ? null : (
                      <button
                        className="app-btn is-small is-primary"
                        onClick={() => {
                          const r = engine.wormholeAutoConfirm(rep.id)
                          if (!r.ok) onToast(cmdText(r) || tr('ui.WormholeScan.063'), true)
                        }}
                      >
                        {tr("ui.Handbook.014")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        </div>
      </div>
    </Panel>
  )
}
