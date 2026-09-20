/**
 * **谜质「每趟真实收获」读数**（二号 · 2026-09-20 · 谜质科技批挂账第 1 条）
 *
 * 船长要的读数：满树 **1,196 枚**虫洞谜质，按「每层保底 1 个谜质格」＋「1 台谜质储存器 = 1 枚」
 * 估一趟 3~8 枚 ⇒ 满树约 150~400 趟。本工具用**真引擎**（真盘面 / 真回合 / 真战斗 / 真折算）
 * 把「一趟到底能拿几枚」实测出来，据此议总量与每趟产出。
 *
 * 两块读数：
 * - **盘面普查（census）**：`wormholeMakeGrid(seed, depth)` 逐层真生成 → 数每层几个谜质格。
 *   只依赖种子与层号（确定性），是本读数的**上界**：一个都不漏也就能拿这么多。
 * - **整趟实跑（run）**：真状态机走完一趟（扫/走/激活/开战/深入/撤离），数**真正析出入库**的谜质。
 *
 * 用法：
 * ```
 * npx tsx tools/mt-harvest.ts --census-only --seeds=24          # 只跑盘面普查（确定性 · 秒级）
 * npx tsx tools/mt-harvest.ts --seeds=12 --depth=8             # 整趟实跑（打守卫、能下就下）
 * npx tsx tools/mt-harvest.ts --seeds=12 --depth=N --per-layer  # 逐层递增：打穿到第 N 层就撤
 * npx tsx tools/mt-harvest.ts --seeds=12 --no-boss             # 隔离"收集侧"（不打守卫）
 * npx tsx tools/mt-harvest.ts --seeds=3 --trace                # 逐拍 + 引擎日志尾（诊断怎么死的）
 * ```
 * 开关：`--seeds=N`（默认 24）· `--depth=N`（默认 8）· `--census-only` · `--per-layer` ·
 * `--no-boss` · `--charge-ships`（不回避舰船信号）· `--trace`。
 *
 * ⚠ 与 `wormhole-econ.ts` 的两处口径差异（本工具专为谜质而写）：
 *  1. 政策**会去探索并取回谜质格**（econ 的 `pickTarget` 里根本没有 `'matter'` ⇒ 它一份都拿不到）；
 *  2. 政策**会处理临时空间**（船长 2026-09-14：「临时空间内有物品就不允许进行其他操作」——
 *     econ 不处理 ⇒ 撞上就整趟卡死记作"未结束"，这也是它那条挂账缺口的根源）。
 *  两处都是**照玩家的正常操作**补的，不是放宽规则。
 *
 * 口径：**科技树零投资**（`research.levels` 空 = 未点任何科技）——本读数要回答的正是
 * 「攒够 1,196 枚要几趟」，起点就该是没科技的状态。科技只抬收益，垫高后的读数另跑。
 *
 * 读数结论（2026-09-20 · **经一次重大更正**）见 `docs/glossary.md` **§十一「谜质科技树」**：
 * - 八层全扫上界 **23.8 枚/趟**（层 1/2 恰好 1 个谜质格、层 3 恰好 2 个 ⇒ 保底是承重墙）；
 * - 折算**只在撤离成功时**发生（全损 = 谜质全丢），`1 台 = 1 枚`；
 * - **真正约束是回合预算**：42 回合只够扫 2~3 层（实测平均到达 2.78 层）⇒
 *   **每趟安全带出 2.67 枚**（最大 4），满树 1,196 枚 ≈ **450 趟**；
 * - ⚠ **初版结论"层 1 守卫是硬闸门、只有 1/3 存活"已作废**——那是编队技能 id 写错（零有效技能）造成的假象；
 *   真档编队打层 1 守卫 **12/12 全存活**。详见 §10.3 的 A/B。
 */
