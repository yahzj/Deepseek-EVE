/**
 * 工业面板：蓝图书架 + 组装机（2026-09-08 与精炼炉完全同款劳动者制：主控亲自/AI 核心驱动；
 * 同一蓝图可同时开多条线、不同蓝图不限，皆受劳动者约束——每条线独立进度与取消，可随时加开）。
 * V9：蓝图 = 消耗品书。市场买书 → 书进"蓝图书架"（blueprintStock）→ 学习一本 → 永久可造；
 * 学会后的重复蓝图书只能放回市场出售。
 */
import {
  aiCoreName,
  aiEfficiency,
  calcBuildDurationMs,
  countAiCore,
  countWare,
  countModule,
  formatDurationMs,
  manufacturingLoopOf,
  manufacturingRunViews,
  marketLockedReason,
  matNeedCount,
  missingMaterials,
  ownsBlueprint,
  // 2026-09-22 第 3 步：收藏星标进"实时指纹"（星标子组件自己也读 state，漏了会停在旧值）
  isMarked,
  recipeCapability,
  canStartBlueprint,
  // 组装机卡片排序（2026-09-14 船长「一次性图纸应该和原图纸放在一起」）——口径单点在 core 纯函数
  sortManuRows,
  /** 2026-09-22 船长令：缺料是"零件"时提示去组装机（而不是市场）⇒ 产物→蓝图反查（core 单点，含缓存） */
  blueprintProducingItem,
  // 2026-09-14 舰船仓库批：船型"总持有"读口径（仓库＋在役舰队）
  shipOwnedCount,
  // 2026-09-13：精炼源只列玩家可见的矿（未上线矿不进"由精炼炉炼出"提示）
  visibleItemDefs,
  // 2026-09-14 船长：虫洞专属图纸改「去虫洞」跳转，门槛与扫描虫洞页同一本账
  WORMHOLE_SCAN_UNLOCK_STANDING,
  // 2026-09-26 船长令：取得第一个黑匣后才解锁组装机的「舰船插件」档（判据单点）
  plugCraftUnlockedOf,
  // 2026-09-26 船长令「所有声望门槛改读累计声望」：虫洞闸的读数走唯一入口
  standingOf,
  DSI_FACTION_ID,
} from '@whale/core'
// 2026-09-23 船长令：使用 AI 核心时默认选「当前拥有的最高级核心」
import { bestAiCoreOf } from '@whale/core'
import type { AiCoreType, GameState, MaterialNeed } from '@whale/core'
import { RedeemFragmentButton } from '../ui/fragmentRedeem'
import { Panel } from '@whale/ui'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { ItemHover, ModuleHover, ShipHover } from '../ui/shipInfo'
import { MarkStar, pinMarked } from '../ui/marks'
import { AiSlotText } from '../ui/aiSlots'
import { HintIcon } from '../ui/Hint'
import { RowGlyph } from '../ui/itemView'
/** 活动卡「产出」读数（2026-09-23 船长令：收入预估换口径；装备/舰船只显示市场当前价格）——全仓唯一实现 */
import { GoodsLine, marginPctOf, marketPriceOf } from '../ui/yieldView'
import { partToneKeyOf, toneOf } from '../ui/Glyphs'
import { ASSEMBLER_CARD_MIN_H, LazyMount, useIdleChunk } from '../ui/LazyMount'
import { useL10n, cmdText } from '../i18n/locale'
import { MONEY_GLYPH } from '../pages/common'
import {
  BLUEPRINT_LEARN_TABS,
  BLUEPRINT_USE_TABS,
  CONSUME_SUBS,
  MANU_TABS,
  MANU_TABS_CRAFT,
  MODULE_SUBS,
  SHIP_TIER_SUBS,
  SUB_ALL,
  manuSubsOf,
  presentSubs,
  moduleSubKeyOf,
  type BlueprintLearnKey,
  type BlueprintUseKey,
  type ManuTabKey,
  type SubOption,
} from '../ui/itemSubs'
import { tr } from '../i18n/locale'

const CORE_ORDER: AiCoreType[] = ['basic', 'gamma', 'beta', 'alpha']

/** 在市场目录里找某蓝图的市场商品（key）；找不到返回 null */
function bpGoodKey(engine: GameEngine, blueprintId: string): string | null {
  for (const good of engine.ctx.marketGoods.values()) {
    if (good.kind === 'blueprint' && good.refId === blueprintId) return good.key
  }
  return null
}

/** 产物现货基准价（产物在市场目录的 basePrice；弹药等按单次产出数量折算） */
export function productBaseOf(engine: GameEngine, kind: 'module' | 'ship' | 'item', refId: string, units = 1): number {
  for (const good of engine.ctx.marketGoods.values()) {
    if (good.kind === kind && good.refId === refId) return (good.basePrice ?? 0) * units
  }
  return 0
}

/** 精炼源矿石：精炼配方（def.refine）产出该矿物的矿石 id 列表；空 = 无精炼产出，只能市场购买。
 *  ⚠ 只列**玩家可见**的矿（`visibleItemDefs`）：未上线矿石不能作为"由精炼炉炼出"的提示来源
 *  （否则"虚空晶由虚空母矿炼出"会把未上线矿名念给玩家听）。 */
function refineSourcesOf(engine: GameEngine, mineralId: string): string[] {
  const out: string[] = []
  for (const def of visibleItemDefs(engine.ctx)) {
    if (def.kind === 'wreck') continue
    if ((def.refine ?? []).some((r) => r.mineralId === mineralId)) out.push(def.id)
  }
  return out
}

/** 蓝图书市场价（组装机排序用：市场目录 basePrice；缺省 = 蓝图字段；再无 = 沉底） */
export function bookPriceOf(engine: GameEngine, blueprintId: string, fallback: number): number {
  const k = bpGoodKey(engine, blueprintId)
  if (k) {
    for (const g of engine.ctx.marketGoods.values()) {
      if (g.key === k) return g.basePrice ?? fallback
    }
  }
  return fallback
}

/* ═══════════════ 蓝图书架（紧凑小卡网格：书+数量+状态+学习/出售；船长 2026-09-05 定形态） ═══════════════ */

