/** 战斗域：blink，从原引擎按职责迁移，保持结算顺序。 */
import type { UnitSpec } from './model'
import type { BattleBalance } from '../types'
import { foeDesiredRange, blinkGapMs, blinkProcessMs, BLINK_VANISH_SHARE_NUM, BLINK_SHARE_DEN } from './foes/tactics'
import { pushBattleFx } from './combatFx'

/**
 * **闪现的"一跳"**（**船长 2026-10-01 三次裁定**，敌我**同一口径**）：
 * 从当前位置朝目标距离走一跳，**单次位移不超过 `stepM`**：
 * - 相距不到 `stepM` ⇒ 正好落在目标上（"一次闪到位"）；
 * - 相距超过 `stepM` ⇒ 只走 `stepM`（**要归位就得闪多次**）。
 *
 * 🔴 为什么必须有这个上限（船长原话）：「**闪现之前不是设定每次闪现最多2000米吗**」——
 * 上一版我为了修「越闪越远被无伤」把落点改成了"闪到期望距离"，**却把件上那个 `distanceM`（2,000m）
 * 当成无用字段丢在一边** ⇒ 实测出现过 **3,185m 的单次瞬移**（`corona-nexus` 第 4 波：换波时期望距离
 * 突变 5,740 → 8,925）。船长报的正是这个。
 *
 * ⚠ **方向与步长是两件事，缺一不可**：方向（朝谁走）由调用方给的目标决定，步长（跳多远）由件决定
 * ⇒ 两者都在，才既不会"越闪越远被无伤"、也不会"一键归位/瞬移一大截"。
 * ⚠ 多闪几次才归位 = **闪烁过载的结构代价真的按次计**（每闪一次扣上限 5%）——这正是该件设计意图。
 *
 * @param curM 当前交战距离
 * @param wantM 目标距离，敌我各自使用自身期望交战距离。
 * @param stepM 单次位移上限（= 件上的 `blink.distanceM`）
 * @param minM 交战距离下限、`maxM` 战场最大距离（两端都钳）
 * @returns 跳完之后应该站在哪；**与 `curM` 相同 = 跳不动**（调用方据此不白盖冷却）
 */
export function blinkStep(curM: number, wantM: number, stepM: number, minM: number, maxM: number): number {
  /**
   * ⚠ **起点与目标都要先取整再算步长**（2026-10-01 修）：`distanceM` 是**逐拍走位累加出来的小数**
   * （实测 3553.48416），若只在最后对落点取整，跳幅会变成 `|round(起点 ± 2000) − 起点|`
   * = **2000.207**（超出件上限 0.2 米，实测踩到）。取整后两断点都是整数 ⇒ 跳幅恒 ≤ `stepM`，
   * 与"距离以米为单位、件上写 2,000"的语义一致。
   */
  const cur = Math.round(curM)
  const want = Math.round(wantM)
  const gap = want - cur
  const moved = cur + Math.sign(gap) * Math.min(Math.abs(gap), stepM)
  return Math.max(minM, Math.min(maxM, Math.round(moved)))
}

/**
 * **敌方「瞬光跃迁仪」的闪现触发器**（**船长 2026-10-01 令**：「**激光武器+闪现效果的挂载件**」）——
 * 由"**敌舰本体被我方命中**"驱动（打它的机群不算、未命中不算）；冷却期内静默。
 *
 * 突变后双向钳制 `[bal.minDistanceM, 战场最大距离]` ⇒ 不会闪出战场。
 * 冷却态记在 `BattleState.foeBlinks[tag]`（`save.ts` 登记 `kind: 'runtime'`，**有意不入档** ——
 * 与 `foeCharges`（冲锋循环）同一口径：落在"重载即重置循环"内）。
 *
 * @returns 本次是否真的闪了（供画面提示＋**闪现动画**用）
 */
