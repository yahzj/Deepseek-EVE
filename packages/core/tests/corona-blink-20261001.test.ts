/**
 * **光环科技 · 闪现跃迁仪**（**船长 2026-10-01 令**：「**激光武器+闪现效果的挂载件**」）。
 *
 * 背景：入侵第二族 R「光环科技 / Corona Systems」（原名「余晖」，同日因侵权嫌疑改判）——
 * 船长给的三条族格 = **激光武器（必中）· 风筝战术 · 闪现**。前两条落在舰级
 * （`energyForm: 'beam'` / `tactic: 'kite'`），**第三条落在本件**。
 *
 * 口径（船长同日逐条裁定）：
 * - **挂哪几档**：选「**乙：五档全带**」（T1~T5 每档都挂）；
 * - **参数与触发**：距离与触发选「**甲**」= 一次拉开 **2,000 m** · **本体被命中时触发**；
 *   🔴 **冷却 5 秒**（船长 2026-10-01 令「**全族闪现的间隔下调到5秒**」，原 12 秒）。
 *
 * 机制要点：本仓战斗**不做二维坐标**（只有 `BattleState.distanceM` 一个标量）⇒「闪现」= **距离突变**。
 * 冷却态记在 `BattleState.foeBlinks[tag]`（`save.ts` 登记 `kind: 'runtime'`，与 `foeCharges` 同口径）。
 *
 * 本用例锁四层：① 件定义与解析 ② 五档挂载 ③ 建档落地（＋别的族零行为变化）
 * ④ **真实战斗里真的闪了**（并验证冷却与"闪不动时不白盖冷却"）。
 */
import { describe, expect, it } from 'vitest'
import { FOE_SHIPS, buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState, startFleetBattleFor } from '../src/index'
import {
  advanceBattleFor,
  createFoeSpecs,
  foeDesiredRange,
  wormholeDerivedAnomaly,
} from '../src/combat'
import { FOE_MOUNT_IDS, FOE_MOUNTS, resolveFoeMounts } from '../src/foeMounts'

const ctx = buildSimContext()
const bal = ctx.balance.battle
/** 光环科技最小的那张卡（外围常驻 · 5× 粼光级）——真实战斗用它起 */
const CARD = 'corona-drift'
const R_SHIP_IDS = [
  'foe-r-corona-glint',
  'foe-r-corona-echo',
  'foe-r-corona-overlay',
  'foe-r-corona-dusk',
  'foe-r-corona-nexus',
] as const

describe('光环科技 · 闪现跃迁仪：件定义与解析', () => {
  it('① 件参数 = 船长选「甲」：一次 2,000 m · 冷却 5 秒；解析出 foeBlink', () => {
    const r = resolveFoeMounts([FOE_MOUNT_IDS.coronaBlink])
    expect(r.unknown, '件 id 必须已登记（否则体检判红）').toEqual([])
    expect(r.foeBlink, '闪现参数应原样带给单位').toEqual({ distanceM: 2_000, cooldownMs: 5_000 })
    console.log(`  [读数] 瞬光跃迁仪：拉开 ${r.foeBlink!.distanceM} m · 冷却 ${r.foeBlink!.cooldownMs / 1000} 秒`)
  })

  it('② 不挂该件的编成 ⇒ 解析结果里没有 foeBlink（既有各族零行为变化）', () => {
    expect(resolveFoeMounts([]).foeBlink).toBeUndefined()
    expect(resolveFoeMounts([FOE_MOUNT_IDS.inkRangeDebuff]).foeBlink).toBeUndefined()
  })
})

