/** 战斗域：step，从原引擎按职责迁移，保持结算顺序。 */
import type { GameState } from '../state'
import type { UnitSpec, BattleSimulationOptions } from './model'
import type { BattleBalance, FoeTargetingMode } from '../types'
import { syncPlayerCrisis, advancePlayerRebirth, playerGravekeeperSpecOf } from './gravekeeperGear'
import { syncFoeCapacitors, advanceFoeRebirthRepair } from './gravekeeperCombat'
import { syncCoronaFleetFocus } from './coronaFocus'
import { advanceFoeHatcheries, foeFleetSpeedMulOf } from './alienCombat'
import { expireFoeAcidLayers } from './alienEquipment'
import { BATTLE_VOLLEY_WINDOW_MS } from './constants'
import { snapshotFoeStandby } from './damage'
import { thrusterPhase, unitThrusterCycle, updateFoeCharge, unitSpeedMulOf, combatSpeed, steerStep, effectiveHitMul } from './movement'
import { foeDesiredRange, battleMaxDistanceM } from './foes/tactics'
import { expireFoeWebs, advanceMyCaptureWebs } from './captureWebs'
import { isAlive, clamp } from './combatMath'
import { settleBlinkQueue, blinkHoldSides } from './blink'
import { FOE_SUPPORT_TAG_RE } from './foeCard'
import { isFoeEngageable, resolvePointDefense } from './combatDrones'
import { firePlayerPhase } from './playerFire'
import { fireEnemyPhase } from './enemyFire'
import { SHIELD_REGEN_FLOOR_PCT } from './combatRepair'
import { pushBattleNotice } from './combatFx'
import { isAliveAnyOf } from './targeting'

/**
 * 一步战斗推进。
 *
 * **多单位（虫洞 D 批 · 船长 2026-09-13）**：`myUnits` 恒为**我方编队**——单船路径传 `[me]` 一条，
 * 虫洞内传 `[主控, ...僚舰]`（见 `BattleState.myFleet`）。硬纪律：**`myUnits.length === 1` 时
 * 每一处多单位分支都必须与改动前逐字等价**（尤其**随机数消费顺序**——选靶函数在"只剩一艘"时
 * 直接返回、一次 `nextRandom` 都不多消耗），否则既有 27 张卡的标定读数会整体漂移。
 */