import { addShipToFleet, createInitialState } from '@whale/core'
import type { GameState, SimContext } from '@whale/core'
import { buildSimContext } from '@whale/data'
import {
  WORMHOLE_ESSENCE_ITEM_ID,
  wormholeEnter,
  wormholeExtract,
  wormholeGridScan,
  wormholeMakeGrid,
  wormholeNodesPerLayer,
  wormholeScanBonusOf,
  wormholeDescend,
} from '@whale/core'
import { advanceWormhole, wormholeActivateAt, wormholeStartBattle, wormholeTravelTo } from '../packages/core/src/wormholeBattle'
import { gridCellAt, gridScanTargets, hexDistance, isExitCell } from '../packages/core/src/wormholeGrid'
import type { WormholeGridState } from '../packages/core/src/wormholeGrid'
import {
  wormholeSalvagersOf,
  wormholeMinersOf,
  wormholeTempBlockReason,
  wormholeTempDiscardAll,
  wormholeTempStowAll,
} from '../packages/core/src/wormholeSalvage'

const ctx: SimContext = buildSimContext()

/* ═══════════════ 参考编队 ═══════════════ */

/**
 * ⚠⚠ **2026-09-20 重大修正（船长质疑"是不是你配置舰船的问题" — 属实）**：
 *
 * 原来这套 `SKILLS` 是照抄 `wormhole-econ.ts` 的，其中 **6 个里有 5 个在游戏里根本不存在**：
 * `missile-ops` / `shield-ops` / `armor-ops` / `evasive-maneuvers` / `targeting` 全是**假 id**
 * （真名是 `missile-launching` / `shield-operation` / `armored-ops` /
 * `evasion-maneuvering` / `targeting-integration`）；只有 `gunnery` 是真的。
 * ⇒ 那个"参考编队"其实是**零有效技能裸奔**，于是"打层 1 守卫只有约 1/3 存活"的读数是
 * **编队没配好**造成的假象，不是游戏难度。
 *
 * 现在两套都给，**默认用真档口径**（`--fit=ref` 可切回旧口径做 A/B）：
 * - `real`（默认）：**真档同款**——技能表照抄 `test-save-mt-lab`（船长实际在玩的档），
 *   装配也照抄真档（2×长尾鲨"搜打撤满配"低槽为空 ＋ 2×玳瑁"重装"3×MK3＋双甲）。
 * - `ref`：旧的 4×长尾鲨 `full` 档（**技能假名已修**为真名，供对照）。
 */
const FIT_ARG = (process.argv.find((a) => a.startsWith('--fit=')) ?? '--fit=real').split('=')[1]
type FitMode = 'real' | 'ref'
const FIT: FitMode = FIT_ARG === 'ref' ? 'ref' : 'real'

/** 参考编队（4×长尾鲨） */
const REF_SHIP = 'sh-thresher'
const REF_FIT_FULL = {
  high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-salvager-3', 'mod-miner-3'],
  mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-shield-kin-2'],
  low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
}

/**
 * **真档编队**（`test-save-mt-lab-20260919-201207` 原样）：
 * `sh-thresher#9` / `sh-thresher#10`（搜打撤满配，**低槽空**）＋ `sh-hawksbill` / `sh-hawksbill#2`（重装）。
 */
const REAL_FLEET: ReadonlyArray<{ id: string; fitted: { high: string[]; mid: string[]; low: string[] } }> = [
  {
    id: 'sh-thresher',
    fitted: {
      high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-miner-3', 'mod-salvager-3'],
      mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-shield-kin-2'],
      low: [],
    },
  },
  {
    id: 'sh-thresher',
    fitted: {
      high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-miner-3', 'mod-salvager-3'],
      mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-shield-kin-2'],
      low: [],
    },
  },
  {
    id: 'sh-hawksbill',
    fitted: {
      high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'],
      mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-shield-kin-2'],
      low: ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2'],
    },
  },
  {
    id: 'sh-hawksbill',
    fitted: {
      high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'],
      mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-shield-kin-2'],
      low: ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2'],
    },
  },
]

/**
 * **真档技能表**（照抄 `test-save-mt-lab` 的 `skills.trained`，只留与洞内战斗/作业相关的项）。
 * 全部为**游戏里真实存在的 id**（对照 `packages/data/src/skills.ts`）。
 */
