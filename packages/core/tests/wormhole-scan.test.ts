/**
 * **虫洞扫描（发现线）**（船长 2026-09-14：「新增主控活动：'扫描虫洞'…进度条满后…发现一个虫洞。
 * 玩家最多可以囤积5个未开始探索的虫洞」「遇袭不中断扫描」「信号分析学，星图测绘学，信号过滤学的
 * rank 分别修改为3-4-5」；**同日两条改判**：「**虫洞扫描时长提高到12小时。**」＋
 * 「**星际奇遇学，对缩减虫洞的时间也有效。**」「**满级后缩减虫洞扫描周期20%**」「**并移动到探索内**」
 * 「**rank提升到5**」）。
 *
 * 锁住六条口径：
 * ① 窗口 = **12 小时** × 三技能乘算 × **星际奇遇学**（不练 = 12 小时；奇遇学**每级 −4%、满级恰 −20%**
 *    —— **2026-09-17 船长改判**：「将一些只有满级后才有效果的技能，拆分成每个等级效果」⇒ 由阶跃改线性）；
 * ② 主控活动互斥（**2026-09-21 改口径**：跨活动互斥统一归 `activityGate`——可自动停的"停掉它再开扫"、
 *    远征/快递/战斗中/洞里/返航途中才拒；`wormholeScanBlockReason` 只留本入口自己的前置）；
 * ③ 推进：满一个窗口发现一处进库存，**连续跨窗可连出**（离线大步长）；
 * ④ **库存上限 5**：满则**扫描停机**并写一条提示（不静默白跑）；
 * ⑤ 随档往返 + 坏值清洗（非法条目丢弃、超出上限截断）；
 * ⑥ 技能口径：三项扫描技能 `rank` = 3 / 4 / 5；**星际奇遇学 `rank` = 5 且归「探索」组**（同日改判）。
 * （"解锁当次送一格"= 船长同日裁定「甲」，由 `reconcileWormholeScanWelcome` 落码，专测在 `wormhole-unlock.test.ts`。）
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext, ITEMS, SKILLS } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { wormholeEnter } from '../src/wormhole'
// 2026-09-16 船长：扫描页虫洞卡片的"敌情"（族称 + 主系 + 三档构成）
import { wormholeFamilyIntel } from '../src/wormholeFoes'
import { scanWindowMsOf } from '../src/explore'
import {
  WORMHOLE_SCAN_BASE_MS,
  WORMHOLE_SCAN_UNLOCK_STANDING,
  WORMHOLE_STOCK_MAX,
  WORMHOLE_STOCK_MAX_HARD,
  WORMHOLE_STOCK_BONUS,
  WORMHOLE_STOCK_BONUS_PER_LEVEL,
  wormholeStockMaxOf,
  advanceWormholeScan,
  wormholeScanBlockReason,
  wormholeScanStart,
  wormholeScanStop,
  wormholeScanWindowMs,
  wormholeStockFull,
  wormholeStockOf,
} from '../src/wormholeScan'

const ctx = buildSimContext()
const T3 = 'sh-thresher'
void ITEMS

function fresh(seed = 4242): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  /**
   * 扫本文件的用例只管"扫描机制"（窗口/互斥/续扫/离线连出/库存满/往返），
   * **解锁门槛另有专测**（`wormhole-unlock.test.ts`：协会声望 < 35 一律拦）⇒ 这里直接把声望垫到达标。
   */
  state.standings['dsi'] = WORMHOLE_SCAN_UNLOCK_STANDING
  /**
   * ⚠ **"解锁当次送一格"（`reconcileWormholeScanWelcome`）另有专测**（`wormhole-unlock.test.ts`）：
   * 这里直接标记"已发放"，免得"进度条被预置满格"把窗口 / 停机 / 往返这些机制用例的读数全推高一格。
   */
  state.wormholeScan = { active: false, progressMs: 0, welcomed: true }
  return state
}

/** 把三项扫描技能练到 Lv（船长新 rank 上限：分析 3 / 测绘 4 / 过滤 5） */
function trainScanSkills(state: GameState, aLv: number, bLv: number, cLv: number): void {
  state.skills.trained['signal-analysis'] = aLv
  state.skills.trained['signal-filtering'] = bLv
  state.skills.trained['cartography'] = cLv
}

