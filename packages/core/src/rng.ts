/**
 * 种子随机数。
 *
 * 为什么不能直接 Math.random()：挂机游戏以后要做离线结算、探索、战斗，
 * 如果每次读档随机序列不一样，就会出现"读档前打不过、读档后打过了"之类的怪事。
 * 种子随机保证：同样的存档 + 同样的经过时间 => 同样的结果，可复现、可测试。
 */

import type { RngState } from './state'

/** 一个简单的可复现随机数生成器（mulberry32 算法） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 把一段文字（比如角色名）打散成一个稳定的 32 位种子。
 */
export function hashSeed(text: string): number {
  let h = (1779033703 ^ text.length) >>> 0
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353) >>> 0
  }
  h = Math.imul(h ^ (h >>> 13), 3864292196) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

/**
 * 从状态里抽一个 [0,1) 随机数，并自动累计使用次数（次数进了存档 => 可复现）。
 */
export function nextRandom(rng: RngState): number {
  rng.count += 1
  return mulberry32((rng.seed + rng.count * 0x9e3779b9) >>> 0)()
}

/**
 * 从状态里抽一个 [0, max) 的整数（max 必须 > 0）。
 */
export function nextInt(rng: RngState, max: number): number {
  return Math.floor(nextRandom(rng) * max)
}

/**
 * **从数组里均匀取一个**（2026-09-12 审计 B2 单点化；空数组 = `undefined`）。
 *
 * ⚠ **与仓内原先手写的 `arr[Math.floor(nextRandom(rng) * arr.length)]` 逐位等价**——
 * 连"空数组"也一致：`nextInt(rng, 0)` = 0 ⇒ `arr[0]` = `undefined`，**且同样消耗一次随机数**
 * （调用点若在空表时跳过调用，rng 序列会与改前不同 ⇒ 故本函数不做空表早退）。
 */
export function pickOne<T>(rng: RngState, items: readonly T[]): T | undefined {
  return items[nextInt(rng, items.length)]
}

/**
 * **按权重取一个**（2026-09-12 审计 B3 单点化）——`total ≤ 0` 或空表 = `undefined`。
 *
 * 口径（**逐位复刻仓内 6 处手写循环**，只保留"边界含不含等号"这一处真实差异）：
 * - 抽**一次** `nextRandom`（**无论 total 是否为 0 都消耗**，与手写版一致）；
 * - 权重先按 `max(0, w)` 夹紧（`mining` 原本即如此；其余站点按构造权重均 ≥ 0 ⇒ 零行为变化）；
 * - **累加**判定：`roll = u × total`，逐项 `acc += w`，命中即返回 —— 与手写版"扣减法"在
 *   **整数权重**下逐位等价（整数加减不改变小数部分）；`market` 与 `salvaging` 本来就是累加写法；
 * - `bound`：`'lt'`（默认，`roll < acc`）用于 `events` / `expedition` / `mining` / `market`；
 *   `'lte'`（`roll <= acc`）用于 `salvage`（原 `roll -= w; roll <= 0`）与 `salvaging`。
 *   ⚠ **两种边界只在"精确命中累计边界"时结果不同**（`r` 是 `k/2³² × total`，命中边界需 `k` 取到唯一值
 *   ⇒ 概率 ≈ 2⁻³²）——保留该选项是**为了逐字复刻各处原有的算术形式**，不是可观测差异
 *   （用例只能证明"可观测范围内一致"，见 `tests/rng-pick.test.ts` 的说明）。
 *
 * 调用方若无中选兜底（如 `salvage` 的 `pool[0]`、`mining` 的 `fallback`），用 `?? 默认值` 接住。
 */
export function pickWeighted<T>(
  rng: RngState,
  items: readonly T[],
  weightOf: (item: T) => number,
  opts?: { bound?: 'lt' | 'lte' },
): T | undefined {
  const roll = nextRandom(rng) // ⚠ 先抽：与手写版一致（total = 0 时也消耗一次）
  let total = 0
  for (const it of items) total += Math.max(0, weightOf(it))
  if (items.length === 0 || total <= 0) return undefined
  const r = roll * total
  const inclusive = opts?.bound === 'lte'
  let acc = 0
  for (const it of items) {
    acc += Math.max(0, weightOf(it))
    if (inclusive ? r <= acc : r < acc) return it
  }
  return undefined
}
