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
  recipeCapability,
  canStartBlueprint,
  // 组装机卡片排序（2026-09-14 船长「一次性图纸应该和原图纸放在一起」）——口径单点在 core 纯函数
  sortManuRows,
  // 2026-09-14 舰船仓库批：船型"总持有"读口径（仓库＋在役舰队）
  shipOwnedCount,
  // 2026-09-13：精炼源只列玩家可见的矿（未上线矿不进"由精炼炉炼出"提示）
  visibleItemDefs,
  // 2026-09-14 船长：虫洞专属图纸改「去虫洞」跳转，门槛与扫描虫洞页同一本账
  WORMHOLE_SCAN_UNLOCK_STANDING,
} from '@whale/core'
import type { AiCoreType, GameState, MaterialNeed } from '@whale/core'
import { RedeemFragmentButton } from '../ui/fragmentRedeem'
import { Panel } from '@whale/ui'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { ItemHover, ModuleHover, ShipHover } from '../ui/shipInfo'
import { MarkStar, pinMarked } from '../ui/marks'
import { AiSlotText } from '../ui/aiSlots'
import { HintIcon } from '../ui/Hint'
import { RowGlyph } from '../ui/itemView'
import { partToneKeyOf, toneOf } from '../ui/Glyphs'
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
}: {
  engine: GameEngine
  onToast: ToastFn
  /** 「去组装机」：切到组装机标签并定位那张蓝图卡（船长 2026-09-14：「蓝图书架内，玩家可以通过蓝图
   *  直接跳转对应组装机」）——由工业页透传（跳转时会**清掉组装机的三级筛选**，否则目标卡可能被筛掉） */
  onGotoCraft?: (blueprintId: string) => void
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
            <div key={id} className={`app-belt-card app-shelf-card${learned ? ' is-learned' : ''}`}>
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
                    {isShipBook ? tr('ui.Industry.141') : '去组装机'}
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
  return { tab: 'equip', subKey: mod ? moduleSubKeyOf(mod.slot) : '', singleUse: bp?.singleUse === true }
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
export function BlueprintCard({
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
  ownedCount,
  ownedWhere,
  onNeedMineral,
  onGotoMarket,
  onGotoWormhole,
  highlighted,
  learnless,
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
  /** 自己已有多少产物（2026-09-10 船长：卡面产物行尾要显示"我拥有多少个成品"） */
  ownedCount: number
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
  /** 被「蓝图书架 → 去组装机」定位到的那张卡（页面层同一套 `.app-belt-card.is-goto` 高亮） */
  highlighted?: boolean
  /** 2026-09-20 零件体系：隐式蓝图（基础零件）——无需学习即视为已学会，卡面显示「无需图纸」 */
  learnless?: boolean
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
  /** 虫洞解锁声望闸（与扫描虫洞页同一本账：协会声望 ≥ `WORMHOLE_SCAN_UNLOCK_STANDING`） */
  const whStanding = state.standings.dsi ?? 0
  const whUnlocked = whStanding >= WORMHOLE_SCAN_UNLOCK_STANDING
  // 每卡独立的 AI 核心选择（一枚核心驱动一条线；核心库存被占用后自动回落可用类型）
  const [coreSel, setCoreSel] = useState<AiCoreType>('basic')
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
        '已取消该条制造线：材料全额退回物品仓库（AI 核心已归还）；一次性图纸连同制造名额一起退回蓝图书架。其余线不受影响。',
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
  // 2026-09-08（二号·组装机收益体检 A 项）：卡面补「净 ≈信用点/h」——产物现货基准价 − 材料收价
  // （材料学折扣后），按当前技能单件耗时折算每小时；未计销路与成交税（卖出按空间站收购档约
  // 6~7 折，自用装配则按现货计）——与精炼/回收卡「净口径估算」同款视觉。
  const matIsk = materials.reduce(
    (s, m) => s + matNeedCount(state, m.count) * (engine.ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0),
    0,
  )
  const netPerH = productBase > 0 ? Math.round(((productBase - matIsk) / Math.max(1, buildMs)) * 3_600_000) : null
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
              无需图纸
            </span>
          ) : owned ? (
            <span className="app-chip">已学会</span>
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
            <span className="app-chip">{kindLabel}</span>
          )}
        </span>
      </div>
      <div className="app-belt-desc">{description}</div>

      <div className="app-belt-ore">
        {tr("ui.Handbook.013")}{productNode ?? productLabel}
        <span className="app-dim" title={tr("ui.Industry.108", { ownedWhere: ownedWhere })}>
          （{ownedWhere} {ownedCount.toLocaleString('zh-CN')}）
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
                  const srcs = refineSourcesOf(engine, need.itemId)
                  const srcName = (id: string): string => engine.ctx.items.get(id)?.name ?? id
                  return (
                    <span
                      className="app-bp-mat-act"
                      role="button"
                      tabIndex={0}
                      title={
                        srcs.length > 0
                          ? tr("ui.Industry.109", { matName: matName, p2: srcs.map(srcName).join(tr("ui.MatterTechTab.017")) })
                          : tr("ui.Industry.110", { matName: matName })
                      }
                      onClick={() => onNeedMineral?.(need.itemId)}
                    >
                      {srcs.length > 0 ? tr("ui.Industry.047") : tr("ui.Industry.048")}
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
        {netPerH !== null ? (
          <div
            className={`app-belt-econ-val${netPerH < 0 ? ' is-neg' : ''}`}
            title={tr("ui.Industry.111", { p1: netPerH < 0 ? tr("ui.Industry.051") : tr("ui.Industry.052") })}
          >
            {MONEY_GLYPH} ≈{netPerH.toLocaleString('zh-CN')} {tr("ui.IndustryPage.026")}{netPerH < 0 ? tr("ui.Industry.053") : tr("ui.Industry.054")}
          </div>
        ) : null}
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
          <div className="app-belt-workers" style={{ marginTop: 2 }}>
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
          <button
            className="app-btn is-small"
            title={tr("ui.Industry.117", { bookCount: bookCount })}
            onClick={handleLearnFromShelf}
          >
            {tr("ui.Industry.074")}
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
}

export function ManufacturingPanel({
  engine,
  onToast,
  onNeedMineral,
  onGotoMarket,
  onGotoWormhole,
  focusBlueprintId,
}: {
  engine: GameEngine
  onToast: ToastFn
  onNeedMineral?: (itemId: string) => void
  /** 「市场求购蓝图书」跳市场（传市场商品键）；由工业页透传 App 的「去市场」入口 */
  onGotoMarket?: (goodKey: string) => void
  /** 「去虫洞（遗迹打捞）」跳星图 · 出港 · 扫描虫洞（船长 2026-09-14：虫洞专属图纸市场买不到） */
  onGotoWormhole?: () => void
  /** 蓝图书架「去组装机」的定位目标（蓝图 id）：本面板会**先清掉三级筛选**再高亮那张卡 */
  focusBlueprintId?: string | null
}) {
  const state = engine.state
  const runViews = manufacturingRunViews(state, engine.ctx)
  const [tab, setTab] = useState<ManuTabKey>('all')
  const { t } = useL10n()
  /**
   * **「学会」维度**（并列属性行，**放最上一行**——船长 2026-09-19：「组装机我想添加一个过滤已有蓝图的筛选」
   * ⇒ 追问后定「放第一行」）：全部 / 已学会 / 未学会。它与门类无关、与搜索取「与」，故不参与级联重置。
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
  /** 第三级筛选：一次性/永久（**只在选了子类后显示**；见 `BLUEPRINT_USE_TABS` 的注释） */
  const [useKind, setUseKind] = useState<BlueprintUseKey>(SUB_ALL)
  /**
   * **书架跳过来的定位**（船长 2026-09-14）：先把三级筛选全部复位（否则目标卡可能正被筛掉 ⇒ 跳过去空白），
   * 高亮由页面层的 `.app-belt-card.is-goto` + 居中滚动负责（与「去精炼」同一套）。
   */
  useEffect(() => {
    if (!focusBlueprintId) return
    setTab('all')
    setSub(SUB_ALL)
    setUseKind(SUB_ALL)
  }, [focusBlueprintId])

  /** 目录数据（舰船 + 装备统一成条目；制造中冒泡在前，再按名称） */
  const items: Array<{
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
    running: boolean
    canStart: boolean
    productBase: number
    /** 自己已有多少产物（产物行尾显示）与它的来处（仓库/装备库/机库） */
    ownedCount: number
    ownedWhere: string
    bookPrice: number
    /** 排序用：**产物唯一键**（`ship:`/`module:`/`item:` + 产物 id）——2026-09-14 船长：
     *  「一次性图纸应该和原图纸放在一起」⇒ 同产物成组，组内原图纸在前 */
    productKey: string
    /** 排序用：本卡是否为**一次性图纸**（`singleUse`） */
    singleUse: boolean
    /** 2026-09-20 零件体系：隐式蓝图（基础零件无需学习） */
    learnless: boolean
    /** 2026-09-20 零件体系：零件档位（排序用：基础零件默认在前） */
    partTier?: 'basic' | 'advanced'
  }> = []
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
      items.push({
        id: bp.id,
        kindLabel: tr("ui.MarketPage.003"),
        // 装备蓝图按**产物功能**分组（2026-09-11 船长：「根据产物的类型进行二次分类」；键与 MODULE_SUBS 同源）
        subKey: moduleDef ? moduleSubKeyOf(moduleDef.slot) : '',
        productGlyph: moduleDef?.slot ?? 'blueprint',
        name: bp.name,
        description: bp.description,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
        productLabel: prodLabel,
        productNode: moduleDef ? <ModuleHover mod={moduleDef}>{prodText}</ModuleHover> : prodText,
        running: runViews.some((v) => v.blueprintId === bp.id),
        canStart: canStartNow(bp.id, bp.materials, bp.buildSeconds),
        productBase: moduleDef ? productBaseOf(engine, 'module', bp.moduleId!) : 0,
        ownedCount: moduleDef ? countModule(state, bp.moduleId!) : 0, // 装备产物 → 装备库件数
        ownedWhere: tr("ui.Industry.004"),
        bookPrice: bookPriceOf(engine, bp.id, 0),
        productKey: `module:${bp.moduleId}`,
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
      items.push({
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
        running: runViews.some((v) => v.blueprintId === bp.id),
        canStart: canStartNow(bp.id, bp.materials, bp.buildSeconds),
        productBase: itemDef ? productBaseOf(engine, 'item', bp.itemId, units) : 0,
        ownedCount: itemDef ? countWare(state, bp.itemId) : 0, // 弹药/物品产物 → 物品仓库单位数
        ownedWhere: tr("ui.ItemsPage.001"),
        bookPrice: bookPriceOf(engine, bp.id, 0),
        productKey: `item:${bp.itemId}`,
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
      items.push({
        id: bp.id,
        kindLabel: '零件',
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
        running: runViews.some((v) => v.blueprintId === bp.id),
        canStart: canStartNow(bp.id, bp.materials, bp.buildSeconds),
        productBase: itemDef ? productBaseOf(engine, 'item', bp.itemId, bp.outputUnits ?? 1) : 0,
        ownedCount: itemDef ? countWare(state, bp.itemId) : 0,
        ownedWhere: '仓库',
        bookPrice: bookPriceOf(engine, bp.id, 0),
        productKey: `item:${bp.itemId}`,
        singleUse: bp.singleUse === true,
        learnless: bp.learnless === true,
        partTier: bp.partTier,
      })
    }
  }
  pushEquip()
  pushPart()
  pushSupply()

  /** 本门类判定（一级门类 → 该卡是否在档内）——二级/三级现算与最终过滤共用一把尺 */
  const inTab = (kindLabel: string): boolean =>
    tab === 'all' || (tab === 'equip' ? kindLabel === '装备' : tab === 'part' ? kindLabel === '零件' : kindLabel === '消耗品')
  /**
   * **二级子类候选：只列本门类下真有卡片的档**（2026-09-20 船长「明显不存在的子类筛选隐藏」）——
   * 与蓝图书架同一套现算口径（`presentSubs`）；「全部」档常显（基线②）。
   */
  const subOptions = presentSubs(manuSubsOf(tab), (key) => items.some((it) => inTab(it.kindLabel) && it.subKey === key))
  /**
   * **三级「图纸」维度（一次性 / 永久）：同样只列真有内容的档**——船长点名的例子：
   * 「组装机-零件-高级零件-一次性蓝图」在零件门类下不存在 ⇒ 该档消失；过滤后只剩「全部」一项时整行隐藏。
   */
  const usesShown = presentSubs(BLUEPRINT_USE_TABS, (key) =>
    items.some(
      (it) => inTab(it.kindLabel) && (sub === SUB_ALL || it.subKey === sub) && (key === 'single' ? it.singleUse : !it.singleUse),
    ),
  )

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
    // 「学会」维度（并列属性行，与门类无关 ⇒ 独立取「与」；隐式蓝图视为已学会，2026-09-20 零件体系）
    .filter(
      (it) =>
        learn === SUB_ALL ||
        (learn === 'learned'
          ? it.learnless || ownsBlueprint(state, it.id)
          : !it.learnless && !ownsBlueprint(state, it.id)),
    )
    .filter((it) => inTab(it.kindLabel))
    // 二级子筛选（2026-09-11 船长）：未选子类（SUB_ALL）不过滤
    .filter((it) => sub === SUB_ALL || it.subKey === sub)
    // 三级筛选（2026-09-14 船长）：一次性 / 永久——**只在选了子类后才有开关**，故这里 sub=全部时它恒为 SUB_ALL
    .filter((it) => useKind === SUB_ALL || (useKind === 'single' ? it.singleUse : !it.singleUse))
  // 排序口径（类型 → 价格升序 → 同产物的一次性图纸紧随原图纸）**单点在 core**：
  // `sortManuRows`（2026-09-08 船长定 + 2026-09-14 船长改定；详见 core 该段注释与 `tests/manu-order.test.ts`）
  // 2026-09-10 船长定：已标记（收藏）的蓝图在默认排序下置顶——「全部」标签下会排在类型分组之前
  // （标签本身是筛选、不是排序键，故各处标签都按同一口径置顶）；组内保持类型→价格顺序。
  const sorted = pinMarked(state, 'blueprints', sortManuRows(visible), (it) => it.id)
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
            制造线 {runViews.length} 条 · 装备 {equipN} · 零件 {partN} · 消耗品 {supplyN} · 已学会 {learnedN}
            {/* 任一一维筛选/搜索生效时补读数，避免玩家对着收窄后的网格数不清 */}
            {kq.length > 0
              ? tr('ui.IndustryPage.108', { n: sorted.length })
              : learn !== SUB_ALL || sub !== SUB_ALL || useKind !== SUB_ALL
                ? tr('ui.Industry.127', { n: sorted.length })
                : ''}
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
          {MANU_TABS_CRAFT.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`app-tasktab${tab === t.key ? ' is-active' : ''}`}
              onClick={() => {
                setTab(t.key)
                setSub(SUB_ALL) // 换一级标签即回「全部子类」（与市场页 changeKind 同款）
                setUseKind(SUB_ALL) // 三级筛选随之复位（它只在选了子类后才显示，留着会变成"看不见的筛选"）
              }}
            >
              {tr(t.id)}
            </button>
          ))}
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
              onClick={() => {
                setSub(SUB_ALL)
                setUseKind(SUB_ALL) // 回「全部子类」⇒ 三级筛选行随之隐藏，故一并复位
              }}
            >
              {tr('ui.IndustryPage.001')}
            </button>
            {subOptions.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={sub === s.key}
                className={`app-tasktab${sub === s.key ? ' is-active' : ''}`}
                onClick={() => {
                  setSub(s.key)
                  setUseKind(SUB_ALL) // 换子类即回「全部图纸」（与一级标签同款口径）
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {/* **三级筛选：一次性 / 永久**（船长 2026-09-14：「组装机添加第三个筛选，一次性蓝图和永久蓝图。
          需要选完上一级子类后才出现」）——样式逐字复刻上面那行子筛选（`app-task-tabs app-fleet-tabs`）； 
          **选了子类才渲染**：没选子类时它不出现，避免与"全部子类"语义打架 */}
      {/* 2026-09-20 筛选清理：只剩「全部」一项时整行隐藏（该门类下不存在一次性/永久的区分） */}
      {sub !== SUB_ALL && usesShown.length > 1 ? (
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
      </div>
      <div className="app-win-body">
        <div className="app-belt-grid">
          {sorted.map((it) => (
            <BlueprintCard
              key={it.id}
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
              productGlyph={it.productGlyph}
              productTone={it.productTone}
              productBase={it.productBase}
              ownedCount={it.ownedCount}
              ownedWhere={it.ownedWhere}
              onNeedMineral={onNeedMineral}
              onGotoMarket={onGotoMarket}
              onGotoWormhole={onGotoWormhole}
              highlighted={focusBlueprintId === it.id}
              learnless={it.learnless}
            />
          ))}
        </div>
        {sorted.length === 0 ? (
          <div className="app-dim app-exp-idle">{tr("ui.Industry.093")}</div>
        ) : null}
      </div>
    </Panel>
  )
}
