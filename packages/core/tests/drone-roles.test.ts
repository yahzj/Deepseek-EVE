/**
 * 无人机四型定位契约（2026-09-10 船长拍板，已确认）：
 * 侦察机（蜂鸟）闪避最高、装甲最薄；战斗机（赤鸢）属性平均；攻坚机（猎鹰）血量最厚、单发高、
 * 闪避最低；哨戒机（雷鸥）射程最远、单发最高（狙击）、血量与侦察机相仿。
 * 本测试既钉住现行四型锚点数值，也验证"新机型必须落在契约内"的守卫真的会拦人。
 */
import { describe, expect, it } from 'vitest'
import {
  buildSimContext,
  DRONE_ROLE_SPECS,
  droneRoleIssues,
  droneRoleLadderIssues,
  droneTotalHp,
} from '@whale/data'
import type { ItemDef } from '../src/types'

const ctx = buildSimContext()
const droneOf = (id: string): ItemDef => {
  const d = ctx.items.get(id)
  if (!d) throw new Error(`缺无人机 ${id}`)
  return d
}
const scoutDmg = droneOf('drone-scout').dmg ?? 0
const ALL = ['drone-scout', 'drone-assault', 'drone-heavy', 'drone-sentry'].map(droneOf)

describe('无人机四型定位（2026-09-10 船长拍板）', () => {
  it('闪避阶梯：侦察 0.45 ＞ 战斗 0.25 ＞ 哨戒 0.18 ＞ 攻坚 0.10', () => {
    expect(droneOf('drone-scout').defense!.evasion).toBe(0.45)
    expect(droneOf('drone-assault').defense!.evasion).toBe(0.25)
    expect(droneOf('drone-sentry').defense!.evasion).toBe(0.18)
    expect(droneOf('drone-heavy').defense!.evasion).toBe(0.1)
  })

  it('血量阶梯：攻坚 194 ＞ 战斗 80 ＞ 哨戒 46 ≈ 侦察 38（哨戒与侦察机相仿；2026-09-11 全军 ×2）', () => {
    expect(droneTotalHp(droneOf('drone-heavy'))).toBe(194)
    expect(droneTotalHp(droneOf('drone-assault'))).toBe(80)
    expect(droneTotalHp(droneOf('drone-sentry'))).toBe(46)
    expect(droneTotalHp(droneOf('drone-scout'))).toBe(38)
  })

  it('火力阶梯：单发 3 / 6 / 12 / 20（侦察 1× → 战斗 2× → 攻坚 4× → 哨戒 6.67×）', () => {
    expect(ALL.map((d) => d.dmg)).toEqual([3, 6, 12, 20])
  })

  it('射程与命中口径：三型 75% 不随距离衰减，哨戒 110% 保留衰减', () => {
    for (const id of ['drone-scout', 'drone-assault', 'drone-heavy']) {
      const d = droneOf(id)
      expect(d.hitRate).toBe(0.75)
      expect(d.falloff).toBe(1)
    }
    const sentry = droneOf('drone-sentry')
    expect(sentry.hitRate).toBe(1.1)
    expect(sentry.falloff).toBe(0.35)
    expect(ALL.map((d) => d.maxRangeM)).toEqual([2500, 3000, 3500, 5000])
  })

  it('定位契约自检通过：四型逐机合规 + 跨类阶梯成立', () => {
    for (const d of ALL) {
      expect(droneRoleIssues(d, scoutDmg), `${d.id} 违反定位契约`).toEqual([])
    }
    expect(droneRoleLadderIssues(ALL)).toEqual([])
  })

  it('守卫生效：越档即被拦下（闪避/血量/单发/衰减冲突各自报错）', () => {
    const badEvasion: ItemDef = { ...droneOf('drone-heavy'), defense: { ...droneOf('drone-heavy').defense!, evasion: 0.3 } }
    expect(droneRoleIssues(badEvasion, scoutDmg).join()).toContain('闪避')

    const badHp: ItemDef = { ...droneOf('drone-sentry'), defense: { ...droneOf('drone-sentry').defense!, hullHp: 200 } }
    expect(droneRoleIssues(badHp, scoutDmg).join()).toContain('总血')

    const badDmg: ItemDef = { ...droneOf('drone-assault'), dmg: 30 }
    expect(droneRoleIssues(badDmg, scoutDmg).join()).toContain('单发')

    const badFalloff: ItemDef = { ...droneOf('drone-scout'), falloff: 0.5 }
    expect(droneRoleIssues(badFalloff, scoutDmg).join()).toContain('不随距离衰减')

    // 阶梯破坏：晴戒机血厚于战斗机（跨类关系）
    const badLadder: ItemDef = { ...droneOf('drone-sentry'), defense: { ...droneOf('drone-sentry').defense!, hullHp: 120 } }
    const broken = ALL.map((d) => (d.id === 'drone-sentry' ? badLadder : d))
    expect(droneRoleLadderIssues(broken).length).toBeGreaterThan(0)
  })

  it('契约区间与现行四型一致（新机型照此开卡）', () => {
    expect(DRONE_ROLE_SPECS.scout.evasion).toEqual([0.42, 0.55])
    expect(DRONE_ROLE_SPECS.combat.evasion).toEqual([0.2, 0.3])
    expect(DRONE_ROLE_SPECS.assault.totalHp).toEqual([180, 240]) // 2026-09-11 定位档同步 ×2
    expect(DRONE_ROLE_SPECS.sentry.noFalloff).toBe(false)
    expect(DRONE_ROLE_SPECS.sentry.dmgShare).toEqual([6, 7.5])
  })
})
