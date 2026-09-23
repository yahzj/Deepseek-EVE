/**
 * **虫洞「围剿者」（第 7 层起 · 逐回合刷怪）** —— **2026-09-23 船长新机制**。
 *
 * 船长原话：「**WORMHOLE_THREAT_GROWTH回调到1.2，然后推出新机制，7层开始，玩家每行经过一回合，
 * 就在地图随机格子刷出一个敌人，采用类似星云的方式覆盖在原格子之上。敌人不会刷在下一层入口格，
 * 敌人有概率刷到玩家当前格，如果刷到玩家当前格就触发袭击事件。**」
 * ＋ 视觉修定：「**用敌族族徽做图标覆盖该格子**」「**这个敌人会直接覆盖星云的效果**」
 * ＋ 首次入 7 层发一封通讯讲清"敌人开始围剿玩家了"。
 *
 * 十五问答复（逐条落在下列实现里）：
 * ① 每消耗 1 回合刷 1 个（本文件被每个扣回合点调用）· ② 层 ≥ 7 永久生效 ·
 * ③ 挡路（`wormholePathInterceptAt` 认得）· ④ 打掉后进入原内容（只清 `foe`，不动 `place`/`piles`）·
 * ⑤ 未扫描也看得到（`revealOf` 给 `{kind:'foe'}`）· ⑥ 不可扫描清除 ·
 * ⑦ 刷到当前格 ⇒ 先提示后确认（复用 `run.pendingNodeBattle` 那条确认链）·
 * ⑧ 强度 = 该层**普通节点**威胁（`kind: 'spawn'` 在 `wormholeFoeThreat` 里走缺省档）·
 * 卡 = **该层档位池随机一张**（`wormholeCardIdForRun` 的池内加权，序号 = 本层刷怪序号）·
 * ⑨ 打赢给东西（`wormholeGrantShipSpoils` 的 `'spawn'` 形状：1 堆普通残骸 ＋ 货柜掷骰，**不给稀有件**）·
 * ⑩ 每层上限 = 格数 × 50%（`spawnCapOf`）· ⑪ 不刷已有敌人的格（`spawnTargetsOf`）·
 * ⑫ 回合/收益/撤离提示都不动 · ⑬ 随档（格上 `foe` ＋ `grid.spawnSeq`）·
 * ⑭ 族徽覆盖（界面读 `WORMHOLE_FAMILY_GLYPH`）· ⑮ 公告另稿。
 *
 * 随机流：**独立盐值**（`本趟种子 × 131 ＋ 层 × 977 ＋ 序号 × 7919 ＋ 41`）⇒ 不消费 `state.rng`、
 * 不挤占星云/拾取/货柜任何既有掷点；同一趟同一序号必得**同格同卡**（可复现、可测、随档一致）。
 */
import { addLog } from './state'
import type { GameState } from './state'
import {
  WORMHOLE_SPAWN_MIN_DEPTH,
  spawnAliveCount,
  spawnCapOf,
  spawnTargetsOf,
  wormholeStream,
} from './wormholeGrid'
import { wormholeCardIdForRun } from './wormholeFoes'

export interface WormholeSpawnResult {
  /** 本次刷了几个（= 消耗的回合数，被上限/候选格掏空时更少） */
  spawned: number
  /** 是否**刷到了玩家当前格**（⇒ 触发袭击事件，等玩家确认开战） */
  ambush: boolean
  /** 最后一个落点（读数/用例用） */
  lastKey?: string
}

/**
 * **扣完回合后掷围剿者**（每个"扣 1 回合"的动作都要调；一次扣 N 回合 ⇒ 掷 N 次）。
 *
 * 早期返回的三条：不在洞内 / 不在网格层 / 层 < 7 ⇒ **一个字都不写**（层 1~6 与老档线性层零变化）。
 */
export function wormholeSpawnAfterTurns(state: GameState, turns: number): WormholeSpawnResult {
  const none: WormholeSpawnResult = { spawned: 0, ambush: false }
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return none
  if (run.depth < WORMHOLE_SPAWN_MIN_DEPTH) return none
  const n = Math.max(0, Math.floor(turns))
  if (n === 0) return none
  const cap = spawnCapOf(grid)
  const hereKey = grid.cells.find((c) => c.q === grid.pos.q && c.r === grid.pos.r)?.key
  let spawned = 0
  let ambush = false
  let lastKey: string | undefined
  for (let i = 0; i < n; i++) {
    if (spawnAliveCount(grid) >= cap) break
    const targets = spawnTargetsOf(grid)
    if (targets.length === 0) break
    const seq = Math.max(0, Math.floor(grid.spawnSeq ?? 0))
    const rng = wormholeStream((run.seed ?? 1) * 131 + run.depth * 977 + seq * 7919 + 41)
    const cell = targets[Math.min(targets.length - 1, Math.floor(rng() * targets.length))]!
    cell.foe = {
      card: wormholeCardIdForRun({
        family: run.family,
        seed: run.seed,
        depth: run.depth,
        kind: 'spawn',
        nodeIndex: seq * 7 + 3,
      }),
      seq,
    }
    // **顶掉星云**（船长：「这个敌人会直接覆盖星云的效果」）：记进 `dispersed` ⇒ 打掉后直接见原内容
    if (cell.nebula === true && !(grid.dispersed ?? []).includes(cell.key)) {
      grid.dispersed = [...(grid.dispersed ?? []), cell.key]
    }
    grid.spawnSeq = seq + 1
    spawned += 1
    lastKey = cell.key
    if (cell.key === hereKey) ambush = true
  }
  /**
   * **袭击事件**（船长：「如果刷到玩家当前格就触发袭击事件」；十五问 ⑦ = **乙**：先提示、玩家确认后开战）。
   * 复用"踩中埋伏"那条确认链（`run.pendingNodeBattle`）⇒ 标记没清之前别的动作一律被拦
   * （`gridActionBlocked`），界面弹确认条、玩家点「迎战」即调 `wormholeStartBattle`。
   */
  if (ambush) {
    /**
     * **直接攻击**（**2026-09-23 船长公告定稿**：「围剿者正好落在玩家所在格时，**会直接攻击玩家的舰队**」）：
     * 不再置"待迎战"标记、也不弹确认条——交火由引擎每拍自动开（见 `wormholeBattle.advanceWormhole`
     * 里的 `hasLiveFoe(脚下格) ⇒ wormholeStartBattle('spawn')`）。
     */
    addLog(state, 'warn', '🕳 围剿者扑到你所在的位置：交火开始。', 'core.wormholeSpawn.001')
  }
  return { spawned, ambush, ...(lastKey !== undefined ? { lastKey } : {}) }
}
