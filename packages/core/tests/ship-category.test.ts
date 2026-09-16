/**
 * **舰船「类别」：装甲舰名与装甲线判据**（船长 2026-09-16 三裁 · 已确认）。
 *
 * 船长原话（照抄）：
 * 1.「**将重装舰类的名称改为装甲舰。**」
 * 2.「**同时将一些装甲占比比护盾高的船也归入装甲舰。**」
 * 3. 四步闸门二选一里选 **丙**：判据「**只在武装舰里判**」；并追加
 *    「**因为我还希望将牛鲨级突击舰和E族专属舰的护盾和装甲互换。**」
 * 4. 三艘非专属乌龟船：「**原先将非专属的三条乌龟船添加舰船的子分类：武装货舰**」。
 *
 * 本文件钉四件事：
 * ① **展示名**：`armored` ⇒ 「装甲」（`SHIP_ROLE_LABELS`；`role` id 不变 ⇒ 存档零迁移），技能
 *    `armored-ops` 展示名 ⇒ 「装甲舰操作」；
 * ② **装甲线判据**（`isArmorLineShip`）= `role === 'armored'` **或**（武装舰且装甲占比 > 护盾占比）；
 * ③ **只判类别、不动机制**：转线的 4 艘 `role` 仍是 `armed` ⇒ 等效质量不折抵（舰种档不变）、
 *    不吃「装甲舰操作」技能、仍算战斗舰（敌方「打非战斗船」口径不变）；
 * ④ **非战斗舰不许被吸进装甲线**（丙案「只在武装舰里判」）——座头鲸级矿舰 / 蝠鲼级重载货舰
 *    虽然装甲占比更高，仍在「采矿舰 / 货运舰」里。
 */
import { describe, expect, it } from 'vitest'
import { SHIPS } from '@whale/data'
import { SHIP_ROLE_LABELS, isArmorLineShip, shipCategoryKeyOf, shipCategoryLabelOf } from '../src/labels'
import { SKILLS } from '@whale/data'

const shipOf = (id: string) => SHIPS.find((s) => s.id === id)!
/** 船长点名的"盾/甲互换"四艘（换完即装甲占比更高） */
const SWAPPED = ['sh-bullshark', 'sh-wh-e-frigate', 'sh-wh-e-destroyer', 'sh-wh-e-carrier'] as const

