import { countWare, stationActivityStartBlockReason, labAffordableBatches, labMaterialAvailable, labBatchUnitsOf, labCycleMsOf, labMissingMaterials, labRecipeUnlocked, labTechRequirementOf, usableAiCoresOf, manualSlotOf, materialGroupIdsOf } from '@whale/core'
import type { LabRecipeDef, LabRunView } from '@whale/core'
import { bestAiCoreOf } from '@whale/core'
import type { AiCoreType } from '@whale/core'
import { useId, useState, type ReactNode } from 'react'
import type { GameEngine } from '../../game/engine'
import '../../styles-unbox-ledger.css'
import { MarkStar } from '../../ui/marks'
import { RowGlyph } from '../../ui/itemView'
import { ItemHover } from '../../ui/shipInfo'
import { MatSourceLink } from '../../ui/matSourceLink'
import { MATS_COLLAPSE_OVER, MatListToggle } from '../../ui/matList'
import { AiCoreSelect } from '../../ui/aiCoreSelect'
import { useLoopGoalDraft } from '../../ui/useLoopGoalDraft'
import { itemGlyphName } from '../../ui/Glyphs'
import { cmdText } from '../../i18n/locale'
import { fmtDuration } from '../../i18n/fmt'
import { aiCoreText } from '../../ui/labelsText'
import { marketPriceOf, NetIncomeLine } from '../../ui/yieldView'
import type { PageProps } from '../../pages/common'
import { tr } from '../../i18n/locale'

/**
 * **一张实验室配方卡**（骨架与类名逐件照 `FurnaceCard`；**材料行**照组装机卡 `BlueprintCard`）。
 *
 * 与精炼炉卡的差异：材料是**多料 BOM**，开工门槛从"够一批单料"变成"够一批全料"（`labAffordableBatches`）。
 *
 * **材料行与组装机卡逐字同款**（**2026-10-01 船长令**：「实验室的卡片还是使用自己的富文本规则，和组装机
 * 不一样（比如卡片标题有个'去弄料'，下方的原材料没有'去精炼''去组装机'然后字体样式也不一致）」）：
 * `.app-bp-mats` ＋ `.app-bp-mat`（普通文字色，不再是 `.app-belt-econ` 那套金色）＋ 缺料 `is-short` 红标
 * ＋ 行尾公共件 `MatSourceLink` 四支跳转；跳转**下沉到每一味料**，卡头原先那颗「去弄料」按钮已删
 * （它只能挑"第一味缺料"，指路不如逐行准）。
 */
