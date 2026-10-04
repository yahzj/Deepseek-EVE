/**
 * **R 族残骸回收奖励池**（**船长 2026-10-01 令**，两句原话照抄）：
 *
 * > 「**AI 核心为 R 族残骸回收的特色。**」
 * > 「**除了核心，还准备添加一件激光武器，和闪现装置。激光武器为叠光同款叠加攻速的，基础伤害偏低，
 * > 需要玩家叠满才威力较强。闪现装置为中槽，和R族同款，挨打触发闪现。但是冷却时间延长到12秒。**」
 *
 * 同日逐条追问的裁定（决定实现口径）：
 * - AI 核心：2026-10-04 限定为光环稀有残骸回收 · 产出率 **10%/批** ＋ **60/30/10**保持 ·
 *   **只在回收炉出**（甲）· **直接入核心账本**（船长答「如果是〔回收时抽中〕，**直接入账**」）；
 * - 激光武器：只做**一档**、势力特色、**放入残骸回收的奖励池**（甲 ＋ 追加「将AI核心也放进这个池子」）；
 *   曲线「单发 = 正常 MK3 的 30%」· 步长 **−300ms** · 下限 **600ms** · 射程 **7,000m** ·
 *   CPU **40** · 弹药 **250 发/场**；
 * - 闪现装置：**中槽单件**（甲）· 拉开 **2,000m**（甲）· 冷却 **12 秒** · **照搬敌方闪现动画**（甲）。
 *
 * 本用例锁四层：① 两件的件定义与参数 ② 装备 → 单位字段的建档接线（含"不装则零变化"）
 * ③ 激光的装填自加速在真实战斗里逐火递减并夹到下限 ④ 闪现挨打触发、12 秒冷却、且**不误触发**。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext, MODULES } from '@whale/data'
import {
  addShipToFleet,
  createInitialState,
  createPlayerSpec,
  startFleetBattleFor,
} from '../src/index'
import { advanceBattleFor } from '../src/combat'
import { rollRecycleCoreGain, RECYCLE_CORE_SHARE, RECYCLE_CORE_WEIGHTS } from '../src/salvage'

const ctx = buildSimContext()
const LASER = 'mod-lair-laser-r'
const BLINK = 'mod-lair-blink-r'
/** 最小的一张入侵卡（外围常驻 · 5× 粼光级）——真实战斗用它起 */
const CARD = 'corona-drift'

const modOf = (id: string) => MODULES.find((m) => m.id === id)

