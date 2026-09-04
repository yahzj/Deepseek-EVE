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
