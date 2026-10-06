/**
 * **战斗弹药装载**（2026-10-02 从 `combat.ts` 拆出 · 批次 4i · 零行为变化）。
 *
 * 本文件 = 开战弹药的**装载/退还/档位解析**：弹药总账、逐型装载、MK 档位回落、退还、下一发弹型——
 * 只依赖 state 类型 / types / inventory / playerSpec（规格里的弹种偏好）。`combat.ts` 原样再导出
 * （先例：fitted.ts），既有引用零改动。
 */
import type { BattleState, GameState } from './state'
import type { BattleBalance, DamageType, SimContext } from './types'
import type { UnitSpec, WeaponSpec } from './combat'
import { AMMO_IDS } from './playerSpec'
import { addWare, cargoItemsOf, countWare, removeItem, removeWare } from './inventory'
import { restoreWormholeSupply, wormholeSupplyForBattle } from './wormholeSupplies'

/* 以下为 2026-10-02 批次 4i 从 combat.ts 切接过来的整簇（ammoLoadTotals ~ ammoKeyOf）。 */

/* ═══════════ 弹药 ═══════════ */

/** 从首次齐射起算的名义耗弹；用规格里的装填/连发/自加速，不包含预载余量。 */
export function weaponNominalAmmoForMs(w: WeaponSpec, durationMs: number): number {
  if ((w.kind !== 'gun' && w.kind !== 'beam') || !(durationMs > 0) || !Number.isFinite(durationMs)) return 0
  const volley = Math.max(1, w.count ?? 1) * Math.max(1, w.ammoPerShot ?? 1)
  const shots = Math.max(1, Math.floor(w.burst?.shots ?? 1))
  let elapsed = 0
  let fired = 0
  let reload = Math.max(50, w.reloadMs)
  while (elapsed < durationMs) {
    fired += 1
    if (fired % shots !== 0) elapsed += Math.max(50, w.burst?.gapMs ?? reload)
    else {
      if (w.overlayDrive) reload = Math.max(w.overlayDrive.floorMs, reload - w.overlayDrive.stepMs)
      elapsed += Math.max(50, reload)
    }
  }
  return fired * volley
}

/**
 * 预载需求（V18B-2 per-gun 多键）：按每种耗弹武器键分别估量
 * （该键武器中取最快装填：时间上限 ÷ reload × 余量）。
 */
export function ammoLoadTotals(
  me: UnitSpec,
  bal: BattleBalance,
  state: import('./state').GameState,
): Partial<Record<DamageType, number>> {
  // 弹药集约学（ammunition-condensing，批次四）：出发预载弹药 +8%/级（实际装载仍受库存上限约束）
  const condLv = Math.min(5, state.skills.trained['ammunition-condensing'] ?? 0)
  const condFactor = 1 + 0.08 * condLv
  const out: Partial<Record<DamageType, number>> = {}
  /** 一轮齐射的用弹量 = 条目门数（同型合并条目 ×N）× 每次耗弹数（缺省 1）；2026-09-11 修复：预载按门数放大 */
  const roundsPerVolley = (w: WeaponSpec): number =>
    Math.max(1, w.count ?? 1) * Math.max(1, w.ammoPerShot ?? 1)
  const addFor = (t: DamageType, reloadMs: number, volley: number): void => {
    const volleys = Math.max(1, Math.ceil(((bal.ammoTimeCapMs * condFactor) / Math.max(100, reloadMs)) * bal.ammoMargin))
    out[t] = (out[t] ?? 0) + volleys * volley
  }
  for (const w of me.weapons) {
    if (w.kind === 'gun') {
      const t = (Object.keys(w.shotsByType ?? {})[0] as DamageType | undefined) ?? null
      if (t) addFor(t, w.reloadMs, roundsPerVolley(w))
    } else if (w.kind === 'beam') {
      addFor('plasma', w.reloadMs, roundsPerVolley(w))
    }
  }
  return out
}

/**
 * V17.2 单型装载：只装载炮台固定弹种的那一型（炮族制——炮台 damageType 决定弹种，
 * battle.ammo 其余键恒 0；开火/退还/UI dominant 仍走既有三键结构，无需第二套）。
 * 货仓优先、仓库兜底；返回实装各型数量（只有目标型非零）。
 * （基础弹装载：旧语义保留，测试/兼容用；开战装载请走 loadAmmoTier 按档装载）
 */
