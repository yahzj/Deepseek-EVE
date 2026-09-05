/**
 * 工业页：精炼炉（多工位并行卡片网格）+ 蓝图书架 + 蓝图制造台。
 *
 * 精炼模型（2026-09-04 船长定稿运转周期制；2026-09-05 船长拍板多工位并行）：
 * - 每个资源（矿石/气体/冰矿）或残骸型号至多一台炉，可同时运转多台；
 * - 劳动者 = 主控亲自运转（全局限 1 台、占主控工作位，期间不可离港作业）或
 *   一枚 AI 核心驱动（每台一枚闲置核心；核心出库占用、不占副船名额，库存即并行上限）；
 * - 固定批量循环：启动即把"货仓+仓库"当前全部库存锁定入炉，每批到点按收率出货并自动
 *   续批，直到料尽自动停炉；停炉即止：已完成批已出货、剩余料全额退回（核心归还）。
 * - 页面布局 = 矿带卡同款：资源卡常驻网格；运转中的卡不改样式，只把操作按钮变为「停炉」。
 */
import {
  RECYCLE_BATCH_M3,
  RECYCLE_CYCLE_MS,
  aiCoreName,
  aiEfficiency,
  countAiCore,
  oreAvailable,
  refineRate,
} from '@whale/core'
import type { AiCoreType, GameState, ItemDef } from '@whale/core'
import { Panel } from '@whale/ui'
import { useState, type ReactNode } from 'react'
import { BlueprintShelfPanel, ManufacturingPanel } from '../panels/Industry'
import type { GameEngine } from '../game/engine'
import type { PageProps } from './common'
import { MONEY_GLYPH, m3 } from './common'

const CORE_ORDER: AiCoreType[] = ['basic', 'gamma', 'beta', 'alpha']

/** 主控此刻不能"亲自运转一台新炉"的原因（null = 主控空闲可开；AI 核心驱动不受此限） */
function manualBusyNote(state: GameState): string | null {
  if (state.awayGalaxy !== null) return '你不在母港——先返航。'
  if (state.mining.active) return '采矿作业中：先停止开采。'
  if (state.salvaging.active) return '打捞作业中：先停止打捞（或等满仓自动返航）。'
  if (state.expedition.active) return '远征中：先召回或等待结束。'
  if (state.scanning.active) return '扫描探索中：先终止扫描。'
  if (state.standby.active) return '待命行程中：先召回。'
  if (state.transit.active) return '返航途中：到站后再运转。'
  return null
}

/**
 * 一张精炼炉卡片（矿石/气体/冰/残骸统一；矿带卡信息分区）。
 * 运转中的卡：样式不动，只把操作区按钮变为「停炉」+ 数据行显示运行进度（船长 2026-09-05）。
 */