export function markFoeBlink(
  rt: UnitSpec,
  tag: string,
  b: import('../state').BattleState,
  bal: BattleBalance,
  maxDistanceM: number,
  /** 我方电子舰对敌舰射程的削减率（缺省 0 = 旧口径）——只影响"它想站多远" */
  foeRangeDebuffR = 0,
): boolean {
  const bl = rt.foeBlink
  if (bl === undefined || bl.distanceM <= 0 || bl.cooldownMs <= 0) return false
  // ⚠ `bl.distanceM` = **本跳的位移上限**（2,000m），交 `blinkStep` 执行；
  //   它同时还是"件是否有效"的档位判据（≤0 视为没挂这件）。
  const nowMs = b.lastTickGameMs
  if (nowMs < (b.foeBlinks?.[tag] ?? 0)) return false // 冷却中 ⇒ 再挨打也不闪
  /**
   * **方向 = 朝「敌人自己的期望交战距离」走，步长 = 件上的 2,000m**（**船长 2026-10-01 三次改判**）：
   *
   * > 第一次：「**闪烁的方向问题反而导致敌人能被无伤，建议修改为，闪烁方向以期望距离为目标。**」
   * > 🔴 第二次（实测报障）：「**有些问题，当我攻击敌人后，敌人会瞬间闪现到我的期望距离**」
   * > 🔴 第三次（复核口径）：「**闪现之前不是设定每次闪现最多2000米吗**」
   *
   * 第一次我实现成了"闪到 `b.myDesireM`（**我方**的期望）"——那是**玩家的意图距离**，
   * 于是出现船长实测的怪相：**我方一开火，敌人就瞬移到"我方想要的距离"上**（等于敌人替玩家走位）。
   * 第二次我改成"闪到**它自己的**期望距离 `foeDesiredRange(...)`"（正解：那是它按自己的射程带
   * 与战术算出来的位置，也**正好吃族格覆写**——R 族的 `foeDesireRangeM` 会被钉成"风筝位 / 钻盲区位"），
   * **但把件上的 `distanceM`（2,000m）当成无用字段丢在一边** ⇒ 期望距离一突变（换波等）就出现
   * **3,185m 的单次瞬移**（`corona-nexus` 实测）。第三次裁定把步长补回来。
   *
   * ⇒ 现在 = `blinkStep(当前, 它自己的期望, 2,000, 下限, 战场上限)`：**朝对的方位走，但一次只走 2 公里**
   * ——差得远就多闪几次（每次扣上限 5% 结构，代价照算）；已经在期望距离上 ⇒ **闪不动**（不白盖冷却）。
   *
   * ⚠ 射程压制（我方电子舰）照常计入：与 `advanceBattleFor` 的走位口径同一把尺，不传时按 0。
   */
  const want = foeDesiredRange(rt, [rt], bal, foeRangeDebuffR)
  const landed = blinkStep(b.distanceM, want, bl.distanceM, bal.minDistanceM, maxDistanceM)
  if (landed === b.distanceM) return false // 已在期望距离上／已被钳到边界 ⇒ 闪不动（不白盖冷却）
  /** 记账起点 = **取整后的位置**（与 `blinkStep` 内部同一把尺）：`distanceM` 是逐拍累加的小数，
   *  若记小数起点，跳幅会带上 0.2 米级尾巴（实测 2000.207）⇒ 与"件上写 2,000"的语义不符。 */
  const from = Math.round(b.distanceM)
  const moved = Math.abs(landed - from)
  /**
   * 🔴 **位置不在这里换**（**船长 2026-10-02 令**：「**移动的时间节点应该放在发生时间的等待处**」）——
   * 旧实现在这一行就写了 `b.distanceM = landed`（"触发即换位"）⇒ 演出里**没有"等待"这一段**，
   * 船长的实机反馈指的正是这个。现在改成：**入队 + 等到 `moveAtMs` 那一拍由 `settleBlinkQueue` 兑现**。
   */
  if (!b.foeBlinks) b.foeBlinks = {}
  b.foeBlinks[tag] = nowMs + bl.cooldownMs
  /**
   * **旁路记账：这一跳从哪起跳、走了多远、朝哪边**（2026-10-01 加，见 `BattleState.foeBlinkJumps` 头注）——
   * 只写不进任何算式。存在的理由：落点是**全局标量**，多舰同拍各闪一次时，光看 `distanceM`
   * 的变化**既分不出单舰跳幅、也分不出单舰方向**（实测踩过：聚合位移 2,678 m 被误读成"一跳超 2,000m"）。
   * ⚠ 记账在**触发当刻**就写好（跳幅与方向**与兑现时刻无关**）⇒ 用例读数不受"位移推迟"影响。
   */
  if (!b.foeBlinkJumps) b.foeBlinkJumps = {}
  b.foeBlinkJumps[tag] = { from, moved, dir: landed > from ? 1 : landed < from ? -1 : 0 }
  /**
   * 🔴 **排进"闪现演出队列"**（**船长 2026-10-01 令**：「**闪现现在会有一个发生时间，同时触发的多个闪现
   * 需要排队发生**」；口径与时刻表见 `BattleState.foeBlinkQueue`）——
   * **多个闪现依次排定**，每段占「整个过程 ＋ 间隔」，本舰那一段从现在开始。
   * ⚠ **不停表**（船长裁定）：战斗时钟照走，只是这段窗口里**我方不开火**（`blinkHoldSides` 门控）。
   */
  const queue = b.foeBlinkQueue ?? (b.foeBlinkQueue = {})
  /**
   * 排期：**从"已有各段里最晚的那个结束时刻"起、再加一个间隔**，本舰那一段才开始
   * （船长：「**多个闪现需要有200ms的间隔**」⇒ 段与段之间空一个 `foeBlinkGapMs`；
   * ⚠ `.slice()` 是必需的：下面马上要往同一个 `queue` 里写本舰，先取快照免得跳过一段）。
   */
  let startMs = nowMs
  for (const q of Object.values(queue).slice()) startMs = Math.max(startMs, q.appearMs + blinkGapMs(bal))
  const vanishMs = startMs
  /** 三段的边界（见 `foeBlinkQueue` 头注）：消失 → **等待（位移在这一瞬兑现）** → 出现 */
  const moveAtMs = vanishMs + Math.round((blinkProcessMs(bal) * BLINK_VANISH_SHARE_NUM) / BLINK_SHARE_DEN)
  const appearMs = vanishMs + blinkProcessMs(bal)
  queue[tag] = { queuedMs: nowMs, vanishMs, moveAtMs, appearMs, from, to: landed }
  /**
   * 演出事件：界面据此让本舰**消失**并播淡出；位移在 `moveAtMs` 由引擎兑现，界面到 `appearMs`
   * 在新位置播"出现"。
   *
   * ⚠ **`atMs` 一并带动画时长与倍速**（2026-10-02 修）：界面原先**根本没消费 `atMs`**
   * （一律 `set(tag, performance.now())`）⇒ 引擎排好的"依次错开"在画面上被抹平、同一拍触发的
   * 多艘会**同时闪**。现在界面按 `atMs − nowMs` 换算出"该等多久才开始播"，并把游戏毫秒**除以倍速**
   * 折成真实毫秒（`speedX`）⇒ 排队错开与倍速缩放在画面上都能对上。
   */
  pushBattleFx(b, {
    atMs: vanishMs,
    side: 'foe',
    tag,
    type: 'kinetic',
    hit: true,
    blink: true,
    speedX: b.speedX ?? 1,
  })
  return true
}

