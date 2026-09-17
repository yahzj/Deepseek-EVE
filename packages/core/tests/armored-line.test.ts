/**
 * 重装线（甲壳族 3 艘 = 陆龟级 / 玳瑁级 / 玄武级）**货舱 −20%**（船长 2026-09-15）。
 *
 * ① 船长原话：「下调重装船的货仓20%。且发现有些非重装船被分到了重装类别里。」
 *    ＋（追问后）「只保留基础的3艘重装船，货舱修改的也是它们」⇒ **本线 = 3 艘**，
 *    货舱改动**只落在它们身上**，其余船一艘不动。
 * ② 口径：**只动 `cargoM3`**（7000→5600 · 12000→9600 · 19000→15200，一律原值 ×0.8）；
 *    槽位 / 三层血 / 循环与产量 / CPU / 行价 / 质量 / 甲壳族抗性**一律不动**
 *    （本件逐项钉住，防后续"顺手补偿"把这条平衡改动抵消掉）。
 * ③ 玩家可见文案同源：`packages/data/src/shipBlueprints.ts` 里蓝图说明的「货舱 N m³」跟着改
 *    （玳瑁 2 处 / 玄武 2 处 = 常规蓝图 + 一次性图纸；content:check「蓝图说明契约」会把两边对不上判红）。
 * ④ 待办（不在本件）：虫洞专属 C/D 族那 6 艘的**类别归属**（现挂 `role: 'armored'`）
 *    待船长裁定——改 role 会撞 content:check 的三条「武装舰族定位」契约与
 *    `tests/wh-ship-baseline.test.ts` 的「武装舰高槽」用例，已按 §5.2 上报。
 */
import { describe, expect, it } from 'vitest'
import { SHIPS, SHIP_BLUEPRINTS } from '@whale/data'

function shipOf(id: string) {
  const s = SHIPS.find((x) => x.id === id)
  expect(s, `舰船目录里没有 ${id}`).toBeTruthy()
  return s!
}

/** 装甲线三艘（船长 2026-09-15：「只保留基础的3艘重装船」） */
const LINE = ['sh-tortoise', 'sh-hawksbill', 'sh-xuanwu'] as const

describe('装甲线（甲壳族）货舱 −20%（船长 2026-09-15）', () => {
  it('三艘的货舱 = 原值 ×0.8', () => {
    expect(shipOf('sh-tortoise').cargoM3).toBe(5_600) // 7,000 ×0.8
    expect(shipOf('sh-hawksbill').cargoM3).toBe(9_600) // 12,000 ×0.8
    expect(shipOf('sh-xuanwu').cargoM3).toBe(15_200) // 19,000 ×0.8
  })

  it('三艘都还在「装甲」类别里（本线身份不变）', () => {
    for (const id of LINE) expect(shipOf(id).role, `${id} 的 role`).toBe('armored')
  })

  it('只动货舱：槽位 / 三层血 / 循环与产量 / CPU / 行价 / 质量 / 甲壳抗性 逐项原值', () => {
    const rows: [
      string,
      {
        slots: { high: number; mid: number; low: number }
        hp: [number, number, number]
        cycle: number
        units: number
        cpu: number
        price: number
        mass: number
        /** 2026-09-17 船长：装甲舰甲层按档位给的**动能+能量**抗性（陆龟 T2 = 0.3；玳瑁 T3、玄武 T4 = 0.35） */
        armorResKineticAndPlasma: number
      },
    ][] = [
      [
        'sh-tortoise',
        {
          slots: { high: 3, mid: 3, low: 4 },
          hp: [60, 150, 180],
          cycle: 13,
          units: 24,
          cpu: 205,
          price: 450_000,
          mass: 6_000_000,
          armorResKineticAndPlasma: 0.3,
        },
      ],
      [
        'sh-hawksbill',
        {
          slots: { high: 4, mid: 4, low: 5 },
          hp: [120, 360, 430],
          cycle: 13,
          units: 22,
          cpu: 330,
          price: 6_000_000,
          mass: 11_000_000,
          armorResKineticAndPlasma: 0.35,
        },
      ],
      [
        'sh-xuanwu',
        {
          slots: { high: 4, mid: 4, low: 6 },
          hp: [166, 493, 614],
          cycle: 14,
          units: 26,
          cpu: 490,
          price: 90_000_000,
          mass: 20_000_000,
          armorResKineticAndPlasma: 0.35,
        },
      ],
    ]
    for (const [id, w] of rows) {
      const s = shipOf(id)
      expect(s.slots, `${id} 槽位`).toEqual(w.slots)
      expect([s.shieldHp, s.armorHp, s.hullHp], `${id} 三层血`).toEqual(w.hp)
      expect([s.cycleSeconds, s.oreUnitsPerCycle], `${id} 循环 / 每循环产量`).toEqual([w.cycle, w.units])
      expect(s.cpu, `${id} CPU`).toBe(w.cpu)
      expect(s.priceIsk, `${id} 行价`).toBe(w.price)
      expect(s.massKg, `${id} 质量`).toBe(w.mass)
      // 甲壳族抗性：原有甲层「高爆 0.5」保留（族/子分类给的），
      // 2026-09-17 船长追加「装甲舰按档位给甲层动能+能量抗性」（陆龟 T2 = 30% / 玳瑁 T3、玄武 T4 = 35%）
      expect(s.armorResist, `${id} 甲壳族抗性`).toEqual({
        explosive: 0.5,
        kinetic: w.armorResKineticAndPlasma,
        plasma: w.armorResKineticAndPlasma,
      })
    }
  })

  it('蓝图说明里的「货舱 N m³」跟着改（玩家可见文案；content:check 同源守）', () => {
    // 陆龟级蓝图说明是定性描述（本就没有数字）——确认没被顺手塞进一个数字
    const tortoise = SHIP_BLUEPRINTS.filter((b) => b.shipId === 'sh-tortoise')
    expect(tortoise.length).toBe(1)
    expect(tortoise[0]!.description).not.toMatch(/货舱\s*[\d,]+/)

    const want: [string, string, string][] = [
      ['sh-hawksbill', '9,600', '12,000'],
      ['sh-xuanwu', '15,200', '19,000'],
    ]
    for (const [shipId, num, oldNum] of want) {
      const list = SHIP_BLUEPRINTS.filter((b) => b.shipId === shipId)
      expect(list.length, `${shipId} 的蓝图件数（常规 + 一次性图纸）`).toBe(2)
      for (const b of list) {
        expect(b.description, `${b.id} 蓝图说明里的货舱数字`).toContain(`货舱 ${num} m³`)
        expect(b.description, `${b.id} 蓝图说明还留着旧数字 ${oldNum}`).not.toContain(oldNum)
      }
    }
  })
})
