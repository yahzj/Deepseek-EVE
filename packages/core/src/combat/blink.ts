import type { UnitSpec } from './model'
import type { BattleBalance } from '../types'
import { foeDesiredRange, blinkGapMs, blinkProcessMs, BLINK_VANISH_SHARE_NUM, BLINK_SHARE_DEN } from './foes/tactics'
import { pushBattleFx } from './combatFx'

export function blinkStep(curM: number, wantM: number, stepM: number, minM: number, maxM: number): number {
  const cur = Math.round(curM)
  const want = Math.round(wantM)
  const gap = want - cur
  const moved = cur + Math.sign(gap) * Math.min(Math.abs(gap), stepM)
  return Math.max(minM, Math.min(maxM, Math.round(moved)))
}

export function markFoeBlink(
  rt: UnitSpec,
  tag: string,
  b: import('../state').BattleState,
  bal: BattleBalance,
  maxDistanceM: number,
  foeRangeDebuffR = 0,
): boolean {
  const bl = rt.foeBlink
  if (bl === undefined || bl.distanceM <= 0 || bl.cooldownMs <= 0) return false
  const nowMs = b.lastTickGameMs
  if (nowMs < (b.foeBlinks?.[tag] ?? 0)) return false
  const want = foeDesiredRange(rt, [rt], bal, foeRangeDebuffR)
  const landed = blinkStep(b.distanceM, want, bl.distanceM, bal.minDistanceM, maxDistanceM)
  if (landed === b.distanceM) return false
  const from = Math.round(b.distanceM)
  const moved = Math.abs(landed - from)
  if (!b.foeBlinks) b.foeBlinks = {}
  b.foeBlinks[tag] = nowMs + bl.cooldownMs
  if (!b.foeBlinkJumps) b.foeBlinkJumps = {}
  b.foeBlinkJumps[tag] = { from, moved, dir: landed > from ? 1 : landed < from ? -1 : 0 }
  const queue = b.foeBlinkQueue ?? (b.foeBlinkQueue = {})
  let startMs = nowMs
  for (const q of Object.values(queue).slice()) startMs = Math.max(startMs, q.appearMs + blinkGapMs(bal))
  const vanishMs = startMs
  const moveAtMs = vanishMs + Math.round((blinkProcessMs(bal) * BLINK_VANISH_SHARE_NUM) / BLINK_SHARE_DEN)
  const appearMs = vanishMs + blinkProcessMs(bal)
  queue[tag] = { queuedMs: nowMs, vanishMs, moveAtMs, appearMs, from, to: landed }
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

export function blinkHoldSides(b: import('../state').BattleState): { me: boolean; foe: boolean } {
  const now = b.lastTickGameMs
  const inWindow = (q: Record<string, import('../state').BlinkSeg> | undefined): boolean => {
    if (!q) return false
    for (const seg of Object.values(q)) if (now >= seg.vanishMs && now < seg.appearMs) return true
    return false
  }
  return { me: inWindow(b.foeBlinkQueue), foe: inWindow(b.meBlinkQueue) }
}

export function foeOverlayReloadOf(
  rt: UnitSpec,
  tag: string,
  b: import('../state').BattleState,
  baseReloadMs: number,
): number {
  const od = rt.foeOverlayDrive
  if (od === undefined) return baseReloadMs
  const step = Math.max(1, od.stepMs)
  const reg = b.foeOverlayReload ?? (b.foeOverlayReload = {})
  const blink = rt.foeBlink
  const blinkCount =
    blink !== undefined && blink.cooldownMs > 0
      ? Math.max(reg[tag]?.bs ?? 0, countFoeBlinksAt(b, tag, blink.cooldownMs))
      : 0
  const prev = reg[tag]
  const fired = prev?.f ?? 0
  const next = Math.max(od.floorMs, baseReloadMs - (fired + blinkCount) * step)
  reg[tag] = { r: next, f: fired + 1, bs: blinkCount }
  return next
}

export function foeWaveStartMsOf(
  b: Pick<import('../state').BattleState, 'foeWaveStartMs' | 'startedAtGameMs'>,
): number {
  return b.foeWaveStartMs ?? b.startedAtGameMs
}

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
  if (nowMs < (b.meBlinks?.[tag] ?? 0)) return false
  const landed = blinkStep(b.distanceM, b.myDesireM, bl.distanceM, bal.minDistanceM, maxDistanceM)
  if (landed === Math.round(b.distanceM)) return false
  const from = Math.round(b.distanceM)
  if (!b.meBlinks) b.meBlinks = {}
  b.meBlinks[tag] = nowMs + bl.cooldownMs
  const queue = b.meBlinkQueue ?? (b.meBlinkQueue = {})
  let startMs = nowMs
  for (const q of Object.values(queue).slice()) startMs = Math.max(startMs, q.appearMs + blinkGapMs(bal))
  const vanishMs = startMs
  const moveAtMs = vanishMs + Math.round((blinkProcessMs(bal) * BLINK_VANISH_SHARE_NUM) / BLINK_SHARE_DEN)
  const appearMs = vanishMs + blinkProcessMs(bal)
  queue[tag] = { queuedMs: nowMs, vanishMs, moveAtMs, appearMs, from, to: landed }
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

export function settleFoeBlinkExtras(
  rt: UnitSpec,
  tag: string,
  b: import('../state').BattleState,
  baseReloadMs?: number,
): void {
  const fo = rt.foeFlashOverload
  if (fo !== undefined) {
    const rtUnit = b.units[tag]
    if (rtUnit !== undefined) {
      const capS = Math.max(0, rtUnit.hpMax?.s ?? rt.hp.s)
      rtUnit.hp.s = capS
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
  if (rt.foeOverlayDrive !== undefined && baseReloadMs !== undefined) {
    foeOverlayReloadOf(rt, tag, b, baseReloadMs)
  }
}
