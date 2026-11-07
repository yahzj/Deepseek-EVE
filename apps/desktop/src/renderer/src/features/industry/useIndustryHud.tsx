import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { type LabFilter } from '../../ui/LabRecipeFilters'
import { aiCoreCap, canStartBlueprint, formatDurationShort, industryAiBonus, bestAiCoreOf, usableAiCoresOf, labRecipeUnlocked, labTechRequirementOf, manufacturingRunViews, missingMaterials, manualSlotOf, industryAvailable, stationActivityStartBlockReason, ownsBlueprint, recycleBatchM3Of, recycleMineralPoolOf, recycleProfileOf, refineBaseParamsOf, refineBatchOutputOf, refineRate, refineRateMax, sortManuRows, UNBOX_CYCLE_MS, visibleItemDefs, type AiCoreType, type MaterialNeed } from '@whale/core'
import type { PageProps } from '../../pages/common'
import { itemGlyphName } from '../../ui/Glyphs'
import { HudHoverCard, type HudIoLine } from '../../ui/hud'
import { useLoopGoalDraft } from '../../ui/useLoopGoalDraft'
import { aiCoreText } from '../../ui/labelsText'
import { marketPriceOf } from '../../ui/yieldView'
import { SUB_ALL, bpFilterKeysOf, manuSubsOf, presentSubs, wreckTierOf } from '../../ui/itemSubs'
import { bookPriceOf } from './blueprintValue'
import { tr, cmdText, useL10n } from '../../i18n/locale'
import type { HudTab, HudShelfKind, FeedTab, HudShelfRow } from './hudTypes'
import { matRowsOf, readinessOf } from './hudMaterials'
import { manufacturingBlueprintVisible } from './blueprintPolicy'

