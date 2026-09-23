/**
 * **导弹发射器周期 +10%**（船长 2026-09-15：「**提高所有导弹发射器10%的周期**」）。
 *
 * 口径 = **装填（`reloadMs`）×1.1**，只动导弹槽（`slot: 'missile'`）的五件；
 * 射程 / 单发 / 命中 / 衰减 / CPU / 价格**一律未动** ⇒ 表现 = 导弹流的 **DPS −9.1%**（1/1.1）。
 *
 * ⚠ 本条是**数值口径守卫**：日后若有人顺手改回或改成别的倍率，这五行的期望值会立刻红。
 * 另附"别的家族没被带偏"的反向判据（炮台/激光同档各抽一件）。
 */
import { describe, expect, it } from 'vitest'
import { MODULES } from '@whale/data'

const byId = (id: string) => MODULES.find((m) => m.id === id)

describe('导弹发射器周期 +10%（船长 2026-09-15）', () => {
  it('五件导弹槽装备的装填一律 = 原值 ×1.1（射程/单发/命中/CPU 不动）', () => {
    const want: Array<[string, number, string]> = [
      ['mod-missile-1', 3432, '轻型导弹架 MK1（3120 → 3432）'],
      ['mod-missile-2', 5280, '重型导弹架 MK2（4800 → 5280）'],
      ['mod-missile-3', 6600, '巡航导弹架 MK3（6000 → 6600）'],
      ['mod-lair-missile-a', 1720, '掠袭导弹巢（A 族窝点专属 · 2200 → 2420 → ⟪2026-09-22 船长令⟫ 1720）'],
      ['mod-wh-c-missile', 8360, '孢子导弹巢（C 族虫洞专属 · 7600 → 8360）'],
    ]
    for (const [id, reloadMs, label] of want) {
      const m = byId(id)
      expect(m, `装备表里没有 ${id}（${label}）`).toBeTruthy()
      expect(m!.slot, `${label} 的槽位`).toBe('missile')
      expect(m!.reloadMs, label).toBe(reloadMs)
    }
    // 覆盖面：装备表里**所有**导弹槽都是这五件（多出一件 ⇒ 本用例提醒补值）
    expect(MODULES.filter((m) => m.slot === 'missile').map((m) => m.id).sort()).toEqual(
      want.map(([id]) => id).sort(),
    )
  })

  it('其余家族未被带偏（炮台 / 激光同档各抽一件，装填保持原值）', () => {
    expect(byId('mod-turret-kin-1')!.reloadMs).toBe(1540)
    expect(byId('mod-laser-1')!.reloadMs).toBe(2000)
    expect(byId('mod-turret-kin-2')!.reloadMs).toBe(2380)
    expect(byId('mod-laser-2')!.reloadMs).toBe(3200)
  })
})
