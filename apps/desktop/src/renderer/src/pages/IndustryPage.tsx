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
  /** F4d 货柜拆解：每件周期（90 秒）——卡面读数与开工提示同源，别再写死 */
  UNBOX_CYCLE_MS,
  recycleRefiningMultiplier,
  aiCoreName,
  aiEfficiency,
  countAiCore,
  countWare,
  oreAvailable,
  /** 2026-09-25 船长令：H 族残骸暂不开放回收 ⇒ 卡片也摘掉（与起炉那一层同一判据） */
  RARE_WRECK_VOLUME_M3,
  recycleMineralPoolOf,
  recycleProfileOf,
  refineRate,
  // 2026-09-13：未上线资源不进"可精炼资源"网格 / 材料跳转（施工期闸门）
  visibleItemDefs,
  ITEM_KIND_LABELS,
  /** 2026-09-22 船长令：缺料"零件"要指去组装机 ⇒ 用产物→蓝图反查（核心单点，含缓存） */
  blueprintProducingItem,
  /** 2026-09-29 跃迁燃料批：实验室卡片的读数口（可跑批次 / 材料可用量）＋ 配方类型 */
  labAffordableBatches,
  labMaterialAvailable,
  labRecipeUnlocked,
  labTechRequirementOf,
} from '@whale/core'
import type { LabRecipeDef, LabRunView } from '@whale/core'
// 2026-09-23 船长令：使用 AI 核心时默认选「当前拥有的最高级核心」
import { bestAiCoreOf } from '@whale/core'
import type { AiCoreType, GameState, ItemDef } from '@whale/core'
import { Panel } from '@whale/ui'
import { wreckGroupText } from '@whale/data'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BlueprintShelfPanel, ManufacturingPanel } from '../panels/Industry'
import { ShipyardPanel } from '../panels/Shipyard'
import { setSessionPick, sessionPick, useSessionScrollFrom } from '../ui/sessionView'
import type { GameEngine } from '../game/engine'
import { MarkStar, pinMarked } from '../ui/marks'
import { AiSlotText } from '../ui/aiSlots'
import { RowGlyph } from '../ui/itemView'
/* 图标一律走**物品 id 单点映射**（2026-09-30 船长报障：新道具在实验室卡上是通用「消耗品」图标） */
import { itemGlyphName } from '../ui/Glyphs'
import { WRECK_SUBS, SUB_ALL, presentSubs, wreckTierOf, subText } from '../ui/itemSubs'
import { isEn, useL10n, cmdText } from '../i18n/locale'
import { aiCoreText } from '../ui/labelsText'
import { HintIcon } from '../ui/Hint'
import { FlavorTip, mineralRowsOf, recycleFeatureOf } from '../ui/wreckFlavor'
/** 活动卡「产出」读数（2026-09-23 船长令：残骸卡的信用点估价移除 ⇒ 改显示市场当前行情价） */
import { marketPriceOf, NetIncomeLine } from '../ui/yieldView'
import type { PageProps } from './common'
import { MONEY_GLYPH, m3, wreckSourceGalaxyIdsOf } from './common'
import { tr } from '../i18n/locale'

const CORE_ORDER: AiCoreType[] = ['basic', 'gamma', 'beta', 'alpha']

/**
 * **精炼炉一级筛选标签**（2026-09-14 船长：「精炼炉和组装机一样，添加筛选标签」→
 * 位置澄清「**放进精炼炉内，并更新筛选**」）——按**活计大类**分，与页面里原本的三个小标题一一对应：
 * 全部 / 可精炼资源 / 残骸回收 / 货柜拆解（货柜那一档原先是"施工期只在调试模式出现"，船长 2026-09-14
 * 明示「**虫洞已经做完了…允许对玩家开放**」⇒ 四档一律常显）。
 */
type FurnaceTab = 'all' | 'ore' | 'wreck' | 'box'
const FURNACE_TABS: Array<{ key: FurnaceTab; label: string }> = [
  { key: 'all', label: tr("ui.IndustryPage.001") },
  { key: 'ore', label: tr("ui.IndustryPage.002") },
  { key: 'wreck', label: tr("ui.IndustryPage.003") },
  { key: 'box', label: tr("ui.IndustryPage.004") },
]

/** 二级子筛选的候选（键 = 子筛选键，`''` = 全部子类，与组装机同款口径） */
type SubOpt = { key: string; label: string }
/** 可精炼资源按**资源大类**（只列实际存在的档；`ItemDef.kind` 单点） */
const ORE_KIND_LABEL: Record<string, string> = { ore: tr("ui.IndustryPage.005"), gas: tr("ui.IndustryPage.006"), ice: tr("ui.IndustryPage.007") }
/* 残骸回收按**档位**（普通 / 稀有）——2026-09-14 船长选甲；档名 2026-09-16 收口为「稀有残骸」。
 * 2026-09-19 乙组：表已按基线⑤收编到 `ui/itemSubs.ts`（`WRECK_SUBS`），物品页仓库 /
 * 手册物品图鉴 / 市场 三处读的是同一张表 ⇒ 本文件不再自带该表（标签仍走唯一表 id）。 */


/**
 * 主控此刻不能"亲自运转一台新炉"的原因（null = 可开；AI 核心驱动不受此限）。
 *
 * ⚠ **2026-09-21 船长令改口径**（「统一为能够直接切换（自动取消当前活动）」）：这里**不再**列
 * 「开采 / 打捞 / 远征 / 掩护巡逻」——它们要么**可自动停**（点下去会先停掉它再开炉，写一条统一日志），
 * 要么由 core 的统一判据直接拒（远征）。界面只管**位置**与**锁定态**这两类"点了也白点"的：
 * 野外/航行途中点不了炉子（`awayGalaxy` 非空），换港返航途中是统一判据里的锁定态。
 * 真正的把关单点在 core（`activityGate`）⇒ 这里置灰与否不再决定能否开工，只是少给玩家一次无效点击。
 */