/**
 * **把"到点的闪现位移"兑现**（**船长 2026-10-02 令**：「**移动的时间节点应该放在发生时间的等待处**」）——
 * 每拍扫一遍队列：`moveAtMs` 到点的段**真正写进 `b.distanceM`**；`appearMs` 过完的段从队列删掉。
 *
 * ⚠ **为什么必须"到点才写"而不是"触发就写"**：船长的演出设计是
 * 「**播放动画的同时舰船消失 → 等待发生时间 → 在新位置播放动画同时舰船出现**」——
 * 位置若在触发当刻就换，"消失"这一段播的就是**新位置**（根本看不到旧位置消失），中间也不存在"等待"。
 * ⇒ 位移落在**消失演完、等待开始**的那一瞬（`moveAtMs`）。
 *
 * ⚠ **队列项一直留到 `appearMs`**（不是兑现位移就删）：界面要读这张时刻表才知道
 * 「哪艘正处在消失→等待→出现」里、以及"出现"从哪一刻开始 ⇒ 提前删会让界面失去时间轴。
 * ⚠ 多条闪现**排队**时各自按自己的 `moveAtMs` 兑现；同一拍到点多个 ⇒ 按队列顺序依次写。
 * ⚠ 幂等：写过的段打 `moved` 标记 ⇒ 同一拍内重复调用不会写两次。
 *
 * 🔴 **2026-10-02 §35：敌我两张表一起结算**（**船长裁定「2甲」**：「**我方闪现的位移兑现点一并统一**」）
 * —— 本批之前**只有敌方**走"到点才写"，我方是"触发即写"（旧 `markMeBlink` 里那一行）。
 * 现在两侧同源：`foeBlinkQueue` 与 `meBlinkQueue` 共用本函数、同一把尺。
 * ⚠ **本仓只有一根距离标量** ⇒ 两侧同拍到点兑现时**后写者胜**（与 §34 那条假红用例同一个事实，
 *   不是新引入的问题；用例的采样粒度须细于引擎子步，见 `corona-loot` ⑥ 头注）。
 */