const REAL_SKILLS: Record<string, number> = {
  gunnery: 5,
  'kinetic-gunnery': 5,
  'missile-launching': 5,
  'armed-ops': 4,
  'fire-control': 4,
  'targeting-integration': 5,
  'evasion-maneuvering': 5,
  'vector-maneuvering': 5,
  'shield-operation': 5,
  'shield-tuning': 5,
  'armored-ops': 1,
  'armor-tuning': 4,
  'hull-upgrades': 4,
  'energy-management': 5,
  'reload-drills': 4,
  'ship-systems-engineering': 5,
  'spaceship-command': 5,
  navigation: 5,
  'acceleration-control': 5,
  'warp-drive-operation': 5,
}

/** `ref` 档用的技能（**已修假名**；原来是 6 个里 5 个无效 ⇒ 等于零技能） */
const REF_SKILLS: Record<string, number> = {
  gunnery: 3,
  'missile-launching': 3,
  'shield-operation': 3,
  'armored-ops': 3,
  'evasion-maneuvering': 3,
  'targeting-integration': 3,
}

function makeFleet(seed: number): { state: GameState; uids: string[] } {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 20_000_000
  const skills = FIT === 'real' ? REAL_SKILLS : REF_SKILLS
  for (const [id, lv] of Object.entries(skills)) state.skills.trained[id] = lv
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[key] = 5_000
  const uids: string[] = []
  const specs =
    FIT === 'real'
      ? REAL_FLEET
      : Array.from({ length: 4 }, () => ({ id: REF_SHIP, fitted: REF_FIT_FULL }))
  for (const spec of specs) {
    const uid = addShipToFleet(state, spec.id)
    state.fleet[uid]!.fitted = {
      high: [...spec.fitted.high],
      mid: [...spec.fitted.mid],
      low: [...spec.fitted.low],
    }
    uids.push(uid)
  }
  state.shipId = uids[0]!
  return { state, uids }
}

/* ═══════════════ 一、盘面普查（确定性 · 每层几个谜质格） ═══════════════ */

interface CensusRow {
  depth: number
  cells: number
  matter: number
}

function census(seeds: readonly number[], maxDepth: number): CensusRow[] {
  const rows: CensusRow[] = []
  const n = seeds.length
  for (let depth = 1; depth <= maxDepth; depth++) {
    let cells = 0
    let matter = 0
    for (const seed of seeds) {
      const g = wormholeMakeGrid(seed, depth, 0)
      cells += g.cells.length
      matter += g.cells.filter((c) => c.place === 'matter').length
    }
    rows.push({ depth, cells: cells / n, matter: matter / n })
  }
  return rows
}

/* ═══════════════ 二、整趟实跑 ═══════════════ */

type Policy = 'matter-first' | 'depth-first'

interface RunResult {
  seed: number
  result: 'extract' | 'lost' | 'unfinished'
  depth: number
  turnsTotal: number
  turnsLeft: number
  /** 逐层取回的谜质台数（下标 = 层号 - 1） */
  layerDevices: number[]
  /** 逐层盘面上的谜质格数（读数用：取回 / 盘面 = 覆盖率） */
  layerMatterCells: number[]
  devicesTotal: number
  essencesTotal: number
  /** 真折算进仓库的枚数（与 `devicesTotal` 对账用） */
  essencesWare: number
  /** 结束时走到第几层（全损也记：用来报"参考编队死在哪一层"） */
  endedAtDepth: number
  stopReason: string
}

/** 仓库里的虫洞谜质枚数 */
function essenceInWare(state: GameState): number {
  return state.warehouse.items[WORMHOLE_ESSENCE_ITEM_ID] ?? 0
}

/**
 * **临时空间处置**（照玩家的两个按钮：放回货仓 / 丢弃）。
 * 临时空间里有东西时**一切动作都被拦**（`wormholeActionBlockReason`）⇒ 政策必须先清它，
 * 否则整趟死在那里（econ 的挂账缺口就是这么来的）。
 *
 * 顺序照玩家的直觉：**先尽量放回货仓**（谜质装置要留在仓里才能折算），**放不下的才丢**。
 * 两个动作都走引擎自己的入口（`wormholeTempStowAll` / `wormholeTempDiscardAll`），不手改账本。
 */
