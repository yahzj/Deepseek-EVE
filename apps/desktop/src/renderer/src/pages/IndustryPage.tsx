/**
 * 工业页：精炼炉（多工位并行卡片网格）+ 蓝图书架 + 组装机。
 *
 * 精炼模型（2026-09-04 船长定稿运转周期制；2026-09-05 船长拍板多工位并行）：
 * - 每个资源（矿石/气体/冰矿）或残骸型号至多一台炉，可同时运转多台；
 * - 劳动者 = 主控亲自运转（全局限 1 台、占主控工作位，期间不可离港作业）或
 *   一枚 AI 核心驱动（每台一枚闲置核心；核心出库占用、不占副船名额，库存即并行上限）；
 * - 固定批量循环：启动即把"货仓+仓库"当前全部库存锁定入炉，每批到点按产出倍率出货并自动
 *   续批，直到料尽自动停炉；停炉即止：已完成批已出货、剩余料全额退回（核心归还）。
 * - 页面布局 = 矿带卡同款：资源卡常驻网格；运转中的卡不改样式，只把操作按钮变为「停炉」。
 */
// 2026-09-14 虫洞上线后：① 精炼炉的**货柜拆解那一档**常显（本文件已不用调试开关）；
// ② 星图「扫描虫洞」选项卡常显（见 `pages/MapPage.tsx`）；③ 星图行动区的虫洞入口行同批解闸（见 `panels/Expedition.tsx`）。
import {
  RARE_BOX_DRONE_UNITS,
  RECYCLE_BATCH_M3,
  RECYCLE_CYCLE_MS,
  RECYCLE_POOL_AVG_ISK,
  RECYCLE_YIELD_PER_M3,
  recycleRefiningMultiplier,
  aiCoreName,
  aiEfficiency,
  countAiCore,
  countWare,
  oreAvailable,
  RARE_WRECK_VOLUME_M3,
  recycleMineralPoolOf,
  recycleProfileOf,
  refineRate,
  // 2026-09-13：未上线资源不进"可精炼资源"网格 / 材料跳转（施工期闸门）
  visibleItemDefs,
} from '@whale/core'
import type { AiCoreType, GameState, ItemDef } from '@whale/core'
import { Panel } from '@whale/ui'
import { useEffect, useState, type ReactNode } from 'react'
import { BlueprintShelfPanel, ManufacturingPanel } from '../panels/Industry'
import type { GameEngine } from '../game/engine'
import { MarkStar, pinMarked } from '../ui/marks'
import { AiSlotText } from '../ui/aiSlots'
import { RowGlyph } from '../ui/itemView'
import { HintIcon } from '../ui/Hint'
import { FlavorTip, mineralRowsOf, recycleFeatureOf } from '../ui/wreckFlavor'
import type { PageProps } from './common'
import { MONEY_GLYPH, m3 } from './common'

const CORE_ORDER: AiCoreType[] = ['basic', 'gamma', 'beta', 'alpha']

/**
 * **精炼炉一级筛选标签**（2026-09-14 船长：「精炼炉和组装机一样，添加筛选标签」→
 * 位置澄清「**放进精炼炉内，并更新筛选**」）——按**活计大类**分，与页面里原本的三个小标题一一对应：
 * 全部 / 可精炼资源 / 残骸回收 / 货柜拆解（货柜那一档原先是"施工期只在调试模式出现"，船长 2026-09-14
 * 明示「**虫洞已经做完了…允许对玩家开放**」⇒ 四档一律常显）。
 */
type FurnaceTab = 'all' | 'ore' | 'wreck' | 'box'
const FURNACE_TABS: Array<{ key: FurnaceTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'ore', label: '可精炼资源' },
  { key: 'wreck', label: '残骸回收' },
  { key: 'box', label: '货柜拆解' },
]

/** 二级子筛选的候选（键 = 子筛选键，`''` = 全部子类，与组装机同款口径） */
type SubOpt = { key: string; label: string }
/** 可精炼资源按**资源大类**（只列实际存在的档；`ItemDef.kind` 单点） */
const ORE_KIND_LABEL: Record<string, string> = { ore: '原矿', gas: '气体', ice: '冰矿' }
/** 残骸回收按**档位**（普通 / 稀有·高级箱）——船长 2026-09-14 选甲 */
const WRECK_SUBS: SubOpt[] = [
  { key: 'common', label: '普通残骸' },
  { key: 'rare', label: '稀有 · 高级箱' },
]


/** 主控此刻不能"亲自运转一台新炉"的原因（null = 主控空闲可开；AI 核心驱动不受此限） */
function manualBusyNote(state: GameState): string | null {
  if (state.awayGalaxy !== null) return '你不在空间站（母港或已建成副站）——先返航停靠。'
  if (state.mining.active) return '采矿作业中：先停止开采。'
  if (state.salvaging.active) return '打捞作业中：先停止打捞（或等满仓自动返航）。'
  if (state.expedition.active) return '远征中：先召回或等待结束。'
  if (state.scanning.active) return '扫描探索中：先终止扫描。'
  if (state.standby.active) return '掩护巡逻进行中：先召回。'
  if (state.transit.active) return '返航途中：到站后再运转。'
  return null
}