function FurnaceCard({ def, engine, onToast }: { def: ItemDef; engine: GameEngine; onToast: PageProps['onToast'] }): ReactNode {
  const state = engine.state
  const isWreck = def.kind === 'wreck'
  const rate = refineRate(state, engine.ctx)
  const total = oreAvailable(state, def.id)
  // 该资源是否已有一台炉在运转（多工位：本卡命中才显示停炉）
  const running = engine.refineRunViews().find((v) => v.itemId === def.id)
  // 每卡独立的 AI 核心选择（一枚核心一台炉；核心库存被占用后自动回落可用类型）
  const [coreSel, setCoreSel] = useState<AiCoreType>('basic')
  const usableCores = CORE_ORDER.filter((t) => countAiCore(state, t) > 0)
  const core = usableCores.includes(coreSel) ? coreSel : (usableCores[0] ?? null)
  // 手动运转禁用原因：主控已亲自开着一台 / 其它主控作业占用
  const manualNote = running
    ? null
    : state.refineRuns.some((r) => r.worker === 'pilot')
      ? '你已亲自运转着一台炉：先停它才能再亲自开一台（AI 核心不受此限）。'
      : manualBusyNote(state)

  function runWith(worker: AiCoreType | 'pilot'): void {
    const r = isWreck ? engine.startRecycleRunAt(def.id, worker) : engine.startRefineRunAt(def.id, worker)
    if (!r.ok) {
      onToast(r.error ?? '启动失败。', true)
      return
    }
    const who = worker === 'pilot' ? '你亲自运转' : `${aiCoreName(worker)}核心驱动`
    onToast(
      isWreck
        ? `残骸回收启动：${def.name} ${Math.round(total * 10) / 10} m³ 入炉开箱（${who}，到点自动续批，料尽自动停炉）。`
        : `精炼炉启动：${def.name}×${total.toLocaleString('zh-CN')} 入炉（${who}，到点自动续批）。`,
    )
  }
  function stopNow(): void {
    const r = engine.stopRefineRunAt(def.id)
    if (!r.ok) onToast(r.error ?? '停炉失败。', true)
    else onToast('已停炉：已完成批保留，剩余原料退回仓库。')
  }

  // 数据行：运行中 = 进度（批数/炉内余/整炉剩余）；空闲 = 可用量/批参数
  let dataLine: ReactNode
  if (running) {
    dataLine = (
      <>
        {isWreck ? `已开箱 ${running.batchesDone} 批` : `已炼 ${running.batchesDone} 批`} · 炉内余 ×
        {running.lockedQty.toLocaleString('zh-CN')}（每批 {running.batchUnits} / {Math.round(running.cycleMs / 100) / 10} 秒）
        {running.remainingMs > 0 ? ` · 整炉约剩 ${Math.max(1, Math.ceil(running.remainingMs / 1000))} 秒` : ''}
      </>
    )
  } else if (isWreck) {
    dataLine = `可用 ${Math.round(total * 10) / 10} m³ · 每批 ${RECYCLE_BATCH_M3} m³ / ${Math.round(RECYCLE_CYCLE_MS / 1000)} 秒 · 约 ${Math.ceil(total / RECYCLE_BATCH_M3)} 批开完`
  } else {
    const batch = def.refineBatchUnits && def.refineBatchUnits > 0 ? Math.floor(def.refineBatchUnits) : 10
    const cycleS = def.refineCycleMs && def.refineCycleMs > 0 ? Math.round(def.refineCycleMs / 100) / 10 : 6
    dataLine = `可用 ×${total.toLocaleString('zh-CN')}（${m3(total * def.unitM3)}）· 每批 ${batch} 单位 / ${cycleS} 秒 · 约 ${Math.ceil(total / batch)} 批炼完`
  }

  // 效率估价区：精炼卡显示每批产物与 ≈ISK/h（按矿物站内收价，不随市场）；回收卡无确定估值
  let econ: ReactNode = null
  if (!isWreck) {
    const batch = def.refineBatchUnits && def.refineBatchUnits > 0 ? Math.floor(def.refineBatchUnits) : 10
    const cycleMs = def.refineCycleMs && def.refineCycleMs > 0 ? def.refineCycleMs : 6_000
    const outs = (def.refine ?? [])
      .map((row) => {
        const mineral = engine.ctx.items.get(row.mineralId)
        if (!mineral) return null
        const units = Math.floor(batch * row.perOre * rate)
        return units > 0 ? { def: mineral, units } : null
      })
      .filter((x): x is { def: ItemDef; units: number } => x !== null)
    const outText = outs.map((o) => `${o.def.name}×${o.units}`).join('、') || '（收率过低无产出）'
    const batchValue = outs.reduce((s, o) => s + o.units * (o.def.baseSellPriceIsk ?? 0), 0)
    econ = (
      <div className="app-belt-econ">
        <div>♨ 每批产出：{outText}</div>
        {batchValue > 0 ? (
          <div className="app-belt-econ-val" title="按矿物站内收价（不随市场浮动）估算：每批价值 × 每小时批次数">
            {MONEY_GLYPH} ≈{(Math.round(batchValue * (3_600_000 / cycleMs))).toLocaleString('zh-CN')} ISK/h
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="app-belt-card" key={def.id}>
      <div className="app-belt-head">
        <span className="app-belt-name">{isWreck ? `🛰 ${def.name}` : def.name}</span>
      </div>
      <div className="app-belt-desc">
        {isWreck ? '每批开箱 = 保底矿物（按残骸来源星系危险度池）+ 概率彩头（基础件 / 低安 MK2 / 蓝图碎片）' : def.description}
      </div>
      <div className="app-belt-ore">{dataLine}</div>
      {/* 运转中：当前批周期进度条（船长 2026-09-05） */}
      {running ? (
        <div
          className="app-refine-progress"
          title={`当前批进度 ${running.percent}%（每批 ${running.batchUnits} 单位 / ${Math.round(running.cycleMs / 100) / 10} 秒；到点自动续批）`}
        >
          <span className="app-refine-progress-fill" style={{ width: `${running.percent}%` }} />
        </div>
      ) : null}
      {econ}
      <div className="app-belt-actions">
        {running ? (
          <button className="app-btn is-small is-warn" onClick={stopNow} title="停炉：已完成批保留，剩余原料全额退回仓库（AI 核心自动归还）">
            ■ 停炉
          </button>
        ) : (
          <>
            <button
              className="app-btn is-small is-primary"
              disabled={manualNote !== null}
              title={
                manualNote ??
                (isWreck
                  ? '由你亲自运转：锁定全部残骸，循环开箱到料尽（期间不可离港作业）'
                  : '由你亲自运转：锁定全部库存，循环炼到料尽（期间不可离港作业）')
              }
              onClick={() => runWith('pilot')}
            >
              {isWreck ? '手动回收' : '手动运转'}
            </button>
            {usableCores.length > 0 ? (
              <div className="app-belt-ai">
                <select
                  className="app-select"
                  value={core ?? ''}
                  onChange={(e) => setCoreSel(e.target.value as AiCoreType)}
                  title="选择接入这台炉的 AI 核心：一枚核心驱动一台炉（驱动期间该核心被占用；核心库存即并行上限）"
                >
                  {usableCores.map((t) => (
                    <option key={t} value={t}>
                      {aiCoreName(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）
                    </option>
                  ))}
                </select>
                <button
                  className="app-btn is-small"
                  disabled={!core}
                  title={core ? '接入 AI 核心自动运转（不占副船与主控；效率越高批周期越短）' : '没有可用 AI 核心'}
                  onClick={() => core && runWith(core)}
                >
                  {isWreck ? 'AI 回收' : 'AI 运转'}
                </button>
              </div>
            ) : (
              <button className="app-btn is-small" disabled title="没有 AI 核心——先在市场购买「基础 AI 核心」（空间站直购）。">
                {isWreck ? 'AI 回收' : 'AI 运转'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function IndustryPage({ engine, onToast }: PageProps) {
  const state = engine.state
  const rate = refineRate(state, engine.ctx)

  const [sec, setSec] = useState<'refine' | 'shelf' | 'craft'>('refine')
  const runViews = engine.refineRunViews()

  /** 货仓+仓库里有货（或在炉中）且带精炼配方的可精炼资源（矿石/气体/冰矿） */
  const oreDefs = engine.items.filter(
    (def) =>
      def.kind !== 'wreck' &&
      def.refine !== undefined &&
      def.refine.length > 0 &&
      (oreAvailable(state, def.id) > 0 || runViews.some((v) => v.itemId === def.id)),
  )
  /** B3：可回收的残骸（货仓+仓库有货或在炉中；残骸计数 = 体积 m³） */
  const wreckDefs = engine.items.filter(
    (def) => def.kind === 'wreck' && (oreAvailable(state, def.id) > 0 || runViews.some((v) => v.itemId === def.id)),
  )

  const runningCount = runViews.length

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
          right={
            <span className="app-dim">
              收率 {Math.round(rate * 100)}%（精炼学 +8%/级 · 高级回收 +4%/级，上限 95%）· 运转 {runningCount} 台
            </span>
          }
        >
          <div className="app-dim app-note">
            多工位并行：每张卡 = 一台炉（同一资源至多一台）。启动即把「当前船货仓 + 物品仓库」的该资源全部锁定入炉，
            按批量周期到点出料并自动续批、料尽自动停炉。劳动者 = 你亲自运转（全局限 1 台，占主控工作位）或每台接入
            一枚闲置 AI 核心（核心库存即并行上限；运转中核心被占用）。卡片数据行与按钮只反映该台炉自身的状态。
          </div>

          {oreDefs.length === 0 && wreckDefs.length === 0 ? (
            <div className="app-dim app-inv-empty">
              没有可精炼/可回收的资源——采集矿石/气体/冰矿，或打捞带回残骸后再来。
            </div>
          ) : null}

          {oreDefs.length > 0 ? (
            <>
              <div className="app-bay-title">♨ 精炼资源（{oreDefs.length}）——循环运转到料尽自动停炉</div>
              <div className="app-belt-grid">
                {oreDefs.map((def) => (
                  <FurnaceCard key={def.id} def={def} engine={engine} onToast={onToast} />
                ))}
              </div>
            </>
          ) : null}

          {wreckDefs.length > 0 ? (
            <>
              <div className="app-bay-title">♻ 残骸回收（{wreckDefs.length}）——开箱：保底矿物 + 彩头</div>
              <div className="app-belt-grid">
                {wreckDefs.map((def) => (
                  <FurnaceCard key={def.id} def={def} engine={engine} onToast={onToast} />
                ))}
              </div>
            </>
          ) : null}
        </Panel>
      )}
    </div>
  )
}