export function settleBlinkQueue(b: import('../state').BattleState): void {
  const now = b.lastTickGameMs
  for (const q of [b.foeBlinkQueue, b.meBlinkQueue]) {
    if (!q) continue
    for (const [tag, seg] of Object.entries(q)) {
      if (now >= seg.moveAtMs && seg.moved !== true) {
        b.distanceM = seg.to
        seg.moved = true
        void tag
      }
      if (now >= seg.appearMs) delete q[tag]
    }
  }
}

/**
 * **闪现演出期间"谁禁火"**（**船长 2026-10-01 令**：「**不停表，但是敌舰消失时，玩家的武器不会开火
 * （哪怕武器转好了）**」；**2026-10-02 §35 扩为双向**：「**我方触发闪现时，闪现禁火对敌人也生效**」）。
 *
 * **口径 = 严格窗口 ＋ 按表分侧**：某一段处在「已消失、还没出现」（`vanishMs → appearMs`，
 * 长度 = `balance.battle.foeBlinkProcessMs`），**对面那一侧**这一拍就全门不开火。
 * - `foeBlinkQueue` 在窗口 ⇒ **`me`**（我方不开火）—— 2026-10-01 的原始口径；
 * - `meBlinkQueue` 在窗口 ⇒ **`foe`**（敌方不开火）—— 2026-10-02 §35 新增。
 *
 * ⚠ **两张表必须分开判**：合成一张会让"我方自己闪"变成"我方自己停火"（详见 `meBlinkQueue` 头注）。
 * ⚠ 判定阈是"离开"而不是"到达"：`appearMs` 那一拍**允许开火**（那一侧已经回来了）。
 * ⚠ 与既有 `cd > 0` 同一口径：**冷却照推**，转好了就停在 0 等窗口，窗口一过立刻开火（不白扣一发）。
 * ⚠ **全队一起演不改变本判据**（**裁定 1甲**）：一次触发只排**一段**，窗口按触发者那一段算
 *   ⇒ 禁火时长与队伍人数无关。
 */
