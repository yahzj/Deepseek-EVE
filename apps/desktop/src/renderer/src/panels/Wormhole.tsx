/**
 * 终局玩法「虫洞」· 施工期界面（E 批 · 2026-09-13）。
 *
 * ⚠ **可见性铁律（船长 2026-09-13）**：虫洞完成前**对玩家不可见** —— 入口只在**调试模式**下出现
 * （`debugEnabled()`，与调试面板同一开关），数据侧走 `MarketGoodDef.unreleased` 闸门，
 * **拍板前不得出现在玩家可及路径上**。见 `docs/design/wormhole-extraction-endgame-20260912.md`
 * §「可见性与拍板」与 §十（分批落码）。
 *
 * 本批（E）只做**界面 + 交互**：准备页（编队 / 三联读数）· 节点图 · 背包网格 · 拾取。
 * 战斗接入（节点战斗与撤离战）与收益校准在 **F 批**；故战斗/事件节点的按钮标着「F 批接入」，
 * 施工期用「结算本节点」把流程走通（不产生任何结算收益）。
 */
import { useState } from 'react'
import {
  WORMHOLE_ADMISSION_TEXT,
  WORMHOLE_MAX_SHIPS,
  WORMHOLE_SLOT_M3,
  WORMHOLE_TOTAL_MASS_CAP,
  cargoCapacityM3Of,
  shipDisplayName,
  shipSizeLabel,
  wormholeAdmission,
  wormholeBagSlots,
  wormholeBagUsage,
  wormholeFleetCargoM3,
  wormholeFoeThreat,
  wormholeLayerThreat,
  wormholeShipAllowed,
  wormholeShipMass,
  wormholeUnitsPerSlot,
} from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'

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

  const admission = wormholeAdmission(ctx, picked)
  const cargoM3 = wormholeFleetCargoM3(state, ctx, picked)
  const bagSlots = wormholeBagSlots(cargoM3)
  const usage = run ? wormholeBagUsage(ctx, run.bag, wormholeBagSlots(wormholeFleetCargoM3(state, ctx, run.fleet))) : null

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

  return (
    <div className="app-modal-mask" onClick={onClose}>
      <div className="app-modal app-wh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">虫洞</span>
          <span className="app-dim app-wh-devnote">调试入口 · 施工中（拍板后对玩家开放）</span>
          <div className="app-wh-tabs">
            {(Object.keys(TAB_LABEL) as WhTab[]).map((k) => (
              <button
                key={k}
                className={`app-btn is-small${tab === k ? ' is-primary' : ''}`}
                onClick={() => setTab(k)}
                disabled={k !== 'prep' && !run}
                title={k !== 'prep' && !run ? '还没进洞' : undefined}
              >
                {TAB_LABEL[k]}
              </button>
            ))}
          </div>
          <button className="app-btn is-small" onClick={onClose}>
            ✕ 关闭
          </button>
        </div>

        <div className="app-modal-body">
          {tab === 'prep' ? (
            <div className="app-wh-prep">
              <div className="app-bay-title">准备 · 选编队（最多 {WORMHOLE_MAX_SHIPS} 艘）</div>
              <div className="app-dim app-note">
                带入舰船按「级别折算质量」压塌虫洞入口：旗舰（T5）进不去，总质量超过 {n(WORMHOLE_TOTAL_MASS_CAP)} 也进不去；
                总质量越高、可探索回合越短；背包格数按编队「合计货仓」折算（每 {n(WORMHOLE_SLOT_M3)} m³ = 1 格，含技能与货舱件加成）。
              </div>
              <ul className="app-inv-list app-wh-ships">
                {Object.keys(state.fleet).map((uid) => {
                  const def = ctx.ships.get(state.fleet[uid]!.defId ?? uid)
                  const tier = def?.tier ?? 0
                  const ok = def ? wormholeShipAllowed(def) : false
                  const on = picked.includes(uid)
                  return (
                    <li key={uid} className={`app-inv-row${on ? ' is-picked' : ''}`}>
                      <div className="app-inv-main">
                        <span className="app-inv-name">
                          {shipDisplayName(state, ctx, uid)}
                          <span className="app-dim"> · {shipSizeLabel(tier)} T{tier}</span>
                        </span>
                        <span className="app-inv-count">
                          折算质量 {def ? n(wormholeShipMass(def)) : '—'} · 货仓 {n(cargoCapacityM3Of(state, ctx, uid))} m³
                        </span>
                      </div>
                      <div className="app-inv-btns">
                        <button
                          className={`app-btn is-small${on ? ' is-primary' : ''}`}
                          disabled={!ok}
                          onClick={() => togglePick(uid)}
                          title={ok ? undefined : '该舰过重，会压塌虫洞入口（最多带到 T4）'}
                        >
                          {on ? '已选' : ok ? '编入' : '过重'}
                        </button>
                      </div>
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
              <div className="app-wh-actions">
                <button
                  className="app-btn is-primary is-small"
                  disabled={!admission.ok || !!run}
                  onClick={handleEnter}
                  title={run ? '已经在虫洞里了' : undefined}
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
                <span className="app-wh-cell">节点 <b>{Math.min(run.nodeIndex + 1, run.nodesPerLayer)}</b> / {run.nodesPerLayer}</span>
                <span className="app-wh-cell">回合 <b>{run.turnsLeft}</b> / {run.turnsTotal}</span>
                <span className="app-wh-cell">背包 <b>{usage?.used ?? 0}</b> / {usage?.capacity ?? 0} 格</span>
                <span className="app-wh-cell">本层威胁 <b>{wormholeLayerThreat(run.depth)}</b></span>
              </div>
              <WhNodeMap depth={run.depth} nodesPerLayer={run.nodesPerLayer} nodeIndex={run.nodeIndex} atLayerEnd={!run.pendingNode} />
              {run.phase === 'extracting' ? (
                <div className="app-wh-node">
                  <div className="app-wh-node-title">撤离战</div>
                  <div className="app-dim app-note">
                    撤离战尚未接入（施工中）：当前只把相位切到「撤离中」，不发生战斗与结算。
                  </div>
                  <div className="app-wh-actions">
                    <button
                      className="app-btn is-small is-warn"
                      onClick={() => {
                        engine.wormholeDebugReset()
                        onToast('已放弃本趟探索（调试用）。', true)
                        setTab('prep')
                      }}
                    >
                      放弃本趟（调试）
                    </button>
                  </div>
                </div>
              ) : run.pendingNode ? (
                <div className="app-wh-node">
                  <div className="app-wh-node-title">
                    {run.pendingNode.kind === 'combat'
                      ? `战斗节点 · ${run.pendingNode.waves} 波`
                      : run.pendingNode.kind === 'pickup'
                        ? '拾取点'
                        : '随机事件'}
                    <span className="app-dim"> · 结算花 {run.pendingNode.cost} 回合</span>
                  </div>
                  {run.pendingNode.kind === 'pickup' ? (
                    <ul className="app-inv-list">
                      {(run.pendingNode.piles ?? []).length === 0 ? (
                        <li className="app-dim app-inv-empty">这一堆都搬空了——结算本节点继续前进。</li>
                      ) : (
                        (run.pendingNode.piles ?? []).map((p, i) => {
                          const def = ctx.items.get(p.itemId)
                          const slotUse = wormholeUnitsPerSlot(def?.unitM3 ?? 0)
                          return (
                            <li key={`${p.itemId}-${i}`} className="app-inv-row">
                              <div className="app-inv-main">
                                <span className="app-inv-name">{def?.name ?? p.itemId} ×{n(p.units)}</span>
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
                        })
                      )}
                    </ul>
                  ) : (
                    <div className="app-dim app-note">
                      {run.pendingNode.kind === 'combat'
                        ? '战斗节点：点「迎战」按本节点波数开打（4 艘一起上）。'
                        : `事件池键：${run.pendingNode.eventKey ?? '—'}（事件内容尚未接入）。`}
                    </div>
                  )}
                  <div className="app-wh-actions">
                    {run.pendingNode.kind === 'combat' ? (
                      <button
                        className="app-btn is-small is-primary"
                        disabled={!!run.battle}
                        onClick={() => {
                          const r = engine.wormholeFight('node')
                          if (!r.ok) onToast(r.error ?? '无法开战。', true)
                        }}
                        title="开打本节点：战斗结束后自动结算该节点（扣回合、推进）"
                      >
                        迎战（{run.pendingNode.waves} 波 · 结算花 {run.pendingNode.cost} 回合）
                      </button>
                    ) : (
                      <button
                        className="app-btn is-small is-primary"
                        disabled={!!run.battle}
                        onClick={() => {
                          const r = engine.wormholeAdvance()
                          if (!r.ok) onToast(r.error ?? '无法推进。', true)
                        }}
                        title="结算本节点并推进到下一个节点（回合不足时只能撤离）"
                      >
                        结算本节点（{run.pendingNode.cost} 回合）
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="app-wh-node">
                  <div className="app-wh-node-title">
                    层末抉择
                    {(run.bossCleared ?? 0) < run.depth ? (
                      <span className="app-dim"> · 层末守卫尚未清除</span>
                    ) : null}
                  </div>
                  <div className="app-dim app-note">
                    {(run.bossCleared ?? 0) < run.depth
                      ? '层内节点已走完，但出口被本层守卫堵着：先「迎击层末守卫」，打完才能选择深入或撤离。'
                      : '本层守卫已清：可以「继续深入」（更深、更值钱、更硬）或「撤离」（进入撤离战后带着背包回港）。'}
                  </div>
                  <div className="app-wh-actions">
                    {(run.bossCleared ?? 0) < run.depth ? (
                      <button
                        className="app-btn is-small is-primary"
                        disabled={!!run.battle}
                        onClick={() => {
                          const r = engine.wormholeFight('boss')
                          if (!r.ok) onToast(r.error ?? '无法开战。', true)
                        }}
                      >
                        迎击层末守卫（威胁 {wormholeFoeThreat(run.depth, 'boss')}）
                      </button>
                    ) : null}
                    <button
                      className="app-btn is-small is-primary"
                      disabled={run.turnsLeft <= 0 || (run.bossCleared ?? 0) < run.depth}
                      title={
                        (run.bossCleared ?? 0) < run.depth
                          ? '先清掉本层守卫'
                          : run.turnsLeft <= 0
                            ? '回合已耗尽：只能撤离'
                            : undefined
                      }
                      onClick={() => {
                        const r = engine.wormholeDescend()
                        if (!r.ok) onToast(r.error ?? '无法深入。', true)
                      }}
                    >
                      继续深入（第 {run.depth + 1} 层 · 威胁 {wormholeLayerThreat(run.depth + 1)}）
                    </button>
                    <button
                      className="app-btn is-small"
                      disabled={(run.bossCleared ?? 0) < run.depth}
                      onClick={() => {
                        const r = engine.wormholeExtract()
                        if (!r.ok) onToast(r.error ?? '无法撤离。', true)
                      }}
                    >
                      撤离
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
 * 节点图（SVG 线稿：圆点节点 + 连线；当前节点高亮、已过节点变暗）。
 * 口径：只画**本层**的节点（`nodesPerLayer`），层数由标题栏的「第 N 层」表达。
 */
function WhNodeMap({
  depth,
  nodesPerLayer,
  nodeIndex,
  atLayerEnd,
}: {
  depth: number
  nodesPerLayer: number
  nodeIndex: number
  atLayerEnd: boolean
}) {
  const n = Math.max(1, nodesPerLayer)
  const w = 720
  const h = 96
  const y = 46
  const step = n > 1 ? (w - 120) / (n - 1) : 0
  const xs = Array.from({ length: n }, (_, i) => (n > 1 ? 60 + step * i : w / 2))
  const cur = Math.min(nodeIndex, n - 1)
  return (
    <svg className="app-wh-map" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`第 ${depth} 层节点图`}>
      {/* 连线 */}
      {xs.slice(0, -1).map((x, i) => (
        <line
          key={`l${i}`}
          x1={x + 16}
          y1={y}
          x2={xs[i + 1]! - 16}
          y2={y}
          stroke="currentColor"
          strokeWidth={1}
          opacity={i < cur ? 0.75 : 0.3}
        />
      ))}
      {xs.map((x, i) => {
        const passed = i < cur
        const here = i === cur && !atLayerEnd
        return (
          <g key={`n${i}`} opacity={passed ? 0.45 : 1}>
            <circle
              cx={x}
              cy={y}
              r={here ? 11 : 8}
              fill="none"
              stroke="currentColor"
              strokeWidth={here ? 2 : 1}
            />
            {here ? <circle cx={x} cy={y} r={3.5} fill="currentColor" /> : null}
            <text x={x} y={y + 28} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.8}>
              {i + 1}
            </text>
          </g>
        )
      })}
      {/* 层末抉择位（徽标） */}
      <g opacity={atLayerEnd ? 1 : 0.35}>
        <rect x={w - 40} y={y - 12} width={26} height={24} rx={4} fill="none" stroke="currentColor" />
        <text x={w - 27} y={y + 4} textAnchor="middle" fontSize={12} fill="currentColor">
          末
        </text>
      </g>
    </svg>
  )
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
