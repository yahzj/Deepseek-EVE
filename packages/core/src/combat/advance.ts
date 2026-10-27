/** 战斗域：advance，从原引擎按职责迁移，保持结算顺序。 */
import { type GameState, addLog } from '../state'
import type { SimContext } from '../types'
import { matterTechBattleSpeedTiers } from '../matterTech'
import type { LairTier } from '../lairs'
import type { BattleSimulationOptions, UnitSpec } from './model'
import { battleClockNowMs, isAlive } from './combatMath'
import { applyFoeOverride, battleAnomalyOf, wormholeDerivedAnomaly } from './cards'
import { activeFoeSpecsOf, createFoeSpecs } from './foes/catalog'
import { battleOpenM, foeDesiredRange } from './foes/tactics'
import { seedUnit, initFoeDronePools, initFoeRepairPulses } from './foes/state'
import { foesWithSupport, resolveReinforcements, resolveFoeRevive, resolveFoeSummon } from './foes/reinforcements'
import { applyFoeRangeDebuff } from './foeRange'
import { buildMyUnitSpecs } from './fleetSpecs'
import { pdEnabledFor } from './droneWindow'
import { foeJudgedThreatOf } from './foePower'
import { syncCoronaFleetFocus } from './coronaFocus'
import { BATTLE_MAX_STEPS, BATTLE_STEP_MS } from './constants'
import { restoreFoeWebSpecs } from './captureWebs'
import { BATTLE_ARRIVAL_STAGGER_MS, WORMHOLE_FOE_VOLLEY_STAGGER_MS } from './combatFx'
import { advanceFoeAbilityClocks } from './alienCombat'
import { resolveDroneRevive } from '../droneRevive'
import { REPAIR_PULSE_MS, repairLedgersOf, pulseRepairsFor, shieldChargeLedgersOf, shieldChargeStreamsOf, pulseShieldChargeFor, shieldFieldStreamsOf, pulseShieldFieldFor } from './combatRepair'
import { stepBattle } from './step'
import { equipmentCycleMsOf } from '../equipment'
import { pulseFoeRepair, pulseFoeMountRepair } from './repairFoes'
import { advanceFoeRebirthRepair } from './gravekeeperCombat'

/** 多波演出窗口总时长（2026-09-09）：单次大预算推进（胜率 MC/校准工具）把 state.gameMs * 一次设到 maxBattleMs+余量——若波次间隙（waveEnterGapMs，战斗时钟冻结）吃掉余量，末段
 * 跨窗口会提前耗尽预算判负。调用方应在预算外加本值（无 waves = 0）。
 * （2026-10-02 批次 4j 迁到 combatMath.ts，本文件借回 + 再导出） */

/**
 * **解析本拍该跑多少倍速**（唯一判据点）：
 * - **非洞内战斗** ⇒ 1（倍速只属于虫洞，船长 2026-09-19）；
 * - **科技未解锁** ⇒ 1（`matterTechBattleSpeed` 1 = 没点过时间压缩矩阵）；
 * - 否则把传入档位**夹到已解锁档位**（界面传错 / 老档 / 改档都拿不到未解锁的速度）。
 */
export function resolveBattleSpeed(
  state: GameState,
  ctx: SimContext,
  battle: import('../state').BattleState,
  want: number,
): number {
  if (!battle.wormhole) return 1
  const tiers = matterTechBattleSpeedTiers(state, ctx)
  const pick = Math.floor(want)
  if (!Number.isFinite(pick) || pick <= 1) return 1
  let best = 1
  for (const t of tiers) if (t <= pick && t > best) best = t
  return best
}

/**
 * **推进指定战斗**（主控远征与 AI 远征通用）；结束后 ended 非空由调用方结算。
 *  favorAdv：AI 远征专属优势量 ∈[−1,1]（null = 玩家手动战斗，无 favor）——
 *  AI 方命中 ×(1+k·adv)（可到 100%），敌方 ×(1−k·adv)（上限保留 97%）。
 *  `opts.battleSpeedX`：**本拍想跑的倍速**（1 缺省 = 老行为）——**只由前台心跳传**，
 *  离线/后台结算/AI/胜率模拟一律不传 ⇒ 逐字等价；实际生效值还要过
 *  `resolveBattleSpeed` 的"洞内 + 已解锁档位"夹紧，写进 `battle.speedX` 供界面与演出窗口用。
 */