export function LabCard({
  recipe,
  engine,
  onToast,
  onGotoMarket,
  onNeedMaterial,
  onGotoPlugExchange,
  runs,
}: {
  recipe: LabRecipeDef
  engine: GameEngine
  onToast: PageProps['onToast']
  onGotoMarket?: (goodKey: string) => void
  /** 材料行尾「去精炼 / 去组装机 / 去市场」那条链（见 `LabPanel` 的同名 prop 注释）：入参 = 那一味料的物品 id */
  onNeedMaterial?: (itemId: string) => void
  /** 材料行尾第①支的落点：声望商店（通用黑匣那条来路，与组装机卡同一处判定） */
  onGotoPlugExchange?: () => void
  runs: LabRunView[]
}): ReactNode {
  const state = engine.state
  const out = engine.ctx.items.get(recipe.outputItemId)
  const affordable = labAffordableBatches(state, recipe)
  const running = runs.length > 0
  /**
   * **本批实际产出单位**（走 core 单点 `labBatchUnitsOf`：基准 × `LAB_YIELD_SKILLS` 收率乘区）——
   * 卡面那个 `×N` 与下面的净收益读数**共用这一个数**（2026-10-01 船长裁：卡上不许两个口径；
   * 原先 `×N` 读配方基础值、净收益也按基础值算 ⇒ 收率技能的效果在卡面完全看不见）。
   */
  const batchUnits = labBatchUnitsOf(state, recipe)
  /**
   * **主控亲自那一批的实际周期**（走 core 单点 `labCycleMsOf`：吃 `LAB_CYCLE_SKILLS`；AI 核心另按效率拉长）——
   * 卡面「主控耗时」读数与净收益读数共用它（2026-10-01 船长令：工期也照组装机卡那套）。
   */
  const pilotCycleMs = labCycleMsOf(state, engine.ctx, recipe, 'pilot')
  /**
   * **原材料列表折叠**（**2026-10-01 船长令**：「**「原材料列表」折叠，超过2个材料就进行折叠**」）：
   * 味数 > `MATS_COLLAPSE_OVER` ⇒ 材料块只留一行开关，点开才拉开全部行（公共件 `ui/matList.tsx`，
   * 与组装机／造船厂卡同一份）。状态不落盘：切页/重挂载即回到折叠。
   */
  const matsListId = useId()
  const [matsOpen, setMatsOpen] = useState(false)
  const matsCollapsible = recipe.materials.length > MATS_COLLAPSE_OVER
  const batchValue = batchUnits * (marketPriceOf(state, engine.ctx, recipe.outputItemId) ?? out?.baseSellPriceIsk ?? 0)
  const costIsk = recipe.materials.reduce(
    (s, m) =>
      s + m.units * (marketPriceOf(state, engine.ctx, m.itemId) ?? engine.ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0),
    0,
  )
  const usableCores = usableAiCoresOf(state)
  const [coreSel, setCoreSel] = useState<AiCoreType>(() => bestAiCoreOf(state) ?? 'basic')
  const core = usableCores.includes(coreSel) ? coreSel : (usableCores[0] ?? null)
  const labBlock = stationActivityStartBlockReason(state, engine.ctx, 'lab')
  const manualBusy = manualSlotOf(state) !== null ? tr('ui.hud.212') : labBlock ? cmdText(labBlock) : null
  /**
   * **谜质科技门槛**（**2026-09-30 船长令**：T5「解锁新的燃料配方」）——判据与起线拒绝**同一把尺**
   * （`labRecipeUnlocked`）；锁着时卡片照列（玩家要看得见"有这么张配方、缺哪棵树"），
   * 但两个开工按钮一起置灰，并把缺哪条科技写在标题与卡片提示行上。
   */
  const locked = !labRecipeUnlocked(state, engine.ctx, recipe)
  const lockTip = locked ? tr('ui.lab.025', { p1: labTechRequirementOf(engine.ctx, recipe) ?? recipe.name }) : null
  /**
   * **循环实验**（**2026-10-01 船长令**：实验室按组装机那套 ⇒ 一线一批，连续生产靠卡片级循环开关）。
   * 控件与提交口径**照组装机那张卡**（`panels/Industry.tsx` 的 `goalDraft` 那套）：
   * 打到一半的草稿留在本页，回车/失焦各提交一次。
   */
  const loop = engine.labLoopOf(recipe.id)
  /**
   * **循环目标的防丢草稿套件**（2026-09-17 组装机卡首创；**2026-10-02 模块化**：口径原样搬进
   * `ui/useLoopGoalDraft.ts`，组装机卡 / 本卡 / HUD 实验室三处共用一份 —— 行为逐字不变）。
   */
  const { draft: goalDraft, typeDraft, clearDraft, clearTouched } = useLoopGoalDraft((n) =>
    engine.setLabLoopAt(recipe.id, true, n),
  )
  function commitLoop(on: boolean, goalText: string): void {
    clearTouched()
    const n = Number.parseInt(goalText, 10)
    const r = engine.setLabLoopAt(recipe.id, on, on ? (Number.isFinite(n) && n > 0 ? n : null) : null)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Industry.133'), true)
  }
  function runWith(worker: AiCoreType | 'pilot'): void {
    const r = engine.startLabRunAt(recipe.id, worker)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.lab.013'), true)
      return
    }
    if (r.queued) { onToast(tr('core.busy.020')); return }
    const who = worker === 'pilot' ? tr('ui.IndustryPage.020') : tr('ui.IndustryPage.068', { p1: aiCoreText(worker) })
    onToast(tr('ui.lab.019', { p1: recipe.name, p2: recipe.outputUnits, who }))
  }
  return (
    // `is-lab`：本卡唯一的专属样式钩子（`styles.css`：把产物行整行拉回普通文字色，**只有产物名金色**，
    // 与组装机卡 `is-assembler` 同一口径；⚠ 不复用 `is-assembler`——它还带 content-visibility 与占位高度）
    <div className="app-belt-card is-lab" key={recipe.id}>
      <div className="app-belt-head">
        <span className="app-belt-name">
          {/* ⚠ **2026-09-30 船长报障「新道具图标你还没定」**：这里原先把图标写死成 `consumable`
              ⇒ 实验室三张卡（燃料/加速剂/发射器）全是通用「消耗品」图标。改走**物品 id 单点映射**
              `itemGlyphName`（与物品页/货仓页同一处判定，三件各有专属线稿）。 */}
          <RowGlyph glyph={itemGlyphName(recipe.outputItemId, out?.kind ?? 'consumable')} /> {recipe.name}
        </span>
        <span className="app-belt-head-right">
          {/* ⭐ 标记（**2026-09-30 船长令**：实验室卡与精炼炉卡同款 ⇒ 走新开的 `labRecipes` 族，
              存的是**配方 id**，与 `recipes` 的物品 id 分开） */}
          <MarkStar engine={engine} kind="labRecipes" id={recipe.id} />
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
      {/* 产物行（**2026-10-01 船长令**：「你漏了产物部分的样式（包括产物的title）」）——与组装机卡
          **同一套口径**：`产物：` ＋ 产物名（**本行只有它金色**，2026-09-13 船长「只需要将产物染成金色
          就够了…其他文字的金色取消」）＋ 拥有数（`.app-dim`，悬停 `ui.Industry.108` 说明其口径）。
          ⚠ 金字靠本卡 `is-lab` 那条 CSS 把整行拉回普通文字色（复用不了 `.is-assembler`：那条还带
          `content-visibility:auto` ＋ `contain-intrinsic-size`，是组装机 151 张卡的屏外跳过用的）。
          ⚠ 产物名挂**物品悬停**（与组装机卡同一个 `ItemHover` —— 就是船长说的"产物的title"）。
          ⚠ **`×N` 读 `labBatchUnitsOf`（实际批产）**，不再读 `recipe.outputUnits` 基础值（2026-10-01 船长裁：
          收率工艺学的效果必须在卡面看得见、卡上不许两个口径）。
          ⚠ 「产出倍率」那枚读数**已删**（2026-10-01 船长裁）：它读的是精炼族的 `refineRate`，而实验室
          压根不吃那条倍率（`lab.ts` 只吃产线节拍学 ＋ 实验室族那两条）⇒ 是个假读数；产出侧的真数字
          就是这个 `×N`。 */}
      <div className="app-belt-ore">
        {tr('ui.Handbook.013')}
        <span className="app-gold">
          {out !== undefined ? (
            <ItemHover item={out} nameOf={(id) => engine.ctx.items.get(id)?.name}>
              {out.name}
            </ItemHover>
          ) : (
            recipe.outputItemId
          )}
        </span>{' '}
        ×{batchUnits.toLocaleString('zh-CN')}
        <span
          className="app-dim"
          title={tr('ui.Industry.108', { ownedWhere: tr('ui.ItemsPage.001') })}
        >
          （{tr('ui.ItemsPage.001')} {countWare(state, recipe.outputItemId).toLocaleString('zh-CN')}）
        </span>
        {/* 工期读数**与组装机卡逐字同款**（**2026-10-01 船长令**：「『每批工期 X 分钟』这个也和组装机卡同步」）：
            空闲 ⇒ ` · 主控耗时 {技能修正后的周期}（技能修正后；AI 核心另按效率拉长）`；
            在跑 ⇒ ` · 已开 N 条线，首条约 T 到点`。数值走 core 单点 `labCycleMsOf`（不许界面自己乘技能）。 */}
        {running ? (
          <>
            {tr('ui.Industry.121', { n: runs.length })} {tr('ui.Industry.043')}{' '}
            {fmtDuration(Math.min(...runs.map((v) => v.remainingMs)))} {tr('ui.Industry.044')}
          </>
        ) : (
          <>
            {tr('ui.Industry.122', { d: fmtDuration(labCycleMsOf(state, engine.ctx, recipe, 'pilot')) })}
            {tr('ui.Industry.045')}
          </>
        )}
      </div>
      {/* 材料行：**与组装机卡逐字同款**（2026-10-01 船长令：实验室卡不许自成一套富文本规则）——
          `.app-bp-mats` ＋ `.app-bp-mat`（普通文字色）＋ 缺料 `is-short` ＋ 行尾「去哪弄」四支跳转。
          ⚠ 缺料标红口径同组装机：**只在未开工时**标（在跑的红字会被误读成故障）；
          ⚠ 实验室配方**没有等价组、也不吃材料学折扣**（core 口径）⇒ 行里不出现组装机那句
          「（原 ×N，材料学折扣后）」，`现有` 读数走 core 单点 `labMaterialAvailable`。 */}
      <ul className="app-bp-mats" id={matsListId}>
        {/* 原材料列表折叠（2026-10-01 船长令：味数 > 2 ⇒ 只留这一行开关，点开才拉开全部）——
            实验室 3~5 味料 ⇒ 三张配方卡现在默认都是折叠态；缺料味数走 core 单点 `labMissingMaterials` */}
        {matsCollapsible ? (
          <MatListToggle
            count={recipe.materials.length}
            open={matsOpen}
            shortCount={labMissingMaterials(state, engine.ctx, recipe).length}
            running={running}
            listId={matsListId}
            onToggle={() => setMatsOpen((v) => !v)}
          />
        ) : null}
        {matsCollapsible && !matsOpen
          ? null
          : recipe.materials.map((m) => {
          const def = engine.ctx.items.get(m.itemId)
          const have = labMaterialAvailable(state, m.itemId)
          const enough = have >= m.units
          const groupIds = materialGroupIdsOf(m.itemId)
          return (
            <li
              key={m.itemId}
              className={`app-bp-mat${!enough && !running ? ' is-short' : ''}`}
            >
              {def?.name ?? m.itemId} ×{m.units.toLocaleString('zh-CN')}
              <span className="app-dim">
                {tr('ui.IndustryPage.029')} {have.toLocaleString('zh-CN')}）
              </span>
              <MatSourceLink
                engine={engine}
                itemId={m.itemId}
                matName={def?.name ?? m.itemId}
                groupIds={groupIds}
                onNeedMineral={onNeedMaterial}
                onGotoPlugExchange={onGotoPlugExchange}
              />
            </li>
          )
        })}
      </ul>
      <div className="app-belt-econ">
        {/* 净收益/h 的工期**与产物行同一把尺**（2026-10-01 船长令：工期读数同步组装机卡）——走 core 单点 */}
        <NetIncomeLine price={batchValue} costIsk={costIsk} buildMs={pilotCycleMs} />
      </div>
      <div className="app-belt-actions">
        {/**
         * **循环实验**（**2026-10-01 船长令**：「实验室本质上也是一个组装机，建议按照组装机的来」＋
         * 「**循环应该和组装机一样是放在顶部的**」）——
         * **位置与组装机那张卡逐字同款**：循环行是**操作区的第一行**（在运转名册与开工键**之上**），
         * 控件结构也照它（`.app-belt-loop` ＋ `.app-toggle` ＋ `.app-mf-goal`）。
         * 文案用本机器自己那一组（`ui.lab.031~035`；通用词如「目标」「已产」「已停线：」直接复用）。
         */}
        <div className="app-belt-loop">
          <label className="app-toggle" title={tr('ui.lab.032', { p1: loop.on ? tr('ui.Industry.055') : tr('ui.Industry.056') })}>
            <input
              type="checkbox"
              className="app-toggle-input"
              checked={loop.on}
              onChange={(e) => commitLoop(e.target.checked, e.target.checked ? (goalDraft || (loop.goal > 0 ? String(loop.goal) : '')) : '')}
            />
            <span className="app-toggle-track" aria-hidden="true" />
            <span className="app-toggle-label">{tr('ui.lab.031')}</span>
          </label>
          {loop.on ? (
            <span className="app-mf-goal">
              {tr('ui.Industry.058')}
              <input
                type="number"
                min={1}
                className="app-mf-goal-input"
                placeholder="∞"
                value={goalDraft !== '' ? goalDraft : loop.goal > 0 ? String(loop.goal) : ''}
                onChange={(e) => typeDraft(e.target.value)}
                onBlur={(e) => {
                  clearDraft()
                  commitLoop(true, e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    clearDraft()
                    commitLoop(true, (e.target as HTMLInputElement).value)
                  }
                }}
                title={tr('ui.lab.033')}
              />
              {tr('ui.lab.034')}
              <em className="app-dim">{tr('ui.Industry.060')}</em>
            </span>
          ) : null}
          {loop.produced > 0 ? (
            <span className="app-mf-made">
              {tr('ui.Industry.061')} {loop.produced.toLocaleString('zh-CN')} {tr('ui.lab.034')}
            </span>
          ) : null}
          {loop.stopWhy.length > 0 ? (
            <span className="app-mf-why">
              {tr('ui.Industry.062')}
              {loop.stopWhy}
            </span>
          ) : null}
          <span className="app-dim app-mf-note">
            {tr('ui.lab.035')}
            {runs.length > 0 ? tr('ui.Industry.113', { p1: runs.length }) : ''}
          </span>
        </div>
        {/* 运转单位名册（每台一行：劳动者 + 当前批进度条 + 停）——与精炼炉逐字同款 */}
        {runs.length > 0 ? (
          <div className="app-belt-workers">
            {runs.map((v) => (
              <span key={v.id} className="app-belt-worker">
                <span className="app-belt-worker-name">
                  {v.worker === 'pilot' ? tr('ui.IndustryPage.041') : tr('ui.IndustryPage.086', { p1: aiCoreText(v.worker) })} ·{' '}
                  {/* 一线一批（2026-10-01）：本行给**这一批**的产出读数；累计批数改读循环读数（卡上开关行） */}
                  {tr('ui.lab.036', { p1: v.batchUnits })}
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
        {/* AI 工位：核心下拉常驻（与精炼炉同款：无核心时置灰，卡面不跳动）——2026-10-02 起走公共件 */}
        <div className="app-belt-ai">
          <AiCoreSelect
            engine={engine}
            value={core}
            onPick={setCoreSel}
            titleReady={tr('ui.IndustryPage.052')}
            titleEmpty={tr('ui.IndustryPage.051')}
            emptyLabel={tr('ui.ShipPage.070')}
          />
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