export function blinkHoldSides(b: import('../state').BattleState): { me: boolean; foe: boolean } {
  const now = b.lastTickGameMs
  const inWindow = (q: Record<string, import('../state').BlinkSeg> | undefined): boolean => {
    if (!q) return false
    for (const seg of Object.values(q)) if (now >= seg.vanishMs && now < seg.appearMs) return true
    return false
  }
  return { me: inWindow(b.foeBlinkQueue), foe: inWindow(b.meBlinkQueue) }
}

/**
 * **叠光装置的当前装填间隔**（**船长 2026-10-01 令**：「**添加叠光装置：效果是每次攻击或者闪现后，
 * 攻击间隔缩短，最多缩短至0.5秒攻击间隔。**」）——读 `/ 懒初始化 / 顺带推进` 三合一。
 *
 * `baseReloadMs` = 条目的固定装填间隔（本舰主武器那条）。首次访问时把基准值**登记**进
 * `BattleState.foeOverlayReload[tag]`；此后每次调用都按
 * `基准 − stepMs × (开火次数 + 闪现次数)` 现算、夹下限 `floorMs`，并把结果写回登记表。
 *
 * **为什么现算而不是逐次累减**：装填间隔本身决定开火次数 ⇒ 逐次累减要维护两个计数器、还要防
 * "同一拍多算一次"；而 `nowMs` 基准的**开火次数**与**闪现次数**都是单调可数的整数
 * （闪现次数由已过时间 ÷ 冷却直接算出，不缺一个字段），于是同一拍内重复调用**幂等**、重载重开也
 * 不会漂。⚠ 登记表仍记着"当前间隔"，供战报/悬停等展示读（与 `foeBlinks` 同一口径：有意不入档）。
 *
 * @returns 本发的装填间隔（毫秒）；本舰没挂叠光装置 ⇒ 原样返回 `baseReloadMs`
 */
export function foeOverlayReloadOf(
  rt: UnitSpec,
  tag: string,
  b: import('../state').BattleState,
  /** 本发的**基准**装填间隔 = 条目上的固定 `reloadMs`（只用来定义"起点"与加速度，不当作当前值） */
  baseReloadMs: number,
): number {
  const od = rt.foeOverlayDrive
  if (od === undefined) return baseReloadMs
  const step = Math.max(1, od.stepMs)
  const reg = b.foeOverlayReload ?? (b.foeOverlayReload = {})
  // 闪现台阶：数"这艘敌舰已经闪现过几次"，再扣掉**已经折算过**的那几次
  //（⚠ 不能由 `lastTickGameMs ÷ 冷却` 推：到点却没挨打 ⇒ 没闪、不该推进；只能查 `foeBlinks`）
  const blink = rt.foeBlink
  const blinkCount =
    blink !== undefined && blink.cooldownMs > 0
      ? Math.max(reg[tag]?.bs ?? 0, countFoeBlinksAt(b, tag, blink.cooldownMs))
      : 0
  const prev = reg[tag]
  // 首次访问 = 基准值；此后按（开火次数 + 闪现次数）现算、夹下限
  const fired = prev?.f ?? 0
  const next = Math.max(od.floorMs, baseReloadMs - (fired + blinkCount) * step)
  reg[tag] = { r: next, f: fired + 1, bs: blinkCount }
  return next
}

/**
 * **本波起点**（战斗时钟 ms）——「聚焦阵列」**逐波重置**的计时锚
 * （**船长 2026-10-02 改判**：「**旗舰挂载件的会随波重置**」）。
 *
 * - 第 1 波（以及一切没换过波的场次）⇒ 缺省回落到 `startedAtGameMs`（**老档 / 单波卡零迁移**）；
 * - 每次**波次转场**由 `advanceBattleFor` 写一次 ⇒ 新一波从 0 起算。
 * ⚠ 用**战斗时钟**而不是全局时钟：转场窗口里战斗时钟是冻住的，窗口那一段不该计入爬升时间。
 */
