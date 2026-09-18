/**
 * **A 族窝点套（赃物系列）**——2026-09-17 建，起因 = 玩家报障「**赃物强化仓的护甲增加效果无效**」。
 *
 * 背景：这一套（转管炮 `/mod-lair-gatling-a` · 掠袭导弹巢 `mod-lair-missile-a` · **赃物强化舱
 * `mod-lair-cargo-a`**）此前**没有专门用例**（C/D/E/G 四族各有一份）⇒ 赃物强化舱说明里那句
 * 「货舱容量 +100%，并……（装甲容量 +15%）」的**后半句从来没被引擎算过**：
 * `combat.ts` 的甲容量只在 `armorDefs`（**装甲槽件**）里求和，而它是**低槽货舱件**；
 * 界面却自 2026-09-11 起就显示「装甲容量 +15%」（`shipInfo.tsx` 的 `crossFamilyLines`，
 * 体检白名单也登记了 `mod-lair-cargo-a:armorHpBonus`）⇒ 玩家看到的是不兑现的承诺。
 *
 * 本文件钉住三件事：
 * ① **规则级**：全表**任何槽位**带 `armorHpBonus` 的件都必须计入（数据驱动，逐件量增幅）；
 * ② **报障件**：赃物强化舱的两半（货舱 ×2 · 甲容量 ×1.15）都生效，且不牵连结构层；
 * ③ 与装甲槽件**加算**（1 + 0.15 + 0.2 = 1.35）——既不漏算跨槽位那件，也不重复计入甲件。
 */
import { describe, expect, it } from 'vitest'
import { MODULES, buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState } from '../src/index'
import { createPlayerSpec } from '../src/combat'
import { cargoCapacityM3Of } from '../src/inventory'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const SHIP = 'sh-mako' // 灰鲭鲨：中 3 / 低 2 —— 够装「装甲槽件 + 货舱件」这一对
const HOLD = 'mod-lair-cargo-a' // 赃物强化舱（低槽 · 货舱 +100% · 甲容量 +15%）
const PLATE = 'mod-armor-plate-1' // 装甲增厚板 MK1（低槽 · 甲容量 +20%）

function makeState(low: string[] = []): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: 3 })
  const uid = addShipToFleet(state, SHIP)
  state.shipId = uid
  state.fleet[uid]!.fitted = {
    high: [],
    mid: [],
    low: [...low, null, null].slice(0, 2) as (string | null)[],
  }
  return state
}

/** 甲容量（`createPlayerSpec` 的 `hp.a`；无技能 ⇒ 比值就是装备件系数） */
function armorOf(low: string[] = []): number {
  const s = makeState(low)
  return createPlayerSpec(s, ctx, SHIP)!.hp.a
}

describe('A 族窝点套：赃物强化舱（货舱 + 甲容量）', () => {
  it('**规则级**：全表带 `armorHpBonus` 的件**逐件都计入**（跨槽位那件也不例外）', () => {
    const plain = armorOf()
    const withField = MODULES.filter((m) => (m.armorHpBonus ?? 0) > 0 && m.rack === 'low')
    expect(withField.length, '全表应有多件带甲容量字段的装备').toBeGreaterThan(1)
    // 逐件单独装上量增幅：必须恰好 = 1 + 该件 armorHpBonus（漏算即 1、重复计入即 > 1+值）
    for (const def of withField) {
      const got = armorOf([def.id]) / plain
      expect(got, `${def.name}（${def.id}，槽位 ${def.slot}）的甲容量未计入战斗建档`).toBeCloseTo(
        1 + (def.armorHpBonus ?? 0),
        6,
      )
    }
    // 其中必须有且仅有「赃物强化舱」这一件是**非装甲槽**（跨族样本，即本次报障件）
    const crossSlot = withField.filter((m) => m.slot !== 'armor')
    expect(crossSlot.map((m) => m.id)).toEqual([HOLD])
  })

  it('**报障件**：赃物强化舱**两半都生效**——货舱 ×2 与甲容量 ×1.15，且不动结构层', () => {
    const plain = makeState()
    const withHold = makeState([HOLD])
    // ① 货舱 +100%（`bonus: 1`）
    expect(cargoCapacityM3Of(withHold, ctx, withHold.shipId)).toBeCloseTo(cargoCapacityM3Of(plain, ctx, plain.shipId) * 2, 6)
    // ② 甲容量 +15%（本批修的那一半）
    const specPlain = createPlayerSpec(plain, ctx, SHIP)!
    const specHold = createPlayerSpec(withHold, ctx, SHIP)!
    expect(specHold.hp.a / specPlain.hp.a).toBeCloseTo(1.15, 6)
    // ③ 结构层不吃这一件（说明里只承诺货舱与装甲）
    expect(specHold.hp.h).toBeCloseTo(specPlain.hp.h, 6)
    // ④ 盾层同档不动
    expect(specHold.hp.s).toBeCloseTo(specPlain.hp.s, 6)
  })

  it('与装甲槽件**加算**（1 + 0.15 + 0.2 = 1.35）：不漏算跨槽位件、也不重复计入甲件', () => {
    const plain = armorOf()
    const both = armorOf([HOLD, PLATE])
    expect(both / plain).toBeCloseTo(1.35, 6)
    // 对照：只装甲件 = 1.20（与上面"逐件"那条同值 ⇒ 甲件没有被算两次）
    expect(armorOf([PLATE]) / plain).toBeCloseTo(1.2, 6)
  })
})
