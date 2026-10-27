/** 战斗域：captureWebs，从原引擎按职责迁移，保持结算顺序。 */
import type { UnitSpec } from './model'
import { type GameState, addLog } from '../state'
import { pushBattleFx } from './combatFx'
import { isAlive } from './combatMath'
import { WEB_BREAK_DIST_M } from './player/factors'

export function applyMeWebDebuff<T extends UnitSpec>(spec: T, d: import('../state').BattleWebDebuff): T {
  spec.speedMps = Math.max(20, spec.speedMps * d.slowMul)
  if (d.noThruster) {
    spec.thrusterBoost = 0
    if (spec.speedBonusModules) spec.speedBonusModules = spec.speedBonusModules.filter(mod => mod.speedRamp)
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

/**
 * **发动捕获网**（船长 2026-09-16：「**在自身第一次开火时发动**」——不看是否命中）：
 * 给目标上账本、**当场**把效果打在本发目标的规格上、推一条**蓝色连线**特效与一条日志。
 *
 * 三条口径（第三条于 **⟪2026-09-25 船长报障⟫** 修）：
 * 1. 同一艘舰**整场只发一次**（`foeWebFired`）；
 * 2. **多艘不叠加**：目标已有账本 ⇒ **不再上账本、不推特效、不写日志**（只留最早那条）；
 * 3. ⚠ **打空不算用掉**：第 2 条那种"目标已被别的网钉住"的情形下，**本舰的网保留**，
 *    等它**真正钉住一个未被捕获的目标**时才记 `foeWebFired`。
 * 4. **截击舰跳过**（**船长 2026-09-30**「给拦截舰添加效果，不会被网子选为目标」）：
 *    目标带 `interceptorImmuneToWeb` ⇒ 与第 3 条同款处置（不发出、不算用掉、网保留）。
 *
 * 为什么第 3 条必须这样（船长 2026-09-25 原话）：「**装备劫掠捕获网的船攻击时，如果命中已经被捕获的船时，
 * 并不会触发，而是保留直到攻击了没有被捕获的船**」。修前：本函数**无条件**先记 `foeWebFired` 再判"已钉"，
 * 于是第 2 艘起的网被**静默作废**（无蓝线、无日志、此后整场不再发放）。真引擎实测（真实入侵卡
 * `ink-harass` = 墨潮突击舰 ×4 全带网 · 我方只 1 艘船）：**`foeWebFired` 记 4 艘、实际只钉住 1 个目标、
 * 蓝线只出 1 条** ⇒ 3 张网白费。修后同上场景应记 **1** 艘、留着另外 3 张。
 */
export function fireFoeCaptureWeb(
  state: GameState,
  b: import('../state').BattleState,
  f: UnitSpec,
  target: UnitSpec,
): void {
  const web = f.foeCaptureWeb
  if (!web) return
  /**
   * **截击舰不可被网选中**（**船长 2026-09-30**：「**给拦截舰添加效果，不会被网子选为目标**」；
   * 数据开关 = `ShipDef.interceptorImmuneToWeb` ⇒ `spec.interceptorImmuneToWeb`）。
   *
   * 与下一条"目标已被别的网钉住"**同一处置**：本发的网**不发出、也不算用掉**（`foeWebFired` 不记）
   * ⇒ 该舰保留着网，等它某一发打到合法目标再张（既有口径第 3 条「打空不算用掉」）。
   * ⚠ 只挡**网**：这一发炮火的命中判定与伤害不受影响（选靶在调用方，已定）。
   */
  if (target.interceptorImmuneToWeb === true) return
  // ⚠ 目标已被别的网钉住 ⇒ **本次不算发放**（本舰的网保留到它钉住新目标为止）——见函数头注第 3 条
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
  applyMeWebDebuff(target, debuff) // 本发立即生效（含闪避归零）
  pushBattleFx(b, { atMs: b.lastTickGameMs, side: 'foe', tag: f.tag, to: target.tag, type: 'kinetic', hit: true, web: true })
  addLog(
    state,
    'warn',
    `${f.name} 张开劫掠捕获网，钉住了 ${target.name}：机动骤降、推进器熄火、闪避失效、射程缩短——` +
      `击沉 ${f.name} 才能解除。`,
  )
}

/**
 * **捕获网解除**（船长 2026-09-16：「**击杀发动者即解除**」＋ **2026-09-26**：「**将断开距离提高到4500米，
 * 且这个断开对敌我都有效**」）：每拍清理"施放者已不在场/已阵亡"与"交战距离超过断开距离"的条目。
 * 只删账本（效果随"每拍重建规格"自然消失）；解除时推一条日志，让玩家知道网松了。
 *
 * ⚠ 敌方那张网**整场只张一次**（既有口径：`fireFoeCaptureWeb` 的 `foeWebFired` 已记发放）⇒ 距离拉开断开后
 * 本场不再补发；要恢复只能指望**另一艘还没发过网的敌舰**（多网同场那条报障口径不变）。
 */
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

/**
 * **捕获网的断开距离（敌我通用）**（**船长 2026-09-26**：「**将断开距离提高到4500米，
 * 且这个断开对敌我都有效**」；前令为 4000 米）。
 *
 * 口径：网是**实体缆索**——每拍结算时若交战距离 `b.distanceM` 超过本值 ⇒ **两边的网都立刻断开**：
 * - **我方「墨潮捕获网」**：清目标 ＋ 清减益，**断开算一次使用**（船长同日追答「断开也当使用一次」）
 *   ⇒ 进满一轮周期冷却（`advanceMyCaptureWebs`）；
 * - **敌方「劫掠捕获网」**：清账本（`expireFoeWebs`）——该舰本场只张一次网 ⇒ 本场不再补发。
 *
 * （2026-10-02 批次 4g 迁到 playerSpec.ts：createPlayerSpec 建档时要用它俩当缺省，留在本文件
 * 会造 combat↔playerSpec 回边；本文件借回 + 再导出。）
 */

/**
 * **把我方「墨潮捕获网」的三层效果打在一艘敌舰的规格上**（**船长 2026-09-26**）。
 *
 * 与 `applyMeWebDebuff`（敌方那件打在我们身上）**同构，少一层**：船长明令
 * 「**我方捕获网移除武器射程下降的效果**」⇒ 只留 **机动 ×`slowMul`** · **推进器全关** · **闪避归零**。
 * ⚠ 敌阵规格**每拍由卡重建** ⇒ 本函数也必须**每拍重新施加**（与 `applyMeJammerDebuff` 同一套写法），
 * 否则效果"下一拍就复活"。
 */
export function applyFoeWebDebuff<T extends UnitSpec>(
  spec: T,
  d: import('../state').BattleFoeWebDebuff,
): T {
  if (!foeWebBases.has(spec)) foeWebBases.set(spec, { speedMps: spec.speedMps, evasion: spec.evasion, thrusterBoost: spec.thrusterBoost })
  spec.speedMps = Math.max(20, spec.speedMps * d.slowMul)
  /**
   * **C 族族设定**（**船长 2026-09-30**：「给C族添加族设定，**他们的冲锋不会被网子解除**」；
   * 口径追问取甲 = 「网『关推进器』对 C 族无效」）⇒ 带 `foeChargeWebImmune` 的单位**不清零推进器层**
   * （见 `FoeMountDef.charge.webImmune`；四件虫群冲锋器带它，A 族那件不带）。
   * ⚠ 其余两层（减速 / 闪避归零）对 C 族**照常生效**。
   */
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

/**
 * **我方捕获网的每拍推进**（**船长 2026-09-26** 全套口径的落点）：
 * 「**玩家的捕获网和武器一样有冷却周期，独立瞄准，不看命中，击沉携带者才解除，或者对面被击沉，
 * 不选取重复目标。对方被击沉后进入冷却，冷却结束选择新目标。**」
 *
 * 三条状态机（键 = 携带者 tag，账本 `BattleState.myWebs`）：
 * 1. **待发/冷却中**（`targetTag` 空）：只有 `now ≥ cooldownUntilMs`、**交战距离 ≤ `MY_WEB_RANGE_M`**
 *    且**存在可选目标**时才张网 —— 可选 = 存活 · 在当前波 · **未被任何网钉住**（"不选重复目标"）；
 *    **没有可选目标或距离过远 ⇒ 保持待发**（不空转冷却，沿用既有"打空不算用掉"口径）。初始冷却 = 0
 *    （⚠ **不是"开战即钉"**：船长 2026-09-26 令「**我方网子的射程是3800米**」⇒ 开战距离远于 3800 米时，
 *    要等距离压进来才张网）。
 * 2. **已钉住**：每拍把三层效果施加到目标规格上；目标一死 ⇒ 清目标、**记冷却 = 现在 + 周期**、写日志；
 *    **交战距离 > `WEB_BREAK_DIST_M`（4500 米）⇒ 断开**（同样算一次使用 ⇒ 同样进冷却）。
 * 3. **携带者阵亡** ⇒ 整条账本删掉、它的网全部解除（"击沉携带者才解除"）。
 *
 * **不看命中 · 独立瞄准**：不掷命中、也不跟武器打谁 —— 目标按**敌阵顺序**取第一个可选的（确定性、
 * 可复现，不消费随机数）。演出 = 一条蓝色连线（`web: true`，与敌方那套同款）＋ 一条日志。
 */
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
  // ① 携带者已不在场/已阵亡 ⇒ 它的网解除（"击沉携带者才解除"）
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
    // ⚠ 已阵亡的网手**不再张网**（上面的清理段刚把它的账本删掉；这里不跳过就会被 `??=` 重建）
    if (!isAlive(b, me.tag)) continue
    const cycleMs = me.myCaptureWeb!.cycleMs
    /**
     * ⚠ **三项读数按"网手"各自取**（**2026-09-29 船长令**：关键属性进属性栏）——
     * 原先这里读的是引擎常量（`MY_WEB_RANGE_M` / `WEB_BREAK_DIST_M` / 写死的 0.5），
     * 卡面因此看不到任何一项。现在取 `myCaptureWeb` 上的三个值（由件上字段供给、缺省回落常量）。
     */
    const webRangeM = me.myCaptureWeb!.rangeM
    const webBreakM = me.myCaptureWeb!.breakM
    const webSlowMul = me.myCaptureWeb!.slowMul
    const existingTarget = b.myWebs?.[me.tag]?.targetTag
    if (existingTarget && b.foeWebDebuffs?.[existingTarget]?.byTag === me.tag) {
      b.foeWebDebuffs[existingTarget]!.slowMul = webSlowMul
    }
    b.myWebs = { ...(b.myWebs ?? {}) }
    const st = (b.myWebs[me.tag] ??= { cooldownUntilMs: 0 })
    // ② 目标已死/已不在本波 ⇒ 清目标并进冷却
    if (st.targetTag !== undefined && !aliveFoes.some((f) => f.tag === st.targetTag)) {
      const gone = b.units[st.targetTag]?.name ?? st.targetTag
      if (b.foeWebDebuffs) delete b.foeWebDebuffs[st.targetTag]
      delete st.targetTag
      st.cooldownUntilMs = now + cycleMs
      addLog(state, 'combat', `墨潮捕获网松开：${gone} 已被击沉，${me.name} 的网开始冷却。`, 'core.combat.011', { p1: gone, p2: me.name })
    }
    /**
     * ②b **距离超过断开距离 ⇒ 网断开**（**船长 2026-09-26**：「将断开距离提高到4500米，
     * 且这个断开对敌我都有效」＋前令「距离超过4000米就会断开」＋追答「**断开也当使用一次**」）。
     * 断开 = **用掉一次** ⇒ 进满一轮周期冷却（与"目标被击沉"同等对待）；
     * 冷却到点后若距离仍在 `MY_WEB_RANGE_M`（3800 米）外，下面的 ③ 会拒绝张网（保持待发）。
     *
     * ⚠ **4500 与 3800 之间是滞回带**：拉远到 3900~4500 米**不会**掉网（只是张不了新网）。
     */
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
    // ③ 待发且冷却已过 ⇒ 张网（不看命中、独立瞄准、跳过已被钉住的；**超出投网射程不张**）
    if (st.targetTag === undefined && now >= st.cooldownUntilMs && b.distanceM <= webRangeM) {
      const taken = new Set(Object.keys(b.foeWebDebuffs ?? {}))
      const pick = aliveFoes.find((f) => !taken.has(f.tag))
      if (!pick) continue // 无目标可选 ⇒ 保持待发（不空转冷却）
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
      /**
       * 战报正文按**本网自己的减速**说（2026-09-29 起三项读数随件走）：
       * 减速 50% 仍读作「机动减半」，其它倍率读成「机动 ×N」——数字由 `webSlowMul` 现算，不再写死"减半"。
       */
      const slowTxt = webSlowMul === 0.5 ? '机动减半' : `机动 ×${webSlowMul}`
      /**
       * **按族改一句**（**船长 2026-09-30 裁决**：「网钉住 C 族，**按族改一句**」）——
       * C 族的冲锋不吃网的「关推进器」那层（见 `FoeMountDef.charge.webImmune` / `applyFoeWebDebuff`），
       * 所以钉住 C 族时**不写「推进器熄火」**，改说「冲锋不受网的推进器压制」。
       *
       * ⚠ 新写的玩家可见文案走 **id 制**（甲案）：本句 `core.combat.004`，槽 3 的减速那句自己的模板
       * 由 `p3Id` 选（`core.combat.005` = 机动减半 / `core.combat.006` = 机动 ×N，`p3p1` 给倍率）；
       * `text` 仍是中文原串（老档 / 工具断言 / 控制台用）。非 C 族那一句**照旧**（既有文案，不动）。
       */
      /* ⟪文案调整 2026-10-01⟫ 船长报障「不应该直接用X族」：本句中文原写「C 族的冲锋…」（数据侧族
         代号，而英文侧早已用正式族名）⇒ 中文改正式名「异形生物」、英文改权威族名表的 `Alien`
         （同 `core.combat.004` 的两列；口径见 `weekendComms.ts` 的族名表头注）。 */
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
  // ④ 把当前所有网的效果施加到本拍敌阵上（每拍重建 ⇒ 每拍重施加）
  if (b.foeWebDebuffs) {
    for (const f of foes) {
      const d = b.foeWebDebuffs[f.tag]
      if (d) applyFoeWebDebuff(f, d)
    }
  }
}
