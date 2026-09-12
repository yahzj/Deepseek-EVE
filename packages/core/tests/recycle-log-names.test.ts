/**
 * 回收残骸日志的**名称口径**（2026-09-11 船长实测反馈：「回收残骸出货时的事件日志内显示的额外掉落
 * 为装备ID，建议修复」）。
 *
 * 病根：`industry.ts` 的炉所得明细里名表只查了 `ctx.items`（物品），而「额外掉落」段里的装备是**模块 id**
 * （如 `mod-lair-turret-a`）⇒ 查不到就回落到裸 id，玩家在事件日志里看到 `装备 mod-lair-turret-a×1`。
 * 本用例锁死两条：① 出货日志必须写**中文名**；② 整炉日志里**不得出现任何目录裸 id**（mod-/bp-/wreck-…）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addWare, createInitialState, RARE_WRECK_VOLUME_M3, rareWreckItemIdOf, startRecycleRun } from '../src/index'
import { advanceRefining } from '../src/industry'
import { RARE_BOX_GEAR_CHANCE } from '../src/salvage'

const ctx = buildSimContext()

/** 目录裸 id 形态（玩家可见日志里不该出现） */
const BARE_ID = /\b(mod|bp|wreck|drone|ammo|min)-[a-z0-9-]+/

describe('回收残骸日志名称口径（2026-09-11 船长反馈修复）', () => {
  it('A 族稀有残骸：高级箱与炉所得明细都写中文名，全炉日志无裸 id', () => {
    const saved = { ...RARE_BOX_GEAR_CHANCE }
    try {
      // 强制命中专属装备，保证「额外掉落」段出现（该段正是出裸 id 的地方）
      for (const k of Object.keys(RARE_BOX_GEAR_CHANCE)) {
        RARE_BOX_GEAR_CHANCE[k as keyof typeof RARE_BOX_GEAR_CHANCE] = 1
      }
      const state = createInitialState({ nowWallMs: 0, seed: 7 })
      const rareId = rareWreckItemIdOf('ano-redring-raiders')!
      const gearName = ctx.modules.get('mod-lair-turret-a')?.name ?? '' // 池内三件之一必出
      expect(gearName.length).toBeGreaterThan(0)

      addWare(state, rareId, RARE_WRECK_VOLUME_M3) // 1 件 = 30 m³ = 一整箱
      expect(startRecycleRun(state, rareId, 'pilot', ctx).ok).toBe(true)
      const from = state.logs.length
      state.gameMs += 120_000 // 30 m³ = 3 批 × 10 m³（每批 25 秒）
      advanceRefining(state, ctx)

      const lines = state.logs.slice(from).map((l) => l.text)
      expect(lines.length).toBeGreaterThan(0)
      // ① 炉所得明细里的「额外掉落：装备 …」必须是中文名（三件之一）
      const note = lines.find((t) => t.includes('额外掉落：装备'))
      expect(note).toBeTruthy()
      const anyGearName = ['mod-lair-turret-a', 'mod-lair-missile-a', 'mod-lair-cargo-a']
        .map((id) => ctx.modules.get(id)?.name ?? '')
        .filter((n) => n.length > 0)
      expect(anyGearName.some((n) => note!.includes(n))).toBe(true)
      // ② 整炉任何一行都不得含目录裸 id
      const leaking = lines.filter((t) => BARE_ID.test(t))
      expect(leaking).toEqual([])
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        RARE_BOX_GEAR_CHANCE[k as keyof typeof RARE_BOX_GEAR_CHANCE] = v
      }
    }
  })
})
