/**
 * 终局玩法「虫洞」· 施工期界面（E 批 2026-09-13 起 · F3a-2 层内网格 2026-09-13）。
 *
 * ⚠ **可见性铁律（船长 2026-09-13）**：虫洞完成前**对玩家不可见** —— 入口只在**调试模式**下出现
 * （`debugEnabled()`，与调试面板同一开关），数据侧走 `MarketGoodDef.unreleased` 闸门，
 * **拍板前不得出现在玩家可及路径上**。见 `docs/design/wormhole-extraction-endgame-20260912.md`
 * §「可见性与拍板」与 §十（分批落码）。
 *
 * 界面构成：准备页（编队检索 + 三联读数）· **探索页（F3a-2：圆盘六边形网格 + 扫描/前往/激活）** ·
 * 背包网格。层内动作各花 1 回合，未扫描的地点要先警告再确认（船长口径）；
 * 地点收益（打捞/挖掘/谜质增强）在 F3b/F3c —— 施工期这几个地点的按钮会如实提示"作业尚未接入"。
 */
import { useEffect, useState } from 'react'
import {
  WORMHOLE_ADMISSION_TEXT,
  WORMHOLE_MAX_SHIPS,
  WORMHOLE_PLACE_TEXT,
  WORMHOLE_SLOT_M3,
  WORMHOLE_TOTAL_MASS_CAP,
  cargoCapacityM3Of,
  isExitCell,
  shipBusyLabel,
  shipDisplayName,
  shipSizeLabel,
  wormholeAdmission,
  wormholeBagSlots,
  wormholeBagUsage,
  wormholeFleetCargoM3,
  wormholeFoeThreat,
  wormholeLayerThreat,
  durabilityOf,
  signalOfPlace,
  wormholeOutOfTurns,
  wormholeShipAllowed,
  wormholeShipMass,
  wormholeUnitsPerSlot,
} from '@whale/core'
import type { WormholeGridState, WormholePlace, WormholeSignal } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { ShipSprite } from '../ui/ShipSprite'
import type { ToastFn } from '../pages/common'
import { SHIP_SUBS, SHIP_TIER_SUBS, SUB_ALL } from '../ui/itemSubs'

type WhTab = 'prep' | 'map' | 'bag'

const TAB_LABEL: Record<WhTab, string> = { prep: '准备', map: '探索', bag: '背包' }

/** 千分位 */
function n(v: number): string {
  return Math.round(v).toLocaleString('zh-CN')
}

