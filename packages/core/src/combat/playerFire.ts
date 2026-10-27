/** 战斗域：playerFire，从原引擎按职责迁移，保持结算顺序。 */
import type { GameState } from '../state'
import type { UnitSpec, BattleSimulationOptions } from './model'
import type { BattleBalance, DamageType } from '../types'
import { isAlive, playerWeaponInRange, playerBlindDamageMul, droneHitChance, hitChance, clamp, applyDamage } from './combatMath'
import { dronePoolKey, pickFoeDroneTarget, isFoeEngageable } from './combatDrones'
import { isMyUnitStealthed, firstAliveFoe, randomAliveFoe } from './targeting'
import { releaseDroneLaunch } from './droneLaunch'
import { consumeBattleWeaponAmmo } from './combatAmmo'
import { noteRailAttack } from './gravekeeperGear'
import { meBurstReloadOf, markFoeBlink, settleFoeBlinkExtras } from './blink'
import { ceilFinalQuantity } from '../quantity'
import { beamPowerVsTargetOf } from './beam'
import { volleyGunCountOf, volleyDamageShareOf } from './combatVolley'
import { pushBattleNotice, pushBattleFx } from './combatFx'
import { nextRandom } from '../rng'
import { applyFoeUnitDamage, carryVolleyOverflow } from './damage'
import { addFoeAcidLayer } from './alienEquipment'
import { markFoeDroneRangeBuff, announceFoeGunRangeBuff } from './foeRange'
import { battleMaxDistanceM } from './foes/tactics'

