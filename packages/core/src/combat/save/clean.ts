/** 战斗域职责拆分，保持原计算与顺序。 */
import type { BattleState } from '../../state'
import { asRaw, cleanLedgerMap, cleanCountMap, cleanCountMapBy, cleanPosNum, cleanAmmoIdMap } from '../../persistence/raw'
import type { RawState } from '../../save'
import { cleanFx, cleanDronePools, cleanDroneLaunchBy, cleanFoeDronePools, cleanMyFleet, cleanBattleWormhole } from './units'
import { cleanRepair, cleanShieldCharge, cleanFoeRepairLedger, cleanShieldField } from './repair'
import { cleanBattleRangeSnapshot } from '../../battleRangeMemory'
import { BATTLE_PERSIST_KEYS } from './fields'

export function cleanBattle(raw: unknown): BattleState | null {
  const b = asRaw(raw)
  const numf = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  const numi = (v: unknown, fallback: number): number => Math.max(0, Math.floor(numf(v, fallback)))
  const distance = numf(b.distanceM, NaN)
  if (!Number.isFinite(distance) || distance <= 0) return null
  const unitsRaw = b.units
  const units: Record<string, BattleState['units'][string]> = {}
  if (unitsRaw !== null && typeof unitsRaw === 'object') {
    for (const [tag, uRaw] of Object.entries(unitsRaw as RawState)) {
      if (!tag) continue
      const u = asRaw(uRaw)
      const side = u.side === 'me' || u.side === 'foe' ? u.side : null
      if (!side) continue
      const hpRaw = asRaw(u.hp)
      const weaponsRaw = u.weapons
      const weapons: number[] = []
      if (Array.isArray(weaponsRaw)) {
        for (const cd of weaponsRaw) {
          if (typeof cd === 'number' && Number.isFinite(cd)) weapons.push(Math.max(0, cd))
        }
      }
      if (weapons.length === 0) weapons.push(0)
      const hpMaxRaw = asRaw(u.hpMax)
      const hpMaxOk =
        hpMaxRaw !== null &&
        typeof hpMaxRaw === 'object' &&
        typeof (hpMaxRaw as RawState).s === 'number' &&
        Number.isFinite((hpMaxRaw as RawState).s) &&
        typeof (hpMaxRaw as RawState).a === 'number' &&
        Number.isFinite((hpMaxRaw as RawState).a) &&
        typeof (hpMaxRaw as RawState).h === 'number' &&
        Number.isFinite((hpMaxRaw as RawState).h)
      units[tag] = {
        tag,
        side,
        name: typeof u.name === 'string' && u.name.length > 0 ? u.name : tag,
        hp: {
          s: Math.max(0, numf(hpRaw.s, 0)),
          a: Math.max(0, numf(hpRaw.a, 0)),
          h: Math.max(0, numf(hpRaw.h, 0)),
          ...(typeof asRaw(hpRaw.coating).armor === 'number' && typeof asRaw(hpRaw.coating).maxArmor === 'number'
            ? { coating: { armor: Math.min(numf(hpRaw.a, 0), Math.max(0, numf(asRaw(hpRaw.coating).armor, 0))),
                maxArmor: Math.max(0, numf(asRaw(hpRaw.coating).maxArmor, 0)) } } : {}),
        },
        ...(hpMaxOk
          ? {
              hpMax: {
                s: Math.max(0, (hpMaxRaw as RawState).s as number),
                a: Math.max(0, (hpMaxRaw as RawState).a as number),
                h: Math.max(0, (hpMaxRaw as RawState).h as number),
              },
            }
          : {}),
        weapons,
        // **入场时刻**（船长 2026-09-14「动画没结束不开火」）：**随档**——战斗时钟 `lastTickGameMs`
        // 也随档 ⇒ 在读入后 `lastTickGameMs − enteredAtMs` 依旧正确（窗口不会因重载而重启或消失）。
        // 老档/无入场动画的单位本字段缺失 ⇒ 视为"窗口已过"（恒可交战，零迁移）。
        ...(typeof u.enteredAtMs === 'number' && Number.isFinite(u.enteredAtMs)
          ? { enteredAtMs: numf(u.enteredAtMs, 0) }
          : {}),
        // **隐秘行动装置的隐身窗口**（2026-09-15 船长）：同样**随档**——窗口是战斗时钟上的一个
        // 截止时刻，而 `lastTickGameMs` 也随档 ⇒ 读档后窗口不会重启、也不会凭空消失。
        // 老档/未装装置的单位缺本字段 ⇒ 恒可被选中（零迁移）。
        ...(typeof u.stealthUntilMs === 'number' && Number.isFinite(u.stealthUntilMs)
          ? { stealthUntilMs: numf(u.stealthUntilMs, 0) }
          : {}),
        // **舰级 id**（2026-09-24 · 旗舰 BOSS 用）：**随档**——它决定"这个单位是不是母舰"，
        // 若读档后丢掉，池子记账就会把这一场算成 0 输出。老档/旧路径缺本字段 ⇒ 不写（零迁移）。
        ...(typeof u.foeShipId === 'string' && u.foeShipId.length > 0 ? { foeShipId: u.foeShipId } : {}),
        // **阵亡时刻**（2026-09-27 船长令「给死亡加个触发挂载点」）：**随档**——它是"这艘敌舰
        // 在玩家的这一场里什么时候被打沉的"事实记录，旗舰留档以它为准；漏了会让"战中读档后母舰已沉"
        // 的事实凭空消失。老档 / 未阵亡的单位缺本字段 ⇒ 不写（零迁移）。
        ...(typeof u.downAtMs === 'number' && Number.isFinite(u.downAtMs) ? { downAtMs: numf(u.downAtMs, 0) } : {}),
      }
    }
  }
  if (Object.keys(units).length === 0) return null
  const ammoRaw = asRaw(b.ammo)
  const statsRaw = asRaw(b.stats)
  const endedRaw = b.ended
  const fx = cleanFx(b.fx, numf)
  // 清洗后的候选值——**只有登记为 `persist` 的字段会被带出**（见 `BATTLE_FIELDS`）
  // 2026-09-12 船长裁定「六项全修」：下面七项**改为随档**，故先清洗成候选值
  /**
   * **敌群覆写**（2026-09-25 加 · 登记为 persist）：逐字段认，坏值一律丢（老档/旧路径缺 ⇒ 不写 ⇒ 零迁移）。
   */
  const foeOverrideRaw = asRaw(b.foeOverride)
  const foeOverride = ((): BattleState['foeOverride'] => {
    if (foeOverrideRaw === null || typeof foeOverrideRaw !== 'object') return undefined
    const out: NonNullable<BattleState['foeOverride']> = {}
    const t = foeOverrideRaw.threat
    if (typeof t === 'number' && Number.isFinite(t)) out.threat = Math.max(1, Math.round(t))
    const s = foeOverrideRaw.strengthMul
    if (typeof s === 'number' && Number.isFinite(s) && s > 0) out.strengthMul = s
    if (foeOverrideRaw.keepCardWaves === true) out.keepCardWaves = true
    /**
     * **BOSS 血条覆写**（2026-09-25）：`bossHp` = 本场满值（池子剩余）、`bossHpMax` = 血条分母
     * （池子总量）、`bossShipId` = 哪条舰级算母舰。
     * ⚠ 原先这三格**一个都没过清洗器** ⇒ 战中读档后母舰血条回落到卡面血（69,592），
     * 池子剩余那份覆写凭空消失（"单场不死/跨场累计"当场失真）。三格都取正数/非空串。
     */
    const bh = foeOverrideRaw.bossHp
    if (typeof bh === 'number' && Number.isFinite(bh) && bh > 0) out.bossHp = Math.round(bh)
    const bhm = foeOverrideRaw.bossHpMax
    if (typeof bhm === 'number' && Number.isFinite(bhm) && bhm > 0) out.bossHpMax = Math.round(bhm)
    /**
     * **母舰三层血的两份读数**（2026-09-25 船长令：「当前血条按 护盾 → 装甲 → 结构 的顺序扣除」）：
     * `bossHpLayers` = 当前值（可含 0 ⇒ 护盾已空）、`bossMaxLayers` = 三层容量（界面分母）。
     * 两份都只收有限且 ≥0 的三个数（缺一不可 ⇒ 半份坏值整块丢掉，退回等比兜底）。
     */
    const layerOf = (raw: unknown): { s: number; a: number; h: number } | undefined => {
      const o = asRaw(raw)
      if (o === null || typeof o !== 'object') return undefined
      const ok = (v: unknown): number | undefined =>
        typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
      const s = ok(o.s)
      const a = ok(o.a)
      const h = ok(o.h)
      return s !== undefined && a !== undefined && h !== undefined ? { s, a, h } : undefined
    }
    const bhl = layerOf(foeOverrideRaw.bossHpLayers)
    if (bhl !== undefined) out.bossHpLayers = bhl
    const bml = layerOf(foeOverrideRaw.bossMaxLayers)
    if (bml !== undefined) out.bossMaxLayers = bml
    const bsid = foeOverrideRaw.bossShipId
    if (typeof bsid === 'string' && bsid.length > 0) out.bossShipId = bsid
    const w = foeOverrideRaw.waves
    if (Array.isArray(w)) {
      const waves: Array<{ units: number; hpShare: number }> = []
      for (const x of w) {
        const r = asRaw(x)
        if (r === null || typeof r !== 'object') continue
        waves.push({ units: Math.max(1, Math.floor(numf(r.units, 1))), hpShare: Math.max(0, numf(r.hpShare, 1)) })
      }
      if (waves.length > 0) out.waves = waves
    }
    return Object.keys(out).length > 0 ? out : undefined
  })()
  const repair = cleanRepair(b.repair)
  const shieldCharge = cleanShieldCharge(b.shieldCharge)
  /** 逐舰账本（2026-09-16 逐舰维修）：键 = 舰 tag；坏项丢键、整表空 ⇒ undefined（零迁移） */
  const repairBy = cleanLedgerMap(b.repairBy, cleanRepair)
  /**
   * **敌方后勤账本**（2026-09-16 船长）：`{ nextPulseAtMs, pulses, healed }`——整块缺/坏 ⇒ undefined
   * （零迁移：老档在途战斗本来就没有敌方后勤舰）。`pulses`/`healed` 取有限非负整数，`nextPulseAtMs` 可缺省。
   */
  const foeRepair = cleanFoeRepairLedger(b.foeRepair)
  const shieldChargeBy = cleanLedgerMap(b.shieldChargeBy, cleanShieldCharge)
  /**
   * **挂载件「船体修理装置」逐单位账本**（2026-09-24 船长）：键 = 战斗 tag
   * （敌方 tag 形如 `foe-0` / `w1-foe-0`）。值与 `foeRepair` 同形 ⇒ **共用同一条清洗器**。
   * ⚠ **必须随档**（登记表里也是 `persist`）：漏了会让战中重载**敌方修理计时重置 = 白赚一跳**。
   */
  const foeRepairPulses = cleanLedgerMap(b.foeRepairPulses, cleanFoeRepairLedger)
  /** 支援舰召唤计时（2026-09-25）：只收有限正数（时刻）/ 非负整数（次数），坏值丢字段 */
  const foeReviveAtMs =
    typeof b.foeReviveAtMs === 'number' && Number.isFinite(b.foeReviveAtMs) && b.foeReviveAtMs > 0
      ? b.foeReviveAtMs
      : undefined
  const foeReviveCount =
    typeof b.foeReviveCount === 'number' && Number.isFinite(b.foeReviveCount) && b.foeReviveCount > 0
      ? Math.floor(b.foeReviveCount)
      : undefined
  /** 力场账本（2026-09-20 新增；与 `shieldChargeBy` 分开：冷却按件、受益方是全队） */
  const shieldFieldBy = cleanLedgerMap(b.shieldFieldBy, cleanShieldField)
  const dronePools = cleanDronePools(b.dronePools)
  const droneLaunchBy = cleanDroneLaunchBy(b.droneLaunchBy)
  const foeDronePools = cleanFoeDronePools(b.foeDronePools)
  const droneLost = cleanCountMap(b.droneLost)
  const droneLoadAtStart = cleanCountMap(b.droneLoadAtStart)
  /** 逐舰账本（键 = 舰 tag；值是 `机型 → 架数`）：2026-09-14「逐舰机群」新增，老档没有 ⇒ undefined */
  const droneLostBy = cleanCountMapBy(b.droneLostBy)
  const droneLoadAtStartBy = cleanCountMapBy(b.droneLoadAtStartBy)
  /**
   * **无人机储备甲板的复位账**（2026-09-27 船长令）：逐舰一份，**坏值整条丢**（与其余账本同款口径）——
   * `q` 只收非空字符串、`t` 只收**有限非负数或 null**（null = 空闲）、`c` 只收**正数**（周期毫秒）、
   * `v` 走 `cleanCountMap`、`shipId` 非空字符串。四样缺一 ⇒ 这一舰的账整条作废
   * （宁可复位进度归零，也不让脏值把"扣两次库存"那条路走通）。
   */
  const droneRevive = cleanLedgerMap(b.droneRevive, (raw) => {
    const r = asRaw(raw)
    const shipId = typeof r.shipId === 'string' && r.shipId.length > 0 ? r.shipId : undefined
    if (shipId === undefined) return undefined
    const c = Array.isArray(r.c)
      ? r.c.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0)
      : []
    if (c.length === 0) return undefined
    const q = Array.isArray(r.q) ? r.q.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
    const tRaw = Array.isArray(r.t) ? r.t : []
    const t: Array<number | undefined> = c.map((_, i) => {
      const x = tRaw[i]
      return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : undefined
    })
    const v = cleanCountMap(r.v) ?? {}
    return { q, t, c, v, shipId, ...(r.printing === true ? { printing: true } : {}) }
  })
  /** **复活总预算**（开战库存快照，全队一本）：机型 → 剩余可补架数（坏值整条丢） */
  const droneReviveStock = cleanCountMap(b.droneReviveStock)
  const alienCorrosion = typeof b.alienCorrosion === 'number' && Number.isFinite(b.alienCorrosion) && b.alienCorrosion > 0 ? b.alienCorrosion : undefined
  const acidBursts = cleanLedgerMap(b.acidBursts, raw => {
    const r = asRaw(raw)
    if ((r.cause !== 'attack' && r.cause !== 'killed') || typeof r.atMs !== 'number' || !Number.isFinite(r.atMs) || r.atMs < 0) return undefined
    return { cause: r.cause as 'attack' | 'killed', atMs: r.atMs, resolved: r.resolved !== false }
  })
  const foeHatcheries = cleanLedgerMap(b.foeHatcheries, raw => {
    const r = asRaw(raw)
    if ((r.left !== 'unlimited' && (typeof r.left !== 'number' || !Number.isInteger(r.left) || r.left < 0)) || typeof r.revived !== 'number' || !Number.isInteger(r.revived) || r.revived < 0) return undefined
    const queue: NonNullable<BattleState['foeHatcheries']>[string]['queue'] = []
    for (const raw of Array.isArray(r.queue) ? r.queue : []) {
      if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) { if (!queue.includes(raw)) queue.push(raw); continue }
      const slot = asRaw(raw)
      if (typeof slot.tag !== 'string' || slot.tag.length === 0 || typeof slot.index !== 'number' || !Number.isInteger(slot.index) || slot.index < 0) continue
      if (!queue.some(i => typeof i !== 'number' && i.tag === slot.tag && i.index === slot.index)) queue.push({ tag: slot.tag, index: slot.index })
    }
    return { left: r.left, revived: r.revived, queue, ...(typeof r.nextAtMs === 'number' && Number.isFinite(r.nextAtMs) && r.nextAtMs >= 0 ? { nextAtMs: r.nextAtMs } : {}) }
  })
  const foeAbilityClocks = cleanLedgerMap(b.foeAbilityClocks, value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)
  const foeSummonAtMs = cleanLedgerMap(b.foeSummonAtMs, value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)
  const foeDroneRangeBuff = cleanPosNum(b.foeDroneRangeBuff)
  const foeGunRangeBuff = cleanPosNum(b.foeGunRangeBuff)
  /**
   * **我方捕获网两份账本**（2026-09-26）：
   * - `myWebs`（键 = 携带者 tag）：只收 `{ targetTag?: 非空字符串, cooldownUntilMs: 有限非负数 }`；
   * - `foeWebDebuffs`（键 = 被钉敌舰 tag）：保留合法我方捕获网减速；运行时按网手装备复核。
   * 坏值整条丢（与其余账本同款口径）。
   */
  const myWebs = cleanLedgerMap(b.myWebs, (raw) => {
    const r = asRaw(raw)
    const cd = r.cooldownUntilMs
    if (typeof cd !== 'number' || !Number.isFinite(cd) || cd < 0) return undefined
    const tt = typeof r.targetTag === 'string' && r.targetTag.length > 0 ? r.targetTag : undefined
    return { ...(tt !== undefined ? { targetTag: tt } : {}), cooldownUntilMs: cd }
  })
  const foeWebDebuffs = cleanLedgerMap(b.foeWebDebuffs, (raw) => {
    const r = asRaw(raw)
    const byTag = r.byTag
    if (typeof byTag !== 'string' || byTag.length === 0) return undefined
    return {
      byTag,
      slowMul: typeof r.slowMul === 'number' && Number.isFinite(r.slowMul) && r.slowMul > 0 && r.slowMul <= 1 ? r.slowMul : 0.5,
      noThruster: true as const,
      noEvasion: true as const,
      atMs: Math.max(0, numf(r.atMs, 0)),
    }
  })
  /**
   * **损伤管制装置免死状态**（2026-09-25 船长令；登记为 persist）——逐舰认：
   * `lockUntilMs` 取有限正数（游戏钟）、`used` 只认 true；两格都坏的条目丢键，整块空 = undefined。
   * 老档 / 无此件的场次 ⇒ 整块不写（零迁移）。
   */
  const dc = ((): BattleState['dc'] => {
    const raw = asRaw(b.dc)
    if (raw === null || typeof raw !== 'object') return undefined
    const out: NonNullable<BattleState['dc']> = {}
    for (const [tag, v] of Object.entries(raw)) {
      if (tag.length === 0) continue
      const o = asRaw(v)
      if (o === null || typeof o !== 'object') continue
      const entry: { lockUntilMs?: number; used?: boolean } = {}
      const lk = cleanPosNum(o.lockUntilMs)
      if (lk !== undefined && lk > 0) entry.lockUntilMs = Math.round(lk)
      if (o.used === true) entry.used = true
      if (entry.lockUntilMs !== undefined || entry.used === true) out[tag] = entry
    }
    return Object.keys(out).length > 0 ? out : undefined
  })()
  const dcKitsUsed = cleanPosNum(b.dcKitsUsed)
  /** 苏生协议账本：必须保留 used/维修进度，否则战中读档会再次触发一次性协议或重复维修。 */
  const foeRebirths = cleanLedgerMap(b.foeRebirths, (raw) => {
    const r = asRaw(raw)
    const keys = ['lockUntilMs', 'startedAtMs', 'repairUntilMs', 'lastRepairAtMs', 'armorHealed', 'hullHealed'] as const
    if (keys.some(key => cleanPosNum(r[key]) === undefined)) return undefined
    return Object.fromEntries(keys.map(key => [key, r[key]])) as NonNullable<BattleState['foeRebirths']>[string]
  })
  /** **本场 BOSS 阵亡时刻**（2026-09-27 船长令）：只收非负有限数；坏值/缺省 ⇒ 不写（零迁移） */
  const bossDownAtMs = cleanPosNum(b.bossDownAtMs)
  const cleaned: Partial<Record<keyof BattleState, unknown>> = {
    ...(() => {
      const now = Math.max(0, numf(b.lastTickGameMs, 0))
      const foeAcidLayers = cleanLedgerMap(b.foeAcidLayers, (raw) => {
        if (!Array.isArray(raw)) return undefined
        const layers = raw.flatMap(value => {
          const layer = asRaw(value)
          return typeof layer.cutPct === 'number' && Number.isFinite(layer.cutPct) && layer.cutPct > 0 && layer.cutPct <= 1 &&
            typeof layer.untilMs === 'number' && Number.isFinite(layer.untilMs) && layer.untilMs > now
            ? [{ cutPct: layer.cutPct, untilMs: layer.untilMs }] : []
        })
        return layers.length ? layers : undefined
      })
      return foeAcidLayers === undefined ? {} : { foeAcidLayers }
    })(),
    startedAtGameMs: Math.max(0, Math.floor(numf(b.startedAtGameMs, 0))),
    ...(foeOverride !== undefined ? { foeOverride } : {}),
    lastTickGameMs: Math.max(0, Math.floor(numf(b.lastTickGameMs, 0))),
    distanceM: Math.max(0, distance),
    myDesireM: Math.max(0, numf(b.myDesireM, distance)),
    ...(cleanBattleRangeSnapshot(b.rangeMemory) ? { rangeMemory: cleanBattleRangeSnapshot(b.rangeMemory) } : {}),
    units,
    ammo: {
      kin: numi(ammoRaw.kin, 0),
      exp: numi(ammoRaw.exp, 0),
      pla: numi(ammoRaw.pla, 0),
    },
    /**
     * **开战预载量**（F3c B2 · 谜质「弹药回收装置」）：只认"三个都是有限非负数"，
     * 缺字段 / 坏值 ⇒ **不写**（读取端在没有它时自动跳过这一项加成，不会把负数退成刷弹）。
     */
    ...(() => {
      const raw = asRaw(b.ammoLoaded)
      const ok =
        typeof raw.kin === 'number' &&
        Number.isFinite(raw.kin) &&
        typeof raw.exp === 'number' &&
        Number.isFinite(raw.exp) &&
        typeof raw.pla === 'number' &&
        Number.isFinite(raw.pla)
      return ok
        ? { ammoLoaded: { kin: Math.max(0, Math.floor(raw.kin as number)), exp: Math.max(0, Math.floor(raw.exp as number)), pla: Math.max(0, Math.floor(raw.pla as number)) } }
        : {}
    })(),
    stats: {
      meShots: numi(statsRaw.meShots, 0),
      meHits: numi(statsRaw.meHits, 0),
      meDmg: Math.max(0, numf(statsRaw.meDmg, 0)),
      foeShots: numi(statsRaw.foeShots, 0),
      foeHits: numi(statsRaw.foeHits, 0),
    },
    fx,
    // 序号续发：以清洗后尾部序号 +1 为基准（旧档无 seq 字段时按序重排，见 cleanFx）
    fxSeq: fx.length > 0 ? fx[fx.length - 1]!.seq + 1 : 0,
    ended: endedRaw === 'me' || endedRaw === 'foe' ? endedRaw : null,
    // 连续作战保险（2026-09-11：由"白名单未收录"改为**随档保留**）——悬赏巡回场次与低安遭遇战都挂它，
    // 战中重载若丢掉这三项，保险会凭空失效（该撤退的场次会继续打到弃船），与"承伤持久化"同一口径。
    ...(typeof b.hullEscapeFrac === 'number' && Number.isFinite(b.hullEscapeFrac)
      ? { hullEscapeFrac: b.hullEscapeFrac }
      : {}),
    ...(b.autoEscaped === true ? { autoEscaped: true } : {}),
    // 2026-09-12：`'cannot-engage'` 也随档（原先只认 'hull' | 'timeout' ⇒ 无法交战脱战的场次重载后
    // 会退化成"结构撤退"口径，战报与结算措辞都不对）
    ...(b.escapeReason === 'hull' || b.escapeReason === 'timeout' || b.escapeReason === 'cannot-engage'
      ? { escapeReason: b.escapeReason }
      : {}),
    // 损伤管制装置免死状态（2026-09-25）：**必须随档**（窗口跨拍；每场一次的口径也不许重载绕过）
    ...(dc !== undefined ? { dc } : {}),
    ...(dcKitsUsed !== undefined && dcKitsUsed > 0 ? { dcKitsUsed: Math.floor(dcKitsUsed) } : {}),
    waveIdx:
      typeof b.waveIdx === 'number' && Number.isFinite(b.waveIdx) && b.waveIdx > 0
        ? Math.floor(b.waveIdx)
        : undefined,
    waveClearAt:
      typeof b.waveClearAt === 'number' && Number.isFinite(b.waveClearAt) && b.waveClearAt > 0
        ? b.waveClearAt
        : undefined,
    // 本波起点（2026-10-02）：随档（见 BATTLE_FIELDS 的登记理由）；坏值/未换波 ⇒ 不写（读端回落开战时刻）
    foeWaveStartMs:
      typeof b.foeWaveStartMs === 'number' && Number.isFinite(b.foeWaveStartMs) && b.foeWaveStartMs > 0
        ? b.foeWaveStartMs
        : undefined,
    // 弹药 MK2（2026-09-09）：本场实装弹 id（键 = 伤害类型；坏值丢键，零迁移）
    ammoIds: cleanAmmoIdMap(b.ammoIds),
    ammoCreditByWeapon: (() => {
      const out: Record<string, number> = {}
      for (const [key, value] of Object.entries(asRaw(b.ammoCreditByWeapon))) {
        const match = /^([A-Za-z][\w-]*)#(\d+):(kinetic|explosive|plasma)$/.exec(key)
        if (!match || !units[match[1]!] || units[match[1]!]!.side !== 'me' || Number(match[2]) >= units[match[1]!]!.weapons.length) continue
        if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1) out[key] = value
      }
      return Object.keys(out).length ? out : undefined
    })(),
    expeditionAmmo: b.expeditionAmmo === undefined ? undefined : (() => {
      const r = asRaw(b.expeditionAmmo)
      const idsByTag: NonNullable<BattleState['expeditionAmmo']>['idsByTag'] = {}
      for (const [tag, ids] of Object.entries(asRaw(r.idsByTag))) idsByTag[tag] = cleanAmmoIdMap(ids) ?? {}
      return {
        stock: cleanCountMap(r.stock) ?? {}, loaded: cleanCountMap(r.loaded) ?? {}, idsByTag,
        ...(r.revivesSettled === true ? { revivesSettled: true } : {}),
      }
    })(),
    // 我方编队（虫洞 D 批）：坏项丢弃、空表 = 不写（= 单船路径，零迁移）
    myFleet: cleanMyFleet(b.myFleet),
    // 虫洞战斗标记（虫洞 F 批）：坏值丢弃（= 退回原卡强度），零迁移
    wormhole: cleanBattleWormhole(b.wormhole),
    // ── 2026-09-12 船长裁定七项（随档）──
    ...(repair !== undefined ? { repair } : {}),
  ...(shieldCharge !== undefined ? { shieldCharge } : {}),
    // ── 2026-09-16 逐舰维修（船长裁定「甲」）：逐舰账本同样**必须随档**（丢了 ⇒ 僚舰的组件凭空消失）──
    ...(repairBy !== undefined ? { repairBy } : {}),
    ...(shieldChargeBy !== undefined ? { shieldChargeBy } : {}),
    // 2026-09-20 力场账本（丢了 ⇒ 战中重载后力场计时重置 = 白赚一跳）
    ...(shieldFieldBy !== undefined ? { shieldFieldBy } : {}),
    // 2026-09-16 敌方后勤账本（丢了 ⇒ 战中重载后敌方修理计时重置）
    ...(foeRepair !== undefined ? { foeRepair } : {}),
    ...(foeRepairPulses !== undefined ? { foeRepairPulses } : {}),
    // 2026-09-25 支援舰召唤计时（丢了 ⇒ 战中重载后计时与序号重置）
    ...(foeReviveAtMs !== undefined ? { foeReviveAtMs } : {}),
    ...(foeReviveCount !== undefined ? { foeReviveCount } : {}),
    // 2026-09-26 我方捕获网（丢了 ⇒ 重载即刷新冷却、可换目标 = 白赚一轮控制）
    ...(myWebs !== undefined ? { myWebs } : {}),
    ...(foeWebDebuffs !== undefined ? { foeWebDebuffs } : {}),
    ...(dronePools !== undefined ? { dronePools } : {}),
    ...(droneLaunchBy !== undefined ? { droneLaunchBy } : {}),
    ...(foeDronePools !== undefined ? { foeDronePools } : {}),
    ...(droneLost !== undefined ? { droneLost } : {}),
    ...(droneLoadAtStart !== undefined ? { droneLoadAtStart } : {}),
    ...(droneLostBy !== undefined ? { droneLostBy } : {}),
    ...(droneLoadAtStartBy !== undefined ? { droneLoadAtStartBy } : {}),
    ...(droneRevive !== undefined ? { droneRevive } : {}),
    ...(droneReviveStock !== undefined ? { droneReviveStock } : {}),
    ...(alienCorrosion !== undefined ? { alienCorrosion } : {}),
    ...(acidBursts !== undefined ? { acidBursts } : {}),
    ...(foeAbilityClocks !== undefined ? { foeAbilityClocks } : {}),
    ...(foeSummonAtMs !== undefined ? { foeSummonAtMs } : {}),
    ...(foeHatcheries !== undefined ? { foeHatcheries } : {}),
    ...(foeDroneRangeBuff !== undefined ? { foeDroneRangeBuff } : {}),
    ...(foeGunRangeBuff !== undefined ? { foeGunRangeBuff } : {}),
    ...(foeRebirths !== undefined ? { foeRebirths } : {}),
    ...(() => {
      const meRebirths = cleanLedgerMap(b.meRebirths, raw => {
        const r = asRaw(raw)
        const keys = ['repairUntilMs', 'lastRepairAtMs', 'armorHealed', 'hullHealed'] as const
        if (keys.some(key => cleanPosNum(r[key]) === undefined)) return undefined
        return Object.fromEntries(keys.map(key => [key, r[key]])) as NonNullable<BattleState['meRebirths']>[string]
      })
      const meCrisisActive = cleanLedgerMap(b.meCrisisActive, value => value === true ? true as const : undefined)
      const meRailStacks = cleanLedgerMap(b.meRailStacks, value => typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.min(5, Math.floor(value)) : undefined)
      return { ...(meRebirths ? { meRebirths } : {}), ...(meCrisisActive ? { meCrisisActive } : {}), ...(meRailStacks ? { meRailStacks } : {}) }
    })(),
    // 2026-09-27 本场 BOSS 阵亡时刻（丢了 ⇒ "玩家亲手打沉"的事实消失，旗舰留档只能靠池子算术反推）
    ...(bossDownAtMs !== undefined ? { bossDownAtMs: Math.round(bossDownAtMs) } : {}),
  }
  // 组装：**只带走登记为 persist 的字段**（漏登记的字段在 typecheck 就会被拦下，见 BATTLE_FIELDS）
  const out: Partial<BattleState> = {}
  for (const key of BATTLE_PERSIST_KEYS) {
    const v = cleaned[key]
    if (v !== undefined) (out as Record<string, unknown>)[key as string] = v
  }
  return out as BattleState
}