export function foeWaveStartMsOf(
  b: Pick<import('../state').BattleState, 'foeWaveStartMs' | 'startedAtGameMs'>,
): number {
  return b.foeWaveStartMs ?? b.startedAtGameMs
}

/**
 * **我方「叠光同款 · 装填自加速」的当前装填间隔**（**船长 2026-10-01 令**：「激光武器为叠光同款叠加攻速的，
 * 基础伤害偏低，需要玩家叠满才威力较强」）——与敌方 `foeOverlayReloadOf` **逐字同款**的机制，
 * 只有两处差别：① 键是 `tag#炮位`（一艘船可能装多门）；② **不乘伤害倍率**（船长令只说了"基础伤害偏低"，
 * 那由 `dmgMult` 本身表达 ⇒ 本处不再叠一层折减）。
 *
 * @param baseReloadMs 本条目的**基准**装填间隔（建档时已是"过完技能/射速计算机"的有效值）
 * @returns 本发要用的装填间隔（毫秒）；本门没挂该件 ⇒ 原样返回 `baseReloadMs`
 */
export function meOverlayReloadOf(
  spec: UnitSpec,
  tag: string,
  wi: number,
  b: import('../state').BattleState,
  baseReloadMs: number,
): number {
  const od = spec.weapons[wi]?.overlayDrive
  if (od === undefined) return baseReloadMs
  const step = Math.max(1, od.stepMs)
  const key = `${tag}#${wi}`
  const reg = b.meOverlayReload ?? (b.meOverlayReload = {})
  const cur = reg[key] ?? (reg[key] = { r: baseReloadMs, f: 0 })
  const next = Math.max(od.floorMs, baseReloadMs - (cur.f + 1) * step)
  reg[key] = { r: next, f: cur.f + 1 }
  return next
}

/**
 * **我方「三连射」的装填计时 ＋ 本轮记账**（**船长 2026-10-03 令**：「**添加一个旗舰同款的势力能量武器
 * （三连射）…射速为3000MS**」＋定名「三叉戟光束炮」）—— R 族势力激光炮（`mod-lair-beam-r`）专属。
 *
 * 口径与**敌方旗舰那把**（`foeBurstFired` 那一套）**逐字同款**：一轮装填打 `shots` 发、发间隔 `gapMs`；
 * **每发都各自**走一遍选靶 / 扣弹 / 命中 / 飘字（它们在外层循环里，本函数只管计时与记账）。
 * - 本轮**还有下一发** ⇒ 装填计时重置为 `max(0, gapMs − dtMs)`。
 *   ⚠ **减去本拍 `dtMs`** 是必需的：本仓开火环的节拍是"冷却减到 0 的那一拍不开火、下一拍才开火"
 *   ⇒ 直接写 `gapMs` 实得 **200ms**（敌方那张表 2026-10-02 实测踩过同一个坑）。
 * - 本轮**已打完** ⇒ 删除键，并交回 `meOverlayReloadOf`（既有那件装填自加速的出口，本仓两件互斥）。
 *
 * 缺省（本门没挂连发件）⇒ 与改动前**逐字一致**（走 `meOverlayReloadOf`，连一次多余判断都不多做）。
 */
export function meBurstReloadOf(
  spec: UnitSpec,
  tag: string,
  wi: number,
  b: import('../state').BattleState,
  dtMs: number,
  baseReloadMs: number,
): number {
  const burst = spec.weapons[wi]?.burst
  if (burst === undefined) return meOverlayReloadOf(spec, tag, wi, b, baseReloadMs)
  const shots = Math.max(1, Math.floor(burst.shots))
  const key = `${tag}#${wi}`
  const reg = b.meBurstFired ?? (b.meBurstFired = {})
  const fired = reg[key] ?? 0
  const more = fired + 1 < shots
  if (more) {
    reg[key] = fired + 1
    return Math.max(0, Math.round(burst.gapMs) - dtMs)
  }
  delete reg[key]
  return meOverlayReloadOf(spec, tag, wi, b, baseReloadMs)
}

