import type { UnitSpec } from './model'
import { type GameState, addLog } from '../state'
import { pushBattleFx } from './combatFx'
import { isAlive } from './combatMath'
import { WEB_BREAK_DIST_M } from './player/factors'

export function applyMeWebDebuff<T extends UnitSpec>(spec: T, d: import('../state').BattleWebDebuff): T {
  spec.speedMps = Math.max(20, spec.speedMps * d.slowMul)
  if (d.noThruster) {
    spec.thrusterBoost = 0
    if (spec.speedBonusModules) spec.speedBonusModules = spec.speedBonusModules.filter(mod => mod.slot !== 'propulsion')
  }
  if (d.noEvasion) spec.evasion = 0
  if (d.rangeDownM > 0) {
    spec.weapons = spec.weapons.map((w) => {
      const maxRangeM = Math.max(2, w.maxRangeM - d.rangeDownM)
      const minRangeM = Math.max(1, Math.min(maxRangeM - 1, w.minRangeM - d.rangeDownM))
      return { ...w, maxRangeM, minRangeM }
    })
  }
  return spec
}

export function fireFoeCaptureWeb(
  state: GameState,
  b: import('../state').BattleState,
  f: UnitSpec,
  target: UnitSpec,
): void {
  const web = f.foeCaptureWeb
  if (!web) return
  if (target.interceptorImmuneToWeb === true) return
  if (b.meWebDebuffs?.[target.tag]) return
  b.foeWebFired = { ...(b.foeWebFired ?? {}), [f.tag]: true }
  const debuff: import('../state').BattleWebDebuff = {
    byTag: f.tag,
    slowMul: web.slowMul,
    noThruster: web.noThruster,
    noEvasion: web.noEvasion,
    rangeDownM: web.rangeDownM,
    atMs: b.lastTickGameMs,
  }
  b.meWebDebuffs = { ...(b.meWebDebuffs ?? {}), [target.tag]: debuff }
  applyMeWebDebuff(target, debuff)
  pushBattleFx(b, { atMs: b.lastTickGameMs, side: 'foe', tag: f.tag, to: target.tag, type: 'kinetic', hit: true, web: true })
  addLog(
    state,
    'warn',
    `${f.name} 张开劫掠捕获网，钉住了 ${target.name}：机动骤降、推进器熄火、闪避失效、射程缩短——` +
      `击沉 ${f.name} 才能解除。`,
  )
}

export function expireFoeWebs(state: GameState, b: import('../state').BattleState, foes: readonly UnitSpec[]): void {
  const list = b.meWebDebuffs
  if (!list || Object.keys(list).length === 0) return
  const aliveTags = new Set(foes.filter((f) => isAlive(b, f.tag)).map((f) => f.tag))
  for (const [tag, d] of Object.entries(list)) {
    const name = b.units[tag]?.name ?? tag
    if (!aliveTags.has(d.byTag)) {
      delete list[tag]
      addLog(state, 'combat', `劫掠捕获网已失效：${name} 摆脱了束缚（发动者已被击沉）。`, 'core.combat.008', { p1: name })
      continue
    }
    if (b.distanceM > WEB_BREAK_DIST_M) {
      delete list[tag]
      addLog(state, 'combat', `劫掠捕获网已失效：${name} 摆脱了束缚（距离超过 ${WEB_BREAK_DIST_M} 米）。`, 'core.combat.009', { p1: name, p2: WEB_BREAK_DIST_M })
    }
  }
}


export function applyFoeWebDebuff<T extends UnitSpec>(
  spec: T,
  d: import('../state').BattleFoeWebDebuff,
): T {
  if (!foeWebBases.has(spec)) foeWebBases.set(spec, { speedMps: spec.speedMps, evasion: spec.evasion, thrusterBoost: spec.thrusterBoost })
  spec.speedMps = Math.max(20, spec.speedMps * d.slowMul)
  if (d.noThruster && spec.foeChargeWebImmune !== true) spec.thrusterBoost = 0
  if (d.noEvasion) spec.evasion = 0
  return spec
}

export const foeWebBases = new WeakMap<UnitSpec, Pick<UnitSpec, 'speedMps' | 'evasion' | 'thrusterBoost'>>()

export function restoreFoeWebSpecs(foes: readonly UnitSpec[]): void {
  for (const foe of foes) {
    const base = foeWebBases.get(foe)
    if (!base) continue
    foe.speedMps = base.speedMps
    foe.evasion = base.evasion
    if (base.thrusterBoost === undefined) delete foe.thrusterBoost
    else foe.thrusterBoost = base.thrusterBoost
  }
}