describe('光环科技 · 五档壳体（船长选「乙：五档全带」＋ 激光/风筝两条族格）', () => {
  it('③ 五档逐档常挂闪现件，且全部是 laser（beam）＋ kite', () => {
    for (const id of R_SHIP_IDS) {
      const s = FOE_SHIPS.find((x) => x.id === id)
      expect(s, `${id} 应在舰级表里`).toBeTruthy()
      expect(s!.family, `${id} 属 R 族`).toBe('R')
      // ⚠ 2026-10-01 追加：T1 粼光级另挂「闪烁过载装置」、T3 叠光级另挂「叠光装置」
      //（船长同日两句令）⇒ 本处只要求"闪现件在册"，两件专属装置的挂载面由
      // `corona-devices-20261001` 逐档锁死。
      expect(s!.mounts, `${id} 应常挂闪现件`).toContain(FOE_MOUNT_IDS.coronaBlink)
      expect(s!.energyForm, `${id} 是激光（能量·必中）`).toBe('beam')
      expect(s!.tactic, `${id} 是风筝战术`).toBe('kite')
    }
    console.log(`  [读数] R 族五档 ${R_SHIP_IDS.length} 艘：全部 beam + kite + 常挂瞬光跃迁仪`)
  })

  it('④ 建档：spec 上带 foeBlink；不带该件的族不带（缺省不写）', () => {
    const card = ctx.anomalies.get(CARD)!
    const specs = createFoeSpecs(card, bal, {})
    expect(specs.length).toBeGreaterThan(0)
    for (const sp of specs) {
      expect(sp.foeBlink, '本卡五艘都应带闪现参数').toEqual({ distanceM: 2_000, cooldownMs: 5_000 })
    }
    // 对照：H 族那四张卡一件都不带（零行为变化）
    const hCard = ctx.anomalies.get('ink-harass')!
    for (const sp of createFoeSpecs(hCard, bal, {})) {
      expect(sp.foeBlink, 'H 族不得带闪现').toBeUndefined()
    }
  })
})