function clearTempSpace(state: GameState, ctx: SimContext): boolean {
  if (!wormholeTempBlockReason(state, ctx)) return false
  wormholeTempStowAll(state, ctx)
  if (wormholeTempBlockReason(state, ctx)) wormholeTempDiscardAll(state, ctx)
  return true
}

/**
 * **一趟实跑**（真状态机 + 真战斗 + 真折算）。
 *
 * 政策要照"玩家能做的操作"来：先清临时空间 → 有活就做完 → 挑目标（扫过的优先）→ 走到 → 激活。
 * - `matter-first`：**每层把谜质格取干净**再往下走（要拿满就得吃回合税）。
 * - `depth-first`：**优先往下钻**（谜质格顺路才取）——深层的谜质格更多，但来回深度也要回合。
 */
function simulateRun(seed: number, pol: Policy, maxDepth: number): RunResult {
  const { state, uids } = makeFleet(seed)
  const essBefore = essenceInWare(state)
  const enter = wormholeEnter(state, ctx, uids, seed)
  if (!enter.ok) throw new Error(`入洞失败：${enter.error ?? ''}`)
  const run0 = state.wormhole.run!
  const turnsTotal = run0.turnsTotal

  const layerDevices: number[] = []
  const layerMatterCells: number[] = []
  const bumpDevice = (d: number): void => {
    while (layerDevices.length < d) {
      layerDevices.push(0)
      layerMatterCells.push(0)
    }
    layerDevices[d - 1] += 1
  }
  const setMatterCells = (d: number, n: number): void => {
    while (layerMatterCells.length < d) {
      layerDevices.push(0)
      layerMatterCells.push(0)
    }
    layerMatterCells[d - 1] = n
  }

  let devicesTotal = 0
  let stopReason = ''
  let guard = 0
  let countedLayer = 0
  let lastDepth = 0

  while (state.wormhole.run && guard++ < 20000) {
    state.gameMs += 1_000 // 与引擎心跳同款：推时间，战斗才走得动
    const r = state.wormhole.run
    lastDepth = r.depth
    if (TRACE && !r.battle && r.phase !== 'extracting' && r.grid) {
      const hereCell = gridCellAt(r.grid, r.grid.pos)
      console.log(
        `  · 层${r.depth} (${r.grid.pos.q},${r.grid.pos.r}) ${hereCell?.place ?? '?'} 回合${r.turnsLeft} ` +
          `扫${r.grid.scanned.length}/${r.grid.cells.length} 到访${r.grid.visited.length} 守卫${(r.bossCleared ?? 0) >= r.depth ? '清' : '在'} ` +
          `出口${r.grid.exitKnown === true ? '已标' : '未标'} 台数${devicesTotal}`,
      )
    }
    // 逐层统计盘面上的谜质格（进层时数一次）
    if (r.grid && r.depth !== countedLayer) {
      countedLayer = r.depth
      setMatterCells(r.depth, r.grid.cells.filter((c) => c.place === 'matter').length)
    }
    if (r.battle) {
      advanceWormhole(state, ctx)
      continue
    }
    if (r.phase === 'extracting') {
      advanceWormhole(state, ctx)
      continue
    }
    if (!r.grid) {
      stopReason = '没有盘面'
      break
    }
    // ⓪ 回合走不动 ⇒ 撤离（**只能点一次**：`wormholeExtract` 只把 phase 置为 extracting，
    //   真正的入港由下一拍 `advanceWormhole` 结算 ⇒ 这里设了相位就交回主循环，别再重复调用）
    if (r.turnsLeft <= 0) {
      const ex = wormholeExtract(r)
      if (!ex.ok) {
        stopReason = `回合耗尽且撤离被拒：${ex.error ?? ''}`
        break
      }
      continue
    }
    // ⓪a 临时空间（船长 2026-09-14：有东西就不许别的操作）
    if (clearTempSpace(state, ctx)) continue
    // ⓪b 遗迹收尾战「先确认再跳转」
    if (r.pendingRuinsBattle === true) {
      if (!wormholeStartBattle(state, ctx, 'ruins', state.gameMs).ok) {
        stopReason = '遗迹收尾战开战失败'
        break
      }
      continue
    }

    const g = r.grid
    const here = gridCellAt(g, g.pos)
    if (!here) {
      stopReason = '当前位置不在网格里'
      break
    }
    const guardCleared = (r.bossCleared ?? 0) >= r.depth
    // ⓪c-2 `--per-layer`：**刚打穿本层守卫 ⇒ 就地撤离**（拿"打穿到第 N 层能带回几枚"的读数）
    if (PER_LAYER && guardCleared) {
      const ex = wormholeExtract(r)
      if (!ex.ok) {
        stopReason = `打完守卫撤离被拒：${ex.error ?? ''}`
        break
      }
      continue
    }
    // ⓪c **站在层末入口上、守卫还没清 ⇒ 激活它开战**（清掉才下得去；这是"深入"的前置）
    //    `--no-boss`：保守打法不碰守卫 ⇒ 这格直接跳过（交给"没目标就撤"那条路）
    if (!NO_BOSS && !guardCleared && isExitCell(g, { q: g.pos.q, r: g.pos.r })) {
      const act = wormholeActivateAt(state, ctx, state.gameMs)
      if (!act.ok) {
        stopReason = `激活层末入口被拒：${act.error ?? ''}`
        break
      }
      continue
    }
    if (here.place === 'matter' && !g.activated.includes(here.key)) {
      const act = wormholeActivateAt(state, ctx, state.gameMs)
      if (act.ok && act.taken) {
        devicesTotal += act.taken
        bumpDevice(r.depth)
      } else if (!act.ok) {
        stopReason = `取谜质被拒：${act.error ?? ''}`
        break
      }
      continue
    }

    // ① 扫描：**只在真有可扫目标时**才扫（引擎在没有可扫目标时回 '周围都扫过了'）
    if (gridScanTargets(g, wormholeScanBonusOf(ctx, r.fleet)).length > 0) {
      const sc = wormholeGridScan(state)
      if (!sc.ok) {
        stopReason = `扫描被拒：${sc.error ?? ''}`
        break
      }
      continue
    }

    // ② **守卫已清且我就站在层末入口上 ⇒ 优先深入**（别再去别的已知格转悠了）
    if (guardCleared && r.depth < maxDepth && isExitCell(g, { q: g.pos.q, r: g.pos.r })) {
      const dn = wormholeDescend(state, state.rng.seed, wormholeScanBonusOf(ctx, r.fleet))
      if (!dn.ok) {
        stopReason = `深入被拒：${dn.error ?? ''}`
        break
      }
      continue
    }
    // ③ 挑目标（守卫未清 ⇒ 需要去层末入口开战）
    const target = pickTarget(g, pol, guardCleared, r.turnsLeft)
    if (!target) {
      // 没有目标了：能下就下，否则撤
      if (r.depth < maxDepth && canDescend(state, ctx, r.depth)) {
        const dn = wormholeDescend(state, state.rng.seed, wormholeScanBonusOf(ctx, r.fleet))
        if (!dn.ok) {
          stopReason = `深入被拒：${dn.error ?? ''}`
          break
        }
        continue
      }
      const ex = wormholeExtract(r)
      if (!ex.ok) {
        stopReason = `撤离被拒：${ex.error ?? ''}`
        break
      }
      continue
    }

    // ③ 走过去（一格一格走，路上可能被拦开战）
    const moved = wormholeTravelTo(state, ctx, target, {
      confirmUnknown: true,
      confirmIntercept: true,
    })
    if (!moved.ok) {
      stopReason = `移动被拒：${moved.error ?? ''}`
      break
    }
    continue
  }

  if (guard >= 20000) stopReason = stopReason || '步数上限'
  const run = state.wormhole.run
  if (TRACE) {
    const settle = state.wormhole.lastSettle as { kind?: string; essences?: number } | null | undefined
    console.log(
      `  [收尾] guard=${guard} stopReason=${stopReason || '（空）'} ` +
        `run=${run ? `${run.phase} 层${run.depth} 回合${run.turnsLeft} 编队${run.fleet.length}` : 'null'} ` +
        `lastSettle=${settle ? `${settle.kind} 谜质${settle.essences ?? 0}` : '无'} 仓库谜质=${essenceInWare(state)}`,
    )
    const tail = state.logs.slice(-6).map((l) => `      ${l.kind}: ${l.text}`)
    console.log('    [引擎日志尾]\n' + tail.join('\n'))
  }
  /** `run === null` ⇒ 本趟已收口：看结算单判"撤离成功 / 全损" */
  const settled = run === null
  const lost = settled && (state.wormhole.lastSettle as { kind?: string } | null | undefined)?.kind === 'lost'
  return {
    seed,
    result: !settled ? 'unfinished' : lost ? 'lost' : 'extract',
    depth: run?.depth ?? countedLayer,
    turnsTotal,
    turnsLeft: run?.turnsLeft ?? 0,
    layerDevices,
    layerMatterCells,
    devicesTotal,
    essencesTotal: devicesTotal,
    essencesWare: essenceInWare(state) - essBefore,
    endedAtDepth: lastDepth,
    stopReason,
  }
}