export function advanceMyCaptureWebs(
  state: GameState,
  b: import('../state').BattleState,
  myUnits: readonly UnitSpec[],
  foes: readonly UnitSpec[],
): void {
  restoreFoeWebSpecs(foes)
  const webs = b.myWebs
  const debuffs = b.foeWebDebuffs
  const carriers = myUnits.filter((u) => (u.myCaptureWeb?.cycleMs ?? 0) > 0)
  if (webs) {
    for (const tag of Object.keys(webs)) {
      const carrier = carriers.find((u) => u.tag === tag)
      if (carrier && isAlive(b, tag)) continue
      delete webs[tag]
      if (debuffs) {
        for (const [to, d] of Object.entries(debuffs)) {
          if (d.byTag !== tag) continue
          delete debuffs[to]
          addLog(state, 'combat', `墨潮捕获网已失效：${b.units[to]?.name ?? to} 挣脱了束缚（网手已被击沉）。`, 'core.combat.010', { p1: b.units[to]?.name ?? to })
        }
      }
    }
  }
  if (carriers.length === 0) return
  const now = b.lastTickGameMs
  const aliveFoes = foes.filter((f) => isAlive(b, f.tag))
  for (const me of carriers) {
    if (!isAlive(b, me.tag)) continue
    const cycleMs = me.myCaptureWeb!.cycleMs
    const webRangeM = me.myCaptureWeb!.rangeM
    const webBreakM = me.myCaptureWeb!.breakM
    const webSlowMul = me.myCaptureWeb!.slowMul
    const existingTarget = b.myWebs?.[me.tag]?.targetTag
    if (existingTarget && b.foeWebDebuffs?.[existingTarget]?.byTag === me.tag) {
      b.foeWebDebuffs[existingTarget]!.slowMul = webSlowMul
    }
    b.myWebs = { ...(b.myWebs ?? {}) }
    const st = (b.myWebs[me.tag] ??= { cooldownUntilMs: 0 })
    if (st.targetTag !== undefined && !aliveFoes.some((f) => f.tag === st.targetTag)) {
      const gone = b.units[st.targetTag]?.name ?? st.targetTag
      if (b.foeWebDebuffs) delete b.foeWebDebuffs[st.targetTag]
      delete st.targetTag
      st.cooldownUntilMs = now + cycleMs
      addLog(state, 'combat', `墨潮捕获网松开：${gone} 已被击沉，${me.name} 的网开始冷却。`, 'core.combat.011', { p1: gone, p2: me.name })
    }
    if (st.targetTag !== undefined && b.distanceM > webBreakM) {
      const gone = b.units[st.targetTag]?.name ?? st.targetTag
      if (b.foeWebDebuffs) delete b.foeWebDebuffs[st.targetTag]
      delete st.targetTag
      st.cooldownUntilMs = now + cycleMs
      addLog(
        state,
        'combat',
        `墨潮捕获网断开：${gone} 与 ${me.name} 的距离超过 ${webBreakM} 米，` +
          `${me.name} 的网开始冷却。`,
      )
    }
    if (st.targetTag === undefined && now >= st.cooldownUntilMs && b.distanceM <= webRangeM) {
      const taken = new Set(Object.keys(b.foeWebDebuffs ?? {}))
      const pick = aliveFoes.find((f) => !taken.has(f.tag))
      if (!pick) continue
      st.targetTag = pick.tag
      b.foeWebDebuffs = {
        ...(b.foeWebDebuffs ?? {}),
        [pick.tag]: {
          byTag: me.tag,
          slowMul: webSlowMul,
          noThruster: true,
          noEvasion: true,
          atMs: now,
        },
      }
      pushBattleFx(b, { atMs: now, side: 'me', tag: me.tag, to: pick.tag, type: 'kinetic', hit: true, web: true })
      const slowTxt = webSlowMul === 0.5 ? '机动减半' : `机动 ×${webSlowMul}`
      const immune = pick.foeChargeWebImmune === true
      addLog(
        state,
        'warn',
        immune
          ? `${me.name} 张开墨潮捕获网，钉住了 ${pick.name}：${slowTxt}、闪避失效，` +
            `异形生物的冲锋不受网的推进器压制——击沉目标或击沉网手才能解除。`
          : `${me.name} 张开墨潮捕获网，钉住了 ${pick.name}：${slowTxt}、推进器熄火、闪避失效——` +
            `击沉目标或击沉网手才能解除。`,
        immune ? 'core.combat.004' : undefined,
        immune
          ? {
              p1: me.name,
              p2: pick.name,
              p3: slowTxt,
              p3Id: webSlowMul === 0.5 ? 'core.combat.005' : 'core.combat.006',
              ...(webSlowMul === 0.5 ? {} : { p3p1: webSlowMul }),
            }
          : undefined,
      )
    }
  }
  if (b.foeWebDebuffs) {
    for (const f of foes) {
      const d = b.foeWebDebuffs[f.tag]
      if (d) applyFoeWebDebuff(f, d)
    }
  }
}