export function stepBattle(
  state: GameState,
  b: import('../state').BattleState,
  baseMyUnits: readonly UnitSpec[],
  foes: UnitSpec[],
  foeDesire: number,
  /**
   * **敌方期望距离的钳制上界**（米）。传的是**本波**的开战距离（`advanceBattleFor` 的 `desireCapM`，
   * 换波即刷新）——原语义 = 本场开战距离；单波场次二者逐字同值。
   */
  openM: number,
  bal: BattleBalance,
  dtMs: number,
  favor: { meMul: number; foeMul: number } | null = null,
  hasMoreWaves = false, // 多波（2026-09-09）：本波清空但还有后续波 → 不判胜，由推进方切波续刷
  /** 敌方选靶模式（虫洞内敌卡专属；`random` = 等权随机，多单位下的缺省） */
  foeTargeting: FoeTargetingMode = 'random',
  /**
   * **选靶倾向概率**（船长 2026-09-14「虫洞敌人的攻击倾向，加一个概率」→「挨个定为 60%」）：
   * `1` = 铁律（缺省，不掷骰）· `<1` ⇒ 每发开火前掷一次，没掷中退回随机（见 `pickMyUnitTarget`）。
   */
  foeTargetingChance = 1,
  simulation?: BattleSimulationOptions,
): void {
  syncPlayerCrisis(b, baseMyUnits)
  for (const spec of baseMyUnits) advancePlayerRebirth(b, spec, b.lastTickGameMs)
  const myUnits = baseMyUnits.map(spec => playerGravekeeperSpecOf(b, spec))
  if (simulation) {
    b.distanceM = simulation.distanceM
    for (const foe of foes) {
      const rt = b.units[foe.tag]
      if (rt) rt.hp = { s: simulation.layer === 's' ? 1e12 : 0, a: simulation.layer === 'a' ? 1e12 : 0, h: simulation.layer === 'h' ? 1e12 : 0 }
    }
  }
  const dtSec = dtMs / 1000
  syncFoeCapacitors(b, foes)
  for (const foe of foes) if (foe.foeRebirthProtocol) advanceFoeRebirthRepair(b, foe, b.lastTickGameMs)
  syncCoronaFleetFocus(b, foes)
  advanceFoeHatcheries(b, foes, b.lastTickGameMs)
  expireFoeAcidLayers(b)
  // 齐射承伤仍按原100ms归组，不能随内部步长缩小而拆开保险。
  const volleyWindow = Math.floor((b.lastTickGameMs - b.startedAtGameMs) / BATTLE_VOLLEY_WINDOW_MS)
  if (b.meVolleyWindow !== volleyWindow) {
    b.meVolleyWindow = volleyWindow
    b.meVolleyDmg = {}
  }
  /**
   * **本拍开头：把「待机护盾阵列」的就绪态定死**（**船长 2026-10-03 裁定**「**同一拍整次齐射都算**」）——
   * 必须在**任何伤害结算之前**盖这一份（伤害结算在前、闪现盖冷却在后 ⇒ 现查的话只有触发那一发吃得到）。
   * 只扫带该件的单位 ⇒ 其余场次零成本、零行为变化。
   */
  snapshotFoeStandby(b, foes)
  // 主控 = 编队首条（距离/期望交距/胜率口径的锚；单船路径即唯一那条）
  const me = myUnits[0]!

  // ── 距离机动（无过冲转向：每方朝自己期望距离推进，剩余距离不足本步航程时只走剩余，
  //    到位即停；双方意图相反时在中间形成无振荡角力平衡，杜绝"到点来回抖动"）──
  // 2026-09-10 船长（推进器周期爆发）：我方机动 = 基础机动 ×(1 + 推进器爆发倍率)——**只在爆发窗口内**；
  // 冷却期回到基础值（不再常驻加成）。
  // 2026-09-14 船长（微型跃迁引擎）：窗口**逐单位**判定——各舰按自己装配的周期算（见 `unitThrusterCycle`）。
  const phaseOf = (u: UnitSpec): boolean => thrusterPhase(b, bal, unitThrusterCycle(u, bal)).boosting
  // **整队机动 = 存活我方单位的「平均」战斗机动**（虫洞 D 批 · 船长 2026-09-13 选定"整队平均"）——
  // 与敌方 2026-09-11 定的「敌舰速度按所有船的平均值算」**同一把尺**；单船 = 该船自己（逐字不变）。
  // 爆发倍率**逐舰各取自己的**（装微型跃迁引擎那条只在它自己的 10 秒窗口里快；其余船维持 60/60）——
  // 全队同款推进器时与改前逐字等价（相位与倍率都相同 ⇒ 平均速度 ×(1+倍率)）。
  // 敌方期望距离不得超出开战距离（近距开局下 kite 战术系数可能越界 → 钳制，避免一直想拉开）
  const normalDesire = foes.some(f => f.acidBurst) ? foeDesiredRange(me, foes, bal, b.meFoeRangeDebuff ?? 0, b) : foeDesire
  const foeDesireClamped = Math.min(openM, normalDesire);
  // 冲锋状态机（2026-09-14 船长改判：**逐单位** + **自身炮台命中解除** + 冷却 10 秒）——
  // ⚠ **顺序**：先更新状态、再算接近速度（倍率由状态读出来，见 `unitSpeedMulOf` 的单点）。
  // 触发条件（乙）与"到达期望交距"兜底都在 `updateFoeCharge` 里；本处只管"读状态算速度"。
  updateFoeCharge(b, foes, bal, b.lastTickGameMs, foeDesireClamped)
  // **捕获网解除**（船长 2026-09-16「击杀发动者即解除」＋ **2026-09-26「这个断开对敌我都有效」**）
  // ——每拍清理"施放者已不在场"与"交战距离超过 4500 米"的条目
  expireFoeWebs(state, b, foes)
  // **我方捕获网**（**船长 2026-09-26** · 墨潮捕获网）：周期账本推进（选目标/冷却/解除）＋
  // 把三层效果（机动 ×0.5 · 推进器全关 · 闪避归零）**每拍重新施加**到本拍敌阵上
  advanceMyCaptureWebs(state, b, myUnits, foes)
  // **整队机动 = 存活单位的「平均」战斗机动 ×各自倍率**（倍率单点 = `unitSpeedMulOf`）：
  // 我方倍率 = 推进器**周期爆发**（逐单位周期）；敌方倍率 = **冲锋**（逐单位状态）。
  // ⚠ 冲锋倍率**不外溢**（船长 2026-09-11：「冲锋还是按照巨兽自己的速度算…哪怕是冲锋也是按照巨兽速度」）：
  // 逐单位乘各自倍率**再取平均** ⇒ 只有正在冲的那条吃到倍率。
  // **2026-09-14 船长改判（本批）**：删掉旧的 `max(编队平均, 冲锋者速度 × 全局倍率)` 补丁——
  // 那条写法在"逐单位各自倍率"下已不成立（小虫 1.5 与巨兽 3 各异），改回**纯平均**：
  // 例 C 族噬口第 3 波（小虫 544×1.5 ×3 条 + 巨兽 297×3 ×1 条）⇒ 编队接近速度
  // = (816×3 + 891) ÷ 4 = **834.8 m/s**（旧的 `max(编队最快, 冲锋者×倍率)` 补丁会给 891）。
  // 敌方接近速度沿用 2026-09-11 船长口径（「能否敌舰移动速度按照敌方是所有船的平均值算」）：
  // 原口径是**取最快单位**（`Math.max`）——混编卡里一条快船会把整队拖快：例 穹顶守卫
  // = 2 静滞卫舰（129）+ 1 守墓长舰（232）⇒ 原口径整队按 **232** 走，与「静滞卫舰是半速炮台」
  // 的设定相冲；改平均后该队按 **163**（战斗机动 92）走。
  // 同速编成（单舰卡 / 同型多舰卡，如 A 族头目+同族杂鱼、C 族虫群）**逐字不变**（平均值 = 该速度）。
  let meV = 0
  /** **面板同源口径**（见下方落盘注释）：只乘机动倍率，**不乘 `combatSpeed` 的 speedFactor/敏捷修正** */
  let mePanel = 0
  {
    let n = 0
    for (const u of myUnits) {
      if (!isAlive(b, u.tag)) continue
      const mul = unitSpeedMulOf(u, b, bal, 'me')
      meV += combatSpeed(u.speedMps, u.agility, bal) * mul
      mePanel += u.speedMps * mul
      n += 1
    }
    if (n > 0) {
      meV /= n
      mePanel /= n
    }
  }
  let foeV = 0
  let foePanel = 0
  let foeAliveN = 0
  const fleetSpeedMul = foeFleetSpeedMulOf(b, foes)
  for (const f of foes) {
    if (!isAlive(b, f.tag)) continue
    const mul = unitSpeedMulOf(f, b, bal, 'foe') * fleetSpeedMul
    foeV += combatSpeed(f.speedMps, f.agility, bal) * mul
    foePanel += f.speedMps * mul
    foeAliveN += 1
  }
  if (foeAliveN > 0) {
    foeV /= foeAliveN
    foePanel /= foeAliveN
  }
  /**
   * **落盘给界面显示的那对速度 = 面板同源口径**（2026-09-16 船长：「**战斗中实际速度和面板显示的机动速度
   * 不一致**」⇒ 裁决「**只修改战斗显示数值，实际数值不变动**」）。
   *
   * 两套口径的分工（都保留、都不改）：
   * - **引擎推进/距离拔河** = 上面那对 `meV` / `foeV`（= `combatSpeed` ⇒ 含全局 `speedFactor 0.6`
   *   与敏捷修正，逐拍驱动 `b.distanceM`）——**一字不动**；
   * - **界面显示** = 本对（= 单位自身 `speedMps` × 机动倍率，逐单位取平均）⇒ **与装配页「机动速度」
   *   同一把尺**：我方点火期 = `speedMps × (1+推进器倍率)`（装配页那行「加力推进点火期」）、
   *   敌方冲锋期 = `speedMps × 冲锋倍率`（敌卡/体检里的"实速 ×倍率"）。
   * 这样面板与战斗读数不再对不上，而战斗手感/触发线/标定完全不受影响。
   */
  b.meSpeedMps = Math.round(mePanel)
  b.foeSpeedMps = Math.round(foePanel)
  const rate =
    steerStep(b.distanceM, b.myDesireM, meV, dtSec) +
    steerStep(b.distanceM, foeDesireClamped, foeV, dtSec)
  // **距离上限 = 战场远端**（2026-09-19 船长裁定「甲」）：按**当前**双方有效射程现算（含我方技能/科技
  // 增程与敌方受击增程），只增不减、无增程时逐字等于 `openM` ⇒ 见 `battleMaxDistanceM` 的头注。
  // **2026-09-22 船长令**：我队**全队**（`myUnits`）的最远射程一并计入 ⇒ 僚舰装远射武器也能拉开战场。
  b.distanceM = clamp(bal.minDistanceM, battleMaxDistanceM(b, me, foes, bal, myUnits), b.distanceM + rate)

  /**
   * 🔴 **兑现"到点的闪现位移"**（**船长 2026-10-02 令**：「**移动的时间节点应该放在发生时间的等待处**」）——
   * 位置不再在"触发那一刻"就换，而是**推迟到本段演出演完「消失」、进入「等待」的那一瞬**（`moveAtMs`）。
   * 放在走位之后、开火之前：本拍换好 ⇒ 后面的开火/命中判定与画面严格同拍。
   */
  settleBlinkQueue(b)
  if (simulation) b.distanceM = simulation.distanceM

  // ── 我方开火（主炮 + 无人机条目）——**逐舰结算**（单船路径 = 只循环一次，逐字等价）──
  // 开火失稳代价只在点火期生效（2026-09-10 船长：没点火就不失稳）——每次开火取当前有效乘子，
  // 冷却期 = 1（不改 me 本身，避免污染其它读法）；**逐舰各取自己的 `hitMul`**。
  /**
   * **本拍"谁因闪现演出禁火"**（船长 2026-10-01 令 ＋ **2026-10-02 §35 扩为双向**）——
   * **每拍只算一次**（循环外）：原来放在"每门炮"里，那是 O(门数 × 队列段数) 的重复扫描，纯浪费。
   * ⚠ **两侧各判各的表**：我方开火读 `blinkHold.me`（= 敌表在窗口）；敌方开火读 `blinkHold.foe`
   * （= 我表在窗口）。判据与理由见 `blinkHoldSides` 头注。
   */
  const blinkHold = blinkHoldSides(b)
  /** 敌方那一半（**2026-10-02 §35**）：我表在窗口 ⇒ **敌方**不开火。同拍只算一次，供下面敌方开火段读。 */
  const foeBlinkHold = blinkHold.foe
  const meAtkOf = (u: UnitSpec): UnitSpec =>
    phaseOf(u) ? u : { ...u, hitMul: effectiveHitMul(u, false) }
  // 新波主编队尚在入场且无可攻击目标时保留装填；单波内召唤/补位不改原节奏。
  const awaitingWaveArrival = (b.waveIdx ?? 0) > 0 &&
    foes.some(f => !FOE_SUPPORT_TAG_RE.test(f.tag) && isAlive(b, f.tag) && b.units[f.tag]?.enteredAtMs !== undefined) &&
    !foes.some(f => isFoeEngageable(b, f.tag))
  firePlayerPhase(state, b, myUnits, foes, me, bal, dtMs, favor, blinkHold, meAtkOf, awaitingWaveArrival, simulation)
  fireEnemyPhase(state, b, myUnits, foes, me, bal, dtMs, favor, foeBlinkHold, foeTargeting, foeTargetingChance)


  // ── 敌方点防（2026-09-10 船长「无人机可被击落」）：对我方放飞机群逐架结算 ──
  // ⚠ 机群池自 2026-09-14「逐舰机群」起是**逐舰**建的（键 = `舰tag:武器下标`，见 4803 一带），
  //   敌方点防也**逐舰选靶**（`pdFocus` 按池键存）⇒ 本条注释此前那句"仍只结算主控的机群"已过期，一并改正。
  resolvePointDefense(state, b, foes, bal, dtMs)

  // ── P0：护盾战中被动回充（EVE 式；损失不跨场，只回盾层）。
  // 甲/结构已打穿时停止回充——避免"只剩一层盾皮"的无限僵持（P2 可再调）
  // 2026-10-13：当前盾1.2%/秒，下限满盾0.6%/秒；破盾仍不被动恢复。
  syncPlayerCrisis(b, baseMyUnits)
  for (const spec of baseMyUnits) advancePlayerRebirth(b, spec, b.lastTickGameMs + dtMs)
  if (bal.shieldRegenPerSec > 0) {
    for (const unit of myUnits) {
      const urt = b.units[unit.tag]
      if (!urt || !isAlive(b, unit.tag)) continue
      // ⚠ 满盾优先取战斗单位的 `hpMax.s`；老档/异常缺省时回退到该单位的 `spec.hp.s`（= 满盾口径）
      const sMax = urt.hpMax?.s ?? unit.hp.s
      if (urt.hp.s >= sMax || (urt.hp.a <= 0 && urt.hp.h <= 0)) continue
      // 后续被动恢复来源同区加算，不为各个来源另开乘区。
      const regenMul = 1 + (unit.shieldPassiveBonusPct ?? 0)
      const floor = sMax * SHIELD_REGEN_FLOOR_PCT
      const rate = urt.hp.s > 0 ? Math.max(urt.hp.s * bal.shieldRegenPerSec, floor) * regenMul : 0
      const regen = rate * dtSec
      if (regen > 0) urt.hp.s = Math.min(sMax, urt.hp.s + regen)
    }
  }

  // ── 隐秘行动装置（2026-09-15 船长）：**窗口到点即现形** —— "先到者为准"的另一支
  //    （开火那一支在上面 `stats.meShots` 处已处理）⇒ 一直没开火也不会永久隐身。──
  for (const unit of myUnits) {
    const urt = b.units[unit.tag]
    const until = urt?.stealthUntilMs
    if (urt && until !== undefined && b.lastTickGameMs >= until) {
      urt.stealthUntilMs = undefined
      pushBattleNotice(b, '隐秘行动结束：隐身窗口到点，本舰现形')
    }
  }

  // ── 结束判定 ──
  if (simulation) for (const foe of foes) {
    const rt = b.units[foe.tag]
    if (rt) rt.hp = { s: simulation.layer === 's' ? 10000 : 0, a: simulation.layer === 'a' ? 10000 : 0, h: simulation.layer === 'h' ? 10000 : 0 }
  }
  // 溢火结算读完致死前层抗后，再清掉死亡目标的酸蚀。
  expireFoeAcidLayers(b)
  // **判负 = 我方全灭**（虫洞 D 批 · 船长 2026-09-13 定）：主控沉了僚舰继续打；
  // 单船路径下"全灭"与"主控沉"等价 ⇒ 与改动前逐字一致。
  const meAlive = isAliveAnyOf(b, myUnits)
  const foeAlive = foes.some((f) => isAlive(b, f.tag))
  if (!meAlive) {
    b.ended = 'foe'
    expireFoeAcidLayers(b)
    return
  }
  if (!foeAlive) {
    // 多波未完：本波清空不判胜（推进方下一拍切波续刷）；末波清空 = 胜利
    if (!hasMoreWaves) {
      b.ended = 'me'
      expireFoeAcidLayers(b)
    }
    return
  }
  // **无法交战 ⇒ 提前脱战**（2026-09-11 船长裁定「乙2 · 事件为 120 秒」）：
  // 三件同时成立 —— ①开战满 `bal.cannotEngageMs`；②我方**全程一炮未发**（`stats.meShots === 0`，
  // 开过一炮就永不触发）；③当前距离仍**在我方最远射程之外**且**敌人已经开火**（`stats.foeShots > 0`，
  // 即"它在打我、我打不着它"）。判负口径与「超时判负」同源（结算侧走轻损撤退、**不掷弃船骰**），
  // 只把 `escapeReason` 记为 'cannot-engage'，好让战报写明"我方射程不足"。
  // 数值一个字不动：这一条只决定**什么时候收场**（灰霾 ②/⑤/③ 原为打满 600 秒触顶；
  // 蜃影/赤潮三行原是 140/373 秒被打死）。双方都够不着（敌也未开火）**不触发**，仍走 `maxBattleMs`。
  if (
    !b.ended &&
    bal.cannotEngageMs > 0 &&
    b.lastTickGameMs - b.startedAtGameMs >= bal.cannotEngageMs &&
    b.stats.meShots === 0 &&
    b.stats.foeShots > 0
  ) {
    const myTopRangeM = myUnits.reduce(
      (m, u) => u.weapons.reduce((mm, w) => Math.max(mm, w.maxRangeM), m),
      0,
    )
    if (b.distanceM > myTopRangeM) {
      b.ended = 'foe'
      b.autoEscaped = true
      b.escapeReason = 'cannot-engage'
    }
  }
  if (b.lastTickGameMs - b.startedAtGameMs >= bal.maxBattleMs) {
    // 超时判负（2026-09-10 船长定）：打满战斗上限**不再按剩余血量比判胜**（旧口径
    // "meRatio >= bestFoe 即我方胜"= 平局算赢，已作废），一律判负并按**撤退**处理——
    // 置 autoEscaped 交给结算侧走轻损撤退路径（远征据 escapeReason 区分文案）。
    // 动机：旧口径下"打不死但打不着我"的风筝流可白拿全额赏金（见 docs/design/
    // mixed-damage-review-20260910.md §6、docs/design/timeout-defeat-20260910.md）。
    b.ended = 'foe'
    b.autoEscaped = true
    b.escapeReason = 'timeout'
  }
  if (b.ended) expireFoeAcidLayers(b)
}