export function loadAmmo(state: GameState, ctx: SimContext, type: DamageType, total: number): { kin: number; exp: number; pla: number } {
  const out = { kin: 0, exp: 0, pla: 0 }
  const key = ammoKeyOf(type)
  out[key] = loadAmmoOf(state, ctx, AMMO_IDS[type], total)
  return out
}

/** 装载指定弹 id（货仓优先、仓库兜底，单型一次抽足）；返回实装数 */
function loadAmmoOf(state: GameState, ctx: SimContext, id: string, total: number): number {
  void ctx
  if (total <= 0) return 0
  /**
   * **取用来源二选一**（**2026-09-23 船长令**：「做一个开关，开启时，所有船的弹药和修理组件直接从仓库
   * 取用。关闭后只从舰队内舰船的货仓取用。」）——旧口径「货舱优先 → 仓库兜底」**退役**。
   * 缺省（老档没有该字段）= **开**（只仓库）。
   */
  if (state.resupplyFromWarehouse !== false) {
    const got = Math.min(Math.floor(countWare(state, id)), Math.floor(total))
    if (got > 0) removeWare(state, id, got)
    return got
  }
  const got = Math.min(Math.floor(cargoItemsOf(state)[id] ?? 0), Math.floor(total))
  if (got > 0) removeItem(state, id, got)
  return got
}

/**
 * **改档日志文案**（船长 2026-09-16 新口径配套）：实际档 ≠ 期望档时记一条。
 * 期望档 = 本船 `ammoPref`；**没设档时把"基础弹"当期望**（措辞相应换成"基础弹不足"）。
 * （2026-10-02 批次 4i：因 combat 的 startBattleFor 仍要调用而转公开，不进 combat 公开面）
 */
export function ammoTierFallbackLog(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  type: DamageType,
  useId: string,
  loaded: number,
): string {
  const prefId = state.fleet[shipId]?.ammoPref?.[type]
  const wantName = prefId ? (ctx.items.get(prefId)?.name ?? type) : '基础弹'
  const useName = ctx.items.get(useId)?.name ?? type
  return `⚙ ${wantName}可用量不足，本场改用${useName}（预载 ${loaded} 发）。`
}

/**
 * **本船本族的"实际会装哪一档"**（船长 2026-09-16 新口径的**单点判定**）。
 *
 * 界面（装配页弹药档位）与引擎（开战预载）**共用它** ⇒ 界面能如实显示"本场会用哪一档、够不够"
 * （与"界面与引擎同一把尺"的既有纪律一致）。
 *
 * 口径：候选 = **基础弹恒在** ∪ 物品表里同族（`ammo-<族>-*`）的全部档；各算可装量
 * `min(货舱+仓库库存, want)`；**取可装量最大者**；平局 = `ammoPref` ＞ 基础弹 ＞ 其余（id 序）。
 * `want <= 0` 或全族无货 ⇒ 回"期望档"（`pref ?? 基础弹`）且 `can = 0`。
 */
export function resolveAmmoTier(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  type: DamageType,
  want: number,
  stock?: Readonly<Record<string, number>>,
): { id: string; can: number; expected: string; fellBack: boolean } {
  const need = Math.max(0, Math.floor(want))
  const prefId = state.fleet[shipId]?.ammoPref?.[type]
  const wantId = prefId && ctx.items.has(prefId) ? prefId : null
  const baseId = AMMO_IDS[type]
  const canLoadOf = (id: string): number =>
    Math.min(Math.floor(stock ? stock[id] ?? 0 : (cargoItemsOf(state)[id] ?? 0) + countWare(state, id)), need)
  /** 候选：**基础弹恒在**（它是无档时的默认）+ 物品表里同族的所有档（日后加档自动纳入） */
  const family = [...new Set([baseId, ...[...ctx.items.keys()].filter((id) => id.startsWith(`ammo-${type}-`))])].sort()
  const ranked = family
    .map((id) => ({ id, can: canLoadOf(id) }))
    .sort(
      (a, b) =>
        b.can - a.can || // ① 可装量最大者优先
        (a.id === wantId ? -1 : b.id === wantId ? 1 : 0) || // ② 平局：本船选的档
        (a.id === baseId ? -1 : b.id === baseId ? 1 : 0) || // ③ 平局：基础弹（"不选档 = 基础弹"的旧语义）
        a.id.localeCompare(b.id),
    )
  const pick = ranked[0]
  const expected = wantId ?? baseId
  const id = pick && pick.can > 0 ? pick.id : expected
  return { id, can: pick?.can ?? 0, expected, fellBack: pick !== undefined && pick.can > 0 && id !== expected }
}

