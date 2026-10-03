/**
 * **入侵残骸场"比占领活得久"⇒ 打捞池也要跟着活**（**2026-09-26 玩家报障**：
 * 「**打捞残骸捞不到H族残骸，只能捞到该星系默认的。**」）。
 *
 * 病根（真档实测）：`state.weekendWrecks` 里的残骸场 48 小时自然衰减、活动结束也不清，
 * 而打捞型号池原先只在「此刻仍在占领名单里」时才并入入侵舰队 ⇒
 * ① 旗舰期的核心（核心夺回后旗舰才现身，最大一笔残骸正是在这里注入）；
 * ② 夺回后的外围；③ 上一场的遗留场 —— 三种星系的读数都是「残骸条写着入侵残骸、捞出来全是默认残骸」。
 *
 * 修法：**有场就并入来源族的独立入侵卡**（族记在残骸场记录里；老档没记 ⇒ 回落当前事件族）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { pullOneWreck } from '../src/salvaging'
import { injectWeekendWreck, weekendWreckDensityOf, weekendWreckFamilyOf, asFoeFamily, FOE_FAMILY_CODES } from '../src/salvage'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
/** 挑一个"本来就有可见悬赏"的星系当实验场（池底 = 它的原卡） */
const GAL = [...ctx.anomalies.values()].find((a) => !a.hidden && a.galaxyId !== 'galaxy-hub')!.galaxyId
/** 事件的占领区用**别的**星系（否则实验场自己就成了被占星系，两种口径混在一起测不出东西） */
const OTHER = [...ctx.galaxies.keys()].filter((g) => g !== GAL && g !== 'galaxy-hub')

/** 抽 40 轮打捞，返回出过的残骸型号 */
function pulls(s: GameState, galaxyId: string): Set<string> {
  const got = new Set<string>()
  for (let i = 0; i < 40; i++) {
    const r = pullOneWreck(s, ctx, galaxyId, 60_000)
    if (r) got.add(r.itemId)
  }
  return got
}

/** 事件：**以此刻为起点**、占领的是"别的星系"（本实验场**不在占领名单**里） */
function stateWithEvent(opts: { ended?: boolean; family?: 'H' | 'R' } = {}): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 9 })
  s.weekendEvent = {
    seq: 3,
    startedAtWallMs: Date.now(),
    coreId: OTHER[0]!,
    peripheryIds: [OTHER[1]!],
    family: opts.family ?? 'H',
    contributed: {},
    ...(opts.ended === true ? { endedAtWallMs: Date.now() } : {}),
  }
  return s
}