export function useIndustryHud({ engine, onToast, onGotoMarket }: PageProps & {
  onGotoMarket?: (goodKey: string) => void
}) {
  const state = engine.state
  const ctx = engine.ctx
  const { locale } = useL10n()
  const [tab, setTab] = useState<HudTab>('refine')
  /**
   * **实验室「循环实验」开关的输入草稿**（**2026-10-01**：实验室按组装机那套 ⇒ 一线一批 ＋ 循环）。
   * 与组装机那张卡的 `goalDraft` 同款：只在本页留住草稿，**回车/失焦时提交一次**；
   * 输入框没有"受控回写"⇒ 打到一半不会被引擎 tick 的刷新冲掉。
   */
  /**
   * **循环目标的防丢草稿套件**（2026-09-17 组装机卡首创；**2026-10-02 模块化**：口径原样搬进
   * `ui/useLoopGoalDraft.ts`，组装机卡 / 经典实验室卡 / 本页三处共用一份 —— 行为逐字不变）。
   * ⚠ `submitOnUnmount` 的闭包在 `recipe` 声明之前创建：钩子只在**卸载时**才调用它（届时 `recipe`
   * 早已初始化，且每次渲染的最新闭包经 ref 转发），无 TDZ 问题。
   */
  const { draft: labGoalDraft, typeDraft, clearDraft, clearTouched } = useLoopGoalDraft((n) => {
    if (recipe === null) return
    engine.setLabLoopAt(recipe.id, true, n)
  })
  /**
   * **首访实验室**（**2026-09-30 船长令**：第一次进实验室给玩家发一封黑市通讯）——
   * 与旧工业页的实验室子页同一处口径（`engine.noteLabOpened()` 内部幂等，通讯由 `advanceComms` 送达）。
   */
  useEffect(() => {
    if (tab === 'lab') engine.noteLabOpened()
  }, [tab, engine])
  const [recipeId, setRecipeId] = useState<string | null>(null)
  /**
   * **书架筛选**（**2026-10-01 船长令**：「新工业界面的组装机的蓝图书架筛选过于简陋，建议参考旧版的组装机
   * 筛选和搜索」）—— 从"分类 ＋ 仅可造"两维扩到**旧版那套**：
   * ① 一级门类五档（全部 / 装备 / 零件 / 消耗品 / 舰船插件，键与旧页 `MANU_TABS_CRAFT` 同一套）·
   * ② 二级子类（走 `manuSubsOf` 单点：装备=产物功能组 · 消耗品=产物大类 · 零件=基础/高级）·
   * ③ 搜索（匹配产物名/图纸名）· ④ 已学会/未学会 · ⑤ 仅可造（本页原有）。
   * 分档判据一律走**单点** `bpFilterKeysOf`（2026-10-01 已提升到 `ui/itemSubs.ts`），本页不自算。
   */
  const [shelfKind, setShelfKind] = useState<HudShelfKind>(SUB_ALL)
  const [shelfSub, setShelfSub] = useState<string>(SUB_ALL)
  const [shelfLearned, setShelfLearned] = useState<string>(SUB_ALL)
  const [shelfKwRaw, setShelfKwRaw] = useState('')
  const shelfKw = shelfKwRaw.trim().toLowerCase()
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
  const [coreSel, setCoreSel] = useState<AiCoreType>(() => bestAiCoreOf(state) ?? 'basic')
  const usableCores = usableAiCoresOf(state)
  const core = usableCores.includes(coreSel) ? coreSel : (usableCores[0] ?? null)
  const runs = engine.refineRunViews()
  const labRuns = engine.labRunViews()
  const manuRuns = manufacturingRunViews(state, ctx)

  /**
   * **正在造的蓝图 id 集**（**2026-10-01 船长令**：「一并应用 AI 指挥中心的 SVG 动画」⇒ 书架里
   * 「正在造的那一张」行首也挂同一枚动画）。取数 = 本页已有的 `manuRuns`（core 单点
   * `manufacturingRunViews`），不另算一份口径。
   */
  const runningBlueprintIds = new Set(
    manuRuns.map((v) => v.blueprintId).filter((id): id is string => id !== null),
  )
  const [labFilter, setLabFilter] = useState<LabFilter>('all')
  const allRecipes = [...ctx.labRecipes.values()]
  const recipes = allRecipes.filter(r => labFilter === 'all' || r.category === labFilter)
  // 分类只筛目录，不切换已选配方及其循环目标。
  const recipe = allRecipes.find((r) => r.id === recipeId) ?? allRecipes[0] ?? null
  /**
   * **谜质科技门槛**（**2026-09-30 船长令**：T5「解锁新的燃料配方」）——判据与起线拒绝同一把尺
   * （`labRecipeUnlocked`）：锁着的配方**照列**（要看得见缺哪棵树），但两个开工键一起置灰。
   */
  const lockTip = recipe !== null && !labRecipeUnlocked(state, ctx, recipe)
    ? tr('ui.lab.025', { p1: labTechRequirementOf(ctx, recipe) ?? recipe.name })
    : null
  /**
   * **循环实验读数与开关提交**（**2026-10-01 船长令**：实验室按组装机那套 ⇒ 一线一批 ＋ 卡片级循环）。
   * 与组装机那张卡同款：`goalText` 解析成目标批数（≤0 / 非数 ⇒ 不限），开关状态与目标一起提交。
   */
  const labLoop = engine.labLoopOf(recipe !== null ? recipe.id : null)
  const commitLabLoop = (on: boolean, goalText: string): void => {
    clearTouched()
    if (recipe === null) return
    const n = Number.parseInt(goalText, 10)
    const r = engine.setLabLoopAt(recipe.id, on, on ? (Number.isFinite(n) && n > 0 ? n : null) : null)
    if (!r.ok) onToast(cmdText(r) || tr('ui.hud.021'), true)
  }
  const rate = refineRate(state, ctx)
  const tabs: Array<{ k: HudTab; g: string; label: string; title: string }> = [
    { k: 'refine', g: 'ico-furnace', label: tr('ui.hud.001'), title: tr('ui.hud.011') },
    { k: 'craft', g: 'ico-assembler', label: tr('ui.hud.002'), title: tr('ui.hud.012') },
    { k: 'shipyard', g: 'ico-drydock', label: tr('ui.hud.003'), title: tr('ui.hud.013') },
    ...(engine.labUnlocked()
      ? [{ k: 'lab' as HudTab, g: 'ico-lab', label: tr('ui.hud.004'), title: tr('ui.hud.014') }]
      : []),
  ]
  /**
   * **手动工作位被占时的置灰理由**（**2026-10-01 船长令**：「建议改成和旧的工业一样，主控正在活动时，
   * 禁止按钮」）。取数走 core 单点 `manualSlotOf`（页面不自算——§十五之二）；`null` = 可以亲自开。
   *
   * 为什么必须封这一格：手动工作位（炉/回收炉/拆解台/制造线/实验室）全仓只有 1 个名额，而起线指令
   * 会走 core 的"换线"路径（`haltActivityForSwitch` ＋ 统一日志）⇒ **点一下就静默把手上那条换掉、
   * 当前那一批进度丢弃**，且每点一次都能再换一次（船长看到的"无限打断"）。旧工业页是置灰，本页对齐。
   *
   * ⚠ **只封这一格**：主控在采矿/打捞/远征/巡逻时点开工，仍走 `activityGate` 的"直接切 / 先警告再切"
   * （船长 2026-09-21 令「统一为能够直接切换」）——本判据不参与那件事。
   * ⚠ **AI 核心驱动的开工不受此限**（`manualSlotOf` 只认 `worker === 'pilot'`）。
   */
  const manualBlock = stationActivityStartBlockReason(state, ctx, tab === 'lab' ? 'lab' : tab === 'craft' || tab === 'shipyard' ? 'manufacturing' : 'refine')
  const manualNote = manualSlotOf(state) !== null ? tr('ui.hud.212') : manualBlock ? cmdText(manualBlock) : null
  /**
   * **组装机书架**（模块 ＋ 物品蓝图；舰船归造船厂页签）——
   * 排序沿用 core 单点 `sortManuRows`（类型 → 书价升序 → 同产物的一次性图纸紧随原图纸），
   * 书价走渲染层既有的 `bookPriceOf`（与现有工业页同一把尺）。
   */
  const shelfRows: HudShelfRow[] = useMemo(() => {
    const rows: HudShelfRow[] = []
    for (const bp of ctx.blueprints.values()) {
      if (bp.unreleased) continue
      const mod = bp.moduleId !== undefined ? ctx.modules.get(bp.moduleId) : undefined
      const item = bp.itemId !== undefined ? ctx.items.get(bp.itemId) : undefined
      if (mod === undefined && item === undefined) continue
      rows.push({
        id: bp.id,
        name: bp.name,
        product: mod?.name ?? item?.name ?? bp.id,
        glyph: mod?.slot ?? item?.kind ?? 'blueprint',
        /**
         * ⚠ `kindLabel` **只服务 `sortManuRows` 的排序**（core 的 `MANU_KIND_ORDER` 只认
         * 装备/舰船/消耗品三档，表外的值一律沉底）⇒ 这里保持它原有的两档口径不动；
         * **门类筛选走 `keys.tab`**（五档，由单点 `bpFilterKeysOf` 现算）——两者各司其职。
         */
        kindLabel: mod !== undefined ? '装备' : '消耗品',
        keys: bpFilterKeysOf(ctx, bp.id),
        productKey: mod !== undefined ? `module:${mod.id}` : `item:${item?.id ?? bp.id}`,
        bookPrice: bookPriceOf(engine, bp.id, 0),
        singleUse: bp.singleUse === true,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
      })
    }
    return sortManuRows<HudShelfRow>(rows)
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
  /** 学会判据（与状态 chip 同一把尺）：隐式蓝图（无需学习）也算"学会" */
  const shelfLearnedOf = (row: HudShelfRow): boolean =>
    ownsBlueprint(state, row.id) || ctx.blueprints.get(row.id)?.learnless === true
  /**
   * **二级子类候选：只列本门类下真有图纸的档**（与旧页同一套现算口径 `presentSubs`；「全部」常显）——
   * 选进一个必然空的档是船长 2026-09-14 点名的坑，所以按本页真数据现算。
   */
  const availableShelfRows = shelfRows.filter(row => manufacturingBlueprintVisible(state, ctx, row.id))
  const shelfSubOptions = presentSubs(shelfKind === SUB_ALL ? [] : manuSubsOf(shelfKind), (key) =>
    availableShelfRows.some((r) => r.keys.tab === shelfKind && r.keys.subKey === key),
  )
  const shelfShown = availableShelfRows.filter((r) => {
    if (shelfKind !== SUB_ALL && r.keys.tab !== shelfKind) return false
    if (shelfSub !== SUB_ALL && r.keys.subKey !== shelfSub) return false
    if (shelfLearned !== SUB_ALL && shelfLearnedOf(r) !== (shelfLearned === 'learned')) return false
    if (shelfReadyOnly && !shelfCanStart(r)) return false
    if (shelfKw !== '' && !`${r.product} ${r.name}`.toLowerCase().includes(shelfKw)) return false
    return true
  })
  /** 筛选是否生效（读数行据此切"筛剩多少 / 书架共多少"两句话） */
  const shelfFilterActive =
    shelfKind !== SUB_ALL || shelfSub !== SUB_ALL || shelfLearned !== SUB_ALL || shelfReadyOnly || shelfKw !== ''
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
  /**
   * 组装机 / 造船厂的开工键是"**有可用核心就走核心、没有才主控**"（`worker = core ?? 'pilot'`）
   * ⇒ 手动位那道置灰**只在这一下真的会落到主控上时**才生效（有核心时不该被手动位挡住）。
   */
  const manuManualNote = core === null ? manualNote : null
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
    for (const r of allRecipes) {
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
    .map((def) => ({ def, have: industryAvailable(state, ctx, def.id, 'pilot'), aiHave: industryAvailable(state, ctx, def.id) }))
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
    const have = v.itemId !== null ? industryAvailable(state, ctx, v.itemId) : 0
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
  /**
   * **投料行"每批要吃多少"**（**2026-09-30 船长令**：缺料的项要在悬浮窗与行上标红＋标出缺多少）——
   * 与起炉**同一套口径**、界面不复算：矿/气/冰 = `refineBaseParamsOf().batchUnits`（件）、
   * 残骸 = `recycleBatchM3Of()`（m³，与 `ui.hud.144/145` 同单位）、货柜 = 1 件（一箱一件）。
   */
  const feedBatchOf = (def: (typeof feedDefs)[number]['def']): { per: number; unit: string } => {
    if (def.kind === 'wreck') return { per: recycleBatchM3Of(def.id), unit: ' m³' }
    if (def.kind === 'container') return { per: 1, unit: '' }
    return { per: refineBaseParamsOf(def).batchUnits, unit: '' }
  }
  /**
   * **缺料真值文字**（够 ⇒ `null`）：`ui.hud.150`「缺 {p1}」——**红字之外的文字载体**
   * （`ui-ux-pro-max` Color Only（High）：红/绿不能单独承载信息）。**只在"未起炉"的行上用**：
   * 投料表里的行本来就是待开工项；在跑的工位不标（旧工业页那条口径：在跑的红字会被误读成故障）。
   */
  const feedShortOf = (def: (typeof feedDefs)[number]['def'], have: number): string | null => {
    const { per, unit } = feedBatchOf(def)
    if (have >= per) return null
    return tr('ui.hud.150', { p1: `${Math.ceil(per - have).toLocaleString('zh-CN')}${unit}` })
  }
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
    const input: HudIoLine[] = [{ glyph: itemGlyphName(def.id, def.kind), name: def.name, ok: feedShortOf(def, have) === null, short: feedShortOf(def, have) ?? undefined }]
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
    const rows = matRowsOf(engine, row.materials, 'id' in row ? String(row.id) : undefined)
    const ready = readinessOf(engine, row.materials, 'id' in row ? String(row.id) : undefined)
    /**
     * 多料蓝图：**每味料两行**——第一行「图标 ＋ 名 ＋ ×需要量」，第二行「（可用：M 件）」
     * （**2026-09-30 船长报障**：一行里塞不下，数字会被折行截断 ⇒ 库存另起一行）。
     */
    const input: HudIoLine[] = []
    for (const m of rows) {
      /* 缺料行：红字 ＋ 行尾真值「缺 N」（`ok:false` 只上色，文字由 `short` 给 —— 颜色不是唯一载体）；
         ⚠ 只在**未开工**的书架/造船厂行上标（正在制造的线不标红：旧工业页那条口径，免得误读成故障） */
      input.push({
        glyph: m.glyph,
        name: m.name,
        qty: `×${m.need.toLocaleString('zh-CN')}`,
        ok: m.ok,
        short: m.ok ? undefined : tr('ui.hud.150', { p1: (m.need - m.have).toLocaleString('zh-CN') }),
      })
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
  return {
    tabs,
    tab,
    setTab,
    rate,
    runs,
    stationCap,
    engine,
    production,
    ringSegments,
    rateBase,
    rateMax,
    ratePos,
    foldStation,
    setFoldStation,
    core,
    usableCores,
    setCoreSel,
    ctx,
    stationTip,
    onToast,
    feedShown,
    feedTab,
    setFeedTab,
    setFeedSub,
    feedSub,
    feedKwRaw,
    setFeedKwRaw,
    feedTip,
    feedShortOf,
    manualNote,
    startFeed,
    manuRuns,
    durText,
    stopManu,
    shelfKwRaw,
    setShelfKwRaw,
    shelfFilterActive,
    shelfShown,
    shelfRows: availableShelfRows,
    state,
    shelfKind,
    setShelfKind,
    setShelfSub,
    shelfSubOptions,
    shelfSub,
    shelfLearned,
    setShelfLearned,
    shelfReadyOnly,
    setShelfReadyOnly,
    shelfCanStart,
    shelfTip,
    runningBlueprintIds,
    specOf,
    manuManualNote,
    startManu,
    dockRuns,
    shipShown,
    tierFilter,
    setTierFilter,
    shipRows,
    labFilter,
    setLabFilter,
    recipes,
    recipe,
    labEff,
    setRecipeId,
    labLoop,
    labRuns,
    labGoalDraft,
    typeDraft,
    clearDraft,
    commitLabLoop,
    lockTip,
    onGotoMarket,
  }
}

export type IndustryHudModel = ReturnType<typeof useIndustryHud>
