/** 战斗域：enemyFire，从原引擎按职责迁移，保持结算顺序。 */
import type { GameState } from '../state'
import type { UnitSpec } from './model'
import type { BattleBalance, FoeTargetingMode } from '../types'
import { isFoeEngageable } from './combatDrones'
import { triggerAcidBurst, applyAlienCorrosion, advanceFoeHatcheries } from './alienCombat'
import { pickMyUnitTarget, isAliveAnyOf } from './targeting'
import { hitChance, clamp, applyDamage, isAlive } from './combatMath'
import { nextRandom } from '../rng'
import { applyPlayerUnitDamage, applyFoeShot } from './damage'
import { pushBattleFx, pushBattleNotice } from './combatFx'
import { aloftDroneSet } from './droneWindow'
import { foeCapacitorMultiplierOf, noteFoeCapacitorAttack } from './gravekeeperCombat'
import { foeDroneRangeOf, foeGunMaxRangeOf, foeGunPowerFactorOf } from './foeRange'
import { foeOverlayReloadOf, foeWaveStartMsOf, markMeBlink } from './blink'
import { coronaFocusFalloffOf } from './coronaFocus'
import { volleyGunCountOf, volleyDamageShareOf } from './combatVolley'
import { fireFoeCaptureWeb } from './captureWebs'
import { foeRepairDiscountedShot } from './repairFoes'
import { ceilFinalQuantity } from '../quantity'
import { releaseFoeChargeOnHit } from './movement'
import { battleMaxDistanceM } from './foes/tactics'

