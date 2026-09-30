/**
 * **工业 HUD 页（调试专用）**（**2026-09-30 船长令**）。
 *
 * 船长原话：「**实验室界面采用统一界面…或者你利用skill进行设计也行**」＋「**和之前技能树一样，
 * 先复制现有工业页面，然后修改后单独做一个新的工业页面入口放在导航栏，仅调试模式可见。
 * 配色先做一套默认的深空配色。其他按你推荐来。我已经验收**」＋「**现在文字太多了，适量的图标
 * 也不能拉下**」。
 *
 * 三条口径：
 * 1. **另起一页、不动现有工业页**（现有 `pages/IndustryPage.tsx` 与全仓 `.app-*` 一字未改）——
 *    本页的样式全部挂在 `.hud` 命名空间下（`ui/layout-css/_hud-industry.css`）；
 * 2. **只在调试模式可见**（`DEBUG_NAV_ITEMS` 那条入口 ＋ 本页内不再另判，入口即闸门）；
 * 3. **少字多图标**（船长追令）：能一图说清的一律图标 ＋ 2~4 字；解释性长句**只进悬停**
 *    （HTML 走 `title`，由全仓 `ui/Tooltip.tsx` 接管），不在页面上铺开。
 *
 * 设计来源：`ui-ux-pro-max`（MASTER = HUD / Sci-Fi FUI · 深空配色 · 密度 8/10 · 动效 Subtle）；
 * 草稿与令牌出处见 `docs/design/industry-console-design-20260930.md`。
 *
 * ⚠ **本版覆盖度（诚实标注）**：精炼炉与实验室是**本页自己画的 HUD 版**；组装机 / 造船厂
 * 暂时**内嵌既有面板**（功能完整、观感仍是旧卡片）——它们的 HUD 化按船长"一批一批来"的节奏排后续。
 */
import { useMemo, useState, type ReactNode } from 'react'
import {
  aiCoreCap,
  aiEfficiency,
  calcBuildDurationMs,
  canStartBlueprint,
  countAiCore,
  countWare,
  formatDurationShort,
  industryAiBonus,
  labAffordableBatches,
  labMaterialAvailable,
  matNeedCount,
  materialDisplayIdOf,
  materialGroupIdsOf,
  manufacturingRunViews,
  missingMaterials,
  oreAvailable,
  ownsBlueprint,
  recipeCapability,
  refineBatchOutputOf,
  refineRate,
  refineRateMax,
  sortManuRows,
  UNBOX_CYCLE_MS,
  visibleItemDefs,
  type AiCoreType,
  type MaterialNeed,
} from '@whale/core'
import type { PageProps } from './common'
import type { GameEngine } from '../game/engine'
import { Glyph } from '../ui/Glyphs'
import { RowGlyph } from '../ui/itemView'
import { IconBtn, Readout } from '../ui/hud'
import { aiCoreText } from '../ui/labelsText'
import { marketPriceOf } from '../ui/yieldView'
import { ShipSprite } from '../ui/ShipSprite'
import { SHIP_TIER_SUBS, SUB_ALL, WRECK_SUBS, wreckTierOf } from '../ui/itemSubs'
import { hoverTipProps } from '../ui/Tooltip'
import { bookPriceOf } from '../panels/Industry'
import { tr, cmdText, useL10n } from '../i18n/locale'
import '../ui/layout-css/_hud-industry.css'

type HudTab = 'refine' | 'craft' | 'shipyard' | 'lab'

/** 精炼炉投料的一级档（与现有工业页 `FURNACE_TABS` 同口径：全部 / 可精炼资源 / 残骸回收 / 货柜拆解） */
type FeedTab = 'all' | 'ore' | 'wreck' | 'box'
/** 一级档的图标与文案 id（文案复用现有工业页那四条 id，不新造同义串） */
const FEED_TABS: ReadonlyArray<{ k: FeedTab; glyph: string; id: string }> = [
  { k: 'all', glyph: 'ico-feed', id: 'ui.IndustryPage.001' },
  { k: 'ore', glyph: 'ore', id: 'ui.IndustryPage.002' },
  { k: 'wreck', glyph: 'wreck', id: 'ui.IndustryPage.003' },
  { k: 'box', glyph: 'container', id: 'ui.IndustryPage.004' },
]

/** 环的一个分段（`key` 与构成表行一一对应；`isk` = 该资源产值/h） */
interface ShareSeg {
  key: string
  label: string
  isk: number
  detail: string
}

/**
 * **精炼产出构成环（SVG 多段环）**——**2026-09-30 船长令**：「给圆环添加动画，按照当前所有精炼炉产出
 * 各个资源的占比，将其分配到圆环上并染色，玩家鼠标移动上去时，显示该资源产量」。
 *
 * 为什么改成 SVG（三件事一起解决，且回到合规线）：
 * 1. 原先那个环是 **CSS `conic-gradient` 画的图形**，而船长 2026-09-10 定过「**形状只允许用 SVG 画**，
 *    CSS 只能做背景氛围」⇒ 多段染色＋分段悬停＋过渡这三件都更该走 SVG；
 * 2. **分段悬停**：每段一条 `<circle>`，自己的 `data-tip`（SVG 悬停按全仓规矩只走 `data-tip`）；
 * 3. **动画**：动的是 `stroke-dasharray/dashoffset`（不触发布局的描边属性），并在 `prefers-reduced-motion`
 *    与「关特效」下退化为瞬时。
 *
 * 技能 chart 域「Part-to-Whole」的三条硬口径都在这里落地：**≤5 类**（多出的并进「其他」）·
 * **最大段从 12 点方向起**（分段已按产值降序 + `rotate(-90)`）· **不能只靠颜色**（环旁有同名同值的
 * 构成表，且 svg 带 `aria-label` 逐段念出占比）。
 */
function RefineShareRing({ segments, total }: { segments: readonly ShareSeg[]; total: number }): ReactNode {
  const size = 132
  const stroke = 15
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  let acc = 0
  return (
    <svg
      className="hud-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={tr('ui.hud.138', {
        p1: segments
          .map((s) => `${s.label} ${total > 0 ? Math.round((s.isk / total) * 100) : 0}%`)
          .join(tr('ui.MatterTechTab.017')),
      })}
    >
      <circle className="hud-ring-bg" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
      {segments.map((s, i) => {
        const frac = total > 0 ? s.isk / total : 0
        const len = Math.max(0, frac * c)
        const off = -acc * c
        acc += frac
        return (
          <circle
            key={s.key}
            className="hud-ring-seg"
            data-seg={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeDasharray={`${len} ${Math.max(0, c - len)}`}
            strokeDashoffset={off}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            data-tip={`${s.label} · ${s.detail}`}
          />
        )
      })}
      <text className="hud-ring-num" x={size / 2} y={size / 2 - 2} textAnchor="middle">
        {total > 0 ? `${Math.round(total / 1000).toLocaleString('zh-CN')}k` : '—'}
      </text>
      <text className="hud-ring-cap" x={size / 2} y={size / 2 + 14} textAnchor="middle">
        {tr('ui.hud.135')}
      </text>
    </svg>
  )
}