export function firePlayerPhase(state: GameState, b: import('../state').BattleState, myUnits: readonly UnitSpec[], foes: UnitSpec[], me: UnitSpec, bal: BattleBalance, dtMs: number, favor: { meMul: number; foeMul: number } | null, blinkHold: { me: boolean; foe: boolean }, meAtkOf: (u: UnitSpec) => UnitSpec, awaitingWaveArrival: boolean, simulation?: BattleSimulationOptions): void {
for (const unit of myUnits) {
    const meRt = b.units[unit.tag]
    if (!meRt || !isAlive(b, unit.tag)) continue
    // 主控（`player`）——单船路径与多单位路径的首条都走这里
    const meAtk = meAtkOf(unit)
    for (let wi = 0; wi < unit.weapons.length; wi++) {
      const w = unit.weapons[wi]!
      if (w.disabled) continue
      /**
       * **逐舰放飞**（船长 2026-09-14「逐舰机群」；此前只有主控的机群参战、僚舰条目被跳过）：
       * 本舰的无人机条目查**本舰自己的池**（键 = `舰tag:武器下标`）。
       * ⚠ 查不到池条目 = 这条无人机**不参战**（该舰没带 / 老档没这类键 / 未建池）——**跳过而非
       * "无池开火"**，否则会出现打不掉的幽灵机群（这条纪律从 D 批起就有，本轮换成逐舰判定）。
       */
      if (w.src === 'drone') {
        const poolEntry = b.dronePools?.[dronePoolKey(unit.tag, wi)]
        if (!poolEntry || poolEntry.alive === false) continue // 已被点防打掉的架次不再开火（条目保留占位）
      }
      if (awaitingWaveArrival) continue
      const cd = meRt.weapons[wi] ?? 0
      if (cd > 0) {
        meRt.weapons[wi] = Math.max(0, cd - dtMs)
        continue
      }
      /**
       * 🔴 **闪现演出禁火**（**船长 2026-10-01 令**，原话照抄）：
       * 「**不停表，但是敌舰消失时，玩家的武器不会开火（哪怕武器转好了）**」
       *
       * ⇒ 只要有**任一敌舰**正处在"消失 → 出现"这段演出窗口里（见 `BattleState.foeBlinkQueue`），
       * 本门**这一拍不开火**（⚠ **冷却照推**：与上面 `cd > 0` 那支同一口径——转好了就停在 0 等窗口结束，
       * 窗口一过立刻开火，不白扣一发）。敌舰都消失了还开火，看着像打空气；这也是船长要的效果。
       * ⚠ **2026-10-02 §35 起是双向机制的一半**：反方向（我表在窗口 ⇒ 敌方停火）在敌方开火段，
       * 两处都走 `blinkHoldSides`。
       */
      if (blinkHold.me) {
        meRt.weapons[wi] = Math.max(0, cd - dtMs)
        continue
      }
      // ── **隐秘行动 · 基础舰炮闭麦**（船长 2026-09-17：「**让舰船自带的基础舰炮在隐身情况下不开炮**」）──
      // `src === 'base'` 的兜底炮**恒在且卸不掉** ⇒ 若照常开火，**开战第一拍就由它自己**把隐身窗口
      // 终结掉（下方 `stats.meShots` 处的"开火即现形"）——装置等于白装。⇒ **窗口生效期内这一门不开火**；
      // 窗口到点、或本舰其它武器开火现形之后，它**立刻恢复**（射程/弹药/装填/命中的口径一字不动）。
      // **只认 `src === 'base'`**：外挂武器与无人机**照旧开火**——"主动开火现形"仍是玩家的选择与代价。
      // 判据复用敌方选靶那把尺 `isMyUnitTargetable`（不另立第二份隐身判据）。
      if (w.src === 'base' && isMyUnitStealthed(b, unit.tag)) continue
      // ── 防空属性（船长 A1）：**只有带 `canHitDrones` 的武器能筛到敌机** ──
      // 机群不在主目标池里 ⇒ 其余武器（含我方无人机，船长 B1）按构造看不到它们。
      // 带标记的武器**优先打机群**（防空是它的本职）。
      // **射程口径（船长 2026-09-11 甲案）**：打机群**不看两舰间距**（敌机扑到您舰旁才开火，
      // 机制服从画面）⇒ 有敌机可打时不受 `inRange` 拦截；只有"打舰"才按本武器射程判。
      let droneHit = w.canHitDrones
        ? pickFoeDroneTarget(state, b, foes, b.distanceM, w, wi, unit.tag)
        : null
      if (!droneHit && !playerWeaponInRange(b.distanceM, w)) continue;
      if (w.src === 'drone' && (!foes.some(f => isFoeEngageable(b, f.tag)) || !releaseDroneLaunch(b, unit, wi))) continue
      // V18B 随机目标（船长 2026-09-05）：每发武器在开火瞬间从存活敌人中独立抽取
      // （确定性 rng 种子，可复现；齐射可分散到不同目标）。目标死亡即时换人。
      // 2026-09-09 锁定装置：装上即切换"集火模式"——全部武器打存活编队首位（主舰优先、击毁接力）。
      let foeTarget = droneHit
        ? null
        : unit.lockedDmgBonus
          ? firstAliveFoe(foes, b)
          : randomAliveFoe(state, b, foes)
      if (!foeTarget && !droneHit) continue
      let type: DamageType
      let dmg: number
      let autoHit = false
      if (w.kind === 'gun') {
        // V18B-2 per-gun 弹型：每件武器打自己的键（动能/爆破导弹/能量弹药混装各自供弹），
        // 该键弹尽 → 本武器停火（不拖累其它型）。**齐射按门数扣弹**：不足一轮齐射的余弹不发射
        // （等返港补弹；预载已按门数放大，正常战斗不会因缺弹中断）
        const pick = (Object.keys(w.shotsByType ?? {})[0] as DamageType | undefined) ?? null
        if (!pick || !consumeBattleWeaponAmmo(b, unit.tag, wi, pick, w)) {
          meRt.weapons[wi] = w.reloadMs // 无弹：等一轮再查（避免每步空转）
          continue
        }
        type = pick
        dmg = w.shotsByType?.[pick] ?? 0
        // **装填计时**（合并入口）：挂了「三连射」（本轮还没打完 ⇒ 100ms 后再来一发）或
        // 「叠光同款 · 装填自加速」的门走 `meBurstReloadOf`；两者都不挂 ⇒ 逐字回到老路径（零行为变化）
        // ⚠ 传 **`unit`**（正在开火那一艘）而不是主控 `me`：登记表的键按设计是 `舰tag#炮位`
        //   （2026-10-03 修——此前传 `me`，僚舰的这门会跟主控共用同一个键/读主控的件）。
        meRt.weapons[wi] = noteRailAttack(b, unit, wi, meBurstReloadOf(unit, unit.tag, wi, b, dtMs, w.reloadMs))
      } else if (w.kind === 'beam') {
        // V18B-2 激光：必中光束——逐发扣能量弹药（按门数）；威力随距离衰减（beamPowerFactor）
        // ⚠ **打机群不吃这个衰减**（船长 2026-10-02 令「对无人机无衰减」）⇒ 距离系数走单一取数口
        //   `beamPowerVsTargetOf`（`droneHit` 非空 ⇔ 本发打的是敌机群）。
        if (!consumeBattleWeaponAmmo(b, unit.tag, wi, 'plasma', w)) {
          meRt.weapons[wi] = w.reloadMs
          continue
        }
        type = 'plasma'
        dmg = Math.max(1, ceilFinalQuantity((w.shotDmg ?? 0) * beamPowerVsTargetOf(b.distanceM, w, droneHit !== null)))
        // **装填计时**：激光这一路同样走合并入口（三连射 / 叠光自加速 / 老路径三合一）
        meRt.weapons[wi] = meBurstReloadOf(unit, unit.tag, wi, b, dtMs, w.reloadMs)
        autoHit = true
      } else {
        type = w.fixedType ?? 'kinetic'
        dmg = w.shotDmg ?? 0
        // **装填计时**：固定值武器这一路同样走合并入口（三连射 / 叠光自加速 / 老路径三合一）
        meRt.weapons[wi] = meBurstReloadOf(unit, unit.tag, wi, b, dtMs, w.reloadMs)
      }
      // **对无人机伤害加成**（船长 2026-09-12：「近防炮给予一个对无人机伤害加成」→「**那伤害倍率按2倍算**」）：
      // 只作用于**打机群**这一支（`droneHit` 非空 ⇔ 本发打的是敌机，见上方 `pickFoeDroneTarget`）；
      // **对舰伤害一字不动**——`tests/pd-damage-ladder.test.ts` 的对舰单发定值就是这条的守卫。
      // 倍率来自装备表（`ModuleDef.antiDroneDmgMul` → `WeaponSpec.antiDroneMul`），缺省 = 1 ⇒ 不乘。
      if (droneHit && (w.antiDroneMul ?? 1) !== 1)
        dmg = ceilFinalQuantity(dmg * (w.antiDroneMul ?? 1))
      const gunCount = volleyGunCountOf(w)
      const volleyDmg = dmg
      const rawBeam = w.kind === 'beam' ? w.shotDmg ?? 0 : dmg
      // 合并条目只共享装填与弹药账；每门炮独立命中和伤害事件。
      for (let gun = 0; gun < gunCount; gun++) {
        if (gun > 0 && droneHit && !droneHit.pool.alive) {
          droneHit = pickFoeDroneTarget(state, b, foes, b.distanceM, w, wi, unit.tag, true)
          if (!droneHit) {
            if (!playerWeaponInRange(b.distanceM, w)) break
            foeTarget = unit.lockedDmgBonus ? firstAliveFoe(foes, b) : randomAliveFoe(state, b, foes)
            if (!foeTarget) break
          }
        }
        if (gun > 0 && !droneHit && !isAlive(b, foeTarget!.tag)) {
          foeTarget = unit.lockedDmgBonus ? firstAliveFoe(foes, b) : randomAliveFoe(state, b, foes)
          if (!foeTarget) break
        }
        const targetVolleyDmg = w.kind === 'beam'
          ? ceilFinalQuantity(Math.max(1, ceilFinalQuantity(rawBeam * beamPowerVsTargetOf(b.distanceM, w, droneHit !== null))) * (droneHit ? w.antiDroneMul ?? 1 : 1))
          : droneHit ? volleyDmg : (w.kind === 'gun' ? w.shotsByType?.[type] ?? 0 : w.shotDmg ?? 0)
        dmg = volleyDamageShareOf(targetVolleyDmg, gunCount, gun)
        const blindMul = playerBlindDamageMul(b.distanceM, w, droneHit !== null)
        dmg = ceilFinalQuantity(dmg * blindMul)
        b.stats.meShots += 1;
        // **隐秘行动：开火即现形**（2026-09-15 船长 Q1 甲）——本舰任一门武器打出第一发时窗口清空；
        // 同一拍稍后的敌方开火段因此已经"看得见"它（现实语义亦然：枪口一闪就暴露了）。
        if (meRt.stealthUntilMs !== undefined) {
          meRt.stealthUntilMs = undefined
          pushBattleNotice(b, '隐秘行动结束：本舰开火现形')
        }
        // **反应式防空**：我方**无人机**打过敌舰 ⇒ 记录时刻，供**敌方近防炮**在窗口内反击
        // ⚠ 记的是**敌方全队共用**的一枚令牌（**不按被打的敌舰 tag 分记**）——船长 2026-09-16「点防没问题」
        //   = 现状为准；换靶/换敌舰都共用它，消费一次即全队过窗（见 `resolvePointDefense`）。
        if (w.src === 'drone')
          b.droneHitAt = { ...(b.droneHitAt ?? {}), foe: b.lastTickGameMs };
        // AI favor：我方（AI 副船）命中按优势放大，上限放开到 100%（可必中）；
        // beam 已必中（autoHit），不掷骰、favor 不放大
        // **两条命中分开算**（船长 2026-09-12 裁定「按丁修复」，口径说明见 `droneHitChance`）：
        // 打**机群**不吃两舰距离衰减（守方只用该架的闪避 `DronePoolEntry.evasion`，机型表绝对值）；
        // 打**舰**一字未动（仍按两舰间距算 `distFactor`）。
        const meHit = autoHit
          ? 1
          : droneHit
            ? droneHitChance(w, meAtk, droneHit.pool.evasion, bal)
            : hitChance(w, meAtk, foeTarget!, b.distanceM, bal)
        const meHitEff = autoHit
          ? 1
          : favor
            ? clamp(0, 1, meHit * favor.meMul)
            : meHit
        const hit = autoHit || (dmg > 0 && nextRandom(state.rng) < meHitEff)
        /**
         * **本发对主目标的实收伤害**（2026-09-24 船长令「战斗伤害的数值动画」）——
         * 逐段累加（主段 + 附伤段），仅供飘字读数：与 `stats.meDmg` 同源（同一批 `dealt`）。
         * 未命中保持 0 ⇒ 下面**不写 `dmg`**（UI 就只飘 MISS，不硬编数字）。
         * ⚠ 齐射协调仪的**溢火结转那一截不计在本发头上**（它落在另一艘敌舰身上，已有画面提示）。
         */
        let selfDealt = 0
        if (hit) {
          b.stats.meHits += 1
          if (droneHit) {
            // 打机群：扣该架的三层血（吃它自己的层抗）；打空 = **击落**（停火 + 小型爆炸演出）。
            // ⚠ 锁定装置的加深**不作用于机群**（锁定锁的是舰）——防空靠的是射速与命中，不是锁定。
            const pool = droneHit.pool
            const r = applyDamage(
              { s: pool.s, a: pool.a, h: pool.h },
              pool.resists ?? {},
              dmg,
              type,
            )
            pool.s = r.hp.s
            pool.a = r.hp.a
            pool.h = r.hp.h
            b.stats.meDmg += r.dealt
            selfDealt = r.dealt
            if (pool.s + pool.a + pool.h <= 0) {
              pool.alive = false
              // **备用机库补位排期**（2026-09-12 船长「损坏后补充敌机」）：前线战损 ⇒ 从机库放出一架，
              // `respawnMs` 后到位。⚠ 同一时刻只排**一架**（在前的那架到位后才轮到下一架）。
              const droneFoeTag = droneHit.foeTag
              const reserveOf = foes.find((x) => x.tag === droneFoeTag)?.foeDroneReserve
              const hangar = b.foeDronePools?.[droneHit.foeTag] ?? []
              if (
                reserveOf &&
                reserveOf.count > 0 &&
                !hangar.some((p) => p.inHangar === true && p.readyAtMs !== undefined)
              ) {
                const next = hangar.find(
                  (p) => p.inHangar === true && p.readyAtMs === undefined,
                )
                if (next) next.readyAtMs = b.lastTickGameMs + reserveOf.respawnMs
              }
              pushBattleFx(b, {
                atMs: b.lastTickGameMs + dtMs,
                side: 'foe',
                tag: droneHit.foeTag,
                to: 'player',
                type,
                src: 'drone',
                artId: pool.artId,
                hit: true,
                droneDown: true, // 击落演出（与我方被点防打落同款事件类型）
              })
            }
          } else {
            const rt = b.units[foeTarget!.tag]!;
            const hpBefore = { ...rt.hp }
            // 锁定装置：被锁目标受本舰伤害加深（对锁定目标的任意命中都乘入；2026-09-09）
            const volleyLocked = unit.lockedDmgBonus ? ceilFinalQuantity(targetVolleyDmg * (1 + unit.lockedDmgBonus)) : targetVolleyDmg
            const dmgLocked = ceilFinalQuantity(volleyDamageShareOf(volleyLocked, gunCount, gun) * blindMul)
            /** 主段：走**敌舰伤害唯一收口**（血写回 ＋ 死亡观测；算术与消费顺序一字不变） */
            const r = applyFoeUnitDamage(b, foeTarget!, dmgLocked, type, b.lastTickGameMs + dtMs)
            b.stats.meDmg += r.dealt
            selfDealt = r.dealt
            if (w.acidOnHit) addFoeAcidLayer(b, foeTarget!.tag, w.acidOnHit, b.lastTickGameMs)
            /**
             * **谜质「齐射协调仪」：溢出火力转移**（F3c B2 · 船长 2026-09-13：
             * 「齐射协调仪改为溢出火力会转移到其他敌舰」）——目标被这一发打空后，把超出
             * 「打空它所需原始伤害」的那一截转给下一艘存活敌舰（按那一艘自己的层克重重算）。
             * 只在本场带了该装置时生效（`battle.wormhole.volleyOverflow`）。
             */
            if (b.wormhole?.volleyOverflow === true && rt.hp.s + rt.hp.a + rt.hp.h <= 0) {
              const carry = carryVolleyOverflow(b, foes, foeTarget!.tag, type, dmgLocked, hpBefore, 3, r.resistsUsed)
              if (carry.hits > 0) {
                pushBattleNotice(b, `齐射协调：溢火结转 ${Math.round(carry.total)} 点伤害到下一艘敌舰`)
              }
            }
            // **附加伤害段**（2026-09-13 船长：掠袭破片炮「额外造成 50% 的动能伤害是附加伤害，
            // 和弹种无关」）——口径（船长 2026-09-13 二次裁定）：「**伤害各自吃各自的制（克制）效果**」：
            // 副段取**武器原伤害**（含锁定加深，不含主段已吃的克制）×比例，然后**两段各吃各自的层克制**。
            // ⚠ 不能用主段实收做基数——那会把主系的克制乘进副段（实测该目标会从 +50% 放大到 +75%）。
            const secPct = w.secondaryDamagePct ?? 0
            if (secPct > 0 && rt.hp.s + rt.hp.a + rt.hp.h > 0) {
              const secType = w.secondaryDamageType ?? 'kinetic'
              const secDmg = ceilFinalQuantity(volleyDamageShareOf(Math.max(1, ceilFinalQuantity(volleyLocked * secPct)), gunCount, gun) * blindMul)
              /** 附伤段：同走唯一收口（它也可能就是打沉那一发） */
              const r2 = applyFoeUnitDamage(b, foeTarget!, secDmg, secType, b.lastTickGameMs + dtMs)
              b.stats.meDmg += r2.dealt
              selfDealt += r2.dealt
            }
            // **受击增程触发点（唯一）**——2026-09-11 船长：「受到攻击后，大幅提高无人机射程
            // （提高 400%）」：**母舰本体被命中** ⇒ 该舰全部机群射程 ×倍率（本场永久）。
            // ⚠ 打机群（上面的 `droneHit` 分支）**不触发**、未命中（`hit === false`）也进不到这里。
            if (markFoeDroneRangeBuff(foeTarget!, b)) {
              // **画面提示**（船长 2026-09-11 二次裁定：日志不写，改走画面顶部提示位 ⇒ `battle.notices`，
              // 与「敌方增援」同一处显示、限时自动消失）。
              // ⚠ **整队只推一条**（三次裁定：「每个敌人都会单独触发一次射程增加的文字提示，理论上应该
              // **只触发一次**，**对所有敌舰生效**」）⇒ 文案不点单舰名（生效范围是全敌队）。
              pushBattleNotice(b, '巨构残存程序过载：警戒机群解除射程限制')
            }
            // ⟪文案调整 2026-10-07⟫ 两件独立观瞄按实际挂载提示，受击距离判据不变。
            announceFoeGunRangeBuff(foeTarget!, b)
            // **闪现跃迁触发点（唯一）**——**船长 2026-10-01 令**：「**激光武器+闪现效果的挂载件**」。
            // 与上面两条**同一个钩子**（本体被命中；打机群／未命中都进不到这里）。冷却期内静默。
            if (
              markFoeBlink(
                foeTarget!,
                foeTarget!.tag,
                b,
                bal,
                battleMaxDistanceM(b, me, foes, bal, myUnits),
                // 它自己的期望距离要跟着"我方电子舰的射程压制"走 —— 直接读每拍写进运行态的那个值
                // （pplyFoeRangeDebuff 每拍**先**写 attle.meFoeRangeDebuff，与走位口径同源）
                b.meFoeRangeDebuff ?? 0,
              )
            ) {
              /**
               * 🔴 **不推画面提示**（**船长 2026-10-02 令**，原话照抄）：
               * 「**跳跃规避的提示同样过于频繁**」——本条原先推「跃迁规避：目标瞬时换位」。
               * 现在演出本身就足够显眼（整段 2 秒的消失 → 出现 + 配套动画）⇒ 提示是多余的噪音。
               * ⚠ 与"闪烁过载"那条同口径（那条更早就不再推提示）。
               */
              // **闪现演出**（**船长 2026-10-01 令**：「闪现时候要给舰船一个闪现的动画」）——
              // 与捕获网同款承载（`: true` 旗标 + `type` 占位）；界面对该 tag 播"淡出→淡入"。
              pushBattleFx(b, {
                atMs: b.lastTickGameMs,
                side: 'foe',
                tag: foeTarget!.tag,
                type: 'kinetic',
                hit: true,
                blink: true,
              })
              // **挂在闪现上的两个装置**（2026-10-01）：闪烁过载（护盾回满 / 结构 −上限5%）
              // ＋ 叠光（攻击间隔再缩一格）。只在"闪现真的发生了"这一支里结算。
              // ⚠ 装填基准取本舰主武器那条（与开火处同一个数）。
              settleFoeBlinkExtras(foeTarget!, foeTarget!.tag, b, foeTarget!.weapons[0]?.reloadMs)
            }
          }
        }
        // **全体攻击**（2026-09-13 船长：C 孢子导弹巢「对所有敌方同时攻击」）——
        // 主目标已按上面的常规口径结算；这里把**同一轮齐射**逐个结算到其余存活敌舰：
        // 逐目标独立掷命中（各用各自的命中条件）、各吃各自的层克制与抗性；受击增程等触发点照常逐舰触发。
        // ⚠ 副目标**不吃锁定加深**（锁定锁的是主目标）⇒ 基数用 dmg，主目标仍用 dmgLocked。
        //
        // ⚠⚠ **2026-09-25 船长报障修复**：「**装孢子导弹巢有时候会只有一发弹道**」。
        // 根因 = **本段原先整块写在上面那个 `if (hit) { … }` 里面**（那一层的 `hit` 就是**主目标那一发的
        // 命中判定**）⇒ 主目标没中时，"整轮是否铺开"跟着一起被跳过：副目标**连掷都不掷**，画面只剩主目标
        // 那一条弹道（原条件里那个多余的 `&& hit` 只是同一件事的第二道锁，去掉它并不改变行为）。
        // 现把本段**移出 `if (hit)`** ⇒ **主目标的命中只决定它自己**，副目标照常逐个独立结算。
        // 真跑读数（3 敌 · 28 轮 · 主目标命中率 0.357）：修复前**单发轮 18 / 铺开轮 10 = 64%**
        // （正好等于 `1 − 0.357`），每轮期望命中目标数 0.679；修复后 = 命中率 × 3 = 1.071 ⇒ **×1.58**。
        // 为什么判定为缺陷（三份口径里两份都是"每目标独立"）：① 落码记录（2026-09-13）只写
        // 「**逐目标独立掷命中** + 各吃各自层克制」，从没提过这道闸；② **胜率预估器**（`steadyPreview`
        // 的 `allFoesMul = foes.length`）一直按"每轮打全部敌舰"算 ⇒ 与实战差 1.58×（预估偏高）；
        // ③ 船长 2026-09-13 原话就是「对所有敌方同时攻击」。⇒ 船长 2026-09-25 裁「按甲」。
        // 影响面：只此一件武器带 `allFoes`（`mod-wh-c-missile`）⇒ 只有装了它的场次读数变化；
        // 单发/装填/射程/命中一字未动，**单体标称 DPS 锚（`wh-weapon-dps` 的 ×0.69）不受影响**
        // （只有 1 艘敌舰时本就没有副目标，这一段本就不做事）。
        if (w.allFoes === true && !droneHit) {
          for (const other of foes) {
            if (other.tag === foeTarget!.tag) continue
            const ort = b.units[other.tag]
            if (!ort || !isAlive(b, other.tag)) continue
            const oHitChance = autoHit ? 1 : hitChance(w, meAtk, other, b.distanceM, bal)
            const oHit = autoHit || (dmg > 0 && nextRandom(state.rng) < oHitChance)
            /** 本发打**这一艘副目标**的实收（含附伤段）——飘字逐舰各出一个数字 */
            let oDealt = 0
            if (oHit) {
              b.stats.meHits += 1
              /** 全体攻击主段：同走唯一收口 */
              const rAll = applyFoeUnitDamage(b, other, dmg, type, b.lastTickGameMs + dtMs)
              b.stats.meDmg += rAll.dealt
              oDealt = rAll.dealt
              const secPctAll = w.secondaryDamagePct ?? 0
              if (secPctAll > 0 && ort.hp.s + ort.hp.a + ort.hp.h > 0) {
                const secTypeAll = w.secondaryDamageType ?? 'kinetic'
                const secDmgAll = ceilFinalQuantity(volleyDamageShareOf(Math.max(1, ceilFinalQuantity(targetVolleyDmg * secPctAll)), gunCount, gun) * blindMul)
                /** 全体攻击附伤段：同走唯一收口 */
                const rAll2 = applyFoeUnitDamage(b, other, secDmgAll, secTypeAll, b.lastTickGameMs + dtMs)
                b.stats.meDmg += rAll2.dealt
                oDealt += rAll2.dealt
              }
              if (markFoeDroneRangeBuff(other, b)) {
                pushBattleNotice(b, '巨构残存程序过载：警戒机群解除射程限制')
              }
              announceFoeGunRangeBuff(other, b)
              // **闪现跃迁**（2026-10-01）：与上面两条**同款**——"全体攻击"打到的副目标同样会触发。
              // ⚠ 2026-10-01 补：初版只写在了主目标那处 ⇒ 用全体攻击武器（孢子导弹巢那类）打中带闪现的
              // 敌舰时**不会闪**，与两条受击增程的行为不一致。
              if (
                markFoeBlink(other, other.tag, b, bal, battleMaxDistanceM(b, me, foes, bal, myUnits), b.meFoeRangeDebuff ?? 0)
              ) {
                /**
                 * ⚠ **这里不再推演出事件**（**2026-10-02 修**）：`markFoeBlink` **内部已经推过**一条带
                 * 队列时刻（`atMs = vanishMs`）、`blink: true` 与倍速的事件；原先此处再推一条**没有 `blink`
                 * 旗标的 `pushBattleFx`** —— 界面会把它当**一次开火**处理（画弹道 + 打命中闪光）。
                 * 顺带也不推画面提示（船长：「跃迁规避的提示同样过于频繁」）。
                 */
                // **挂在闪现上的两个装置**（2026-10-01）：与主目标那处**同一函数** ⇒ 全体攻击
                // 打中带闪烁过载 / 叠光的敌舰同样结算（不因"它是副目标"而漏）。
                settleFoeBlinkExtras(other, other.tag, b, other.weapons[0]?.reloadMs)
              }
            }
            pushBattleFx(b, {
              atMs: b.lastTickGameMs + dtMs,
              side: 'me',
              tag: unit.tag,
              to: other.tag,
              type,
              src: w.src,
              artId: w.artId,
              hit: oHit,
              ...(oDealt > 0 ? { dmg: oDealt } : {}),
            })
          }
        }
        pushBattleFx(b, {
          atMs: b.lastTickGameMs + dtMs,
          side: 'me',
          tag: unit.tag,
          to: droneHit ? droneHit.foeTag : foeTarget!.tag,
          type,
          src: w.src,
          artId: w.artId,
          hit,
          // **本发实收**（2026-09-24 船长令）：命中才有，飘字用；未命中 ⇒ 缺省（UI 只飘 MISS）
          ...(selfDealt > 0 ? { dmg: selfDealt } : {}),
          // **打的是机群**（船长 2026-09-11：「炮在攻击无人机时**不显示弹道**」）——UI 只出炮口闪光。
          ...(droneHit ? { pd: true } : {}),
        })
        simulation?.onShot?.({ index: wi, weapon: w, hit, damage: selfDealt })
      }
    }
  }
}