export function advanceBattleFor(
  state: GameState,
  ctx: SimContext,
  battle: import('../state').BattleState,
  shipId: string,
  anomalyId: string | null,
  favorAdv: number | null = null,
  lairTier?: LairTier,
  factionActive?: boolean,
  opts?: { battleSpeedX?: number; simulation?: BattleSimulationOptions },
): void {
  if (!battle || battle.ended) return
  // **倍速时间轴**（2026-09-19 · 谜质科技「时间压缩矩阵」）：先解析本拍生效倍速并写进战斗
  //（夹在科技已解锁档位内；洞外战斗恒 1）。写值只为**洞内**战斗——洞外保持"字段不存在"，
  // 演出窗口与界面据此逐字走老路径。
  const speedX = resolveBattleSpeed(state, ctx, battle, opts?.battleSpeedX ?? 1)
  if (battle.wormhole) battle.speedX = speedX
  /** 本拍的"现在"（战斗时钟口径；1× 时 = `state.gameMs`） */
  const nowMs = (): number => battleClockNowMs(state, battle)
  /** **每拍收尾：刷新倍速锚点**（把"此刻的全局时钟"与"此刻的战斗时钟"重新配对） */
  const rebaseAxis = (): void => {
    battle.speedAxis = { anchor: state.gameMs, clock: battle.lastTickGameMs }
  }
  const baseAnomaly = applyFoeOverride(battleAnomalyOf(ctx, anomalyId, lairTier, factionActive), battle.foeOverride)
  if (!baseAnomaly) return
  // 虫洞战斗（F 批）：**每拍按层重建**派生敌卡（**与开战同源**——同一处 `wormholeDerivedAnomaly`）
  const anomaly = battle.wormhole
    ? wormholeDerivedAnomaly(ctx, baseAnomaly, battle.wormhole)
    : baseAnomaly
  const bal = ctx.balance.battle
  /**
   * **本场的敌阵规格**（2026-09-24 起提前到这里）：只用于算**敌方干扰舰的射程压制率**
   * （`meRangeMulOf`，见 `buildMyUnitSpecs` 的入参说明）。⚠ `createFoeSpecs` 只吃 `anomaly` 与 `bal`，
   * **不依赖我方规格** ⇒ 提前建不改变任何既有口径（下游仍用同一份、同一序）。
   *
   * ⚠⚠ **2026-09-25 修：干扰压制必须取"当前波"**（`activeFoeSpecsOf(…, battle.waveIdx)`），
   * 不能取第 0 波。原先写 `createFoeSpecs(anomaly, bal)`（= **恒定第 0 波**）⇒ 多波卡里干扰舰在
   * 后续波出场时，**界面射程弧显示被压制、引擎实际开火门却是原射程**（两处各拿一份敌阵）。
   * 与视图（`battleArcsFor` 同一行取法）统一 ⇒ 显示与实际同一把尺。
   * ⚠ `foes`（下面 `foeDesire` / `openM` 用的那份）**照旧取第 0 波**：那是"开战距离"的既有口径，
   * 本次只动干扰压制这一件事，不顺手改距离账。
   */
  const foesForDebuff = activeFoeSpecsOf(anomaly, bal, battle.waveIdx)
  /**
   * **电子舰 · 压制敌舰射程**（2026-09-18）：**每拍重算**（运行态、不随档 ⇒ 换编队/读档都不陈旧）。
   * 编队口径 = `battle.myFleet`（单船路径取本条 `shipId`）。
   *
   * ⚠ **必须排在 `buildMyUnitSpecs` 之前**（2026-09-24 挪上来）：H 族干扰压制要按"敌方干扰 −
   * **我方电子舰**"算净削减，读的正是本函数写下的 `battle.meFoeRangeDebuff`；晚一步就会让本拍的
   * 我方规格吃错净削减（船长例①/②/③全走这一减）。
   */
  applyFoeRangeDebuff(state, ctx, battle, battle.myFleet?.map((e) => e.shipId) ?? [shipId])
  const myUnits = buildMyUnitSpecs(state, ctx, battle, shipId, anomalyId, foesForDebuff)
  if (myUnits.length === 0) {
    battle.ended = 'foe'
    return
  }
  const me = myUnits[0]! // 主控：距离 / 期望交距 / favor 等既有口径的锚（单船路径 = 唯一那条）
  /**
   * **本场开战距离**（= 首波口径）：只服务**转场回拉**（`waveReopenFrac`）与**增援补入**
   * （`resolveReinforcements`）。⚠ 敌方的"期望距离"与它的钳制上界**不用它**——那两个按**当前波**算，
   * 见下面 `foeDesire` 的注释。
   */
  const foes = createFoeSpecs(anomaly, bal)
  const openM = battleOpenM(me, foes, bal)
  const favor =
    favorAdv === null
      ? null
      : { meMul: 1 + bal.aiFavorStrength * favorAdv, foeMul: 1 - bal.aiFavorStrength * favorAdv }
  // 多波次（2026-09-09）：按 AnomalyDef.waves 分批推进；无 waves = 单波（现行为）
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const lastIdx = waves ? waves.length - 1 : 0
  /** 本波敌阵：与视图（`battleArcsFor`）**同一个取法** `activeFoeSpecsOf`（干扰压制两处同源） */
  const specsOf = (wi: number): UnitSpec[] => activeFoeSpecsOf(anomaly, bal, wi)
  let waveIdx = Math.min(battle.waveIdx ?? 0, lastIdx)
  let curFoes = specsOf(waveIdx)
  // 近防冷却是运行态，读档后按当前波补建；门槛与新开战斗同源，不重置机群血量。
  if (battle.pdCd === undefined && pdEnabledFor(foeJudgedThreatOf(anomaly), bal) && Object.keys(battle.dronePools ?? {}).length > 0) {
    battle.pdCd = curFoes.map(() => Math.max(100, Math.round(bal.pdJudgementMs)))
  }
  /**
   * **本波敌方的期望距离与钳制上界**（`let`：**换波时按新一波重算**）。
   *
   * 船长 2026-09-25 报障①：「**敌人期望距离似乎不会变化？**」——病根就在这两行的**初值**：
   *
   * - **必须取"当前波"**（`curFoes`）—— 2026-09-25 早前那版只加了"**换波时刷新**"，可那个分支
   *   只在**同一次调用里**跑完整个转场（清空→等演出窗口→续刷下一波）时才会执行；而引擎是**逐拍调用**
   *   `advanceBattleFor` 的：转场发生在第 N 拍，第 N+1 拍进来时 `battle.waveIdx` 已经是新波、
   *   转场分支不再触发 ⇒ 初值又用**第 0 波**那份 `foes` 算了一遍。
   *   实测（旗舰战 · 真实引擎）：第 2 波（墨潮鱼雷舰 ×3 ＋ 干扰舰，`kite` 带 1,000~12,000）
   *   引擎里 `foeDesire` 恒为 **2,352**（第 1 波突击舰的值），而界面按当前波显示 **10,350**
   *   ⇒ 敌人**实际往里收**、读数却写"想拉开"。
   *
   * 口径（与视图同一把尺）：
   * - `foeDesire` = `foeDesiredRange(本波敌阵)`（含我方电子舰削减、含条目/舰级的 `desireRangeM` 钉值）；
   * - `desireCapM` = `battleOpenM(me, 本波敌阵)` —— 即「**这一波若单独开战，开战距离在哪**」，
   *   与视图 `Math.min(openM, foeDesiredRange(...))` 的钳制上界同源；
   * - ⚠ **单波场次逐字等于旧行为**（同一份敌阵、同一算式，只算一次）。
   */
  let foeDesire = foeDesiredRange(me, curFoes, bal, battle.meFoeRangeDebuff ?? 0)
  let desireCapM = battleOpenM(me, curFoes, bal)
  // 开战首波由 startBattleFor 生成（无装填延迟）；此处只兜读档中断补缺（视为增援入场）
  for (const f of curFoes) {
    // ⚠ 单波次内增援（2026-09-11 船长裁决：机制实现、不启用）：**带入场触发、条件未命中的单位
    // 不许在这里补缺**——否则每次推进都会把"还没该到的援军"直接塞进战场（本批用例抓到过这个洞）。
    // 它们只由下面的 `resolveReinforcements` 按条件补入；开关关闭时本字段一律不存在 → 本行不生效。
    if (f.foeReinforceAt) continue
    // 读档中断补缺 = 视为"增援入场" ⇒ 同样盖入场窗口（时刻取**全局时钟**，理由同转场那一处）
    seedUnit(battle, f, { enterReload: true, arrivedAtMs: nowMs() })
  }
  syncCoronaFleetFocus(battle, foesWithSupport(battle, curFoes))
  let guard = 0
  while (nowMs() > battle.lastTickGameMs && !battle.ended && guard < BATTLE_MAX_STEPS) {
    guard++
    restoreFoeWebSpecs(curFoes)
    // 切波：当前波全灭且还有后续波 → 先走演出窗口（爆炸/残骸播完），窗口结束才续刷下一波。
    // 窗口语义（2026-09-09 船长反馈"切换突兀/爆炸未播完就刷下一波"）：
    // - 清空瞬间记 waveClearAt = 战斗时钟 + waveEnterGapMs；窗口内本拍只停表等待
    //   （battle.lastTickGameMs 不推进——与击杀慢镜同语义：演出时间不计入 maxBattleMs 超时）；
    // - 实时战斗中游戏时钟与墙钟 1:1，窗口 = 上一波最后一艘的爆炸 + 残骸淡出完整播完；
    // - 大步长/离线推进下 state.gameMs 越过窗口即立刻续刷，无额外等待。
    if (
      waves &&
      waveIdx < lastIdx &&
      // 参战敌阵含**已入场的支援舰**（`sup{n}-`）：它们还活着就不算本波清空（否则"复活出来的船
      // 还在场，下一波却已经刷出来"，两份编队同时在打）
      !foesWithSupport(battle, curFoes).some((f) => isAlive(battle, f.tag))
    ) {
      // ⚠ 转场窗口在**洞内现行玩法里几乎走不到**（网格层一律单波，只有老档 `pendingNode` 路径可能多波）；
      //   这里的 `× speedX` 与 `battleShowWindowMs` 同一口径（倍速只压进度、不压演出）
      const gapMs = Math.max(0, bal.waveEnterGapMs ?? 0) * speedX
      /** **进入本拍时就已经在等**转场窗口（= 真的等过一段，而不是"本拍才发现全灭、本拍就续刷"） */
      const pendingGap = battle.waveClearAt !== undefined
      if (gapMs > 0 && battle.waveClearAt === undefined) {
        battle.waveClearAt = battle.lastTickGameMs + gapMs
        const waveName = ctx.galaxies.get(anomaly.galaxyId)?.name ?? ''
        addLog(
          state,
          'warn',
          `⚔ 第 ${waveIdx + 1}/${waves.length} 波已全灭（${waveName ? waveName + '·' : ''}${anomaly.name}），` +
            (bal.waveReopenEnabled === true ? '敌方增援正在从远处入场…' : '敌方增援正在入场…'),
        )
      }
      if (gapMs > 0 && battle.waveClearAt !== undefined && nowMs() < battle.waveClearAt) break // 演出窗口未走完：停表等待，下一拍再续
      /**
       * **这一波是不是"真的等过转场窗口"**（`pendingGap`：进入本拍时 `waveClearAt` 就已经在）。
       * 只有它为真时才盖入场窗口（船长 2026-09-14「动画没结束不开火」）：
       * - **实时**：清空那一拍先记 `waveClearAt` 并 `break`，等 33 拍后才走到这里 ⇒ **等过** ⇒ 有动画、给窗口；
       * - **大步长 / 离线补算**：一次推进就跨过了整个窗口（本拍才发现全灭、`state.gameMs` 一上来就 ≥
       *   `waveClearAt`）⇒ **没等过**、玩家根本没看见过转场（也就没有动画可言）⇒ **不盖窗口**，
       *   行为与改动前逐字一致（否则"离线结算时最后一波敌人免疫到本次推进结束"⇒ 该赢的场次会被
       *   拖成超时判负——`tests/wave-battle.test.ts` 的大步长用例抓到过）；
       * - `waveEnterGapMs = 0`（无转场节拍）⇒ 同样不盖（没有转场演出，也就没有入场动画）。
       */
      const waitedGap = pendingGap
      battle.waveClearAt = undefined
      waveIdx += 1
      battle.waveIdx = waveIdx
      /**
       * **换波 ⇒ 记下本波起点**（**船长 2026-10-02 改判**：「**旗舰挂载件的会随波重置**」）——
       * 「聚焦阵列」的远端衰减爬升以它为计时锚（`foeWaveStartMsOf`）；取 `nowMs()`（= 全局时钟，
       * 即新一波**真正入场**的那一刻）而不是 `battle.lastTickGameMs`：转场窗口里战斗时钟是**冻住**的
       * （上面那条"停表等待"），拿冻住的值当"现在"会把起点算到过去（与 `arrivedAtMs` 同一处坑）。
       */
      battle.foeWaveStartMs = nowMs()
      curFoes = specsOf(waveIdx)
      /**
       * **换波 ⇒ 期望距离与钳制上界随新一波刷新**（船长 2026-09-25 报障；口径详见上面 `foeDesire` 的注释）。
       * 位置在 `curFoes` 换新之后、`seedUnit` 之前 —— 本拍之内新一波就已按自己的期望距离机动。
       */
      foeDesire = foeDesiredRange(me, curFoes, bal, battle.meFoeRangeDebuff ?? 0)
      desireCapM = battleOpenM(me, curFoes, bal)
      // 增援入场装填（转场窗口）+ **入场窗口**（船长 2026-09-14「动画没结束不开火」）：
      // 逐舰错峰写进 `enteredAtMs`，与界面 `--arrive-delay` 同一算式 ⇒ 动画演完才可被选中。
      // ⚠⚠ **入场时刻取 `state.gameMs`（全局时钟 / 本帧结束时的推进目标），绝不能取 `battle.lastTickGameMs`**
      //   ——转场窗口内战斗时钟是**冻住**的（上面那条"停表等待"），此刻它还是"上一波全灭那一刻"的值；
      //   本帧收尾时战斗时钟会**追平**全局时钟（实测：一帧内推进了 3300ms）⇒ 拿冻住的值当"现在"
      //   会把窗口算到**过去**（真 BUG：窗口一出生就已过期、新一波照样在登场那一拍被打死）。
      //   按全局时钟算 ⇒ 窗口 = **追平之后实实在在的 950ms**（实测：14800 入场 → 15900 才掉第一滴血）。
      if (waitedGap) {
        curFoes.forEach((f, i) =>
          seedUnit(battle, f, {
            enterReload: true,
            arrivedAtMs: nowMs() + i * BATTLE_ARRIVAL_STAGGER_MS * speedX,
            // 洞内：同一波新入场的敌舰也按序错开首轮（见 `WORMHOLE_FOE_VOLLEY_STAGGER_MS`）
            ...(battle.wormhole ? { foePhaseMs: i * WORMHOLE_FOE_VOLLEY_STAGGER_MS } : {}),
          }),
        )
      } else {
        curFoes.forEach((f, i) =>
          seedUnit(battle, f, {
            enterReload: true,
            ...(battle.wormhole ? { foePhaseMs: i * WORMHOLE_FOE_VOLLEY_STAGGER_MS } : {}),
          }),
        )
      }
      // 近防炮调度随波重建（pdCd 与敌编队同序）
      if (battle.pdCd && battle.dronePools) {
        battle.pdCd = curFoes.map(() => Math.max(100, Math.round(bal.pdJudgementMs)))
      }
      // 敌机机群随波重建（2026-09-11 机群批）：每波单位是新对象、tag 也不同 ⇒ 旧池自然作废
      initFoeDronePools(battle, curFoes);
      // 挂载件「船体修理装置」账本（幂等）：新波里挂了这件的单位补账本，已在账上的**不重置计时**
      initFoeRepairPulses(battle, curFoes);
      // 波次转场（2026-09-09 船长建议）：把战斗距离向开战距离回拉 waveReopenFrac 比例——
      // 增援从"更远的接战距离"进入，双方重新接近（重演接近期，kite/远程敌同样被拉回）；
      // 0 = 原地续战（旧行为），1 = 完整回到开战距离
      // ⚠ **2026-09-11 船长：「将敌人增援波次距离会后退的惩罚暂时关闭」** ⇒ 本段由**总开关
      //   `waveReopenEnabled`** gate（现值 false = 关闭）：关闭时**距离原地不动**，下一波在当前交战距离入场，
      //   玩家可见日志同步改为中性表述（不再说"从远处入场 / 重新接近中"——否则文案与实际不符）。
      //   机制整套保留：把开关改回 true 即恢复 2026-09-09 口径。
      const reopenOn = bal.waveReopenEnabled === true
      const reopen = reopenOn ? (bal.waveReopenFrac ?? 0) : 0
      if (reopen > 0 && Number.isFinite(openM)) {
        battle.distanceM = Math.round(openM * reopen + battle.distanceM * (1 - reopen))
      }
      const waveName = ctx.galaxies.get(anomaly.galaxyId)?.name ?? ''
      addLog(
        state,
        'warn',
        `⚔ 第 ${waveIdx + 1}/${waves.length} 波来袭（${waveName ? waveName + '·' : ''}${anomaly.name}）：` +
          (reopenOn ? '敌方增援自远处入场，重新接近中。' : '敌方增援入场。'),
      )
      continue
    }
    // 单波次内增援（2026-09-11 船长裁决：机制实现、不启用）——每拍结算"尚未入场"的编成条目；
    // 放在 `stepBattle` **之前**：上一拍刚打死的单位本拍即可触发援军，且判胜检查看到的是补入后的编队。
    // 总开关关闭时本函数第一步就返回（且建档期也没写过 `foeReinforceAt`）= 零行为变化。
    resolveReinforcements(state, ctx, battle, anomaly, curFoes, bal, openM)
    /**
     * **支援舰召唤**（船长 2026-09-25：「支援舰船召唤装置」）——与上面那条同位置（`stepBattle` 之前）：
     * 上一拍刚打死的僚舰，本拍就能被"复活/支援"补回场；没挂该件的战斗第一步就返回（零行为变化）。
     */
    const dt = Math.min(BATTLE_STEP_MS, nowMs() - battle.lastTickGameMs)
    advanceFoeAbilityClocks(battle, curFoes, dt)
    resolveFoeRevive(state, battle, curFoes, bal, nowMs())
    resolveFoeSummon(state, battle, curFoes, bal, battle.lastTickGameMs)
    /**
     * **无人机储备甲板：每拍复位**（2026-09-27 船长令）——与上面那条**同位置**（`stepBattle` 之前）：
     * 本拍到点补回来的那架，这一拍就重新进开火循环/选靶池。
     * 周期到点判定读的是**战斗时钟** ⇒ 离线大步长一次跨多秒也照样把该补的架数按周期逐格补齐
     * （"离线折算"不必另写公式）；没装这件装备 ⇒ 字段不存在 ⇒ 一步返回（零行为变化）。
     */
    resolveDroneRevive(state, ctx, battle, nowMs())
    /**
     * **本拍参战敌阵**（编成 ＋ 已入场支援舰）——**必须在 `resolveFoeRevive` 之后取**：
     * 本拍刚召唤入场的支援舰这一拍就进开火循环/选靶池（支援舰与编成的关系见 `foesWithSupport`）。
     */
    const liveFoes = foesWithSupport(battle, curFoes)
    if (!battle.foeRepair && liveFoes.some(f => (f.repairPct ?? 0) > 0)) {
      battle.foeRepair = { nextPulseAtMs: battle.lastTickGameMs + REPAIR_PULSE_MS, pulses: 0, healed: 0 }
    }
    stepBattle(
      state,
      battle,
      myUnits,
      liveFoes,
      foeDesire,
      // **钳制上界取"本波"的开战距离**（`desireCapM`；单波场次 = 上面的 `openM`，逐字不变）
      desireCapM,
      bal,
      dt,
      favor,
      waves ? waveIdx < lastIdx : false,
      // 敌方选靶模式（虫洞内敌卡专属；缺省 random）——单船路径不消费选靶随机数，见 pickMyUnitTarget
      anomaly.foeTargeting ?? 'random',
      // 倾向概率（2026-09-14 船长定 0.6；缺省 1 = 铁律 ⇒ 洞外场次连一次骰都不掷）
      anomaly.foeTargetingChance ?? 1,
      opts?.simulation,
    )
    battle.lastTickGameMs += dt
    // 连续作战保险（2026-09-08 船长定，仅巡回场次 battle.hullEscapeFrac 有值）：
    // 本场结构损失过半（剩余 < 满值结构 × 阈值）→ 中止步进并请求自动撤退，绝不拖到弃船
    if (!battle.autoEscaped && battle.hullEscapeFrac !== undefined) {
      const pl = battle.units['player']
      if (pl && pl.hp.h < me.hp.h * battle.hullEscapeFrac) {
        battle.autoEscaped = true
        battle.escapeReason = 'hull'
        break
      }
    }
    /**
     * 船体维修装置脉冲（**逐舰 · 逐台** · 2026-09-16 船长「甲」＋ **2026-09-21 逐型号独立回转**）：
     * 本拍内到期的脉冲补齐——修复发生在受伤结算之后（≤1 拍延迟，保守口径）；战斗结束/自动撤退后不再补跳。
     *
     * ⚠ **2026-09-21 船长令**：「**哪怕同类型装备，只要是不同型号，就要独立的回转冷却**」⇒ 循环从
     * "逐舰、一跳结算全部装置"改为**逐舰 × 逐台**：每台装置按**自己的** `nextPulseAtMs` 到点就跳，
     * 各修各的量（改前第一台跳完这一拍就结束，装三台与装一台几乎没差别）。
     *
     * ⚠ **旧档迁移**（在途战斗没有逐台字段）：借账本那一个 `nextPulseAtMs` 当"本拍是否到期"，
     * 到期后给所有未停机装置**同时补上这一跳并各自排下一跳**（等价于旧口径的"一跳结算全部"，
     * 只是从此转入逐台计时；迁移不需要升版本、不动存档字段名）。
     */
    if (!battle.ended && repairLedgersOf(battle).length > 0) {
      const specByTag = new Map(myUnits.map((u) => [u.tag, u]))
      for (const { tag, ledger } of repairLedgersOf(battle)) {
        if (battle.ended) break
        const spec = specByTag.get(tag)
        if (!spec) continue // 该舰已不在这场（沉了/被摘）⇒ 它的账本不跳
        const owner = battle.myFleet?.find(e => e.tag === tag)?.shipId ?? shipId
        const interval = equipmentCycleMsOf(state, ctx, owner, REPAIR_PULSE_MS)
        /** 逐台：own = 本台自己的计时器；旧档（无逐台字段）⇒ 借账本的统一计时器（本拍只判一次到期） */
        const hasPerUnit = ledger.units.some((u) => u.nextPulseAtMs !== undefined)
        if (!hasPerUnit) {
          const legacyAt = ledger.nextPulseAtMs
          if (legacyAt === undefined || legacyAt > battle.lastTickGameMs) continue
          /** 迁移落地：本拍给所有未停机装置补跳一次，并把它们各自的计时器排到本拍时刻之后 */
          for (const u of ledger.units) {
            if (u.stopped) continue
            u.nextPulseAtMs = legacyAt
            }
        }
        for (const unit of ledger.units) {
          if (battle.ended) break
          if (unit.stopped) continue
          if (unit.nextPulseAtMs === undefined || unit.nextPulseAtMs > battle.lastTickGameMs) continue
          let guardR = 0
          while (
            !battle.ended &&
            unit.nextPulseAtMs !== undefined &&
            unit.nextPulseAtMs <= battle.lastTickGameMs &&
            guardR < BATTLE_MAX_STEPS
          ) {
            const alive = pulseRepairsFor(state, ctx, battle, spec, ledger, specByTag, unit)
            if (!alive) {
              // 本舰阵亡 ⇒ 全部装置永久停机（脉冲函数已把账本计时清空）
              for (const u2 of ledger.units) u2.nextPulseAtMs = undefined
              break
            }
            /**
             * ⚠ **逐台计时器由谁前移**：`pulseRepairsFor` 只负责"结算这一跳"，计时器推进在**这里** ——
             * 与另两族（流里 `nextPulseAtMs += ms`）同款，避免"结算函数既改业务又管调度"两处口径。
             *
             * ⚠⚠ **必须判"这一跳之后它还活着吗"**：组件耗尽 / 修不动都会在结算里把该台 `stopped` 或
             * 清掉它自己的计时器；这里若无条件前移，就会把刚清掉的计时器**又写回来**
             * （我第一版就是这么错的：最后一台停机那一跳之后账本还留着 20,000，用例当场抓出）。
             */
            if (unit.stopped) {
              unit.nextPulseAtMs = undefined
              if (!ledger.units.some((u) => !u.stopped)) ledger.nextPulseAtMs = undefined
              break
            }
            unit.nextPulseAtMs = (unit.nextPulseAtMs ?? battle.lastTickGameMs) + interval
            guardR++
          }
        }
      }
    }
    /**
     * **敌方后勤脉冲**（船长 2026-09-16）：只在场上存在 `repairPct > 0` 的敌舰时才有账本
     * （`battle.foeRepair` 由开战建档；缺省 ⇒ 零开销、零行为变化）。
     * 与维修装置同节拍（5 秒），在受伤结算之后补跳；一记脉冲 = 累加一跳修理量。
     */
    if (!battle.ended && battle.foeRepair) {
      let guardF = 0
      while (
        !battle.ended &&
        battle.foeRepair.nextPulseAtMs !== undefined &&
        battle.foeRepair.nextPulseAtMs <= battle.lastTickGameMs &&
        guardF < BATTLE_MAX_STEPS
      ) {
        pulseFoeRepair(battle, liveFoes, battle.foeRepair)
        battle.foeRepair.nextPulseAtMs += REPAIR_PULSE_MS
        guardF++
      }
    }
    /**
     * **挂载件「船体修理装置」脉冲**（船长 2026-09-24）：逐单位各按各的计时器（键 = 战斗 tag），
     * 拍点与后勤脉冲同节拍（5 秒）、在受伤结算之后补跳（≤1 拍延迟）。
     * 账本由开战/换波建档时按"真有单位挂了这件"建（缺省 ⇒ 本块直接跳过 ⇒ 零开销、零行为变化）。
     */
    if (!battle.ended && battle.foeRepairPulses) {
      for (const f of foes) {
        if (battle.ended) break
        if (f.foeRepairPulse === undefined) continue
        const ledger = battle.foeRepairPulses[f.tag]
        if (!ledger) continue
        let guardM = 0
        while (
          !battle.ended &&
          ledger.nextPulseAtMs !== undefined &&
          ledger.nextPulseAtMs <= battle.lastTickGameMs &&
          guardM < BATTLE_MAX_STEPS
        ) {
          pulseFoeMountRepair(battle, f, ledger)
          ledger.nextPulseAtMs += Math.max(1, Math.round(f.foeRepairPulse.everyMs))
          guardM++
        }
      }
    }
    if (!battle.ended && battle.foeRebirths) {
      for (const f of foes) {
        if (battle.ended || f.foeRebirthProtocol === undefined) continue
        const record = battle.foeRebirths[f.tag]
        if (!record || record.startedAtMs === undefined) continue
        advanceFoeRebirthRepair(battle, f, battle.lastTickGameMs)
      }
    }
    /**
     * 护盾充能装置脉冲（逐舰 · **逐型号** · 2026-09-16 逐舰化 ＋ **2026-09-21 逐型号独立回转**）：
     * 与维修装置各按各的计时（15秒与5秒），同样在受伤结算之后补跳。
     *
     * ⚠ **一场一路一跳**：每路按自己的 `nextPulseAtMs` 到点就跳、只补**那一路**的比例
     * （船长令：「不同型号就要独立的回转冷却」）。改前是"一跳补合计值"——MK1 与 MK3 混装会被
     * 并成一路，弱档的量被并进强档的节奏里。
     */
    if (!battle.ended && shieldChargeLedgersOf(battle).length > 0) {
      const specByTag = new Map(myUnits.map((u) => [u.tag, u]))
      for (const { tag, ledger } of shieldChargeLedgersOf(battle)) {
        if (battle.ended) break
        const spec = specByTag.get(tag)
        if (!spec) continue
        const owner = battle.myFleet?.find(e => e.tag === tag)?.shipId ?? shipId
        const currentStreams = shieldChargeStreamsOf(state, ctx, owner)
        for (const stream of ledger.streams) {
          const current = currentStreams.find(s => s.modelId === stream.modelId)
          // 在途旧比例跟随现行参数；空型号旧流仍保留合并计时，截止时刻不重排。
          stream.pct = current?.pct ?? (stream.modelId === '' && currentStreams.length > 0
            ? currentStreams.reduce((sum, s) => sum + s.pct, 0) : stream.pct)
          stream.ms = current?.ms ??
            (stream.modelId === '' && currentStreams.length > 0 ? Math.min(...currentStreams.map(s => s.ms)) : stream.ms)
          if (battle.ended) break
          if (stream.nextPulseAtMs === undefined || stream.nextPulseAtMs > battle.lastTickGameMs) continue
          let guardS = 0
          while (
            !battle.ended &&
            stream.nextPulseAtMs !== undefined &&
            stream.nextPulseAtMs <= battle.lastTickGameMs &&
            guardS < BATTLE_MAX_STEPS
          ) {
            pulseShieldChargeFor(battle, spec, ledger, stream)
            ledger.pulses += 1
            stream.nextPulseAtMs += Math.max(1, stream.ms)
            guardS++
          }
        }
      }
    }
    /**
     * **力场脉冲**（2026-09-20 船长「护盾充能力场装置」）：与上面两套**各自计时** ——
     * **逐型号各带各的冷却**（`stream.ms`：MK2 = 10 秒 / MK3 = 8 秒；**2026-09-21 船长令**：
     * 「哪怕同类型装备，只要是不同型号，就要独立的回转冷却」⇒ 由"取最短那一档的一路"改为**逐路**）。
     *
     * ⚠ **必须独立门控**（不能挂在护盾充能那段 `if` 里）：力场与「护盾充能装置」是**两族两件**，
     * 玩家完全可能只装力场不装充能装置 —— 第一版我把它写在上面那个 `if` 内，
     * 结果"只装力场 ⇒ 一跳都不跳"（用例当场抓出）。
     *
     * 2026-10-07：只恢复其他存活单位，有目标且足够支付时才扣施放者满盾代价；排程照旧。
     *
     * ⚠ **本跳的绝对回盾量按"本路施放者（装件舰）的满盾"算**（**2026-09-25 船长改判**：
     * 「恢复量为本舰护盾量的 10%」）⇒ 逐路把**该路的施放者**传给 `pulseShieldFieldFor`；
     * 多舰各带一件时，各路的施放者不同 ⇒ **各按自己满盾各跳一路**。
     */
    if (!battle.ended && Object.keys(battle.shieldFieldBy ?? {}).length > 0) {
      const specByTagF = new Map(myUnits.map((u) => [u.tag, u]))
      for (const [tag, ledger] of Object.entries(battle.shieldFieldBy!)) {
        if (battle.ended) break
        if (!specByTagF.get(tag) || !isAlive(battle, tag)) continue
        const owner = battle.myFleet?.find(e => e.tag === tag)?.shipId ?? shipId
        const currentStreams = shieldFieldStreamsOf(state, ctx, owner)
        for (const stream of ledger.streams) {
          const current = currentStreams.find(s => s.modelId === stream.modelId)
          stream.pct = current?.pct ?? (stream.modelId === '' && currentStreams.length > 0
            ? currentStreams.reduce((sum, s) => sum + s.pct, 0) : stream.pct)
          stream.ms = current?.ms ??
            (stream.modelId === '' && currentStreams.length > 0 ? Math.min(...currentStreams.map(s => s.ms)) : stream.ms)
          if (battle.ended) break
          if (stream.nextPulseAtMs === undefined || stream.nextPulseAtMs > battle.lastTickGameMs) continue
          let guardF = 0
          while (
            !battle.ended &&
            stream.nextPulseAtMs !== undefined &&
            stream.nextPulseAtMs <= battle.lastTickGameMs &&
            guardF < BATTLE_MAX_STEPS
          ) {
            pulseShieldFieldFor(battle, myUnits, stream, specByTagF.get(tag)!)
            ledger.pulses += 1
            stream.nextPulseAtMs += Math.max(1, stream.ms)
            guardF++
          }
        }
      }
    }
  }
  // 本拍收尾：把倍速锚点重新配对（下一拍按新锚点起算增量 ⇒ 切档连续、1× 与老口径逐字一致）
  rebaseAxis()
}
