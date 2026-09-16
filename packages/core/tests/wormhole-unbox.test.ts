/**
 * **虫洞 F4d · 拆解「遗迹安全货柜」**（船长 2026-09-13 定案；**2026-09-14 改判**）。
 *
 * 口径：走**精炼配方口径**（与精炼 / 回收同一条产线机器：主控亲自 或 1 枚 AI 核心）· **90 秒/件** ·
 * 一箱出 **1 件**。
 *
 * ⚠ **2026-09-14 船长新增「图纸货柜」并裁定「与安全货柜并列」**⇒ 本文件的口径随之改：
 * **安全货柜 = 100% 族专属池**，原「族池 0.7 : 稀释池 0.3」里的**稀释池已收回**
 * （一次性图纸改由图纸货柜专出，否则同一批图纸会有两条渠道）。
 * `wormholeLootShares()` / `WORMHOLE_DILUTION_SHARE` **保留但停用**（见 `wormholeSalvage.ts` 的说明）；
 * 图纸货柜的用例在 `wormhole-bp-box.test.ts`。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addWare, countWare } from '../src/inventory'
import { UNBOX_CYCLE_MS, advanceRefining, startUnboxRun } from '../src/industry'
import { wormholeFamilyPoolOf, wormholeMk3PoolOf, wormholeUnboxRoll, WORMHOLE_LUXURY_ITEM_IDS, WORMHOLE_MILITARY_BOX_ID, WORMHOLE_MILITARY_PIECES_MAX, WORMHOLE_MILITARY_PIECES_MIN, WORMHOLE_VALUABLES_BOX_ID, WORMHOLE_VALUABLES_UNITS_MAX, WORMHOLE_VALUABLES_UNITS_MIN } from '../src/wormholeSalvage'

const ctx = buildSimContext()

describe('虫洞 F4d · 安全货柜拆解（90 秒/件 · 100% 族专属池）', () => {
  it('开工 → 一件 90 秒：每件消耗 1 箱、抽出的东西进账、拆完自动停', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    addWare(state, 'box-relic-a', 2)
    const started = startUnboxRun(state, ctx, 'box-relic-a', 'pilot')
    expect(started.ok, started.error).toBe(true)
    expect(state.refineRuns).toHaveLength(1)
    expect(state.refineRuns[0]!.recipe).toBe('unbox')
    /** 抽到的东西落在哪三个面：装备库 / 图纸库存 / 物品仓库（任一变化即说明这一箱真开出了东西） */
    const lootSig = (): string => JSON.stringify([state.moduleBay, state.blueprintStock, state.warehouse.items])
    const before = lootSig()
    // 一件到点：消耗 1 箱、**开出 1 件**、炉子继续转（还有 1 箱）
    state.gameMs += UNBOX_CYCLE_MS
    advanceRefining(state, ctx)
    expect(countWare(state, 'box-relic-a')).toBe(1)
    expect(lootSig(), '这一箱应真的开出东西（装备 / 图纸 / 物品）').not.toBe(before)
    expect(state.refineRuns).toHaveLength(1)
    // 第二件到点：料尽**当场**停炉（2026-09-15 船长报障：修前会空转一个批周期，像"又拆了一次"）
    state.gameMs += UNBOX_CYCLE_MS
    advanceRefining(state, ctx)
    expect(countWare(state, 'box-relic-a')).toBe(0)
    expect(state.refineRuns, '拆完最后一件就该收工，不再空转一个 90 秒周期').toHaveLength(0)
    expect(state.logs.some((l) => l.text.includes('货柜拆解停'))).toBe(true)
    expect(state.logs.some((l) => l.text.includes('货柜已拆完（共 2 件）'))).toBe(true)
    // 再推两拍：不会有第三次"拆解"（箱子已经是 0）
    state.gameMs += UNBOX_CYCLE_MS * 2
    advanceRefining(state, ctx)
    expect(state.refineRuns).toHaveLength(0)
    const unboxLogs = state.logs.filter((l) => l.text.includes('📦 拆解'))
    expect(unboxLogs, '两只箱子只该开两次').toHaveLength(2)
  })

  it('安全货柜 = **100% 族专属池**（稀释池已收回；抽到的每一件都必须落在该族池里）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const pool = wormholeFamilyPoolOf(ctx, 'A')
    const inPool = new Set<string>([...pool.modules, ...pool.moduleBlueprints, ...pool.shipBlueprints, ...(pool.drones ?? [])])
    expect(inPool.size).toBeGreaterThan(6)
    const seen = new Set<string>()
    for (let i = 0; i < 400; i++) {
      const r = wormholeUnboxRoll(state, ctx, 'box-relic-a')
      expect(r, `第 ${i} 抽应能抽到东西`).not.toBeNull()
      // 2026-09-14：来源只可能是族池 —— 稀释池那条分支已收回
      expect(r!.source, `第 ${i} 抽的来源应为族专属池`).toBe('family')
      expect(inPool.has(r!.itemId), `第 ${i} 抽到 ${r!.itemId}，不在 A 族池里`).toBe(true)
      seen.add(r!.itemId)
    }
    expect(seen.size, 'A 族池不止一件，应能抽出多种').toBeGreaterThan(3)
  })

  it('不是货柜 ⇒ 拒绝（拆解台只拆虫洞带回来的货柜）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    addWare(state, 'ore-veldspar', 100)
    const r = startUnboxRun(state, ctx, 'ore-veldspar', 'pilot')
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('货柜')
  })
})

