import { ceilFinalQuantity } from '../quantity'
import type { GameState } from '../state'
import type { BattleBalance, DamageType, FoeFamily, SimContext } from '../types'
import type { UnitSpec } from './model'
import { applyDamage, battleShowWindowMs, clamp, isAlive } from './combatMath'
import { nextInt, nextRandom, pickOne } from '../rng'
import { BATTLE_ARRIVAL_FLY_MS, pushBattleFx } from './combatFx'
import { droneReviveNoteLoss } from '../droneRevive'
import { coronaFocusBonusOf } from './coronaFocus'
import { foeCapacitorMultiplierOf, noteFoeCapacitorAttack } from './gravekeeperCombat'


function aliveDroneKeys(
  b: import('../state').BattleState,
  sentryIds: ReadonlySet<string> = PD_NEAR_DRONE_IDS,
  sentriesInRange = false,
  sentryOnly = false,
): string[] {
  const pools = b.dronePools
  if (!pools) return []
  const others: string[] = []
  const sentries: string[] = []
  for (const [k, p] of Object.entries(pools)) {
    if (!p.alive || p.launched === false) continue
    if (p.artId && sentryIds.has(p.artId)) sentries.push(k)
    else others.push(k)
  }
  if (sentryOnly) return sentries
  if (!sentriesInRange) return others
  return [...others, ...sentries]
}


const PD_REACTIVE_WINDOW_MS = 5_000

const PD_SENTRY_RANGE_M = 2_500

const PD_NEAR_DRONE_IDS: ReadonlySet<string> = new Set(['drone-sentry', 'drone-repair-mil'])


export function dronePoolKey(tag: string, wi: number): string {
  return `${tag}:${wi}`
}
export function dronePoolOwner(key: string): string {
  const i = key.indexOf(':')
  return i > 0 ? key.slice(0, i) : 'player'
}

export function buildDronePoolsFor(
  ctx: SimContext,
  spec: UnitSpec,
  pools: Record<string, import('../state').DronePoolEntry>,
  durMul: number,
  evaMul: number,
): void {
  const tag = spec.tag ?? 'player'
  spec.weapons.forEach((w, i) => {
    if (w.src !== 'drone' || !w.artId) return
    const d = ctx.items.get(w.artId)?.defense
    const sMax = Math.max(1, ceilFinalQuantity((d?.shieldHp ?? 1) * durMul * (1 + (spec.droneShieldBonusPct ?? 0)) * (spec.droneHpMul ?? 1)))
    const aMax = Math.max(1, ceilFinalQuantity((d?.armorHp ?? 1) * durMul * (spec.droneHpMul ?? 1)))
    const hMax = Math.max(1, ceilFinalQuantity((d?.hullHp ?? 1) * durMul * (1 + (spec.droneHullBonusPct ?? 0)) * (spec.droneHpMul ?? 1)))
    pools[dronePoolKey(tag, i)] = {
      owner: tag,
      s: sMax,
      a: aMax,
      h: hMax,
      alive: true,
      artId: w.artId,
      evasion: clamp(0, 0.9, (d?.evasion ?? 0) * evaMul),
      maxS: sMax,
      maxA: aMax,
      maxH: hMax,
      ...(d
        ? {
            resists: {
              ...(d.shieldResist ? { shield: d.shieldResist } : {}),
              ...(d.armorResist ? { armor: d.armorResist } : {}),
              ...(d.hullResist ? { hull: d.hullResist } : {}),
            },
          }
        : {}),
    }
  })
}


const PD_PRIORITY_BY_ART: Record<string, number> = {
  'drone-sentry': 0,
  'drone-heavy': 1,
  'drone-wh-e-sentry': 0,
  'drone-wh-c-heavy': 1,
  'drone-ink-heavy': 1,
}
export function pdPriorityOf(artId: string | undefined | null, role?: string): number {
  const byArt = artId ? PD_PRIORITY_BY_ART[artId] : undefined
  if (byArt !== undefined) return byArt
  if (role === 'sentry') return 0
  if (role === 'assault') return 1
  return 2
}

