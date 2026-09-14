/**
 * **「扫描虫洞」页**（2026-09-14 船长：「将扫描虫洞放入出港界面的选项卡内。新增主控活动：'扫描虫洞'。
 * 玩家需要在扫描虫洞界面内开始。…进度条满后。玩家就可以发现一个虫洞。玩家最多可以囤积5个未开始探索的虫洞。」）。
 *
 * 口径（design §三/§五/§六 已确认）：
 * - **主控活动**：开始/停止都只在本页（进度保留，停扫不清零）；与采矿/打捞/远征等互斥；
 * - **窗口 = 220 分钟 × 三技能乘算**（信号分析学/星图测绘学/信号过滤学，与星图扫描同源；不吃舰船属性）；
 * - 进度满 ⇒ 发现一处虫洞进库存（**上限 5**，满了**停机并提示**）；
 * - 库存每处带**种子 + 内容原型 + 敌族**（起始层**恒 1**：船长 2026-09-14「所有虫洞都是从1层开始探索」）；
 *   卡片只显示「**原型名，发现于 X月X日**」（船长 2026-09-14）；「探索这一处」⇒ 打开准备页选编队进洞（**消耗**该处）；
 * - **自动探索**（批次 3 · 船长逐条定案）：每处一个「自动探索」——自动配置最多 4 条非主控船（每条占 1 枚
 *   AI 核心，可手动改）、**5 分钟**、完成后停止；产出 = **手动一趟期望 × 40%**（**直入仓库**、不保底）；
 *   参与舰**结构/装甲各受损 −40%~−80%** 但**绝不丢船**、任务期间锁定；
 * - **结算**：日志 ＋ 一份**需要确认的报告**（就在本页列出：收益清单 + 损伤读数）——船长允许本页出现"虫洞"字样；
 * - **施工期**：整个选项卡只在调试模式下出现（与虫洞入口同一把开关）。
 */
import { useEffect, useState } from 'react'
import { Panel } from '@whale/ui'
import { Glyph, ICO_TONES } from '../ui/Glyphs'
import { formatDurationMs } from '@whale/core'
import {
  WORMHOLE_AUTO_DAMAGE_MAX,
  WORMHOLE_AUTO_DAMAGE_MIN,
  WORMHOLE_AUTO_DURATION_MS,
  WORMHOLE_AUTO_MAX_SHIPS,
  WORMHOLE_AUTO_YIELD_MUL,
  WORMHOLE_SCAN_BASE_MS,
  WORMHOLE_ARCHETYPE_LABELS,
  WORMHOLE_SCAN_UNLOCK_STANDING,
  WORMHOLE_STOCK_MAX,
  aiCoreName,
} from '@whale/core'
import type { GameState, WormholeArchetype, WormholeFamily } from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { HintIcon } from '../ui/Hint'

/**
 * **「发现于 9月14日」**（船长 2026-09-14：卡片上不要相对时间，要日期）。
 *
 * 口径：发现时刻 = **开局墙钟**（`character.startedAtWallMs`，建档那一刻）+ **游戏内已过时间**
 * （`foundAtGameMs`；游戏时间与墙钟同速，离线结算也算进 `gameMs`）⇒ 得到玩家真实日历上的月/日。
 * 显示成绝对日期 ⇒ **不再每秒跳动**（旧文案「57秒前」会一直变）。
 */