describe('虫洞 · 扫描虫洞（主控活动）', () => {
  it('**窗口 = 12 小时 × 三技能乘算 × 星际奇遇学**（不练 12 小时；奇遇学满级再 −20%）', () => {
    const state = fresh()
    expect(WORMHOLE_SCAN_BASE_MS).toBe(12 * 60 * 60_000)
    expect(wormholeScanWindowMs(state)).toBe(WORMHOLE_SCAN_BASE_MS)
    // 三项（−8%×3 · −6%×4 · −6%×5 乘算）：12 小时 × 0.76 × 0.76 × 0.70 ≈ 291 分钟
    trainScanSkills(state, 3, 4, 5)
    const three = wormholeScanWindowMs(state)
    expect(three).toBeLessThan(295 * 60_000)
    expect(three).toBeGreaterThan(285 * 60_000)
    // 单练一项也缩短（乘算叠加）
    const state2 = fresh()
    trainScanSkills(state2, 3, 0, 0)
    expect(wormholeScanWindowMs(state2)).toBeLessThan(WORMHOLE_SCAN_BASE_MS)
    /**
     * **星际奇遇学 = 虫洞专属的第四项**（船长 2026-09-14 追加；**2026-09-17 改判为线性**）：
     * **每级 −4%、满级恰 −20%**（`1 − 0.04 × 等级`，见 `happeningsScanFactor`），与三技能**乘算**。
     * ⚠ 旧口径「**满级（Lv5）才一次性 −20%**（Lv1~4 对虫洞零效果）」**已作废**——船长 2026-09-17：
     * 「**将一些只有满级后才有效果的技能，拆分成每个等级效果**」。
     */
    const state3 = fresh()
    state3.skills.trained['galactic-happenings'] = 5
    expect(wormholeScanWindowMs(state3)).toBe(Math.round(WORMHOLE_SCAN_BASE_MS * 0.8))
    // 线性两侧：Lv4 ×0.84、Lv1 ×0.96（**旧阶跃口径下这两档与不练同值**，那正是本批要消灭的行为）
    const state4 = fresh()
    state4.skills.trained['galactic-happenings'] = 4
    expect(wormholeScanWindowMs(state4)).toBe(Math.round(WORMHOLE_SCAN_BASE_MS * 0.84))
    const state5 = fresh()
    state5.skills.trained['galactic-happenings'] = 1
    expect(wormholeScanWindowMs(state5)).toBe(Math.round(WORMHOLE_SCAN_BASE_MS * 0.96))
    state.skills.trained['galactic-happenings'] = 5
    expect(wormholeScanWindowMs(state)).toBe(Math.round(three * 0.8))
    // ⚠ **星图扫描不吃这一项**（船长只点了虫洞）：同一档位上就地扫描窗口不受奇遇学影响
    const starmap = fresh()
    const before = scanWindowMsOf(starmap)
    starmap.skills.trained['galactic-happenings'] = 5
    expect(scanWindowMsOf(starmap)).toBe(before)
  })

  it('**技能口径**：三项扫描技能 rank = 3/4/5；星际奇遇学 rank = 5 且归「探索」组（船长 2026-09-14 口径）', () => {
    const byId = (id: string) => SKILLS.find((s) => s.id === id)!
    expect(byId('signal-analysis').rank).toBe(3)
    expect(byId('cartography').rank).toBe(4)
    expect(byId('signal-filtering').rank).toBe(5)
    // 同日改判：「rank提升到5」＋「并移动到探索内」（原属贸易组）
    expect(byId('galactic-happenings').rank).toBe(5)
    expect(byId('galactic-happenings').group).toBe('探索')
  })

  /**
   * ⚠ **2026-09-21 船长令改判**（「统一为能够直接切换（自动取消当前活动）」）：`wormholeScanBlockReason`
   * **不再**列"主控正在采矿/打捞/远征/航行/待命"那九条（整段撤掉）——开扫前只有**自己的前置**留在这把尺上
   * （解锁门槛 / 洞里 / 遭遇战未决 / 库存满），跨活动互斥改由 `activityGate` 统一裁决：
   * **可自动停的 ⇒ 停掉它再开扫** · 远征/快递/战斗中/洞里/返航途中 ⇒ 拒。
   */
  it('**扫描虫洞只拦自己的前置**（解锁/洞里/遭遇战/库存满）；跨活动互斥改走 `activityGate`', () => {
    const a = fresh()
    expect(wormholeScanStart(a, ctx).ok).toBe(true)
    expect(wormholeScanStart(a, ctx).ok).toBe(false) // 已经在扫
    // 采矿中 ⇒ **不再由 block reason 拦**，开扫时自动停采（统一日志）
    const b = fresh()
    b.mining.active = true
    expect(wormholeScanBlockReason(b)).toBeNull()
    expect(wormholeScanStart(b, ctx).ok).toBe(true)
    expect(b.mining.active).toBe(false)
    expect(b.logs.some((l) => l.text.includes('已自动停止「开采」'))).toBe(true)
    // 打捞中 ⇒ 同款（自动停打捞）
    const c = fresh()
    c.salvaging.active = true
    expect(wormholeScanBlockReason(c)).toBeNull()
    expect(wormholeScanStart(c, ctx).ok).toBe(true)
    expect(c.salvaging.active).toBe(false)
    // 2026-09-15 船长：星系扫描 = 无人扫描艇（不占主控）⇒ 扫描中照样能开扫虫洞
    const d = fresh()
    d.scanning = { active: true, galaxyId: 'galaxy-hub', finishAtGameMs: 600_000, startedAtGameMs: 0, originGalaxy: null }
    expect(wormholeScanBlockReason(d)).toBeNull()
    expect(wormholeScanStart(d, ctx).ok).toBe(true)
    // 远征在飞 ⇒ **照旧拒**（不可中断那一档，措辞统一为 activityGate 那句）
    const e = fresh()
    e.expedition.active = true
    const ev = wormholeScanStart(e, ctx)
    expect(ev.ok).toBe(false)
    expect(ev.error ?? '').toContain('不能中断')
    // 人在洞里 ⇒ 拒（本入口自己的前置）
    const f = fresh()
    const uid = addShipToFleet(f, T3)
    f.shipId = uid
    expect(wormholeEnter(f, ctx, [uid], 9).ok).toBe(true)
    expect(wormholeScanBlockReason(f)).not.toBeNull() // 人在洞里
  })

  it('**停扫保留进度**（下次接着扫，不清零）', () => {
    const state = fresh()
    expect(wormholeScanStart(state, ctx).ok).toBe(true)
    advanceWormholeScan(state, ctx, 30 * 60_000)
    expect(state.wormholeScan!.progressMs).toBe(30 * 60_000)
    expect(wormholeScanStop(state).ok).toBe(true)
    expect(state.wormholeScan!.active).toBe(false)
    expect(state.wormholeScan!.progressMs).toBe(30 * 60_000)
    // 续扫：进度还在
    expect(wormholeScanStart(state, ctx).ok).toBe(true)
    advanceWormholeScan(state, ctx, wormholeScanWindowMs(state) - 30 * 60_000)
    expect(wormholeStockOf(state)).toHaveLength(1)
  })

  it('**满一个窗口发现一处**；离线大步长可连出（跨多窗）', () => {
    const state = fresh()
    wormholeScanStart(state, ctx)
    const w = wormholeScanWindowMs(state)
    advanceWormholeScan(state, ctx, w - 1000)
    expect(wormholeStockOf(state)).toHaveLength(0)
    advanceWormholeScan(state, ctx, 1000)
    expect(wormholeStockOf(state)).toHaveLength(1)
    // 一次跨 3 个窗口 ⇒ 再出 3 处（累计 4）
    advanceWormholeScan(state, ctx, w * 3)
    expect(wormholeStockOf(state)).toHaveLength(4)
    // 每处都带种子 + **起始层恒 1**（船长 2026-09-14：「所有虫洞都是从1层开始探索」）
    for (const item of wormholeStockOf(state)) {
      expect(item.seed).toBeGreaterThan(0)
      expect(item.depth).toBe(1)
    }
  })

  it('**库存上限 5 ⇒ 扫描停机并提示**（不静默白跑）', () => {
    const state = fresh()
    wormholeScanStart(state, ctx)
    const w = wormholeScanWindowMs(state)
    advanceWormholeScan(state, ctx, w * 5) // 连出 5 处（正好到上限）
    expect(wormholeStockOf(state)).toHaveLength(WORMHOLE_STOCK_MAX)
    expect(wormholeStockFull(state)).toBe(true)
    expect(state.wormholeScan!.active).toBe(true) // 还没停机（第 6 个窗口才撞上限）
    advanceWormholeScan(state, ctx, w)
    expect(state.wormholeScan!.active).toBe(false) // 停机
    expect(wormholeStockOf(state)).toHaveLength(WORMHOLE_STOCK_MAX)
    expect(state.logs.map((l) => l.text).some((t) => t.includes('扫描停机'))).toBe(true)
    // 满仓时也不许再开扫（给的是"先去探索掉一处"）
    expect(wormholeScanBlockReason(state) ?? '').toContain('囤积')
  })

  it('**随档往返 + 坏值清洗**（可选字段 ⇒ 零迁移）', () => {
    const state = fresh()
    wormholeScanStart(state, ctx)
    advanceWormholeScan(state, ctx, wormholeScanWindowMs(state))
    const back = loadSaveFile(serializeSaveFile(state, 1)).state
    expect(back.wormholeScan!.active).toBe(true)
    expect(back.wormholeStock).toHaveLength(1)
    expect(back.wormholeStock![0]!.seed).toBe(wormholeStockOf(state)[0]!.seed)
    // 坏值：非法条目丢弃；超出上限截断
    const raw = JSON.parse(serializeSaveFile(state, 1)) as Record<string, unknown>
    const st = raw.state as Record<string, unknown>
    st.wormholeStock = [
      { id: '', seed: 5, depth: 1, foundAtGameMs: 0 },
      { id: 'ok', seed: 0, depth: 1, foundAtGameMs: 0 },
      // 20 条合法（> 理论上限 15）⇒ 用来验证"截到上限"这一步仍然生效
      ...Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, seed: 100 + i, depth: 2, foundAtGameMs: 0 })),
    ]
    st.wormholeScan = { active: 'yes', progressMs: -5 }
    const cleaned = loadSaveFile(JSON.stringify(raw)).state
    // 截到**理论最大值**（基础 5 ＋ 星图记录学满级 10 = 15）：满级玩家的 15 格不会因为"读档时技能看起来没到"被砍
    expect(cleaned.wormholeStock).toHaveLength(WORMHOLE_STOCK_MAX_HARD)
    expect(cleaned.wormholeStock!.every((x) => x.id.startsWith('x'))).toBe(true)
    // 旧档里的起始层 2/3（上面这批就是 depth: 2）**载入时一律归 1**
    expect(cleaned.wormholeStock!.every((x) => x.depth === 1)).toBe(true)
    expect(cleaned.wormholeScan).toEqual({ active: false, progressMs: 0 })
  })

  it('**保存上限随「星图记录学」每级 +2（满级 +10）**（船长 2026-09-16 改判：由阶跃改为线性）', () => {
    const s = fresh()
    // 不练：基础 5 处
    expect(wormholeStockMaxOf(s)).toBe(WORMHOLE_STOCK_MAX)
    // **每级 +2**：Lv1 7 / Lv2 9 / Lv3 11 / Lv4 13（旧口径 Lv1~4 一律 5，本批改判）
    for (const [lv, want] of [
      [1, WORMHOLE_STOCK_MAX + 2],
      [2, WORMHOLE_STOCK_MAX + 4],
      [3, WORMHOLE_STOCK_MAX + 6],
      [4, WORMHOLE_STOCK_MAX + 8],
    ] as const) {
      s.skills.trained['chart-archive'] = lv
      expect(wormholeStockMaxOf(s), `Lv${lv}`).toBe(want)
    }
    // 满级（Lv5）：基础 + 10 = 15 处（**满级总量与旧口径一致**）
    s.skills.trained['chart-archive'] = 5
    expect(wormholeStockMaxOf(s)).toBe(WORMHOLE_STOCK_MAX + 10)
    // 防漂移守卫：满级锚（常量）必须 = 每级值 × 5（两处不许各自漂）
    expect(WORMHOLE_STOCK_BONUS).toBe(WORMHOLE_STOCK_BONUS_PER_LEVEL * 5)
    expect(WORMHOLE_STOCK_MAX_HARD).toBe(WORMHOLE_STOCK_MAX + 10) // 读档钳制用的理论最大值（不变）
    /**
     * 实战：满级后能囤到 15 处（**停机阈值跟着抬高**——改前第 6 处就会停机）。
     * 用 `debugQuick` 把窗口压到 1 秒，直接连扫 15 个窗口。
     */
    s.debugQuick = true
    expect(wormholeScanStart(s, ctx).ok).toBe(true)
    advanceWormholeScan(s, ctx, 15_000)
    expect(wormholeStockOf(s)).toHaveLength(15)
    expect(wormholeStockFull(s)).toBe(true)
    expect(s.wormholeScan!.active).toBe(true) // 第 16 个窗口才撞上限
    advanceWormholeScan(s, ctx, 1_000)
    expect(s.wormholeScan!.active).toBe(false) // 停机
    expect(s.logs.map((l) => l.text).some((t) => t.includes('扫描停机'))).toBe(true)
    // 满仓时的开扫拦截文案带的是**新上限**（15），不是 5
    expect(wormholeScanBlockReason(s) ?? '').toContain('15')
  })
})