export function pdShotOf(
  bal: BattleBalance,
  family: FoeFamily | undefined,
  hullClassTier: number | undefined,
  damageBonusPct = 0,
): { acc: number; dmg: number; dmgType: DamageType; autoHit: boolean } {
  const ov = family !== undefined ? bal.pdFamilyOverride?.[family] : undefined
  const tierMul = bal.pdTierMul?.[Math.min(4, Math.max(0, (hullClassTier ?? 1) - 1))] ?? 1
  return {
    acc: bal.pdAcc + (ov?.accAdd ?? 0),
    dmg: bal.pdDmg * tierMul * Math.max(0, (ov?.dmgMul ?? 1) + damageBonusPct),
    dmgType: ov?.dmgType ?? 'kinetic',
    autoHit: ov?.autoHit === true,
  }
}

/**
 * 近防炮结算（每拍调用；2026-09-10 船长口径 · **2026-09-12 八条裁决改版**）：
 * - 每艘点防舰**独立**按 `pdJudgementMs`（0.5s）判定一次 ⇒ **判定频率 = 火力密度**（反击制只决定"能不能开火"）；
 * - **集火**（船长 2026-09-12）：锁定一架直到它被击落才换靶（旧口径 = 每拍随机换靶 ⇒ 伤害摊薄到整群、几乎打不掉）；
 * - **选靶优先级**：**哨戒机 → 攻坚机 → 其余等权抽取**（侦察机与战斗机同权）；
 *   ⚠ **前提：哨戒机必须在近防炮射程内**（船长 2026-09-12：「**优先攻击哨戒机的前提是哨戒在射程内**」）——
 *   哨戒机**只有 `distanceM ≤ PD_SENTRY_RANGE_M`（2,500m）时才进候选池**（见 `aliveDroneIndices`：
 *   `if (!sentriesInRange) return others`）⇒ 两舰拉开距离时它**既不可选、也不占优先级**，
 *   优先级自然落到"攻坚机 → 其余"；**集火锁**同样在它出射程那一刻解除（候选池里没有它了）。
 * - 命中 = `clamp(pdHitFloor, 1, pdAcc − 机型闪避)`（**下限 10%**，修掉"闪避 ≥ pdAcc ⇒ 永久免疫"）；
 * - 伤害 = `pdDmg × 舰种档系数(pdTierMul)`（**越大的船防空越强**：T1 1.0 / T3 2.0 / T5 4.0），
 *   再走该机型三层抗性；血量打空 = 该架本场击落（停火 + 计入 droneLost + 击落演出）；
 * - **两条独立开火许可**（2026-09-12 **修 bug**）：旧代码要求"哨戒机在射程内"**并且**有令牌，
 *   等于把"出击型打一次换一次反击"整条路掐死（出击型机群永远不会被反击、实测战损恒为 0）：
 *   a) **反击令牌**：我方无人机打过敌舰 ⇒ 窗口内还手（**无视距离**，船长 2026-09-11 口径）；
 *      ⚠ 该令牌**敌方全队共用**（不是逐舰）——船长 2026-09-16 复核定论「**点防没问题**」（见 `state.ts` `droneHitAt`）；
 *   b) **哨戒机在射程内**：常驻暴露 ⇒ 不需令牌即可还手（船长 2026-09-11 重新定义）；
 * - **不看距离**（放飞出去就在威胁之下）；**战斗内可 100% 损坏**（战后按回收率找回一部分）；
 * - 近防炮不参与敌舰对玩家的常规攻击（独立系统）；全程消费 state.rng，确定性可复现。
 * （2026-10-02 批次 4j：因 combat 的 stepBattle 仍要调用而转公开，不进 combat 公开面）
 */