/**
 * 一张精炼炉卡片（矿石/气体/冰/残骸统一；矿带卡结构 + 每台炉=一个劳动者单位）。
 * v20 语义（船长 2026-09-05）：同资源可多单位同时运转（主控 1 台 + 每枚 AI 核心 1 台）；
 * 2026-09-08 船长定：同时启用的 AI 核心总数受 AI 核心上限技能约束（与 AI 副船任务共用），
 * 核心库存只决定拥有/效率档。
 * 原料不锁定、每批实时扣取——运转中的单位以"名册行"列出（各自批进度条 + 停），
 * 下方按钮可继续加开单位；没有单位的卡保持静态数据与启动区。
 */
function FurnaceCard({ def, engine, onToast, highlight = false, onGotoMap }: { def: ItemDef; engine: GameEngine; onToast: PageProps['onToast']; highlight?: boolean; onGotoMap?: (tab: 'mine' | 'salvage', ids: string[]) => void }): ReactNode {
  const state = engine.state
  const isWreck = def.kind === 'wreck'
  // F4d：安全货柜走「拆解」（与精炼/回收同一条产线机器，90 秒/件）
  const isBox = def.kind === 'container'
  // 残骸回收画像（威胁/星系危险度/特色池；稀有残骸另有 rare 标记与专属装备池）——卡头徽标与估价共用
  const wreckProfile = isWreck ? recycleProfileOf(engine.ctx, def.id) : null
  const isRareBox = wreckProfile?.rare === true
  const rate = refineRate(state, engine.ctx)
  const total = oreAvailable(state, def.id)
  // 2026-09-09 船长定：「去矿带/去打捞」跳转目标——矿石/气体/冰 → 出产该原料的全部主矿带；
  // 残骸 → 其来源敌群星系（recycleProfileOf 一对一；打捞星系须已探索才会出现在星图卡列表）
  const gotoTarget: { tab: 'mine' | 'salvage'; ids: string[] } | null = isWreck
    ? (() => {
        const src = recycleProfileOf(engine.ctx, def.id)
        return src ? { tab: 'salvage' as const, ids: [src.galaxyId] } : null
      })()
    : (() => {
        const belts = engine.belts.filter((b) => b.oreId === def.id)
        return belts.length > 0 ? { tab: 'mine' as const, ids: belts.map((b) => b.id) } : null
      })()
  // 该资源当前全部运转单位（同资源可多台）
  const runs = engine.refineRunViews().filter((v) => v.itemId === def.id)
  const running = runs.length > 0
  // 本卡各炉的**炉内私有料账**合计（2026-09-11 玩家反馈「稀有残骸空了精炼炉还在运转」）：
  // 稀有残骸起炉即把整件预占进本炉料账（货仓/仓库立刻不再显示这批料），界面上必须把它算进来并写明，
  // 否则玩家只看到"残骸 0 m³ + 炉子还在转"。普通残骸/精炼炉的料账恒为 0（照旧走公共库存）。
  const claimHeld = runs.reduce((s, v) => s + (v.claimedUnits ?? 0), 0)
  // 每卡独立的 AI 核心选择（一枚核心驱动一台；核心库存被占用后自动回落可用类型）
  const [coreSel, setCoreSel] = useState<AiCoreType>('basic')
  const usableCores = CORE_ORDER.filter((t) => countAiCore(state, t) > 0)
  const core = usableCores.includes(coreSel) ? coreSel : (usableCores[0] ?? null)
  // 手动再开一台被拒的原因：主控已亲自开着一台炉 / 开着一条制造线 / 其它主控作业占用（三者共享手动工作位）
  // 无公共料时的提示（2026-09-11）：本卡若有炉子正抱着**炉内料账**，就不能写成"仓库里没有原料"（料在炉里）
  const noStockNote =
    claimHeld > 0
      ? '本卡的炉子已把料预占进炉内料账（货仓/仓库不再显示这批料）：等它拆完，或停炉把余料退回后再开新炉'
      : '仓库/货仓里还没有原料：先采集（或从船货仓卸下），到市场购买也行'
  const manualNote = state.refineRuns.some((r) => r.worker === 'pilot')
    ? '你已亲自运转着一台炉：先停它才能再亲自开一台（AI 核心不受此限）。'
    : state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')
      ? '你已亲自开着一条制造线：先取消或等它完成才能亲自开炉（AI 核心不受此限）。'
      : manualBusyNote(state)

  function runWith(worker: AiCoreType | 'pilot'): void {
    const r = isBox
      ? engine.startUnboxRunAt(def.id, worker)
      : isWreck
        ? engine.startRecycleRunAt(def.id, worker)
        : engine.startRefineRunAt(def.id, worker)
    if (!r.ok) {
      onToast(r.error ?? '启动失败。', true)
      return
    }
    const who = worker === 'pilot' ? '由你亲自运转' : `由 ${aiCoreName(worker)}核心驱动`
    onToast(
      isBox
        ? `安全货柜拆解开工：${def.name}（可拆 ${total} 件）${who}；每件 90 秒、拆完自动停。`
        : isWreck
          ? isRareBox
          ? `残骸回收开工：${def.name}。本炉预占 ${Math.min(RARE_WRECK_VOLUME_M3, Math.round(total * 10) / 10)} m³（1 件 = ${RARE_WRECK_VOLUME_M3} m³）转入炉内料账——货仓/仓库不再显示这批料，停炉时未用完部分退回物品仓库。${who}；每批拆 ${RECYCLE_BATCH_M3} m³、料尽自动停。`
          : `残骸回收开工：${def.name}（可拆 ${Math.round(total * 10) / 10} m³，货仓+仓库合计）${who}；每批到点实时扣料、耗尽自动停。`
        : `精炼炉开工：${def.name}（可炼 ×${total.toLocaleString('zh-CN')}，货仓+仓库合计）${who}；每批到点实时扣料、耗尽自动停。`,
    )
  }
  function stopRun(runId: number, hasClaim: boolean): void {
    const r = engine.stopRefineRunAt(runId)
    if (!r.ok) onToast(r.error ?? '停炉失败。', true)
    else if (hasClaim)
      onToast('已停该台炉：已完成批保留；本炉未用完的预占料已退回物品仓库（可继续加开其它单位）。')
    else onToast('已停该台炉：原料未锁定无需退回，余料仍留在货仓/仓库原位（可继续加开其它单位）。')
  }

  // 数据行：有单位运转 = 台数 + 余量；空闲 = 可用量/批参数
  let dataLine: ReactNode
  if (running) {
    dataLine = isWreck
      ? `运转 ${runs.length} 台 · 合计余 ${Math.round((total + claimHeld) * 10) / 10} m³` +
        (claimHeld > 0
          ? `（其中炉内料账 ${Math.round(claimHeld * 10) / 10} m³、货仓/仓库 ${Math.round(total * 10) / 10} m³）`
          : '')
      : `运转 ${runs.length} 台 · 合计余 ×${total.toLocaleString('zh-CN')}（${m3(total * def.unitM3)}）`
  } else if (isWreck) {
    // 稀有残骸：每炉锁死 1 件（30 m³）——数据行写清"一次起炉 = 开一箱"，免得玩家以为能把多件丢进一炉
    const qty = Math.round(total * 10) / 10
    dataLine = isRareBox
      ? `可用 ${qty} m³（${Math.floor(total / RARE_WRECK_VOLUME_M3)} 件）· 每炉锁 ${RARE_WRECK_VOLUME_M3} m³ = 1 件 · 每批 ${RECYCLE_BATCH_M3} m³ / ${Math.round(RECYCLE_CYCLE_MS / 1000)} 秒 · 一次起炉 = 开一箱（想多开就再起一炉，同型可多台并行）`
      : `可用 ${qty} m³ · 每批 ${RECYCLE_BATCH_M3} m³ / ${Math.round(RECYCLE_CYCLE_MS / 1000)} 秒 · 约 ${Math.ceil(total / RECYCLE_BATCH_M3)} 批开完`
  } else {
    const batch = def.refineBatchUnits && def.refineBatchUnits > 0 ? Math.floor(def.refineBatchUnits) : 10
    const cycleS = def.refineCycleMs && def.refineCycleMs > 0 ? Math.round(def.refineCycleMs / 100) / 10 : 6
    dataLine = `可用 ×${total.toLocaleString('zh-CN')}（${m3(total * def.unitM3)}）· 每批 ${batch} 单位 / ${cycleS} 秒 · 约 ${Math.ceil(total / batch)} 批炼完`
  }

  // 效率估价区：精炼卡显示每批产物与「净 ≈信用点/h」（产物矿物收价 − 耗料原料收价，按双方站内收价、
  // 不随市场；2026-09-08 船长定：估算必须扣除材料成本，防"越炼越亏还显示正收益"误读）；
  // 残骸回收卡与星图「残骸打捞」页同口径补"保底 ≈信用点/h"（残骸可直接出售应急、也可拆解；回收无耗料可扣，展示估算非结算）
  let econ: ReactNode = null
  if (isWreck) {
    const profile = wreckProfile
    if (profile) {
      const refLv = Math.min(5, state.skills.trained['salvage-refining'] ?? 0)
      const recLv = Math.min(5, state.skills.trained['salvage-recycling'] ?? 0)
      const cycleMs = Math.max(1, Math.round(RECYCLE_CYCLE_MS * Math.max(0.6, 1 - 0.04 * recLv))) // 手动炉基准（AI 核心另按效率拉长）
      const m3h = (3_600_000 / cycleMs) * RECYCLE_BATCH_M3
      const evH = Math.round(
        m3h * RECYCLE_YIELD_PER_M3[profile.tier] * RECYCLE_POOL_AVG_ISK[profile.tier] * (1 + 0.08 * refLv),
      )
      // 2026-09-10 船长：保底矿物仿精炼卡格式逐项列出（标题 + 每矿物缩进一行，行尾「（仓库 N）」同口径）；
      // 矿池取引擎单点 recycleMineralPoolOf（特色池优先、缺省回落档位池），界面不复写回落逻辑。
      const mineralRows = mineralRowsOf(
        recycleMineralPoolOf(profile),
        {
          batchM3: RECYCLE_BATCH_M3,
          yieldPerM3: RECYCLE_YIELD_PER_M3[profile.tier],
          refiningMultiplier: recycleRefiningMultiplier(state),
          priceOf: (id) => engine.ctx.items.get(id)?.baseSellPriceIsk ?? 0,
        },
        (id) => engine.ctx.items.get(id)?.name ?? id,
      )
      const mineralTip =
        `每批产出池内全部矿物（每批 ${RECYCLE_BATCH_M3} m³，含残骸提纯学 +8%/级）：各矿物分到的价值 = 每批保底价值 × 价值占比，` +
        `单位数 = 该价值 ÷ 单价——单价高的矿物每批不足 1 单位会累计到够 1 再入库；每批总价值有 ±10% 抖动，以回收拆解结算为准。` +
        (profile.note ? `敌群特色：${profile.note}` : '')
      econ = (
        <div className="app-belt-econ">
          {mineralRows.length > 0 ? (
            <>
              <div title={mineralTip}>♨ 保底原材料：</div>
              {mineralRows.map((r) => (
                <div key={r.id} className="app-belt-out" title={mineralTip}>
                  {r.name} ×约 {r.units}
                  <span className="app-dim">
                    {' '}≈{Math.round(r.isk).toLocaleString('zh-CN')} 信用点/批（仓库 {countWare(state, r.id).toLocaleString('zh-CN')}）
                  </span>
                </div>
              ))}
            </>
          ) : null}
          <div
            className="app-belt-econ-val"
            title="按残骸来源危险度池的保底原材料估算（手动炉基准；AI 核心驱动时周期更长）——参考值，实际所得以回收拆解结算为准"
          >
            {MONEY_GLYPH} 保底 ≈{evH.toLocaleString('zh-CN')} 信用点/h
          </div>
        </div>
      )
    }
  } else {
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
    const batchValue = outs.reduce((s, o) => s + o.units * (o.def.baseSellPriceIsk ?? 0), 0)
    // 2026-09-08：净口径 = 每批产物收价 − 每批耗料（原料同样按站内收价；原料可卖，不扣即虚高）
    const costPerBatch = batch * (def.baseSellPriceIsk ?? 0)
    const netPerBatch = batchValue - costPerBatch
    const grossH = Math.round(batchValue * (3_600_000 / cycleMs))
    const netH = Math.round(netPerBatch * (3_600_000 / cycleMs))
    econ = (
      <div className="app-belt-econ">
        {/* 2026-09-10 船长：产出做成「♨ 产出：」标题 + 每种产物缩进一行，行尾带自己拥有的数量
            （站内物品仓库口径，与同卡材料行「（仓库 N）」同款写法；市场页「持有 N」亦同源） */}
        {outs.length === 0 ? (
          <div>♨ 产出：（当前无产出）</div>
        ) : (
          <>
            <div>♨ 产出：</div>
            {outs.map((o) => (
              <div key={o.def.id} className="app-belt-out">
                {o.def.name} ×{o.units.toLocaleString('zh-CN')}
                <span className="app-dim">（仓库 {countWare(state, o.def.id).toLocaleString('zh-CN')}）</span>
              </div>
            ))}
          </>
        )}
        {batchValue > 0 ? (
          <div
            className={`app-belt-econ-val${netH < 0 ? ' is-neg' : ''}`}
            title={`净收益估算：每批产物（原材料站内收价） − 每批耗料价值（原料站内收价），× 每小时批次数；不随市场、未计成交税。毛产值 ≈${grossH.toLocaleString('zh-CN')} 信用点/h；${
              netH < 0 ? '当前产出倍率下精炼不如直接卖原料。' : '数值已扣除耗料成本。'
            }`}
          >
            {MONEY_GLYPH} ≈{netH.toLocaleString('zh-CN')} 信用点/h{netH < 0 ? '（净亏：直接卖原料更划算）' : '（净）'}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={`app-belt-card${highlight ? ' is-goto' : ''}`} key={def.id}>
      <div className="app-belt-head">
        <span className="app-belt-name">
          <RowGlyph glyph={def.kind} /> {def.name}
          {isRareBox ? (
            <em
              className="app-chip is-rare"
              title="高级箱：开出该敌群专属装备或特色装备，另附一批高阶原材料"
            >
              稀有
            </em>
          ) : null}
        </span>
        {/* 卡头右侧：标记星标（2026-09-10 船长） + 去矿带/去打捞跳转 */}
        <span className="app-belt-head-right">
          <MarkStar engine={engine} kind="recipes" id={def.id} />
          {gotoTarget && onGotoMap ? (
            <button
              className="app-btn is-small"
              title={
                isWreck
                  ? '前往星图「残骸打捞」定位该残骸的来源星系（打捞后残骸带回站内回收拆解）'
                  : `前往星图「矿带开采」定位出产该原料的矿带${gotoTarget.ids.length > 1 ? `（共 ${gotoTarget.ids.length} 处，全部高亮）` : ''}`
              }
              onClick={() => onGotoMap(gotoTarget.tab, gotoTarget.ids)}
            >
              {isWreck ? '去打捞' : '去矿带'}
            </button>
          ) : null}
        </span>
      </div>
      <div className="app-belt-desc">
        {isWreck
          ? isRareBox
            ? '每批拆解 = 保底原材料 + 概率特色掉落；另有「高级箱」掉落：专属装备或特色装备 + 高阶原材料'
            : '每批拆解 = 保底原材料 + 概率特色掉落'
          : def.description}
      </div>
      {isWreck ? <WreckFlavorRow def={def} engine={engine} /> : null}
      <div className="app-belt-ore">{dataLine}</div>
      {econ}
      <div className="app-belt-actions">
        {/* 运转单位名册（每台一行：劳动者 + 当前批进度条 + 停）——矿带副船名册同款结构 */}
        {runs.length > 0 ? (
          <div className="app-belt-workers">
            {runs.map((v) => (
              <span key={v.id} className="app-belt-worker">
                <span className="app-belt-worker-name">
                  {v.worker === 'pilot' ? '⛏ 主控' : `⚙ ${v.workerLabel}核心`} · {isWreck ? '已拆解' : '已炼'} {v.batchesDone} 批
                  {v.claimedUnits !== undefined
                    ? ` · 本炉料余 ${Math.round(v.claimedUnits * 10) / 10} m³`
                    : ''}
                </span>
                <span
                  className="app-progress-mini"
                  title={`当前批进度 ${v.percent}%（每批 ${v.batchUnits} 单位 / ${Math.round(v.cycleMs / 100) / 10} 秒；${
                    v.claimedUnits !== undefined
                      ? `每批从本炉预占的料账扣 ${v.batchUnits} m³（货仓/仓库不再显示这批料）`
                      : '每批到点实时扣料'
                  }）`}
                >
                  <i style={{ width: `${v.percent}%` }} />
                </span>
                <button
                  className="app-btn is-small is-warn"
                  onClick={() => stopRun(v.id, v.claimedUnits !== undefined)}
                  title={
                    v.claimedUnits !== undefined
                      ? '停这台炉：已完成批保留；本炉未用完的预占料退回物品仓库（AI 核心自动归还）'
                      : '停这台炉：已完成批保留；原料未锁定无需退回（AI 核心自动归还）'
                  }
                >
                  停
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <button
          className="app-btn is-small is-primary"
          disabled={manualNote !== null || total <= 0}
          title={
            manualNote ??
            (total <= 0
              ? noStockNote
              : running
                ? '由你亲自再开一台（主控限 1 台）：与现有单位同炉并行，每批到点实时扣料'
                : isWreck
                  ? isRareBox
                    ? `由你亲自运转一台：起炉即预占 1 件（${RARE_WRECK_VOLUME_M3} m³）进本炉料账，每批拆 ${RECYCLE_BATCH_M3} m³、料尽自动停（期间不可离港作业）`
                    : '由你亲自运转一台：循环拆解，每批到点实时扣料（期间不可离港作业）'
                  : '由你亲自运转一台：循环精炼，每批到点实时扣料（期间不可离港作业）')
          }
          onClick={() => runWith('pilot')}
        >
          {isWreck ? '手动回收' : '手动运转'}
        </button>
        {/* AI 工位：核心下拉常驻（无可用核心时置灰并在控件里写明，卡面不跳动；船长 2026-09-10） */}
        <div className="app-belt-ai">
          <select
            className="app-select"
            value={usableCores.length === 0 ? '' : (core ?? '')}
            onChange={(e) => setCoreSel(e.target.value as AiCoreType)}
            disabled={usableCores.length === 0}
            title={
              usableCores.length === 0
                ? '无可用 AI 核心：核心库为空或全部已在占用中——去市场购入「基础 AI 核心」（空间站直购），或先取消占用中的任务、训练「AI 核心操作学」/「工业自动化」扩容'
                : '选择接入 AI 核心：一枚核心驱动一台炉（驱动期间该核心被占用并计入 AI 核心启用上限——上限由 AI 核心上限技能决定，与 AI 副船任务共用）'
            }
          >
            {usableCores.length === 0 ? (
              <option value="">无可用 AI 核心</option>
            ) : (
              usableCores.map((t) => (
                <option key={t} value={t}>
                  {aiCoreName(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）
                </option>
              ))
            )}
          </select>
          <button
            className="app-btn is-small"
            disabled={!core || total <= 0}
            title={
              core
                ? total <= 0
                  ? noStockNote
                  : running
                    ? '接入一枚闲置 AI 核心加开一台'
                    : '接入 AI 核心自动运转（不占副船与主控）'
                : '无可用 AI 核心：先去市场购入「基础 AI 核心」，或等占用中的核心归还'
            }
            onClick={() => core && runWith(core)}
          >
            {isWreck ? 'AI 回收' : 'AI 运转'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** B3.1：残骸回收卡「特色掉落」说明行（2026-09-06 船长：直接告诉玩家具体低出率物；
 *  2026-09-10 船长定"说明精简"：只讲特色（主题件/专属装备具名），其余泛化为系列名；
 *  行内容与星图打捞页星系卡共用 ui/wreckFlavor） */
function WreckFlavorRow({ def, engine }: { def: ItemDef; engine: GameEngine }) {
  const ctx = engine.ctx
  const profile = recycleProfileOf(ctx, def.id)
  if (!profile) return null
  const feature = recycleFeatureOf(
    {
      lowSec: profile.lowSec,
      threat: profile.threat,
      loot: profile.loot,
      lairGear: profile.lairGear,
    },
    { mods: ctx.modules, items: ctx.items, droneUnits: RARE_BOX_DRONE_UNITS },
  )
  return (
    <FlavorTip
      featureLabel={feature.label}
      named={feature.named}
      generic={feature.generic}
      tone={feature.tone}
    />
  )
}

export function IndustryPage({ engine, onToast, onGotoMarket, onGotoMap }: PageProps & {
  onGotoMarket?: (goodKey: string) => void
  onGotoMap?: (tab: 'mine' | 'salvage', ids: string[]) => void
}) {
  const state = engine.state
  const rate = refineRate(state, engine.ctx)

  const [sec, setSec] = useState<'refine' | 'shelf' | 'craft'>('refine')
  /**
   * **精炼炉的两级筛选**（2026-09-14 船长：「精炼炉和组装机一样，添加筛选标签」）：
   * `furnaceTab` = 一级（活计大类）· `sub` = 二级（资源大类 / 残骸档位；`''` = 全部子类）。
   * 切一级标签即回「全部子类」——与组装机、市场页 `changeKind` 同款口径。
   */
  const [furnaceTab, setFurnaceTab] = useState<FurnaceTab>('all')
  const [sub, setSub] = useState<string>('')
  const runViews = engine.refineRunViews()
  // 组装机「去精炼」跳转目标（矿石卡 id；高亮数秒后自清；2026-09-08 船长定）
  const [focusOreId, setFocusOreId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusOreId) return
    document.querySelector('.app-belt-card.is-goto')?.scrollIntoView({ block: 'center' })
    const t = window.setTimeout(() => setFocusOreId(null), 3500)
    return () => window.clearTimeout(t)
  }, [focusOreId])

  /** 组装机需求材料点击：有精炼源矿石 → 精炼 tab 并定位该矿石卡；无精炼产出 → 跳市场
   *  ⚠ 源矿石同样只看"玩家可见目录"：未上线矿石（如虚空母矿）不能作为跳转目标出现。
   *  ⚠ 2026-09-14：加了筛选标签之后，**必须同时把一级/二级筛选让开**——否则跳到一张被筛掉的卡上，
   *  高亮根本看不见（`setFurnaceTab('ore')` + `setSub('')`）。 */
  function handleNeedMineral(itemId: string): void {
    let src = ''
    for (const def of visibleItemDefs(engine.ctx)) {
      if (def.kind === 'wreck') continue
      if ((def.refine ?? []).some((r) => r.mineralId === itemId)) {
        src = def.id
        break
      }
    }
    if (src) {
      setSec('refine')
      setFurnaceTab('ore')
      setSub('')
      setFocusOreId(src)
      return
    }
    for (const g of engine.ctx.marketGoods.values()) {
      if (g.kind === 'item' && g.refId === itemId) {
        onGotoMarket?.(g.key)
        return
      }
    }
    onToast(`「${engine.ctx.items.get(itemId)?.name ?? itemId}」没有精炼产出与市场渠道——先采集可炼原料再来看。`, true)
  }

  /** 带精炼配方的全部矿石/气体/冰矿（2026-09-08 船长定：精炼炉默认显示所有可精炼资源；空料卡提示引导）
   *  ⚠ **走"玩家可见目录"**（`visibleItemDefs`）：未上线资源（标 `ItemDef.unreleased`，如虫洞线的虚空母矿）
   *  不进这张网格——首版直接扫 `ctx.items` 全目录，导致未上线矿连卡带描述一起挂在工业页上（2026-09-13 实测）。 */
  const allItemDefs = visibleItemDefs(engine.ctx)
  const oreDefs = allItemDefs.filter(
    (def) => def.kind !== 'wreck' && def.refine !== undefined && def.refine.length > 0,
  )
  /** B3：可回收的残骸（货仓+仓库有货或在炉中；残骸计数 = 体积 m³）。
   *  ⚠ 残骸定义按敌群运行时生成、只存在于 ctx.items——engine.items(静态目录) 里没有，
   *  之前从这里取列表导致回收卡永远不出现（2026-09-06 玩家上报）。
   *  **稀有残骸已解禁**（船长 2026-09-10：二号五族专属装备齐备后开放）——与普通残骸同列表，
   *  卡片带「高级箱」徽标；区别只在"首批触发一次高级箱"（一炉一箱）。 */
  const wreckDefs = allItemDefs.filter(
    (def) => def.kind === 'wreck' && (oreAvailable(state, def.id) > 0 || runViews.some((v) => v.itemId === def.id)),
  )

  /**
   * **F4d：可拆解的货柜**（货仓 + 仓库有货、或在炉中就算一张卡）。
   *
   * ⚠ **2026-09-14 船长解闸**：原话「**虫洞已经做完了，正在微调，所以允许对玩家开放**」——
   * 这里原先沿用入口那把 `debugEnabled()` 开关（施工期只有调试模式可见），现已**改为常显**。
   * ⚠ 仍走 `engine.ctx.items` 全表（不走 `visibleItemDefs`）：这一档要认**所有** `container` 类，
   * 将来再加货柜种类也不会漏（2026-09-14 虫洞正式上线后，货柜的物品卡本身也已摘掉 `unreleased`）。
   */
  const boxDefs = [...engine.ctx.items.values()].filter(
    (def) =>
      def.kind === 'container' &&
      (oreAvailable(state, def.id) > 0 || runViews.some((v) => v.itemId === def.id)),
  )
  const runningCount = runViews.length

  /* ── 两级筛选（2026-09-14 船长：「精炼炉和组装机一样，添加筛选标签」）──────────────────
   * 一级 = 活计大类（全部 / 可精炼资源 / 残骸回收 / 货柜拆解）；
   * 二级 = 按当前一级给候选：「可精炼资源」按**资源大类**（原矿/气体/冰矿）、
   *       「残骸回收」按**档位**（普通 / 稀有·高级箱）；「全部」与「货柜拆解」不带二级（同组装机）。 */
  const oreSubs: SubOpt[] = Object.keys(ORE_KIND_LABEL)
    .filter((k) => oreDefs.some((d) => d.kind === k))
    .map((k) => ({ key: k, label: ORE_KIND_LABEL[k]! }))
  const subOptions: SubOpt[] = furnaceTab === 'ore' ? oreSubs : furnaceTab === 'wreck' ? WRECK_SUBS : []
  const oreFiltered = sub === '' ? oreDefs : oreDefs.filter((d) => d.kind === sub)
  /** 残骸档位：`recycleProfileOf(...).rare` 是唯一判据（与卡上的「高级箱」徽标同源） */
  const wreckFiltered =
    sub === 'rare'
      ? wreckDefs.filter((d) => recycleProfileOf(engine.ctx, d.id)?.rare === true)
      : sub === 'common'
        ? wreckDefs.filter((d) => recycleProfileOf(engine.ctx, d.id)?.rare !== true)
        : wreckDefs
  const oreShownF = pinMarked(state, 'recipes', oreFiltered, (def) => def.id)
  const wreckShownF = pinMarked(state, 'recipes', wreckFiltered, (def) => def.id)
  /** 一级标签实际要渲染哪几组（「全部」= 四组都渲染，其余只渲染对应那一组） */
  const showOre = furnaceTab === 'all' || furnaceTab === 'ore'
  const showWreck = furnaceTab === 'all' || furnaceTab === 'wreck'
  const showBox = furnaceTab === 'all' || furnaceTab === 'box'
  /** 当前筛选下"一共几张卡"（读数行用；与组装机的「· 当前 N 张」同款） */
  const shownCount =
    (showOre ? oreShownF.length : 0) + (showWreck ? wreckShownF.length : 0) + (showBox ? boxDefs.length : 0)
  const totalCount = oreDefs.length + wreckDefs.length + boxDefs.length

  return (
    <div className="page-stack page-fill">
      {/* 功能标签页（与星图页同款 app-subtabs 规范）：精炼炉 / 蓝图书架 / 组装机 */}
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
          aria-selected={sec === 'craft'}
          className={`app-subtab${sec === 'craft' ? ' is-active' : ''}`}
          onClick={() => setSec('craft')}
        >
          <span>⚒</span>
          <span>组装机</span>
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
      </div>

      {sec === 'craft' ? (
        <ManufacturingPanel engine={engine} onToast={onToast} onNeedMineral={handleNeedMineral} onGotoMarket={onGotoMarket} />
      ) : sec === 'shelf' ? (
        <BlueprintShelfPanel engine={engine} onToast={onToast} />
      ) : (
        <Panel
          className="is-fill win-fixed-body"
          title="精炼炉"
          hint={
            <HintIcon
              tip={`你亲自运转限 1 台，其余每枚 AI 核心各驱动一台；原料不锁定，每批到点从「货仓 + 仓库」实时扣取、耗尽自动停炉。稀有残骸例外：起炉即把整件（1 件 = ${RARE_WRECK_VOLUME_M3} m³）转入本炉料账——货仓/仓库不再显示这批料，卡面按"炉内料账 + 货仓/仓库"合计数给出，停炉时未用完部分退回物品仓库。精炼：循环运转到料尽自动停炉。残骸回收：保底原材料 + 概率特色掉落。货柜拆解：一箱开一件，每件 90 秒。`}
            />
          }
          right={
            <>
              <span
                className="app-dim"
                title="产出倍率 = 基础 120% + 精炼学 +6%/级 + 高级回收处理 +3%/级（上限 165%）；残骸回收按保底原材料另算"
              >
                产出倍率 {Math.round(rate * 100)}% · 运转 {runningCount} 台 · 可精炼 {oreDefs.length} · 残骸{' '}
                {wreckDefs.length}
                {boxDefs.length > 0 ? ` · 货柜 ${boxDefs.length}` : ''}
                {/* 筛选生效时补一个"当前 N 张"（与组装机同款：免得玩家对着收窄后的网格数不清） */}
                {shownCount !== totalCount ? ` · 当前 ${shownCount} 张` : ''}
              </span>
              <AiSlotText state={state} ctx={engine.ctx} />
            </>
          }
        >
          {/* 筛选固定、说明进标题后的圆形感叹号（固定头 + 下滚）：一级标签行 / 二级子筛选行常驻，
              卡网格独立内滚 —— 与组装机逐项同款（`.app-task-tabs` + `.app-tasktab`，二级行去下边框） */}
          <div className="app-task-tabs" role="tablist">
            {FURNACE_TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={furnaceTab === t.key}
                className={`app-tasktab${furnaceTab === t.key ? ' is-active' : ''}`}
                onClick={() => {
                  setFurnaceTab(t.key)
                  setSub('') // 换一级标签即回「全部子类」（与组装机、市场页 changeKind 同款）
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          {subOptions.length > 0 ? (
            <div className="app-task-tabs app-fleet-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={sub === ''}
                className={`app-tasktab${sub === '' ? ' is-active' : ''}`}
                onClick={() => setSub('')}
              >
                全部子类
              </button>
              {subOptions.map((s) => (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={sub === s.key}
                  className={`app-tasktab${sub === s.key ? ' is-active' : ''}`}
                  onClick={() => setSub(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="app-win-body">
          {totalCount === 0 ? (
            <div className="app-dim app-inv-empty">
              没有可精炼/可回收/可拆解的物资——采集原矿/气体/冰矿，或打捞带回残骸与货柜后再来。
            </div>
          ) : null}
          {shownCount === 0 && totalCount > 0 ? (
            <div className="app-dim app-exp-idle">该子分类下暂无物资——换个分类或点「全部子类」看看。</div>
          ) : null}

          {showOre && oreShownF.length > 0 ? (
            <div className="app-belt-grid">
              {oreShownF.map((def) => (
                <FurnaceCard key={def.id} def={def} engine={engine} onToast={onToast} highlight={focusOreId === def.id} onGotoMap={onGotoMap} />
              ))}
            </div>
          ) : null}

          {showWreck && wreckShownF.length > 0 ? (
            <div className="app-belt-grid">
              {wreckShownF.map((def) => (
                <FurnaceCard key={def.id} def={def} engine={engine} onToast={onToast} onGotoMap={onGotoMap} />
              ))}
            </div>
          ) : null}

          {showBox && boxDefs.length > 0 ? (
            <div className="app-belt-grid">
              {boxDefs.map((def) => (
                <FurnaceCard key={def.id} def={def} engine={engine} onToast={onToast} onGotoMap={onGotoMap} />
              ))}
            </div>
          ) : null}
          {showBox && boxDefs.length === 0 ? (
            <div className="app-dim app-exp-idle">
              还没有可拆解的货柜——遗迹打捞带回「安全货柜 / 图纸货柜」后会出现在这里（拆开才知道内容物）。
            </div>
          ) : null}
          </div>
        </Panel>
      )}
    </div>
  )
}