/**
 * **我方「跃迁规避装置」的闪现触发器**，按船长裁定朝自身期望距离移动，冷却读取装备。
 * 只由"**敌方舰炮命中我方舰船本体**"调用
 * （打我方无人机不算、未命中不算；与敌方那件的受击钩子同口径）。
 *
 * **口径与敌方那件统一**（**船长 2026-10-01**：「**与敌舰统一口径**」）⇒ 两件都走同一条 `blinkStep`
 * （**朝目标走一跳、单次不超过件上的 `distanceM`**）。两件**只差"目标"这一项**：
 * - 敌方：目标是**它自己的期望交战距离**（它往它想站的位置闪）；
 * - 我方：目标是玩家当前期望交战距离，朝自身目标走一跳。
 *
 * 突变受既有钳制（`bal.minDistanceM` 与战场最大距离）；**闪不动时不白耗冷却**。
 *
 * @returns 本次是否真的闪了（供画面提示与闪现动画用）
 */
export function markMeBlink(
  spec: UnitSpec,
  tag: string,
  b: import('../state').BattleState,
  bal: BattleBalance,
  maxDistanceM: number,
): boolean {
  const bl = spec.meBlink
  if (bl === undefined || bl.distanceM <= 0 || bl.cooldownMs <= 0) return false
  const nowMs = b.lastTickGameMs
  if (nowMs < (b.meBlinks?.[tag] ?? 0)) return false // 冷却中 ⇒ 再挨打也不闪
  const landed = blinkStep(b.distanceM, b.myDesireM, bl.distanceM, bal.minDistanceM, maxDistanceM)
  if (landed === Math.round(b.distanceM)) return false // 无实际位移，不白盖冷却。
  /** 记账起点 = **取整后的位置**（与 `blinkStep` 内部同一把尺；理由同 `markFoeBlink` 那处） */
  const from = Math.round(b.distanceM)
  if (!b.meBlinks) b.meBlinks = {}
  b.meBlinks[tag] = nowMs + bl.cooldownMs
  /**
   * 🔴 **入队 + 到点才换位**（**船长 2026-10-02 §35 裁定「2甲」**：「**我方闪现的位移兑现点一并统一**」）
   * —— 旧实现在上面直接写 `b.distanceM = landed`（"触发即换位"）⇒ 我方的三段演出**没有"等待"**，
   * 而且界面拿不到时刻表（`foeBlinkQueue` 里没有我方 tag）⇒ **演出与光柱一格都不播**（§35.4 的现状）。
   * 现在与 `markFoeBlink` **逐字同构**：排进 `meBlinkQueue`，位移交 `settleBlinkQueue` 在 `moveAtMs` 兑现。
   * ⚠ 排队口径与敌方一致：从"已有各段里最晚的结束时刻 ＋ 间隔"起排本段（`.slice()` 先取快照）。
   */
  const queue = b.meBlinkQueue ?? (b.meBlinkQueue = {})
  let startMs = nowMs
  for (const q of Object.values(queue).slice()) startMs = Math.max(startMs, q.appearMs + blinkGapMs(bal))
  const vanishMs = startMs
  /** 三段的边界（同 `foeBlinkQueue` 头注）：消失 → **等待（位移在这一瞬兑现）** → 出现 */
  const moveAtMs = vanishMs + Math.round((blinkProcessMs(bal) * BLINK_VANISH_SHARE_NUM) / BLINK_SHARE_DEN)
  const appearMs = vanishMs + blinkProcessMs(bal)
  queue[tag] = { queuedMs: nowMs, vanishMs, moveAtMs, appearMs, from, to: landed }
  /**
   * **演出事件**（与敌方那条同款，含 `speedX`）——界面据此排"消失 / 等待 / 出现"三段与两根光柱。
   * ⚠ `atMs` 取 **`vanishMs`**（排队之后真正的起点），**不是**触发刻 —— 界面的排队错开就靠它。
   * ⚠ `speedX` 必须有：引擎给的是**游戏毫秒**、动画跑**真实毫秒**（敌方那条 2026-10-02 补过，此处对齐）。
   */
  pushBattleFx(b, {
    atMs: vanishMs,
    side: 'me',
    tag,
    type: 'kinetic',
    hit: true,
    blink: true,
    speedX: b.speedX ?? 1,
  })
  return true
}

