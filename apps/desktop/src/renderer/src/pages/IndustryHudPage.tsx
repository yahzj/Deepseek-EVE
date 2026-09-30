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
  recycleBatchM3Of,
  recycleMineralPoolOf,
  recycleProfileOf,
  refineBaseParamsOf,
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
import { Glyph, itemGlyphName } from '../ui/Glyphs'
import { AiWorkFx, industryWorkKindOf } from '../ui/aiWorkFx'
import { RowGlyph } from '../ui/itemView'
import { HudHoverCard, IconBtn, Readout, type HudIoLine } from '../ui/hud'
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
  const rows = matRowsOf(engine, materials)
  if (rows.length === 0) return { pct: 1, short: [] }
  let sum = 0
  const short: string[] = []
  for (const r of rows) {
    sum += Math.min(1, r.need > 0 ? r.have / r.need : 1)
    if (!r.ok) short.push(r.name)
  }
  return { pct: sum / rows.length, short }
}

/**
 * **材料清单行**（组装机 / 造船厂 / 实验室的输入都是"多料"）——取数口径与 `readinessOf` 同一份，
 * 悬浮卡的**左列**直接用它的输出（**2026-09-30 船长令**：「因为还需要应用到组装机和造船厂，
 * 所以请对左侧输入进行一定优化」⇒ 左列做成清单形态，而不是写死"一味料"）。
 */