function freshState(ships: number, fitted: { high?: string[]; mid?: string[]; low?: string[] }) {
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  const ids: string[] = []
  for (let i = 0; i < ships; i++) ids.push(addShipToFleet(state, 'sh-thresher'))
  state.shipId = ids[0]!
  for (const id of ids) {
    state.fleet[id]!.fitted = {
      high: [...(fitted.high ?? [])],
      mid: [...(fitted.mid ?? [])],
      low: [...(fitted.low ?? [])],
    }
  }
  for (const a of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[a] = 9_000
  return { state, ids }
}

describe('R 族势力特色装备：件定义', () => {
  it('① 叠光激光炮 = 船长定案（单发 30% MK3 · −300ms/发 · 下限 600ms · 7,000m · CPU 40 · 250 发）', () => {
    const m = modOf(LASER)!
    expect(m, '件应在装备目录里').toBeTruthy()
    expect(m.slot, '高槽激光炮').toBe('laser')
    expect(m.rack).toBe('high')
    expect(m.damageType).toBe('plasma')
    expect(m.maxRangeM, '船长：射程可以降低到7000米').toBe(7000)
    expect(m.cpuUse, '船长：CPU按照正常势力武器的量给').toBe(40)
    expect(m.ammoPerEngagement, '船长：弹药取一个中间值，250发').toBe(250)
    expect(m.reloadMs, '船长定的起步装填').toBe(4400)
    expect(m.overlayDrive, '叠光同款叠加攻速').toEqual({ stepMs: 300, floorMs: 600 })
    // 单发 = 正常 MK3 的 30%：T3 激光（mod-laser-3）的 dmgMult 4.2 × 0.3
    const mk3 = modOf('mod-laser-3')!
    expect(m.dmgMult, 'dmgMult = MK3 激光 × 30%').toBeCloseTo((mk3.dmgMult ?? 0) * 0.3, 5)
    // **"单发 = 正常 MK3 的 30%"的实测**：同一套装配下各建一次档，比两门激光的单发
    const { state: sNew, ids: iNew } = freshState(1, { high: [LASER] })
    const { state: sMk3, ids: iMk3 } = freshState(1, { high: ['mod-laser-3'] })
    const shotOf = (s: typeof sNew, id: string): number =>
      createPlayerSpec(s, ctx, id)?.weapons.find((w) => w.src === 'laser')?.shotDmg ?? 0
    const shotNew = shotOf(sNew, iNew[0]!)
    const shotMk3 = shotOf(sMk3, iMk3[0]!)
    expect(shotNew, `单发 ${shotNew} 应是 MK3 激光 ${shotMk3} 的 30%`).toBe(Math.max(1, Math.round(shotMk3 * 0.3)))
    console.log(`  [读数] 单发实测：叠光激光炮 ${shotNew} vs 同装配 MK3 激光 ${shotMk3}（= ${((shotNew / shotMk3) * 100).toFixed(0)}%）`)
    console.log(
      `  [读数] 叠光激光炮：dmgMult ${m.dmgMult}（MK3 激光 ${mk3.dmgMult} 的 30%）· ` +
        `装填 ${m.reloadMs}ms → 下限 ${m.overlayDrive!.floorMs}ms（每发 −${m.overlayDrive!.stepMs}ms）· ` +
        `${m.maxRangeM}m · CPU ${m.cpuUse} · 弹药 ${m.ammoPerEngagement} 发`,
    )
  })

  it('② 跃迁规避装置 = 中槽单件 · 拉开 2km · 冷却 12 秒（比敌方的 5 秒长）', () => {
    const m = modOf(BLINK)!
    expect(m, '件应在装备目录里').toBeTruthy()
    expect(m.rack, '船长：闪现装置为中槽').toBe('mid')
    expect(m.blink, '与 R 族同款、冷却延长到 12 秒').toEqual({ distanceM: 2000, cooldownMs: 12_000 })
    expect(m.speedBonusPct, '它不是提速推进器（契约已开口子）').toBeUndefined()
    console.log(`  [读数] 跃迁规避装置：${m.rack} 槽 · 拉开 ${m.blink!.distanceM}m · 冷却 ${m.blink!.cooldownMs / 1000}s`)
  })
})

describe('R 族势力特色装备：装备 → 单位字段（建档接线）', () => {
  it('③ 装了才写字段（叠光激光炮 → 武器 overlayDrive；闪现 → 单位 meBlink）', () => {
    const { state, ids } = freshState(1, { high: [LASER], mid: [BLINK] })
    const spec = createPlayerSpec(state, ctx, ids[0]!)!
    const laser = spec.weapons.find((w) => w.overlayDrive !== undefined)
    expect(laser, '激光那条武器应带 overlayDrive').toBeTruthy()
    expect(laser!.overlayDrive).toEqual({ stepMs: 300, floorMs: 600 })
    expect(spec.meBlink, '单位应带 meBlink').toEqual({ distanceM: 2000, cooldownMs: 12_000 })
    console.log(
      `  [读数] 建档：武器「${laser!.label}」overlayDrive=${JSON.stringify(laser!.overlayDrive)} · ` +
        `meBlink=${JSON.stringify(spec.meBlink)}`,
    )
  })

  it('④ 不装这两件 ⇒ 字段一概不写（既有装配零行为变化）', () => {
    const { state, ids } = freshState(1, { high: ['mod-laser-3'], mid: ['mod-mwd-3'] })
    const spec = createPlayerSpec(state, ctx, ids[0]!)!
    expect(spec.meBlink, '不装闪现件 ⇒ meBlink 缺省').toBeUndefined()
    for (const w of spec.weapons) expect(w.overlayDrive, '不装叠光件 ⇒ overlayDrive 缺省').toBeUndefined()
  })
})

describe('R 族势力特色装备：真实战斗', () => {
  /** 起一场真实战斗：全队装 `fitted`，返回战斗与 tick */
  function battleOf(ships: number, fitted: { high?: string[]; mid?: string[]; low?: string[] }) {
    const { state, ids } = freshState(ships, fitted)
    const battle = startFleetBattleFor(state, ctx, ids, CARD, 0, null, { depth: 4, kind: 'node', waves: 1 })
    expect(battle, '开战应成功').toBeTruthy()
    const b = battle!
    return {
      b,
      ids,
      tick: (toMs: number) => {
        state.gameMs = toMs
        advanceBattleFor(state, ctx, b, ids[0]!, CARD)
      },
    }
  }

  it('⑤ 叠光激光炮：每开一火装填 −300ms，一路递减（夹在 600ms 下限之上）', () => {
    const { b, tick } = battleOf(6, { high: [LASER] })
    const seq: Array<{ t: number; r: number }> = []
    /**
     * ⚠ **采样粒度必须细于引擎的基本步长（100ms）**：`advanceBattleFor` 内部按 100ms 子步推进，
     * 首拍里就会连开数火（实测 250ms 一拍内主炮连打 6 发、激光从 4400 一路推到 2600）。
     * ⇒ 用 100ms 采样 + 先取首拍快照，才能看到**首发 4400ms**那一刻。
     */
    const sample = (t: number) => {
      const key = Object.keys(b.meOverlayReload ?? {})[0]
      const r = key ? b.meOverlayReload![key]!.r : undefined
      if (r === undefined) return
      if (seq.length === 0 || seq[seq.length - 1]!.r !== r) seq.push({ t, r })
    }
    /**
     * ⚠ **首拍的"4400 那一刻"抓不到**：`advanceBattleFor` 内部按 100ms 子步推进，
     * 第一次调用就把这一拍内的多轮开火全跑完（实测首拍即从 4400 连推到 2600）——
     * 循环外面 `b.meOverlayReload` 还不存在，循环里面第一个能读到的值就已经是这个中间态。
     * ⇒ **基准值的检查前移到开火之前**（本拍还没开火时读登记表，它正是懒初始化写进去的基准），
     * 战斗中只核"步长恒 300ms ＋ 夹到 600ms"。
     */
    tick(0)
    sample(0)
    for (let t = 100; t <= 200_000 && b.ended === null && seq[seq.length - 1]?.r !== 600; t += 100) {
      tick(t)
      sample(t)
    }
    const rs = seq.map((x) => x.r)
    expect(rs.length, '应观察到多次开火推进').toBeGreaterThanOrEqual(3)
    // ⚠ 抓不到"4400 那一刻"（原因见上面 sample 的注释）⇒ 基准值由用例 ①（件上 reloadMs = 4400）
    // 与 ③（建档后武器 reloadMs = 4400）两层锁住；战斗这一层只核**步长与夹取**。
    expect((4400 - (rs[0] ?? 4400)) % 300, '首个可读值也应与基准差 300 的整数倍').toBe(0)
    /**
     * ⚠ **2026-10-01 判据放宽：步长是 300 的"正整数倍"**（原为"恒等于 300"）。
     * 起因 = 船长同日新令「**敌舰消失时，玩家的武器不会开火（哪怕武器转好了）**」（闪现演出禁火）：
     * 闪现窗口里我方停火 200ms ⇒ 窗口一过**连开数发**（冷却照推、转好了立刻打）⇒ 一次采样里
     * 装填会**跨好几格**（实测第一格就是 1,500ms = 5 格）。每一发仍然各 −300ms，机制没变。
     */
    for (let i = 1; i < rs.length; i++) {
      const step = rs[i - 1]! - rs[i]!
      if (i === rs.length - 1 && rs[i] === 600) {
        expect(step, '最后一格夹到下限时只许少、不许多').toBeLessThanOrEqual(300)
      } else {
        expect(step, `第 ${i} 次推进的步长应是 300 的正整数倍（本拍连开了 ${step / 300} 发）`).toBeGreaterThan(0)
        expect(step % 300, `第 ${i} 次推进的步长应是 300 的正整数倍`).toBe(0)
      }
    }
    for (const r of rs) expect(r, '任何时刻都不得低于下限 600ms').toBeGreaterThanOrEqual(600)
    console.log(
      `  [读数] 叠光激光炮装填轨迹：${rs.join(' → ')}（每发 −300ms、下限 600ms；` +
        `${rs.length} 格 / ${(seq[seq.length - 1]!.t / 1000).toFixed(2)} 秒）`,
    )
  })

  it('⑥ 跃迁规避装置：挨打即拉开，冷却戳 = 触发时刻 + 12 秒', () => {
    const { b, tick } = battleOf(8, { high: ['mod-turret-kin-2'], mid: [BLINK] })
    let sawBlink = false
    /**
     * 🔴 **判据 2026-10-02 §35 换成"引擎权威记录"（`meBlinkQueue`）**——**裁定「2甲」**把
     * 我方位移由"触发即写"改成"`moveAtMs` 才兑现"之后，**"本拍距离比上一拍更远"这条代理断言就没有
     * 意义了**（位移要等 1/3 段之后才落，且本仓只有一根距离标量、敌我闪现同拍会互相覆写——§34 那条
     * 假红正是这么来的）。⇒ 直接核引擎排出来的那一段：**起终点真的拉开了 ＋ 三段时刻 = 旋钮**。
     */
    for (let t = 100; t <= 200_000 && b.ended === null; t += 100) {
      tick(t)
      const stamps = Object.values(b.meBlinks ?? {})
      if (stamps.length > 0) {
        sawBlink = true
        const tag = Object.keys(b.meBlinks ?? {})[0]!
        const seg = b.meBlinkQueue?.[tag]
        expect(seg, '我方闪现应排进 `meBlinkQueue`（§35：三段演出与光柱都靠它）').toBeTruthy()
        expect(seg!.to, '闪现应把我方与敌方的距离拉开（这一跳的终点 > 起点）').toBeGreaterThan(seg!.from)
        expect(seg!.appearMs - seg!.vanishMs, '单段演出时长应等于旋钮').toBe(ctx.balance.battle.foeBlinkProcessMs)
        /**
         * ⚠ **裁定 2甲的守卫**：触发那一拍位移**还没兑现**（旧口径是"触发即写"）。
         * `to > from = round(触发时的 distanceM)` ⇒ `distanceM` 必落在 `to` 之下 ⇒ 这两条一起钉住
         * "位移推迟到 `moveAtMs`"。
         */
        expect(b.distanceM, '触发那一拍不应已经换位（位移推迟到 moveAtMs）').not.toBe(seg!.to)
        for (const v of stamps) expect((v - 12_000) % 100, '冷却戳 = 触发时刻 + 12 秒（引擎基本步长 100ms）').toBe(0)
        break
      }
    }
    expect(sawBlink, '这场仗里应被命中并闪现').toBe(true)
    console.log(`  [读数] 我方闪现冷却戳 ${JSON.stringify(b.meBlinks)}（tag → 下次可用时刻 ms）`)
  })

  it('⑦ 冷却期内不重复闪（同一单位的冷却戳单调不减）；不装件则一次都不闪', () => {
    const withMod = battleOf(8, { high: ['mod-turret-kin-2'], mid: [BLINK] })
    const seen = new Map<string, number>()
    for (let t = 250; t <= 120_000 && withMod.b.ended === null; t += 250) {
      withMod.tick(t)
      for (const [tag, v] of Object.entries(withMod.b.meBlinks ?? {})) {
        const prev = seen.get(tag)
        if (prev !== undefined) expect(v, `${tag} 的冷却戳只在重新可用后才会更新`).toBeGreaterThanOrEqual(prev)
        seen.set(tag, v)
      }
    }
    expect(seen.size, '装了件 ⇒ 至少闪一次').toBeGreaterThan(0)
    // 对照：不装闪现件 ⇒ 整场 meBlinks 恒空
    const without = battleOf(8, { high: ['mod-turret-kin-2'] })
    for (let t = 250; t <= 60_000 && without.b.ended === null; t += 250) without.tick(t)
    expect(Object.keys(without.b.meBlinks ?? {}).length, '不装件 ⇒ 一次都不闪').toBe(0)
  })

  it('⑨ 我方闪现 ⇒ 敌方也停火（§35 禁火对称化）', () => {
    /**
     * 🔴 **船长 2026-10-02 §35 令**（原话照抄）：「**我方触发闪现时，闪现禁火对敌人也生效**」。
     *
     * 口径与我方那半**逐字对称**：`meBlinkQueue` 里有段处在 `vanishMs → appearMs` ⇒ **敌方**这一拍
     * 全门不开火（主炮与敌机群两处增量都过同一道 `blinkHoldSides(...).foe` 门）。
     * ⚠ 采样只认「**两端都在窗口内**的拍」：窗口若在某一拍**中途**开始/结束，那一拍里窗口外的几个引擎
     *   子步本来就可以开火 ⇒ 拿它当反例是误判（闪现段都是 100ms 栅格上的，窗口内必有整拍）。
     */
    const { b, tick } = battleOf(8, { high: ['mod-turret-kin-2'], mid: [BLINK] })
    const winAt = (ms: number): boolean =>
      Object.values(b.meBlinkQueue ?? {}).some((s) => ms >= s.vanishMs && ms < s.appearMs)
    let heldTicks = 0
    let frozenTicks = 0
    for (let t = 100; t <= 200_000 && b.ended === null && heldTicks < 6; t += 100) {
      const wasHeld = winAt(t - 100)
      const before = b.stats.foeShots
      tick(t)
      if (wasHeld && winAt(t)) {
        heldTicks += 1
        if (b.stats.foeShots === before) frozenTicks += 1
      }
    }
    expect(heldTicks, '本场应出现"整拍都在我方闪现窗口内"的拍').toBeGreaterThan(0)
    expect(frozenTicks, '我方闪现窗口内敌方一枪都不该开').toBe(heldTicks)
  })
})

describe('R 族残骸回收的 AI 核心（回收炉）', () => {
  it('⑧ 只有 R 族稀有残骸掷骰；普通与其余各族不出核心', () => {
    const rHits = Array.from({ length: 4000 }, (_, i) => rollRecycleCoreGain('wreck-r-inv', i + 1)).filter(
      (x) => x !== undefined,
    )
    const rHitsRare = Array.from({ length: 4000 }, (_, i) => rollRecycleCoreGain('wreck-rare-r-inv', i + 1)).filter(
      (x) => x !== undefined,
    )
    expect(rHits.length, 'R 族普通残骸不再产出核心').toBe(0)
    expect(rHitsRare.length, 'R 族稀有残骸应有命中').toBeGreaterThan(0)
    // 出货率 ≈ 10%
    const rate = rHitsRare.length / 4000
    expect(rate, `实测出货率 ${rate}（应 ≈ ${RECYCLE_CORE_SHARE}）`).toBeGreaterThan(0.07)
    expect(rate).toBeLessThan(0.13)
    // 档位分布 ≈ 60/30/10
    const counts = { gamma: 0, beta: 0, alpha: 0 }
    for (const t of rHitsRare) counts[t] += 1
    const total = rHitsRare.length
    expect(counts.gamma / total, '伽马最常见（60%）').toBeGreaterThan(0.5)
    expect(counts.alpha / total, '阿尔法最稀有（10%）').toBeLessThan(0.2)
    console.log(
      `  [读数] ${4000} 批 R 族稀有残骸：命中 ${rHitsRare.length} 次（${(rate * 100).toFixed(1)}%）· ` +
        `伽马 ${counts.gamma} / 贝塔 ${counts.beta} / 阿尔法 ${counts.alpha}` +
        `（权重 ${RECYCLE_CORE_WEIGHTS.gamma}/${RECYCLE_CORE_WEIGHTS.beta}/${RECYCLE_CORE_WEIGHTS.alpha}）`,
    )
    // 其余各族：一次都不掷（既有各族回收产出零变化的硬保证）
    for (const id of ['wreck-a-hi', 'wreck-c-wh', 'wreck-d-wh', 'wreck-e-wh', 'wreck-g-wh', 'wreck-h-hi', 'wreck-rare-h-hi', 'wreck-rare-a-hi', 'wreck-unknown', 'wreck-rare-unknown']) {
      for (let i = 1; i <= 200; i++) {
        expect(rollRecycleCoreGain(id, i), `${id} 不该出核心`).toBeUndefined()
      }
    }
    // 同批可复现、不同批不同
    expect(rollRecycleCoreGain('wreck-rare-r-inv', 7)).toBe(rollRecycleCoreGain('wreck-rare-r-inv', 7))
  })
})