export function countFoeBlinksAt(
  b: import('../state').BattleState,
  tag: string,
  cooldownMs: number,
): number {
  const until = b.foeBlinks?.[tag]
  if (until === undefined) return 0
  const elapsed = b.lastTickGameMs - (until - cooldownMs)
  if (elapsed < 0) return 0
  return Math.floor(elapsed / cooldownMs) + 1
}

/**
 * **闪现成功后的挂载件结算**（**船长 2026-10-01 令**）——把"闪现"这件事通知给两个挂在闪现上的装置：
 *
 * - **闪烁过载装置**（粼光级）：「**每次触发闪现后，恢复所有护盾值。但是会损失最大结构值5%的结构。**」
 *   ⇒ 护盾**直接回满**（`hpMax.s`，缺省回落规格 `spec.hp.s`），结构 −`hpMax.h × hullCostPct`；
 *   ⚠ **无保底、可扣死自毁**（船长选「乙」）——扣到 ≤0 就把护盾一并清零 ⇒ 该舰按既有"三层全空 = 阵亡"
 *   口径当场自毁，照常进战报与残骸（**不是**"死不掉"或"锁 1 点"）。
 * - **叠光装置**（叠光级）：「每次…闪现后，攻击间隔缩短」⇒ 这里调一次 `foeOverlayReloadOf` 把它推进一格
 *   （返回值由**开火**那处消费，本处只需保证闪现这一格被算进去）。
 *
 * ⚠ 只由"闪现**真的发生了**"调用（`markFoeBlink` 返回 true / 本函数自身的两个装置均缺省 ⇒ 什么都不做）。
 * 缺省不写 ⇒ 既有各族零行为变化。
 */
export function settleFoeBlinkExtras(
  rt: UnitSpec,
  tag: string,
  b: import('../state').BattleState,
  /** 本舰主武器的固定装填间隔（叠光级从调用点带进来；不带叠光的舰走缺省 ⇒ 本函数不推进装填） */
  baseReloadMs?: number,
): void {
  const fo = rt.foeFlashOverload
  if (fo !== undefined) {
    const rtUnit = b.units[tag]
    if (rtUnit !== undefined) {
      // ① 护盾回满（上限优先读容量，缺省回落规格 —— 与全仓「满盾」同一把尺）
      const capS = Math.max(0, rtUnit.hpMax?.s ?? rt.hp.s)
      rtUnit.hp.s = capS
      // ② 结构代价：**结构上限的 5%**（船长选「甲」）——无保底（船长选「乙」：可扣死自毁）
      const capH = Math.max(0, rtUnit.hpMax?.h ?? rt.hp.h)
      if (capH > 0 && fo.hullCostPct > 0) {
        rtUnit.hp.h = rtUnit.hp.h - capH * fo.hullCostPct
        if (rtUnit.hp.h <= 0) {
          rtUnit.hp.h = 0
          rtUnit.hp.s = 0
          rtUnit.hp.a = 0
        }
      }
    }
  }
  // 叠光装置：闪现也推进一格装填（写回登记表；下一发开火时由 `foeOverlayReloadOf` 读出）
  if (rt.foeOverlayDrive !== undefined && baseReloadMs !== undefined) {
    foeOverlayReloadOf(rt, tag, b, baseReloadMs)
  }
}