/** 蓝图书架：持有的蓝图书（学习 → 永久学会；多余的书市价出售） */
export function BlueprintShelfPanel({
  engine,
  onToast,
  onGotoCraft,
  focusBookId,
}: {
  engine: GameEngine
  onToast: ToastFn
  /** 「去组装机」：切到组装机标签并定位那张蓝图卡（船长 2026-09-14：「蓝图书架内，玩家可以通过蓝图
   *  直接跳转对应组装机」）——由工业页透传（跳转时会**清掉组装机的三级筛选**，否则目标卡可能被筛掉） */
  onGotoCraft?: (blueprintId: string) => void
  /** **反向定位**（**2026-09-26 船长令**：「优化工业界面」→ 采纳"优3"）：组装机那边点「去书架」
   *  跳过来时，这一本要高亮（页面层同一套 `.app-belt-card.is-goto` ＋ 居中滚动）。 */
  focusBookId?: string | null
}) {
  const state = engine.state
  const { t } = useL10n()
  const entries = Object.entries(state.blueprintStock).filter(([, n]) => n > 0)
  /**
   * **与组装机同样的筛选**（船长 2026-09-14：「蓝图书架也加入组装机同样的筛选」）：
   * 一级类别（`MANU_TABS`）/ 二级子类（`manuSubsOf`）/ 三级一次性-永久（`BLUEPRINT_USE_TABS`），
   * 三项都走 `bpFilterKeysOf` 同一个单点；三级同样**只在选了子类后才出现**（与组装机逐字同款口径）。
   */
  const [kind, setKind] = useState<ManuTabKey>('all')
  const [sub, setSub] = useState<string>(SUB_ALL)
  const [useKind, setUseKind] = useState<BlueprintUseKey>(SUB_ALL)
  /** 蓝图书卡（未筛选）：书架 = **手上还没学的书** */
  const bookCards = entries.map(([id, n]) => ({ id, n, keys: bpFilterKeysOf(engine, id) }))
  /**
   * **碎片逆向卡（2026-09-19 船长：「蓝图书架内确实没有显示可以合并的蓝图碎片。是否忘记添加到蓝图书架了？」）**：
   * 书架原先**只列"手上持有的蓝图书"**，而碎片是"还没有书"的那条路 ⇒ 玩家在这里看不到任何可合并的碎片。
   * 现补一类卡：**碎片进度 > 0 且尚未掌握、且手上没有这本书**的逆向蓝图，卡上直接给「逆向解锁 N/M」。
   * 读数走 core 单点 `fragmentRedeemRows()`（与兑命令同源）；门类归属走 `bpFilterKeysOf`（与蓝图书同一把尺）。
   */
  const fragCards = engine
    .fragmentRedeemRows()
    .filter((r) => !r.learned && r.have > 0 && (state.blueprintStock?.[r.blueprintId] ?? 0) <= 0)
    .map((r) => ({ r, keys: bpFilterKeysOf(engine, r.blueprintId) }))
  const cards = [...bookCards, ...fragCards]
  /**
   * **筛选项按"书架上真有卡片"出**（2026-09-19 报障修复 · 船长：「如果选择舰船蓝图或者消耗品蓝图，
   * 卡片列表会变空」）：书架只列"还没学的书"＋"可逆向的碎片卡"，而**学习一本吃一本书**
   * （`market.learnBlueprint`）⇒ 把某一门类学完的档，书架上那一门类就是空的。
   * 旧口径把三个标签**静态全列** ⇒ 选「舰船蓝图」/「消耗品蓝图」必然一张卡都不剩，
   * 正是 2026-09-14 那条「避免看不见的筛选」要防的坑。现改为**只列真有卡片的档**：
   * 「全部 / 全部子类 / 全部图纸」三项**常显**，其余按现有卡片现算（键与顺序仍取既有单点表）。
   */
  const tabsShown = MANU_TABS.filter((tb) => tb.key === 'all' || cards.some((c) => c.keys.tab === tb.key))
  const subsShown = manuSubsOf(kind).filter((s) => cards.some((c) => c.keys.tab === kind && c.keys.subKey === s.key))
  const usesShown = BLUEPRINT_USE_TABS.filter((u) =>
    u.key === SUB_ALL
      ? true
      : cards.some(
          (c) =>
            (kind === 'all' || c.keys.tab === kind) &&
            (sub === SUB_ALL || c.keys.subKey === sub) &&
            (u.key === 'single' ? c.keys.singleUse : !c.keys.singleUse),
        ),
  )
  /**
   * **卡片集合变了 ⇒ 原选择可能已经无卡**（学掉最后一张该类书 / 逆向解锁 / 新书到架）：
   * 回落到「全部」，别让玩家卡在永远空的档（与"不出空标签"同一目的）。
   */
  const kindMissing = kind !== 'all' && !tabsShown.some((x) => x.key === kind)
  const subMissing = !kindMissing && sub !== SUB_ALL && !subsShown.some((x) => x.key === sub)
  useEffect(() => {
    if (kindMissing) {
      setKind('all')
      setSub(SUB_ALL)
      setUseKind(SUB_ALL)
      return
    }
    if (subMissing) {
      setSub(SUB_ALL)
      setUseKind(SUB_ALL)
    }
  }, [kindMissing, subMissing])
  /** 三级筛选判定（与上面两张"现算表"同一把尺） */
  const passKeys = (k: { tab: ManuTabKey; subKey: string; singleUse: boolean }): boolean =>
    (kind === 'all' || k.tab === kind) &&
    (sub === SUB_ALL || k.subKey === sub) &&
    (useKind === SUB_ALL || (useKind === 'single' ? k.singleUse : !k.singleUse))
  const shown = bookCards.filter((c) => passKeys(c.keys))
  const fragShown = fragCards.filter((c) => passKeys(c.keys))
  /**
   * **可逆向解锁的碎片卡置顶**（船长 2026-09-19：「蓝图书架内，已经可以逆向解析的蓝图置顶」）：
   * 「已集齐」判据 = `have >= need`（与卡面进度、`RedeemFragmentButton` 的可点判定同源）⇒ 排到书架**最前**；
   * 未集齐的碎片卡留在蓝图书之后（原位置不动）。
   */
  const fragReady = fragShown.filter((c) => c.r.have >= c.r.need)
  const fragRest = fragShown.filter((c) => c.r.have < c.r.need)

  function handleLearn(blueprintId: string): void {
    const r = engine.learnBlueprintAt(blueprintId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Industry.130'), true)
    else onToast(tr("ui.Industry.095"))
  }

  function handleSell(blueprintId: string): void {
    const key = bpGoodKey(engine, blueprintId)
    if (!key) {
      onToast(tr("ui.Industry.096"), true)
      return
    }
    const r = engine.sellHoldingAt(key)
    if (!r.ok) onToast(cmdText(r) || tr('ui.CargoPage.019'), true)
    else onToast(tr("ui.Industry.097"))
  }

  /**
   * **碎片逆向卡**（2026-09-19 船长：「蓝图书架内确实没有显示可以合并的蓝图碎片。是否忘记添加到蓝图书架了？」）
   * ——与蓝图书**同网格**（同一份 JSX 供"置顶区"与"常规区"共用），卡面标明碎片来源与进度，
   * 动作 = 「逆向解锁 N/M」（`RedeemFragmentButton` 与物品详情弹层共用同一个出口）。
   *
   * ⚠ **卡头不挂数量标签**（船长 2026-09-19 追问「为什么在蓝图名称右边加一个碎片数量的标签」）：
   * 片数在**按钮**（`逆向解锁 N/M`）与**说明行**（还差 N 片 / 已集齐）里已经有了，卡头再挂一颗
   * 「碎片 N/M」= 同一信息第三次出现；原先那颗是照蓝图书卡的「×N」抄的版式，而书卡的 ×N 是
   * **重复本数**（决定"学习还是出售"）、碎片没有对应的"本数"概念 ⇒ 版式不必对齐，已删。
   */
  function fragCard(r: ReturnType<GameEngine['fragmentRedeemRows']>[number]): ReactNode {
    return (
      <div key={`frag-${r.fragmentItemId}`} className="app-belt-card app-shelf-card is-frag">
        <div className="app-belt-head">
          <span className="app-belt-name" title={r.blueprintName}>
            ▦ {r.blueprintName}
          </span>
        </div>
        <div className="app-belt-desc">
          {r.have >= r.need
            ? tr("ui.Industry.020")
            : tr("ui.Industry.099", { p1: r.need - r.have })}
        </div>
        <div className="app-belt-actions">
          <RedeemFragmentButton engine={engine} itemId={r.fragmentItemId} onToast={onToast} />
        </div>
      </div>
    )
  }

  if (cards.length === 0) {
    return (
      <Panel
        title={tr("ui.IndustryPage.060")}
        hint={
          // 空态只留"还没有书"这句状态；怎么弄到书的常驻引导收进标题后的圆形感叹号（2026-09-13 船长口径）
          // 2026-09-14 船长：虫洞专属图纸市场买不到 ⇒ 组装机那张卡改「去虫洞（遗迹打捞）」，这里同步改口径
          <HintIcon tip={tr('ui.Industry.138')} />
        }
        right={<span className="app-dim">{tr("ui.Industry.006")}</span>}
      >
        <div className="app-dim app-inv-empty">{tr("ui.Industry.007")}</div>
      </Panel>
    )
  }

  return (
    <Panel
      className="is-fill"
      title={tr("ui.IndustryPage.060")}
      right={
        <span className="app-dim">
          {tr("ui.Industry.008")}
          {/* 筛选生效时补"当前 N 本"（与组装机/精炼炉同款，免得对着收窄后的网格数不清） */}
          {kind !== 'all' || sub !== SUB_ALL || useKind !== SUB_ALL ? ` · 当前 ${shown.length} 本` : ''}
        </span>
      }
    >
      {/* 三级筛选与组装机**同一套**（同表、同顺序、同"选了子类才出三级"的规则）——
          样式逐字复用这两行（`app-task-tabs` + `app-fleet-tabs` + `app-tasktab`）；
          ⚠ **标签集合是现算的**（2026-09-19 报障修复）：只列"书架上真有卡片"的档，
          「全部 / 全部子类 / 全部图纸」常显——详见上面 `tabsShown / subsShown / usesShown` 的注释；
          文案 = 裸「全部」+ 同行灰字前缀（基线①，2026-09-19 丙组补） */}
      <div className="app-fleet-row">
        <span className="app-dim">{tr('ui.Industry.134')}</span>
        <div className="app-task-tabs app-fleet-tabs" role="tablist">
          {tabsShown.map((tb) => (
            <button
              key={tb.key}
              role="tab"
              aria-selected={kind === tb.key}
              className={`app-tasktab${kind === tb.key ? ' is-active' : ''}`}
              onClick={() => {
                setKind(tb.key)
                setSub(SUB_ALL) // 换一级标签即回「全部子类」（与组装机同款）
                setUseKind(SUB_ALL)
              }}
            >
              {tr(tb.id)}
            </button>
          ))}
        </div>
      </div>
      {subsShown.length > 0 ? (
        <div className="app-fleet-row">
          <span className="app-dim">{tr('ui.Industry.129')}</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={sub === SUB_ALL}
              className={`app-tasktab${sub === SUB_ALL ? ' is-active' : ''}`}
              onClick={() => {
                setSub(SUB_ALL)
                setUseKind(SUB_ALL)
              }}
            >
              {tr('ui.IndustryPage.001')}
            </button>
            {subsShown.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={sub === s.key}
                className={`app-tasktab${sub === s.key ? ' is-active' : ''}`}
                onClick={() => {
                  setSub(s.key)
                  setUseKind(SUB_ALL)
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {sub !== SUB_ALL ? (
        <div className="app-fleet-row">
          <span className="app-dim">{tr('ui.Industry.135')}</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            {usesShown.map((u) => (
              <button
                key={u.key}
                role="tab"
                aria-selected={useKind === u.key}
                className={`app-tasktab${useKind === u.key ? ' is-active' : ''}`}
                onClick={() => setUseKind(u.key)}
              >
                {tr(u.id)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="app-shelf-grid">
        {/* **可逆向解锁的碎片卡置顶**（船长 2026-09-19）——排在蓝图书之前 */}
        {fragReady.map((c) => fragCard(c.r))}
        {shown.map(({ id, n }) => {
          // 蓝图书架按**持有的书**列条目 ⇒ 走全目录（施工期闸门下未上线的图纸只有调试才可能持有）
          const bp = engine.allBlueprints.find((b) => b.id === id) ?? engine.allShipBlueprints.find((b) => b.id === id)
          const learned = ownsBlueprint(state, id)
          const su = bp?.singleUse === true
          const willConsume = su && !learned && (state.spentOneTimeRecipes ?? []).includes(id)
          const kindShip = (bp && 'shipId' in bp) || (!bp && engine.allShipBlueprints.some((b) => b.id === id))
          // 2026-09-20 零件体系：舰船书「去造船厂」、其余「去组装机」
          const isShipBook = kindShip
          return (
            <div
              key={id}
              className={`app-belt-card app-shelf-card${learned ? ' is-learned' : ''}${focusBookId === id ? ' is-goto' : ''}`}
            >
              <div className="app-belt-head">
                <span className="app-belt-name" title={bp?.name ?? id}>
                  {kindShip ? '◈ ' : '▦ '}
                  {bp?.name ?? id}
                </span>
                <span className="app-chip" style={{ marginLeft: 'auto' }}>
                  ×{n}
                </span>
              </div>
              <div className="app-belt-desc">
                {su
                  ? learned
                    ? tr("ui.Industry.009")
                    : willConsume
                      ? tr("ui.Industry.010")
                      : tr("ui.Industry.011")
                  : learned
                    ? tr("ui.Industry.012")
                    : tr("ui.Industry.013")}
              </div>
              <div className="app-belt-actions">
                {/* **去组装机 / 去造船厂**（船长 2026-09-14：「蓝图书架内，玩家可以通过蓝图直接跳转对应组装机」；
                    2026-09-20 零件体系：舰船书改跳造船厂）——切到对应标签并定位这张卡 */}
                {onGotoCraft ? (
                  <button
                    className="app-btn is-small"
                    title={
                      isShipBook
                        ? tr('ui.Industry.139')
                        : tr('ui.Industry.140')
                    }
                    onClick={() => onGotoCraft(id)}
                  >
                    {isShipBook ? tr('ui.Industry.141') : tr('ui.Industry.015')}
                  </button>
                ) : null}
                {!learned && !su ? (
                  <button className="app-btn is-small is-primary" onClick={() => handleLearn(id)}>
                    {tr("ui.Industry.016")}
                  </button>
                ) : null}
                {!su ? (
                  <button className="app-btn is-small" onClick={() => handleSell(id)} title={tr("ui.Industry.017")}>
                    {tr("ui.Industry.018")}
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
        {/* 未集齐的碎片卡：留在蓝图书之后（原位置） */}
        {fragRest.map((c) => fragCard(c.r))}
      </div>
      {shown.length === 0 && fragShown.length === 0 ? (
        <div className="app-dim app-inv-empty">{tr("ui.Industry.094")}</div>
      ) : null}
    </Panel>
  )
}

/* ═══════════════ 组装机（2026-09-08 与精炼炉同款劳动者制：主控亲自 / AI 核心驱动；多蓝图 + 同蓝图多线） ═══════════════ */

/* 三张筛选表（门类 / 子类 / 图纸 / 学会）**已按基线⑤收编到 `ui/itemSubs.ts`**（2026-09-19 丙组）：
 * `MANU_TABS` · `manuSubsOf` · `BLUEPRINT_USE_TABS` · `BLUEPRINT_LEARN_TABS`。
 * 「图纸」与「学会」两个下级维度的「全部」键统一为 `SUB_ALL`（基线②）。 */

/** 蓝图筛选三件套（类别 / 子类 / 是否一次性）——**单点**：组装机与蓝图书架都读它，键与组装机的分组逐字同源
 * （舰船 = `t<级别>` · 装备 = 产物功能 `moduleSubKeyOf(slot)` · 消耗品 = 产物大类 `itemDef.kind`）。 */
function bpFilterKeysOf(engine: GameEngine, bpId: string): { tab: ManuTabKey; subKey: string; singleUse: boolean } {
  const sbp = engine.ctx.shipBlueprints.get(bpId)
  if (sbp) {
    const def = engine.ctx.ships.get(sbp.shipId)
    return { tab: 'ship', subKey: def ? `t${def.tier}` : '', singleUse: sbp.singleUse === true }
  }
  const bp = engine.ctx.blueprints.get(bpId)
  if (bp && bp.itemId !== undefined) {
    const item = engine.ctx.items.get(bp.itemId)
    return { tab: 'supply', subKey: item?.kind ?? '', singleUse: bp.singleUse === true }
  }
  const mod = bp?.moduleId ? engine.ctx.modules.get(bp.moduleId) : undefined
  // 舰船插件（2026-09-26 船长令）：`slot === 'plug'` 单独成档，**不进**「装备」档的功能分组
  if (mod?.slot === 'plug') return { tab: 'plug', subKey: '', singleUse: bp?.singleUse === true }
  return { tab: 'equip', subKey: mod ? moduleSubKeyOf(mod.slot, mod.id) : '', singleUse: bp?.singleUse === true }
}

/**
 * **虫洞专属图纸**（`bp-wh-*` / `sbp-wh-*`）——船长 2026-09-14：「虫洞专属的蓝图市场上没有卖，建议改为跳转虫洞。
 * 如果玩家声望不达标，就无法跳转」⇒ 这类卡不给"市场求购"（那里买不到），改给**去虫洞（遗迹打捞）**按钮 +
 * **虫洞解锁声望闸**（`WORMHOLE_SCAN_UNLOCK_STANDING`，与扫描虫洞页同一本账）。
 */
function isWormholeBlueprint(bpId: string): boolean {
  return /^(bp|sbp)-wh-/.test(bpId)
}

/** 主控此刻不能"亲自再开一条制造线"的原因（null = 可开；AI 核心驱动不受此限；
 * 与精炼炉卡的手动判定同口径：手动工作位全局限 1 条（精炼炉/回收炉/制造线共用））。
 *
 * ⚠ **2026-09-21 船长令改口径**（「统一为能够直接切换（自动取消当前活动）」）：这里**不再**列
 * 「开采 / 打捞 / 远征 / 掩护巡逻 / 返航途中」——前两类**可自动停**（点下去先停掉它再开线 + 统一日志），
 * 远征由 core 的统一判据直接拒，返航途中是锁定态里的一条（但在 core 侧判）。界面只保留"同一个手动
 * 工作位"那两条：它们**不算切换活动**，停掉会丢掉手上那一批 ⇒ 照旧硬拒、由玩家自己决定。
 * 真正的把关单点在 core（`activityGate`）。 */
function manualBuildNote(state: GameState): string | null {
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) {
    return tr("ui.Industry.025")
  }
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) {
    return tr("ui.Industry.026")
  }
  if (state.awayGalaxy !== null) return tr("ui.IndustryPage.010")
  return null
}

/** 一张可制造蓝图的展示卡（与精炼炉卡同款结构：运转名册逐线 = 劳动者 + 进度 + 取消；
 * 开工按钮 = 手动制造（主控亲自）/ AI 核心下拉 + AI 制造；已学会 + 材料够即可随时加开（制造费已于 2026-09-08 取消）） */
/**
 * **卡片的"实时指纹"**（2026-09-22 工业页卡顿修复第 3 步）。
 *
 * 为什么需要它：面板每秒被引擎心跳强刷 1~2 次，整棵卡片列表跟着重算/重提交（组装机 151 张 = 8298 节点，
 * 实测挂机就吃掉 35% 主线程、弱机直接吃满）。有了这张指纹 + 卡片上的 `memo`，
 * 心跳只让**自己这几个数真的变了**的那几张卡重渲染。
 *
 * ⚠ **改卡片时若新增了"随心跳变"的读数，必须同步加进这里**，否则那张卡会停在旧值上（界面不刷新）。
 * 下面的分节注释逐条对应卡面上的显示位置，方便对照：
 * - `mats`  ：材料行的「（仓库 N）」与 `is-short` 红标、以及按钮的可用性（`short`）；
 * - `needs` ：材料学折扣后的需求量与净收益估算（随科技变）；
 * - `runs`  ：制造线名册（条数 / 剩余 / 进度条 / 劳动者）；
 * - `loop`  ：循环制造的开关、已产批数、停因；
 * - `own`   ：产物「（×× N）」那一格；
 * - `bp`    ：已学会 / 蓝图书存量 / 一次性名额（`cap.kind`）——决定卡头徽标与底部按钮是哪一支；
 * - `mark`  ：收藏星标（子组件 `MarkStar` 自己也读 `engine.state`，不能漏）。
 */
export function cardLiveKeyOf(
  engine: GameEngine,
  blueprintId: string,
  materials: readonly MaterialNeed[],
  /** 该蓝图制造线的指纹（`制造线id.剩余秒.进度%.劳动者` 串起来）——由面板一次归并好传进来，
   *  免得 151 张卡各自把全部制造线算一遍（O(卡×线)） */
  runSig: string,
  /** 产物持有量（各卡不同，取自模型里的 `countOwned` 闭包） */
  ownedCount: number,
): string {
  const state = engine.state
  const mats = materials.map((m) => countWare(state, m.itemId)).join(',')
  const needs = materials.map((m) => matNeedCount(state, m.count)).join(',')
  const loop = manufacturingLoopOf(state, blueprintId)
  const singleUse =
    engine.ctx.blueprints.get(blueprintId)?.singleUse === true || engine.ctx.shipBlueprints.get(blueprintId)?.singleUse === true
  const bp = `${ownsBlueprint(state, blueprintId) ? 1 : 0}.${state.blueprintStock[blueprintId] ?? 0}.${recipeCapability(state, blueprintId, singleUse).kind}`
  const mark = isMarked(state, 'blueprints', blueprintId) ? 1 : 0
  return `${mats}#${needs}#${runSig}#${loop.on ? 1 : 0}.${loop.produced}.${loop.stopWhy}#${bp}#${mark}#${ownedCount}`
}

/**
 * **内容层联合 key → 界面文案**（2026-09-22 补：船长报障「筛选选项/标签页文案还有遗漏」）。
 *
 * `kindLabel` / `ownedWhere` 两张字段的**键**是内容层联合 key（'舰船' / '装备' / '零件' / '消耗品'、
 * '仓库' / '仓库＋机库'，判定用，见本文件 `inTab` 那几处 `l10n-keep`），但**有些卡片直接把 key 当文案渲染**
 * ⇒ 英文界面下会漏中文。这里做一次映射：**认得出的 key 走 `tr(id)`；认不出的一律原样返回**
 * （另有一批卡片的这两个字段本来就已经是 `tr(...)` 的产物 —— 例如市场/物品那两张，原样返回即可，别二次翻译）。
 * ⚠ 新增 key 时**同步在两张表里加一行**，否则又退回"英文露中文"。
 */
function kindLabelText(key: string): string {
  // l10n-keep：下面比较的是**内容层联合 key**（不是文案；译文由各分支的 tr(id) 给）
  if (key === '舰船') return tr('ui.labelsText.019')
  if (key === '装备') return tr('ui.MarketPage.178')
  if (key === '零件') return tr('ui.labelsText.001')
  if (key === '消耗品') return tr('ui.itemSubs.037')
  // 2026-09-26：插件产物单独一个档（`ui.itemSubs.042` = 「舰船插件」；
  // ⚠ 别用 `ui.itemSubs.041`——那是既有的「图纸」，我上一版误用过，界面会印成"图纸"）
  if (key === '舰船插件') return tr('ui.itemSubs.042')
  return key
}
function ownedWhereText(where: string): string {
  // l10n-keep：同上（key 比较，非文案）
  if (where === '仓库') return tr('ui.ItemsPage.001')
  if (where === '仓库＋机库') return tr('ui.Shipyard.002')
  return where
}

/**
 * 组装机 / 造船厂生产卡。**`memo` + `liveKey`**：父级每次心跳都会重渲染并算出新的 `liveKey`，
 * 只有指纹变了的那几张卡才真正重渲染（其余直接跳过 ⇒ 不重建 DOM、不触发布局）。
 */
export const BlueprintCard = memo(function BlueprintCard({
  engine,
  onToast,
  blueprintId,
  name,
  description,
  materials,
  buildSeconds,
  productLabel,
  productNode,
  kindLabel,
  productGlyph,
  productTone,
  productBase,
  /** 产物引用（2026-09-23 船长令：装备/舰船改显示"市场当前价格" ⇒ 卡面要能按 id 取行情） */
  productRef,
  /** 一次制造产出件数（利润率按整批算；缺省 1） */
  productUnits,
  countOwned,
  ownedWhere,
  onNeedMineral,
  onGotoMarket,
  onGotoWormhole,
  onGotoPlugExchange,
  onGotoShelf,
  highlighted,
  learnless,
  liveKey,
}: {
  engine: GameEngine
  onToast: ToastFn
  blueprintId: string
  name: string
  description: string
  materials: readonly MaterialNeed[]
  buildSeconds: number
  /** 产物标签（如 装备名 或 舰船名+属性） */
  productLabel: string
  /** 产物名悬浮卡（ModuleHover/ShipHover/ItemHover——查看成品属性的统一入口；无解析 = 纯文本） */
  productNode?: ReactNode
  /** 产物类别徽标：装备 / 舰船 */
  kindLabel: string
  /** 产物图标键（与图鉴行同口径：物品/弹药 = 物品 kind、装备 = 槽位、舰船 = 船族；卡名前的 SVG 小图标） */
  productGlyph: string
  /** 图标色覆盖（2026-09-20 零件两档：基础 = 冷钢蓝 / 高级 = 暖金；缺省 = toneOf(glyph)） */
  productTone?: string
  /** 产物市场现货基准价（×单次产出数量；0 = 市场无卡不显示估算） */
  productBase: number
  /** 产物引用（kind + refId）——装备/舰船按船长 2026-09-23 口径改显示**市场当前价格**时按它取行情；
   *  ⚠ 造船厂那张卡（`Shipyard.tsx`）暂时还没接上（缺产物 id）⇒ 该卡不渲染这一行，等接线 */
  productRef?: { kind: 'module' | 'ship' | 'item'; refId: string }
  /** **一次制造产出件数**（缺省 1）——利润率按"整批收入 = 单价 × 本值"算（船长 2026-09-24 报障：
   *  零件每批 10 件、消耗品每批 N 发，而 `materials` 是整批的料；只按一件算会算出大负数） */
  productUnits?: number
  /** 产物"自己有多少"的取数闭包（2026-09-10 船长：卡面产物行尾要显示"我拥有多少个成品"）
   *  ⚠ 收闭包而不是收数值：数值随心跳变，收进来会让上面那张 memo 每拍失效（见 `cardLiveKeyOf`） */
  countOwned: () => number
  /** 上面这个数字从哪儿数来的（仓库 / 装备库 / 机库），写进产物行括注 */
  ownedWhere: string
  /** 点需求材料：有精炼源 → 跳到精炼炉对应源矿石卡；无源 → 跳市场（2026-09-08 船长定） */
  onNeedMineral?: (itemId: string) => void
  /** 「市场求购蓝图书」跳市场：传该蓝图的市场商品键，市场页会搜到并展开它的行情详情
   *  （2026-09-14 船长：组装机只指路、不替玩家下任何单） */
  onGotoMarket?: (goodKey: string) => void
  /** 「去虫洞（遗迹打捞）」跳星图 · 出港 · 「扫描虫洞」页（船长 2026-09-14：虫洞专属图纸市场买不到，
   *  改跳虫洞；未达虫洞解锁声望时按钮禁用、不跳） */
  onGotoWormhole?: () => void
  /** 「前往章鱼人兑换」跳**章鱼人声望商店**（**2026-09-26 船长令**：插件图纸缺书时显示这个按钮，
   *  替代原先那条「✕ 无市场渠道」死路——插件图纸本来就不在市场卖） */
  onGotoPlugExchange?: () => void
  /** 「去书架」：切到蓝图书架并高亮这一本（2026-09-26 船长令：优化工业界面 → 优3 反向入口） */
  onGotoShelf?: (blueprintId: string) => void
  /** 被「蓝图书架 → 去组装机」定位到的那张卡（页面层同一套 `.app-belt-card.is-goto` 高亮） */
  highlighted?: boolean
  /** 2026-09-20 零件体系：隐式蓝图（基础零件）——无需学习即视为已学会，卡面显示「无需图纸」 */
  learnless?: boolean
  /** **实时指纹**（`cardLiveKeyOf`）：父级每拍算一次，只有它变了这张卡才重渲染（第 3 步卡顿修复） */
  liveKey?: string
}) {
  const state = engine.state
  // 该蓝图的全部制造线（同蓝图可多条；与精炼炉同资源多台运转同构）
  const runs = manufacturingRunViews(state, engine.ctx).filter((v) => v.blueprintId === blueprintId)
  const running = runs.length > 0
  const owned = learnless === true || ownsBlueprint(state, blueprintId)
  // 制造费已取消（2026-09-08）：耗时/缺口等 spec 计算的费用字段恒置 0
  const spec = { materials, buildSeconds, buildCostIsk: 0 }
  const buildMs = calcBuildDurationMs(state, engine.ctx, spec)
  const bookCount = state.blueprintStock[blueprintId] ?? 0
  // **一次性图纸**（2026-09-12 船长：「玩家无法学会，只能制造一次」）：
  // 不学习、每次开工消耗一本同名图纸；已永久学会时这本不消耗也不用（裁定「2乙」）
  const bpDef = engine.ctx.blueprints.get(blueprintId) ?? engine.ctx.shipBlueprints.get(blueprintId)
  const singleUse = bpDef?.singleUse === true
  const cap = recipeCapability(state, blueprintId, singleUse)
  /**
   * ⚠ **不能用 `cap.kind === 'ok'` 当"能造"**（2026-09-14 船长报障「组装机原先没有图纸时会跳转到市场
   * 求购的按钮怎么没了」）：`recipeCapability(..., singleUse=false)` 对**普通图纸恒返回 `ok`**
   * （core 注释：「普通蓝图恒 ok：只由 `startManufacturing` 的'是否已学会'把关」）⇒
   * `ownsBlueprint || cap.kind === 'ok'` **恒为真**，未学会的卡也会走上面"手动制造 + AI 工位"那一支，
   * 于是下面「市场求购蓝图书」的 else 分支**永远轮不到**（181 张图里 123 张普通图纸全被吃掉）。
   * ⇒ 改用 core 的**单点判定** `canStartBlueprint`（已学会 ⇒ true；一次性图纸另有"书架有书且名额未用尽"）。
   */
  const canBuild = canStartBlueprint(state, engine.ctx, blueprintId)
  /** 一次性图纸的缺口提示（`null` = 无需提示） */
  const oneTimeNote = !singleUse
    ? null
    : owned
      ? tr("ui.Industry.028")
      : cap.kind === 'exhausted'
        ? tr("ui.Industry.029")
        : cap.kind !== 'ok'
          ? tr("ui.Industry.030")
          : null
  const short = missingMaterials(state, engine.ctx, spec)
  /** 产物持有量：本卡渲染时现取（父级每拍算 `liveKey` 时也会取一次，同源口径） */
  const ownedCount = countOwned()
  const goodKey = bpGoodKey(engine, blueprintId)
  /**
   * **市场购买门槛**（只作"卡头状态"提示用）。⚠ **2026-09-14 船长：「组装机里，需要声望的才能启动组装机的
   * 限制删除」** —— 这一条**不再挡任何按钮**：
   * - 引擎侧本来就不看声望（`startManufacturing` / `canStartBlueprint` 只认"是否已学会 / 一次性图纸是否在书架"）；
   * - 界面侧原先在 `canBuild` 之后插了一支 `lock ? 「✕ 声望未达标」（disabled）`，它排在
   *   **「书架有书 ⇒ 就地学习」之前** ⇒ 手里已经拿着书（洞内打捞来的）也点不动、只看到"需要声望"。
   * 现在只留卡头那枚提示（告诉玩家"市场这条路暂时买不了、还差多少声望"），
   * **卡片永远给出下一步能做的事**：能造 ⇒ 制造；书架有书 ⇒ 学习；否则 ⇒ 市场求购（点到市场页自己看门槛）。
   * 市场买书本身的声望门槛**未动**（那是已确认的"声望用途"口径，船长本轮只点了组装机）。
   */
  const lock = !owned && goodKey ? marketLockedReason(state, engine.ctx, goodKey) : null
  /**
   * **这张图能不能在市场买到**（2026-09-14 船长：「虫洞专属的蓝图市场上没有卖，建议改为跳转虫洞。
   * 如果玩家声望不达标，就无法跳转」）：`playerBuyable === false`（只收不卖那批）＝ 买不到 ⇒
   * 「市场求购」是条死路（点进去只会看到"只收不卖"），改给「去虫洞」。
   */
  const bookBuyable = goodKey !== null && engine.ctx.marketGoods.get(goodKey)?.playerBuyable !== false
  const whBlueprint = isWormholeBlueprint(blueprintId)
  /**
   * **舰船插件图纸**（**2026-09-26 船长令**：「**没有蓝图的舰船插件组装机应该显示去商店兑换，
   * 点击后跳转到章鱼人声望商店。而不是无市场渠道（本来就不在市场购买）**」）。
   *
   * 判据 = 产物模块的 `slot === 'plug'`（与 `bpFilterKeysOf` 归那一档同源）。
   * 这类图**从来不在市场卖**（`playerBuyable: false`）⇒ 走不到下面的"求购"分支，
   * 原先会掉进兜底的「✕ 无市场渠道」死路 —— 船长点名的就是它。
   */
  const plugBlueprint =
    engine.ctx.modules.get(engine.ctx.blueprints.get(blueprintId)?.moduleId ?? '')?.slot === 'plug'
  /** 虫洞解锁声望闸（与扫描虫洞页同一本账：**累计**协会声望 ≥ `WORMHOLE_SCAN_UNLOCK_STANDING`；
   *  2026-09-26 船长令「所有声望门槛改读累计声望」⇒ 走唯一入口 `standingOf`，不直读可支配那本） */
  const whStanding = standingOf(state, DSI_FACTION_ID)
  const whUnlocked = whStanding >= WORMHOLE_SCAN_UNLOCK_STANDING
  // 每卡独立的 AI 核心选择（一枚核心驱动一条线；核心库存被占用后自动回落可用类型）
  const [coreSel, setCoreSel] = useState<AiCoreType>(() => bestAiCoreOf(state) ?? 'basic')
  const usableCores = CORE_ORDER.filter((t) => countAiCore(state, t) > 0)
  const core = usableCores.includes(coreSel) ? coreSel : (usableCores[0] ?? null)
  const manualNote = manualBuildNote(state)

  /** 求购 = **只跳转、不下单**（2026-09-14 船长：「组装机求购蓝图应该跳转到市场对应的订单详细。
   *  而不是直接市场价下订单」）——到市场页会自动搜到该蓝图并展开它的行情详情（与舰船页/物品页
   *  「去市场」同一个入口 `onGotoMarket`，全仓一处口径）；买不买、按什么价挂单由玩家在详情里自己定。 */
  function handleGotoMarket(): void {
    if (!goodKey) {
      onToast(tr("ui.Industry.100"), true)
      return
    }
    if (!onGotoMarket) {
      onToast(tr("ui.Industry.101"), true)
      return
    }
    onGotoMarket(goodKey)
  }

  /**
   * **去虫洞（遗迹打捞）**（船长 2026-09-14）——虫洞专属图纸（`bp-wh-*` / `sbp-wh-*`）市场只收不卖、
   * 买不到，所以指路"真正能拿到它的地方"：星图 · 出港 · **扫描虫洞**页（进洞 → 遗迹 / 图纸货柜 / 安全货柜）。
   * **声望不达标 ⇒ 不跳**（按钮本身也置灰；这里再兜一道，防键盘/程序化触发）。
   */
  function handleGotoWormhole(): void {
    if (!whUnlocked) {
      onToast(tr("ui.Industry.102", { WORMHOLE_SCAN_UNLOCK_STANDING: WORMHOLE_SCAN_UNLOCK_STANDING, whStanding: whStanding }), true)
      return
    }
    if (!onGotoWormhole) {
      onToast(tr("ui.Industry.103"), true)
      return
    }
    onGotoWormhole()
  }

  /** 书已在书架（未学习）：就地学习——与「蓝图书架」的「学习」同一个引擎出口与话术（不花钱、不占制造位） */
  function handleLearnFromShelf(): void {
    const r = engine.learnBlueprintAt(blueprintId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Industry.130'), true)
    else onToast(tr("ui.Industry.104"))
  }

  function runWith(worker: AiCoreType | 'pilot'): void {
    const r = engine.startManufacturingAt(blueprintId, worker)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.Industry.131'), true)
      return
    }
    onToast(
      worker === 'pilot'
        ? tr("ui.Industry.031")
        : tr("ui.Industry.105", { p1: aiCoreName(worker) }),
    )
  }

  function handleCancel(runId: number): void {
    const r = engine.cancelManufacturingAt(runId)
    if (!r.ok) onToast(r.error ?? tr('ui.Industry.132'), true)
    else
      onToast(
        // 2026-09-20 船长：「一次性蓝图的制造取消后返还玩家蓝图」⇒ 本条提示把{tr('ui.Industry.143')}说清（一次性图纸才有）
        tr('ui.Industry.157'),
      )
  }

  // 2026-09-10 船长定：循环制造（开关 + 目标批数）从逐条制造线**上移到整张生产卡**——
  // 一张卡一个开关，作用于该卡全部制造线（含主控亲自那条），打开后新开的线自动继承；
  // 目标批数 = 全卡合计；「关→开」= 开一批新循环（合计与停因清零）。判定/计数都在 core。
  const loop = manufacturingLoopOf(state, blueprintId)
  const [goalDraft, setGoalDraft] = useState('')
  /**
   * **草稿引用**（2026-09-17 报障修复）：「目标批数」原先**只在回车 / 失焦那一刻提交**，
   * 而**程序化跳页**（通讯「前往」、教程跳转、任务卡跳转）**不产生失焦** ⇒ 玩家刚打的数字
   * 从未提交，切回来输入框是空的、循环开关还开着 ⇒ **变成"无限生产"**（真浏览器复现：
   * 打字→不回车→合成点击导航⇒落盘 goal=null；鼠标点导航则因 mousedown 先失焦而侥幸不丢）。
   * 这里把最新草稿放进 ref，**卡片卸载时补一次提交**（切页/切标签都会卸载卡片）⇒ 打过就一定生效。
   * 回车/失焦仍即时提交（口径不变，见输入框 title）；没打字（草稿为空）时**不做任何动作**，
   * 故不会凭空清掉已有目标、也不会在 StrictMode 的"挂载即卸载"里误提交。
   */
  const goalDraftRef = useRef('')
  goalDraftRef.current = goalDraft
  /** 「这一版草稿是玩家打出来的」——只有它为真，卸载时才补提交；任何一次正式提交后即清账 */
  const goalTouchedRef = useRef(false)
  useEffect(
    () => () => {
      if (!goalTouchedRef.current) return
      const n = Number.parseInt(goalDraftRef.current, 10)
      engine.setManufacturingLoopAt(blueprintId, true, Number.isFinite(n) && n > 0 ? n : null)
    },
    [engine, blueprintId],
  )
  function commitLoop(on: boolean, goalText: string): void {
    goalTouchedRef.current = false
    const n = Number.parseInt(goalText, 10)
    const goal = Number.isFinite(n) && n > 0 ? n : null
    const r = engine.setManufacturingLoopAt(blueprintId, on, on ? goal : null)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Industry.133'), true)
  }

  const feedTxt = short.length > 0 ? short.join('；') : ''
  const manualTitle =
    manualNote ??
    feedTxt ??
    (running
      ? tr("ui.Industry.032")
      : tr("ui.Industry.033"))
  const aiTitle = feedTxt
    ? feedTxt
    : core
      ? running
        ? tr("ui.Industry.034")
        : tr("ui.Industry.035")
      : tr("ui.Industry.036")

  return (
    <div className={`app-belt-card is-assembler${highlighted ? ' is-goto' : ''}`}>
      <div className="app-belt-head">
        <span className="app-belt-name">
          <RowGlyph glyph={productGlyph} tone={productTone} /> {name}
          {running ? (
            <em className="app-belt-flag is-run">
              {kindLabel === '舰船' ? tr("ui.Industry.037") : tr("ui.Industry.038")} {/* l10n-keep：kindLabel 是内容层联合 key（不是文案），渲染处照 id 取词 */}
              {runs.length > 1 ? ` ×${runs.length}` : ''}
            </em>
          ) : null}
        </span>
        {/* 卡头右侧：标记星标（2026-09-10 船长） + 状态徽标（已学会/蓝图书存量/市场门槛提示/类型）
            ⚠ 「市场门槛」这枚**只是提示**（2026-09-14 船长：组装机不再用声望挡启动）——它不挡任何按钮 */}
        <span className="app-belt-head-right">
          <MarkStar engine={engine} kind="blueprints" id={blueprintId} />
          {learnless ? (
            <span className="app-chip" title={tr('ui.Industry.144')}>
              {tr('ui.Industry.145')}
            </span>
          ) : owned ? (
            <span className="app-chip">{tr('ui.Industry.039')}</span>
          ) : singleUse && bookCount > 0 ? (
            <span className="app-chip is-stock" title={tr("ui.Industry.040")}>
              {tr("ui.Industry.041")}{bookCount}
            </span>
          ) : bookCount > 0 ? (
            <span className="app-chip">{tr("ui.Industry.042")}{bookCount}</span>
          ) : lock ? (
            <span className="app-chip is-exotic" title={tr("ui.Industry.107", { lock: lock })}>
              ✕ {lock}
            </span>
          ) : (
            <span className="app-chip">{kindLabelText(kindLabel)}</span>
          )}
        </span>
      </div>
      <div className="app-belt-desc">{description}</div>

      <div className="app-belt-ore">
        {tr("ui.Handbook.013")}{productNode ?? productLabel}
        <span className="app-dim" title={tr("ui.Industry.108", { ownedWhere: ownedWhereText(ownedWhere) })}>
          （{ownedWhereText(ownedWhere)} {ownedCount.toLocaleString('zh-CN')}）
        </span>
        {running ? (
          <>
            {' '}
            {tr('ui.Industry.121', { n: runs.length })} {tr("ui.Industry.043")} {formatDurationMs(Math.min(...runs.map((v) => v.remainingMs)))} {tr("ui.Industry.044")}
          </>
        ) : (
          <>{tr('ui.Industry.122', { d: formatDurationMs(buildMs) })}{tr("ui.Industry.045")}</>
        )}
      </div>
      <ul className="app-bp-mats">
        {materials.map((need) => {
          const needCount = matNeedCount(state, need.count) // 材料学折扣后的实际需求
          const have = countWare(state, need.itemId)
          const enough = have >= needCount
          const matName = engine.ctx.items.get(need.itemId)?.name ?? need.itemId
          // 空闲态才标红缺口；制造中仓库余量只影响「加开一条线」，红色会误读成故障
          return (
            <li key={need.itemId} className={`app-bp-mat${!enough && !running ? ' is-short' : ''}`}>
              {matName} ×{needCount.toLocaleString('zh-CN')}
              {needCount !== need.count ? (
                <span className="app-dim">{tr("ui.Industry.046")}{need.count.toLocaleString('zh-CN')}{tr('ui.Industry.123')}</span>
              ) : null}
              <span className="app-dim">{tr("ui.IndustryPage.029")} {have.toLocaleString('zh-CN')}）</span>
              {onNeedMineral ? (
                (() => {
                  /* 2026-09-22 船长令：「组装机和造船厂需要零件时，提示不是去组装机，而是去市场」⇒
                     「希望提示玩家去组装机生产零件，不要提示去市场」＋「高级零件依旧去相应的组装机」。
                     三支（优先级从上到下）：有精炼源 ⇒ 去精炼炉 · **能在这台机器上造出来（如零件）⇒ 去组装机** ·
                     既炼不出也造不出 ⇒ 去市场。文案按 §十三.5 不写原因解释（旧文案那句「无法经精炼炉产出」
                     属解释，已随本次改写删掉）。 */
                  const srcs = refineSourcesOf(engine, need.itemId)
                  const srcName = (id: string): string => engine.ctx.items.get(id)?.name ?? id
                  const madeBy = blueprintProducingItem(engine.ctx, need.itemId)
                  const title =
                    srcs.length > 0
                      ? tr('ui.Industry.109', { matName: matName, p2: srcs.map(srcName).join(tr('ui.MatterTechTab.017')) })
                      : madeBy
                        ? tr('ui.Industry.155', { matName: matName, p2: madeBy.name })
                        : tr('ui.Industry.110', { matName: matName })
                  return (
                    <span
                      className="app-bp-mat-act"
                      role="button"
                      tabIndex={0}
                      title={title}
                      onClick={() => onNeedMineral?.(need.itemId)}
                    >
                      {srcs.length > 0
                        ? tr('ui.Industry.047')
                        : madeBy
                          ? tr('ui.Industry.154')
                          : tr('ui.Industry.048')}
                    </span>
                  )
                })()
              ) : null}
            </li>
          )
        })}
      </ul>
      <div className="app-belt-econ">
        <div>
          {tr("ui.Industry.049")}
          {running && feedTxt ? <span className="app-dim">{tr("ui.Industry.050")}</span> : null}
        </div>
        {/**
         * **产物读数换口径**（**2026-09-23 船长令**）：「各个有收益的卡牌上写着的收入预估…会严重误导玩家……
         * **如果是装备和舰船的话，就单纯显示市场当前价格**」⇒ 原「净 ≈N 信用点/h」（产物基准价 − 材料收价
         * 折算每小时）**整段删掉**，改为**产物当前行情价**一行（取数与市场页同源，见 `ui/yieldView.tsx`）。
         */}
        {productRef !== undefined
          ? (() => {
              const price = marketPriceOf(state, engine.ctx, productRef.refId)
              /** 材料成本按**当前行情价**（取不到行情的材料回落物品基准价），与产物行情同一把尺 */
              const matCost = materials.reduce(
                (sum, m) =>
                  sum +
                  matNeedCount(state, m.count) *
                    (marketPriceOf(state, engine.ctx, m.itemId) ?? engine.ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0),
                0,
              )
              /**
               * **利润率按"整批"算**（船长 2026-09-24 报障：「组装机是一次性生产 10 个的，现在的利润只计算
               * 一个」）：`materials` 是整批的料 ⇒ 收入必须 `单价 × 一次产出件数`（零件 10 / 消耗品 N 发 /
               * 装备与舰船 1）。卡面显示的行情价仍是**每单位**（与市场页折线图同尺）。
               */
              return (
                <GoodsLine
                  name={productLabel}
                  price={price}
                  marginPct={marginPctOf(price, matCost, productUnits ?? 1)}
                  unitsPerRun={productUnits ?? 1}
                />
              )
            })()
          : null}
      </div>

      <div className="app-belt-actions">
        {/* 循环制造（2026-09-10 船长定：开关与目标批数**单独领出来挂在生产卡上**，不再逐线各一份）——
            作用于本卡全部制造线（含主控亲自那条），新开的线自动继承；目标批数 = 全卡合计口径（2026-09-18 船长定：按「批」不按件） */}
        {/* 一次性图纸不循环**（2026-09-12 船长：「只能制造一次」）⇒ 该开关对它不适用，整块不渲染 */}
        {(owned || running) && !singleUse ? (
          <div className="app-belt-loop">
            <label
              className="app-toggle"
              title={tr("ui.Industry.112", { p1: loop.on ? tr("ui.Industry.055") : tr("ui.Industry.056") })}
            >
              <input
                type="checkbox"
                className="app-toggle-input"
                checked={loop.on}
                onChange={(e) => commitLoop(e.target.checked, e.target.checked ? (goalDraft || (loop.goal > 0 ? String(loop.goal) : '')) : '')}
              />
              <span className="app-toggle-track" aria-hidden="true" />
              <span className="app-toggle-label">{tr("ui.Industry.057")}</span>
            </label>
            {loop.on ? (
              <span className="app-mf-goal">
                {tr("ui.Industry.058")}
                <input
                  type="number"
                  min={1}
                  className="app-mf-goal-input"
                  placeholder="∞"
                  value={goalDraft !== '' ? goalDraft : loop.goal > 0 ? String(loop.goal) : ''}
                  onChange={(e) => {
                    goalTouchedRef.current = true
                    setGoalDraft(e.target.value)
                  }}
                  onBlur={(e) => {
                    setGoalDraft('')
                    commitLoop(true, e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setGoalDraft('')
                      commitLoop(true, (e.target as HTMLInputElement).value)
                    }
                  }}
                  title={tr("ui.Industry.059")}
                />
                {tr('ui.MarketPage.117')}<em className="app-dim">{tr("ui.Industry.060")}</em>
              </span>
            ) : null}
            {loop.produced > 0 ? <span className="app-mf-made">{tr("ui.Industry.061")} {loop.produced.toLocaleString('zh-CN')} {tr('ui.MarketPage.117')}</span> : null}
            {loop.stopWhy.length > 0 ? <span className="app-mf-why">{tr("ui.Industry.062")}{loop.stopWhy}</span> : null}
            <span className="app-dim app-mf-note">
              {tr("ui.Industry.063")}{runs.length > 0 ? tr("ui.Industry.113", { p1: runs.length }) : ''}
            </span>
          </div>
        ) : null}
        {/* 该蓝图逐条制造线名册（每行：劳动者 + 剩余 + 进度 + 取消）——精炼炉运转名册同款结构；
            2026-09-10 起循环开关已在卡片级，行内不再各带一份 */}
        {runs.length > 0 ? (
          <div className="app-belt-workers" style={{ marginTop: 'var(--wui-sp-2)' }}>
            {runs.map((v) => (
              <span key={v.id} className="app-belt-worker">
                <span
                  className="app-belt-worker-name"
                  // l10n-keep：下面比较用的 kindLabel（'舰船'/'装备'/'消耗品'）是**内容层联合 key**，不是文案
                  title={tr("ui.Industry.114", { p1: formatDurationMs(v.durationMs), p2: kindLabel === '舰船' ? tr("ui.Industry.064") : tr("ui.Industry.065"), p3: v.worker === null ? tr("ui.Industry.066") : '' })}
                >
                  {v.worker === null ? tr("ui.Industry.067") : v.worker === 'pilot' ? tr("ui.Industry.068") : tr("ui.Industry.115", { p1: v.workerLabel })}
                  {tr('ui.Industry.137', { p1: formatDurationMs(v.remainingMs) })}
                </span>
                <span className="app-progress-mini" title={tr("ui.Industry.116", { p1: v.percent })}>
                  <i style={{ width: `${v.percent}%` }} />
                </span>
                <button
                  className="app-btn is-small is-warn"
                  onClick={() => handleCancel(v.id)}
                  title={tr('ui.Industry.147')}
                >
                  {tr("ui.Industry.070")}
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {canBuild ? (
          <>
            <button
              className="app-btn is-small is-primary"
              disabled={manualNote !== null || short.length > 0}
              title={oneTimeNote ?? manualTitle}
              onClick={() => runWith('pilot')}
            >
              {tr("ui.Industry.071")}
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
                    : tr("ui.Industry.072")
                }
              >
                {usableCores.length === 0 ? (
                  <option value="">{tr("ui.ShipPage.070")}</option>
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
                disabled={!core || short.length > 0}
                title={oneTimeNote ?? (core ? aiTitle : tr("ui.IndustryPage.055"))}
                onClick={() => core && runWith(core)}
              >
                {tr("ui.Industry.073")}
              </button>
            </div>
          </>
        ) : !singleUse && bookCount > 0 ? (
          /* 书已在书架（尚未学习）：就地学习（2026-09-14 船长裁定「乙」）——与「蓝图书架」的「学习」
             同一个引擎出口与话术；书不消耗、也不占制造位。
             ⚠ 顺序上提到「去哪买/去哪捞」之前：手里有书就该先能学（这正是上一批"拿着书却只看到需要声望"的坑）。 */
          <>
            <button
              className="app-btn is-small"
              title={tr("ui.Industry.117", { bookCount: bookCount })}
              onClick={handleLearnFromShelf}
            >
              {tr("ui.Industry.074")}
            </button>
            {/**
             * **反向入口「去书架」**（**2026-09-26 船长令**：「优化工业界面」→ 采纳"优3"）。
             * 书架那边一直有「去组装机」，反向没有 ⇒ 玩家在组装机看到"手上有 2 本书"却只能自己切子页。
             * 落款是**次级按钮**（主行动仍是左边的「学习」），点了切到蓝图书架并把这一本高亮居中。
             */}
            {onGotoShelf ? (
              <button
                className="app-btn is-small"
                title={tr('ui.IndustryPage.132')}
                onClick={() => onGotoShelf(blueprintId)}
              >
                {tr('ui.IndustryPage.131')}
              </button>
            ) : null}
          </>
        ) : plugBlueprint ? (
          /**
           * **舰船插件图纸 ⇒ 去声望商店兑换**（**2026-09-26 船长令**：「**没有蓝图的舰船插件组装机应该
           * 显示去商店兑换，点击后跳转到章鱼人声望商店。而不是无市场渠道（本来就不在市场购买）**」
           * ＋（同日改口）「**组装机这边不应该是前往章鱼人兑换，而是前往声望商店兑换**」）。
           *
           * 为什么必须排在这里：这类图的产物插件**从来不在市场卖**（`playerBuyable: false`）⇒
           * `bookBuyable` 恒假 ⇒ 原先会掉进最后一支兜底的「**✕ 无市场渠道**」死路（船长点名的就是它）。
           * 落款用 `ui.IndustryPage.126`（「前往声望商店兑换」）——**与通讯里那句分开**：
           * 通讯是章鱼人主动发信、口吻是"来我这儿"，组装机是玩家在工业页看图纸 ⇒ 说"声望商店"更准。
           */
          <button
            className="app-btn is-small is-primary"
            title={tr('ui.IndustryPage.117')}
            onClick={onGotoPlugExchange}
          >
            {tr('ui.IndustryPage.126')}
          </button>
        ) : whBlueprint ? (
          /**
           * **虫洞专属图纸 ⇒ 去虫洞（遗迹打捞）**（船长 2026-09-14：「虫洞专属的蓝图市场上没有卖，建议改为
           * 跳转虫洞。**如果玩家声望不达标，就无法跳转**」）——这类图（`bp-wh-*` / `sbp-wh-*`）的市场行是
           * "只收不卖"，点「市场求购」进去也买不到 ⇒ 死路；改成跳**星图 · 出港 · 扫描虫洞**（真正能拿图的地方：
           * 洞内遗迹打捞 / 图纸货柜 / 安全货柜），并以**虫洞解锁声望**为闸（未达标一律禁用 + 写明还差多少）。
           */
          <button
            className={`app-btn is-small${whUnlocked ? ' is-primary' : ''}`}
            disabled={!whUnlocked}
            title={
              whUnlocked
                ? tr("ui.Industry.075")
                : tr("ui.Industry.118", { WORMHOLE_SCAN_UNLOCK_STANDING: WORMHOLE_SCAN_UNLOCK_STANDING, whStanding: whStanding })
            }
            onClick={handleGotoWormhole}
          >
            {whUnlocked ? tr("ui.Industry.076") : tr("ui.Industry.077")}
          </button>
        ) : singleUse && bookBuyable ? (
          /* 一次性图纸（2026-09-14 船长：「组装机的一次性蓝图制造如果没有蓝图，也改为跳转市场，
             和其他组装机一样」）——**在市场流通的一次性图纸**（`sbp-once-*`：稀有订单层 / 奇货）
             缺书与名额已用尽都只差"再拿一张图" ⇒ 一律指路市场；买不买、按什么价挂单由玩家在详情里定。 */
          <button
            className="app-btn is-small"
            title={
              cap.kind === 'exhausted'
                ? tr("ui.Industry.078")
                : tr("ui.Industry.079")
            }
            onClick={handleGotoMarket}
          >
            {tr("ui.Industry.080")}{cap.kind === 'exhausted' ? tr("ui.Industry.081") : ''}
          </button>
        ) : singleUse ? (
          /* 一次性图纸**不在市场流通**的（既非虫洞线、市场目录里也没有它）：写清唯一来源，不挂死路按钮 */
          <button
            className="app-btn is-small"
            disabled
            title={
              cap.kind === 'exhausted'
                ? tr("ui.Industry.082")
                : tr("ui.Industry.083")
            }
          >
            {cap.kind === 'exhausted' ? tr("ui.Industry.084") : tr("ui.Industry.085")}
          </button>
        ) : bookBuyable ? (
          /* 求购 = 只跳市场行情详情，不替玩家下单（2026-09-14 船长口径） */
          <button className="app-btn is-small" title={tr("ui.Industry.086")} onClick={handleGotoMarket}>
            {tr("ui.Industry.080")}
          </button>
        ) : (
          /* 市场目录里根本没有这张图（可获得的渠道不在市场）：别给死路按钮 */
          <button className="app-btn is-small" disabled title={tr("ui.Industry.087")}>
            {tr("ui.Industry.088")}
          </button>
        )}
      </div>
    </div>
  )
})

/**
 * **组装机目录条目**（2026-09-22 第 3 步）。
 * ⚠ 这里**只放"目录级"的字段**（蓝图/产物/价格/排序键），**不许放随引擎心跳变的字段**——
 * 一旦放进来，`useMemo` 出来的模型每拍都会换新引用，卡片上的 `memo` 就永远击穿。
 * 实时数（材料库存、制造线、循环、持有量、徽标）统一走 `cardLiveKeyOf` 的指纹 + 卡片自己现取。
 */
interface ManuItem {
  id: string
  kindLabel: string
  /** 二级子筛选键（装备 = 产物功能分组 / 舰船 = t<级别> / 消耗品 = 产物大类；与 itemSubs 单点同键） */
  subKey: string
  productGlyph: string
  /** 图标色覆盖（零件两档分色；缺省 = toneOf(glyph)） */
  productTone?: string
  name: string
  description: string
  materials: readonly MaterialNeed[]
  buildSeconds: number
  productLabel: string
  productNode: ReactNode
  productBase: number
  /** 产物"自己有多少"的**取数闭包**（装备库 / 物品仓库 / 舰船仓库口径由模型定，数值每次现取） */
  countOwned: () => number
  /** 产物来处（仓库 / 装备库 / 机库名）——卡面「（×× N）」用 */
  ownedWhere: string
  bookPrice: number
  /** 排序用：**产物唯一键**（`ship:`/`module:`/`item:` + 产物 id）——2026-09-14 船长：
   *  「一次性图纸应该和原图纸放在一起」⇒ 同产物成组，组内原图纸在前 */
  productKey: string
  /** 产物引用（与 `productKey` 同义，拆成 kind + refId 供卡面取行情；见卡片 props 注释） */
  productRef?: { kind: 'module' | 'ship' | 'item'; refId: string }
  /** **一次制造产出件数**（缺省 1；零件 = 10、消耗品 = N 发）——供卡面按整批算利润率（见卡片 props 注释） */
  productUnits?: number
  /** 排序用：本卡是否为**一次性图纸**（`singleUse`） */
  singleUse: boolean
  /** 2026-09-20 零件体系：隐式蓝图（基础零件无需学习） */
  learnless: boolean
  /** 2026-09-20 零件体系：零件档位（排序用：基础零件默认在前） */
  partTier?: 'basic' | 'advanced'
}

export function ManufacturingPanel({
  engine,
  onToast,
  onNeedMineral,
  onGotoMarket,
  onGotoWormhole,
  onGotoPlugExchange,
  onGotoShelf,
  plugExchangeFocus,
  focusBlueprintId,
}: {
  engine: GameEngine
  onToast: ToastFn
  onNeedMineral?: (itemId: string) => void
  /** 「市场求购蓝图书」跳市场（传市场商品键）；由工业页透传 App 的「去市场」入口 */
  onGotoMarket?: (goodKey: string) => void
  /** 「去虫洞（遗迹打捞）」跳星图 · 出港 · 扫描虫洞（船长 2026-09-14：虫洞专属图纸市场买不到） */
  onGotoWormhole?: () => void
  /** 「前往章鱼人兑换」跳**章鱼人声望商店**（2026-09-26 船长令：插件图纸缺书时走这里） */
  onGotoPlugExchange?: () => void
  /** 「去书架」反向入口（2026-09-26：优3）——由工业页透传，点了切到蓝图书架并高亮那一本 */
  onGotoShelf?: (blueprintId: string) => void
  /** 兑换窗口开过的次数（自增序号）：一开就切到「舰船插件」档（2026-09-26 船长令：
   *  跳转要"跳转到舰船插件的筛选内"） */
  plugExchangeFocus?: number
  /** 蓝图书架「去组装机」的定位目标（蓝图 id）：本面板会**先清掉三级筛选**再高亮那张卡 */
  focusBlueprintId?: string | null
}) {
  const state = engine.state
  const runViews = manufacturingRunViews(state, engine.ctx)
  const [tab, setTab] = useState<ManuTabKey>('all')
  /** 视口懒挂载的"首屏块 + 空闲补块"两张尺寸（见 `.app-belt-grid` 那处的说明；船长 2026-09-27 批准） */
  const EAGER_FIRST = 12
  const idleChunk = useIdleChunk(12)
  /**
   * **占位高自适应**（2026-09-27 实测补的）：占位高若与真卡高差太多，网格**行高会随挂载"塌一下"**
   * （一行 4 张，行高 = 该行最高那张 ⇒ 占位偏高时整行先高后矮 = 滚动中跳动）。
   * 用常量 523（CSS 那条 `contain-intrinsic-size` 的旧实测值）在 1600×900 下实测真卡只有 **394** ⇒ 偏高 33%。
   * 故首屏块挂上后**量一次真卡高中位数**，之后的占位一律按它来（同一批卡同版式 ⇒ 比常量准得多）。
   */
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [cardH, setCardH] = useState(ASSEMBLER_CARD_MIN_H)
  useEffect(() => {
    const g = gridRef.current
    if (g === null) return
    const hs = [...g.querySelectorAll<HTMLElement>('.app-belt-card')]
      .map((el) => Math.round(el.getBoundingClientRect().height))
      .filter((h) => h > 80)
    if (hs.length < 4) return
    hs.sort((a, b) => a - b)
    const med = hs[Math.floor(hs.length / 2)] ?? ASSEMBLER_CARD_MIN_H
    setCardH((prev) => (Math.abs(prev - med) >= 8 ? med : prev))
  }, [idleChunk])
  const { t } = useL10n()
  /**
   * **「蓝图」维度**（原「学会」行，**2026-09-26 船长令**：「**将造船的一次性蓝图筛选移动到学会的筛选内，
   * 并将学会的筛选改名为蓝图。删除原先的图纸筛选**」）。
   *
   * 口径变化：原先拆成两行——第一行「学会：全部/已学会/未学会」、第三行「图纸：全部/永久/一次性」
   * （第三行还**只在选了子类后才出现**）。现在合并成一个维度，键仍是 `BlueprintLearnKey` 的两轴组合：
   * - `learned` / `unlearned`：学会那一轴（原样）；
   * - `learned-single` / `unlearned-single`：**一次性图纸**那一轴并入（原来在第三行选的"一次性"）；
   * - `SUB_ALL`：全部。
   * ⚠ 合并后**不再依赖子类**（原第三行"选完子类才出现"的级联随之取消）⇒ 少一次点击、少一行。
   * ⚠ 落款文案见 `BLUEPRINT_LEARN_TABS`（那一行已改名「蓝图」）。
   */
  const [learn, setLearn] = useState<BlueprintLearnKey>(SUB_ALL)
  /**
   * **组装机搜索栏**（船长 2026-09-19：「也给精炼炉和组装机添加搜索栏」；追问后定范围 =
   * **名称 ＋ 产物/材料 ＋ 说明**）：搜蓝图名、产物名（含产物参数行）、说明，以及**材料名**
   * （"哪张图纸要用这个材料"也搜得到）。与筛选取「与」。
   */
  const [kw, setKw] = useState('')
  const kq = kw.trim().toLowerCase()
  // 二级子筛选（2026-09-11 船长）；切一级标签即回「全部子类」（与市场页 changeKind 同款口径）
  const [sub, setSub] = useState<string>(SUB_ALL)
  /**
   * ⚠ **2026-09-26：第三级「图纸」筛选（一次性/永久）整维已删除**（船长令：「**删除原先的图纸筛选**」）——
   * "一次性/永久"那一轴并进了上面的「蓝图」维度（`learn`），本维连同它的状态与现算表 `usesShown` 一起退场
   * （原注释留档：那一维**只在选了子类后才出现**、且只剩「全部」一项时整行隐藏）。
   */
  /**
   * **「仅看可造」开关**（**2026-09-26 船长令**：优化工业界面）。
   * 与门类/子类那些"选完就收窄"的维度不同：它是**并列的布尔开关**（与「学会」同为属性行），
   * 关着 = 不过滤（默认）；开着 = 只留"现在就能开工"的图纸（判据 = 卡片按钮同一把尺 `canStartNow`）。
   */
  const [craftableOnly, setCraftableOnly] = useState(false)
  /**
   * **书架跳过来的定位**（船长 2026-09-14）：先把三级筛选全部复位（否则目标卡可能正被筛掉 ⇒ 跳过去空白），
   * 高亮由页面层的 `.app-belt-card.is-goto` + 居中滚动负责（与「去精炼」同一套）。
   */
  useEffect(() => {
    if (!focusBlueprintId) return
    setTab('all')
    setSub(SUB_ALL)
    setLearn(SUB_ALL) // 「蓝图」维度也要复位：否则目标卡可能正被「已学会/未学会…」那四档筛掉
  }, [focusBlueprintId])

  /**
   * **「前往章鱼人兑换」之后落到「舰船插件」档**（**2026-09-26 船长令**：跳转要"跳转到舰船插件的
   * 筛选内"）。触发信号 = `plugExchangeFocus`（自增序号，来源两处：组装机那张卡的按钮、首匣通讯的
   * 「前往」）——**只切档、不复位二级**（那一档本来就没有子筛选）。
   */
  useEffect(() => {
    if (!plugExchangeFocus) return
    // 2026-09-26 船长令「不可用的筛选项隐藏」：档都藏了，自然不能再切进去（正常路径下两个入口
    // 都只在"已解锁"时可达——组装机那张卡的按钮与首匣通讯；这条是防御，防日后入口前移）
    if (!plugCraftUnlockedOf(engine.state)) return
    setTab('plug')
    setSub(SUB_ALL)
  }, [plugExchangeFocus, engine])

  /**
   * **目录模型只在"目录本身"变化时重建**（2026-09-22 工业页卡顿修复第 3 步 · 单点在 `cardLiveKeyOf`）。
   *
   * 原先每次渲染（= 每秒 1~2 次引擎心跳）都把 151 条重建一遍、并**当场造 `productNode` ReactNode**
   * ⇒ 每张卡的 props 每次都是新引用 ⇒ 卡片上的 `memo` 必被击穿（等于白加）。
   * 依赖只有目录上下文与蓝图表：`engine.ts` 里这两个字段**只在换语言时一起重建**
   * （`buildSimContext(locale)` + `overlayList(...)`）⇒ 语言相关的卡面字也跟着一起更新。
   *
   * ⚠ **模型里不许放"随心跳变"的字段**（见 `ManuItem` 的说明）：放进来这张 memo 就每拍失效。
   */
  const items = useMemo<ManuItem[]>(() => {
    const out: ManuItem[] = []
  /** 该船型的**总持有**（2026-09-14 舰船仓库批：组装机产出先进仓库 ⇒ 读口径改走 core 单点
   *  `shipOwnedCount` = 舰船仓库 ＋ 在役舰队；原先只数机库，会让"仓里堆着 3 艘"显示成 0）
   *  ⚠ 2026-09-20 零件体系：舰船蓝图已迁入**造船厂**子页（`panels/Shipyard.tsx`），本面板不再渲染舰船。 */
  const pushEquip = (): void => {
    for (const bp of engine.blueprints) {
      if (bp.itemId !== undefined) continue // 弹药等物品蓝图单独分类
      const moduleDef = engine.ctx.modules.get(bp.moduleId!)
      const prodLabel = moduleDef?.name ?? bp.moduleId!
      // 产物名金色（按类型分色作废，2026-09-13 船长）
      const prodText = <span className="app-gold">{prodLabel}</span>
      const moduleId = bp.moduleId!
      /**
       * 🔴 **舰船插件蓝图归「舰船插件」档，不进「装备」档**（**2026-09-26 船长报障**：
       * 「组装机处也没有舰船插件的门类筛选，反而是多出一个错误的图纸筛选」）。
       *
       * 根因：本函数原先**无条件**把所有"产物是装备"的蓝图都标 `kindLabel = '装备'`，
       * 而一级门类判定 `inTab` 那条三元链里没有 `plug` 分支 ⇒ 选「舰船插件」时落到 else
       * 只认 `'消耗品'` ⇒ **该档一张卡都没有**（看着就是一个空档）。
       * 现在：插件走自己的键（与 `bpFilterKeysOf` 返回的 `tab: 'plug'` 同源），subKey 留空
       * （插件档不二级分类）。
       */
      const isPlugBp = moduleDef?.slot === 'plug'
      out.push({
        id: bp.id,
        kindLabel: isPlugBp ? '舰船插件' : tr('ui.MarketPage.003'), // l10n-keep：前者是内容层联合 key
        // 装备蓝图按**产物功能**分组（2026-09-11 船长：「根据产物的类型进行二次分类」；键与 MODULE_SUBS 同源）
        subKey: isPlugBp ? '' : moduleDef ? moduleSubKeyOf(moduleDef.slot, moduleDef.id) : '',
        productGlyph: moduleDef?.slot ?? 'blueprint',
        name: bp.name,
        description: bp.description,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
        productLabel: prodLabel,
        productNode: moduleDef ? <ModuleHover mod={moduleDef}>{prodText}</ModuleHover> : prodText,
        productBase: moduleDef ? productBaseOf(engine, 'module', moduleId) : 0,
        productRef: { kind: 'module' as const, refId: moduleId },
        countOwned: () => countModule(engine.state, moduleId), // 装备产物 → 装备库件数
        ownedWhere: tr("ui.Industry.004"),
        bookPrice: bookPriceOf(engine, bp.id, 0),
        productKey: `module:${moduleId}`,
        singleUse: bp.singleUse === true,
        learnless: false,
      })
    }
  }
  /** 消耗品蓝图（2026-09-05：基础弹自制；产物为物品按 outputUnits 入仓）
   *  2026-09-11 船长：「弹药蓝图改为消耗品蓝图」——本档实际含弹药 + 修理组件，按**产物大类**再筛
   *  ⚠ 2026-09-20 零件体系：产物为**零件**的蓝图（含隐式蓝图）不在本档，归入「零件」门类。 */
  const pushSupply = (): void => {
    for (const bp of engine.blueprints) {
      if (bp.itemId === undefined) continue
      const itemDef = engine.ctx.items.get(bp.itemId)
      if (itemDef?.kind === 'part') continue // 零件走 pushPart
      const units = bp.outputUnits ?? 1
      const prodName = itemDef?.name ?? bp.itemId
      const prodLabel = tr("ui.Industry.120", { prodName: prodName, units: units })
      // 产物名金色（按类型分色作废，2026-09-13 船长）；「×N 发」等参数不上色
      const prodText = (
        <>
          <span className="app-gold">{prodName}</span>
          {` ×${units} 发`}
        </>
      )
      const itemId = bp.itemId
      out.push({
        id: bp.id,
        kindLabel: tr("ui.MarketPage.007"),
        subKey: itemDef?.kind ?? '',
        productGlyph: itemDef?.kind ?? 'blueprint',
        name: bp.name,
        description: bp.description,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
        productLabel: prodLabel,
        productNode: itemDef ? (
          <ItemHover item={itemDef} nameOf={(id) => engine.ctx.items.get(id)?.name}>
            {prodText}
          </ItemHover>
        ) : (
          prodText
        ),
        productBase: itemDef ? productBaseOf(engine, 'item', itemId, units) : 0,
        productRef: { kind: 'item' as const, refId: itemId },
        productUnits: units, // 一次产 N 发（利润率按整批算；船长 2026-09-24 报障）
        countOwned: () => countWare(engine.state, itemId), // 弹药/物品产物 → 物品仓库单位数
        ownedWhere: tr("ui.ItemsPage.001"),
        bookPrice: bookPriceOf(engine, bp.id, 0),
        productKey: `item:${itemId}`,
        singleUse: bp.singleUse === true,
        learnless: false,
      })
    }
  }
  /** 零件蓝图（2026-09-20 船长「组装机内新增零件分页」）：产物 kind = `part` 的全部蓝图——
   *  基础 7 张 = 隐式蓝图（无需学习直接造）；高级 7 张 = 正常蓝图（学书后造）。无二级子筛选。 */
  const pushPart = (): void => {
    for (const bp of engine.blueprints) {
      if (bp.itemId === undefined) continue
      const itemDef = engine.ctx.items.get(bp.itemId)
      if (itemDef?.kind !== 'part') continue
      const prodName = itemDef?.name ?? bp.itemId
      /**
       * ⚠ **产物行要写清"一次生产几件"**（**2026-09-20 船长报障**：「组装机零件的生产卡片内，
       * 产物那边并没有表明是每次生产 10 个对应零件」）：零件 14 张全是 `outputUnits: 10`（每批 10 件、
       * 材料也按 10 件配），消耗品档早有 `×N 发` 这种尾巴、零件档当初漏了 ⇒ 与弹药同一款式补上。
       */
      const units = bp.outputUnits ?? 1
      const prodLabel = tr('ui.Industry.152', { prodName: prodName, units: units })
      // 产物名金色（按类型分色作废，2026-09-13 船长）；「×N 件」等参数不上色
      const prodText = (
        <>
          <span className="app-gold">{prodName}</span>
          {tr('ui.Industry.153', { units: units })}
        </>
      )
      const partItemId = bp.itemId
      out.push({
        id: bp.id,
        kindLabel: '零件', // l10n-keep：内容层联合 key（渲染走 kindLabelText）
        // 2026-09-20 零件体系：二级子筛选 = 基础/高级（键 `part-<档>`，单点 `itemSubs.partTierOf`）
        subKey: bp.partTier ? `part-${bp.partTier}` : '',
        productGlyph: 'part',
        productTone: toneOf(partToneKeyOf(itemDef.id)),
        name: bp.name,
        description: bp.description,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
        productLabel: prodLabel,
        productNode: itemDef ? (
          <ItemHover item={itemDef} nameOf={(id) => engine.ctx.items.get(id)?.name}>
            {prodText}
          </ItemHover>
        ) : (
          prodText
        ),
        productBase: itemDef ? productBaseOf(engine, 'item', partItemId, bp.outputUnits ?? 1) : 0,
        productRef: { kind: 'item' as const, refId: partItemId },
        productUnits: units, // 一次产 10 件（利润率按整批算；船长 2026-09-24 报障）
        countOwned: () => countWare(engine.state, partItemId),
        ownedWhere: '仓库', // l10n-keep：内容层联合 key（渲染走 ownedWhereText）
        bookPrice: bookPriceOf(engine, bp.id, 0),
        productKey: `item:${partItemId}`,
        singleUse: bp.singleUse === true,
        learnless: bp.learnless === true,
        partTier: bp.partTier,
      })
    }
  }
  pushEquip()
  pushPart()
  pushSupply()
    return out
  }, [engine.ctx, engine.blueprints])

  /** 本门类判定（一级门类 → 该卡是否在档内）——二级/三级现算与最终过滤共用一把尺 */  const inTab = (kindLabel: string): boolean =>
    /**
     * ⚠ **2026-09-26 修**（船长报障：「组装机处也没有舰船插件的门类筛选，反而是多出一个错误的图纸筛选」）：
     * 这里原先是**按卡片上的中文 key 字符串**做三元链
     * `tab === 'all' || (tab === 'equip' ? '装备' : tab === 'part' ? '零件' : '消耗品')`——
     * 加第 5 档「舰船插件」时它**没有分支**，任何非 equip/part 的档一律落到"只认消耗品"
     * ⇒ 插件档一张卡都不剩。
     * 现在改成走**同一把尺**：`cardTabOf` 从蓝图与产物现算门类（与 `bpFilterKeysOf` 同源，
     * 那张表是"蓝图书架 / 组装机"共用的单点），判据只有一条 `cardTabOf === tab`。
     * 字符串三元链随之删除——**新增门类时只需在 `MANU_TABS_CRAFT` 加一行**，不会再漏分支。
     */
    tab === 'all' || cardTabOf(kindLabel) === tab
  /** 卡片门类（一级档键）：按卡片的中文 key 反查蓝图与产物（查不到 ⇒ 判给「装备」，与改动前的兜底一致） */
  const cardTabOf = (kindLabel: string): ManuTabKey => {
    // l10n-keep：比较用的都是**内容层联合 key**（不是文案）
    if (kindLabel === '舰船插件') return 'plug'
    if (kindLabel === '零件') return 'part'
    if (kindLabel === '消耗品') return 'supply'
    if (kindLabel === '舰船') return 'ship'
    return 'equip'
  }
  /**
   * **二级子类候选：只列本门类下真有卡片的档**（2026-09-20 船长「明显不存在的子类筛选隐藏」）——
   * 与蓝图书架同一套现算口径（`presentSubs`）；「全部」档常显（基线②）。
   */
  const subOptions = presentSubs(manuSubsOf(tab), (key) => items.some((it) => inTab(it.kindLabel) && it.subKey === key))
  /**
   * ⚠ **2026-09-26：三级「图纸」那一维连同它的现算表 `usesShown` 一起删除**
   * （船长令：「**删除原先的图纸筛选**」）——"一次性/永久"两轴已并进「蓝图」维度（`learn`）。
   * 原注释留档：那一维**只在选了子类后才出现**、且只剩「全部」一项时整行隐藏。
   */

  /** 可开工判定（与卡片按钮同口径）：已学会（或一次性图纸有货且名额未用尽；隐式蓝图无需学习）+ 材料足
   *  （制造费已取消；劳动者判定由卡片按钮各自表达） */
  function canStartNow(blueprintId: string, materials: readonly MaterialNeed[], buildSeconds: number): boolean {
    const su = engine.ctx.blueprints.get(blueprintId)?.singleUse === true
      || engine.ctx.shipBlueprints.get(blueprintId)?.singleUse === true
    if (engine.ctx.blueprints.get(blueprintId)?.learnless === true) {
      return missingMaterials(state, engine.ctx, { materials, buildSeconds, buildCostIsk: 0 }).length === 0
    }
    if (!ownsBlueprint(state, blueprintId) && recipeCapability(state, blueprintId, su).kind !== 'ok') return false
    return missingMaterials(state, engine.ctx, { materials, buildSeconds, buildCostIsk: 0 }).length === 0
  }

  const visible = items
    /** 搜索命中（名称 ＋ 产物/材料 ＋ 说明）：`kq` 为空 ⇒ 恒真；与筛选取「与」 */
    .filter((it) => {
      if (kq.length === 0) return true
      if (it.name.toLowerCase().includes(kq)) return true
      if (it.productLabel.toLowerCase().includes(kq)) return true
      if ((it.description ?? '').toLowerCase().includes(kq)) return true
      // 产物大类名也入索引（与物品页搜索同口径：搜「舰船」「消耗品」这类词也能收窄）
      if (it.kindLabel.toLowerCase().includes(kq)) return true
      return it.materials.some((m) => (engine.ctx.items.get(m.itemId)?.name ?? m.itemId).toLowerCase().includes(kq))
    })
    // 「蓝图」维度（原「学会」＋ 原三级「图纸」合并，2026-09-26 船长令）
    // 四档各自判：学会那一轴 × 是否一次性那一轴；隐式蓝图视为已学会（2026-09-20 零件体系）
    .filter((it) => {
      if (learn === SUB_ALL) return true
      const learned = it.learnless || ownsBlueprint(state, it.id)
      if (learn === 'learned') return learned
      if (learn === 'unlearned') return !learned
      if (learn === 'learned-single') return learned && it.singleUse
      // 'unlearned-single'
      return !learned && it.singleUse
    })
    .filter((it) => inTab(it.kindLabel))
    // 二级子筛选（2026-09-11 船长）：未选子类（SUB_ALL）不过滤
    .filter((it) => sub === SUB_ALL || it.subKey === sub)
    /**
     * **「仅看可造」**（**2026-09-26 船长令**：「**对整个工业界面进行下优化。看下是否有优化空间**」）。
     *
     * 为什么加这一条（优化空间就在这里）：组装机是**唯一长列表**（后期档 151 张），而玩家最常问的
     * 不是"我有哪些图纸"，而是"**现在这批料能造什么**"。原先 `canStartNow()` 只喂按钮的可用态
     * （在卡片上逐张判），**做成筛选项的入口一个都没有** ⇒ 只能一张张往下找。
     * 判据与按钮**同一把尺**（同一个 `canStartNow`）⇒ 筛出来的就是真能点的，不会"说能造却点不动"。
     */
    .filter((it) => !craftableOnly || canStartNow(it.id, it.materials, it.buildSeconds))
  // 排序口径（类型 → 价格升序 → 同产物的一次性图纸紧随原图纸）**单点在 core**：
  // `sortManuRows`（2026-09-08 船长定 + 2026-09-14 船长改定；详见 core 该段注释与 `tests/manu-order.test.ts`）
  // 2026-09-10 船长定：已标记（收藏）的蓝图在默认排序下置顶——「全部」标签下会排在类型分组之前
  // （标签本身是筛选、不是排序键，故各处标签都按同一口径置顶）；组内保持类型→价格顺序。
  const sorted = pinMarked(state, 'blueprints', sortManuRows(visible), (it) => it.id)
  /**
   * **有没有任何一维筛选/搜索在生效**（2026-09-26：卡头那两条读数合并的判据）——
   * 三个维度：搜索词 · 蓝图（学会 × 一次性）· 子类，外加「仅看可造」。
   * ⚠ 门类（`tab`）**不算**：它是"看哪一类"的分区，不是"收窄"（默认就在「全部」，
   * 选了门类也只是换一屏内容，卡头照旧该报"这类里有什么"）。
   */
  const filterActive = kq.length > 0 || learn !== SUB_ALL || sub !== SUB_ALL || craftableOnly
  /**
   * **每张卡的实时指纹**（2026-09-22 第 3 步）：心跳只让指纹变了的卡重渲染。
   * 制造线先按蓝图归并一遍（O(线)），再逐卡拼材料/需求/持有量（O(卡×材料)≈1000 次仓库查询，实测很便宜）。
   */
  const runSigByBp = new Map<string, string>()
  for (const v of runViews) {
    if (v.blueprintId === null) continue // 精炼线的 blueprintId 为空（本表只服务组装机卡）
    runSigByBp.set(v.blueprintId, `${runSigByBp.get(v.blueprintId) ?? ''}${v.id}.${Math.round(v.remainingMs / 1000)}.${Math.round(v.percent)}.${v.worker ?? '-'}|`)
  }
  const liveKeyOf = (it: (typeof items)[number]): string =>
    cardLiveKeyOf(engine, it.id, it.materials, runSigByBp.get(it.id) ?? '', it.countOwned())
  // l10n-keep-start：以下 kindLabel 过滤用的都是**内容层联合 key**（不是文案）
  const equipN = items.filter((i) => i.kindLabel === '装备').length
  const partN = items.filter((i) => i.kindLabel === '零件').length
  const supplyN = items.filter((i) => i.kindLabel === '消耗品').length
  const learnedN = items.filter((i) => ownsBlueprint(state, i.id)).length

  return (
    <Panel
      className="is-fill win-fixed-body"
      title={tr("ui.IndustryPage.059")}
      hint={
        // 常驻说明收进标题后的圆形感叹号（2026-09-13 船长口径）；2026-09-14 船长点名："组装机的说明并没有隐藏"
        <HintIcon tip={tr('ui.Industry.150')} />
      }
      right={
        <>
          {/* 搜索栏（船长 2026-09-19）：与精炼炉、物品页/货仓/技能/舰船页/手册同款（标题行右侧） */}
          <span className="app-head-search-wrap">
            <input
              className="app-head-search"
              type="text"
              placeholder={tr("ui.Industry.128")}
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              spellCheck={false}
            />
          </span>
          <span className="app-dim">
            {/**
             * **两条读数合并成一条**（**2026-09-26 船长令**：「优化工业界面」→ 采纳"删2／优1"）。
             *
             * 原先这里**同时**显示两组数：
             * - `ui.Industry.156` 的分项汇总（制造线 / 装备 / 零件 / 消耗品 / 已学会）——**全目录**口径；
             * - 紧接着 `ui.Industry.127` 的「当前 N 张」——**筛完**口径。
             * 未筛选时两者里的"总数"是同一个数，连读两遍才知道哪个是筛后的 ⇒ 现在**二选一**：
             * - **筛选/搜索生效** ⇒ 只报「当前 N 张」（玩家此刻要知道的就是"筛剩多少"）；
             * - **没筛选** ⇒ 只报分项汇总（此刻要知道的是"池子里都有什么"）。
             */}
            {filterActive
              ? tr('ui.Industry.127', { n: sorted.length })
              : tr('ui.Industry.156', {
                  p1: runViews.length,
                  p2: equipN,
                  p3: partN,
                  p4: supplyN,
                  p5: learnedN,
                })}
          </span>
          <AiSlotText state={state} ctx={engine.ctx} />
        </>
      }
    >
      {/* 筛选固定、说明进标题后的圆形感叹号（固定头+下滚）：各筛选行常驻，卡网格独立内滚。
          ⚠ 行序（2026-09-19 丙组）：**学会（并列属性）+ 门类（一级）同排一行 → 子类（二级）→ 图纸（三级）**；
          胶囊行一律「全部」+ 同行灰字前缀（基线①）。
          ⚠ **学会与门类同排**（船长 2026-09-19：「建议和门类放在同一行。除非宽度不够才另外起一行」）——
          `.app-fleet-row` 自带 `flex-wrap: wrap`，窗口窄时门类那组会自动折到下一行，无需另写断点。 */}
      {/* 筛选区（整块外面加 `.app-filter-block` = 与内容之间的**虚线分隔**；背景线不占布局 ⇒ 高宽不变，
          船长 2026-09-19） */}
      <div className="app-filter-block">
      <div className="app-fleet-row">
        <span className="app-dim">{tr('ui.Industry.136')}</span>
        <div className="app-task-tabs app-fleet-tabs" role="tablist">
          {BLUEPRINT_LEARN_TABS.map((l) => (
            <button
              key={l.key}
              role="tab"
              aria-selected={learn === l.key}
              className={`app-tasktab${learn === l.key ? ' is-active' : ''}`}
              onClick={() => setLearn(l.key)}
            >
              {tr(l.id)}
            </button>
          ))}
        </div>
        <span className="app-dim">{tr('ui.Industry.134')}</span>
        <div className="app-task-tabs app-fleet-tabs" role="tablist">
          {/**
           * **「舰船插件」档在取得第一个黑匣前整档不出现**（**2026-09-26 船长令**：
           * 「**组装机，门类：舰船插件筛选项不可用时，隐藏该选项**」）。
           *
           * 判据走 core 单点 `plugCraftUnlockedOf`（= 见过黑匣；与"解锁组装机插件选项"同一条令）。
           * ⚠ **沿革（本轮改判）**：先前是"标签仍在但置灰不可点 ＋ 悬停写原因"（当时的理由是
           * "让玩家知道有这一档"）⇒ 船长令改为**直接隐藏**：不可用的筛选项不该占位。
           * 因此 `disabled` / 锁定悬停 / 那条 `ui.IndustryPage.117` 提示在本处一并撤掉
           * （该 id 仍被章鱼人兑换窗口的未解锁态使用，不是死条目）。
           * ⚠ **筛选合并批（二号，同日晚）**：本行原先那句 `setUseKind(SUB_ALL)` 随第三级「图纸」筛选
           * **整维删除**而去掉（"一次性/永久"那一轴已并进上面的「蓝图」维度）。
           */}
          {MANU_TABS_CRAFT.filter((t) => t.key !== 'plug' || plugCraftUnlockedOf(engine.state)).map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`app-tasktab${tab === t.key ? ' is-active' : ''}`}
              onClick={() => {
                setTab(t.key)
                setSub(SUB_ALL) // 换一级标签即回「全部子类」（与市场页 changeKind 同款）
              }}
            >
              {tr(t.id)}
            </button>
          ))}
        </div>
        {/**
         * **「仅看可造」开关**（**2026-09-26 船长令**：优化工业界面）——与「学会」同排、贴在门类之后。
         *
         * 为什么放这一排而不是新起一行：它与「学会」同性质（**并列的布尔收窄**，不是层级维度），
         * 且 `.app-fleet-row` 自带 `flex-wrap`（窗口窄了自动折行，不必另写断点）⇒ 不新增行高。
         * 落款走既有胶囊样式（`.app-tasktab` ＋ `is-active`），与两个筛选行**同一套观感**。
         */}
        <span className="app-dim">{tr('ui.IndustryPage.127')}</span>
        <div className="app-task-tabs app-fleet-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={craftableOnly}
            className={`app-tasktab${craftableOnly ? ' is-active' : ''}`}
            title={tr('ui.IndustryPage.128')}
            onClick={() => setCraftableOnly((v) => !v)}
          >
            {tr('ui.IndustryPage.129')}
          </button>
        </div>
      </div>
      {/* 二级子筛选（2026-09-11 船长：按产物的类型二次分类 / 舰船按舰船级别）——
          复刻舰船页「舰队筛选」那套次级标签样式（app-task-tabs + app-fleet-tabs 去下边框 + app-tasktab 胶囊）；
          「全部」标签不带子筛选（与市场「全部类型」同款）；文案 = 裸「全部」+ 同行前缀（基线①） */}
      {subOptions.length > 0 ? (
        <div className="app-fleet-row">
          <span className="app-dim">{tr('ui.Industry.129')}</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={sub === SUB_ALL}
              className={`app-tasktab${sub === SUB_ALL ? ' is-active' : ''}`}
              onClick={() => setSub(SUB_ALL)}
            >
              {tr('ui.IndustryPage.001')}
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
        </div>
      ) : null}
      </div>
      <div className="app-win-body">
        <div className="app-belt-grid" ref={gridRef}>
          {sorted.map((it, i) => (
            /**
             * **视口懒挂载**（**2026-09-27 船长令**：「**组装机的卡片太多了，能否采用流式加载？当卡片靠近玩家
             * 屏幕时才加载**」；方案获船长「**按你推荐来**」确认）。三档 eager：
             * ① **首屏块 `EAGER_FIRST` 张**立刻挂（进页先有一屏半真卡，不会一进来就一片空白）；
             * ② **空闲补块 `EAGER_IDLE` 张**（`useIdleChunk`）——滚得快时少看见空白；
             * ③ **被跳转定位的那一张**必须立刻挂（页面那条 `.app-belt-card.is-goto` 居中滚动要能 querySelector 到节点）。
             * 其余交给 `LazyMount` 的 IntersectionObserver（视口上下各 1 屏）。
             */
            <LazyMount
              key={it.id}
              eager={i < EAGER_FIRST + idleChunk || focusBlueprintId === it.id}
              minHeight={cardH}
            >
              <BlueprintCard
                engine={engine}
                onToast={onToast}
                blueprintId={it.id}
                name={it.name}
                description={it.description}
                materials={it.materials}
                buildSeconds={it.buildSeconds}
                productLabel={it.productLabel}
                productNode={it.productNode}
                kindLabel={it.kindLabel}
                productRef={it.productRef}
                productUnits={it.productUnits}
                productGlyph={it.productGlyph}
                productTone={it.productTone}
                productBase={it.productBase}
                countOwned={it.countOwned}
                ownedWhere={it.ownedWhere}
                onNeedMineral={onNeedMineral}
                onGotoMarket={onGotoMarket}
                onGotoWormhole={onGotoWormhole}
                onGotoPlugExchange={onGotoPlugExchange}
                onGotoShelf={onGotoShelf}
                highlighted={focusBlueprintId === it.id}
                learnless={it.learnless}
                /** 实时指纹：只有它变了的卡才会真正重渲染（详见 `cardLiveKeyOf` 的说明） */
                liveKey={liveKeyOf(it)}
              />
            </LazyMount>
          ))}
        </div>
        {sorted.length === 0 ? (
          <div className="app-dim app-exp-idle">{tr("ui.Industry.093")}</div>
        ) : null}
      </div>
    </Panel>
  )
}
