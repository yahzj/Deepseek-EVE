/**
 * **旗舰黑匣的"最后击杀"判据**（**2026-09-28 船长重申**）。
 *
 * 船长原话（照抄）：「**规则应该很清楚记录了：输出超过50%血量，完成最后击杀，就给黑匣。**」
 * 记录在案的规则 = `weekendBlackBoxChanceOf` 的第一支：**`lastHitByPlayer && p > 0.5 ⇒ chance 1`（必爆）**。
 *
 * 病根（2026-09-28 玩家报障：占比 93.22% ＋ 亲手打爆母舰，却一个黑匣都没有）：
 * `weekendClaimOctopus`（章鱼人把剩下的池子补掉那条路）**写死传 `false`** ⇒ 判成"不是玩家最后击杀"
 * ⇒ 走 `25% × p = 23.3%` 那一档 ⇒ 没中。而"章鱼人补掉池子"与"玩家有没有亲手打爆母舰"**是两件事**：
 * 前者是**另一本账**（章鱼人也在削血），后者有**留档** `flagshipPlayerKill`（母舰在玩家战斗里爆炸那一刻置位）。
 *
 * 本文件钉四件事：① 判据真值表；② 有留档 ⇒ 必爆；③ 没留档 ⇒ 仍走老档（不是必爆）；
 * ④ 幂等与重掷（旧态按错情境掷过 ⇒ 按对情境重掷）；⑤ 源码护栏：不许再在各调用点写死 true/false。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInitialState } from '../src/state'
import {
  weekendBlackBoxChanceOf,
  weekendLastHitByPlayer,
  weekendRollBlackBox,
} from '../src/weekendEvent'

/** 场次记录的类型（`WeekendEventState` 未从 `state` 导出 ⇒ 从函数签名推导，不新开导出面） */
type Ev = Parameters<typeof weekendRollBlackBox>[1]

/** 一条最小的场次记录（只放本文件用得到的字段；其余字段与本批判据无关） */
function evOf(patch: Partial<Ev>): Ev {
  return {
    seq: 1,
    startedAtWallMs: 0,
    coreId: 'galaxy-nadir',
    peripheryIds: [],
    family: 'H',
    contributed: {},
    flagshipHpMax: 150_000,
    flagshipHpDone: 139_829,
    ...patch,
  } as unknown as Ev
}

function rngState(seed = 7) {
  return { rng: createInitialState({ nowWallMs: 0, seed }).rng }
}

describe('旗舰黑匣的最后击杀判据（2026-09-28 船长重申）', () => {
  it('① 判据真值表：留档为准，池子归属只在没有留档时兜底', () => {
    expect(weekendLastHitByPlayer(evOf({})), '什么都没有 ⇒ false').toBe(false)
    expect(
      weekendLastHitByPlayer(evOf({ flagshipPlayerKill: { atWallMs: 1, runId: 1 } as never })),
      '有"玩家亲手打爆"的留档 ⇒ true',
    ).toBe(true)
    expect(weekendLastHitByPlayer(evOf({ flagshipDown: 'player' })), '池子判给玩家 ⇒ true').toBe(true)
    expect(weekendLastHitByPlayer(evOf({ flagshipDown: 'octopus' })), '池子判给章鱼 ⇒ false').toBe(false)
    /** ⚠ **本批的关键一格**：池子判给章鱼，但玩家有亲手打爆的留档 ⇒ 仍然是"玩家最后击杀" */
    expect(
      weekendLastHitByPlayer(
        evOf({ flagshipDown: 'octopus', flagshipPlayerKill: { atWallMs: 1, runId: 1 } as never }),
      ),
      '章鱼补掉池子 ≠ 玩家没打爆母舰',
    ).toBe(true)
  })

  it('② 有留档 ＋ 占比 > 50% ⇒ **必爆**（这就是玩家该拿到的那一枚）', () => {
    const ev = evOf({ flagshipPlayerKill: { atWallMs: 1, runId: 1 } as never })
    const p = (ev.flagshipHpDone ?? 0) / (ev.flagshipHpMax ?? 1)
    expect(p).toBeGreaterThan(0.5)
    expect(weekendBlackBoxChanceOf(ev.flagshipHpDone ?? 0, ev.flagshipHpMax ?? 0, true), '爆率 = 1').toBe(1)
    expect(weekendRollBlackBox(rngState(), ev), '必爆').toBe(true)
    expect(ev.flagshipBlackBox).toBe(true)
    expect(ev.flagshipBlackBoxByPlayer, '记下按哪种情境掷的').toBe(true)
  })

  it('③ 没留档 ⇒ 仍走老档（25% × 占比），不是必爆', () => {
    const ev = evOf({ flagshipHpDone: 0 }) // 占比 0 ⇒ 老档爆率 0
    expect(weekendBlackBoxChanceOf(0, 150_000, false), '老档 = 25% × p').toBe(0)
    expect(weekendRollBlackBox(rngState(), ev), '不爆').toBe(false)
    expect(ev.flagshipBlackBoxByPlayer).toBe(false)
  })

  it('④ 幂等与重掷：按错情境掷过的旧态 ⇒ 按对情境**重掷**（存量档自愈的那一步）', () => {
    const ev = evOf({ flagshipPlayerKill: { atWallMs: 1, runId: 1 } as never })
    // 先模拟"旧代码写死 false 掷过"的存档态
    expect(weekendRollBlackBox(rngState(), ev, false), '旧情境：23% 档').toBe(false)
    expect(ev.flagshipBlackBox).toBe(false)
    // 再按修后的判据掷 ⇒ 情境不同 ⇒ 重掷 ⇒ 必爆
    expect(weekendRollBlackBox(rngState(), ev, weekendLastHitByPlayer(ev)), '新情境：必爆').toBe(true)
    expect(ev.flagshipBlackBox, '改判为 true').toBe(true)
    // 同情境再来一次 ⇒ 幂等，不重掷
    expect(weekendRollBlackBox(rngState(), ev, true), '幂等').toBe(true)
  })

  it('⑤ 源码护栏：调用点不许再各自写死 true / false', () => {
    const rootA = join(process.cwd(), 'src/weekendEvent.ts')
    const rootB = join(process.cwd(), 'packages/core/src/weekendEvent.ts')
    const src = readFileSync(existsSync(rootA) ? rootA : rootB, 'utf8')
    expect(src.includes('weekendRollBlackBox(state, ev, weekendLastHitByPlayer(ev))'), '章鱼那条路取单点').toBe(true)
    expect(
      /weekendRollBlackBox\(state, ev, false\)/.test(src),
      '不许再在章鱼那条路写死 false（2026-09-28 报障的根因）',
    ).toBe(false)
  })
})