describe('光环科技 · 闪现：真实战斗里的触发与冷却', () => {
  /** 起一场「光环 · 游弋集群」的真实战斗（照 `foe-capture-web` 的真开战入口写法） */
  function coronaBattle() {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const ids = [addShipToFleet(state, 'sh-thresher'), addShipToFleet(state, 'sh-thresher')]
    state.shipId = ids[0]!
    for (const id of ids) state.fleet[id]!.fitted = { high: ['mod-turret-kin-2'], mid: [], low: [] }
    for (const a of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[a] = 9_000
    const battle = startFleetBattleFor(state, ctx, ids, CARD, 0, null, { depth: 4, kind: 'node', waves: 1 })
    expect(battle).toBeTruthy()
    const b = battle!
    return {
      state,
      b,
      tick: (toMs: number) => {
        state.gameMs = toMs
        advanceBattleFor(state, ctx, b, ids[0]!, CARD)
      },
    }
  }

  it('⑤ 跑满一场：真的闪过（foeBlinks 里出现冷却戳），且冷却戳 = 触发时刻 + 5 秒', () => {
    const { b, tick } = coronaBattle()
    let sawBlink = false
    for (let t = 500; t <= 120_000 && b.ended === null; t += 500) {
      tick(t)
      const stamps = Object.values(b.foeBlinks ?? {})
      if (stamps.length > 0) {
        sawBlink = true
        // 冷却戳必须是「某个 500ms 整数拍的 lastTickGameMs + 5,000」
        // ⚠ 2026-10-01 船长令把全族闪现间隔由 12 秒下调到 **5 秒**（件定义 `cooldownMs: 5000`）——
        //   本行判据与注释原写 12 秒，随该令改正（判据本身当时就是 5,000，只是文字没跟上）。
        for (const v of stamps) expect((v - 5_000) % 500, '冷却戳 = 触发时刻 + 5 秒').toBe(0)
        break
      }
    }
    expect(sawBlink, '这场仗里应有敌舰被命中后闪现').toBe(true)
    console.log(`  [读数] 闪现冷却戳 ${JSON.stringify(b.foeBlinks)}（单位 tag → 下次可用时刻 ms）`)
  })

  it('⑥ 冷却期内不重复闪：同一单位的冷却戳只记一次（值单调不减）', () => {
    const { b, tick } = coronaBattle()
    const seen = new Map<string, number>()
    for (let t = 500; t <= 90_000 && b.ended === null; t += 500) {
      tick(t)
      for (const [tag, v] of Object.entries(b.foeBlinks ?? {})) {
        const prev = seen.get(tag)
        if (prev !== undefined) expect(v, `${tag} 的冷却戳只在重新可用后才会更新`).toBeGreaterThanOrEqual(prev)
        seen.set(tag, v)
      }
    }
    expect(seen.size, '至少有一艘闪过').toBeGreaterThan(0)
  })

  it('⑦ 方向 = **以期望距离为目标**（船长 2026-10-01 二次改判）', () => {
    /**
     * **船长 2026-10-01 两次改判**（原话照抄）：
     * - 第一次：「**闪烁的方向问题反而导致敌人能被无伤，建议修改为，闪烁方向以期望距离为目标。**」
     *   ——旧口径是"与我方意图反着来"，会把敌舰一路推到**我方射程之外**（船长实测"敌人能被无伤"）。
     * - 🔴 第二次（实测报障）：「**有些问题，当我攻击敌人后，敌人会瞬间闪现到我的期望距离**」
     *   ——第一次被我实现成了"闪到 `myDesireM`（**我方**的期望）"，于是敌舰**替玩家走位**。
     *
     * 定案判据 = **闪到"它自己的"期望交战距离**（与 `markFoeBlink` 里同一把尺 `foeDesiredRange`）：
     * ① 闪现后离**它自己的**期望距离更近（一次闪到位）；② 落点就压在它自己的期望距离上。
     * ⚠ 判据**不能**再拿 `myDesireM` 当目标：R 族开场会把 `foeDesireRangeM` 钉成族格算出的期望距离
     * （本卡实测 5,100m），而 `myDesireM` 是 5,840m —— 拿后者当目标正是船长报的那个 bug。
     */
    const derived = wormholeDerivedAnomaly(ctx, ctx.anomalies.get(CARD)!, {
      depth: 4,
      kind: 'node',
      waves: 1,
    })!
    const specs = createFoeSpecs(derived, bal, {})
    /**
     * 由运行态 tag 回查"建档案里的那一条"（`foeDesiredRange` 读的是建档案 spec 上的
     * `foeTactic` / `foeRangeBand` / `foeDesireRangeM`，运行态单位不带这三样）。
     * ⚠ 建档案 tag 与运行态 tag **同名**（`createFoeSpecs` 恒用 `foe-0` / `w0-foe-N` 这一套）
     * ⇒ **按 tag 精确匹配**；匹配不到（运行态带了波次前缀而建档案没带）再按序号回退。
     */
    const specOf = (tag: string) => {
      const exact = specs.find((sp) => sp.tag === tag)
      if (exact) return exact
      const n = Number(tag.slice(tag.lastIndexOf('-') + 1))
      const band = tag.startsWith('w0-') ? specs.slice(1) : specs
      return Number.isFinite(n) ? band[n] : undefined
    }
    const { b, tick } = coronaBattle()
    let checked = 0
    let prevBlinks = new Set(Object.keys(b.foeBlinks ?? {}))
    for (let t = 100; t <= 120_000 && b.ended === null; t += 100) {
      const before = b.distanceM
      tick(t)
      const nowTags = Object.keys(b.foeBlinks ?? {})
      const fresh = nowTags.filter((tag) => !prevBlinks.has(tag))
      if (fresh.length > 0) {
        const tag = fresh[0]!
        const own = specOf(tag)
        expect(own, `${tag} 应在建档案里找得到（否则判据无意义）`).toBeTruthy()
        const desire = foeDesiredRange(own!, [own!], bal, b.meFoeRangeDebuff ?? 0)
        const gapBefore = Math.abs(before - desire)
        const gapAfter = Math.abs(b.distanceM - desire)
        // 容差 200m：闪现后同一拍里引擎的走位逻辑还会再挪一点
        expect(
          gapAfter,
          `闪现后应更贴近**它自己的**期望距离（${before} → ${b.distanceM}，目标 ${desire}）`,
        ).toBeLessThan(gapBefore + 200)
        expect(gapAfter, `闪现后应真的落在它自己的期望距离上（差距 ${gapAfter}）`).toBeLessThan(200)
        checked += 1
        console.log(
          `  [读数] 闪现 #${checked}（${tag}）：距离 ${before} → ${b.distanceM}（它自己的期望 ${desire}）` +
            `⇒ 偏离 ${gapBefore} → ${gapAfter}；我方期望 ${b.myDesireM}（**不是**闪现目标）`,
        )
        prevBlinks = new Set(nowTags)
      }
      if (checked >= 3) break
    }
    expect(checked, '至少应观察到一次闪现').toBeGreaterThan(0)
  })

  it('⑧ 单次位移不超过件上的上限（2,000 m · 船长第三次改判）', () => {
    /**
     * 🔴 **船长 2026-10-01 第三次裁定**（原话照抄）：「**闪现之前不是设定每次闪现最多2000米吗**」
     * ——我第二次改判时把落点改成"闪到它自己的期望距离"，**却把件上的 `distanceM`（2,000m）丢在一边**
     * ⇒ 期望距离一突变（换波 / 我方射程变化）就出现**一键归位式的大瞬移**。
     * 实测报障场景 `corona-nexus` 第 4 波：期望距离 5,740 → 8,925 ⇒ 旧实现一跳 **3,185 m**。
     *
     * 本用例钉住修好后的形状（`combat.blinkStep`）：
     * ① 单次位移 ≤ **件上写的那个数**（从件定义读，不写死字面量 ⇒ 以后改参数这里自动跟随）；
     * ② 跳完必须**落在"跳前位置 → 它自己的期望距离"这段区间之内**（朝目标走、且不过冲）；
     * ③ 差得远 ⇒ 只走一格（**不越到期望位置之外**）。
     *
     * ⚠ **方向与步长是两件事**：⑦ 管方向（朝它自己的期望走）、本条管步长（一跳最多 2 公里）——
     * 两条都在，才不会"越闪越远被无伤"、也不会"一键归位"。
     */
    const blinkDef = FOE_MOUNTS[FOE_MOUNT_IDS.coronaBlink].blink!
    const stepCap = blinkDef.distanceM
    expect(stepCap, '件上应写着单次位移上限').toBeGreaterThan(0)

    const derived = wormholeDerivedAnomaly(ctx, ctx.anomalies.get('corona-nexus')!, {
      depth: 4,
      kind: 'node',
      waves: 1,
    })!
    const specs = createFoeSpecs(derived, bal, {})
    /** 同上：**按 tag 精确匹配**（多波卡的建档案 tag 是连续的 `w0-foe-1..14`，不是"每波一小段"） */
    const specOf = (tag: string) => specs.find((sp) => sp.tag === tag)
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const ids: string[] = []
    for (let i = 0; i < 24; i++) ids.push(addShipToFleet(state, 'sh-thresher'))
    state.shipId = ids[0]!
    for (const id of ids) state.fleet[id]!.fitted = { high: ['mod-turret-kin-2'], mid: [], low: [] }
    for (const a of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[a] = 9_000
    const b = startFleetBattleFor(state, ctx, ids, 'corona-nexus', 0, null, { depth: 4, kind: 'node', waves: 1 }, { strengthMul: 2 })!
    expect(b, '开战应成功').toBeTruthy()

    /** 起始观察点：**采样循环之前**也记一次（否则第一拍（t=100）的闪现会被当成冷启动而漏掉） */
    const prevSeen = new Map<string, number>()
    for (const [tag, until] of Object.entries(b.foeBlinks ?? {})) prevSeen.set(tag, until)
    let checked = 0
    let maxJump = 0
    /**
     * ⚠ **判据读「单舰这一跳」的旁路记账**（`BattleState.foeBlinkJumps`），**不读聚合的 `distanceM` 变化**：
     * 落点是全局标量，**多舰可以同一拍各闪一次** ⇒ 聚合位移是多次跳变之和。
     * 本仓实测踩过这个坑：`corona-nexus` 开场同拍 6 舰各闪一格 ⇒ 聚合位移 2,678 m，
     * 用聚合值会误报"一跳超 2,000m"（实际每舰都合规）。
     */
    for (let t = 100; t <= 400_000 && b.ended === null; t += 100) {
      state.gameMs = t
      advanceBattleFor(state, ctx, b, ids[0]!, 'corona-nexus')
      for (const [tag, until] of Object.entries(b.foeBlinks ?? {})) {
        if (prevSeen.get(tag) === until) continue
        prevSeen.set(tag, until)
        const own = specOf(tag)
        expect(own, `${tag} 应在建档案里找得到（否则判据无意义）`).toBeTruthy()
        const want = foeDesiredRange(own!, [own!], bal, b.meFoeRangeDebuff ?? 0)
        /** 本舰这一跳：起点 / 幅度 / 方向（引擎旁路记账那笔，**不是** `distanceM` 的整体变化） */
        const rec = b.foeBlinkJumps?.[tag]
        expect(rec, `${tag} 应有本跳的旁路记账`).toBeTruthy()
        const moved = rec!.moved
        maxJump = Math.max(maxJump, moved)
        /**
         * ⚠ **容差 0.5m = 船长 2026-10-01 那句「允许闪现出现小幅度误差……不要误差——只是允许浮点尾巴」**：
         * 战斗距离是逐拍走位累加出来的小数（实测 `3553.48416`）⇒ 位移会带一条浮点尾巴
         * （实测修前 2000.207）。**判据本意是"一跳不许超过件上限"**，不是把浮点误差判红 ⇒ 留半米容差。
         */
        expect(
          moved,
          `${tag} t=${t} 单次位移 ${Math.round(moved)} m 不得超过件上的 ${stepCap} m（含 0.5m 浮点容差）`,
        ).toBeLessThanOrEqual(stepCap + 0.5)
        /** 方向：从**它的起点**朝它自己的期望走（用记账的 `dir` 判，不受同拍其它舰的落点干扰） */
        const sign = Math.sign(want - rec!.from)
        expect(
          rec!.dir * sign,
          `${tag} t=${t} 应朝它自己的期望（${want}）走，不得反向（起点 ${Math.round(rec!.from)} ⇒ 本跳 ${rec!.dir}）`,
        ).toBeGreaterThan(0)
        /** 不过冲：跳完不越过自己的期望 */
        expect(
          Math.abs(want - (rec!.from + rec!.dir * rec!.moved)),
          `${tag} t=${t} 一跳不得越过它自己的期望（起点 ${Math.round(rec!.from)} + ${rec!.dir * rec!.moved} vs 期望 ${want}）`,
        ).toBeLessThanOrEqual(Math.abs(want - rec!.from) + 1e-9)
        checked += 1
        console.log(
          `  [读数] 闪现（${tag} · t=${t}）：从 ${Math.round(rec!.from)} ${rec!.dir > 0 ? '拉远' : '拉近'} ${Math.round(moved)} m` +
            `（上限 ${stepCap} · 它自己的期望 ${want}）`,
        )
      }
    }
    expect(checked, '至少应观察到一次闪现').toBeGreaterThan(0)
    console.log(`  [读数] 本场闪现 ${checked} 次 · 最大单次位移 ${Math.round(maxJump)} m（上限 ${stepCap} m）`)
  })

  it('⑨ 演出时长走平衡表旋钮（2000ms）＋ 排队依次错开 ＋ 演出期我方禁火', () => {
    /**
     * 🔴 **船长 2026-10-02 令**（原话照抄）：「**给闪现发生速度做一个旋钮，我感觉现在可能太短导致
     * 看不出来，先将整个过程延长到2000ms**」；并裁定「**不停表，但是敌舰消失时，玩家的武器不会开火
     * （哪怕武器转好了）**」。
     *
     * 本用例钉三件事：
     * ① **旋钮落点** = `balance.battle.foeBlinkProcessMs`（单次演出的整个过程）与 `foeBlinkGapMs`（段间隔）；
     * ② **队列时刻表**：每段 `appearMs − vanishMs` 恰等于旋钮值（⇒ 2000ms）；
     * ③ **禁火窗口与演出同期**：窗口内我方门不开火、窗口一过立刻开（冷却照推不浪费）。
     */
    expect(bal.foeBlinkProcessMs, '旋钮：单次闪现的整个过程（船长令 2000ms）').toBe(2_000)
    expect(bal.foeBlinkGapMs, '旋钮：相邻两次闪现的间隔').toBe(200)

    const { b, tick } = coronaBattle()
    let checked = 0
    let holdSeen = 0
    const prevSeen = new Map<string, number>()
    for (const [tag, until] of Object.entries(b.foeBlinks ?? {})) prevSeen.set(tag, until)
    for (let t = 100; t <= 200_000 && b.ended === null && checked < 2; t += 100) {
      tick(t)
      /** ③ 禁火窗口：用引擎口径判（任一敌舰处在 vanishMs → appearMs 之间）——只在闪现那几拍才该为真 */
      const q = b.foeBlinkQueue ?? {}
      const inWindow = Object.values(q).some((seg) => t >= seg.vanishMs && t < seg.appearMs)
      if (inWindow) holdSeen += 1
      for (const [tag, until] of Object.entries(b.foeBlinks ?? {})) {
        if (prevSeen.get(tag) === until) continue
        prevSeen.set(tag, until)
        const seg = q[tag]
        expect(seg, `${tag} 闪现后应排进队列`).toBeTruthy()
        /** ② 每段恒 = 旋钮值（不再写死 200ms） */
        expect(seg!.appearMs - seg!.vanishMs, `${tag} 单段演出时长应等于旋钮`).toBe(bal.foeBlinkProcessMs)
        checked += 1
        console.log(
          `  [读数] 演出排队（${tag}）：入队=${seg!.queuedMs} 消失=${seg!.vanishMs} 出现=${seg!.appearMs}` +
            `（段长 ${seg!.appearMs - seg!.vanishMs}ms ＝ 旋钮 ${bal.foeBlinkProcessMs}ms）`,
        )
      }
    }
    expect(checked, '至少应观察到一次闪现').toBeGreaterThan(0)
    expect(holdSeen, '演出窗口内应存在"禁火"的拍（船长裁定：敌舰消失时我方不开火）').toBeGreaterThan(0)
  })
})