function foundDateLabel(state: GameState, foundAtGameMs: number): string {
  const d = new Date((state.character?.startedAtWallMs ?? 0) + Math.max(0, foundAtGameMs))
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 库存项的**标准一行**（卡片与放弃弹窗共用同一口径）：族徽 + 「原型名，发现于 X月X日」 */
function stockLineOf(
  state: GameState,
  item: { family: WormholeFamily; archetype: WormholeArchetype; foundAtGameMs: number },
): { glyph: string; text: string } {
  const glyph = `fam-${item.family.toLowerCase()}`
  return { glyph, text: `${WORMHOLE_ARCHETYPE_LABELS[item.archetype]}，发现于 ${foundDateLabel(state, item.foundAtGameMs)}` }
}

export function WormholeScanTab({ engine, onToast, onExplore }: { engine: GameEngine; onToast: ToastFn; onExplore: (stockId: string) => void }) {
  const state = engine.state
  /** 每秒重算一次读数（进度条/剩余时间跟手；引擎本身按拍推进） */
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  /** 正在"配置哪一处"（null = 没在配置） */
  const [pickFor, setPickFor] = useState<string | null>(null)
  /** 正在确认「放弃」的那一处（null = 没在确认） */
  const [discardAsk, setDiscardAsk] = useState<string | null>(null)
  /** 配置里勾选的参与舰（开始时以库存项为键保存；关掉配置即清） */
  const [pickShips, setPickShips] = useState<string[]>([])
  const scan = state.wormholeScan ?? { active: false, progressMs: 0 }
  const stock = engine.wormholeStock()
  const runs = engine.wormholeAutoRuns()
  const reports = engine.wormholeAutoReports()
  const pending = engine.wormholeAutoPending()
  const windowMs = engine.wormholeScanWindow()
  const done = Math.min(windowMs, scan.progressMs)
  const percent = Math.max(0, Math.min(100, Math.round((done / windowMs) * 100)))
  const blocked = engine.wormholeScanBlockReason()
  const full = stock.length >= WORMHOLE_STOCK_MAX
  /** 解锁门槛（船长 2026-09-14：需要协会声望 35；解锁时会收到一封通讯 + 直接弹窗） */
  const unlocked = engine.wormholeScanUnlocked()
  const standing = engine.wormholeScanStanding()
  /** 配置界面的候选（全部列出；不可派的也显示并写明原因） */
  const allCandidates = pickFor !== null ? engine.wormholeAutoCandidates([]) : []
  const lineup =
    pickShips.length > 0
      ? pickShips
      : allCandidates.filter((c) => c.picked).map((c) => c.shipId)
  const startBlock = pickFor !== null ? engine.wormholeAutoBlockReason(pickFor, lineup) : null

  const openPick = (stockId: string): void => {
    const auto = engine
      .wormholeAutoCandidates([])
      .filter((c) => c.picked)
      .map((c) => c.shipId)
    setPickShips(auto)
    setPickFor(stockId)
  }

  return (
    <Panel
      className="is-fill win-fixed-body"
      title="扫描虫洞"
      /* 常驻说明进标题后的 ⓘ（2026-09-14 船长：「和外面的其他页面一样，添加圆形感叹号用于进行说明」；
         与同页「残骸打捞」的写法一致，原先那行可见的 `.app-note` 收进提示、不再占版面） */
      hint={
        <HintIcon
          tip={`主控就地展开扫描阵列找虫洞：进度条走满一处即可开始探索。窗口 = 基准 ${formatDurationMs(WORMHOLE_SCAN_BASE_MS)}，受「信号分析学 / 星图测绘学 / 信号过滤学」缩短（三项乘算）。扫描期间遭遇随机事件的概率与星图扫描一致；被打断也不影响进度。未探索的虫洞最多囤 ${WORMHOLE_STOCK_MAX} 处。`}
        />
      }
      right={
        <span className="app-dim">
          已囤 {stock.length}/{WORMHOLE_STOCK_MAX} 处
          {runs.length > 0 ? ` · 自动探索 ${runs.length} 趟在跑` : ''}
          {pending > 0 ? ` · 待确认报告 ${pending} 份` : ''} · 单次窗口 {formatDurationMs(windowMs)}
        </span>
      }
    >
      <div className="app-win-body">
        {!unlocked ? (
          <div className="app-wh-scanbar">
            <div className="app-wh-scanbar-label">
              <span className="app-wh-hold-warn">
                尚未解锁：需要「深空工业协会」声望 {WORMHOLE_SCAN_UNLOCK_STANDING}（当前 {standing}）
              </span>
            </div>
            <div className="app-dim">
              声望靠协会的委托与任务攒；达到门槛时协会测绘处会发来一封通讯，并当场弹给你看。
            </div>
          </div>
        ) : null}

        <div className="app-wh-scanbar">
          <div className="app-wh-scanbar-label">
            进度 <b>{percent}%</b>
            <span className="app-dim">
              {' '}
              · 已扫 {formatDurationMs(done)} / {formatDurationMs(windowMs)}
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
                  if (!r.ok) onToast(r.error ?? '停不了。', true)
                  else onToast('已停扫：进度保留，下次接着扫。')
                }}
              >
                停止扫描（进度保留）
              </button>
            ) : (
              <button
                className="app-btn is-small is-primary"
                disabled={blocked !== null}
                title={blocked ?? '开始扫描虫洞'}
                onClick={() => {
                  const r = engine.wormholeScanStart()
                  if (!r.ok) onToast(r.error ?? '无法开扫。', true)
                  else onToast('开始扫描虫洞：主控就地展开扫描阵列。')
                }}
              >
                开始扫描
              </button>
            )}
            {full ? <span className="app-wh-hold-warn">已囤满上限：先去探索掉一处才能继续扫</span> : null}
          </div>
          {blocked !== null && !scan.active ? <div className="app-dim">{blocked}</div> : null}
        </div>

        <div className="app-bay-title">已发现的虫洞 · {stock.length} 处</div>
        {stock.length === 0 ? (
          <div className="app-dim app-inv-empty">还没有发现虫洞：开扫后等进度条走满。</div>
        ) : (
          <ul className="app-inv-list">
            {stock.map((item) => {
              const line = stockLineOf(state, item)
              const famName = engine.wormholeFamilyName(item.family)
              const archName = WORMHOLE_ARCHETYPE_LABELS[item.archetype]
              return (
                <li key={item.id} className="app-inv-row">
                  <div className="app-inv-main">
                    <span className="app-inv-name">
                      <span className="app-ico">
                        <Glyph name={line.glyph} size={14} color={ICO_TONES[line.glyph]} />
                      </span>
                      虫洞
                    </span>
                    {/**
                     * 卡片只留「**原型名，发现于 X月X日**」（船长 2026-09-14：「只需要显示'遗迹密集，
                     * 发现于XX月XX日'」）——族名/深度说明/相对时间一律撤下，完整口径进悬停。
                     */}
                    <span
                      className="app-inv-count"
                      title={`族徽＝这一处整趟都是「${famName}」：敌人编成、稀有残骸、遗迹安全货柜与专属装备/图纸都出自这一族。\n内容原型「${archName}」＝这一处的地点配比口味（威胁与产出随所在层数上升：越深越险、产出越高）。`}
                    >
                      {line.text}
                    </span>
                  </div>
                  <div className="app-inv-btns">
                    <button className="app-btn is-small is-primary" onClick={() => onExplore(item.id)}>
                      探索这一处
                    </button>
                    <button
                      className="app-btn is-small"
                      disabled={runs.some((r) => r.stockId === item.id)}
                      title={
                        runs.some((r) => r.stockId === item.id)
                          ? '这一处已经在自动探索中'
                          : `自动派最多 ${WORMHOLE_AUTO_MAX_SHIPS} 条副船去探（每条占 1 枚 AI 核心，约 ${Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000)} 分钟）`
                      }
                      onClick={() => (pickFor === item.id ? setPickFor(null) : openPick(item.id))}
                    >
                      自动探索
                    </button>
                    <button
                      className="app-btn is-small is-warn"
                      disabled={runs.some((r) => r.stockId === item.id)}
                      title={
                        runs.some((r) => r.stockId === item.id)
                          ? '这一处正在自动探索中：先召回那一趟'
                          : '放弃这一处（腾出库存格；不可恢复）'
                      }
                      onClick={() => setDiscardAsk(item.id)}
                    >
                      放弃
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
                      <span className="app-report-title">放弃这一处虫洞？</span>
                      <button className="app-btn is-small" onClick={() => setDiscardAsk(null)}>
                        ✕ 关闭
                      </button>
                    </div>
                    <div className="app-modal-body">
                      <div className="app-inv-name">
                        <span className="app-ico">
                          <Glyph name={line.glyph} size={14} color={ICO_TONES[line.glyph]} />
                        </span>
                        {line.text}
                      </div>
                      <div className="app-dim" style={{ marginTop: 6 }}>
                        放弃后这一处就没了、<b>不可恢复</b>；库存格腾出来给新的发现，**扫描进度不受影响**。
                      </div>
                      <div className="app-wh-scanbar-actions" style={{ marginTop: 10 }}>
                        <button
                          className="app-btn is-small is-warn"
                          onClick={() => {
                            const r = engine.wormholeStockDiscard(item.id)
                            if (!r.ok) onToast(r.error ?? '放弃失败。', true)
                            else onToast('已放弃这一处虫洞。')
                            setDiscardAsk(null)
                          }}
                        >
                          确认放弃
                        </button>
                        <button className="app-btn is-small" onClick={() => setDiscardAsk(null)}>
                          先留着
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()
          : null}

        {pickFor !== null ? (
          <div className="app-wh-scanbar">
            <div className="app-wh-scanbar-label">
              自动探索 · 派谁去
              <span className="app-dim">
                {' '}
                · 每条占 1 枚 AI 核心 · 约 {Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000)} 分钟 · 收益为手动一趟的{' '}
                {Math.round(WORMHOLE_AUTO_YIELD_MUL * 100)}%（**直入仓库**、不保底）· 结构/装甲各受损{' '}
                {Math.round(WORMHOLE_AUTO_DAMAGE_MIN * 100)}%~{Math.round(WORMHOLE_AUTO_DAMAGE_MAX * 100)}%（**不会丢船**）
              </span>
            </div>
            <ul className="app-inv-list">
              {allCandidates.length === 0 ? (
                <li className="app-dim app-inv-empty">舰队里没有可派的副船。</li>
              ) : (
                allCandidates.map((c) => {
                  const checked = lineup.includes(c.shipId)
                  const disableAdd =
                    c.blocked !== null || (!checked && lineup.length >= WORMHOLE_AUTO_MAX_SHIPS)
                  /** 参与舰名（界面用；引擎包装里没有名字接口，这里退回 id） */
                  return (
                    <li key={c.shipId} className="app-inv-row">
                      <label className="app-inv-main" style={{ cursor: disableAdd && !checked ? 'not-allowed' : 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disableAdd && !checked}
                          onChange={() => {
                            setPickShips((prev) =>
                              prev.includes(c.shipId) ? prev.filter((x) => x !== c.shipId) : [...prev, c.shipId],
                            )
                          }}
                        />{' '}
                        <span className="app-inv-name">{c.name}</span>
                        <span className="app-inv-count">
                          {c.blocked ?? (c.picked ? '自动配置已选' : '可派')}
                          {!checked && c.blocked === null && lineup.length >= WORMHOLE_AUTO_MAX_SHIPS
                            ? ' · 已达上限'
                            : ''}
                        </span>
                      </label>
                    </li>
                  )
                })
              )}
            </ul>
            <div className="app-wh-scanbar-actions">
              <button
                className="app-btn is-small is-primary"
                disabled={startBlock !== null}
                title={startBlock ?? '派这一队出发'}
                onClick={() => {
                  const r = engine.wormholeAutoStart(pickFor, lineup)
                  if (!r.ok) onToast(r.error ?? '派不出去。', true)
                  else {
                    onToast(`自动探索队出发：${lineup.length} 条舰，约 ${Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000)} 分钟后返航。`)
                    setPickFor(null)
                    setPickShips([])
                  }
                }}
              >
                派 {lineup.length} 条舰出发
              </button>
              <button
                className="app-btn is-small"
                onClick={() => {
                  setPickFor(null)
                  setPickShips([])
                }}
              >
                取消
              </button>
              {startBlock !== null ? <span className="app-wh-hold-warn">{startBlock}</span> : null}
            </div>
            {lineup.length === 0 ? (
              <div className="app-dim">先勾选至少 1 条副船（主控船不参与自动探索）。</div>
            ) : null}
          </div>
        ) : null}

        {runs.length > 0 ? (
          <>
            <div className="app-bay-title">自动探索进行中 · {runs.length} 趟</div>
            <ul className="app-inv-list">
              {runs.map((run) => {
                const span = Math.max(1, run.finishAtGameMs - run.startedAtGameMs)
                const prog = Math.max(0, Math.min(100, Math.round(((state.gameMs - run.startedAtGameMs) / span) * 100)))
                return (
                  <li key={run.id} className="app-inv-row">
                    <div className="app-inv-main">
                      <span className="app-inv-name">虫洞 · 自动探索中</span>
                      <span className="app-inv-count">
                        {run.shipIds.length} 条舰（各占 1 枚 AI 核心）· 还剩{' '}
                        {formatDurationMs(Math.max(0, run.finishAtGameMs - state.gameMs))}
                      </span>
                    </div>
                    <div className="app-inv-btns">
                      <span className="app-dim">{prog}%</span>
                      <button
                        className="app-btn is-small is-warn"
                        title="召回：没有收益、也没有损伤；这处虫洞不退还"
                        onClick={() => {
                          const r = engine.wormholeAutoStop(run.id)
                          if (!r.ok) onToast(r.error ?? '召回失败。', true)
                          else onToast('已召回自动探索队（无收益、无损伤；通道就此关闭）。')
                        }}
                      >
                        召回
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
              探索报告 · {reports.length} 份{pending > 0 ? `（待确认 ${pending}）` : ''}
            </div>
            {pending > 1 ? (
              <div className="app-wh-scanbar-actions">
                <button
                  className="app-btn is-small"
                  onClick={() => {
                    const n = engine.wormholeAutoConfirmAll()
                    onToast(n > 0 ? `已确认 ${n} 份报告。` : '没有待确认的报告。')
                  }}
                >
                  全部标为已读
                </button>
              </div>
            ) : null}
            <ul className="app-inv-list">
              {reports.map((rep) => (
                <li key={rep.id} className="app-inv-row">
                  <div className="app-inv-main">
                    <span className="app-inv-name">
                      自动探索结果 · {rep.confirmed ? '已确认' : '待确认'}
                    </span>
                    <span className="app-inv-count">
                      收益（已入仓库）：
                      {rep.gains.length > 0
                        ? rep.gains.map((g) => `${engine.ctx.items.get(g.itemId)?.name ?? g.itemId} ×${g.units}`).join('、')
                        : '空手而归'}
                    </span>
                    {/* AI 核心（2026-09-14）：**不进仓库**（直接进核心库）⇒ 与「收益」分行单列，别混在一起 */}
                    {rep.cores && rep.cores.length > 0 ? (
                      <span className="app-inv-count">
                        另带回：
                        {rep.cores.map((c) => `${aiCoreName(c.type)} ×${c.n}`).join('、')}
                        （已直接接入核心库）
                      </span>
                    ) : null}
                    <span className="app-inv-count">
                      损伤：
                      {rep.damage.length > 0
                        ? rep.damage
                            .map(
                              (d) =>
                                `${d.name} 结构 −${d.durabilityLossPct}%（现 ${d.durabilityPct}%）/ 装甲 −${d.armorLossPct}%（现 ${d.armorPct}%）`,
                            )
                            .join('；')
                        : '无'}
                    </span>
                    <span className="app-inv-count">
                      {rep.shipIds.length} 条舰全部安全返航 · {rep.coresReleased} 枚 AI 核心已释放 · 完成于{' '}
                      {formatDurationMs(Math.max(0, state.gameMs - rep.finishedAtGameMs))}前
                    </span>
                  </div>
                  <div className="app-inv-btns">
                    {rep.confirmed ? null : (
                      <button
                        className="app-btn is-small is-primary"
                        onClick={() => {
                          const r = engine.wormholeAutoConfirm(rep.id)
                          if (!r.ok) onToast(r.error ?? '确认失败。', true)
                        }}
                      >
                        确认
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </Panel>
  )
}