export function resolvePointDefense(
  state: GameState,
  b: import('../state').BattleState,
  foes: UnitSpec[],
  bal: BattleBalance,
  dtMs: number,
): void {
  const pools = b.dronePools
  if (!pools || b.pdCd === undefined) return;
  const period = Math.max(100, Math.round(bal.pdJudgementMs))
  const sentryOk = b.distanceM <= PD_SENTRY_RANGE_M
  // 许可 a：**反击令牌**（我方无人机打过敌舰 ⇒ 窗口内还手，**无视距离**）
  const foeHitAt = b.droneHitAt?.foe
  const tokenOpen =
    foeHitAt !== undefined && b.lastTickGameMs - foeHitAt <= PD_REACTIVE_WINDOW_MS
  // 许可 b：**哨戒机在射程内**（不需令牌）
  const sentryOpen =
    sentryOk && aliveDroneKeys(b, PD_NEAR_DRONE_IDS, true, true).length > 0
  // 船长2026-09-27：冷却独立推进，反击许可只管是否开火。
  const canFire = tokenOpen || sentryOpen
  // 船长2026-10-08确认：全队无人尝试还手时保留共用许可，仍受反击窗口限制。
  let attempted = false
  const focus: Array<string | undefined> = b.pdFocus ? [...b.pdFocus] : []
  for (let fi = 0; fi < foes.length; fi++) {
    if (foes[fi]!.foePointDefenseEnabled === false) continue
    if (!isAlive(b, foes[fi]!.tag)) continue
    let cd = (b.pdCd[fi] ?? period) - dtMs
    let guard = 0
    while (cd <= 0 && guard < 64) {
      guard++
      cd += Math.min(Number.MAX_SAFE_INTEGER, period * foeCapacitorMultiplierOf(b, foes[fi]!, 'pd', 'reloadMul'));
      if (!canFire) break
      const candsAll = aliveDroneKeys(b, PD_NEAR_DRONE_IDS, sentryOk)
      if (candsAll.length === 0) break
      const owners = [...new Set(candsAll.map(dronePoolOwner))]
      const lockedKey = focus[fi]
      const owner =
        lockedKey !== undefined && candsAll.includes(lockedKey)
          ? dronePoolOwner(lockedKey)
          : pickOne(state.rng, owners)!
      const cands = candsAll.filter((k) => dronePoolOwner(k) === owner)
      let key = focus[fi] !== undefined && cands.includes(focus[fi]!) ? focus[fi]! : undefined
      if (key === undefined) {
        const best = Math.min(...cands.map((k) => pdPriorityOf(pools[k]!.artId)))
        const tier1 = cands.filter((k) => pdPriorityOf(pools[k]!.artId) === best)
        key = pickOne(state.rng, tier1)!
      }
      focus[fi] = key
      const pool = pools[key]!
      attempted = true
      const defender = foes[fi]!
      const focusBonus = coronaFocusBonusOf(b, defender.foeFocusArray, 'antiDroneBonusPct')
      const shot = pdShotOf(bal, defender.family, defender.hullClassTier, focusBonus)
      const pHit = clamp(bal.pdHitFloor ?? 0, 1, shot.acc - pool.evasion)
      if (!shot.autoHit && nextRandom(state.rng) >= pHit) continue
      const res = applyDamage(
        { s: pool.s, a: pool.a, h: pool.h },
        pool.resists ?? {},
        shot.dmg * foeCapacitorMultiplierOf(b, defender, 'pd', 'damageMul'),
        shot.dmgType,
      )
      pool.s = res.hp.s
      pool.a = res.hp.a
      pool.h = res.hp.h
      if (defender.foeShieldCapacitor) {
        const previous = Math.min(Number.MAX_SAFE_INTEGER, period * foeCapacitorMultiplierOf(b, defender, 'pd', 'reloadMul'))
        noteFoeCapacitorAttack(b, defender, 'pd')
        cd += Math.min(Number.MAX_SAFE_INTEGER, period * foeCapacitorMultiplierOf(b, defender, 'pd', 'reloadMul')) - previous
      }
      if (pool.s + pool.a + pool.h <= 0) {
        pool.alive = false
        focus[fi] = undefined
        const artId = pool.artId ?? 'drone'
        const ownerTag = pool.owner ?? dronePoolOwner(key)
        b.droneLost = { ...(b.droneLost ?? {}) }
        b.droneLost[artId] = (b.droneLost[artId] ?? 0) + 1
        const byOwner = { ...(b.droneLostBy ?? {}) }
        byOwner[ownerTag] = { ...(byOwner[ownerTag] ?? {}) }
        byOwner[ownerTag]![artId] = (byOwner[ownerTag]![artId] ?? 0) + 1
        b.droneLostBy = byOwner
        droneReviveNoteLoss(state, b, key, b.lastTickGameMs + dtMs)
        pushBattleFx(b, {
          atMs: b.lastTickGameMs + dtMs,
          side: 'me',
          tag: ownerTag,
          type: shot.dmgType,
          src: 'drone',
          artId,
          hit: true,
          droneDown: true,
        })
      }
    }
    b.pdCd[fi] = cd
  }
  if (tokenOpen && attempted) b.droneHitAt = { ...(b.droneHitAt ?? {}), foe: undefined }
  b.pdFocus = focus
}