/** 层末守卫清没清（没清就不能深入） */
function canDescend(state: GameState, ctx: SimContext, depth: number): boolean {
  const run = state.wormhole.run
  if (!run) return false
  return (run.bossCleared ?? 0) >= depth
}

/** 挑下一个目标（已知的优先；已知的都去过了就往**最近的未扫描格**去探图） */
function pickTarget(
  g: WormholeGridState,
  pol: Policy,
  guardCleared: boolean,
  turnsLeft: number,
): { q: number; r: number } | null {
  const scanned = new Set(g.scanned)
  const visited = new Set(g.visited)
  /**
   * ⚠ **回避舰船信号**（`ship`）：它是"点上去就开打"的恶战，且**与拿谜质无关**。
   * 政策照正常玩家的取舍：**不主动去撞**（踩上去大概率全损 ⇒ 连已拿到的谜质一起丢）。
   * 这条不是放宽规则——它只是"不自杀"；`--charge-ships` 可关掉它看硬打的代价。
   */
  const AVOID = CHARGE_SHIPS ? [] : ['ship']
  const known = g.cells.filter(
    (c) => scanned.has(c.key) && !visited.has(c.key) && !AVOID.includes(c.place as string),
  )
  const near = (c: { q: number; r: number }): number => hexDistance({ q: c.q, r: c.r }, g.pos)
  const byNear = (a: { q: number; r: number; key: string }, b: { q: number; r: number; key: string }): number =>
    near(a) - near(b) || a.key.localeCompare(b.key)

  // ① 已知格：先取谜质；其次（守卫未清时）**去层末入口打守卫**——不打就下不去
  if (known.length > 0) {
    const matters = known.filter((c) => c.place === 'matter').sort(byNear)
    if (matters.length > 0) return { q: matters[0]!.q, r: matters[0]!.r }
    if (!guardCleared && g.exitKnown === true) {
      const beacon = known.filter((c) => c.place === 'beacon').sort(byNear)
      if (beacon.length > 0) return { q: beacon[0]!.q, r: beacon[0]!.r }
    }
  }
  // ② 没活可做：先探最近的未扫描格（探图才知道谜质在哪）
  const unknown = g.cells.filter((c) => !scanned.has(c.key)).sort(byNear)
  if (unknown.length > 0) {
    const t = unknown[0]!
    // 回合不够就不去了（留 2 回合撤离）
    if (turnsLeft <= near(t) + 2) return null
    return { q: t.q, r: t.r }
  }
  // ③ 全图已知：还有没去过的就去（顺路收尾）
  if (known.length > 0) {
    const t = known.sort(byNear)[0]!
    if (turnsLeft <= near(t) + 2) return null
    return { q: t.q, r: t.r }
  }
  // ④ 兜底：**守卫未清就把"层末入口"当目标**（`wormholeDescend` 要求站在入口上）；
  //    出口格可能已被扫过但没到访 ⇒ 上面几档漏掉它时这里补上。`--no-boss` 时不去。
  if (!guardCleared && !NO_BOSS) {
    const ex = g.exit
    if (g.pos.q !== ex.q || g.pos.r !== ex.r) return { q: ex.q, r: ex.r }
  }
  void pol
  return null
}