function manualBusyNote(state: GameState): string | null {
  if (state.awayGalaxy !== null) return tr("ui.IndustryPage.010")
  if (state.transit.active) return tr("ui.IndustryPage.015")
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
  // 残骸 → **该组覆盖的来源星系**（2026-09-19 合并后一组对应多张卡 ⇒ 可能多个星系；打捞星系须已探索）
  const gotoTarget: { tab: 'mine' | 'salvage'; ids: string[] } | null = isWreck
    ? (() => {
        const ids = wreckSourceGalaxyIdsOf(engine.ctx, def.id)
        return ids.length > 0 ? { tab: 'salvage' as const, ids } : null
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
  const [coreSel, setCoreSel] = useState<AiCoreType>(() => bestAiCoreOf(state) ?? 'basic')
  const usableCores = CORE_ORDER.filter((t) => countAiCore(state, t) > 0)
  const core = usableCores.includes(coreSel) ? coreSel : (usableCores[0] ?? null)
  // 手动再开一台被拒的原因：主控已亲自开着一台炉 / 开着一条制造线 / 其它主控作业占用（三者共享手动工作位）
  // 无公共料时的提示（2026-09-11）：本卡若有炉子正抱着**炉内料账**，就不能写成"仓库里没有原料"（料在炉里）
  const noStockNote =
    claimHeld > 0
      ? tr("ui.IndustryPage.016")
      : tr("ui.IndustryPage.017")
  const manualNote = state.refineRuns.some((r) => r.worker === 'pilot')
    ? tr("ui.IndustryPage.018")
    : state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')
      ? tr("ui.IndustryPage.019")
      : manualBusyNote(state)

  function runWith(worker: AiCoreType | 'pilot'): void {
    const r = isBox
      ? engine.startUnboxRunAt(def.id, worker)
      : isWreck
        ? engine.startRecycleRunAt(def.id, worker)
        : engine.startRefineRunAt(def.id, worker)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.IndustryPage.112'), true)
      return
    }
    const who = worker === 'pilot' ? tr("ui.IndustryPage.020") : tr("ui.IndustryPage.068", { p1: aiCoreName(worker) })
    onToast(
      isBox
        ? tr("ui.IndustryPage.069", { p1: def.name, total: total, who: who, p4: Math.max(1, Math.round(UNBOX_CYCLE_MS / 1000)) })
        : isWreck
          ? isRareBox
          ? tr("ui.IndustryPage.070", { p1: def.name, p2: Math.min(RARE_WRECK_VOLUME_M3, Math.round(total * 10) / 10), RARE_WRECK_VOLUME_M3: RARE_WRECK_VOLUME_M3, who: who, RECYCLE_BATCH_M3: RECYCLE_BATCH_M3 })
          : tr("ui.IndustryPage.071", { p1: def.name, p2: Math.round(total * 10) / 10, who: who })
        : tr("ui.IndustryPage.072", { p1: def.name, p2: total.toLocaleString('zh-CN'), who: who }),
    )
  }
  function stopRun(runId: number, hasClaim: boolean): void {
    const r = engine.stopRefineRunAt(runId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.IndustryPage.105'), true)
    else if (hasClaim)
      onToast(tr("ui.IndustryPage.073"))
    else onToast(tr("ui.IndustryPage.074"))
  }

  // 数据行：有单位运转 = 台数 + 余量；空闲 = 可用量/批参数
  // ⚠ 三条产线的量词/周期完全不同（2026-09-15 船长报障「精炼炉拆解货柜的文字显示不对」）：
  //   精炼 = ×N 单位 / 每批 X 单位；残骸回收 = N m³ / 每批 X m³；**货柜拆解 = ×N 件 / 每件 90 秒**。
  //   此前货柜卡落进"精炼"那支 ⇒ 卡面写着「可用 ×2（4,000 m³）· 每批 10 单位 / 6 秒 · 约 1 批炼完」。
  const boxSeconds = Math.max(1, Math.round(UNBOX_CYCLE_MS / 1000))
  let dataLine: ReactNode
  if (running) {
    dataLine = isBox
      ? tr("ui.IndustryPage.075", { p1: runs.length, p2: total.toLocaleString('zh-CN') })
      : isWreck
        ? tr("ui.IndustryPage.076", { p1: runs.length, p2: Math.round((total + claimHeld) * 10) / 10 }) +
          (claimHeld > 0
            ? tr("ui.IndustryPage.077", { p1: Math.round(claimHeld * 10) / 10, p2: Math.round(total * 10) / 10 })
            : '')
        : tr("ui.IndustryPage.078", { p1: runs.length, p2: total.toLocaleString('zh-CN'), p3: m3(total * def.unitM3) })
  } else if (isBox) {
    dataLine = tr("ui.IndustryPage.079", { p1: total.toLocaleString('zh-CN'), boxSeconds: boxSeconds })
  } else if (isWreck) {
    // 稀有残骸：**2026-09-23 船长令（乙案）= 每批 30 m³（= 一件）、30 m³ 起炉** ⇒ 一炉一件 = 开一箱。
    // ⚠ 这行文案的模板来自 **2026-09-10 的旧口径**（「每炉锁 30 m³ = 1 件」＋「每批 {RECYCLE_BATCH_M3}」），
    // 两半分别绑不同的量；今天普通批改成 100 后，若还传 `RECYCLE_BATCH_M3` 就会出现
    // 「锁 30 = 1 件 · 每批 100」这种自相矛盾（船长实测报障）⇒ 这里改传**稀有批 = `RARE_WRECK_VOLUME_M3`**。
    const qty = Math.round(total * 10) / 10
    dataLine = isRareBox
      ? tr("ui.IndustryPage.080", { qty: qty, p2: Math.floor(total / RARE_WRECK_VOLUME_M3), RARE_WRECK_VOLUME_M3: RARE_WRECK_VOLUME_M3, RECYCLE_BATCH_M3: RARE_WRECK_VOLUME_M3, p5: Math.round(RECYCLE_CYCLE_MS / 1000) })
      : tr("ui.IndustryPage.081", { qty: qty, RECYCLE_BATCH_M3: RECYCLE_BATCH_M3, p3: Math.round(RECYCLE_CYCLE_MS / 1000), p4: Math.ceil(total / RECYCLE_BATCH_M3) })
  } else {
    const batch = def.refineBatchUnits && def.refineBatchUnits > 0 ? Math.floor(def.refineBatchUnits) : 10
    const cycleS = def.refineCycleMs && def.refineCycleMs > 0 ? Math.round(def.refineCycleMs / 100) / 10 : 6
    dataLine = tr("ui.IndustryPage.082", { p1: total.toLocaleString('zh-CN'), p2: m3(total * def.unitM3), batch: batch, cycleS: cycleS, p5: Math.ceil(total / batch) })
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
        // 稀有残骸卡：批大小是**稀有批 30 m³**（2026-09-23 乙案），不是普通那 100 ⇒ 这里传稀有批
        tr("ui.IndustryPage.083", { RECYCLE_BATCH_M3: RARE_WRECK_VOLUME_M3 }) +
        tr('ui.IndustryPage.113') +
        (profile.note
          ? tr("ui.IndustryPage.084", {
              /**
               * ⚠ **成分说明按语言取**（**2026-09-29 批 2**）：`profile.note` 是 core 的**中文原串**
               * （`recycleProfileOf` 从 `WRECK_GROUPS[].note` 拷来）⇒ 英文界面下那段整段中文。
               * 按 `profile.groupKey` 反查数据层的英文覆盖，中文侧照旧用原串。
               */
              p1:
                (profile.groupKey !== undefined
                  ? wreckGroupText(profile.groupKey, isEn() ? 'en' : 'zh', 'note')
                  : undefined) ?? profile.note,
            })
          : '')
      econ = (
        <div className="app-belt-econ">
          {mineralRows.length > 0 ? (
            <>
              <div title={mineralTip}>{tr("ui.IndustryPage.021")}</div>
              {mineralRows.map((r) => (
                <div key={r.id} className="app-belt-out" title={mineralTip}>
                  {r.name} {tr("ui.IndustryPage.022")} {r.units}
                  {/* **残骸的信用点收入估价已移除**（**2026-09-23 船长令**：「残骸的信用点收入估价可以移除」）：
                      只留"仓库已拥有 + 市场当前行情价"，与其它卡同一套语言（取数见 `ui/yieldView.tsx`）。 */}
                  <span className="app-dim">
                    {' '}
                    （{tr('ui.Yield.002')} {countWare(state, r.id).toLocaleString('zh-CN')} · {tr('ui.Yield.003')}{' '}
                    {marketPriceOf(state, engine.ctx, r.id)?.toLocaleString('zh-CN') ?? '—'}）
                  </span>
                </div>
              ))}
            </>
          ) : null}
          {/* 「保底 ≈N 信用点/h」整行已删（2026-09-23 船长令：残骸的信用点收入估价可以移除） */}
          {/**
           * **净收益/h（仅调试模式 · 2026-09-29 船长令「希望在调试模式下看到各个活动的净收益」）**：
           * 残骸回收是**批量型活动**（一批 = `RECYCLE_BATCH_M3` m³、周期 = 上面那个 `cycleMs`）⇒
           * `(整批保底矿物价值 − 耗料成本 0) ÷ 周期 × 3600`。**回收无耗料可扣**（残骸是打捞来的）
           * ⇒ `costIsk = 0`。
           * ⚠ **口径 = 上面逐项那几行的 `isk` 之和**（同一份 `mineralRowsOf` 估算，取站内收价基准），
           * 即"这一炉拆出来的矿物值多少"——与卡面自洽；**不是**按市场行情另算一套。
           * ⚠ 这是"**拆解成矿物再卖**"的读数；残骸**直销**那条路按船长定规**不计入估值**。
           */}
          <NetIncomeLine price={mineralRows.reduce((s, r) => s + r.isk, 0)} costIsk={0} buildMs={cycleMs} />
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
    /**
     * **产出读数换口径**（**2026-09-23 船长令**：「各个有收益的卡牌上写着的收入预估…会严重误导玩家…
     * 其他活动只显示每小时能收获多少资源以及产出的物资的市场当前价格」＋同日「行情采用市场详细中
     * 折线图中显示的价格」）⇒ 每行 = `产物 ×N/h（仓库 M · 行情 P）`，原「≈N 信用点/h」净口径估值**整行删除**。
     * 每小时产量 = 每批产物单位 × (3,600,000 ÷ 精炼周期)；行情取数走 `ui/yieldView.tsx` 的唯一实现。
     */
    const perHourOf = (units: number): number => Math.round(units * (3_600_000 / cycleMs))
    econ = (
      <div className="app-belt-econ">
        {/* 2026-09-10 船长：产出做成「♨ 产出：」标题 + 每种产物缩进一行，行尾带自己拥有的数量 */}
        {outs.length === 0 ? (
          <div>{tr("ui.IndustryPage.027")}</div>
        ) : (
          <>
            <div>{tr("ui.IndustryPage.028")}</div>
            {outs.map((o) => (
              <div key={o.def.id} className="app-belt-out">
                {o.def.name} ×{perHourOf(o.units).toLocaleString('zh-CN')}/h
                <span className="app-dim">
                  {' '}
                  {tr('ui.Yield.004', {
                    p1: countWare(state, o.def.id).toLocaleString('zh-CN'),
                    p2: marketPriceOf(state, engine.ctx, o.def.id)?.toLocaleString('zh-CN') ?? '—',
                  })}
                </span>
              </div>
            ))}
          </>
        )}
        {/**
         * **净收益/h**（**2026-09-29 船长令**：「我只想在调试模式下显示」）——
         * 与上面每行的"×N/h（仓库 · 行情）"并列，但它是**整批口径的净值**：
         * `(整批产物行情值 − 整批耗料行情成本) ÷ 精炼周期 × 3600`，与组装机/造船厂同一个组件、同一把尺。
         * 发布版不渲染（`debugEnabled()` 在本机之外恒 false）。
         */}
        <NetIncomeLine
          /* 整批产物行情值（每单位取市场折线图价、缺则基准价）× 整批耗料行情成本（按站内收价原值，
             不下材料学折扣——本行与上面每行的读数同一把尺，只换口径不换取数）÷ 精炼周期。 */
          price={outs.reduce((s, o) => s + o.units * (marketPriceOf(state, engine.ctx, o.def.id) ?? o.def.baseSellPriceIsk ?? 0), 0)}
          costIsk={batch * (marketPriceOf(state, engine.ctx, def.id) ?? def.baseSellPriceIsk ?? 0)}
          buildMs={cycleMs}
        />
      </div>
    )
  }

  return (
    <div className={`app-belt-card${highlight ? ' is-goto' : ''}`} key={def.id}>
      <div className="app-belt-head">
        <span className="app-belt-name">
          <RowGlyph glyph={itemGlyphName(def.id, def.kind)} /> {def.name}
          {isRareBox ? (
            <em
              className="app-chip is-rare"
              title={tr("ui.IndustryPage.034")}
            >
              {tr("ui.IndustryPage.035")}
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
                  ? tr("ui.IndustryPage.036")
                  : tr("ui.IndustryPage.101", { p1: gotoTarget.ids.length > 1 ? tr("ui.IndustryPage.085", { p1: gotoTarget.ids.length }) : '' })
              }
              onClick={() => onGotoMap(gotoTarget.tab, gotoTarget.ids)}
            >
              {isWreck ? tr("ui.IndustryPage.037") : tr("ui.IndustryPage.038")}
            </button>
          ) : null}
        </span>
      </div>
      <div className="app-belt-desc">
        {isWreck
          ? isRareBox
            ? tr("ui.IndustryPage.039")
            : tr("ui.IndustryPage.040")
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
                  {v.worker === 'pilot' ? tr("ui.IndustryPage.041") : tr("ui.IndustryPage.086", { p1: v.workerLabel })} ·{' '}
                  {isBox ? tr("ui.IndustryPage.087", { p1: v.batchesDone }) : isWreck ? tr("ui.IndustryPage.088", { p1: v.batchesDone }) : tr("ui.IndustryPage.089", { p1: v.batchesDone })}
                  {v.claimedUnits !== undefined
                    ? tr("ui.IndustryPage.090", { p1: Math.round(v.claimedUnits * 10) / 10 })
                    : ''}
                </span>
                <span
                  className="app-progress-mini"
                  title={tr("ui.IndustryPage.107", { p1: v.percent, p2: isBox ? tr("ui.IndustryPage.091", { p1: Math.round(v.cycleMs / 100) / 10 }) : tr("ui.IndustryPage.092", { p1: v.batchUnits, p2: Math.round(v.cycleMs / 100) / 10 }), p3: v.claimedUnits !== undefined
                      ? tr("ui.IndustryPage.093", { p1: v.batchUnits })
                      : tr("ui.IndustryPage.042") })}
                >
                  <i style={{ width: `${v.percent}%` }} />
                </span>
                <button
                  className="app-btn is-small is-warn"
                  onClick={() => stopRun(v.id, v.claimedUnits !== undefined)}
                  title={
                    v.claimedUnits !== undefined
                      ? tr("ui.IndustryPage.043")
                      : tr("ui.IndustryPage.044")
                  }
                >
                  {tr('ui.IndustryPage.104')}
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
                ? tr("ui.IndustryPage.094", { p1: isBox ? tr("ui.IndustryPage.045") : tr("ui.IndustryPage.042") })
                : isBox
                  ? tr("ui.IndustryPage.095", { p1: Math.max(1, Math.round(UNBOX_CYCLE_MS / 1000)) })
                  : isWreck
                    ? isRareBox
                      ? tr("ui.IndustryPage.096", { RARE_WRECK_VOLUME_M3: RARE_WRECK_VOLUME_M3, RECYCLE_BATCH_M3: RARE_WRECK_VOLUME_M3 })
                      : tr("ui.IndustryPage.046")
                    : tr("ui.IndustryPage.047"))
          }
          onClick={() => runWith('pilot')}
        >
          {isBox ? tr("ui.IndustryPage.048") : isWreck ? tr("ui.IndustryPage.049") : tr("ui.IndustryPage.050")}
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
                ? tr("ui.IndustryPage.051")
                : tr("ui.IndustryPage.052")
            }
          >
            {usableCores.length === 0 ? (
              <option value="">{tr("ui.ShipPage.070")}</option>
            ) : (
              usableCores.map((t) => (
                <option key={t} value={t}>
                  {aiCoreText(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）
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
                    ? tr("ui.IndustryPage.053")
                    : tr("ui.IndustryPage.054")
                : tr("ui.IndustryPage.055")
            }
            onClick={() => core && runWith(core)}
          >
            {isBox ? tr("ui.IndustryPage.056") : isWreck ? tr("ui.IndustryPage.057") : tr("ui.IndustryPage.058")}
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
      loot: profile.theme,
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

/**
 * **实验室面板**（**2026-09-29 船长令**：「为工业新增子页面：'实验室'。玩家可以在实验室生产燃料。
 * 实验室的生产卡片和其他工业卡片类似」）。
 *
 * ⚠ **观感纪律（§6：先复刻同级相似项，不自造新样式）**：本页**逐件复刻精炼炉那一套**——
 * `Panel`（标题 ＋ 圆形感叹号规格句 ＋ 右侧读数）→ `.app-win-body` → `.app-belt-grid` →
 * 每配方一张 `.app-belt-card`（`app-belt-head` / `-name` / `-head-right` / `-desc` / `-ore` /
 * `-econ` / `-actions` / `-workers` / `-ai`），**一个自造类名都没有**。
 * 解锁门槛 = 已建成空间站 ≥ 1 座（`engine.labUnlocked()`）；未解锁时本子页不渲染。
 */
function LabPanel({
  engine,
  onToast,
  onGotoMarket,
}: {
  engine: GameEngine
  onToast: PageProps['onToast']
  onGotoMarket?: (goodKey: string) => void
}): ReactNode {
  const state = engine.state
  const recipes = [...engine.ctx.labRecipes.values()]
  const runs = engine.labRunViews()
  return (
    <Panel
      className="is-fill"
      title={tr('ui.lab.001')}
      hint={<HintIcon tip={tr('ui.lab.024')} />}
      right={
        <>
          <span className="app-dim">{tr('ui.lab.024')}</span>
          <AiSlotText state={state} ctx={engine.ctx} />
        </>
      }
    >
      <div className="app-win-body">
        {recipes.length === 0 ? <div className="app-dim app-inv-empty">{tr('ui.lab.018')}</div> : null}
        <div className="app-belt-grid">
          {recipes.map((r) => (
            <LabCard
              key={r.id}
              recipe={r}
              engine={engine}
              onToast={onToast}
              onGotoMarket={onGotoMarket}
              runs={runs.filter((v) => v.recipeId === r.id)}
            />
          ))}
        </div>
      </div>
    </Panel>
  )
}

/**
 * **一张实验室配方卡**（骨架与类名逐件照 `FurnaceCard`）。
 *
 * 与精炼炉卡的**唯一差异**：材料是**多料 BOM**（逐行给"×需量 ＋ 仓库量 ＋ 行情价"），
 * 开工门槛从"够一批单料"变成"够一批全料"（`labAffordableBatches`）；产出与净收益/h 复用同一组件。
 */
function LabCard({
  recipe,
  engine,
  onToast,
  onGotoMarket,
  runs,
}: {
  recipe: LabRecipeDef
  engine: GameEngine
  onToast: PageProps['onToast']
  onGotoMarket?: (goodKey: string) => void
  runs: LabRunView[]
}): ReactNode {
  const state = engine.state
  const rate = refineRate(state, engine.ctx)
  const out = engine.ctx.items.get(recipe.outputItemId)
  const affordable = labAffordableBatches(state, recipe)
  const batchValue = recipe.outputUnits * (marketPriceOf(state, engine.ctx, recipe.outputItemId) ?? out?.baseSellPriceIsk ?? 0)
  const costIsk = recipe.materials.reduce(
    (s, m) =>
      s + m.units * (marketPriceOf(state, engine.ctx, m.itemId) ?? engine.ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0),
    0,
  )
  const usableCores = CORE_ORDER.filter((t) => countAiCore(state, t) > 0)
  const [coreSel, setCoreSel] = useState<AiCoreType>(() => bestAiCoreOf(state) ?? 'basic')
  const core = usableCores.includes(coreSel) ? coreSel : (usableCores[0] ?? null)
  const manualBusy = manualBusyNote(state)
  /**
   * **谜质科技门槛**（**2026-09-30 船长令**：T5「解锁新的燃料配方」）——判据与起线拒绝**同一把尺**
   * （`labRecipeUnlocked`）；锁着时卡片照列（玩家要看得见"有这么张配方、缺哪棵树"），
   * 但两个开工按钮一起置灰，并把缺哪条科技写在标题与卡片提示行上。
   */
  const locked = !labRecipeUnlocked(state, engine.ctx, recipe)
  const lockTip = locked ? tr('ui.lab.025', { p1: labTechRequirementOf(engine.ctx, recipe) ?? recipe.name }) : null
  function runWith(worker: AiCoreType | 'pilot'): void {
    const r = engine.startLabRunAt(recipe.id, worker)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.lab.013'), true)
      return
    }
    const who = worker === 'pilot' ? tr('ui.IndustryPage.020') : tr('ui.IndustryPage.068', { p1: aiCoreName(worker) })
    onToast(tr('ui.lab.019', { p1: recipe.name, p2: recipe.outputUnits, who }))
  }
  return (
    <div className="app-belt-card" key={recipe.id}>
      <div className="app-belt-head">
        <span className="app-belt-name">
          {/* ⚠ **2026-09-30 船长报障「新道具图标你还没定」**：这里原先把图标写死成 `consumable`
              ⇒ 实验室三张卡（燃料/加速剂/发射器）全是通用「消耗品」图标。改走**物品 id 单点映射**
              `itemGlyphName`（与物品页/货仓页同一处判定，三件各有专属线稿）。 */}
          <RowGlyph glyph={itemGlyphName(recipe.outputItemId, out?.kind ?? 'consumable')} /> {recipe.name}
        </span>
        <span className="app-belt-head-right">
          <span className="app-dim">
            {tr('ui.lab.005')} {affordable}
          </span>
        </span>
      </div>
      {/* **产品自己的说明**（**2026-09-30 船长报障**：「信号发射器 · 突触加速剂的实验室生产卡片说明
          还是采用燃料的」）——原来这里写死 `ui.lab.010`（燃料口径）⇒ 所有配方卡片都在念燃料那套话。
          现改成**取产出物自己的 `description`**：一件产品一份说明（单一来源，不再每张配方各写一段）。 */}
      <div className="app-belt-desc">{out?.description ?? ''}</div>
      {lockTip !== null ? <div className="app-belt-desc app-bad">{lockTip}</div> : null}
      {/* 数据行（与精炼炉同款位置）：每批产出 / 每批工期 / 精炼速率 */}
      <div className="app-belt-ore">
        {tr('ui.lab.003')} {out?.name ?? recipe.outputItemId} ×{recipe.outputUnits}
        {' · '}
        {tr('ui.lab.004')} {Math.round(recipe.cycleMs / 60_000)} {tr('ui.lab.012')}
        {' · '}
        {tr('ui.IndustryPage.062')} {Math.round(rate * 100)}%
      </div>
      {/* 材料行：与精炼炉「♨ 产出：」同款缩进行（这里是"投料"），行尾给仓库量与行情价 */}
      <div className="app-belt-econ">
        <div>{tr('ui.lab.009')}</div>
        {recipe.materials.map((m) => {
          const def = engine.ctx.items.get(m.itemId)
          const have = labMaterialAvailable(state, m.itemId)
          return (
            <div key={m.itemId} className={`app-belt-out${have >= m.units ? '' : ' app-bad'}`} title={def?.description ?? ''}>
              {def?.name ?? m.itemId} ×{m.units}
              <span className="app-dim">
                {' '}
                {tr('ui.Yield.004', {
                  p1: Math.floor(have).toLocaleString('zh-CN'),
                  p2: marketPriceOf(state, engine.ctx, m.itemId)?.toLocaleString('zh-CN') ?? '—',
                })}
              </span>
            </div>
          )
        })}
        <NetIncomeLine price={batchValue} costIsk={costIsk} buildMs={recipe.cycleMs} />
      </div>
      <div className="app-belt-actions">
        {/* 运转单位名册（每台一行：劳动者 + 当前批进度条 + 停）——与精炼炉逐字同款 */}
        {runs.length > 0 ? (
          <div className="app-belt-workers">
            {runs.map((v) => (
              <span key={v.id} className="app-belt-worker">
                <span className="app-belt-worker-name">
                  {v.worker === 'pilot' ? tr('ui.IndustryPage.041') : tr('ui.IndustryPage.086', { p1: aiCoreText(v.worker) })} ·{' '}
                  {tr('ui.lab.007', { p1: v.batchesDone })}
                </span>
                <span className="app-progress-mini" title={tr('ui.lab.020', { p1: v.percent, p2: v.batchUnits, p3: Math.round(v.cycleMs / 100) / 10 })}>
                  <i style={{ width: `${v.percent}%` }} />
                </span>
                <button
                  className="app-btn is-small is-warn"
                  onClick={() => {
                    const r = engine.stopLabRunAt(v.id)
                    if (!r.ok) onToast(cmdText(r) || tr('ui.lab.016'), true)
                  }}
                  title={tr('ui.lab.008')}
                >
                  {tr('ui.IndustryPage.104')}
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <button
          className="app-btn is-small is-primary"
          disabled={locked || manualBusy !== null || affordable <= 0}
          title={lockTip ?? manualBusy ?? (affordable <= 0 ? tr('ui.lab.021') : tr('ui.lab.006'))}
          onClick={() => runWith('pilot')}
        >
          {tr('ui.lab.006')}
        </button>
        {/* AI 工位：核心下拉常驻（与精炼炉同款：无核心时置灰，卡面不跳动） */}
        <div className="app-belt-ai">
          <select
            className="app-select"
            value={usableCores.length === 0 ? '' : (core ?? '')}
            onChange={(e) => setCoreSel(e.target.value as AiCoreType)}
            disabled={usableCores.length === 0}
            title={usableCores.length === 0 ? tr('ui.IndustryPage.051') : tr('ui.IndustryPage.052')}
          >
            {usableCores.length === 0 ? (
              <option value="">{tr('ui.ShipPage.070')}</option>
            ) : (
              usableCores.map((t) => (
                <option key={t} value={t}>
                  {aiCoreText(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）
                </option>
              ))
            )}
          </select>
          <button
            className="app-btn is-small"
            disabled={locked || !core || affordable <= 0}
            title={lockTip ?? (core ? (affordable <= 0 ? tr('ui.lab.021') : tr('ui.lab.014', { p1: aiCoreText(core) })) : tr('ui.IndustryPage.055'))}
            onClick={() => core && runWith(core)}
          >
            {tr('ui.lab.022')}
          </button>
        </div>
        {onGotoMarket ? (
          <button className="app-btn is-small" onClick={() => onGotoMarket(recipe.outputItemId)} title={tr('ui.lab.023')}>
            {tr('ui.lab.023')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function IndustryPage({ engine, onToast, onGotoMarket, onGotoMap, onGotoWormhole, onGotoPlugExchange, plugExchangeFocus, focusSec = null }: PageProps & {
  onGotoMarket?: (goodKey: string) => void
  onGotoMap?: (tab: 'mine' | 'salvage', ids: string[]) => void
  /** 「去虫洞（遗迹打捞）」：跳星图 · 出港 · 扫描虫洞（船长 2026-09-14：虫洞专属图纸市场买不到；
   *  声望不达标时组装机那张卡自己会置灰，不会走到这里） */
  onGotoWormhole?: () => void
  /** 「前往章鱼人兑换」：开**章鱼人声望商店**（**2026-09-26 船长令**：插件图纸缺书的卡走这里）。
   *  由 App 持有的统一窗口状态开，与首匣那封通讯**同一个出口**。 */
  onGotoPlugExchange?: () => void
  /** 兑换窗口开过的次数（自增序号）：变化时组装机自动切到「舰船插件」档（船长要的"跳转到筛选内"） */
  plugExchangeFocus?: number
  /** **内层段定位**（船长 2026-09-18：「第一次」卡片的跳转按钮要直达精炼炉 / 组装机）——
   *  页在切走时重挂载（`key={page}`）⇒ 取初值即可，不必 seq 机制。 */
  focusSec?: 'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab' | null
}) {
  const state = engine.state
  const rate = refineRate(state, engine.ctx)

  const [sec, setSecState] = useState<'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab'>(
    /**
     * 初值优先级：**程序化定位**（「第一次」卡片的跳转）> **会话级记忆**（2026-09-26 船长令）> 默认「精炼炉」。
     * 记忆只在本进程内有效（见 `ui/sessionView.ts`）；程序化跳转落定后同样写进记忆（见下面的 `setSec`）。
     */
    () => focusSec ?? ((sessionPick('industry.sec') as 'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab' | null) ?? 'refine'),
  )
  /** 切子页（五个签）＝ 写会话记忆；程序化跳转也走它 ⇒ 记的永远是"玩家最后看到的那个子页" */
  const setSec = (v: 'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab'): void => {
    setSecState(v)
    setSessionPick('industry.sec', v)
  }
  /**
   * **已经进过的子页**（2026-09-22 第 2 步）：进过一次就常驻，切换只切显示（详见下面渲染处的说明）。
   * 初值 = 当前那一栏（含 `focusSec` 程序化跳转进来的落点），保证首屏只挂一个面板、不做无谓冷启动。
   */
  const [seenSec, setSeenSec] = useState<ReadonlySet<'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab'>>(
    () => new Set(['refine', 'shelf', 'craft', 'shipyard', 'lab'].filter((k) => k === (focusSec ?? 'refine')) as Array<'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab'>),
  )
  useEffect(() => {
    setSeenSec((s) => (s.has(sec) ? s : new Set(s).add(sec)))
  }, [sec])
  /**
   * **首访实验室**（**2026-09-30 船长令**：「当玩家第一次进入实验室页面时，给玩家发送一封通讯，
   * 来源不能是官方（毕竟信号发射器是违法的），为玩家详细说明下信号发射器和突触加速剂」）。
   *
   * 只置随档标记（`engine.noteLabOpened()`，内部幂等）——通讯由 `advanceComms` 按标记送达并弹窗；
   * HUD 版实验室页签同一处口径（见 `IndustryHudPage.tsx`）。
   */
  useEffect(() => {
    if (sec === 'lab') engine.noteLabOpened()
  }, [sec, engine])
  const { t } = useL10n()
  /**
   * **精炼炉的两级筛选**（2026-09-14 船长：「精炼炉和组装机一样，添加筛选标签」）：
   * `furnaceTab` = 一级（活计大类）· `sub` = 二级（资源大类 / 残骸档位；`''` = 全部子类）。
   * 切一级标签即回「全部子类」——与组装机、市场页 `changeKind` 同款口径。
   */
  const [furnaceTab, setFurnaceTabState] = useState<FurnaceTab>(() => {
    const v = sessionPick('industry.furnace.tab')
    return v === 'all' || v === 'ore' || v === 'wreck' || v === 'box' ? v : 'all'
  })
  const [sub, setSubState] = useState<string>(() => sessionPick('industry.furnace.sub') ?? SUB_ALL)
  /**
   * 炉子两级筛选的写入口 —— **两个都做会话级记忆**（2026-09-26 船长令，裁定「两级都记，但是不记搜索」）：
   * 切走再回来仍是"上次看的那一档 ＋ 那一子类"；`fKw`（搜索词）**刻意不记**。
   */
  const setFurnaceTab = (v: FurnaceTab): void => {
    setFurnaceTabState(v)
    setSessionPick('industry.furnace.tab', v)
  }
  const setSub = (v: string): void => {
    setSubState(v)
    setSessionPick('industry.furnace.sub', v)
  }
  /**
   * **精炼炉搜索栏**（船长 2026-09-19：「也给精炼炉和组装机添加搜索栏」；追问后定范围 =
   * **名称 ＋ 产物/材料 ＋ 说明**）：搜资源/残骸/货柜名、它们的说明，以及**产出侧的名字**
   * ——可精炼资源搜精炼产物、残骸搜保底矿物池（"某材料由什么炼出来"也搜得到）。与筛选取「与」。
   */
  const [fKw, setFKw] = useState('')
  const fq = fKw.trim().toLowerCase()
  const runViews = engine.refineRunViews()
  // 组装机「去精炼」跳转目标（矿石卡 id；高亮数秒后自清；2026-09-08 船长定）
  const [focusOreId, setFocusOreId] = useState<string | null>(null)
  /**
   * **蓝图书架 → 组装机**跳转目标（蓝图 id；船长 2026-09-14：「蓝图书架内，玩家可以通过蓝图直接跳转
   * 对应组装机」）——与 `focusOreId` 同一套高亮机制（`.app-belt-card.is-goto` + 居中滚动 + 3.5 秒自清），
   * 只是目标在组装机那一栏，所以跳的时候要**同时把组装机的三级筛选清掉**（`craftFocus` 透传给面板，
   * 面板在自己的 effect 里复位 tab/sub/useKind —— 否则目标卡可能正被筛掉，跳过去是一片空白）。
   */
  const [craftFocus, setCraftFocus] = useState<string | null>(null)
  /**
   * **组装机 → 蓝图书架的反向定位目标**（**2026-09-26 船长令**：优化工业界面 → 优3）。
   * 与 `craftFocus` 完全对称：那一头是"书架点蓝图书 → 跳组装机并高亮那张卡"，
   * 这一头是"组装机点「去书架」→ 跳蓝图书架并高亮那一本"。两者共用下面同一个滚动/自清 effect
   * （它按 `.app-belt-card.is-goto` 找当前显示栏里的高亮卡）。
   */
  const [bookFocus, setBookFocus] = useState<string | null>(null)
  useEffect(() => {
    if (!focusOreId && !craftFocus && !bookFocus) return
    // ⚠ 只找**当前显示**那一栏里的高亮卡：第 2 步保活之后，`page-stack` 下同时挂着多个 `.ind-pane`，
    //   隐藏栏里若还留着上一次的高亮（3.5 秒自清之前），全页 querySelector 可能先命中它 ⇒ 滚了个看不见的卡。
    document.querySelector('.ind-pane:not(.is-off) .app-belt-card.is-goto')?.scrollIntoView({ block: 'center' })
    const t = window.setTimeout(() => {
      setFocusOreId(null)
      setCraftFocus(null)
      setBookFocus(null) // 反向定位与正向同一套自清（3.5 秒后摘掉高亮）
    }, 3500)
    return () => window.clearTimeout(t)
  }, [focusOreId, craftFocus, bookFocus])

  /** 组装机/造船厂需求材料点击（**2026-09-22 船长令**：「**希望提示玩家去组装机生产零件，不要提示去市场**」
   *  ＋「**高级零件依旧去相应的组装机**」）——三支，优先级从上到下：
   *  ① **有精炼源矿石** ⇒ 精炼 tab 并定位该矿石卡；
   *  ② **能在这台机器上造出来**（零件 14 种 / 任何"产物是物品"的蓝图）⇒ **切到组装机并定位那张零件卡**；
   *  ③ 既炼不出也造不出 ⇒ 跳市场（原行为）。
   *  ⚠ 源矿石同样只看"玩家可见目录"：未上线矿石（如虚空母矿）不能作为跳转目标出现。
   *  ⚠ 2026-09-14：加了筛选标签之后，**必须同时把一级/二级筛选让开**——否则跳到一张被筛掉的卡上，
   *  高亮根本看不见（`setFurnaceTab('ore')` + `setSub(SUB_ALL)`）。 */
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
      setSub(SUB_ALL)
      setFocusOreId(src)
      return
    }
    /** ② 造得出来（零件等）⇒ 去组装机那张卡（面板常驻 ⇒ 切显示 ＋ 定位高亮；零件图都在 `ctx.blueprints`） */
    const madeBy = blueprintProducingItem(engine.ctx, itemId)
    if (madeBy) {
      setSec('craft')
      setCraftFocus(madeBy.id)
      return
    }
    for (const g of engine.ctx.marketGoods.values()) {
      if (g.kind === 'item' && g.refId === itemId) {
        onGotoMarket?.(g.key)
        return
      }
    }
    onToast(tr("ui.IndustryPage.097", { p1: engine.ctx.items.get(itemId)?.name ?? itemId }), true)
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
   *  卡片带「高级箱」徽标；区别只在"首批触发一次高级箱"（一炉一箱）。
   *  ⚠ **H 族（墨潮帮）残骸的回收闸门已于 2026-09-26 退役**（船长 2026-09-25 曾令关炉、
   *  等势力装备；2026-09-26 三件定稿 ⇒ 理由消失）⇒ 原先那层摘卡过滤一并删除，H 族卡片照常出现。 */
  const wreckDefs = allItemDefs.filter(
    (def) =>
      def.kind === 'wreck' &&
      (oreAvailable(state, def.id) > 0 || runViews.some((v) => v.itemId === def.id)),
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
   *       「残骸回收」按**档位**（普通 / 稀有残骸）；「全部」与「货柜拆解」不带二级（同组装机）。 */
  const oreSubs: SubOpt[] = Object.keys(ORE_KIND_LABEL)
    .filter((k) => oreDefs.some((d) => d.kind === k))
    .map((k) => ({ key: k, label: ORE_KIND_LABEL[k]! }))
  /**
   * **二级候选只列真有内容的档**（2026-09-20 船长「明显不存在的子类筛选隐藏」）：
   * 可精炼资源按资源大类现算（oreDefs 里真有该大类）；残骸按档位现算（没有稀有残骸时不列「稀有」档）。
   */
  const subOptions: SubOpt[] =
    furnaceTab === 'ore'
      ? oreSubs
      : furnaceTab === 'wreck'
        ? presentSubs(WRECK_SUBS, (key) =>
            wreckDefs.some((d) => (key === 'rare' ? wreckTierOf(d.id) === 'rare' : wreckTierOf(d.id) !== 'rare')),
          )
        : []
  /**
   * **内容没了 ⇒ 原选择可能已经空档**：残骸列表是**动态**的（货仓/仓库里没有的那种残骸就不列卡）——
   * 玩家把最后一块稀有残骸投炉后，「稀有」档随之消失，若选择还停在它上面就成了**看不见的筛选**（卡片全空且无提示）。
   * 故与蓝图书架同一口径：选择不在候选里就回落到「全部子类」。
   */
  const subMissing = sub !== SUB_ALL && !subOptions.some((s) => s.key === sub)
  useEffect(() => {
    if (subMissing) setSub(SUB_ALL)
  }, [subMissing])
  /**
   * **搜索命中**（名称 ＋ 产物/材料 ＋ 说明）：`fq` 为空 ⇒ 恒真。
   * 产出侧名字：可精炼资源取 `def.refine` 的精炼产物名；残骸取 `recycleMineralPoolOf(profile)` 的保底矿物名
   * （"某材料由什么炼/拆出来"也能搜到）；货柜只按名称与说明。
   */
  const fHit = (def: ItemDef): boolean => {
    if (fq.length === 0) return true
    if (def.name.toLowerCase().includes(fq)) return true
    if ((def.description ?? '').toLowerCase().includes(fq)) return true
    // 大类名也入索引（与物品页仓库的搜索同口径）——否则搜「冰矿」会 0 命中：冰类物品名是
    // 蓝霜冰 / 寒髓冰 / 暗星冰，**不含「冰矿」二字**（2026-09-19 探针实测）
    if ((ITEM_KIND_LABELS[def.kind] ?? '').toLowerCase().includes(fq)) return true
    const outs: string[] = (def.refine ?? []).map((r) => engine.ctx.items.get(r.mineralId)?.name ?? r.mineralId)
    const prof = def.kind === 'wreck' ? recycleProfileOf(engine.ctx, def.id) : null
    if (prof) for (const [mineralId] of recycleMineralPoolOf(prof)) outs.push(engine.ctx.items.get(mineralId)?.name ?? mineralId)
    return outs.some((n) => n.toLowerCase().includes(fq))
  }
  const oreFiltered = sub === SUB_ALL ? oreDefs : oreDefs.filter((d) => d.kind === sub)
  /** 残骸档位：判据 = `wreckTierOf`（= core `isRareWreck`，与卡上的「稀有」徽标同源单点） */
  const wreckFiltered =
    sub === 'rare'
      ? wreckDefs.filter((d) => wreckTierOf(d.id) === 'rare')
      : sub === 'common'
        ? wreckDefs.filter((d) => wreckTierOf(d.id) !== 'rare')
        : wreckDefs
  const oreShownF = pinMarked(state, 'recipes', oreFiltered.filter(fHit), (def) => def.id)
  const wreckShownF = pinMarked(state, 'recipes', wreckFiltered.filter(fHit), (def) => def.id)
  const boxShownF = boxDefs.filter(fHit)
  /** 一级标签实际要渲染哪几组（「全部」= 四组都渲染，其余只渲染对应那一组） */
  const showOre = furnaceTab === 'all' || furnaceTab === 'ore'
  const showWreck = furnaceTab === 'all' || furnaceTab === 'wreck'
  const showBox = furnaceTab === 'all' || furnaceTab === 'box'
  /** 当前筛选/搜索下"一共几张卡"（读数行用；与组装机的「· 当前 N 张」同款） */
  const shownCount =
    (showOre ? oreShownF.length : 0) + (showWreck ? wreckShownF.length : 0) + (showBox ? boxShownF.length : 0)
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
          <span>{tr("ui.ShipPage.097")}</span>
        </button>
        <button
          role="tab"
          aria-selected={sec === 'craft'}
          className={`app-subtab${sec === 'craft' ? ' is-active' : ''}`}
          onClick={() => setSec('craft')}
        >
          <span>⚒</span>
          <span>{tr("ui.IndustryPage.059")}</span>
        </button>
        <button
          role="tab"
          aria-selected={sec === 'shipyard'}
          className={`app-subtab${sec === 'shipyard' ? ' is-active' : ''}`}
          onClick={() => setSec('shipyard')}
        >
          <span>⚓</span>
          <span>{tr("ui.IndustryPage.110")}</span>
        </button>
        <button
          role="tab"
          aria-selected={sec === 'shelf'}
          className={`app-subtab${sec === 'shelf' ? ' is-active' : ''}`}
          onClick={() => setSec('shelf')}
        >
          <span>▦</span>
          <span>{tr("ui.IndustryPage.060")}</span>
        </button>
        {/* **实验室**（**2026-09-29 船长令**）：**门槛后才出现**（首座空间站建成 ⇒ `labUnlocked`）——
            不是灰掉，是不渲染（船长口径：门槛前"看不到相关内容"）。 */}
        {engine.labUnlocked() ? (
          <button
            role="tab"
            aria-selected={sec === 'lab'}
            className={`app-subtab${sec === 'lab' ? ' is-active' : ''}`}
            onClick={() => setSec('lab')}
          >
            <span>⚗</span>
            <span>{tr("ui.lab.001")}</span>
          </button>
        ) : null}
      </div>

      {/* ═══ 四个子页**保活**（2026-09-22 工业页卡顿修复第 2 步）═══
          原先这里是 `sec === 'craft' ? … : sec === 'shipyard' ? …` 的三元链：同一时刻只挂载一个子页，
          ⇒ 每次切换 = 旧面板整棵卸载 + 新面板从零重建（实测组装机 151 张卡 8298 节点：1× 花 75 ms、
          弱机档 700 ms，"数秒的卡顿"正是它）。现在改成**首次进入才挂载、之后常驻**，切换只切显示：
          `.ind-pane` 用 `display: contents`（面板照旧直接参与 `.page-stack` 的 flex 布局，不引入多余盒子），
          隐藏时 `display: none`（不占位、不参与布局与绘制）。
          ⚠ 与第 3 步配套：面板常驻后每次心跳仍会重渲染 ⇒ 靠卡片的实时指纹 `memo` 兜住，否则代价 ×4。
          ⚠ 行为变化（已报船长）：面板内部的筛选/搜索/滚动位置**不再因切换而复位**。 */}
      {seenSec.has('craft') ? (
        <IndPane scrollKey="industry.craft.scroll" off={sec !== 'craft'}>
          <ManufacturingPanel
            engine={engine}
            onToast={onToast}
            onNeedMineral={handleNeedMineral}
            onGotoMarket={onGotoMarket}
            onGotoWormhole={onGotoWormhole}
            onGotoPlugExchange={onGotoPlugExchange}
            /**
             * **组装机 → 蓝图书架的反向入口**（**2026-09-26 船长令**：优化工业界面 → 优3）：
             * 与书架→组装机**同一套手法**（切子页 ＋ 定位高亮），只是方向反过来。
             */
            onGotoShelf={(bpId) => {
              setSec('shelf')
              setBookFocus(bpId)
            }}
            plugExchangeFocus={plugExchangeFocus}
            focusBlueprintId={craftFocus}
          />
        </IndPane>
      ) : null}
      {seenSec.has('shipyard') ? (
        <IndPane scrollKey="industry.shipyard.scroll" off={sec !== 'shipyard'}>
          <ShipyardPanel
            engine={engine}
            onToast={onToast}
            onNeedMineral={handleNeedMineral}
            onGotoMarket={onGotoMarket}
            onGotoWormhole={onGotoWormhole}
            focusBlueprintId={craftFocus}
          />
        </IndPane>
      ) : null}
      {seenSec.has('shelf') ? (
        <IndPane scrollKey="industry.shelf.scroll" off={sec !== 'shelf'}>
          <BlueprintShelfPanel
            engine={engine}
            onToast={onToast}
            focusBookId={bookFocus}
            onGotoCraft={(bpId) => {
              // 2026-09-20 零件体系：舰船书跳造船厂、其余书跳组装机；切栏 + 定位高亮那张卡
              setSec(engine.ctx.shipBlueprints.has(bpId) ? 'shipyard' : 'craft')
              setCraftFocus(bpId)
            }}
          />
        </IndPane>
      ) : null}
      {seenSec.has('refine') ? (
      <IndPane scrollKey="industry.refine.scroll" off={sec !== 'refine'}>
        <Panel
          className="is-fill win-fixed-body"
          title={tr("ui.ShipPage.097")}
          hint={
            <HintIcon
              tip={tr("ui.IndustryPage.098", { RARE_WRECK_VOLUME_M3: RARE_WRECK_VOLUME_M3 })}
            />
          }
          right={
            <>
              {/* 搜索栏（船长 2026-09-19）：与物品页/货仓/技能/舰船页/手册同款（标题行右侧） */}
              <span className="app-head-search-wrap">
                <input
                  className="app-head-search"
                  type="text"
                  placeholder={tr('ui.IndustryPage.111')}
                  value={fKw}
                  onChange={(e) => setFKw(e.target.value)}
                  spellCheck={false}
                />
              </span>
              <span
                className="app-dim"
                title={tr("ui.IndustryPage.061")}
              >
                {tr("ui.IndustryPage.062")} {Math.round(rate * 100)}{tr('ui.IndustryPage.102', { n: runningCount })} {tr("ui.IndustryPage.063")} {oreDefs.length}{tr('ui.IndustryPage.103', { n: wreckDefs.length })}
                {boxDefs.length > 0 ? tr("ui.IndustryPage.099", { p1: boxDefs.length }) : ''}
                {/* 搜索/筛选生效时补读数（与组装机同款：免得玩家对着收窄后的网格数不清） */}
                {fq.length > 0
                  ? tr('ui.IndustryPage.108', { n: shownCount })
                  : shownCount !== totalCount
                    ? tr("ui.IndustryPage.100", { shownCount: shownCount })
                    : ''}
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
                  setSub(SUB_ALL) // 换一级标签即回「全部子类」（与组装机、市场页 changeKind 同款）
                }}
              >
                {subText(t)}
              </button>
            ))}
          </div>
          {subOptions.length > 0 ? (
            <div className="app-task-tabs app-fleet-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={sub === SUB_ALL}
                className={`app-tasktab${sub === SUB_ALL ? ' is-active' : ''}`}
                onClick={() => setSub(SUB_ALL)}
              >
                {tr("ui.IndustryPage.064")}
              </button>
              {subOptions.map((s) => (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={sub === s.key}
                  className={`app-tasktab${sub === s.key ? ' is-active' : ''}`}
                  onClick={() => setSub(s.key)}
                >
                  {subText(s)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="app-win-body">
          {totalCount === 0 ? (
            <div className="app-dim app-inv-empty">
              {tr("ui.IndustryPage.065")}
            </div>
          ) : null}
          {shownCount === 0 && totalCount > 0 ? (
            <div className="app-dim app-exp-idle">{tr("ui.IndustryPage.066")}</div>
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

          {showBox && boxShownF.length > 0 ? (
            <div className="app-belt-grid">
              {boxShownF.map((def) => (
                <FurnaceCard key={def.id} def={def} engine={engine} onToast={onToast} onGotoMap={onGotoMap} />
              ))}
            </div>
          ) : null}
          {showBox && boxShownF.length === 0 ? (
            <div className="app-dim app-exp-idle">
              {fq.length > 0
                ? tr('ui.IndustryPage.109')
                : tr("ui.IndustryPage.067")}
            </div>
          ) : null}
          </div>
        </Panel>
      </IndPane>
      ) : null}
      {/* 实验室（**2026-09-29 船长令**）：与其余四页同一套保活手法（`IndPane` + 会话滚动记忆） */}
      {engine.labUnlocked() && seenSec.has('lab') ? (
        <IndPane scrollKey="industry.lab.scroll" off={sec !== 'lab'}>
          <LabPanel engine={engine} onToast={onToast} onGotoMarket={onGotoMarket} />
        </IndPane>
      ) : null}
    </div>
  )
}

/**
 * **工业页的一个子页容器**（2026-09-26）——保活用的 `.ind-pane` ＋ **主列表滚动位置的会话级记忆**。
 *
 * 为什么单开这个小件：滚动体在四个面板里形态不一（精炼炉/造船厂是面板内的 `.app-win-body`，
 * 组装机/蓝图货架是 `Panel` 自己的 `.wui-panel-body`）⇒ 统一由 `useSessionScrollFrom` 从这一层
 * **自→祖先→后代**反查，页面侧不必逐面板知道细节。
 *
 * ⚠ 钩子必须**无条件调用**（Hook 规则）⇒ 这个小件一律渲染 `.ind-pane` 本体（`display: contents`，
 * 布局与改造前逐像素一致），显示与否只由 `off` 决定类名。
 */
function IndPane({ scrollKey, off, children }: { scrollKey: string; off: boolean; children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  useSessionScrollFrom(scrollKey, ref)
  return (
    <div className={`ind-pane${off ? ' is-off' : ''}`} ref={ref}>
      {children}
    </div>
  )
}


