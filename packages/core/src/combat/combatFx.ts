
export const BATTLE_ARRIVAL_FLY_MS = 950
export const BATTLE_ARRIVAL_STAGGER_MS = 60

export const WORMHOLE_FOE_VOLLEY_STAGGER_MS = 900

export function stampFoeArrivalFx(b: import('../state').BattleState, nowMs = b.lastTickGameMs): void {
  const foeTags = Object.values(b.units)
    .filter((u) => u.side === 'foe')
    .map((u) => u.tag)
  foeTags.forEach((tag, idx) => {
    const rt = b.units[tag]
    if (!rt) return
    rt.enteredAtMs = nowMs + idx * BATTLE_ARRIVAL_STAGGER_MS
    rt.weapons = rt.weapons.map(
      (cd) => Math.max(cd, BATTLE_ARRIVAL_FLY_MS + idx * WORMHOLE_FOE_VOLLEY_STAGGER_MS),
    )
  })
}

export function pushBattleFx(
  b: import('../state').BattleState,
  ev: Omit<import('../state').BattleFx, 'seq'>,
): void {
  b.fx.push({ ...ev, seq: b.fxSeq++ })
  if (b.fx.length > 48) {
    const recentAt = ev.atMs - 2000 * Math.max(1, b.speedX ?? 1)
    let keepAt = 0
    while (keepAt < b.fx.length - 48 && b.fx[keepAt]!.atMs < recentAt) keepAt++
    keepAt = Math.max(keepAt, b.fx.length - 512)
    if (keepAt > 0) b.fx.splice(0, keepAt)
  }
}

export function pushBattleNotice(
  b: import('../state').BattleState,
  text: string,
  textId?: string,
  textParams?: import('../state').LogParams,
): void {
  const fresh = (b.notices ?? []).filter((n) => textId ? n.textId !== textId : n.textId !== undefined || n.text !== text)
  b.notices = [...fresh, { atMs: b.lastTickGameMs, text, ...(textId ? { textId, textParams } : {}) }].slice(-4)
}