/* ═══════════════ 三、报数 ═══════════════ */

const SEED_N = Math.max(1, Number((process.argv.find((a) => a.startsWith('--seeds=')) ?? '--seeds=24').split('=')[1]))
const MAX_DEPTH = Math.max(1, Number((process.argv.find((a) => a.startsWith('--depth=')) ?? '--depth=8').split('=')[1]))
const CENSUS_ONLY = process.argv.includes('--census-only')
const SEEDS = Array.from({ length: SEED_N }, (_, i) => 1 + i * 6)

/** `--trace`：逐拍打印走到哪一步（诊断"这趟到底怎么死的"） */
const TRACE = process.argv.includes('--trace')
/**
 * `--no-boss`：**不打层末守卫**（保守打法）——取完本层谜质就撤。
 *
 * 为什么要这个开关：守卫战是**高风险闸门**（实测参考编队往往在层 1 就被打没 ⇒ 全损、谜质一枚拿不到），
 * 于是"每趟收获"会被战斗方差主导。本开关把**收集侧**隔离出来量：一趟能把几枚**安全带回来**。
 * 两个口径都报，船长才能看清"总量 1,196 枚"到底该按哪条线配平。
 */
const NO_BOSS = process.argv.includes('--no-boss')
/**
 * `--per-layer`（**逐层递增读数**）：照打层末守卫，但**打完就地撤离**（不再往深走）。
 *
 * 为什么需要它：**守卫是硬闸门**——不打赢就下不去（`--no-boss` 因此把每一档都钉在层 1，实测过）。
 * 本模式隔离出"**打穿到第 N 层并安全带回**"的收益与存活率 ⇒ 船长问的「一趟几枚」就有了
 * 按深度分档的实测曲线。
 */
