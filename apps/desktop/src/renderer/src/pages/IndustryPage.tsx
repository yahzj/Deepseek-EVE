/**
 * 工业页：精炼炉（运转周期制：固定批量循环，主控/AI 核心驱动）+ 蓝图书架 + 蓝图制造台。
 *
 * 运转模型（2026-09-04 船长定稿）：
 * - 单工位：同一时刻只运转一种资源；启动 = 把"货仓+仓库"当前全部库存锁定入炉，
 *   每批到点按收率出货并自动续批，直到料尽自动停炉；
 * - 劳动者 = 主控亲自运转（占主控工作位）或一枚 AI 核心驱动（不占副船名额）；
 * - 停炉即止：已完成批已出货，剩余原料全额退回仓库（AI 核心自动归还）。
 */
import { refineRate } from '@whale/core'
import type { AiCoreType } from '@whale/core'
import { Panel } from '@whale/ui'
import { useState } from 'react'
import { BlueprintShelfPanel, ManufacturingPanel } from '../panels/Industry'
import type { PageProps } from './common'
import { m3 } from './common'

const CORE_ORDER: AiCoreType[] = ['basic', 'gamma', 'beta', 'alpha']

export function IndustryPage({ engine, onToast }: PageProps) {
  const state = engine.state
  const rate = refineRate(state, engine.ctx)
  const run = engine.refineRunView()

  // 主控是否空闲（亲自运转的前提：人要在母港且无其它主控作业）
  const pilotFree =
    state.awayGalaxy === null &&
    !state.transit.active &&
    !state.expedition.active &&
    !state.scanning.active &&
    !state.standby.active &&
    !state.mining.active &&
    !state.salvaging.active
  const pilotBusyNote = state.awayGalaxy !== null
    ? '你不在母港——先返航。'
    : state.mining.active
      ? '采矿作业中：先停止开采。'
      : state.salvaging.active
        ? '打捞作业中：先停止打捞（或等满仓自动返航）。'
        : state.expedition.active
          ? '远征中：先召回或等待结束。'
          : state.scanning.active
            ? '扫描探索中：先终止扫描。'
            : state.standby.active
              ? '待命行程中：先召回。'
              : state.transit.active
                ? '返航途中：到站后再运转。'
                : null

  const ownedCores = CORE_ORDER.filter((t) => (state.aiCores[t] ?? 0) > 0)
  const [corePick, setCorePick] = useState<AiCoreType>('basic')
  const [sec, setSec] = useState<'refine' | 'shelf' | 'craft'>('refine')
  const coreReady = ownedCores.includes(corePick) ? corePick : (ownedCores[0] ?? null)

  /** 货仓+仓库里有货且带精炼配方的可精炼资源（矿石/气体/冰矿） */
  const oreDefs = engine.items.filter(
    (def) => (def.refine !== undefined && def.refine.length > 0) && oreTotal(def.id) > 0,
  )
  /** B3：可回收的残骸（货仓+仓库有货；残骸计数 = 体积 m³） */
  const wreckDefs = engine.items.filter((def) => def.kind === 'wreck' && oreTotal(def.id) > 0)
  const isRecycle = state.refineRun.active && state.refineRun.recipe === 'recycle'
  function oreTotal(id: string): number {
    return (state.fleet[state.shipId]?.cargo[id] ?? 0) + (state.warehouse.items[id] ?? 0)
  }

  function start(defId: string, worker: AiCoreType | 'pilot'): void {
    const def = engine.ctx.items.get(defId)
    const total = oreTotal(defId)
    const r = def?.kind === 'wreck' ? engine.startRecycleRunAt(defId, worker) : engine.startRefineRunAt(defId, worker)
    if (!r.ok) {
      onToast(r.error ?? '启动失败。', true)
    } else {
      const who = worker === 'pilot' ? '你亲自运转' : 'AI 核心驱动'
      onToast(
        def?.kind === 'wreck'
          ? `残骸回收启动：${def.name} ${Math.round(total * 10) / 10} m³ 入炉开箱（${who}，到点自动续批，料尽自动停炉）。`
          : `精炼炉启动：${def?.name ?? ''}×${total} 入炉（${who}，到点自动续批）。`,
      )
    }
  }

  function stop(): void {
    const r = engine.stopRefineRunNow()
    if (!r.ok) onToast(r.error ?? '停炉失败。', true)
    else onToast('已停炉：已完成批保留，剩余原料退回仓库。')
  }

  return (
    <div className="page-stack">
      {/* 功能标签页（与星图页同款 app-subtabs 规范）：精炼炉 / 蓝图书架 / 蓝图制造 */}
      <div className="app-subtabs" role="tablist">
        <button
          role="tab"
          aria-selected={sec === 'refine'}
          className={`app-subtab${sec === 'refine' ? ' is-active' : ''}`}
          onClick={() => setSec('refine')}
        >
          <span>♨</span>
          <span>精炼炉</span>
        </button>
        <button
          role="tab"
          aria-selected={sec === 'shelf'}
          className={`app-subtab${sec === 'shelf' ? ' is-active' : ''}`}
          onClick={() => setSec('shelf')}
        >
          <span>▦</span>
          <span>蓝图书架</span>
        </button>
        <button
          role="tab"
          aria-selected={sec === 'craft'}
          className={`app-subtab${sec === 'craft' ? ' is-active' : ''}`}
          onClick={() => setSec('craft')}
        >
          <span>⚒</span>
          <span>蓝图制造</span>
        </button>
      </div>

      {sec === 'craft' ? (
        <ManufacturingPanel engine={engine} onToast={onToast} />
      ) : sec === 'shelf' ? (
        <BlueprintShelfPanel engine={engine} onToast={onToast} />
      ) : (
      <Panel
        title="精炼炉"
        right={<span className="app-dim">收率 {Math.round(rate * 100)}%（精炼学 +8%/级 · 高级回收 +4%/级，上限 95%）</span>}
      >
        <div className="app-dim app-note">
          循环运转制：启动即把「当前船货仓 + 物品仓库」的该资源全部锁定入炉，按固定批量周期到点出矿物并自动续批，
          料尽自动停炉。劳动者 = 你亲自运转（占主控工作位）或接入一枚 AI 核心（不占副船）。
        </div>

        {run.active ? (
          <div className="app-inv-row">
            <div className="app-inv-main">
              <span className="app-inv-name">{run.itemName}</span>
              <span className="app-inv-count">
                {run.workerLabel}驱动 · {isRecycle ? '已开箱' : '已炼'} {run.batchesDone} 批 / 余 ×{run.lockedQty}（每批 {run.batchUnits} 单位 · {Math.round(run.cycleMs / 100) / 10} 秒）
                {run.remainingMs > 0 ? ` · 整炉约剩 ${Math.max(1, Math.ceil(run.remainingMs / 1000))} 秒` : ''}
              </span>
              <div className="app-refine-progress">
                <span className="app-refine-progress-fill" style={{ width: `${run.percent}%` }} />
              </div>
            </div>
            <div className="app-inv-btns">
              <button className="app-btn is-small is-warn" onClick={stop} title="停炉：已完成批保留，剩余原料全额退回仓库（AI 核心自动归还）">
                停炉
              </button>
            </div>
          </div>
        ) : null}

        {!run.active && oreDefs.length === 0 && wreckDefs.length === 0 ? (
          <div className="app-dim app-inv-empty">
            没有可精炼/可回收的资源——采集矿石/气体/冰矿，或打捞带回残骸后再来（先停掉正在运转的炉子）。
          </div>
        ) : null}
        {!run.active && oreDefs.length > 0 ? (
          <ul className="app-inv-list">
            {oreDefs.map((def) => {
              const batch = def.refineBatchUnits && def.refineBatchUnits > 0 ? Math.floor(def.refineBatchUnits) : 10
              const cycleS = def.refineCycleMs && def.refineCycleMs > 0 ? Math.round(def.refineCycleMs / 100) / 10 : 6
              const total = oreTotal(def.id)
              const batchPreview = (def.refine ?? [])
                .map((row) => {
                  const mineral = engine.ctx.items.get(row.mineralId)
                  const units = Math.floor(batch * row.perOre * rate)
                  return units > 0 ? `${mineral?.name ?? row.mineralId}×${units}` : ''
                })
                .filter(Boolean)
                .join('、')
              const batches = Math.ceil(total / batch)
              return (
                <li key={def.id} className="app-inv-row">
                  <div className="app-inv-main">
                    <span className="app-inv-name">{def.name}</span>
                    <span className="app-inv-count">
                      可用 ×{total.toLocaleString('zh-CN')}（{m3(total * def.unitM3)}）· 每批 {batch} 单位 / {cycleS} 秒 · 约 {batches} 批炼完
                      （每批产出 {batchPreview || '（收率过低无产出）'}）
                    </span>
                  </div>
                  <div className="app-inv-btns">
                    <button
                      className="app-btn is-small is-primary"
                      disabled={!pilotFree}
                      title={pilotFree ? '由你亲自运转：锁定全部库存，循环炼到料尽（期间不可离港作业）' : pilotBusyNote ?? undefined}
                      onClick={() => start(def.id, 'pilot')}
                    >
                      手动运转
                    </button>
                    {ownedCores.length > 0 ? (
                      <>
                        <select
                          className="app-dim"
                          value={coreReady ?? ''}
                          onChange={(e) => setCorePick(e.target.value as AiCoreType)}
                          title="选择接入精炼炉的 AI 核心（驱动期间核心被占用）"
                        >
                          {ownedCores.map((t) => (
                            <option key={t} value={t}>
                              {t === 'basic' ? '基础' : t === 'gamma' ? '伽马' : t === 'beta' ? '贝塔' : '阿尔法'}核心
                            </option>
                          ))}
                        </select>
                        <button
                          className="app-btn is-small"
                          title="接入 AI 核心自动运转（不占副船与主控；效率越高批周期越短）"
                          onClick={() => coreReady && start(def.id, coreReady)}
                        >
                          AI 运转
                        </button>
                      </>
                    ) : (
                      <button className="app-btn is-small" disabled title="没有 AI 核心——先在市场购买「基础 AI 核心」（空间站直购）。">
                        AI 运转
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}

        {/* B3 残骸回收（开箱：保底矿物 + 彩头；残骸计数 = 体积，批 10 m³ / 25 秒） */}
        {!run.active && wreckDefs.length > 0 ? (
          <>
            <div className="app-bay-title">♻ 残骸回收（开箱：保底矿物 + 彩头）</div>
            <ul className="app-inv-list">
              {wreckDefs.map((def) => {
                const total = oreTotal(def.id)
                return (
                  <li key={def.id} className="app-inv-row">
                    <div className="app-inv-main">
                      <span className="app-inv-name">🛰 {def.name}</span>
                      <span className="app-inv-count">
                        可用 {Math.round(total * 10) / 10} m³ · 每批 10 m³ / 25 秒 · 每批开箱 = 保底矿物（按来源星系危险度池）+ 概率彩头（基础件 / 低安 MK2 / 蓝图碎片）
                      </span>
                    </div>
                    <div className="app-inv-btns">
                      <button
                        className="app-btn is-small is-primary"
                        disabled={!pilotFree}
                        title={pilotFree ? '由你亲自运转：锁定全部残骸，循环开箱到料尽（期间不可离港作业）' : pilotBusyNote ?? undefined}
                        onClick={() => start(def.id, 'pilot')}
                      >
                        手动回收
                      </button>
                      {ownedCores.length > 0 ? (
                        <>
                          <select
                            className="app-dim"
                            value={coreReady ?? ''}
                            onChange={(e) => setCorePick(e.target.value as AiCoreType)}
                            title="选择接入精炼炉的 AI 核心（驱动期间核心被占用）"
                          >
                            {ownedCores.map((t) => (
                              <option key={t} value={t}>
                                {t === 'basic' ? '基础' : t === 'gamma' ? '伽马' : t === 'beta' ? '贝塔' : '阿尔法'}核心
                              </option>
                            ))}
                          </select>
                          <button
                            className="app-btn is-small"
                            title="接入 AI 核心自动开箱（不占副船与主控；效率越高批周期越短）"
                            onClick={() => coreReady && start(def.id, coreReady)}
                          >
                            AI 回收
                          </button>
                        </>
                      ) : (
                        <button className="app-btn is-small" disabled title="没有 AI 核心——先在市场购买「基础 AI 核心」（空间站直购）。">
                          AI 回收
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        ) : null}
      </Panel>
      )}
    </div>
  )
}