/**
 * **虫洞卡片"敌情"**（船长 2026-09-16：「扫描虫洞界面，给虫洞卡片添加更多信息
 * （虫洞内是什么敌人，以什么类型伤害为主）」）。
 *
 * 显示口径：卡片一句话 = **族称 + 主系**（取**族级 = 浅层卡**）；悬停列**浅/中/深三档**的卡名与火力构成。
 * 本用例钉住"五族的文案与构成"，尤其是**档间会变**的两处（D 族深层 6:4 · E 族中层纯高爆）——
 * 它们正是"卡片只报族级、差异写进悬停"这条口径存在的理由。
 */
describe('虫洞 · 卡片敌情（族称 + 主系 + 三档构成）', () => {
  const intelOf = (family: 'A' | 'C' | 'D' | 'E' | 'G') => wormholeFamilyIntel(family, ctx)

  it('五族：族称与主系文案钉死（A/C/G 动能为主 · C/D 能量为主 · E 并重）', () => {
    expect(intelOf('A').ethnic).toBe('海盗')
    expect(intelOf('A').primaryText).toBe('动能为主')
    expect(intelOf('C').ethnic).toBe('异形')
    expect(intelOf('C').primaryText).toBe('能量为主')
    expect(intelOf('D').ethnic).toBe('守墓')
    expect(intelOf('D').primaryText).toBe('能量为主')
    expect(intelOf('E').ethnic).toBe('巨构')
    expect(intelOf('E').primaryText).toBe('高爆 / 动能并重') // 浅层 5:5 ⇒ 不硬说"某系为主"
    expect(intelOf('G').ethnic).toBe('亡军')
    expect(intelOf('G').primaryText).toBe('动能为主')
    // 卡片那行取的是**浅层卡名**（与 `engine.wormholeFamilyName` 同一把尺）
    expect(intelOf('A').firstCardName).toBe('劫掠支队')
  })

  it('三档构成齐备，且**档间差异**写得出来（D 族深层 6:4 · E 族中层纯高爆）', () => {
    for (const f of ['A', 'C', 'D', 'E', 'G'] as const) {
      const it = intelOf(f)
      expect(it.tiers, `${f} 族应有三档`).toHaveLength(3)
      for (const t of it.tiers) {
        expect(t.cardName, `${f}/${t.tier} 卡名不该漏出内部 id`).not.toContain('wh-')
        expect(t.parts.length, `${f}/${t.tier} 构成不该为空`).toBeGreaterThan(0)
        const sum = t.parts.reduce((s, p) => s + p.share, 0)
        expect(sum, `${f}/${t.tier} 构成份额之和应为 1`).toBeCloseTo(1, 6)
      }
    }
    const dDeep = intelOf('D').tiers.find((t) => t.tier === 'deep')!
    expect(dDeep.parts.map((p) => [p.type, Math.round(p.share * 100)])).toEqual([
      ['plasma', 60],
      ['kinetic', 40],
    ])
    const eMid = intelOf('E').tiers.find((t) => t.tier === 'mid')!
    expect(eMid.parts).toHaveLength(1)
    expect(eMid.parts[0]!.type).toBe('explosive') // 纯高爆（唯一单系档）
  })
})
