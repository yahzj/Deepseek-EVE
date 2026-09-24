/**
 * **停机不吃料**（**2026-09-24 船长令**：「材料全退」——承接玩家报障那批一次性图纸被吞的善后口径）。
 *
 * 本条覆盖**精炼炉 / 回收炉 / 货柜拆解**三条"炉子"产线的**自动停机**（切活动那条路，
 * `state.haltActivityForSwitch`）：
 * - **现代语义**（v20 起「原料不预锁定，每批到点实时扣取」）⇒ 停机**本来就不吃料**——当前那批还没到点，
 *   它的料仍在货仓/仓库里；代价只有**进度**（与 `HALT_COST` 的原话一致）。本文件把这个性质**钉住**，
 *   免得以后有人把扣料挪到"起炉那一刻"而没人发现；
 * - **老档的炉内预占账**（`RefineRunState.claimedUnits`：早期版本起炉时把库存预占进炉内）⇒
 *   停机必须**退回仓库**：原先只有"再起一台回收炉"时顺带退，若这台直接被停机，那份账会随停掉的线
 *   在存档归一里被丢掉而**凭空消失**。
 *
 * 与制造线那条的区别（`tests/manufacturing.test.ts`：料在**开工那一刻**整批扣走 ⇒ 停机必须整批退）：
 * 炉子是"每批到点扣"，制造是"开工整批扣"——两条路的退料口径不同，本文件把差异写清楚。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import type { GameState } from '../src/state'
import { createInitialState, haltActivityForSwitch } from '../src/state'
import { addWare, countWare } from '../src/inventory'
import { advanceRefining, startRecycleRun, startRefineRun, startUnboxRun } from '../src/industry'
import { gainAiCore } from '../src/ai'

const ctx = buildSimContext()
/** 真内容目录里挑一只可精炼的矿、一只残骸、一只货柜（都取确定 id，别依赖目录顺序） */
const ORE = 'ore-veldspar'
const WRECK = 'wreck-a-hi'
const BOX = 'box-relic-a'

describe('炉子产线 · 自动停机不吃料（2026-09-24 船长令「材料全退」）', () => {
  let state: GameState
  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 4 })
  })

  it('半途切活动停机（精炼）：料一件不吃、只丢当前那批进度；炉子停、主控释放', () => {
    expect(ctx.items.get(ORE)?.refine?.length ?? 0, `${ORE} 应有精炼配方`).toBeGreaterThan(0)
    addWare(state, ORE, 1_000)
    expect(startRefineRun(state, ORE, 'pilot', ctx).ok).toBe(true)
    // 推到"半批"（远不到一批的周期）：此刻料还没被扣
    state.gameMs += 1_000
    advanceRefining(state, ctx)
    expect(countWare(state, ORE), '半批时不该扣料').toBe(1_000)
    haltActivityForSwitch(state, 'refine')
    expect(state.refineRuns.filter((r) => r.active), '主控那台应已停').toHaveLength(0)
    expect(countWare(state, ORE), '停机后料仍是满的（只丢进度）').toBe(1_000)
  })

  it('半途停机（残骸回收 / 货柜拆解）：残骸与货柜都原样留在仓库', () => {
    expect(ctx.items.get(WRECK)?.kind, `${WRECK} 应是残骸`).toBe('wreck')
    addWare(state, WRECK, 400)
    expect(startRecycleRun(state, WRECK, 'pilot', ctx).ok).toBe(true)
    state.gameMs += 1_000
    advanceRefining(state, ctx)
    haltActivityForSwitch(state, 'refine')
    expect(countWare(state, WRECK), '停机不该吃掉残骸').toBe(400)
    const s2 = createInitialState({ nowWallMs: 0, seed: 4 })
    addWare(s2, BOX, 3)
    expect(startUnboxRun(s2, ctx, BOX, 'pilot').ok).toBe(true)
    s2.gameMs += 1_000
    advanceRefining(s2, ctx)
    haltActivityForSwitch(s2, 'refine')
    expect(countWare(s2, BOX), '停机不该吃掉货柜').toBe(3)
  })

  it('老档的炉内预占账（claimedUnits）⇒ 停机退回仓库（不许凭空消失）', () => {
    addWare(state, ORE, 500)
    expect(startRefineRun(state, ORE, 'pilot', ctx).ok).toBe(true)
    // 手工伪造一条"老档遗留的预占账"：起炉时把 120 单位预占进炉内（现代语义不再这么干）
    state.warehouse.items[ORE] = 0
    state.refineRuns[0]!.claimedUnits = 120
    haltActivityForSwitch(state, 'refine')
    expect(countWare(state, ORE), '预占的 120 单位必须退回仓库').toBe(120)
    expect(state.refineRuns[0]!.claimedUnits, '账要清掉（防二次退）').toBe(0)
    expect(state.refineRuns.filter((r) => r.active)).toHaveLength(0)
  })

  it('AI 核心驱动的炉不受停机影响（料同样不动）', () => {
    gainAiCore(state, 'basic', 1)
    state.skills.trained['ai-expert'] = 1
    addWare(state, ORE, 800)
    expect(startRefineRun(state, ORE, 'basic', ctx).ok).toBe(true)
    state.gameMs += 1_000
    advanceRefining(state, ctx)
    haltActivityForSwitch(state, 'refine')
    expect(state.refineRuns.filter((r) => r.active), '核心线照跑').toHaveLength(1)
    expect(countWare(state, ORE)).toBe(800)
  })
})
