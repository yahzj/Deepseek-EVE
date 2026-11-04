import { calcBuildDurationMs, countWare, manufacturingLoopOf, manufacturingRunViews, marketLockedReason, matNeedCount, missingMaterials, ownsBlueprint, usableAiCoresOf, recipeCapability, canStartBlueprint, WORMHOLE_SCAN_UNLOCK_STANDING, standingOf, DSI_FACTION_ID, materialDisplayIdOf, materialGroupIdsOf } from '@whale/core'
import { bestAiCoreOf } from '@whale/core'
import type { AiCoreType, MaterialNeed } from '@whale/core'
import { memo, useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { GameEngine } from '../../game/engine'
import type { ToastFn } from '../../pages/common'
import { MarkStar } from '../../ui/marks'
import { aiCoreText, kindLabelText, ownedWhereText } from '../../ui/labelsText'
import { RowGlyph } from '../../ui/itemView'
import { GoodsLine, marginPctOf, marketPriceOf, NetIncomeLine } from '../../ui/yieldView'
import { MatSourceLink } from '../../ui/matSourceLink'
import { MATS_COLLAPSE_OVER, MatListToggle } from '../../ui/matList'
import { AiCoreSelect } from '../../ui/aiCoreSelect'
import { useLoopGoalDraft } from '../../ui/useLoopGoalDraft'
import { cmdText } from '../../i18n/locale'
import { tr } from '../../i18n/locale'
import { fmtDuration } from '../../i18n/fmt'
import { bpGoodKey } from './blueprintValue'
import { isWormholeBlueprint, manualBuildNote } from './blueprintPolicy'

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
  const blackMarketBlueprint = !bookBuyable && goodKey !== null && engine.ctx.marketGoods.get(goodKey)?.blackMarketBuyable === true
    && engine.ctx.marketGoods.get(goodKey)?.playerSellable === false
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
  const usableCores = usableAiCoresOf(state)
  const core = usableCores.includes(coreSel) ? coreSel : (usableCores[0] ?? null)
  const manualNote = manualBuildNote(state, engine)

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
    if (r.queued) { onToast(tr('core.busy.020')); return }
    onToast(
      worker === 'pilot'
        ? tr("ui.Industry.031")
        : tr("ui.Industry.105", { p1: aiCoreText(worker) }),
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
  /**
   * **循环目标的防丢草稿套件**（2026-09-17 报障修复首创于此；**2026-10-02 模块化**：口径原样
   * 搬进 `ui/useLoopGoalDraft.ts`，与实验室卡（经典）· 实验室（HUD）三处共用一份 —— 行为逐字不变）。
   */
  const { draft: goalDraft, typeDraft, clearDraft, clearTouched } = useLoopGoalDraft((n) =>
    engine.setManufacturingLoopAt(blueprintId, true, n),
  )
  /**
   * **原材料列表折叠**（**2026-10-01 船长令**：「**「原材料列表」折叠，超过2个材料就进行折叠**」）：
   * 味数 > `MATS_COLLAPSE_OVER` 时材料块只留一行开关，点开才拉开全部行（公共件 `ui/matList.tsx`）。
   * 状态**不落盘**（每张卡各自的 `useState`，切页/重挂载即回到折叠）；缺料味数取 `short`（本卡那把尺）。
   */
  const matsListId = useId()
  const [matsOpen, setMatsOpen] = useState(false)
  const matsCollapsible = materials.length > MATS_COLLAPSE_OVER
  function commitLoop(on: boolean, goalText: string): void {
    clearTouched()
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
            {tr('ui.Industry.121', { n: runs.length })} {tr("ui.Industry.043")} {fmtDuration(Math.min(...runs.map((v) => v.remainingMs)))} {tr("ui.Industry.044")}
          </>
        ) : (
          <>{tr('ui.Industry.122', { d: fmtDuration(buildMs) })}{tr("ui.Industry.045")}</>
        )}
      </div>
      <ul className="app-bp-mats" id={matsListId}>
        {/* 原材料列表折叠（2026-10-01 船长令：味数 > 2 ⇒ 只留这一行开关，点开才拉开全部） */}
        {matsCollapsible ? (
          <MatListToggle
            count={materials.length}
            open={matsOpen}
            shortCount={short.length}
            running={running}
            listId={matsListId}
            onToggle={() => setMatsOpen((v) => !v)}
          />
        ) : null}
        {matsCollapsible && !matsOpen
          ? null
          : materials.map((need) => {
          const needCount = matNeedCount(state, need.count, blueprintId) // 预览与实际投料共用需求
          /**
           * **等价组**（**2026-09-29 船长报障**：「组装机中，舰船插件材料消耗列表中还是显示了墨潮黑匣
           * （**应该显示通用黑匣**）」）：
           * ① **名字**按 `materialDisplayIdOf`（有哪种报哪种、都没有报组内第一种 = 通用黑匣）；
           * ② **"现有"读数与缺口判据按组内合计**（`materialGroupIdsOf`）——与开工真扣料、
           *    与引擎的缺料提示**同一把尺**（此前这里只数"配方写的那个 id"，手上全是通用黑匣时
           *    会被误判成缺料、且行名写着旗舰黑匣）；
           * ③ 组内多于一种时补一句**分项**（`现有 3（通用 1 · 其他 2）`），换装/换料前看得清手里是什么。
           */
          const groupIds = materialGroupIdsOf(need.itemId)
          const displayId = materialDisplayIdOf(state, need.itemId)
          const have = groupIds.reduce((sum, id) => sum + countWare(state, id), 0)
          const enough = have >= needCount
          const matName = engine.ctx.items.get(displayId)?.name ?? displayId
          const split =
            groupIds.length > 1
              ? groupIds
                  .map((id) => ({ id, n: countWare(state, id) }))
                  .filter((x) => x.n > 0)
                  .map((x) => `${engine.ctx.items.get(x.id)?.name ?? x.id} ${x.n.toLocaleString('zh-CN')}`)
                  .join(tr('ui.MatterTechTab.017'))
              : ''
          // 空闲态才标红缺口；制造中仓库余量只影响「加开一条线」，红色会误读成故障
          return (
            <li key={need.itemId} className={`app-bp-mat${!enough && !running ? ' is-short' : ''}`}>
              {matName} ×{needCount.toLocaleString('zh-CN')}
              {needCount !== need.count ? (
                <span className="app-dim">{tr("ui.Industry.046")}{need.count.toLocaleString('zh-CN')}{tr('ui.Industry.123')}</span>
              ) : null}
              <span className="app-dim">
                {tr("ui.IndustryPage.029")} {have.toLocaleString('zh-CN')}
                {split !== '' ? `（${split}）` : ''}）
              </span>
              {/* 2026-09-22 船长令：「组装机和造船厂需要零件时，提示不是去组装机，而是去市场」⇒
                 「希望提示玩家去组装机生产零件，不要提示去市场」＋「高级零件依旧去相应的组装机」。
                 四支（优先级从上到下）：**声望商店有 ⇒ 去声望商店** · 有精炼源 ⇒ 去精炼炉 ·
                 **能在这台机器上造出来（如零件）⇒ 去组装机** · 既炼不出也造不出 ⇒ 去市场。
                 文案按 §十三.5 不写原因解释（旧文案那句「无法经精炼炉产出」属解释，已随本次改写删掉）。
                 ⚠ **新增第一支的由来**（**2026-09-29 船长报障**）：「通用黑匣」只有章鱼人声望商店
                 一条来路（市场**只收不卖**、价格表里没有它的卖单）⇒ 原先落进第四支、显示
                 「要到市场购买——点击跳转」是**指错路**（点过去只会看到一个空行情）。
                 ⚠ 判据按**等价组**（`groupIds.includes(通用黑匣)`）而不是 `need.itemId === …`：
                 配方里写的是 `blackbox-h`，直接比 id 永远不成立（实测踩到，读数照旧"去市场"）。
                 **2026-10-01**：这四支连同 `refineSourcesOf` 已搬进公共件 `ui/matSourceLink.tsx`
                 （实验室卡要对齐同一套 ⇒ 两处各写一份必然漂），本卡行为逐字不变。 */}
              <MatSourceLink
                engine={engine}
                itemId={need.itemId}
                matName={matName}
                groupIds={groupIds}
                onNeedMineral={onNeedMineral}
                onGotoPlugExchange={onGotoPlugExchange}
              />
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
                  matNeedCount(state, m.count, blueprintId) *
                    (marketPriceOf(state, engine.ctx, m.itemId) ?? engine.ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0),
                0,
              )
              /**
               * **利润率按"整批"算**（船长 2026-09-24 报障：「组装机是一次性生产 10 个的，现在的利润只计算
               * 一个」）：`materials` 是整批的料 ⇒ 收入必须 `单价 × 一次产出件数`（零件 10 / 消耗品 N 发 /
               * 装备与舰船 1）。卡面显示的行情价仍是**每单位**（与市场页折线图同尺）。
               */
              return (
                <>
                  <GoodsLine
                    name={productLabel}
                    price={price}
                    marginPct={marginPctOf(price, matCost, productUnits ?? 1)}
                    unitsPerRun={productUnits ?? 1}
                  />
                  {/* **净收益/h**（**2026-09-29 船长令**：只在调试模式下显示）——与上面那行同一把尺 */}
                  <NetIncomeLine price={price} costIsk={matCost} buildMs={buildMs} unitsPerRun={productUnits ?? 1} />
                </>
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
                  title={tr("ui.Industry.114", { p1: fmtDuration(v.durationMs), p2: kindLabel === '舰船' ? tr("ui.Industry.064") : tr("ui.Industry.065"), p3: v.worker === null ? tr("ui.Industry.066") : '' })}
                >
                  {v.worker === null ? tr("ui.Industry.067") : v.worker === 'pilot' ? tr("ui.Industry.068") : tr("ui.Industry.115", { p1: v.workerLabel })}
                  {tr('ui.Industry.137', { p1: fmtDuration(v.remainingMs) })}
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
            {/* AI 工位：核心下拉常驻（无可用核心时置灰并在控件里写明，卡面不跳动；船长 2026-09-10）——
                2026-10-02 起走公共件 `ui/aiCoreSelect.tsx`（行为与旧实现逐字一致） */}
            <div className="app-belt-ai">
              <AiCoreSelect
                engine={engine}
                value={core}
                onPick={setCoreSel}
                titleReady={tr("ui.Industry.072")}
                titleEmpty={tr("ui.IndustryPage.051")}
                emptyLabel={tr("ui.ShipPage.070")}
              />
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
        ) : blackMarketBlueprint ? (
          <span className="app-dim">{tr('ui.ammoMk3.001')}</span>
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
