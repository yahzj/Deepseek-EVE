/**
 * **主控活动切换的单点判据**（`core/activityGate.ts` · 2026-09-21 船长令）。
 *
 * 钉三件事：① 三档分类（自动停 / 先警告 / 不可中断）② 状态类锁定（战斗中 · 洞里 · 返航途中）
 * ③ 副船遇袭**不**拦主控（只有打在主控船上的那一场才算）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import {
  ACTIVITY_CONFIRM_ID,
  applyActivityGate,
  AUTO_HALT_KINDS,
  KIND_LABEL,
  WARN_KINDS,
  cannotInterruptReason,
  gateMainActivity,
  mainActivityOf,
} from '../src/activityGate'
import type { MainActivityKind } from '../src/activityGate'

function state(): GameState {
  return createInitialState({ nowWallMs: 0, seed: 3 })
}

describe('主控活动切换：三档分类（船长 2026-09-21）', () => {
  it('主控空着 ⇒ ok；**七项可自动停** ⇒ halt（含 2026-09-22 并入的建站交付）', () => {
    const s = state()
    expect(mainActivityOf(s)).toBeNull()
    expect(gateMainActivity(s, 'mining').action).toBe('ok')
    for (const kind of AUTO_HALT_KINDS) {
      const st = state()
      if (kind === 'mining') st.mining.active = true
      else if (kind === 'salvaging') st.salvaging.active = true
      else if (kind === 'wormholeScan') st.wormholeScan = { ...(st.wormholeScan ?? {}), active: true } as GameState['wormholeScan']
      else if (kind === 'standby') st.standby.active = true
      else if (kind === 'refine') st.refineRuns = [{ id: 1, active: true, worker: 'pilot' } as GameState['refineRuns'][number]]
      else if (kind === 'manufacturing') st.manufacturingRuns = [{ id: 1, active: true, worker: 'pilot' } as GameState['manufacturingRuns'][number]]
      else if (kind === 'siteDeliver') {
        st.transit.active = true
        st.transit.delivery = { siteId: 'site-x', phase: 'to-site', loaded: {} } as never
      }
      const v = gateMainActivity(st, 'hauling')
      expect(v.action, `${kind} 应可直接切`).toBe('halt')
      expect(v.current).toBe(kind)
    }
  })

  it('长途运输 ⇒ 先警告（可中断）；远征 / 快递 ⇒ 警告口径但**拒绝**（在途不可中断）', () => {
    const hauling = state()
    hauling.hauling.active = true
    const v1 = gateMainActivity(hauling, 'mining')
    expect(v1.action).toBe('confirm')
    expect(v1.interruptible).toBe(true)
    expect(v1.message).toContain('本段报酬拿不到')

    for (const kind of WARN_KINDS.filter((k) => k !== 'hauling')) {
      const s = state()
      if (kind === 'expedition') s.expedition.active = true
      else s.sideTasks.deliver = { taskId: 'x' } as unknown as GameState['sideTasks']['deliver']
      const v = gateMainActivity(s, 'mining')
      expect(v.action, `${kind} 应拒`).toBe('reject')
      expect(v.interruptible).toBe(false)
      expect(v.message).toContain('不能中断')
    }
  })

  it('同一项已在跑 ⇒ ok（幂等，不自己拦自己）', () => {
    const s = state()
    s.mining.active = true
    expect(gateMainActivity(s, 'mining').action).toBe('ok')
  })
})

describe('不可被打断的状态（船长：「处在战斗中的时候也设置为不可取消」）', () => {
  it('三处战斗槽都拦：远征实时战 / 主控船的低安遭遇战 / 洞内战', () => {
    const exp = state()
    exp.expedition.battle = {} as NonNullable<GameState['expedition']['battle']>
    expect(cannotInterruptReason(exp)).toContain('战斗中')

    const enc = state()
    enc.encounter.active = true
    enc.encounter.shipId = enc.shipId
    enc.encounter.battle = {} as NonNullable<GameState['encounter']['battle']>
    expect(cannotInterruptReason(enc)).toContain('战斗中')

    const wh = state()
    wh.wormhole.run = { battle: {} } as unknown as NonNullable<GameState['wormhole']['run']>
    expect(cannotInterruptReason(wh)).toContain('战斗中')
  })

  it('**副船**遇袭不拦主控（只有打在主控船上那一场才算）', () => {
    const s = state()
    s.encounter.active = true
    s.encounter.shipId = 'someone-else'
    s.encounter.battle = {} as NonNullable<GameState['encounter']['battle']>
    expect(cannotInterruptReason(s)).toBeNull()
    expect(gateMainActivity(s, 'mining').action).toBe('ok')
  })

  it('人在洞里 / 换港返航途中 ⇒ 拒（各有自己的理由）', () => {
    const wh = state()
    wh.wormhole.run = { attending: true } as unknown as NonNullable<GameState['wormhole']['run']>
    expect(cannotInterruptReason(wh)).toContain('虫洞')

    const tr = state()
    tr.transit.active = true
    expect(cannotInterruptReason(tr)).toContain('返航')
  })

  /**
   * **临时离开虫洞 ⇒ 主控立刻释放**（船长 2026-09-13 批准的口径，`state.wormholePilotHoldReason` 同一把尺）：
   * `run` 还在、只是 `attending = false` ⇒ 判据必须**不拦**（否则"离开虫洞去做别的"这条路会被堵死）。
   */
  it('临时离开虫洞（attending=false）⇒ 主控已释放，不算锁', () => {
    const s = state()
    s.wormhole.run = { attending: false } as unknown as NonNullable<GameState['wormhole']['run']>
    expect(cannotInterruptReason(s)).toBeNull()
    s.mining.active = true
    expect(gateMainActivity(s, 'mining').action).toBe('ok')
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * **10×10 矩阵**（**2026-09-21 船长令**的统一口径：能直接切就自动取消当前活动 · 长途运输先警告 ·
 * 远征/快递不可中断；**2026-09-22 追加**：建站交付并入同一张表）——行 = 现在占着主控的那一项，
 * 列 = 想开始的那一项。
 *
 * ⚠ 这一层测的是**十个 `start*` 入口共用的那一个落地口**（`applyActivityGate`：判据 → 该停的停掉
 * ＋统一日志 → 告诉入口能不能开工）⇒ 一张表就能把三档钉死，不必给十条真命令各搭一套前置现场；
 * 真命令层面的关键交叉另有专测（`wormhole-activity-lock` / `wormhole-scan` / `manufacturing` /
 * `industry` / `expedition` / `wormhole-run` / `t9`（建站交付））。
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
describe('10×10 矩阵：三档分类逐格钉死（船长 2026-09-21 ＋ 2026-09-22 建站交付）', () => {
  /** 十项现场（真命令之外的纯状态构造；每一项对应 `mainActivityOf` 的一个分支） */
  const SETUP: Record<MainActivityKind, (s: GameState) => void> = {
    mining: (s) => void (s.mining.active = true),
    salvaging: (s) => void (s.salvaging.active = true),
    hauling: (s) => {
      s.hauling.active = true
      s.hauling.routeB = 'site-x'
      s.hauling.toSiteId = 'site-x'
    },
    deliver: (s) => void (s.sideTasks.deliver = { taskId: 1, arriveAtGameMs: 600_000 } as never),
    standby: (s) => void (s.standby.active = true),
    wormholeScan: (s) => void (s.wormholeScan = { active: true, progressMs: 60_000 } as GameState['wormholeScan']),
    expedition: (s) => {
      s.expedition.active = true
      s.expedition.phase = 'back'
      s.expedition.battle = null
    },
    refine: (s) => void s.refineRuns.push({ id: 1, active: true, worker: 'pilot' } as never),
    manufacturing: (s) => void s.manufacturingRuns.push({ id: 1, active: true, worker: 'pilot' } as never),
    /** 建站交付：占的是 `transit` 槽，靠 `delivery` 批次与"换港返航"区分（2026-09-22 船长令） */
    siteDeliver: (s) => {
      s.transit.active = true
      s.transit.fromGalaxy = 'galaxy-hub'
      s.transit.toGalaxy = 'galaxy-far'
      s.transit.delivery = { siteId: 'site-x', phase: 'to-site', loaded: { 'ore-a': 10 } } as never
    },
  }
  const ALL_KINDS = Object.keys(SETUP) as MainActivityKind[]

  /** 这一项停掉之后，状态里该看到的"已经不在跑" */
  const STOPPED: Record<MainActivityKind, (s: GameState) => boolean> = {
    mining: (s) => !s.mining.active,
    salvaging: (s) => !s.salvaging.active,
    hauling: (s) => !s.hauling.active,
    deliver: (s) => s.sideTasks.deliver === null,
    standby: (s) => !s.standby.active,
    wormholeScan: (s) => s.wormholeScan?.active !== true,
    expedition: (s) => !s.expedition.active,
    refine: (s) => !s.refineRuns.some((r) => r.active && r.worker === 'pilot'),
    manufacturing: (s) => !s.manufacturingRuns.some((r) => r.active && r.worker === 'pilot'),
    siteDeliver: (s) => !s.transit.active && s.transit.delivery === null,
  }

  it('**可自动停的七项**：任意一项在跑时，其余九项都能直接开工（停掉它 + 一条统一日志）', () => {
    for (const current of AUTO_HALT_KINDS) {
      for (const next of ALL_KINDS) {
        if (next === current) continue
        const s = state()
        SETUP[current](s)
        const skip = applyActivityGate(s, next)
        expect(skip, `当前=${current} → 开始=${next} 应当直接切`).toBeNull()
        expect(STOPPED[current](s), `当前=${current} 没被停掉`).toBe(true)
        expect(
          s.logs.some((l) => l.textId === 'core.activityGate.001' && l.text.includes(KIND_LABEL[current])),
          `当前=${current} 的自动停机日志不对`,
        ).toBe(true)
        expect(s.logs.filter((l) => l.textId === 'core.activityGate.001')).toHaveLength(1) // 一次切换只写一条
      }
    }
  })

  it('**建站交付的停机口径**：舰船返港、**本趟建材留在船上**（与开采/打捞同款，无损）', () => {
    const s = state()
    SETUP.siteDeliver(s)
    s.fleet[s.shipId]!.cargo['ore-a'] = 10
    s.awayGalaxy = 'galaxy-hub'
    expect(applyActivityGate(s, 'mining')).toBeNull()
    expect(s.transit.active).toBe(false)
    expect(s.transit.delivery).toBeNull()
    expect(s.awayGalaxy).toBeNull() // 回母港（dockedSite = null）
    expect(s.fleet[s.shipId]!.cargo['ore-a'], '本趟建材留在船上').toBe(10)
    expect(s.logs.some((l) => l.textId === 'core.activityGate.001' && l.text.includes('建站交付'))).toBe(true)
  })

  it('**长途运输**：任意一项想开始时都只给警告（`core.activityGate.002`），且**一格都不动**', () => {
    for (const next of ALL_KINDS) {
      if (next === 'hauling') continue
      const s = state()
      SETUP.hauling(s)
      const skip = applyActivityGate(s, next)
      expect(skip?.errorId, `长途运输在跑 → 开始=${next} 应当先警告`).toBe(ACTIVITY_CONFIRM_ID)
      expect(skip?.error ?? '').toContain('本段报酬拿不到') // 代价写清楚
      expect(skip?.error ?? '').toContain('再点一次即确认')
      expect(s.hauling.active, `${next}：首击只警告，不许先把运输停掉`).toBe(true)
      expect(s.logs.some((l) => l.textId === 'core.activityGate.001')).toBe(false)
    }
  })

  it('**远征 / 快递投送**：任意一项想开始时都**拒**（`core.activityGate.003`，在途不可中断）', () => {
    for (const current of ['expedition', 'deliver'] as MainActivityKind[]) {
      for (const next of ALL_KINDS) {
        if (next === current) continue
        const s = state()
        SETUP[current](s)
        const skip = applyActivityGate(s, next)
        expect(skip?.errorId, `当前=${current} → 开始=${next} 应当拒`).toBe('core.activityGate.003')
        expect(skip?.error ?? '').toContain('不能中断')
        expect(STOPPED[current](s), `当前=${current} 不许被停掉`).toBe(false)
      }
    }
  })

  it('**同一项**在跑 ⇒ 放行（幂等；同项的新参数由各入口自己裁决，不由切换判据拦）', () => {
    for (const kind of ALL_KINDS) {
      const s = state()
      SETUP[kind](s)
      expect(applyActivityGate(s, kind), `${kind} 不该自己拦自己`).toBeNull()
      expect(s.logs.some((l) => l.textId === 'core.activityGate.001')).toBe(false) // 没有"停机"这回事
    }
  })

  it('**三种锁定态**：战斗中 / 洞里 / 返航途中 ⇒ 十项一律拒（`core.activityGate.004~006`）', () => {
    const locks: Array<[string, string, (s: GameState) => void]> = [
      ['战斗中', 'core.activityGate.004', (s) => void (s.expedition.battle = {} as never)],
      ['洞里', 'core.activityGate.005', (s) => void (s.wormhole.run = { attending: true } as never)],
      /** ⚠ 「换港返航」只认**不带交付批次**的 transit（带 delivery 的是建站交付＝主控活动，走三档分类） */
      ['返航途中', 'core.activityGate.006', (s) => void (s.transit.active = true)],
    ]
    for (const [name, id, lock] of locks) {
      for (const next of ALL_KINDS) {
        const s = state()
        lock(s)
        const skip = applyActivityGate(s, next)
        expect(skip?.errorId, `${name} 时开始=${next} 应当拒`).toBe(id)
      }
    }
  })
})