/** 组装机书架的一行（只留 HUD 表要用的字段；判据全部走 core 既有取数口） */
interface HudShelfRow {
  id: string
  /** 图纸名 */
  name: string
  /** 产物显示名 */
  product: string
  /** 产物图标用的类别键（交给 `RowGlyph`） */
  glyph: string
  /** 一级分类：装备 / 消耗品（舰船归造船厂页签） */
  kind: 'equip' | 'consumable'
  /** core `sortManuRows` 认的口径键（内容层联合 key，渲染处不显示） */
  kindLabel: string
  /** core `sortManuRows` 认的产物唯一键（同产物的一次性图纸紧随原图纸） */
  productKey: string
  /** core `sortManuRows` 认的书价（市场目录基准价；0 = 沉底） */
  bookPrice: number
  /** 一次性图纸（书架里用一枚 chip 标出来） */
  singleUse: boolean
  materials: readonly MaterialNeed[]
  buildSeconds: number
}

/**
 * **材料齐备度**（0~1）——**与"能不能开工"同一把尺**（`matNeedCount` 折扣后需求 ·
 * 等价组按组内合计，口径同 core `missingMaterials`）。
 *
 * 取**逐项达标率的平均**（不是 Σ 现有 ÷ Σ 需求）：不同料的件数量级差很大，求和会让大件吃掉整个读数。
 * 技能口径（chart 域 Bullet）：「每个区间与目标都要有文字标注，颜色只是补充」⇒ 调用处必须把
 * 百分比与"缺哪几项"用文字给出（`title` 与可见读数同源）。
 */
function readinessOf(engine: GameEngine, materials: readonly MaterialNeed[]): { pct: number; short: string[] } {
  if (materials.length === 0) return { pct: 1, short: [] }
  let sum = 0
  const short: string[] = []
  for (const m of materials) {
    const need = matNeedCount(engine.state, m.count)
    const have = materialGroupIdsOf(m.itemId).reduce((s, id) => s + countWare(engine.state, id), 0)
    sum += Math.min(1, need > 0 ? have / need : 1)
    if (have < need) short.push(engine.ctx.items.get(materialDisplayIdOf(engine.state, m.itemId))?.name ?? m.itemId)
  }
  return { pct: sum / materials.length, short }
}

/** 一批料的**料值**（按当前行情价估；取不到行情退回物品基准价——与卡面行情同一把尺） */
function matsValueOf(engine: GameEngine, materials: readonly MaterialNeed[]): number {
  let v = 0
  for (const m of materials) {
    const price = marketPriceOf(engine.state, engine.ctx, m.itemId) ?? engine.ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0
    v += matNeedCount(engine.state, m.count) * price
  }
  return v
}