/**
 * 开战按档装载（弹药 MK2，2026-09-09 船长拍板"出战前选档"；**取档口径 2026-09-16 船长改判**）。
 *
 * **现行口径（船长 2026-09-16「甲」：回退改为"同族取能装得最多的那一档"）**：
 * 1. 候选 = **同族全部弹药档**（基础弹恒在 + 物品表里 `ammo-<族>-*` 的其余档 ⇒ 日后加档自动纳入）；
 * 2. **取可装量最大的那一档**（不再"不足整批就整族否决"）；**允许装不满**（有多少装多少）；
 * 3. **平局按"期望档优先"**：本船 `ammoPref` ＞ 基础弹 ＞ 其余（⇒ 选了档仍优先用所选档；
 *    没选档且两档都够 ⇒ 仍走基础弹，保持"不选档 = 基础弹"的旧语义）；
 * 4. `fellBack` = **实际用的档 ≠ 期望档**（期望档 = `ammoPref`，没设则基础弹）⇒ 调用方记一条日志。
 *
 * ⚠ **旧口径已作废**（2026-09-09：「配置档库存不足 ⇒ **整族回退基础弹**」）——它带来两个实战缺口：
 * ① **没选档 ⇒ 完全无视 MK2**（玩家仓库 553 发 MK2、基础弹 0 ⇒ 进战斗显示"无弹"）；
 * ② **选了 MK2 但不足整批 ⇒ 一发 MK2 都不用**（宁可回退基础弹，哪怕基础弹也是 0）。
 * 根因与取证见 `docs/roadmap.md` 2026-09-16「弹药取档口径改判」条（原工作稿已按 §8 归档删除，
 * 全文 `git show 191c294e:docs/design/ammo-tier-fallback-20260916.md`）。
 *
 * 返回实装数 + 实装弹 id（写 `battle.ammoIds` 供推进/退还/视图对齐）。
 */
export function loadAmmoTier(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  type: DamageType,
  total: number,
): { loaded: number; id: string; fellBack: boolean } {
  const r = resolveAmmoTier(state, ctx, shipId, type, total)
  const loaded = r.can > 0 ? loadAmmoOf(state, ctx, r.id, Math.max(0, Math.floor(total))) : 0
  return { loaded, id: r.id, fellBack: r.fellBack }
}

/** 剩余弹药退回物品仓库（弹药 MK2：按实装弹 id 原样退回；ids 缺省 = 基础弹语义） */
export function refundAmmo(
  state: GameState,
  ammo: { kin: number; exp: number; pla: number },
  ids?: Partial<Record<DamageType, string>> | null,
): void {
  const map: Array<[DamageType, number]> = [
    ['kinetic', ammo.kin],
    ['explosive', ammo.exp],
    ['plasma', ammo.pla],
  ]
  for (const [t, n] of map) {
    if (n > 0) addWare(state, ids?.[t] ?? AMMO_IDS[t], Math.floor(n))
  }
}

/**
 * 开火弹型 = 剩余最多（平局 kin→exp→pla）；全空 null。
 *
 * ⚠ **2026-09-24 起生产路径不再用它推断"某件武器打什么弹"**（V18 起是**按武器各自的 `shotsByType`**：
 * 见 `createPlayerSpec` 与 `stepBattle` 的取弹）。本函数只留作兼容导出（用例仍锁它的平局规则）——
 * **别在界面/结算里拿它当"这门炮的弹种"**：战斗画面的武器弹种徽标曾因此把动能炮、导弹架统统写成
 * 「能量弹药」（船长 2026-09-24 玩家截图报障；改法见 `battleArcsFor` 的 `meArcs`）。
 */
export function nextAmmoType(ammo: { kin: number; exp: number; pla: number }): DamageType | null {
  let best: DamageType | null = null
  let bestN = 0
  const order: Array<DamageType> = ['kinetic', 'explosive', 'plasma']
  for (const t of order) {
    const n = ammo[ammoKeyOf(t)]
    if (n > bestN) {
      bestN = n
      best = t
    }
  }
  return best
}

/** ammo 计数对象键 → DamageType 的映射辅助 */
export type AmmoKey = 'kin' | 'exp' | 'pla'
export function ammoKeyOf(t: DamageType): AmmoKey {
  return t === 'kinetic' ? 'kin' : t === 'explosive' ? 'exp' : 'pla'
}