export function pickFoeDroneTarget(
  state: GameState,
  b: import('../state').BattleState,
  foes: readonly UnitSpec[],
  dist: number,
  w: { minRangeM: number; maxRangeM: number },
  wi = 0,
  myTag = 'player',
  volleyFollowup = false,
): { foeTag: string; pool: import('../state').DronePoolEntry } | null {
  const pools = b.foeDronePools
  if (!pools) return null;
  const tokenAt = b.droneHitAt?.me
  if (tokenAt === undefined || b.lastTickGameMs - tokenAt > PD_REACTIVE_WINDOW_MS) return null
;
  const lockKey = dronePoolKey(myTag, wi)
  const answered = b.mePdAnsweredBy?.[lockKey]
  if (!volleyFollowup && answered !== undefined && answered >= tokenAt) return null
  const markAnswered = (): void => {
    b.mePdAnsweredBy = { ...(b.mePdAnsweredBy ?? {}), [lockKey]: tokenAt }
  }
  const cands: Array<{
    foeTag: string
    idx: number
    pool: import('../state').DronePoolEntry
    role: string | undefined
  }> = []
  for (const f of foes) {
    if (!isAlive(b, f.tag)) continue;
    if (!isFoeEngageable(b, f.tag)) continue;
    const roleOf = new Map<string, string>()
    for (const slot of f.foeDrones ?? [])
      roleOf.set(slot.drone.id, slot.drone.role)
    const arr = pools[f.tag] ?? [];
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i]!;
      if (!p.alive) continue;
      if (p.inHangar === true) continue;
      const role = p.artId ? roleOf.get(p.artId) : undefined
      if (role === 'sentry' && (dist < w.minRangeM || dist > w.maxRangeM))
        continue
      cands.push({ foeTag: f.tag, idx: i, pool: p, role })
    }
  }
  if (cands.length === 0) return null
  const focusBy = b.mePdFocusBy
  const locked = focusBy ? focusBy[lockKey] : b.mePdFocus?.[wi]
  if (locked) {
    const keep = cands.find((c) => c.foeTag === locked.tag && c.idx === locked.idx)
    if (keep) {
      markAnswered()
      return { foeTag: keep.foeTag, pool: keep.pool }
    }
  }
  let best = 2
  for (const c of cands) {
    const p = pdPriorityOf(c.pool.artId, c.role)
    if (p < best) best = p
  }
  const tier = cands.filter((c) => pdPriorityOf(c.pool.artId, c.role) === best)
  const pick = tier[nextInt(state.rng, tier.length)]!
  if (focusBy) {
    b.mePdFocusBy = { ...focusBy, [lockKey]: { tag: pick.foeTag, idx: pick.idx } }
  } else {
    const focus: Array<{ tag: string; idx: number } | undefined> = b.mePdFocus ? [...b.mePdFocus] : []
    focus[wi] = { tag: pick.foeTag, idx: pick.idx }
    b.mePdFocus = focus
  }
  markAnswered()
  return { foeTag: pick.foeTag, pool: pick.pool }
}

export function isFoeEngageable(b: import('../state').BattleState, tag: string): boolean {
  if (!isAlive(b, tag)) return false
  const at = b.units[tag]?.enteredAtMs
  return at === undefined || b.lastTickGameMs >= at + battleShowWindowMs(b, BATTLE_ARRIVAL_FLY_MS)
}