function matRowsOf(
  engine: GameEngine,
  materials: readonly MaterialNeed[],
): Array<{ id: string; name: string; glyph: string; need: number; have: number; ok: boolean }> {
  return materials.map((m) => {
    const need = matNeedCount(engine.state, m.count)
    const have = materialGroupIdsOf(m.itemId).reduce((s, id) => s + countWare(engine.state, id), 0)
    const def = engine.ctx.items.get(materialDisplayIdOf(engine.state, m.itemId))
    return {
      id: m.itemId,
      name: def?.name ?? m.itemId,
      glyph: itemGlyphName(def?.id, def?.kind ?? 'item'),
      need,
      have,
      ok: have >= need,
    }
  })
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

/**
 * **「优先使用的 AI」选择器**（**2026-09-30 船长令**：「将选择AI的下拉框移动到…队列的顶部…
 * 并添加一个'优先使用的AI：'在其左侧并显示对应AI核心的剩余数量」＋「将工业几个页面都添加AI选择」
 * ＋「实验室放到配方顶部」）。
 *
 * 四个页签（精炼炉 / 组装机 / 造船厂 / 实验室）**共用这一个实现与同一枚页面级状态** `coreSel`：
 * 落点＝各页签"队列/配方"窗口的**顶部**（精炼炉=工位、组装机=制造队列、造船厂=在建舰船、实验室=配方详情）。
 *
 * 为什么这么排（`ui-ux-pro-max` 判定，2026-09-30）：
 * - Forms · **Input Labels**（High）「Every input needs a visible label」⇒ 左侧那句可见标签就是它
 *   （改前只有 `title`，触屏与键盘玩家都读不到"这个下拉框是干嘛的"）；
 * - Accessibility · **Contextual Live Badge Updates**（High）「announce a meaningful contextual status
 *   such as 3 items in cart」/「Don't: Announce a bare number or make every badge a competing live
 *   region」⇒ 剩余数写成「剩余 N 枚」整句、并挂 `aria-describedby`（focus 时读一次），**不做 live region**
 *   （起炉/停炉都会改这个数，做成播报区会很吵）。
 *
 * 护栏：`id` 带页签后缀（同页只渲染一个页签，但避免重复 id）；`select` 只带一个 `title`
 * （§九之七 一个元素一个悬停机制）；计数是**文字**、不靠颜色（颜色不能是唯一载体）。
 */
function AiCorePick({
  engine,
  suffix,
  core,
  usableCores,
  onPick,
  pilotNote = false,
}: {
  engine: GameEngine
  /** 页签后缀（`refine` / `craft` / `shipyard` / `lab`）：拼进 `id`，避免同页重复 */
  suffix: string
  /** 当前生效的核心（`null` = 一枚可用核心都没有） */
  core: AiCoreType | null
  usableCores: readonly AiCoreType[]
  onPick: (t: AiCoreType) => void
  /** 是否附上「主控手上一台」那枚说明 chip（原先就挂在精炼炉那一处，照旧保留） */
  pilotNote?: boolean
}): ReactNode {
  const state = engine.state
  const ctx = engine.ctx
  return (
    <div className="hud-row wrap hud-aipick">
      <label className="hud-label" htmlFor={`hud-ai-core-${suffix}`}>
        {tr('ui.hud.148')}
      </label>
      <select
        id={`hud-ai-core-${suffix}`}
        className="hud-select"
        value={core ?? ''}
        onChange={(e) => onPick(e.target.value as AiCoreType)}
        disabled={usableCores.length === 0}
        title={tr('ui.hud.048')}
        aria-describedby={`hud-ai-stock-${suffix}`}
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
      {/* 剩余数量：core 既有取数口 `countAiCore`（＝核心库剩余；起炉会消耗一枚） */}
      <span className="hud-chip" id={`hud-ai-stock-${suffix}`}>
        {core !== null ? tr('ui.hud.149', { p1: countAiCore(state, core) }) : tr('ui.hud.049')}
      </span>
      {pilotNote ? <span className="hud-chip">{tr('ui.hud.050')}</span> : null}
    </div>
  )
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
  /**
   * **工位窗口折叠**（**2026-09-30 船长令**：「当屏幕过窄时，在工位窗口加个最小化的按钮，
   * 允许玩家将工位界面最小化成一个标题栏」）——按当日设计总结的三条裁定：**按钮常显 ·
   * 状态不落盘 · 只做工位面板**（投料不做）。窄屏（≤1500 单列档）下工位表把投料顶得很远，
   * 折叠一下就能跳过去；宽屏也能折（折叠是玩家自己的选择，不随窗口忽隐忽现）。
   */
  const [foldStation, setFoldStation] = useState(false)
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
  /**
   * **工位行的「输入 → 输出」悬停卡**（**2026-09-30 船长令**：左输入 / 右输出两列；同日第三批：
   * 标题带**工位号**——编号列已按船长令下屏，编号改在这里与「停炉」提示里出现，仍可核对是哪一台）。
   */
  const stationTip = (v: (typeof runs)[number]): ReactNode => {
    const def = v.itemId !== null ? ctx.items.get(v.itemId) : undefined
    const outs = def !== undefined ? refineBatchOutputOf(state, ctx, def, v.batchUnits) : []
    const have = v.itemId !== null ? oreAvailable(state, v.itemId) : 0
    return (
      <HudHoverCard
        title={`${tr('ui.hud.143', { p1: String(v.id).padStart(2, '0') })} · ${v.itemName} · ${
          v.worker === 'pilot' ? tr('ui.hud.082') : aiCoreText(v.worker)
        }`}
        input={[
          { glyph: itemGlyphName(def?.id, def?.kind ?? 'item'), name: def?.name ?? v.itemName },
          { name: tr('ui.hud.117', { p1: v.batchUnits.toLocaleString('zh-CN') }) },
          { name: tr('ui.hud.118', { p1: Math.floor(have).toLocaleString('zh-CN') }) },
          { name: tr('ui.hud.119', { p1: Math.round(v.cycleMs / 100) / 10 }) },
        ]}
        output={outs.map((o) => ({
          glyph: 'mineral',
          name: ctx.items.get(o.mineralId)?.name ?? o.mineralId,
          qty: `×${o.units.toLocaleString('zh-CN')}`,
        }))}
        note={tr('ui.hud.125', { p1: Math.round(v.percent) })}
      />
    )
  }

  /**
   * **投料行的悬停卡**（**2026-09-30 船长令**：「鼠标悬停工位的悬浮窗，在投料窗口内也要有」）。
   *
   * ⚠ 与工位卡的区别只在"这味料**还没起炉**"：引擎在未起炉时不给每批口径 ⇒
   * **矿/气/冰**用物品规格（`refineBaseParamsOf`，与 `startRefineRun` 同一函数，界面不复算）；
   * **残骸**按体积（`recycleBatchM3Of`，同样与起炉共用单点）⇒ 手上与每批都用 m³；
   * **货柜**是一箱一件（`UNBOX_CYCLE_MS`）。
   * 输出列：矿类走 `refineBatchOutputOf` 真值；残骸在未起炉时**只有保底原材料名**（引擎不给件数，
   * 界面的估算口径留在工业页的回收卡里，不往这里搬）；货柜的产出写不出件数 ⇒ 给物品自己的说明。
   */
  const feedTip = (def: (typeof feedDefs)[number]['def'], have: number): ReactNode => {
    const isWreck = def.kind === 'wreck'
    const isBox = def.kind === 'container'
    const base = refineBaseParamsOf(def)
    const batchM3 = isWreck ? recycleBatchM3Of(def.id) : 0
    const wreckPool = isWreck ? recycleProfileOf(ctx, def.id) : null
    const outs = !isWreck && !isBox ? refineBatchOutputOf(state, ctx, def, base.batchUnits) : []
    /**
     * ⚠ **2026-09-30 船长报障**：「精炼炉的投料悬浮窗有 BUG，**输入直接乘仓库内数量**」——
     * 原先材料行尾挂的是 `×拥有量`（看着像"这一炉要吃下全部库存"）⇒ **去掉**：
     * 输入列只给"料名 ＋ 每批多少 ＋ 可用多少 ＋ 每批多久"，库存自己起一行
     * （船长同日：「建议『手上XXXX件』另外起一行，修改为（仓库：XXXX）」）。
     */
    const input: HudIoLine[] = [{ glyph: itemGlyphName(def.id, def.kind), name: def.name }]
    if (isWreck) {
      input.push({ name: tr('ui.hud.145', { p1: batchM3 }) })
      input.push({ name: tr('ui.hud.144', { p1: Math.floor(have).toLocaleString('zh-CN') }) })
    } else if (isBox) {
      input.push({ name: tr('ui.hud.117', { p1: 1 }) })
      input.push({ name: tr('ui.hud.118', { p1: Math.floor(have).toLocaleString('zh-CN') }) })
      input.push({ name: tr('ui.hud.119', { p1: Math.round(UNBOX_CYCLE_MS / 1000) }) })
    } else {
      input.push({ name: tr('ui.hud.117', { p1: base.batchUnits.toLocaleString('zh-CN') }) })
      input.push({ name: tr('ui.hud.118', { p1: Math.floor(have).toLocaleString('zh-CN') }) })
      input.push({ name: tr('ui.hud.119', { p1: Math.round(base.cycleMs / 100) / 10 }) })
    }
    const output: HudIoLine[] = outs.map((o) => ({
      glyph: 'mineral',
      name: ctx.items.get(o.mineralId)?.name ?? o.mineralId,
      qty: `×${o.units.toLocaleString('zh-CN')}`,
    }))
    if (isWreck) {
      const pool = wreckPool !== null ? recycleMineralPoolOf(wreckPool) : []
      output.push({ name: `${tr('ui.hud.146')}：` })
      for (const [mineralId] of pool) {
        output.push({ glyph: 'mineral', name: ctx.items.get(mineralId)?.name ?? mineralId })
      }
    }
    return (
      <HudHoverCard
        title={def.name}
        input={input}
        output={output}
        /* 货柜：拆不出矿物 ⇒ 用物品自己的说明兜住产出列（不新写一句玩家文案） */
        emptyOutput={isBox ? def.description : undefined}
      />
    )
  }

  /**
   * **书架行 / 造船厂行的悬停卡**（**2026-09-30 船长令**：悬浮窗要应用到组装机与造船厂）。
   * 这两处都是"多料蓝图"⇒ 左列直接用 `matRowsOf` 的清单（每料一行：图标 ＋ 名 ＋ `×需要`），
   * 缺料由卡底那行**齐备度（缺：…）**点出（颜色不是唯一载体）。
   */
  const shelfTip = (row: { product: string; glyph: string; materials: readonly MaterialNeed[] }): ReactNode => {
    const rows = matRowsOf(engine, row.materials)
    const ready = readinessOf(engine, row.materials)
    /**
     * 多料蓝图：**每味料两行**——第一行「图标 ＋ 名 ＋ ×需要量」，第二行「（可用：M 件）」
     * （**2026-09-30 船长报障**：一行里塞不下，数字会被折行截断 ⇒ 库存另起一行）。
     */
    const input: HudIoLine[] = []
    for (const m of rows) {
      input.push({ glyph: m.glyph, name: m.name, qty: `×${m.need.toLocaleString('zh-CN')}`, ok: m.ok })
      input.push({ name: tr('ui.hud.118', { p1: m.have.toLocaleString('zh-CN') }) })
    }
    return (
      <HudHoverCard
        title={row.product}
        input={input}
        output={[{ glyph: row.glyph, name: row.product }]}
        note={
          ready.short.length === 0
            ? `${tr('ui.hud.104')} ${Math.round(ready.pct * 100)}%`
            : tr('ui.hud.111', { p1: Math.round(ready.pct * 100), p2: ready.short.join(tr('ui.MatterTechTab.017')) })
        }
      />
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

              <div className={`hud-panel${foldStation ? ' is-folded' : ''}`}>
                {/* 标题行 = 标题 ＋ 右侧折叠按钮（**2026-09-30 船长令**：工位窗口可最小化成标题栏）。
                    无障碍：真 `<button>` ＋ `aria-expanded` ＋ `aria-controls`（指向正文 id），
                    名字用稳定的面板名，动作提示走 `title`（全仓 Tooltip 接管）。 */}
                <h3 className="hud-panel-head">
                  <Glyph name="ico-furnace" size={13} color="currentColor" />
                  <span className="hud-panel-title">{tr('ui.hud.041')}</span>
                  <IconBtn
                    glyph={foldStation ? 'ico-unfold' : 'ico-fold'}
                    title={foldStation ? tr('ui.hud.142') : tr('ui.hud.141')}
                    ariaLabel={tr('ui.hud.041')}
                    ariaExpanded={!foldStation}
                    ariaControls="hud-station-body"
                    onClick={() => setFoldStation((v) => !v)}
                  />
                </h3>
                {foldStation ? null : (
                <div id="hud-station-body">
                {/* **「优先使用的 AI」**（2026-09-30 船长令：「放在队列的顶部选择」）——
                    工位表就是精炼的"队列"，选择器坐它顶部（改前挂在同一窗口的**底部**，
                    实测 y 1190–1219 已在 940 视口之外，要滚才够得着）。 */}
                <AiCorePick engine={engine} suffix="refine" core={core} usableCores={usableCores} onPick={setCoreSel} pilotNote />
                {/* ⚠ `is-station` = 「首列是动图、主列是资源名」的窄表可压缩档（**2026-09-30 船长报障**：
                    这张表原先按 132px 首列 + 132px 主列 + 130px 进度列排版 ⇒ 最小宽 690px，
                    比左列还宽 ⇒ 整块按 690px 固定排版、不随窗口缩放，右边被右列盖住。
                    ⚠ 同日第三批船长令：「**工作最左侧不要显示工位编号**」＋「将精炼的动图应用到工位内」
                    ⇒ 首列从"工位号"改成 **AI 指挥中心那套精炼/回收动画**（同一实现 `AiWorkFx`，
                    判据 `industryWorkKindOf` 单点），编号下屏、改在悬停卡与「停炉」提示里出现。
                    档位定义见 `_hud-industry.css` 的 `.hud-table.is-station`） */}
                <table className="hud-table is-station">
                  <thead>
                    <tr>
                      <th className="hud-fx-cell" aria-label={tr('ui.hud.147')} />
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
                          {/* 精炼/回收动画（AI 指挥中心同一份实现；固定尺寸槽位 ⇒ 行高不跳动） */}
                          <td className="hud-fx-cell">
                            <AiWorkFx kind={industryWorkKindOf(v.itemId, ctx.items)} />
                          </td>
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
                              /* 编号下屏后，「停炉」提示要带上工位号（免得停错炉时无从核对） */
                              title={tr('ui.hud.047', { p1: String(v.id).padStart(2, '0') })}
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
                </div>
                )}
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
                        <tr key={def.id} className={have <= 0 ? 'is-dim' : ''} {...hoverTipProps(feedTip(def, have))}>
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
              {/* 组装机：选择器放"制造队列"窗口顶部（2026-09-30 船长令：工业几个页面都加 AI 选择） */}
              <AiCorePick engine={engine} suffix="craft" core={core} usableCores={usableCores} onPick={setCoreSel} />
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
                        <tr key={r.id} {...hoverTipProps(shelfTip(r))}>
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
              {/* 造船厂：选择器放"在建舰船"窗口顶部（同上令） */}
              <AiCorePick engine={engine} suffix="shipyard" core={core} usableCores={usableCores} onPick={setCoreSel} />
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
                      /* 悬浮卡与组装机书架**同一份**（都是"多料蓝图"⇒ 左列走材料清单） */
                      <tr key={r.id} {...hoverTipProps(shelfTip({ product: r.name, glyph: 'nav-ship', materials: r.materials }))}>
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
                        {out !== undefined ? <RowGlyph glyph={itemGlyphName(out.id, out.kind)} /> : null}
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
                {/* 实验室：选择器放"配方"顶部（2026-09-30 船长令：「实验室放到配方顶部」） */}
                <AiCorePick engine={engine} suffix="lab" core={core} usableCores={usableCores} onPick={setCoreSel} />
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