export function WormholePanel({
  engine,
  onToast,
  onClose,
}: {
  engine: GameEngine
  onToast: ToastFn
  onClose: () => void
}) {
  const state = engine.state
  const ctx = engine.ctx
  const run = state.wormhole.run
  const [tab, setTab] = useState<WhTab>(run ? 'map' : 'prep')
  /** 编队选择（准备页；进洞前才用得上） */
  const [picked, setPicked] = useState<string[]>(state.shipId ? [state.shipId] : [])
  /**
   * 待确认的"前往未知地点"目标（船长 2026-09-13：前往未扫描的地方**需要警告**）。
   * 口径：点未扫描的格 **不直接走**（也不扣回合），先把警告摆出来，等玩家点「确认前往」。
   */
  const [pendingCell, setPendingCell] = useState<{ q: number; r: number } | null>(null)

  const admission = wormholeAdmission(ctx, picked)
  const cargoM3 = wormholeFleetCargoM3(state, ctx, picked)
  const bagSlots = wormholeBagSlots(cargoM3)
  const usage = run ? wormholeBagUsage(ctx, run.bag, wormholeBagSlots(wormholeFleetCargoM3(state, ctx, run.fleet))) : null
  /** 回合走不动了（耗尽 / 付不起当前节点）⇒ 只能撤离（逃生门；与 core `wormholeOutOfTurns` 同一把尺） */
  const outOfTurns = run ? wormholeOutOfTurns(run) : false
  /** 本层网格（F3a-2；老档该层没有网格 ⇒ 退回旧口径提示） */
  const grid = run?.grid
  const hereKey = grid ? `${grid.pos.q},${grid.pos.r}` : ''
  const hereCell = grid ? grid.cells.find((c) => c.key === hereKey) : undefined
  const atExit = grid ? isExitCell(grid, grid.pos) : false
  const bossDone = !!run && (run.bossCleared ?? 0) >= run.depth
  /** 当前地点能不能激活：空信息地点没作业、处理过的不重复、入口格在守卫清掉后不再触发 */
  const canActivate =
    !!grid && !!hereCell && !grid.activated.includes(hereKey) && (atExit ? !bossDone : hereCell.place !== 'empty')
  /** 主控忙态（船长 2026-09-13：「进洞要求洞外主控处于闲置状态」）——非空即不许进洞 */
  const pilotBusy = run ? null : shipBusyLabel(state, ctx, state.shipId)

  /* ── 选舰检索（船长 2026-09-13「缺少一个类似我的舰队里的舰船筛选和搜索」）──
     复刻「我的舰队」那套：搜索词（舰名/船型名，忽略大小写）+ 两行筛选（类别 / 级别，各维取「与」）；
     类别与级别复用同一张单点表（`SHIP_SUBS` / `SHIP_TIER_SUBS`），与市场/手册/组装机同口径。
     （2026-09-13 船长：「状态的筛选可以删除」⇒ 原「状态」那一行整行退场。） */
  const [whQ, setWhQ] = useState('')
  const [whRole, setWhRole] = useState<string>(SUB_ALL)
  const [whTier, setWhTier] = useState<string>(SUB_ALL)
  const whEntries = Object.keys(state.fleet).map((uid) => {
    const def = ctx.ships.get(state.fleet[uid]!.defId ?? uid)
    const busy = shipBusyLabel(state, ctx, uid)
    const ok = def ? wormholeShipAllowed(def) : false
    return {
      uid,
      def,
      name: shipDisplayName(state, ctx, uid),
      tier: def?.tier ?? 0,
      ok,
      busy,
      on: picked.includes(uid),
      // **损伤**（与舰队页「待维修」同一把尺）：装甲/结构未满 = 带伤；护盾每场满值重建、不持久、不计
      armor: state.fleet[uid]!.armorPct ?? 1,
      dur: durabilityOf(state, uid),
    }
  })
  const whFiltered = whQ.trim().length > 0 || whRole !== SUB_ALL || whTier !== SUB_ALL
  const whShown = whEntries.filter((e) => {
    const q = whQ.trim().toLowerCase()
    if (q.length > 0) {
      const hay = `${e.name} ${e.def?.name ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (whRole !== SUB_ALL && (e.def?.role ?? 'industrial') !== whRole) return false
    if (whTier !== SUB_ALL && `t${e.tier}` !== whTier) return false
    return true
  })

  function togglePick(uid: string): void {
    setPicked((prev) => {
      if (prev.includes(uid)) return prev.filter((x) => x !== uid)
      if (prev.length >= WORMHOLE_MAX_SHIPS) {
        onToast(`最多只能带 ${WORMHOLE_MAX_SHIPS} 艘船。`, true)
        return prev
      }
      return [...prev, uid]
    })
  }

  function handleEnter(): void {
    const r = engine.wormholeEnter(picked)
    if (!r.ok) onToast(r.error ?? '无法跃入。', true)
    else {
      onToast('已跃入虫洞。')
      setTab('map')
    }
  }

  /* ── 层内网格动作（F3a-2）：扫描 / 前往 / 激活，各 1 回合 ──
     口径（船长 2026-09-13）：「玩家可以到达任意位置，包括未扫描，但是前往未扫描的地方需要
     警告玩家即将前往未知地点」⇒ 点未扫描的格**只摆警告**（不移动、不扣回合），
     等玩家点「确认前往」才真的走。核心侧同样有这道闸（`code === 'unknown-target'`），
     界面不依赖"记得拦"——两边同一把尺。 */

  /** 点格：已扫描/已到达 ⇒ 直接走；未扫描 ⇒ 先警告 */
  function pickCell(q: number, r: number): void {
    if (!grid || !run) return
    if (run.battle) {
      onToast('交火中：先打完这一场。', true)
      return
    }
    const cell = grid.cells.find((c) => c.key === `${q},${r}`)
    if (!cell) return
    if (cell.key === hereKey) {
      onToast('已经在这个地点了。')
      return
    }
    if (!grid.scanned.includes(cell.key) && !grid.visited.includes(cell.key)) {
      setPendingCell({ q, r })
      return
    }
    travelTo(q, r, false)
  }

  function travelTo(q: number, r: number, confirmUnknown: boolean): void {
    const res = engine.wormholeTravel(q, r, confirmUnknown)
    if (!res.ok) {
      onToast(res.error ?? '无法前往。', true)
      return
    }
    setPendingCell(null)
    // 到达即触发的两件事（船长 2026-09-13）：信标指路 / 舰船信号就地开打（战斗界面接手，不提示）
    if (res.beacon) onToast('漂浮信标：下一层入口已标在地图上。')
  }

  function doScan(): void {
    const res = engine.wormholeScan()
    if (!res.ok) {
      onToast(res.error ?? '无法扫描。', true)
      return
    }
    onToast('扫描完成（1 回合）。')
  }

  /**
   * 激活当前地点：舰船信号 / 下一层入口会**就地开战**（战斗界面接手）；
   * 其余地点的收益在 F3b/F3c，施工期如实提示"作业尚未接入"（与既有「事件内容尚未接入」同一档）。
   */
  function doActivate(): void {
    const place = hereCell?.place
    const exitNow = atExit
    const res = engine.wormholeActivate()
    if (!res.ok) {
      onToast(res.error ?? '无法激活。', true)
      return
    }
    if (exitNow || place === 'ship') return // 已开战：交给战斗界面
    if (place === 'graveyard' || place === 'ruins') onToast('打捞作业尚未接入（F3b）。')
    else if (place === 'vein') onToast('挖掘作业尚未接入（F3b）。')
    else if (place === 'matter') onToast('谜质的增强效果待定（F3c）。')
  }

  function doDescend(): void {
    const r = engine.wormholeDescend()
    if (!r.ok) onToast(r.error ?? '无法深入。', true)
  }

  function doExtract(): void {
    const r = engine.wormholeExtract()
    if (!r.ok) onToast(r.error ?? '无法撤离。', true)
  }

  /**
   * **临时离开 = 活动停止**（船长 2026-09-13 批准 · 议案 A 第 2 条）：关掉面板就 `wormholeLeave()`
   * ⇒ 主控立刻释放（可以去做别的），**虫洞进度原样保存**、洞内一切冻结（含战斗）。
   */
  function handleClose(): void {
    if (state.wormhole.run) engine.wormholeLeave()
    onClose()
  }

  // **返回虫洞**（打开面板即占住活动位）：要求主控空闲——忙着则留在"已离开"态并提示先收工（第 3 条）。
  const [resumeNote, setResumeNote] = useState<string | null>(null)
  useEffect(() => {
    if (!state.wormhole.run || state.wormhole.run.attending === true) return
    const r = engine.wormholeResume()
    if (!r.ok) setResumeNote(r.error ?? '暂时回不到虫洞。')
    else setResumeNote(null)
    // 只在"刚打开/刚离开"这两种时刻触发；`attending` 变 true 后本效果自动空转
  }, [engine, state.wormhole.run?.attending])

  return (
    <div className="app-modal-mask" onClick={handleClose}>
      <div className="app-modal app-wh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">虫洞</span>
          <span className="app-dim app-wh-devnote">
            {run ? (run.attending ? '人在洞里 · 离开即暂停（进度保存）' : '已离开 · 进度已保存') : '调试入口 · 施工中（拍板后对玩家开放）'}
          </span>
          <div className="app-wh-tabs">
            {(Object.keys(TAB_LABEL) as WhTab[]).map((k) => {
              /**
               * **进洞后不许回「准备」页**（船长 2026-09-13 报的 UI BUG）：
               * 编队一进洞就锁定了（人也进洞了），再回准备页既能改编队又能重复「进入虫洞」，
               * 语义上是"人已经下去了还能重选队伍"。⇒ `run` 存在时「准备」置灰，
               * 要改编队必须先撤离/结算本趟（回合制，页签状态不影响引擎）。
               */
              const blocked = k === 'prep' ? !!run : !run
              return (
                <button
                  key={k}
                  className={`app-btn is-small${tab === k ? ' is-primary' : ''}`}
                  onClick={() => setTab(k)}
                  disabled={blocked}
                  title={k === 'prep' && run ? '已在洞里：先撤离或结算本趟，才能重新编队' : !run && k !== 'prep' ? '还没进洞' : undefined}
                >
                  {TAB_LABEL[k]}
                </button>
              )
            })}
          </div>
          <button className="app-btn is-small" onClick={handleClose}>
            ✕ 关闭（离开虫洞）
          </button>
        </div>

        <div className="app-modal-body">
          {/* 回不到虫洞（主控在忙）：把拒因摆出来，别让玩家对着不能点的界面猜（议案 A 第 3 条） */}
          {resumeNote ? <div className="app-warn app-wh-gate">{resumeNote}</div> : null}
          {/* 本趟已结束（撤离成功 / 全损）⇒ 回到准备页并说明结果（否则"探索/背包"两页会是空白） */}
          {!run && tab !== 'prep' ? (
            <div className="app-dim app-inv-empty">
              本趟已结束（最近一次损失 {state.wormhole.lastFleetLost} 艘）：在「准备」页可再次编队入洞。
            </div>
          ) : null}
          {tab === 'prep' ? (
            <div className="app-wh-prep">
              <div className="app-bay-title">准备 · 选编队（最多 {WORMHOLE_MAX_SHIPS} 艘）</div>
              <div className="app-dim app-note">
                带入舰船按「级别折算质量」压塌虫洞入口：旗舰（T5）进不去，总质量超过 {n(WORMHOLE_TOTAL_MASS_CAP)} 也进不去；
                总质量越高、可探索回合越短；背包格数按编队「合计货仓」折算（每 {n(WORMHOLE_SLOT_M3)} m³ = 1 格，含技能与货舱件加成）。
              </div>
              {/* **选舰卡片**（船长 2026-09-13：「虫洞入口选取舰船采用卡片形式，卡片内含有舰船名称、
                  舰船级别、折算质量、货仓、舰船 SVG 外形，且当编入时，卡片边框会变色」）——
                  结构/类名沿用装配页候选卡（`.app-fit-pick-item`）与舰队卡（`.app-inv-row.is-picked`）那一族：
                  整卡可点、选中态给边框+底色；舰影走统一资产 `ShipSprite`（细描边线稿，非 CSS 拼形）。
                  ⚠ `ShipSprite` **不要传 `name`**：它自带一个绝对定位的舰名标签（`.app-sprite-name`，
                  贴在舰影下缘），会压住卡片自己的舰名（2026-09-13 船长报「名称与 SVG 下方文本重叠」）。
                  检索控件（搜索 + 状态/类别/级别三行筛选）复刻「我的舰队」那套类名与口径。 */}
              <div className="app-bay-title app-wh-sub">选择舰船（点卡片编入 / 再点撤下）</div>
              <span className="app-head-search-wrap app-wh-search">
                <input
                  className="app-head-search"
                  type="text"
                  placeholder="搜索舰船…"
                  value={whQ}
                  onChange={(e) => setWhQ(e.target.value)}
                  spellCheck={false}
                />
                <span className="app-dim">
                  {whFiltered ? `匹配 ${whShown.length} / 共 ${whEntries.length} 艘` : `${whEntries.length} 艘`}
                </span>
              </span>
              <div className="app-fleet-toolbar app-wh-filters">
                <div className="app-fleet-row">
                  <span className="app-dim">类别：</span>
                  <div className="app-task-tabs app-fleet-tabs" role="tablist">
                    <button
                      role="tab"
                      aria-selected={whRole === SUB_ALL}
                      className={`app-tasktab${whRole === SUB_ALL ? ' is-active' : ''}`}
                      onClick={() => setWhRole(SUB_ALL)}
                    >
                      全部
                    </button>
                    {SHIP_SUBS.map((s) => (
                      <button
                        key={s.key}
                        role="tab"
                        aria-selected={whRole === s.key}
                        className={`app-tasktab${whRole === s.key ? ' is-active' : ''}`}
                        onClick={() => setWhRole(s.key)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="app-fleet-row">
                  <span className="app-dim">级别：</span>
                  <div className="app-task-tabs app-fleet-tabs" role="tablist">
                    <button
                      role="tab"
                      aria-selected={whTier === SUB_ALL}
                      className={`app-tasktab${whTier === SUB_ALL ? ' is-active' : ''}`}
                      onClick={() => setWhTier(SUB_ALL)}
                    >
                      全部
                    </button>
                    {SHIP_TIER_SUBS.map((s) => (
                      <button
                        key={s.key}
                        role="tab"
                        aria-selected={whTier === s.key}
                        className={`app-tasktab${whTier === s.key ? ' is-active' : ''}`}
                        onClick={() => setWhTier(s.key)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <ul className="app-wh-cards">
                {whShown.map(({ uid, name, tier, ok, on, busy, armor, dur }) => {
                  const damaged = armor < 1 || dur < 1
                  const def = ctx.ships.get(state.fleet[uid]!.defId ?? uid)
                  const canPick = ok && !busy
                  const title = !ok
                    ? '该舰过重，会压塌虫洞入口（最多带到 T4）'
                    : busy
                      ? `${busy}：先收工/取消派工，才能编入虫洞`
                      : on
                        ? '再点一下撤下'
                        : '点一下编入'
                  return (
                    <li key={uid}>
                      <button
                        type="button"
                        className={`app-wh-card${on ? ' is-picked' : ''}${canPick ? '' : ' is-locked'}`}
                        disabled={!canPick}
                        onClick={() => togglePick(uid)}
                        title={title}
                      >
                        <span className="app-wh-card-art" aria-hidden>
                          {/* ⚠ 不传 name（见上：会把舰名压在卡片文本上） */}
                          <ShipSprite shipId={state.fleet[uid]!.defId ?? uid} size={132} />
                        </span>
                        <span className="app-wh-card-name">{shipDisplayName(state, ctx, uid)}</span>
                        <span className="app-wh-card-sub">
                          {shipSizeLabel(tier)} · T{tier}
                          {busy ? <span className="app-chip is-dim"> {busy}</span> : null}
                        </span>
                        <span className="app-wh-card-sub">
                          折算质量 {def ? n(wormholeShipMass(def)) : '—'} · 货仓 {n(cargoCapacityM3Of(state, ctx, uid))} m³
                        </span>
                        <span className="app-wh-card-tags">
                          <span className={`app-wh-card-tag${on ? ' is-on' : ''}`}>
                            {on ? '已编入' : !ok ? '过重' : busy ? '占用中' : '编入'}
                          </span>
                          {/* **损伤提示标签**（船长 2026-09-13：「如果舰船有损伤，那么在编入的标签旁新增一个标签
                              提示玩家，防止不小心损坏的船带入虫洞」）：判据与舰队页「待维修」同一把尺
                              （`armorPct < 1 || durability < 1`；护盾不持久、不计损伤）。 */}
                          {damaged ? (
                            <span
                              className="app-wh-card-tag is-warn"
                              title={`该舰带伤（承伤在虫洞内**跨节点保留**）：${armor < 1 ? `装甲 ${Math.round(armor * 100)}%` : ''}${
                                armor < 1 && dur < 1 ? ' · ' : ''
                              }${dur < 1 ? `结构 ${Math.round(dur * 100)}%` : ''}——建议先回站维修或换一艘。`}
                            >
                              带伤{armor < 1 ? ` 甲${Math.round(armor * 100)}%` : ''}
                              {dur < 1 ? ` 构${Math.round(dur * 100)}%` : ''}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>

              <div className="app-bay-title app-wh-sub">三联读数</div>
              <div className="app-wh-triad">
                <span className="app-wh-cell">
                  合计货仓 <b>{n(cargoM3)}</b> m³ ⇒ 背包 <b>{bagSlots}</b> 格
                </span>
                <span className="app-wh-cell">
                  折算总质量 <b>{n(admission.totalMass)}</b> / {n(WORMHOLE_TOTAL_MASS_CAP)}
                </span>
                <span className="app-wh-cell">
                  回合预算 <b>{admission.turnBudget}</b>
                </span>
              </div>
              {!admission.ok ? (
                <div className="app-warn app-wh-gate">{WORMHOLE_ADMISSION_TEXT[admission.code]}</div>
              ) : null}
              {pilotBusy ? (
                <div className="app-warn app-wh-gate">
                  主控正在{pilotBusy}：先把手上的活收工，才能指挥虫洞探索。
                </div>
              ) : null}
              <div className="app-wh-actions">
                <button
                  className="app-btn is-primary is-small"
                  disabled={!admission.ok || !!run || !!pilotBusy}
                  onClick={handleEnter}
                  title={
                    run ? '已经在虫洞里了' : pilotBusy ? `主控正在${pilotBusy}：先收工` : undefined
                  }
                >
                  进入虫洞
                </button>
                <span className="app-dim">编队 {picked.length} / {WORMHOLE_MAX_SHIPS} 艘</span>
              </div>
            </div>
          ) : null}

          {tab === 'map' && run ? (
            <div className="app-wh-run">
              <div className="app-wh-head">
                <span className="app-wh-cell">第 <b>{run.depth}</b> 层</span>
                <span className="app-wh-cell">
                  已探明 <b>{grid ? grid.visited.length : 0}</b> / {grid ? grid.cells.length : 0} 格
                </span>
                <span className="app-wh-cell">
                  已扫描 <b>{grid ? grid.scanned.length : 0}</b> 格
                </span>
                <span className="app-wh-cell">回合 <b>{run.turnsLeft}</b> / {run.turnsTotal}</span>
                <span className="app-wh-cell">背包 <b>{usage?.used ?? 0}</b> / {usage?.capacity ?? 0} 格</span>
                <span className="app-wh-cell">本层威胁 <b>{wormholeLayerThreat(run.depth)}</b></span>
              </div>
              {grid && hereCell ? (
                <>
                  <div className="app-wh-mapbox">
                    <WhGridMap grid={grid} onPickCell={pickCell} />
                  </div>
                  <div className="app-wh-legend">
                    {GRID_LEGEND.map((l) => (
                      <span key={l.key} className="app-wh-legend-item">
                        <svg
                          className={`app-wh-legend-glyph is-${l.none ? 'unknown' : (l.signal ?? 'blank')}`}
                          viewBox="-13 -13 26 26"
                          aria-hidden="true"
                        >
                          {l.none ? <polygon points="0,-12 10.39,-6 10.39,6 0,12 -10.39,6 -10.39,-6" /> : <WhGlyph signal={l.signal} />}
                        </svg>
                        {l.text}
                      </span>
                    ))}
                  </div>
                  {pendingCell ? (
                    <div className="app-wh-ask">
                      <span>
                        即将前往<b>未扫描</b>的地点（Q{pendingCell.q} · R{pendingCell.r}）：那里是什么、会不会撞上交火，
                        现在都还不知道。
                      </span>
                      <span className="app-wh-actions">
                        <button
                          className="app-btn is-small is-warn"
                          disabled={!!run.battle || run.turnsLeft < 1}
                          onClick={() => travelTo(pendingCell.q, pendingCell.r, true)}
                        >
                          确认前往（1 回合）
                        </button>
                        <button className="app-btn is-small" onClick={() => setPendingCell(null)}>
                          取消
                        </button>
                      </span>
                    </div>
                  ) : null}
                  <div className="app-wh-actions">
                    <button
                      className="app-btn is-small"
                      disabled={!!run.battle || run.turnsLeft < 1}
                      onClick={doScan}
                      title="扫描当前地点及周围一圈：只揭开还没扫过的格（1 回合）"
                    >
                      扫描（1 回合）
                    </button>
                    <button
                      className="app-btn is-small is-primary"
                      disabled={!!run.battle || !canActivate || run.turnsLeft < 1}
                      onClick={doActivate}
                      title={
                        atExit
                          ? '激活下一层入口：迎战本层守卫（打完才能深入或撤离）'
                          : hereCell.place === 'empty'
                            ? '空信息地点：没有可执行的作业'
                            : grid.activated.includes(hereKey)
                              ? '这个地点已经处理过了'
                              : '激活当前地点：按地点类型开战 / 打捞 / 挖掘（1 回合）'
                      }
                    >
                      激活此地（1 回合）
                    </button>
                    {bossDone ? (
                      <button
                        className="app-btn is-small is-primary"
                        disabled={!!run.battle || run.turnsLeft <= 0}
                        onClick={doDescend}
                        title="带着当前进度深入下一层（更深、更值钱、更硬）"
                      >
                        继续深入（第 {run.depth + 1} 层 · 威胁 {wormholeLayerThreat(run.depth + 1)}）
                      </button>
                    ) : null}
                    <button
                      className="app-btn is-small"
                      disabled={!!run.battle || (!outOfTurns && !bossDone)}
                      onClick={doExtract}
                      title={
                        outOfTurns
                          ? '回合已走不动：只能撤离（撤离拦截照打）'
                          : bossDone
                            ? '进入撤离战：打赢才把背包带回港'
                            : '先清掉本层守卫（它堵在下一层入口上）'
                      }
                    >
                      撤离
                    </button>
                    <span className="app-dim">点格子前往（不限距离 · 1 回合）</span>
                  </div>
                  <div className="app-wh-node">
                    <div className="app-wh-node-title">
                      {atExit ? '下一层入口' : WORMHOLE_PLACE_TEXT[hereCell.place]}
                      <span className="app-dim">
                        {' '}· 坐标 Q{grid.pos.q} · R{grid.pos.r}
                        {grid.activated.includes(hereKey) ? ' · 已处理' : ''}
                      </span>
                    </div>
                    {(hereCell.piles ?? []).length > 0 ? (
                      <ul className="app-inv-list">
                        {(hereCell.piles ?? []).map((p, i) => {
                          const def = ctx.items.get(p.itemId)
                          const slotUse = wormholeUnitsPerSlot(def?.unitM3 ?? 0)
                          return (
                            <li key={`${p.itemId}-${i}`} className="app-inv-row">
                              <div className="app-inv-main">
                                <span className="app-inv-name">
                                  {def?.name ?? p.itemId} ×{n(p.units)}
                                </span>
                                <span className="app-inv-count">
                                  {n(p.units * (def?.unitM3 ?? 0))} m³ · 每格 {n(slotUse)} 单位
                                </span>
                              </div>
                              <div className="app-inv-btns">
                                <button
                                  className="app-btn is-small"
                                  onClick={() => {
                                    const r = engine.wormholeTakePile(i)
                                    if (!r.ok) onToast(r.error ?? '拾取失败。', true)
                                  }}
                                >
                                  拾取
                                </button>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    ) : (
                      <div className="app-dim app-note">{PLACE_NOTE[hereCell.place]}</div>
                    )}
                  </div>
                  {bossDone ? (
                    <div className="app-dim app-note">
                      本层守卫已清：可以「继续深入」（更深、更值钱、更硬），也可以把剩下的地点再扫一遍，或直接撤离。
                    </div>
                  ) : null}
                  {outOfTurns ? (
                    <div className="app-wh-ask">回合已走不动：只能撤离（撤离拦截照打——打赢才算把背包带回去）。</div>
                  ) : null}
                </>
              ) : (
                <div className="app-wh-node">
                  <div className="app-wh-node-title">本层没有网格</div>
                  <div className="app-dim app-note">
                    这一层是旧口径（线性节点）的存档：可以照旧撤离或深入，重新进洞后会拿到网格地图。
                  </div>
                  <div className="app-wh-actions">
                    <button
                      className="app-btn is-small"
                      disabled={!!run.battle || (!outOfTurns && !bossDone)}
                      onClick={doExtract}
                    >
                      撤离
                    </button>
                    <button
                      className="app-btn is-small is-primary"
                      disabled={!!run.battle || run.turnsLeft <= 0 || !bossDone}
                      onClick={doDescend}
                    >
                      继续深入
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {tab === 'bag' && run ? (
            <WhBag engine={engine} />
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * **层内网格地图**（F3a-2 · 船长 2026-09-13：「探索采用网格地图的形式。整体网格地图呈现圆型」）。
 *
 * 画法：尖顶六边形（pointy-top）铺成半径为 `grid.radius` 的**圆盘**；一格 = 一个地点。
 * 三档揭示（`revealOf` 同源）：
 * - **未扫描** = 虚线空hex，点了先弹「前往未知地点」的警告；
 * - **已扫描** = 只给信号符号（残骸/舰船/资源/雷达；**空信息地点给一个小圆点**）；
 * - **已到达** = 真相（地点名看下方卡片；入口格额外画箭头）。
 * 玩家所在格用虚线圈标出；**下一层入口只在到达之后才标出来**（船长：「玩家只有到达目标地点后
 * 才能知道目标地点的确切信息」⇒ 没到过就不该在图上被指出来）。
 *
 * ⚠ 视觉纪律：图形一律 SVG 线稿（约定 §九），不用 CSS 拼形状；颜色只给信号类别分色。
 */
function WhGridMap({ grid, onPickCell }: { grid: WormholeGridState; onPickCell: (q: number, r: number) => void }) {
  const size = 30
  const R = Math.max(1, Math.floor(grid.radius))
  // 画布留白按半径算（六边形顶点正好落在边界上会显得挤）；容器高随圈数长一点但有上限
  // ⇒ 每格在屏幕上的边长尽量稳定（R=2 约 60px / R=4 约 46px），避免深层的格子小到点不准。
  const w = Math.sqrt(3) * size * (2 * R + 1.3)
  const h = size * (3 * R + 2.4)
  const mapH = Math.min(420, 150 + 30 * (2 * R + 1))
  const cx = w / 2
  const cy = h / 2
  // 六边形顶点（尖顶：上下各一个顶点、左右是平边）
  const corners = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30)
    return { dx: Math.cos(a) * size, dy: Math.sin(a) * size }
  })
  const hereKey = `${grid.pos.q},${grid.pos.r}`
  const exitKey = `${grid.exit.q},${grid.exit.r}`
  return (
    <svg
      className="app-wh-map"
      style={{ height: `${mapH}px` }}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`第 ${grid.radius} 圈网格地图`}
    >
      {grid.cells.map((c) => {
        const x = cx + Math.sqrt(3) * size * (c.q + c.r / 2)
        const y = cy + 1.5 * size * c.r
        const visited = grid.visited.includes(c.key)
        const scanned = grid.scanned.includes(c.key)
        const signal = signalOfPlace(c.place)
        // 入口：**到达过**或**被漂浮信标标出来**（船长 2026-09-13 新增信标）⇒ 地图上一直标着
        const isExit = c.key === exitKey && (visited || grid.exitKnown === true)
        const cls = [
          'app-wh-hex',
          visited ? 'is-known' : scanned ? 'is-scanned' : 'is-unknown',
          signal ? `is-${signal}` : 'is-blank',
          c.key === hereKey ? 'is-here' : '',
          isExit ? 'is-exit' : '',
        ]
          .filter((s) => s.length > 0)
          .join(' ')
        const title = !visited && !scanned
          ? '未扫描：不知道这里有什么'
          : isExit
            ? '下一层入口（层末守卫守在这里）'
            : visited
              ? WORMHOLE_PLACE_TEXT[c.place]
              : signal
                ? `${SIGNAL_TEXT[signal]}（还没到达，详情未知）`
                : '没有信号：空信息地点'
        return (
          <g key={c.key} className={cls} onClick={() => onPickCell(c.q, c.r)}>
            <polygon points={corners.map((p) => `${(x + p.dx).toFixed(2)},${(y + p.dy).toFixed(2)}`).join(' ')} />
            {visited || scanned ? (
              <g className="app-wh-hex-glyph" transform={`translate(${x.toFixed(2)},${y.toFixed(2)})`}>
                <WhGlyph signal={signal} exit={isExit} />
              </g>
            ) : null}
            {c.key === hereKey ? <circle className="app-wh-hex-here" cx={x} cy={y} r={size * 0.74} /> : null}
            <title>{title}</title>
          </g>
        )
      })}
    </svg>
  )
}

/**
 * 格内符号（**一律 SVG 线稿**，以格心为原点、半径约 7~8）。
 * `exit` = 下一层入口（箭头）；`signal === null` = 空信息地点（一个小空心点）；
 * `beacon` = 漂浮信标（灯塔塔身 + 两道扫描光）。
 */
function WhGlyph({ signal, exit }: { signal: WormholeSignal | null; exit?: boolean }) {
  if (exit) return <path d="M-7,0 L6,0 M1,-5 L7,0 L1,5" />
  if (signal === 'wreck') return <path d="M-8,3 L-4,-3 L0,2 L4,-4 L8,3" />
  if (signal === 'ship') return <path d="M-7,-5 L8,0 L-7,5 Z" />
  if (signal === 'resource') return <path d="M0,-7 L7,0 L0,7 L-7,0 Z" />
  if (signal === 'radar')
    return (
      <>
        <path d="M-7,4 A7,7 0 0 1 7,4" />
        <path d="M-3.4,4 A3.4,3.4 0 0 1 3.4,4" />
        <circle cx={0} cy={4} r={1.4} />
      </>
    )
  if (signal === 'beacon')
    return (
      <>
        <path d="M-3.6,7 L-1.8,-2 L1.8,-2 L3.6,7 Z" />
        <path d="M-7,-5 L-2.6,-3.4 M7,-5 L2.6,-3.4" />
        <path d="M-1.8,-2 L1.8,-2" />
      </>
    )
  return <circle cx={0} cy={0} r={2.2} />
}

/** 信号名（图例与悬浮提示共用；与 `WORMHOLE_PLACE_TEXT` 分开：信号 ≠ 地点真相） */
const SIGNAL_TEXT: Readonly<Record<WormholeSignal, string>> = {
  wreck: '残骸信号',
  ship: '舰船信号',
  resource: '资源信号',
  radar: '雷达信号',
  beacon: '信标信号',
}

/** 地图图例（与格内符号共用同一个 `WhGlyph` ⇒ 图例与看板永远一致） */
const GRID_LEGEND: ReadonlyArray<{ key: string; text: string; signal: WormholeSignal | null; none?: boolean }> = [
  { key: 'unknown', text: '未扫描', signal: null, none: true },
  { key: 'wreck', text: SIGNAL_TEXT.wreck, signal: 'wreck' },
  { key: 'ship', text: SIGNAL_TEXT.ship, signal: 'ship' },
  { key: 'resource', text: SIGNAL_TEXT.resource, signal: 'resource' },
  { key: 'radar', text: SIGNAL_TEXT.radar, signal: 'radar' },
  { key: 'beacon', text: SIGNAL_TEXT.beacon, signal: 'beacon' },
  { key: 'blank', text: '空信息', signal: null },
]

/** 地点说明（看板一处说清"这里有什么/能干什么"；具体收益落地在 F3b） */
const PLACE_NOTE: Readonly<Record<WormholePlace, string>> = {
  empty: '空信息地点：什么都没有，没有可执行的作业。',
  graveyard: '舰船墓场：大量残骸、少量稀有残骸——激活后开始打捞。',
  ruins: '遗迹：稀有残骸为主，有小概率拿到一次性图纸或虫洞专属装备；打捞结束大概率触发一场恶战。',
  ship: '舰船信号：到达即交火；打赢固定获得残骸与稀有残骸。',
  vein: '矿脉：激活后挖掘，可得虚空母矿。',
  matter: '虫洞谜质：取回后，本趟探索中我方所有舰船获得指定增强。',
  beacon: '漂浮信标：到达即读出它标出的下一层入口位置（地图上会一直标着）。',
}
/**
 * 背包网格：每格只装一种物品（`WormholeBagSlot` 一条 = 一格的内容，同物品并格）。
 * 空位补到容量上限（最多画 120 格——设计稿 §七：21~120 格，超过再谈虚拟化）。
 */
function WhBag({ engine }: { engine: GameEngine }) {
  const state = engine.state
  const ctx = engine.ctx
  const run = state.wormhole.run!
  const cap = wormholeBagSlots(wormholeFleetCargoM3(state, ctx, run.fleet))
  const usage = wormholeBagUsage(ctx, run.bag, cap)
  const cells: Array<{ itemId: string; units: number; slots: number } | null> = []
  for (const s of run.bag) {
    const def = ctx.items.get(s.itemId)
    cells.push({ itemId: s.itemId, units: s.units, slots: Math.ceil(s.units / Math.max(1, wormholeUnitsPerSlot(def?.unitM3 ?? 0))) })
  }
  const drawn = Math.min(Math.max(cap, cells.length), 120)
  while (cells.length < drawn) cells.push(null)
  return (
    <div className="app-wh-bag">
      <div className="app-bay-title">
        背包 · 已用 {usage.used} / 共 {cap} 格{usage.overflow ? '（已溢出）' : ''}
      </div>
      <div className="app-dim app-note">
        每格 {n(WORMHOLE_SLOT_M3)} m³ 且「只装一种物品」；虫洞内只出「原矿」（虚空母矿，1 m³/单位 ⇒ 每格 500 单位）。
      </div>
      <div className="app-wh-bag-grid">
        {cells.map((c, i) => (
          <div key={i} className={`app-wh-bag-cell${c ? ' is-full' : ''}`} title={c ? `${ctx.items.get(c.itemId)?.name ?? c.itemId} ×${n(c.units)}` : '空格'}>
            {c ? (
              <>
                <span className="app-wh-bag-name">{ctx.items.get(c.itemId)?.name ?? c.itemId}</span>
                <span className="app-wh-bag-units">×{n(c.units)}</span>
              </>
            ) : (
              <span className="app-dim">空</span>
            )}
          </div>
        ))}
      </div>
      {run.bag.length === 0 ? <div className="app-dim app-inv-empty">背包是空的：去拾取点搬原矿。</div> : null}
    </div>
  )
}