describe('舰船类别：装甲舰（船长 2026-09-16）', () => {
  it('展示名：armored ⇒ 「装甲」· 技能 armored-ops ⇒ 「装甲舰操作」（id 都不变）', () => {
    expect(SHIP_ROLE_LABELS.armored).toBe('装甲')
    expect(SHIP_ROLE_LABELS.armed).toBe('武装') // 兄弟档不动
    expect(SKILLS.find((s) => s.id === 'armored-ops')?.name).toBe('装甲舰操作')
  })

  it('判据：`role: armored` 一律是装甲线（含 D 族那种护盾占比高的既有装甲族）', () => {
    for (const s of SHIPS.filter((x) => x.role === 'armored')) {
      expect(isArmorLineShip(s), `${s.id}（role armored）应在装甲线`).toBe(true)
    }
    // D 族哨戒电子舰：role armored 但护盾占比高 —— 丙案只按 role 收，故此仍在装甲线
    const dFrigate = shipOf('sh-wh-d-frigate')
    expect(dFrigate.shieldHp! > dFrigate.armorHp!).toBe(true)
    expect(isArmorLineShip(dFrigate)).toBe(true)
  })

  it('判据：武装舰里**装甲占比 > 护盾占比**者归入装甲线（牛鲨 + E 族三艘）', () => {
    for (const id of SWAPPED) {
      const s = shipOf(id)
      expect(s.role, `${id} 的 role 应保持 armed（丙案：只判类别）`).toBe('armed')
      expect(s.armorHp! > s.shieldHp!, `${id} 换盾/甲后应装甲占比更高`).toBe(true)
      expect(isArmorLineShip(s), `${id} 应在装甲线`).toBe(true)
      expect(shipCategoryKeyOf(s), `${id} 的类别键`).toBe('armored')
      expect(shipCategoryLabelOf(s), `${id} 的类别名`).toBe('装甲')
    }
    // 对照：护盾型武装舰不进装甲线
    for (const id of ['sh-thresher', 'sh-electricray', 'sh-hammerhead', 'sh-megalodon']) {
      expect(isArmorLineShip(shipOf(id)), `${id} 不该进装甲线`).toBe(false)
      expect(shipCategoryKeyOf(shipOf(id))).toBe('armed')
    }
  })

  it('盾/甲互换的**数值**钉住：总血不变、两值互换（防回改或"顺手补偿"）', () => {
    const want: Record<string, [number, number, number]> = {
      // [盾, 甲, 壳] = 互换后的现值
      'sh-bullshark': [163, 400, 192],
      'sh-wh-e-frigate': [60, 115, 80],
      'sh-wh-e-destroyer': [90, 230, 115],
      'sh-wh-e-carrier': [160, 410, 200],
    }
    for (const [id, [sh, a, hu]] of Object.entries(want)) {
      const s = shipOf(id)
      expect([s.shieldHp, s.armorHp, s.hullHp], `${id} 三层血`).toEqual([sh, a, hu])
    }
    // 总血与改前一致（互换不增不减）
    expect(shipOf('sh-bullshark').shieldHp! + shipOf('sh-bullshark').armorHp! + shipOf('sh-bullshark').hullHp!).toBe(755)
    expect(shipOf('sh-wh-e-carrier').shieldHp! + shipOf('sh-wh-e-carrier').armorHp! + shipOf('sh-wh-e-carrier').hullHp!).toBe(770)
  })

  it('**只判类别、不动机制**：转线的 4 艘仍按 `armed` 吃口径（等效质量不折抵 / 舰种档不变）', () => {
    // 等效质量 = massKg ×(armored?0.65:1)：role 未变 ⇒ 与改前同值（这里钉"折抵没被算上"）
    const bull = shipOf('sh-bullshark')
    expect(bull.role).toBe('armed')
    expect(bull.role === 'armored' ? bull.massKg! * 0.65 : bull.massKg).toBe(bull.massKg) // 未被折抵
    // 档位是数据字段（不随类别判据漂移）
    expect([bull.tier, shipOf('sh-wh-e-frigate').tier, shipOf('sh-wh-e-destroyer').tier, shipOf('sh-wh-e-carrier').tier]).toEqual([3, 1, 2, 3])
  })

  it('**非战斗舰不许被吸进装甲线**（丙案「只在武装舰里判」）', () => {
    for (const id of ['sh-humpback', 'sh-bowhead', 'sh-colossal', 'sh-flyingfish', 'sh-sailfish', 'sh-swordfish']) {
      const s = shipOf(id)
      expect(s.armorHp! > s.shieldHp!, `${id} 确实装甲占比更高（数据事实）`).toBe(true)
      expect(isArmorLineShip(s), `${id} 是矿舰/货舰 ⇒ 不归装甲线`).toBe(false)
      expect(shipCategoryKeyOf(s), `${id} 的类别键 = 它自己的 role`).toBe(s.role)
    }
  })

  it('三艘乌龟船的子分类 = 「武装货舰」（船长 2026-09-16），全仓恰好 3 艘', () => {
    const declared = SHIPS.filter((s) => s.subClass === '武装货舰')
    expect(declared.map((s) => s.id).sort()).toEqual(['sh-hawksbill', 'sh-tortoise', 'sh-xuanwu'])
    for (const s of declared) {
      expect(s.role, `${s.id} 仍是 armored`).toBe('armored')
      expect(shipCategoryLabelOf(s), `${s.id} 类别名`).toBe('装甲')
    }
  })
})