const PER_LAYER = process.argv.includes('--per-layer')
/**
 * `--per-layer`（**逐层递增读数**）：照打层末守卫，但**打完就地撤离**（不再往深走）。
 *
 * 为什么需要它：**守卫是硬闸门**——不打赢就下不去（`--no-boss` 因此把每一档都钉在层 1）。
 * 本模式隔离出"**能打穿到第 N 层并安全带回**"的收益与存活率 ⇒ 老船长问的
 * 「一趟几枚」就有了按深度分档的实测曲线（总价 1,196 枚该配多少趟一目了然）。
 */
/** `--charge-ships`：把"回避舰船信号"关掉（量"硬撞恶战"的代价用；默认回避） */
const CHARGE_SHIPS = process.argv.includes('--charge-ships')

function pad(s: string | number, n: number): string {
  return String(s).padStart(n)
}

console.log(
  `【谜质「每趟真实收获」读数】编队 = ${FIT === 'real' ? '真档同款（2×长尾鲨搜打撤 ＋ 2×玳瑁重装 · 真档技能）' : '旧参考档 4×长尾鲨（技能假名已修）'} · 科技零投资 · 种子 ${SEED_N} 个 · 层 ${MAX_DEPTH}`,
)

/* 一、盘面普查 */
const rows = census(SEEDS, MAX_DEPTH)
console.log('\n── 一、盘面普查（每层谜质格数 · 真生成） ──')
console.log('层  盘面格  谜质格(均)  谜质格(合计)')
let censusTotal = 0
for (const r of rows) {
  censusTotal += r.matter
  console.log(`${pad(r.depth, 2)}  ${pad(r.cells.toFixed(1), 6)}  ${pad(r.matter.toFixed(2), 9)}  ${pad(r.matter * SEED_N, 10)}`)
}
// 单层分布（下限是否真被触发）
const perLayer = new Map<number, number[]>()
for (let depth = 1; depth <= MAX_DEPTH; depth++) {
  perLayer.set(
    depth,
    SEEDS.map((seed) => wormholeMakeGrid(seed, depth, 0).cells.filter((c) => c.place === 'matter').length),
  )
}
console.log('\n层  最小  最大  分布（0 个的种子数 / 1 个 / 2 个 / 3+ 个）')
for (let depth = 1; depth <= MAX_DEPTH; depth++) {
  const v = perLayer.get(depth)!
  const z = v.filter((x) => x === 0).length
  const o = v.filter((x) => x === 1).length
  const t = v.filter((x) => x === 2).length
  const m = v.filter((x) => x >= 3).length
  console.log(
    `${pad(depth, 2)}  ${pad(Math.min(...v), 4)}  ${pad(Math.max(...v), 4)}   ${z} / ${o} / ${t} / ${m}`,
  )
}
console.log(`\n逐层合计（均值）：8 层一趟若**一个不漏**＝ ${censusTotal.toFixed(2)} 枚`)