describe('打捞池：入侵残骸场不在占领名单时也要并入侵卡（玩家报障）', () => {
  it('**残留场（星系已不在占领名单）⇒ 仍能捞出「墨潮帮残骸（入侵）」**', () => {
    const s = stateWithEvent()
    injectWeekendWreck(s, GAL, 600, 'H')
    expect(weekendWreckFamilyOf(s, GAL), '场里记着来源族').toBe('H')
    const got = pulls(s, GAL)
    expect(got.has('wreck-h-hi'), `40 次没出 H 残骸（出的是 ${[...got].join(' / ')}）`).toBe(true)
  })

  it('**老档没记族**（兼容字段缺席）⇒ 回落当前事件族，照样出 H', () => {
    const s = stateWithEvent()
    // 模拟老档：只写 density/decayAccMs（不经 `injectWeekendWreck` 的族参数）
    s.weekendWrecks = { [GAL]: { density: 600, decayAccMs: 0 } }
    expect(weekendWreckFamilyOf(s, GAL), '回落当前事件族').toBe('H')
    expect(pulls(s, GAL).has('wreck-h-hi')).toBe(true)
  })

  it('**活动已结束、残骸场还在**（48h 自然衰减）⇒ 仍出 H（场里的族说话）', () => {
    const s = stateWithEvent({ ended: true })
    injectWeekendWreck(s, GAL, 600, 'H')
    expect(s.weekendEvent!.endedAtWallMs, '事件已结束').toBeDefined()
    expect(pulls(s, GAL).has('wreck-h-hi')).toBe(true)
  })

  it('**没有残骸场 ⇒ 老口径逐字不变**（池底只有原卡，捞不到 H）', () => {
    const s = stateWithEvent()
    const got = pulls(s, GAL)
    expect(got.has('wreck-h-hi'), '没有入侵残骸就不该出 H 残骸').toBe(false)
    expect(got.size, '原卡残骸照旧可捞').toBeGreaterThan(0)
  })

  it('写回残骸场（打捞扣减）**不丢来源族**', () => {
    const s = stateWithEvent()
    injectWeekendWreck(s, GAL, 600, 'H')
    /**
     * ⚠ **2026-10-02「甲」**：入侵池改成"按**实际出量**扣"（旧口径是每轮扣 2% 渐近、永不归零）
     * ⇒ 这条不能再拿 40 轮（会把池子捞干、记录被删，`family` 自然读不到）。
     * 本用例只关心"**扣减写回时三格不许丢**"，所以打**一轮**即可。
     */
    const one = pullOneWreck(s, ctx, GAL, 60_000)
    expect(one?.itemId, '这一轮出的是入侵族残骸（H 组 = `h-hi`）').toBe('wreck-h-hi')
    expect(s.weekendWrecks?.[GAL]?.family, '扣减后仍记着族').toBe('H')
    expect(weekendWreckDensityOf(s, GAL), '池子按实际出量减少').toBeLessThan(600)
  })

  /**
   * 🔴 **2026-10-03 修复 + 回归**（**船长转述玩家报障**：「**打完入侵旗舰，结束入侵后，去有入侵残骸的
   * 星系进行打捞，捞不到入侵残骸**」；船长本机用玩家档复现成功）。
   *
   * 真因：`asFoeFamily` 用**手写区间** `/^[A-H]$/` 收窄，而 `FoeFamily = 'A'…'H' | 'R'`
   * ⇒ **R 族（光环科技）落在区间外**：注入时记不上族、判据时读不出族 ⇒ 第二路
   * （"残骸场比占领活得久"，靠族认卡）对 **R 族整条失效**：活动结束后逐格捞上来的全是该星系自己的
   * 普通残骸、**入侵池一点不减**（探针读数：`wreck-a-hi×27` ×4 格 · 池 272 m³ 纹丝不动）。
   * 活动进行中还能捞到，是因为**第一路**（星系仍在被占名单 ⇒ 占领供卡）替它供了卡。
   */
  it('`asFoeFamily` 认**全部族码**（含 R）：数据里出现过的族码一个都不能被收窄挡掉', () => {
    expect(FOE_FAMILY_CODES, '唯一登记表含 R').toContain('R')
    expect(asFoeFamily('R'), 'R 族不再被挡').toBe('R')
    expect(asFoeFamily('A')).toBe('A')
    expect(asFoeFamily('H')).toBe('H')
    expect(asFoeFamily('r'), '小写不接受（族码大写）').toBeUndefined()
    expect(asFoeFamily('Z'), '表外码不接受').toBeUndefined()
    /** **数据驱动契约**：卡面上出现过的每一个族码都必须被接受（将来加新族时这条会先红） */
    const codes = new Set<string>()
    for (const a of ctx.anomalies.values()) {
      const f = a.foeFamily
      if (typeof f === 'string' && f.length > 0) codes.add(f)
    }
    for (const code of codes) {
      expect(asFoeFamily(code), `卡面族码 ${code} 必须能被 asFoeFamily 接受`).toBeDefined()
    }
    console.log(`  [读数] 卡面用到的族码 ${[...codes].sort().join('/')} —— 全部能被收窄接受（登记表 ${FOE_FAMILY_CODES.join('')}）`)
  })

  it('**R 族的残骸场**：注入时记上族 ⇒ **收场之后**照样捞出 `wreck-r-inv`（报障回归）', () => {
    const s = stateWithEvent({ ended: true, family: 'R' })
    /** 真实调用形状：族码先过 `asFoeFamily`（修复前这里传进去的是 `undefined`） */
    injectWeekendWreck(s, GAL, 600, asFoeFamily('R'))
    expect(s.weekendWrecks?.[GAL]?.family, 'R 族要能记进残骸场').toBe('R')
    expect(weekendWreckFamilyOf(s, GAL), '判据也要读得出 R').toBe('R')
    const got = pulls(s, GAL)
    expect(got.has('wreck-r-inv'), `收场后 40 轮没出 R 族入侵残骸（出的是 ${[...got].join(' / ')}）`).toBe(true)
    console.log(`  [读数] 收场后打捞 R 族残骸场：出过 ${[...got].join(' / ')}`)
  })
})