/** 页面入参：`onGotoMarket` 与工业页同款（透传 App 的「去市场」；缺省时市场按钮点了不动） */
export function IndustryHudPage({ engine, onToast, onGotoMarket }: PageProps & {
  onGotoMarket?: (goodKey: string) => void
}): ReactNode {
  const state = engine.state
  const ctx = engine.ctx
  const { locale } = useL10n()
  const [tab, setTab] = useState<HudTab>('refine')
  const [recipeId, setRecipeId] = useState<string | null>(null)
  /** 书架筛选（HUD 版只留两维：分类 ＋ 仅可造；完整三维筛选仍在现有工业页） */
  const [shelfKind, setShelfKind] = useState<'equip' | 'consumable' | typeof SUB_ALL>(SUB_ALL)
  const [shelfReadyOnly, setShelfReadyOnly] = useState(false)
  const [tierFilter, setTierFilter] = useState<string>(SUB_ALL)
  /** 精炼炉投料的两级筛选 ＋ 搜索（**2026-09-30 船长报障**：「精炼炉没有筛选，也不显示残骸和货柜」） */
  const [feedTab, setFeedTab] = useState<FeedTab>('all')
  const [feedSub, setFeedSub] = useState<string>(SUB_ALL)
  const [feedKwRaw, setFeedKwRaw] = useState('')
  const feedKw = feedKwRaw.trim().toLowerCase()
  const [coreSel, setCoreSel] = useState<AiCoreType>(() => {
    const usable = (['alpha', 'beta', 'gamma', 'basic'] as AiCoreType[]).find((t) => countAiCore(state, t) > 0)
    return usable ?? 'basic'
  })
  const usableCores = (['basic', 'gamma', 'beta', 'alpha'] as AiCoreType[]).filter((t) => countAiCore(state, t) > 0)
  const core = usableCores.includes(coreSel) ? coreSel : (usableCores[0] ?? null)
  const runs = engine.refineRunViews()
  const labRuns = engine.labRunViews()
  const manuRuns = manufacturingRunViews(state, ctx)
  const recipes = [...ctx.labRecipes.values()]
  const recipe = recipes.find((r) => r.id === recipeId) ?? recipes[0] ?? null
  const rate = refineRate(state, ctx)
  /** 可精炼资源（与工业页同一取数口：`visibleItemDefs` + 有 `refine` 配方） */
  const refineDefs = visibleItemDefs(ctx)
    .filter((d) => (d.refine?.length ?? 0) > 0)
    .map((d) => ({ def: d, have: oreAvailable(state, d.id) }))
    .sort((a, b) => b.have - a.have)
    .slice(0, 8)
  const tabs: Array<{ k: HudTab; g: string; label: string; title: string }> = [
    { k: 'refine', g: 'ico-furnace', label: tr('ui.hud.001'), title: tr('ui.hud.011') },
    { k: 'craft', g: 'ico-assembler', label: tr('ui.hud.002'), title: tr('ui.hud.012') },
    { k: 'shipyard', g: 'ico-drydock', label: tr('ui.hud.003'), title: tr('ui.hud.013') },
    ...(engine.labUnlocked()
      ? [{ k: 'lab' as HudTab, g: 'ico-lab', label: tr('ui.hud.004'), title: tr('ui.hud.014') }]
      : []),
  ]
  const startRefine = (itemId: string, worker: AiCoreType | 'pilot'): void => {
    const r = engine.startRefineRunAt(itemId, worker)
    if (!r.ok) onToast(cmdText(r) || tr('ui.hud.021'), true)
  }
  /**
   * **组装机书架**（模块 ＋ 物品蓝图；舰船归造船厂页签）——
   * 排序沿用 core 单点 `sortManuRows`（类型 → 书价升序 → 同产物的一次性图纸紧随原图纸），
   * 书价走渲染层既有的 `bookPriceOf`（与现有工业页同一把尺）。
   */
  const shelfRows: HudShelfRow[] = useMemo(() => {
    const rows: HudShelfRow[] = []
    for (const bp of ctx.blueprints.values()) {
      const mod = bp.moduleId !== undefined ? ctx.modules.get(bp.moduleId) : undefined
      const item = bp.itemId !== undefined ? ctx.items.get(bp.itemId) : undefined
      if (mod === undefined && item === undefined) continue
      rows.push({
        id: bp.id,
        name: bp.name,
        product: mod?.name ?? item?.name ?? bp.id,
        glyph: mod?.slot ?? item?.kind ?? 'blueprint',
        kind: mod !== undefined ? 'equip' : 'consumable',
        // l10n-keep：内容层联合 key（`sortManuRows` 的一级分类序认它，界面不显示这两个词）
        kindLabel: mod !== undefined ? '装备' : '消耗品',
        productKey: mod !== undefined ? `module:${mod.id}` : `item:${item?.id ?? bp.id}`,
        bookPrice: bookPriceOf(engine, bp.id, 0),
        singleUse: bp.singleUse === true,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
      })
    }
    return sortManuRows(rows)
  }, [ctx, engine])
  /** 一份料的 BuildSpec（core 那几个纯函数认的形状；界面不自算口径） */
  const specOf = (materials: readonly MaterialNeed[], buildSeconds: number): {
    materials: readonly MaterialNeed[]
    buildSeconds: number
    buildCostIsk: number
  } => ({ materials, buildSeconds, buildCostIsk: 0 })
  /** 书架行"现在能不能开工"（与按钮/状态 chip 同一把尺：`canStartBlueprint` ＋ `missingMaterials`） */
  const shelfCanStart = (row: HudShelfRow): boolean =>
    canStartBlueprint(state, ctx, row.id) && missingMaterials(state, ctx, specOf(row.materials, row.buildSeconds)).length === 0
  const shelfShown = shelfRows.filter(
    (r) => (shelfKind === SUB_ALL || r.kind === shelfKind) && (!shelfReadyOnly || shelfCanStart(r)),
  )
  /**
   * **造船厂可造舰船**（`SHIP_TIER_SUBS` 是舰级的单点表；舰级判据与旧页同一张表）。
   */
  const shipRows = useMemo(
    () =>
      [...ctx.shipBlueprints.values()].map((sbp) => {
        const def = ctx.ships.get(sbp.shipId)
        return {
          id: sbp.id,
          name: def?.name ?? sbp.name,
          shipId: sbp.shipId,
          role: def?.role ?? 'industrial',
          tierKey: def !== undefined ? `t${def.tier}` : '',
          materials: sbp.materials,
          buildSeconds: sbp.buildSeconds,
        }
      }),
    [ctx],
  )
  const shipShown = shipRows.filter((r) => tierFilter === SUB_ALL || r.tierKey === tierFilter)
  /** 在船坞里的舰船线（`manufacturingRunViews` 里产物是舰船的那几条） */
  const dockRuns = manuRuns.filter((v) => v.kind === 'ship')
  const startManu = (blueprintId: string): void => {
    const worker: AiCoreType | 'pilot' = core ?? 'pilot'
    const r = engine.startManufacturingAt(blueprintId, worker)
    if (!r.ok) onToast(cmdText(r) || tr('ui.hud.021'), true)
  }
  const stopManu = (runId: number): void => {
    const r = engine.cancelManufacturingAt(runId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.hud.021'), true)
  }
  const durText = (ms: number): string => formatDurationShort(ms, locale === 'en' ? 'en' : 'zh')

  /**
   * **实验室配方效率的真实区间**（**2026-09-30 真值修正**，item D）：`件/分钟 = outputUnits ÷ 工期(分)`，
   * 按**产物分组**取 [最低, 最高] ⇒ 效率条有真实量程与真实目标（该产物的最优配方），
   * 不再用页面自造的 `outputUnits/12` 与钉死的 92% 刻度。
   */
  const labEff = (() => {
    const perMinute = (r: { outputUnits: number; cycleMs: number }): number =>
      r.outputUnits / Math.max(0.001, r.cycleMs / 60_000)
    const groups = new Map<string, number[]>()
    for (const r of recipes) {
      const arr = groups.get(r.outputItemId) ?? []
      arr.push(perMinute(r))
      groups.set(r.outputItemId, arr)
    }
    return { perMinute, groups }
  })()

  /* ═══════════════ 精炼炉：真值读数（2026-09-30 船长令「按真实数值修正」）═══════════════
   * 原先这一格有三处**页面自造**的刻度（满产基准 ×120% · 区间条 ×72/刻度 86% · 顶栏 /6），
   * 现在一律换成引擎真值：工位上限 = `aiCoreCap + industryAiBonus`（技能驱动）·
   * 倍率区间 = `[baseRate, refineRateMax]`（从 balance 现算）。 */
  const stationCap = aiCoreCap(state, ctx) + industryAiBonus(state, ctx)
  const rateBase = ctx.balance.refining.baseRate
  const rateMax = refineRateMax(ctx)
  /** 当前倍率在 [基础, 满级] 区间里的位置（0~1；用于区间条与环） */
  const ratePos = rateMax > rateBase ? Math.min(1, Math.max(0, (rate - rateBase) / (rateMax - rateBase))) : 1

  /**
   * **产出构成（按产值/h）** —— **2026-09-30 船长令**：圆环按"当前所有精炼炉产出的各资源占比"分段染色，
   * 悬停显示该资源产量。
   *
   * 分组口径 = **按在炼的资源**（同一资源的多台炉合并）；度量 = **产值/h**
   * （`每批件数 × 每小时循环数 × 该资源的当前行情价`，与卡面行情同一把尺 —— 船长 2026-09-30 选定）。
   * 技能 chart 域「Part-to-Whole」的硬口径：**≤5 类**（超出合并成「其他」）、每段要有文字/数值、
   * 不能只靠颜色 ⇒ 这里取前 5 名，其余归「其他」，并在右列出**同名同值的构成表**。
   */
  const production = (() => {
    const byItem = new Map<string, { itemId: string; furnaces: number; orePerHour: number; iskPerHour: number; minerals: Map<string, number> }>()
    for (const v of runs) {
      if (v.recipe !== 'refine' || v.itemId === null) continue
      const perHour = (v.batchUnits * 3_600_000) / Math.max(1, v.cycleMs)
      const price = marketPriceOf(state, ctx, v.itemId) ?? ctx.items.get(v.itemId)?.baseSellPriceIsk ?? 0
      const cur = byItem.get(v.itemId) ?? { itemId: v.itemId, furnaces: 0, orePerHour: 0, iskPerHour: 0, minerals: new Map<string, number>() }
      cur.furnaces += 1
      cur.orePerHour += perHour
      cur.iskPerHour += perHour * price
      const def = ctx.items.get(v.itemId)
      if (def !== undefined) {
        for (const row of refineBatchOutputOf(state, ctx, def, v.batchUnits)) {
          const perH = (row.units * 3_600_000) / Math.max(1, v.cycleMs)
          cur.minerals.set(row.mineralId, (cur.minerals.get(row.mineralId) ?? 0) + perH)
        }
      }
      byItem.set(v.itemId, cur)
    }
    const all = [...byItem.values()].sort((a, b) => b.iskPerHour - a.iskPerHour)
    const total = all.reduce((s, r) => s + r.iskPerHour, 0)
    const top = all.slice(0, 5)
    const rest = all.slice(5)
    const restIsk = rest.reduce((s, r) => s + r.iskPerHour, 0)
    return { rows: all, total, top, rest, restIsk, restCount: rest.length }
  })()
  /** 环的一个分段（颜色取调色板轮转；段与构成表一一对应，颜色不是唯一载体） */
  const ringSegments = [
    ...production.top.map((r) => ({
      key: r.itemId,
      label: ctx.items.get(r.itemId)?.name ?? r.itemId,
      isk: r.iskPerHour,
      detail: tr('ui.hud.123', {
        p1: r.furnaces,
        p2: Math.round(r.orePerHour).toLocaleString('zh-CN'),
        p3: Math.round(r.iskPerHour).toLocaleString('zh-CN'),
      }),
    })),
    ...(production.restCount > 0
      ? [
          {
            key: '__rest__',
            label: tr('ui.hud.137'),
            isk: production.restIsk,
            detail: tr('ui.hud.124', { p1: production.restCount }),
          },
        ]
      : []),
  ]
  /** 精炼炉投料：三族（可精炼资源 / 残骸回收 / 货柜拆解）＋ 两级筛选 ＋ 搜索 —— 与现有工业页同一套口径 */  const feedDefs = visibleItemDefs(ctx)
    .filter((d) => (d.refine?.length ?? 0) > 0 || d.kind === 'wreck' || d.kind === 'container')
    .map((def) => ({ def, have: oreAvailable(state, def.id) }))
  const feedFamilyOf = (kind: string): FeedTab => (kind === 'wreck' ? 'wreck' : kind === 'container' ? 'box' : 'ore')
  const feedShown = feedDefs
    .filter(({ def }) => feedTab === 'all' || feedFamilyOf(def.kind) === feedTab)
    .filter(({ def }) => {
      if (feedSub === SUB_ALL) return true
      if (feedTab === 'wreck') return wreckTierOf(def.id) === feedSub
      return def.kind === feedSub
    })
    .filter(({ def }) => {
      if (feedKw.length === 0) return true
      const hay = `${def.name} ${def.description ?? ''}`.toLowerCase()
      return hay.includes(feedKw)
    })
    .sort((a, b) => b.have - a.have || a.def.name.localeCompare(b.def.name, 'zh-Hans-CN'))
  /** 投料行的起炉入口（三类产线各走各的 core 命令；与旧页同一判据） */
  const startFeed = (def: (typeof feedDefs)[number]['def'], worker: AiCoreType | 'pilot'): void => {
    const r =
      def.kind === 'container'
        ? engine.startUnboxRunAt(def.id, worker)
        : def.kind === 'wreck'
          ? engine.startRecycleRunAt(def.id, worker)
          : engine.startRefineRunAt(def.id, worker)
    if (!r.ok) onToast(cmdText(r) || tr('ui.hud.021'), true)
  }
  /** 工位行的「输入 → 输出」悬停卡（**2026-09-30 船长令**：左输入 / 右输出两列） */
  const stationTip = (v: (typeof runs)[number]): ReactNode => {
    const def = v.itemId !== null ? ctx.items.get(v.itemId) : undefined
    const outs = def !== undefined ? refineBatchOutputOf(state, ctx, def, v.batchUnits) : []
    const have = v.itemId !== null ? oreAvailable(state, v.itemId) : 0
    return (
      <>
        <span className="app-ship-hover-title">
          {v.itemName} · {v.worker === 'pilot' ? tr('ui.hud.082') : aiCoreText(v.worker)}
        </span>
        <div className="hud-io">
          <div className="hud-io-col">
            <div className="hud-tiny">{tr('ui.hud.116')}</div>
            <div className="hud-io-row">
              {def !== undefined ? <RowGlyph glyph={def.kind} /> : null}
              <span>{def?.name ?? v.itemName}</span>
            </div>
            <div className="hud-io-num">
              {tr('ui.hud.117', { p1: v.batchUnits.toLocaleString('zh-CN') })}
            </div>
            <div className="hud-io-num">{tr('ui.hud.118', { p1: Math.floor(have).toLocaleString('zh-CN') })}</div>
            <div className="hud-io-num">{tr('ui.hud.119', { p1: Math.round(v.cycleMs / 100) / 10 })}</div>
          </div>
          <div className="hud-io-col">
            <div className="hud-tiny">{tr('ui.hud.120')}</div>
            {outs.length === 0 ? (
              <div className="hud-io-num">{tr('ui.hud.122')}</div>
            ) : (
              outs.map((o) => (
                <div className="hud-io-row" key={o.mineralId}>
                  <RowGlyph glyph="mineral" />
                  <span>{ctx.items.get(o.mineralId)?.name ?? o.mineralId}</span>
                  <b className="hud-io-num">×{o.units.toLocaleString('zh-CN')}</b>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="app-info-note">{tr('ui.hud.125', { p1: Math.round(v.percent) })}</div>
      </>
    )
  }
  return (
    <div className="hud">
      <div className="hud-top">
        <div>
          <div className="hud-title">
            <span className="hud-led" />
            <span className="cn">{tr('ui.hud.101')}</span>
          </div>
          <div className="en hud-tiny">INDUSTRY CONSOLE · DEBUG</div>
        </div>
        <div className="hud-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.k}
              id={`hud-tab-${t.k}`}
              role="tab"
              aria-selected={tab === t.k}
              /* 页签与面板的关联（技能预交付清单：交互件要有 role/名称/状态/键盘/可见焦点四件套） */
              aria-controls={`hud-panel-${t.k}`}
              className={`hud-tab${tab === t.k ? ' is-on' : ''}`}
              title={t.title}
              onClick={() => setTab(t.k)}
            >
              <Glyph name={t.g} size={15} color="currentColor" />
              <span style={{ marginLeft: 7 }}>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="hud-readouts">
          <Readout glyph="ico-eff" value={`${Math.round(rate * 100)}%`} title={tr('ui.hud.031')} />
          {/* ⚠ 2026-09-30 真值修正：上限从**写死的 6** 改成 `aiCoreCap + industryAiBonus`（技能驱动、会变） */}
          <Readout glyph="ico-furnace" value={`${runs.length}/${stationCap}`} title={tr('ui.hud.032')} />
          <Readout glyph="consumable" value={engine.jumpFuelStock().toLocaleString('zh-CN')} title={tr('ui.hud.033')} />
        </div>
      </div>

      <div className="hud-body" id={`hud-panel-${tab}`} role="tabpanel" aria-labelledby={`hud-tab-${tab}`}>
        {/* ═══ 精炼炉（**2026-09-30 船长令**：产出读数块挪到**左侧顶部**、圆环按各资源产值占比分段染色、
             生产项悬停出「左输入 / 右输出」卡；同批修：工位资源图标错 · 投料缺残骸与货柜且没有筛选 ·
             三处自造刻度换真值）═══ */}
        {tab === 'refine' ? (
          <div className="hud-grid two">
            {/* ── 左列：产出读数（上）＋ 工位矩阵（下）── */}
            <div className="hud-grid">
              <div className="hud-panel">
                <h3>
                  <Glyph name="ico-eff" size={13} color="currentColor" /> {tr('ui.hud.051')}
                  <span className="hud-tiny" style={{ marginLeft: 8 }}>
                    {tr('ui.hud.126', { p1: Math.round(production.total).toLocaleString('zh-CN') })}
                  </span>
                </h3>
                <div className="hud-row" style={{ alignItems: 'center', gap: 16 }}>
                  {/* 圆环 = 各资源**产值/h 占比**的多段环（技能 Part-to-Whole：≤5 段＋「其他」、非颜色单一载体） */}
                  <RefineShareRing segments={ringSegments} total={production.total} />
                  <div style={{ minWidth: 148, flex: 1 }}>
                    <div className="hud-kv">
                      <span>{tr('ui.hud.127')}</span>
                      <b>{Math.round(rateBase * 100)}%</b>
                    </div>
                    <div className="hud-kv">
                      <span>{tr('ui.hud.128')}</span>
                      <b>{Math.round(rateMax * 100)}%</b>
                    </div>
                    <div className="hud-kv">
                      <span>{tr('ui.hud.129')}</span>
                      <b>{Math.round(rate * 100)}%</b>
                    </div>
                    <div className="hud-kv">
                      <span>{tr('ui.hud.053')}</span>
                      <b>
                        {runs.length} / {stationCap}
                      </b>
                    </div>
                  </div>
                </div>
                {/* 倍率区间条：**两端有文字**（技能口径）+ 当前值刻度；不再用无目标的 Bullet */}
                <div className="hud-range" title={tr('ui.hud.130', { p1: Math.round(rate * 100) })}>
                  <span className="hud-tiny">{Math.round(rateBase * 100)}%</span>
                  <span className="hud-bar">
                    <i style={{ ['--v' as string]: Math.round(ratePos * 100) }} />
                    <em className="hud-range-tick" style={{ left: `${ratePos * 100}%` }} />
                  </span>
                  <span className="hud-tiny">{Math.round(rateMax * 100)}%</span>
                </div>
              </div>

              <div className="hud-panel">
                <h3>
                  <Glyph name="ico-furnace" size={13} color="currentColor" /> {tr('ui.hud.041')}
                </h3>
                {/* ⚠ `is-station` = 「首列是工位号的窄表」可压缩档（**2026-09-30 船长报障**：
                    这张 7 列表原先按 132px 首列 + 132px 主列 + 130px 进度列排版 ⇒ 最小宽 690px，
                    比左列还宽 ⇒ 整块按 690px 固定排版、不随窗口缩放，右边被右列盖住。
                    档位定义见 `_hud-industry.css` 的 `.hud-table.is-station`） */}
                <table className="hud-table is-station">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{tr('ui.hud.042')}</th>
                      <th>{tr('ui.hud.131')}</th>
                      <th className="n">{tr('ui.hud.043')}</th>
                      <th className="hud-cell-bar">{tr('ui.hud.044')}</th>
                      <th className="n">{tr('ui.hud.045')}</th>
                      <th className="act" />
                    </tr>
                  </thead>
                  <tbody>
                    {runs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="hud-tiny">{tr('ui.hud.046')}</td>
                      </tr>
                    ) : null}
                    {runs.map((v) => {
                      const def = v.itemId !== null ? ctx.items.get(v.itemId) : undefined
                      return (
                        <tr key={v.id} {...hoverTipProps(stationTip(v))}>
                          <td className="hud-tiny">{String(v.id).padStart(2, '0')}</td>
                          {/* ⚠ 图标 2026-09-30 修（船长报障「工位那边资源图标是错误的」）：
                              原先这里挂的是**劳动者**图标（船/核心），现在挂**资源自身**的类别图标 */}
                          <td className="hud-cell-main">
                            <span className="hud-row" style={{ gap: 6 }}>
                              {def !== undefined ? <RowGlyph glyph={def.kind} /> : <RowGlyph glyph="ico-feed" />}
                              <span>{v.itemName}</span>
                            </span>
                          </td>
                          <td>
                            <span className="hud-chip">
                              <Glyph name={v.worker === 'pilot' ? 'nav-ship' : 'ai-core'} size={11} color="currentColor" />
                              {v.worker === 'pilot' ? tr('ui.hud.082') : aiCoreText(v.worker)}
                            </span>
                          </td>
                          <td className="n">{v.batchUnits.toLocaleString('zh-CN')}</td>
                          <td className="hud-cell-bar">
                            <span className="hud-bar scan">
                              <i style={{ ['--v' as string]: Math.round(v.percent) }} />
                            </span>
                          </td>
                          <td className="n">{Math.round(v.cycleMs / 100) / 10}s</td>
                          <td className="act">
                            <IconBtn
                              glyph="ico-stop"
                              title={tr('ui.hud.047')}
                              onClick={() => {
                                const r = engine.stopRefineRunAt(v.id)
                                if (!r.ok) onToast(cmdText(r) || tr('ui.hud.021'), true)
                              }}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="hud-row wrap" style={{ marginTop: 10 }}>
                  <select
                    className="hud-select"
                    value={core ?? ''}
                    onChange={(e) => setCoreSel(e.target.value as AiCoreType)}
                    disabled={usableCores.length === 0}
                    title={tr('ui.hud.048')}
                  >
                    {usableCores.length === 0 ? (
                      <option value="">{tr('ui.hud.049')}</option>
                    ) : (
                      usableCores.map((t) => (
                        <option key={t} value={t}>
                          {aiCoreText(t)} · {Math.round(aiEfficiency(state, ctx, t) * 100)}%
                        </option>
                      ))
                    )}
                  </select>
                  <span className="hud-chip">{tr('ui.hud.050')}</span>
                </div>
              </div>
            </div>

            {/* ── 右列：投料（三族 ＋ 两级筛选 ＋ 搜索）＋ 资源构成表 ── */}
            <div className="hud-grid">
              <div className="hud-panel">
                <h3>
                  <Glyph name="ico-feed" size={13} color="currentColor" /> {tr('ui.hud.056')}
                  <span className="hud-tiny" style={{ marginLeft: 8 }}>{feedShown.length}</span>
                </h3>
                <div className="hud-chips">
                  {FEED_TABS.map((f) => (
                    <button
                      key={f.k}
                      className={`hud-chip${feedTab === f.k ? ' is-acc' : ''}`}
                      aria-pressed={feedTab === f.k}
                      onClick={() => {
                        setFeedTab(f.k)
                        setFeedSub(SUB_ALL)
                      }}
                    >
                      <Glyph name={f.glyph} size={11} color="currentColor" /> {tr(f.id)}
                    </button>
                  ))}
                </div>
                {/* 二级子筛选（按一级档换候选：可精炼资源按资源大类 / 残骸按档位；货柜无子类） */}
                {feedTab === 'ore' ? (
                  <div className="hud-chips">
                    {['ore', 'gas', 'ice'].map((k, i) => (
                      <button
                        key={k}
                        className={`hud-chip${feedSub === k ? ' is-acc' : ''}`}
                        aria-pressed={feedSub === k}
                        onClick={() => setFeedSub(feedSub === k ? SUB_ALL : k)}
                      >
                        {tr(`ui.IndustryPage.00${5 + i}`)}
                      </button>
                    ))}
                  </div>
                ) : null}
                {feedTab === 'wreck' ? (
                  <div className="hud-chips">
                    {WRECK_SUBS.map((s) => (
                      <button
                        key={s.key}
                        className={`hud-chip${feedSub === s.key ? ' is-acc' : ''}`}
                        aria-pressed={feedSub === s.key}
                        onClick={() => setFeedSub(feedSub === s.key ? SUB_ALL : s.key)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <input
                  className="hud-search"
                  value={feedKwRaw}
                  placeholder={tr('ui.hud.132')}
                  aria-label={tr('ui.hud.132')}
                  onChange={(e) => setFeedKwRaw(e.target.value)}
                />
                {feedShown.length === 0 ? (
                  /* 技能口径（Search · No Results）：空结果要给**下一步建议**，不是一句"0 条" */
                  <div className="hud-empty">{tr('ui.hud.133')}</div>
                ) : (
                  <table className="hud-table">
                    <tbody>
                      {feedShown.map(({ def, have }) => (
                        <tr key={def.id} className={have <= 0 ? 'is-dim' : ''}>
                          <td>
                            <span className="hud-row" style={{ gap: 6 }}>
                              <RowGlyph glyph={def.kind} />
                              <span>{def.name}</span>
                              {def.kind === 'wreck' ? (
                                <span className="hud-chip">{tr(`ui.IndustryPage.00${wreckTierOf(def.id) === 'rare' ? 9 : 8}`)}</span>
                              ) : null}
                              {def.kind === 'container' ? (
                                <span className="hud-chip">{Math.round(UNBOX_CYCLE_MS / 1000)}s</span>
                              ) : null}
                            </span>
                          </td>
                          <td className="n hud-tiny">{Math.floor(have).toLocaleString('zh-CN')}</td>
                          <td className="act">
                            <IconBtn
                              glyph="ico-play"
                              title={tr('ui.hud.057', { p1: def.name })}
                              disabled={have <= 0}
                              onClick={() => startFeed(def, 'pilot')}
                            />
                          </td>
                          <td className="act">
                            <IconBtn
                              glyph="ai-core"
                              title={tr('ui.hud.058', { p1: def.name })}
                              disabled={have <= 0 || core === null}
                              onClick={() => core !== null && startFeed(def, core)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="hud-panel">
                <h3>
                  <Glyph name="ico-eff" size={13} color="currentColor" /> {tr('ui.hud.121')}
                </h3>
                {production.rows.length === 0 ? (
                  <div className="hud-empty">{tr('ui.hud.134')}</div>
                ) : (
                  <table className="hud-table">
                    <thead>
                      <tr>
                        <th>{tr('ui.hud.042')}</th>
                        <th className="n">{tr('ui.hud.135')}</th>
                        <th className="n">{tr('ui.hud.136')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ringSegments.map((seg, i) => {
                        const row = production.rows.find((r) => r.itemId === seg.key)
                        const share = production.total > 0 ? (seg.isk / production.total) * 100 : 0
                        return (
                          <tr key={seg.key}>
                            <td>
                              <span className="hud-row" style={{ gap: 6 }}>
                                <i className="hud-seg-dot" data-seg={i} />
                                <span>{seg.label}</span>
                              </span>
                            </td>
                            <td className="n">{Math.round(seg.isk).toLocaleString('zh-CN')}</td>
                            <td className="n">{share.toFixed(1)}%</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* ═══ 组装机：制造队列（左）＋ 蓝图书架（右）═══
            2026-09-30 三号接手：原先这里内嵌旧面板（`ManufacturingPanel`）⇒ 同一页两种视觉语言；
            现换成 HUD 版。**判据全部走 core 既有取数口**（`manufacturingRunViews` / `canStartBlueprint` /
            `missingMaterials` / `sortManuRows`），没有新口径。 */}
        {tab === 'craft' ? (
          <div className="hud-grid two">
            <div className="hud-panel">
              <h3>
                <Glyph name="ico-assembler" size={13} color="currentColor" /> {tr('ui.hud.087')}
                <span className="hud-tiny" style={{ marginLeft: 8 }}>
                  <Readout glyph="ico-eff" value={String(manuRuns.length)} title={tr('ui.hud.114')} />
                </span>
              </h3>
              {manuRuns.length === 0 ? (
                <div className="hud-empty">{tr('ui.hud.095')}</div>
              ) : (
                manuRuns.map((v) => {
                  const bp = v.blueprintId !== null
                    ? (ctx.blueprints.get(v.blueprintId) ?? ctx.shipBlueprints.get(v.blueprintId))
                    : undefined
                  const mats = bp?.materials ?? []
                  const ready = readinessOf(engine, mats)
                  const readyPct = Math.round(ready.pct * 100)
                  return (
                    <div className="hud-card" key={v.id}>
                      <div className="hud-row between">
                        <span className="hud-row" style={{ gap: 7 }}>
                          <RowGlyph glyph={v.kind ?? 'item'} />
                          <span className="nm">{v.productName}</span>
                        </span>
                        <span className="hud-chip is-acc">{v.workerLabel}</span>
                      </div>
                      <div className="hud-row between" style={{ marginTop: 5 }}>
                        <span className="hud-tiny">{bp?.name ?? ''}</span>
                        <span className="hud-tiny">{durText(v.remainingMs)}</span>
                      </div>
                      <span className="hud-bar">
                        <i style={{ ['--v' as string]: Math.round(v.percent) }} />
                      </span>
                      {mats.length > 0 ? (
                        <div className="hud-mat">
                          <span className="hud-tiny">{tr('ui.hud.104')}</span>
                          <span
                            className="hud-bullet"
                            title={tr('ui.hud.111', { p1: readyPct, p2: ready.short.join(tr('ui.MatterTechTab.017')) })}
                          >
                            <span className="rng" style={{ left: 0, width: '100%' }} />
                            <span className="val" style={{ width: `${readyPct}%` }} />
                          </span>
                          <span className="hud-tiny">{readyPct}%</span>
                        </div>
                      ) : null}
                      <div className="hud-row" style={{ marginTop: 6 }}>
                        <IconBtn
                          glyph="ico-stop"
                          label={tr('ui.hud.084')}
                          title={tr('ui.hud.115', { p1: v.productName })}
                          onClick={() => stopManu(v.id)}
                        />
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <div className="hud-panel">
              <h3>
                <Glyph name="blueprint" size={13} color="currentColor" /> {tr('ui.hud.088')}
                <span className="hud-tiny" style={{ marginLeft: 8 }}>{shelfShown.length}</span>
              </h3>
              <div className="hud-chips">
                <button
                  className={`hud-chip${shelfKind === SUB_ALL ? ' is-acc' : ''}`}
                  aria-pressed={shelfKind === SUB_ALL}
                  onClick={() => setShelfKind(SUB_ALL)}
                >
                  {tr('ui.hud.106')}
                </button>
                <button
                  className={`hud-chip${shelfKind === 'equip' ? ' is-acc' : ''}`}
                  aria-pressed={shelfKind === 'equip'}
                  onClick={() => setShelfKind('equip')}
                >
                  {tr('ui.hud.102')}
                </button>
                <button
                  className={`hud-chip${shelfKind === 'consumable' ? ' is-acc' : ''}`}
                  aria-pressed={shelfKind === 'consumable'}
                  onClick={() => setShelfKind('consumable')}
                >
                  {tr('ui.hud.103')}
                </button>
                <button
                  className={`hud-chip${shelfReadyOnly ? ' is-ok' : ''}`}
                  aria-pressed={shelfReadyOnly}
                  title={tr('ui.hud.107')}
                  onClick={() => setShelfReadyOnly((v) => !v)}
                >
                  <Glyph name="ico-play" size={11} color="currentColor" /> {tr('ui.hud.092')}
                </button>
              </div>
              {shelfShown.length === 0 ? (
                <div className="hud-empty">{tr('ui.hud.096')}</div>
              ) : (
                <table className="hud-table">
                  <thead>
                    <tr>
                      <th>{tr('ui.hud.089')}</th>
                      <th className="n">{tr('ui.hud.090')}</th>
                      <th>{tr('ui.hud.091')}</th>
                      <th className="act" />
                    </tr>
                  </thead>
                  <tbody>
                    {shelfShown.map((r) => {
                      const can = shelfCanStart(r)
                      const learned = ownsBlueprint(state, r.id) || ctx.blueprints.get(r.id)?.learnless === true
                      return (
                        <tr key={r.id}>
                          <td>
                            <span className="hud-row" style={{ gap: 6 }}>
                              <RowGlyph glyph={r.glyph} />
                              <span>{r.product}</span>
                              {r.singleUse ? <span className="hud-chip is-warn">{tr('ui.hud.110')}</span> : null}
                            </span>
                          </td>
                          <td className="n">{durText(calcBuildDurationMs(state, ctx, specOf(r.materials, r.buildSeconds)))}</td>
                          <td>
                            <span className={`hud-chip${can ? ' is-ok' : learned ? ' is-warn' : ' is-bad'}`}>
                              {can ? tr('ui.hud.092') : learned ? tr('ui.hud.093') : tr('ui.hud.094')}
                            </span>
                          </td>
                          <td className="act">
                            <IconBtn
                              glyph="ico-play"
                              title={tr('ui.hud.112', { p1: core !== null ? aiCoreText(core) : tr('ui.hud.082') })}
                              disabled={!learned}
                              onClick={() => startManu(r.id)}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : null}

        {/* ═══ 造船厂：干船坞（左）＋ 可造舰船（右）═══ */}
        {tab === 'shipyard' ? (
          <div className="hud-grid two">
            <div className="hud-panel">
              <h3>
                <Glyph name="ico-drydock" size={13} color="currentColor" /> {tr('ui.hud.097')}
              </h3>
              {dockRuns.length === 0 ? (
                <div className="hud-empty">{tr('ui.hud.099')}</div>
              ) : (
                dockRuns.map((v) => {
                  const sbp = v.blueprintId !== null ? ctx.shipBlueprints.get(v.blueprintId) : undefined
                  const def = sbp !== undefined ? ctx.ships.get(sbp.shipId) : undefined
                  const mats = sbp?.materials ?? []
                  const ready = readinessOf(engine, mats)
                  return (
                    <div className="hud-dock" key={v.id}>
                      <div className="hud-dock-art" aria-hidden="true">
                        {def !== undefined ? <ShipSprite shipId={def.id} role={def.role} size={132} /> : null}
                      </div>
                      <div className="hud-dock-info">
                        <div className="hud-row between">
                          <span className="nm">{def?.name ?? v.productName}</span>
                          <span className="hud-chip is-acc">{v.workerLabel}</span>
                        </div>
                        <span className="hud-bar lg">
                          <i style={{ ['--v' as string]: Math.round(v.percent) }} />
                        </span>
                        <div className="hud-cells">
                          <span title={tr('ui.hud.069')}>
                            <Glyph name="ico-feed" size={12} color="currentColor" /> {mats.length}
                          </span>
                          <span title={tr('ui.hud.105')}>
                            <Glyph name="ico-eff" size={12} color="currentColor" />{' '}
                            {(matsValueOf(engine, mats) / 1_000_000).toFixed(1)}M
                          </span>
                          <span title={tr('ui.hud.090')}>
                            <Glyph name="ico-stop" size={12} color="currentColor" /> {durText(v.remainingMs)}
                          </span>
                          <span title={tr('ui.hud.104')} className="hud-tiny">
                            {tr('ui.hud.104')} {Math.round(ready.pct * 100)}%
                          </span>
                        </div>
                        <div className="hud-row" style={{ marginTop: 8 }}>
                          <IconBtn
                            glyph="ico-stop"
                            label={tr('ui.hud.113')}
                            title={tr('ui.hud.113')}
                            onClick={() => stopManu(v.id)}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <div className="hud-panel">
              <h3>
                <Glyph name="ico-drydock" size={13} color="currentColor" /> {tr('ui.hud.098')}
                <span className="hud-tiny" style={{ marginLeft: 8 }}>{shipShown.length}</span>
              </h3>
              <div className="hud-chips">
                <button
                  className={`hud-chip${tierFilter === SUB_ALL ? ' is-acc' : ''}`}
                  aria-pressed={tierFilter === SUB_ALL}
                  onClick={() => setTierFilter(SUB_ALL)}
                >
                  {tr('ui.hud.106')}
                </button>
                {SHIP_TIER_SUBS.filter((s) => s.key !== SUB_ALL && shipRows.some((r) => r.tierKey === s.key)).map((s) => (
                  <button
                    key={s.key}
                    className={`hud-chip${tierFilter === s.key ? ' is-acc' : ''}`}
                    aria-pressed={tierFilter === s.key}
                    onClick={() => setTierFilter(s.key)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <table className="hud-table">
                <thead>
                  <tr>
                    <th>{tr('ui.hud.089')}</th>
                    <th className="n">{tr('ui.hud.105')} · {tr('ui.hud.090')}</th>
                    <th>{tr('ui.hud.091')}</th>
                    <th className="act" />
                  </tr>
                </thead>
                <tbody>
                  {shipShown.map((r) => {
                    const can =
                      canStartBlueprint(state, ctx, r.id) &&
                      missingMaterials(state, ctx, specOf(r.materials, r.buildSeconds)).length === 0
                    const learned = ownsBlueprint(state, r.id)
                    return (
                      <tr key={r.id}>
                        <td>
                          <span className="hud-row" style={{ gap: 6 }}>
                            <RowGlyph glyph={r.role} />
                            <span>{r.name}</span>
                          </span>
                        </td>
                        {/* 料值与工期合到一列（两行小字）：五列会把产物名挤成一字一行（1340×900 实测） */}
                        <td className="n">
                          <span className="hud-cell2">{(matsValueOf(engine, r.materials) / 1_000_000).toFixed(1)}M</span>
                          <span className="hud-cell2 hud-tiny">{durText(calcBuildDurationMs(state, ctx, specOf(r.materials, r.buildSeconds)))}</span>
                        </td>
                        <td>
                          <span className={`hud-chip${can ? ' is-ok' : learned ? ' is-warn' : ' is-bad'}`}>
                            {can ? tr('ui.hud.092') : learned ? tr('ui.hud.093') : tr('ui.hud.094')}
                          </span>
                        </td>
                        <td className="act">
                          <IconBtn
                            glyph="ico-play"
                            title={tr('ui.hud.112', { p1: core !== null ? aiCoreText(core) : tr('ui.hud.082') })}
                            disabled={!learned}
                            onClick={() => startManu(r.id)}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* ═══ 实验室：配方目录（不预设分类；新东西加一行即出现）＋ 投料 ＋ 运行 ═══ */}
        {tab === 'lab' && engine.labUnlocked() ? (
          <div className="hud-grid two">
            <div className="hud-panel">
              <h3>
                <Glyph name="ico-lab" size={13} color="currentColor" /> {tr('ui.hud.061')}
              </h3>
              {recipes.map((r) => {
                const out = ctx.items.get(r.outputItemId)
                const affordable = labAffordableBatches(state, r)
                const on = recipe?.id === r.id
                const eff = labEff.perMinute(r)
                const effGroup = labEff.groups.get(r.outputItemId) ?? [eff]
                const effLo = Math.min(...effGroup)
                const effHi = Math.max(...effGroup)
                const effBest = effHi
                const effPos = effHi > effLo ? (eff - effLo) / (effHi - effLo) : 1
                return (
                  /* ⚠ **可点件必须是真按钮**（`ui-ux-pro-max` 预交付清单 · Compact Control Semantics · Critical：
                     「interactive chips need a native role accessible name state keyboard operation and visible
                     focus；Don't: Use a clickable div」）——2026-09-30 三号接手时由 `<div onClick>` 改过来。 */
                  <button
                    key={r.id}
                    type="button"
                    className={`hud-card${on ? ' is-sel' : ''}`}
                    aria-pressed={on}
                    onClick={() => setRecipeId(r.id)}
                    title={tr('ui.hud.062')}
                  >
                    <div className="hud-row between">
                      <span className="hud-row" style={{ gap: 7 }}>
                        {out !== undefined ? <RowGlyph glyph={out.kind} /> : null}
                        <span className="nm">{r.name}</span>
                      </span>
                      <span className={`hud-chip${affordable > 0 ? ' is-ok' : ' is-warn'}`}>
                        <Glyph name="ico-play" size={11} color="currentColor" /> {affordable}
                      </span>
                    </div>
                    <div className="hud-row between" style={{ marginTop: 5 }}>
                      <span className="hud-row" style={{ gap: 10 }}>
                        <Readout
                          glyph="ico-eff"
                          value={`${r.outputUnits}`}
                          title={tr('ui.hud.063', { p1: r.outputUnits })}
                        />
                        <Readout
                          glyph="ico-clock"
                          value={`${Math.round(r.cycleMs / 60_000)}m`}
                          title={tr('ui.hud.064', { p1: Math.round(r.cycleMs / 60_000) })}
                        />
                        <Readout
                          glyph="mineral"
                          value={String(r.materials.length)}
                          title={tr('ui.hud.065', { p1: r.materials.length })}
                        />
                      </span>
                      <span className="hud-tiny">
                        {out !== undefined
                          ? `${marketPriceOf(state, ctx, out.id)?.toLocaleString('zh-CN') ?? '—'}`
                          : ''}
                      </span>
                    </div>
                    {/* 效率 bullet（**2026-09-30 真值修正**）：区间 = **同产物各配方的实际区间**（件/分钟），
                        目标刻度 = 该产物的最优配方；两端与当前值都给文字（技能：区间与目标都要有标注）。
                        原先那两个数（`outputUnits/12`、刻度钉 92%）是页面自造的。 */}
                    <span className="hud-bullet" title={tr('ui.hud.139', { p1: eff.toFixed(1), p2: effBest.toFixed(1) })}>
                      <span className="rng" style={{ left: 0, width: '100%' }} />
                      <span className="val" style={{ ['--v' as string]: Math.round(effPos * 100) }} />
                      {/* 目标刻度 = 该产物的**最优配方**（区间上端）⇒ 钉在 99.5%（留 2px 免得贴边被裁） */}
                      <span className="tgt" style={{ left: '99.5%' }} />                    </span>
                    <span className="hud-row between" style={{ marginTop: 2 }}>
                      <span className="hud-tiny">{effLo.toFixed(1)}/min</span>
                      <span className="hud-tiny">{tr('ui.hud.140', { p1: eff.toFixed(1) })}</span>
                      <span className="hud-tiny">{effHi.toFixed(1)}/min</span>
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="hud-grid">
              <div className="hud-panel">
                <h3>
                  <Glyph name="ico-feed" size={13} color="currentColor" /> {tr('ui.hud.067')}
                </h3>
                {recipe === null ? (
                  <div className="hud-tiny">{tr('ui.hud.068')}</div>
                ) : (
                  <>
                    <table className="hud-table">
                      <thead>
                        <tr>
                          <th>{tr('ui.hud.069')}</th>
                          <th className="n">{tr('ui.hud.070')}</th>
                          <th className="n">{tr('ui.hud.071')}</th>
                          <th>{tr('ui.hud.072')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recipe.materials.map((m) => {
                          const def = ctx.items.get(m.itemId)
                          const have = labMaterialAvailable(state, m.itemId)
                          const pct = Math.min(100, Math.round((have / Math.max(1, m.units)) * 100))
                          return (
                            <tr key={m.itemId}>
                              <td>
                                <span className="hud-row" style={{ gap: 6 }}>
                                  {def !== undefined ? <RowGlyph glyph={def.kind} /> : null}
                                  {def?.name ?? m.itemId}
                                </span>
                              </td>
                              <td className="n">{m.units}</td>
                              <td className="n">{Math.floor(have).toLocaleString('zh-CN')}</td>
                              <td style={{ minWidth: 80 }}>
                                <span className={`hud-bar${pct >= 100 ? ' is-ok' : pct >= 60 ? ' is-warn' : ' is-bad'}`}>
                                  <i style={{ ['--v' as string]: Math.round(pct) }} />
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <div className="hud-row wrap" style={{ marginTop: 10 }}>
                      <IconBtn
                        glyph="ico-play"
                        label={tr('ui.hud.073')}
                        title={tr('ui.hud.074')}
                        primary
                        disabled={labAffordableBatches(state, recipe) <= 0}
                        onClick={() => {
                          const r = engine.startLabRunAt(recipe.id, 'pilot')
                          if (!r.ok) onToast(cmdText(r) || tr('ui.hud.075'), true)
                        }}
                      />
                      <IconBtn
                        glyph="ai-core"
                        label={tr('ui.hud.076')}
                        title={tr('ui.hud.077')}
                        disabled={labAffordableBatches(state, recipe) <= 0 || core === null}
                        onClick={() => {
                          if (recipe === null || core === null) return
                          const r = engine.startLabRunAt(recipe.id, core)
                          if (!r.ok) onToast(cmdText(r) || tr('ui.hud.075'), true)
                        }}
                      />
                      <IconBtn
                        glyph="nav-market"
                        title={tr('ui.hud.078')}
                        onClick={() => {
                          if (recipe !== null) onGotoMarket?.(recipe.outputItemId)
                        }}
                      />
                    </div>
                    <div className="hud-kv" style={{ marginTop: 8 }}>
                      <span>{tr('ui.hud.079')}</span>
                      <b>
                        <Glyph name="consumable" size={12} color="currentColor" />{' '}
                        {engine.jumpFuelStock().toLocaleString('zh-CN')}
                      </b>
                    </div>
                  </>
                )}
              </div>

              <div className="hud-panel">
                <h3>
                  <Glyph name="ico-loop" size={13} color="currentColor" /> {tr('ui.hud.080')}
                </h3>
                {labRuns.length === 0 ? <div className="hud-tiny">{tr('ui.hud.081')}</div> : null}
                {labRuns.map((v) => (
                  <div key={v.id} className="hud-row" style={{ gap: 10, marginBottom: 8 }}>
                    <span style={{ flex: 1 }}>
                      <span className="hud-tiny">
                        {v.worker === 'pilot' ? tr('ui.hud.082') : aiCoreText(v.worker)} ·{' '}
                        {tr('ui.hud.083', { p1: v.batchesDone })}
                      </span>
                      <span className="hud-bar scan" style={{ marginTop: 5 }}>
                        <i style={{ ['--v' as string]: Math.round(v.percent) }} />
                      </span>
                    </span>
                    <span className="hud-tiny">{Math.max(1, Math.round(v.remainingMs / 1000))}s</span>
                    <IconBtn
                      glyph="ico-stop"
                      title={tr('ui.hud.084')}
                      onClick={() => {
                        const r = engine.stopLabRunAt(v.id)
                        if (!r.ok) onToast(cmdText(r) || tr('ui.hud.085'), true)
                      }}
                    />
                  </div>
                ))}
                <div className="hud-ticker">
                  <Glyph name="ico-antenna" size={12} color="currentColor" />{' '}
                  {tr('ui.hud.086')}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
