/**
 * 敌舰显示名（2026-09-09 船长拍板：同一悬赏内规格/属性不同的敌舰名字不同——
 * 舰种名（战术×血型 9 类）为满规格主体名，弱规格单位加「轻装」词缀；
 * 名字由异常属性 × 单位 tag 推导，引擎建档与界面显示同源）。
 */
import { describe, expect, it } from 'vitest'
import { createFoeSpecs, foeClassName, foeMainTagOf, foeUnitNameOf } from '../src/combat'
import { anomaly, makeTestCtx } from './helpers'

const bal = makeTestCtx().balance.battle

function ano(opts: { tactic?: 'brawl' | 'orbit' | 'kite'; defProfile?: 'shield' | 'armor' | 'balanced'; escorts?: number; waves?: { units: number; hpShare: number }[] }): ReturnType<typeof anomaly> {
  return { ...anomaly('ano-n', 'g', { threat: 10, tactic: opts.tactic }), defProfile: opts.defProfile ?? 'balanced', escorts: opts.escorts, waves: opts.waves }
}

describe('敌舰显示名（2026-09-09）', () => {
  it('舰种名 = 战术 × 血型（9 类）；无规格差时主舰用本名', () => {
    expect(foeClassName('brawl', 'shield')).toBe('突击护卫舰')
    expect(foeClassName('brawl', 'armor')).toBe('攻坚重甲舰')
    expect(foeClassName('orbit', 'balanced')).toBe('环绕护航舰')
    expect(foeClassName('kite', 'shield')).toBe('狙击护卫舰')
    // 单波无 escorts：唯一主舰 = 舰种名（原行为不变）
    const specs = createFoeSpecs(ano({ tactic: 'brawl', defProfile: 'armor' }), bal)
    expect(specs).toHaveLength(1)
    expect(specs[0]!.name).toBe('攻坚重甲舰')
  })

  it('僚机（份额 ×0.6）= 轻装 + 舰种名（替代旧「·僚机」字样）', () => {
    const specs = createFoeSpecs(ano({ tactic: 'kite', defProfile: 'shield', escorts: 1 }), bal)
    expect(specs.map((s) => s.name)).toEqual(['狙击护卫舰', '轻装狙击护卫舰'])
    expect(foeMainTagOf('foe-0')).toBe(true)
    expect(foeMainTagOf('foe-1')).toBe(false)
  })

  it('多波主舰按所在波血档判定：hpShare ≤ 同卡最强波 ×0.6 → 轻装；接近档不加词', () => {
    // 明显低血波（0.4 vs 最强 1.0）→ 轻装（引擎逐波展开：首波 tagPrefix ''，次波 w1-）
    const def = ano({ tactic: 'brawl', defProfile: 'armor', waves: [{ units: 1, hpShare: 1 }, { units: 1, hpShare: 0.4 }] })
    const wave0 = createFoeSpecs(def, bal, { units: 1, hpShare: 1 })
    const wave1 = createFoeSpecs(def, bal, { units: 1, hpShare: 0.4, tagPrefix: 'w1-' })
    expect(wave0[0]!.name).toBe('攻坚重甲舰') // 首波主舰
    expect(wave1[0]!.name).toBe('轻装攻坚重甲舰')
    // 穹顶型（0.35/0.35/0.3，末波比值 0.857）——差异不足以叫"不同属性"，不加词（2026-09-09 船长现场）
    const vdef = ano({ tactic: 'orbit', defProfile: 'armor', waves: [{ units: 2, hpShare: 0.35 }, { units: 2, hpShare: 0.35 }, { units: 1, hpShare: 0.3 }] })
    const w0 = createFoeSpecs(vdef, bal, { units: 2, hpShare: 0.35 })
    const w1 = createFoeSpecs(vdef, bal, { units: 2, hpShare: 0.35, tagPrefix: 'w1-' })
    const w2 = createFoeSpecs(vdef, bal, { units: 1, hpShare: 0.3, tagPrefix: 'w2-' })
    for (const s of [...w0, ...w1, ...w2]) if (foeMainTagOf(s.tag)) expect(s.name).toBe('装甲巡逻舰')
  })

  it('多小队（units≥2）+ escorts + 后续波：主舰本名、各队僚机一律轻装', () => {
    const def = ano({
      tactic: 'orbit',
      defProfile: 'shield',
      escorts: 1,
      waves: [{ units: 2, hpShare: 0.5 }, { units: 1, hpShare: 0.5 }],
    })
    const w0 = createFoeSpecs(def, bal, { units: 2, hpShare: 0.5 })
    const w1 = createFoeSpecs(def, bal, { units: 1, hpShare: 0.5, tagPrefix: 'w1-' })
    const nameOf = Object.fromEntries([...w0, ...w1].map((s) => [s.tag, s.name]))
    expect(nameOf['foe-0']).toBe('巡逻护卫舰')
    expect(nameOf['foe-1']).toBe('轻装巡逻护卫舰')
    expect(nameOf['w0-foe-1']).toBe('巡逻护卫舰')
    expect(nameOf['w0-foe-1-e1']).toBe('轻装巡逻护卫舰')
    expect(nameOf['w1-foe-0']).toBe('巡逻护卫舰') // 血档比 0.5/0.5 = 1 → 不加词
    expect(nameOf['w1-foe-0-e1']).toBe('轻装巡逻护卫舰')
  })

  it('单位名随建档透传（unit.name = 显示名；界面按 tag 实时推导同一名字）', () => {
    const def = ano({ tactic: 'kite', defProfile: 'armor', escorts: 2 })
    const specs = createFoeSpecs(def, bal)
    expect(specs.find((s) => s.tag === 'foe-2')!.name).toBe('轻装远程装甲舰')
    // 推导函数与建档名一致（界面读档重推导用）
    expect(foeUnitNameOf(def, 'foe-2')).toBe('轻装远程装甲舰')
    expect(foeUnitNameOf(def, 'foe-0')).toBe('远程装甲舰')
  })
})