export function fireEnemyPhase(state: GameState, b: import('../state').BattleState, myUnits: readonly UnitSpec[], foes: UnitSpec[], me: UnitSpec, bal: BattleBalance, dtMs: number, favor: { meMul: number; foeMul: number } | null, foeBlinkHold: boolean, foeTargeting: FoeTargetingMode, foeTargetingChance: number): void {


  // ── 敌方开火（按**选靶模式**打我方；单船路径 = 恒打唯一那艘、零随机数消费） ──
  for (const f of foes) {
    if (f.acidBurst && isFoeEngageable(b, f.tag)) triggerAcidBurst(b, f, 'attack', b.lastTickGameMs + dtMs)
  }
  // 包含玩家炮火、全体攻击及溢火产生的死亡爆发；每只结算一次，伤害先于自身腐蚀。
  for (const f of foes) {
    const event = b.acidBursts?.[f.tag]
    const acid = f.acidBurst
    if (!acid || !event || event.resolved) continue
    event.resolved = true
    const target = pickMyUnitTarget(state, b, myUnits, foeTargeting, foeTargetingChance)
    let hit = false
    let dealt = 0
    if (target) {
      const rt = b.units[target.tag]!
      const chance = hitChance({ hitRate: acid.hitRate ?? .95, minRangeM: 1, maxRangeM: acid.deathRangeM, falloff: 1 }, f, target, b.distanceM, bal, 1)
      hit = nextRandom(state.rng) < (favor ? clamp(0, .97, chance * favor.foeMul) : chance)
      b.stats.foeShots += 1
      if (hit) {
        b.stats.foeHits += 1
        const apply = (raw: number) => applyDamage(rt.hp, target.resists, raw, 'kinetic', acid.shieldDamageMul)
        dealt = applyPlayerUnitDamage(state, b, target.tag, target, acid.damage ?? 0, 'kinetic', raw => apply(raw).hp)
      }
    }
    pushBattleFx(b, { atMs: event.atMs, side: 'foe', tag: f.tag, ...(target ? { to: target.tag } : {}),
      type: 'kinetic', acidBurst: true, hit, ...(dealt > 0 ? { dmg: dealt } : {}) })
    // 2026-10-07 船长确认：逐只追加腐蚀，仍先伤害后施加自身减抗。
    b.alienCorrosion = (b.alienCorrosion ?? 0) + acid.corrosionPct
    for (const u of myUnits) applyAlienCorrosion(u, b.alienCorrosion)
  }
  for (const u of myUnits) applyAlienCorrosion(u, b.alienCorrosion ?? 0)
  advanceFoeHatcheries(b, foes, b.lastTickGameMs + dtMs)
  for (const f of foes) {
    const rt = b.units[f.tag]
    if (!rt || !isAlive(b, f.tag)) continue;
    // 本发（本次齐射）的目标：**每次开火前重选**——目标被打沉后自动换人，与"每发独立抽敌人"对称。
    const pickTarget = (): { spec: UnitSpec; rt: import('../state').BattleState['units'][string] } | null => {
      const spec = pickMyUnitTarget(state, b, myUnits, foeTargeting, foeTargetingChance)
      if (!spec) return null
      const urt = b.units[spec.tag]
      return urt ? { spec, rt: urt } : null
    }
    // ── 敌方机群开火（2026-09-11 机群批）──
    // 逐架独立装填、独立掷命中（与我方无人机条目同款口径：`src:'drone'` + `artId` 供演出层识别）。
    // ⚠ 本段**放在主武器之前**：主武器有 `continue`（无弹分支之外还有 beam 分支的 continue），
    //   放在循环尾部会被那些 `continue` 跳过。
    // 池与 drone 条目**同序**（`initFoeDronePools` 按 slot 顺序展开），故用独立计数 `di` 对位。
    const fPools = b.foeDronePools?.[f.tag]
    if (fPools && fPools.length > 0 && isAliveAnyOf(b, myUnits)) {
      // **备用机库补位到位**（2026-09-12 船长「损坏后补充敌机」）：到点的备用机翻成**在空**并**满血**放出
      for (const p of fPools) {
        if (p.inHangar !== true || p.readyAtMs === undefined) continue
        if (b.lastTickGameMs < p.readyAtMs) continue
        p.inHangar = false
        p.readyAtMs = undefined
        p.alive = true
        p.s = p.maxS ?? p.s
        p.a = p.maxA ?? p.a
        p.h = p.maxH ?? p.h
      }
      // **单次出击上限**（2026-09-12 船长「限制敌机单次出击数量」）：本拍只有"在空窗口"里的架次能开火，
      // 其余在机库待命（装填也冻着 ⇒ 轮到它时即打）。缺省不写该字段 ⇒ `aloft = null` ⇒ 全群照旧同时开火。
      const launch = f.foeDroneLaunch
      const reloadBase = f.weapons.find((w) => w.src === 'drone')?.reloadMs ?? 4400
      const aloft = launch
        ? aloftDroneSet(fPools, launch, reloadBase, b)
        : null
      const activeCount = fPools.filter((p) => p.alive && p.inHangar !== true).length
      const kAloft = launch
        ? Math.max(1, Math.min(Math.round(launch.maxAloft), Math.max(1, activeCount)))
        : 0
      // `keepDps`（推荐）：在空架次的有效装填 ×(k ÷ 在场架数) ⇒ **平均 DPS 守恒**（限制的是同时在空数）
      const aloftReload = (base: number): number =>
        launch && launch.keepDps === true && kAloft > 0 && activeCount > 0
          ? Math.max(200, Math.round((base * kAloft) / activeCount))
          : base
      let di = 0
      for (let k = 0; k < f.weapons.length; k++) {
        const dw = f.weapons[k]!
        if (dw.src !== 'drone') continue
        const pool = fPools[di]
        const idx = di
        di += 1
        if (!pool || !pool.alive) continue; // 已被防空武器击落的架次：停火（条目保留占位）
        if (pool.inHangar === true) continue; // **备用机**：在库待命（不开火、不算在场架数）
        if (aloft && !aloft.has(idx)) continue; // **不在本批出击窗口**：在库待命（装填冻结）
        const dcd = rt.weapons[k] ?? 0
        if (dcd > 0) {
          rt.weapons[k] = Math.max(0, dcd - dtMs)
          continue
        }
        /**
         * 🔴 **闪现演出禁火 · 敌方那一半**（**船长 2026-10-02 §35 令**：「**我方触发闪现时，闪现禁火
         * 对敌人也生效**」）——我方某段闪现正处在演出窗口里（见 `BattleState.meBlinkQueue`）⇒
         * **本架敌机这一拍不开火**。口径与我方那处**逐字对称**：**冷却照推**、转好了停在 0 等窗口，
         * 窗口一过立刻开火（不白扣一发）。
         */
        if (foeBlinkHold) {
          rt.weapons[k] = Math.max(0, dcd - dtMs)
          continue
        }
        rt.weapons[k] = Math.min(Number.MAX_SAFE_INTEGER, Math.round(aloftReload(dw.reloadMs) * foeCapacitorMultiplierOf(b, f, k, 'reloadMul')))
        // 射程门：**受击增程**生效时读 `foeDroneRangeOf`（机型射程 × 倍率），否则就是机型射程
        if (b.distanceM > foeDroneRangeOf(b, dw, f)) continue // 机群够不着（我方在它射程外）
        // 选靶（多单位）：**每架敌机独立选靶**——与我方"每发独立抽敌人"同款粒度
        const dtgt = pickTarget()
        if (!dtgt) break // 我方已全灭（正常由结束判定收场）
        b.stats.foeShots += 1;
        /**
         * **全队令牌**（**2026-09-27 船长令**：「**将反击原本是被打的舰船反击改为全队反击一次（对我方也生效）**」）：
         * 挨打即刷新**共用**时刻 `droneHitAt.me`；`droneHitAtMeBy` 从"挨打记录"改由**消费处独占**
         * （记"本舰已对哪一次令牌反击过"）⇒ 这里不再写它。
         *
         * ⚠ **旧实现在逐舰路径下从不写 `droneHitAt.me`**（`if (逐舰表) 写逐舰表; else 写共用令牌`）——
         * 而上一条令改判据后读的正是 `droneHitAt.me` ⇒ 这里**必须无条件写**，否则我方近防炮一发都不反击。
         */
        b.droneHitAt = { ...(b.droneHitAt ?? {}), me: b.lastTickGameMs }
        const dType = dw.fixedType ?? 'kinetic';
        // 机群为掷命中（`fixed`）：吃自己的 `hitRate`、吃我方回避与距离衰减——与我方无人机同源
        const droneHit = hitChance(dw, f, dtgt.spec, b.distanceM, bal)
        const droneHitEff = favor
          ? clamp(0, 0.97, droneHit * favor.foeMul)
          : droneHit
        const dHit = nextRandom(state.rng) < droneHitEff
        /** 本发对**被打的那艘我方舰**的实收伤害（2026-09-24 船长令：飘字读数；未命中保持 0） */
        let dDealt = 0
        if (dHit) {
          b.stats.foeHits += 1
          dDealt = applyPlayerUnitDamage(state, b, dtgt.spec.tag, dtgt.spec,
            (dw.shotDmg ?? 0) * foeCapacitorMultiplierOf(b, f, k, 'damageMul'), dType,
            r => applyFoeShot(dtgt.rt.hp, dtgt.spec.resists, dw, r, dType))
          if (f.foeShieldCapacitor) {
            noteFoeCapacitorAttack(b, f, k)
            rt.weapons[k] = Math.min(Number.MAX_SAFE_INTEGER, Math.round(aloftReload(dw.reloadMs) * foeCapacitorMultiplierOf(b, f, k, 'reloadMul')))
          }
        }
        pushBattleFx(b, {
          atMs: b.lastTickGameMs + dtMs,
          side: 'foe',
          tag: f.tag,
          to: dtgt.spec.tag,
          type: dType,
          src: 'drone',
          artId: dw.artId,
          hit: dHit,
          ...(dDealt > 0 ? { dmg: dDealt } : {}),
        })
      }
    }
    if (f.acidBurst) continue
    const w = f.weapons[0]!
    const cd = rt.weapons[0] ?? 0
    if (cd > 0) {
      rt.weapons[0] = Math.max(0, cd - dtMs)
      continue
    }
    /**
     * 🔴 **闪现演出禁火 · 敌方那一半**（**船长 2026-10-02 §35 令**：「**我方触发闪现时，闪现禁火
     * 对敌人也生效**」）——我方某段闪现正处在演出窗口里（见 `BattleState.meBlinkQueue`）⇒
     * **本舰这一发不开火**。口径与我方那处**逐字对称**：**冷却照推**、转好了停在 0 等窗口，
     * 窗口一过立刻开火（不白扣一发）。
     * ⚠ 门槛放在 `foeOverlayReloadOf` **之前**：与"没到点"那支同一口径 ⇒ 停火期间**叠光格不推进**
     *   （我方那处也是先过禁火门、再调 `meOverlayReloadOf`，两侧一致）。
     */
    if (foeBlinkHold) {
      rt.weapons[0] = Math.max(0, cd - dtMs)
      continue
    }
    /**
     * **本发的装填间隔**（**船长 2026-10-01 令**：「**添加叠光装置：效果是每次攻击或者闪现后，
     * 攻击间隔缩短，最多缩短至0.5秒攻击间隔。伤害给予一个0.3的倍率。**」）——
     * 挂了「叠光装置」的舰（R 族 T3 叠光级）用**当前间隔**重置计时（首访问 = 条目的固定 `reloadMs`，
     * 此后每开一火 −400ms、夹下限 500ms、闪现另算一格）；没挂的舰走缺省 ⇒ **返回 `w.reloadMs`，
     * 读数与行为逐字不变**。⚠ 间隔的递减状态记在 `BattleState.foeOverlayReload[tag]`（运行态、不入档）。
     *
     * 🔴 **连发优先**（**船长 2026-10-02 令**：「**每次开火是三次间隔100ms的射击，目标选择随机。**」）
     * —— 挂了连发的舰（R 族 T5 光环中枢）：本轮**前 `shots − 1` 发之后装填重置为 `gapMs`**（100ms），
     * 打完**最后一发才回到 `reloadMs`** ⇒ 三连发天然按 100ms 摊在既有"一次装填一发"的开火环上，
     * 每发各走一遍下面的选靶（**逐发独立随机选靶**）。⚠ 连发期间**不调 `foeOverlayReloadOf`**
     * （本仓两件互斥：挂了连发的舰不挂叠光；写成"每发都调"会让两条机制互相污染）。
     * 没挂连发的舰 ⇒ `burst` 缺省 ⇒ 与改动前**逐字一致**（连一次判断都不多做）。
     */
    const burst = w.burst
    const burstFired = burst !== undefined ? (b.foeBurstFired?.[f.tag] ?? 0) : 0
    const burstMore = burst !== undefined && burstFired + 1 < Math.max(1, Math.floor(burst.shots))
    /**
     * ⚠ **连发的"发间隔"要减掉一拍**（`− dtMs`）：本仓开火环的固有节拍是"**冷却减到 0 的那一拍不
     * 开火、下一拍才开火**"（`cd > 0 ⇒ 递减并 continue`）⇒ 直接写 `gapMs` 会实得 **200ms** 而不是
     * 船长要的 **100ms**（2026-10-02 探针实测：三连阶梯 1.80s → 2.00s → 2.20s）。减掉本拍 `dtMs`
     * 后：`gapMs = 100 · dt = 100 ⇒ 置 0 ⇒ 下一拍即开火` = 真正的 100ms；`gapMs` 更大时同样成立
     * （实得格数 = `⌈gapMs ÷ dt⌉`）。⚠ 只在连发期间生效，最后一发照旧回到 `reloadMs`（那一拍不算）。
     */
    rt.weapons[0] = burstMore
      ? Math.max(0, Math.round(burst!.gapMs) - dtMs)
      : foeOverlayReloadOf(f, f.tag, b, Math.min(Number.MAX_SAFE_INTEGER, Math.round(w.reloadMs * foeCapacitorMultiplierOf(b, f, 0, 'reloadMul'))))
    if (burst !== undefined) {
      const reg = b.foeBurstFired ?? (b.foeBurstFired = {})
      // 打完这一发：本轮还有剩余 ⇒ 记已发数；本轮打完 ⇒ 删键（下一发重新从第 1 发起算）
      if (burstMore) reg[f.tag] = burstFired + 1
      else delete reg[f.tag]
    }
    /**
     * **聚焦阵列：当拍的远端衰减**（**船长 2026-10-02 令**：「**武器的远端衰减，随时间提高到1
     * （就是无衰减）。**」＋改判「**旗舰挂载件的会随波重置**」）——挂了件的舰（R 族 T5 光环中枢）
     * 按本波起点现算爬升后的 falloff；动态射程由 foeGunMaxRangeOf 同源计算。
     * 面板 0.2 + 120 秒 ⇒ 第 60 秒 0.6、第 120 秒起 1.0（**无衰减**）。
     *
     * ⚠ **没挂件的舰 ⇒ `wShot === w`（同一个对象引用）** ⇒ 下游两条折减调用与改动前逐字一致
     * （连一次对象复制都不发生）；挂了件也只多一次浅拷贝。
     */
    const wShot =
      f.foeFocusArray !== undefined
        ? {
            ...w,
            falloff: coronaFocusFalloffOf(
              w.falloff,
              f.foeFocusArray.rampMs,
              b.lastTickGameMs - foeWaveStartMsOf(b),
            ),
          }
        : w
    // V18B（2026-09-05 船长拍板）：敌人近盲带（dist < minRange）内**不停火**——放行到
    // maxRange 内即可开火；伤害按 blindDmgMul 打折（玩家贴脸钻近盲不再零风险）。
    // 玩家武器无此待遇（近盲带内仍不开火）——双方在近盲带上行为区分。
    // 射程门：**炮台受击增程**生效时读 `foeGunMaxRangeOf`（原射程 × 倍率；仅带该字段的舰）
    if (b.distanceM > foeGunMaxRangeOf(b, f, w)) continue
    const gunCount = volleyGunCountOf(w)
    const capacitorDamageMul = foeCapacitorMultiplierOf(b, f, 0, 'damageMul')
    let capacitorHit = false
    // 敌主武器仍保存整组总伤；各门共享本轮装填、独立命中。
    let volleyTarget: ReturnType<typeof pickTarget> = null
    for (let gun = 0; gun < gunCount; gun++) {
      // 选靶（多单位）：**本发开火前重选**（上一次齐射可能已把目标打沉）
      if (!volleyTarget || !isAlive(b, volleyTarget.spec.tag)) volleyTarget = pickTarget()
      if (!volleyTarget) break // 我方已全灭（正常由结束判定收场）
      const gtgt = volleyTarget
      // **劫掠捕获网**（船长 2026-09-16）：「在自身第一次开火时发动」——**不看命中**，
      // 就在这一发之前钉住本发目标（于是这一发的命中判定也吃到"闪避归零"）。
      // ⚠ ⟪2026-09-25 船长报障⟫：目标**已被别的网钉住**时本舰的网**不算用掉**（保留到它钉住新目标为止）
      // —— 该判定在 `fireFoeCaptureWeb` 内部，这里只判"本舰还没发过"。
      if (f.foeCaptureWeb !== undefined && b.foeWebFired?.[f.tag] !== true) {
        fireFoeCaptureWeb(state, b, f, gtgt.spec)
      }
      b.stats.foeShots += 1
      const fType = w.fixedType ?? 'kinetic'
      // 2026-09-08（船长定）：能量（beam）= 必中——不掷命中骰；威力：近盲带内 ×blindDmgMul
      // （近盲带保留），带内至远端按 beamPowerFactor 距离衰减（与玩家激光同源语义）
      if (w.kind === 'beam') {
        // **炮台受击增程感知的折减**（船长选乙：原射程内读数一字不变，延长段同斜率外推）
        const pow = b.distanceM < w.minRangeM ? w.blindDmgMul ?? 0.3 : foeGunPowerFactorOf(b, f, wShot, b.distanceM)
        const dmg = volleyDamageShareOf(foeRepairDiscountedShot(f, Math.max(1, ceilFinalQuantity((w.shotDmg ?? 0) * pow * capacitorDamageMul))), gunCount, gun)
        // 冲锋解除（船长 2026-09-14）：光束必中 ⇒ 本发即"自身炮台命中我方"
        releaseFoeChargeOnHit(b, f.tag, bal, f.foeChargeCooldownMs)
        b.stats.foeHits += 1
        capacitorHit = true
        // 混伤（2026-09-10 船长）：按逐系单发各自结算（各系吃自己的层位克制与层抗）
        const beamDealt = applyPlayerUnitDamage(state, b, gtgt.spec.tag, gtgt.spec, dmg, fType,
          r => applyFoeShot(gtgt.rt.hp, gtgt.spec.resists, w, r, fType))
        pushBattleFx(b, { atMs: b.lastTickGameMs + dtMs, side: 'foe', tag: f.tag, to: gtgt.spec.tag, type: fType, hit: true, ...(beamDealt > 0 ? { dmg: beamDealt } : {}) })
        /**
         * **我方「跃迁规避装置」触发点**，沿用受击触发规则。**敌方舰炮命中我方舰船本体**这一支（打我方无人机不算、
         * 未命中不算，与敌方那两件受击挂载件同一钩子口径）。
         */
        if (
          markMeBlink(gtgt.spec, gtgt.spec.tag, b, bal, battleMaxDistanceM(b, me, foes, bal, myUnits))
        ) {
          /**
           * ⚠ **演出事件不在这里推了**（**2026-10-02 §35 抽出**）：`markMeBlink` 内部已推一条带
           * `atMs`（排队后的真实起点）与 `speedX` 的（与 `markFoeBlink` 同款）——在这里再推一条
           * 会**排两根柱**、而且缺 `speedX`（倍速下时长会跑飞）。这里只留画面提示。
           */
          pushBattleNotice(b, '跃迁规避：本舰瞬时换位')
        }      continue
      }
      const blindMul = b.distanceM < w.minRangeM ? (w.blindDmgMul ?? 0.3) : 1
      const shotDmgRaw = blindMul < 1 ? Math.max(1, ceilFinalQuantity((w.shotDmg ?? 0) * blindMul)) : (w.shotDmg ?? 0)
      const shotDmg = volleyDamageShareOf(foeRepairDiscountedShot(f, ceilFinalQuantity(shotDmgRaw * capacitorDamageMul)), gunCount, gun)
      // AI favor：敌方命中被优势压制，且始终保留 97% 命中上限（3% miss 底线不变）
      // ⚠ 距离折减传**增程感知**的 `foeGunPowerFactorOf`（原射程内与原公式逐字一致；延长段同斜率外推）
      const foeHit = hitChance(w, f, gtgt.spec, b.distanceM, bal, foeGunPowerFactorOf(b, f, wShot, b.distanceM))
      const foeHitEff = favor ? clamp(0, 0.97, foeHit * favor.foeMul) : foeHit
      const fHit = nextRandom(state.rng) < foeHitEff
      /** 本发对**被打的那艘我方舰**的实收伤害（2026-09-24 船长令：飘字读数；未命中保持 0） */
      let gunDealt = 0
      if (fHit) {
        b.stats.foeHits += 1
        capacitorHit = true
        gunDealt = applyPlayerUnitDamage(state, b, gtgt.spec.tag, gtgt.spec, shotDmg, fType,
          r => applyFoeShot(gtgt.rt.hp, gtgt.spec.resists, w, r, fType))
        // 冲锋解除（船长 2026-09-14）：**自身炮台命中我方** ⇒ 立刻解除冲锋并进入冷却（掷命中，只有真命中才算）
        releaseFoeChargeOnHit(b, f.tag, bal, f.foeChargeCooldownMs)
      }
      pushBattleFx(b, { atMs: b.lastTickGameMs + dtMs, side: 'foe', tag: f.tag, to: gtgt.spec.tag, type: fType, hit: fHit, ...(gunDealt > 0 ? { dmg: gunDealt } : {}) })
        /**
         * **我方「跃迁规避装置」触发点**，沿用受击触发规则。**敌方舰炮命中我方舰船本体**这一支（打我方无人机不算、
         * 未命中不算，与敌方那两件受击挂载件同一钩子口径）。
         */
        if (
          fHit && markMeBlink(gtgt.spec, gtgt.spec.tag, b, bal, battleMaxDistanceM(b, me, foes, bal, myUnits))
        ) {
          /** ⚠ 同上：演出事件由 `markMeBlink` 内部推（带 `atMs`/`speedX`），这里只留画面提示。 */
          pushBattleNotice(b, '跃迁规避：本舰瞬时换位')
        }
    }
    if (capacitorHit && f.foeShieldCapacitor) {
      noteFoeCapacitorAttack(b, f, 0)
      rt.weapons[0] = Math.min(Number.MAX_SAFE_INTEGER, Math.round(w.reloadMs * foeCapacitorMultiplierOf(b, f, 0, 'reloadMul')))
    }
  }
}