export function battleAmmoIdsFor(battle: BattleState, tag: string): Partial<Record<DamageType, string>> | undefined {
  return battle.expeditionAmmo ? battle.expeditionAmmo.idsByTag[tag] ?? {} : battle.ammoIds
}

export function battleAmmoAvailable(battle: BattleState, tag: string, type: DamageType): number {
  if (!battle.expeditionAmmo) return battle.ammo[ammoKeyOf(type)]
  const id = battle.expeditionAmmo.idsByTag[tag]?.[type]
  return id ? battle.expeditionAmmo.stock[id] ?? 0 : 0
}

export function wormholeAmmoIdsForSpec(
  state: GameState, ctx: SimContext, shipId: string, spec: UnitSpec, stock: Readonly<Record<string, number>>,
): Partial<Record<DamageType, string>> {
  const ids: Partial<Record<DamageType, string>> = {}
  for (const [typeRaw, n] of Object.entries(ammoLoadTotals(spec, ctx.balance.battle, state))) {
    const type = typeRaw as DamageType
    ids[type] = resolveAmmoTier(state, ctx, shipId, type, n ?? 0, stock).id
  }
  return ids
}

export function consumeBattleAmmo(battle: BattleState, tag: string, type: DamageType, count: number): boolean {
  if (!Number.isSafeInteger(count) || count <= 0) return false
  if (battleAmmoAvailable(battle, tag, type) < count) return false
  if (battle.expeditionAmmo) {
    const id = battle.expeditionAmmo.idsByTag[tag]![type]!
    battle.expeditionAmmo.stock[id] = (battle.expeditionAmmo.stock[id] ?? 0) - count
  }
  battle.ammo[ammoKeyOf(type)] -= count
  return true
}

/** 同一快照选档，按id汇总预载，不能将不同档合并后用主控档退货。 */
export function loadWormholeBattleAmmo(state: GameState, ctx: SimContext, battle: BattleState, specs: ReadonlyMap<string, UnitSpec>): boolean {
  const ledger = wormholeSupplyForBattle(state, battle)
  if (!ledger) return false
  const wanted: Record<string, number> = {}
  const idsByTag: NonNullable<BattleState['expeditionAmmo']>['idsByTag'] = {}
  for (const entry of battle.myFleet ?? []) {
    const spec = specs.get(entry.shipId)!
    const ids = wormholeAmmoIdsForSpec(state, ctx, entry.shipId, spec, ledger.items)
    for (const [typeRaw, n] of Object.entries(ammoLoadTotals(spec, ctx.balance.battle, state))) {
      const type = typeRaw as DamageType
      const id = ids[type]!
      wanted[id] = (wanted[id] ?? 0) + (n ?? 0)
    }
    idsByTag[entry.tag] = ids
  }
  const stock: Record<string, number> = {}
  for (const [id, n] of Object.entries(wanted)) {
    const take = Math.min(ledger.items[id] ?? 0, n)
    if (take <= 0) continue
    stock[id] = take
    const left = (ledger.items[id] ?? 0) - take
    if (left > 0) ledger.items[id] = left
    else delete ledger.items[id]
  }
  battle.expeditionAmmo = { stock, loaded: { ...stock }, idsByTag }
  battle.ammo = { kin: 0, exp: 0, pla: 0 }
  for (const [id, n] of Object.entries(stock)) {
    const type = (['kinetic', 'explosive', 'plasma'] as const).find((t) => id.startsWith(`ammo-${t}-`))
    if (type) battle.ammo[ammoKeyOf(type)] += n
  }
  return true
}

/** 战后余弹/回收回到本趟；全损调用方直接销趟，不走母港退款。 */
export function settleWormholeBattleAmmo(state: GameState, battle: BattleState, recoveryPct: number): void {
  const ledger = wormholeSupplyForBattle(state, battle)
  const ammo = battle.expeditionAmmo
  if (!ledger || !ammo) return
  for (const [id, loaded] of Object.entries(ammo.loaded)) {
    const left = ammo.stock[id] ?? 0
    const back = Math.round(Math.max(0, loaded - left) * Math.max(0, Math.min(1, recoveryPct)))
    const consumed = (ledger.consumed[id] ?? 0) + Math.max(0, loaded - left)
    if (consumed > 0) ledger.consumed[id] = consumed
    if (left > 0) ledger.items[id] = (ledger.items[id] ?? 0) + left
    restoreWormholeSupply(ledger, id, back)
  }
  ammo.stock = {}
  ammo.loaded = {}
}