if (CENSUS_ONLY) process.exit(0)

/* 二、整趟实跑 */
console.log('\n── 二、整趟实跑（真状态机 · 真战斗 · 真折算） ──')
for (const pol of ['matter-first', 'depth-first'] as const) {
  const outs: RunResult[] = []
  let crashed = 0
  for (const seed of SEEDS) {
    try {
      outs.push(simulateRun(seed, pol, MAX_DEPTH))
    } catch (e) {
      crashed += 1
      console.log(`  ⚠ seed ${seed} 抛错：${(e as Error).message}`)
    }
  }
  const done = outs.filter((o) => o.result === 'extract')
  const unfinished = outs.filter((o) => o.result === 'unfinished')
  const avg = (f: (o: RunResult) => number): number =>
    outs.length === 0 ? 0 : outs.reduce((s, o) => s + f(o), 0) / outs.length
  const avgDone = (f: (o: RunResult) => number): number =>
    done.length === 0 ? 0 : done.reduce((s, o) => s + f(o), 0) / done.length
  console.log(`\n【政策 ${pol}】趟数 ${outs.length} · 撤离成功 ${done.length} · 全损 ${outs.filter((o) => o.result === 'lost').length} · 未结束 ${unfinished.length}${crashed ? ` · 抛错 ${crashed}` : ''}`)
  console.log(`  析出谜质（含全损趟）：均 ${avg((o) => o.essencesTotal).toFixed(2)} 枚/趟`)
  console.log(`  析出谜质（仅成功趟）：均 ${avgDone((o) => o.essencesTotal).toFixed(2)} 枚/趟 · 最大 ${Math.max(0, ...done.map((o) => o.essencesTotal))}`)
  console.log(`  入仓对账（仅成功趟）：均 ${avgDone((o) => o.essencesWare).toFixed(2)} 枚（应与上一行相等）`)
  console.log(`  到达层数（仅成功趟）：均 ${avgDone((o) => o.depth).toFixed(2)}`)
  console.log(`  回合预算 ${outs[0]?.turnsTotal ?? 0} · 撤离时剩余 均 ${avgDone((o) => o.turnsLeft).toFixed(1)}`)
  // 全损趟死在哪一层（守卫战的"死亡率"读数）
  const lostRuns = outs.filter((o) => o.result === 'lost')
  if (lostRuns.length > 0) {
    const byDepth = new Map<number, number>()
    for (const o of lostRuns) byDepth.set(o.endedAtDepth, (byDepth.get(o.endedAtDepth) ?? 0) + 1)
    const detail = [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `层${d}: ${n}`).join(' · ')
    console.log(`  全损 ${lostRuns.length} 趟死在哪层：${detail}`)
  }
  // 逐层：盘面 vs 取回
  console.log('  逐层（均值）：层  盘面谜质格  取回台数  覆盖率')
  for (let d = 1; d <= MAX_DEPTH; d++) {
    const cells = outs.reduce((s, o) => s + (o.layerMatterCells[d - 1] ?? 0), 0) / outs.length
    const got = outs.reduce((s, o) => s + (o.layerDevices[d - 1] ?? 0), 0) / outs.length
    const cover = cells > 0 ? `${((got / cells) * 100).toFixed(0)}%` : '—'
    console.log(`            ${pad(d, 2)}  ${pad(cells.toFixed(2), 10)}  ${pad(got.toFixed(2), 8)}  ${pad(cover, 6)}`)
  }
  const reasons = new Map<string, number>()
  for (const o of unfinished) reasons.set(o.stopReason, (reasons.get(o.stopReason) ?? 0) + 1)
  if (reasons.size > 0) {
    console.log('  未结束原因：')
    for (const [why, n] of reasons) console.log(`    ${n}× ${why}`)
  }
}