/**
 * **贵重品货柜 / 军用备货柜的拆解**（船长 2026-09-15 定「虫洞战利品与经济扩充」②④：
 * 「新增贵重品货柜，2格，精炼炉拆解后获得随机数量的『奢侈品』，奢侈品纯粹用来卖钱，市场正常交易」
 * ＋「新增军用备货柜4格，精炼炉可以从中拆出数件随机MK3装备」＋「军用备货柜含武器，不含专属」）。
 */
describe('虫洞 · 两个新货柜的拆解（2026-09-15 船长定 ②④）', () => {
  it('**贵重品货柜 ⇒ 一叠奢侈品 5~30 件**（十款等权、每款都出得来）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    const seen = new Set<string>()
    for (let i = 0; i < 300; i++) {
      const r = wormholeUnboxRoll(state, ctx, WORMHOLE_VALUABLES_BOX_ID)
      expect(r, `第 ${i} 抽应能抽到东西`).not.toBeNull()
      expect(r!.source).toBe('valuables')
      expect(WORMHOLE_LUXURY_ITEM_IDS).toContain(r!.itemId as (typeof WORMHOLE_LUXURY_ITEM_IDS)[number])
      expect(r!.units).toBeGreaterThanOrEqual(WORMHOLE_VALUABLES_UNITS_MIN)
      expect(r!.units).toBeLessThanOrEqual(WORMHOLE_VALUABLES_UNITS_MAX)
      expect(r!.extra ?? [], '奢侈品是"一叠"，不走 extra').toHaveLength(0)
      seen.add(r!.itemId)
    }
    // ⚠ 2026-09-16：奢侈品由三款扩到**十款**（船长「让奢侈品有10个类型」）⇒ 这里按**常量长度**断言
    // （而不是写死 3/10），以后继续扩表时这条用例自动跟着走，只钉"每款都抽得到、等权"。
    expect(seen.size, '十款奢侈品都应抽得到（等权）').toBe(WORMHOLE_LUXURY_ITEM_IDS.length)
  })

  it('**军用备货柜 ⇒ 1~3 件 MK3 装备**（含武器、不含专属；逐件独立抽）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 6 })
    const pool = wormholeMk3PoolOf(ctx)
    expect(pool.length, 'MK3 池不该是空的').toBeGreaterThan(5)
    // 池的判据：后缀 -3（与内容体检的 isMk3 同一把尺）· 不含洞内族专属 `-wh-` · 不含窝点专属 `mod-lair-`
    for (const id of pool) {
      expect(id.endsWith('-3')).toBe(true)
      expect(id.includes('-wh-'), `专属件进了军用池：${id}`).toBe(false)
      expect(id.startsWith('mod-lair-'), `窝点专属进了军用池：${id}`).toBe(false)
    }
    // **含武器**：三把常备 MK3 武器都在池里（炮 / 激光 / 导弹架）
    for (const w of ['mod-turret-kin-3', 'mod-laser-3', 'mod-missile-3']) expect(pool).toContain(w)
    const inPool = new Set(pool)
    const pieces = new Set<number>()
    const seen = new Set<string>()
    for (let i = 0; i < 400; i++) {
      const r = wormholeUnboxRoll(state, ctx, WORMHOLE_MILITARY_BOX_ID)
      expect(r, `第 ${i} 抽应能抽到东西`).not.toBeNull()
      expect(r!.source).toBe('military')
      const all = [r!.itemId, ...(r!.extra ?? []).map((e) => e.itemId)]
      for (const id of all) expect(inPool.has(id), `${id} 不在 MK3 池里`).toBe(true)
      for (const e of r!.extra ?? []) expect(e.units, '每件 MK3 各入装备库一次').toBe(1)
      pieces.add(all.length)
      for (const id of all) seen.add(id)
    }
    expect([...pieces].sort(), '件数应覆盖 1 / 2 / 3 三档').toEqual([1, 2, 3])
    expect(seen.size, '随机件应抽出多种（不是永远同一件）').toBeGreaterThan(4)
  })

  it('**端到端**：两只箱子各拆一次 ⇒ 奢侈品整叠进仓库、MK3 进装备库（件数一致）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 8 })
    // ① 贵重品货柜：仓库里的奢侈品数量必须落在 5~30，且正好消耗 1 箱
    addWare(state, WORMHOLE_VALUABLES_BOX_ID, 1)
    expect(startUnboxRun(state, ctx, WORMHOLE_VALUABLES_BOX_ID, 'pilot').ok).toBe(true)
    state.gameMs += UNBOX_CYCLE_MS
    advanceRefining(state, ctx)
    expect(countWare(state, WORMHOLE_VALUABLES_BOX_ID)).toBe(0)
    const luxTotal = WORMHOLE_LUXURY_ITEM_IDS.reduce((s, id) => s + countWare(state, id), 0)
    expect(luxTotal, '这一箱该开出 5~30 件奢侈品').toBeGreaterThanOrEqual(WORMHOLE_VALUABLES_UNITS_MIN)
    expect(luxTotal).toBeLessThanOrEqual(WORMHOLE_VALUABLES_UNITS_MAX)
    // ② 军用备货柜：装备库新增 1~3 件，且每件都在 MK3 池里
    addWare(state, WORMHOLE_MILITARY_BOX_ID, 1)
    const bayBefore = { ...state.moduleBay }
    expect(startUnboxRun(state, ctx, WORMHOLE_MILITARY_BOX_ID, 'pilot').ok).toBe(true)
    state.gameMs += UNBOX_CYCLE_MS
    advanceRefining(state, ctx)
    expect(countWare(state, WORMHOLE_MILITARY_BOX_ID)).toBe(0)
    // 装备库是 `Record<件 id, 件数>`：逐件比对"多出来的件数"
    const gained = Object.entries(state.moduleBay).flatMap(([id, n]) =>
      Array.from({ length: Math.max(0, n - (bayBefore[id] ?? 0)) }, () => id),
    )
    expect(gained.length, '这一箱该开出 1~3 件 MK3').toBeGreaterThanOrEqual(WORMHOLE_MILITARY_PIECES_MIN)
    expect(gained.length).toBeLessThanOrEqual(WORMHOLE_MILITARY_PIECES_MAX)
    for (const id of gained) expect(wormholeMk3PoolOf(ctx)).toContain(id)
  })
})
