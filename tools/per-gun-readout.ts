/** 逐炮分布/名义守恒与势力小船命中读数，只造合成状态、不改平衡。
 * 用法：npx tsx tools/per-gun-readout.ts；输出tools/_ui-artifacts/per-gun-readout-20261005.json。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-05 · 最后跑过2026-10-05。
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState, createPlayerSpec, installPlug } from '@whale/core'
import { hitChance } from '../packages/core/src/combatMath'
import { volleyDamageShareOf } from '../packages/core/src/combatVolley'

const ctx = buildSimContext()
const rows: object[] = []
for (const def of [...ctx.ships.values()].filter((s) => s.id.startsWith('sh-wh-') && s.tier <= 2)) {
  for (const trained of [false, true]) for (const plates of [false, true]) {
    const state = createInitialState({ nowWallMs: 0, seed: 105 })
    const uid = addShipToFleet(state, def.id)
    state.shipId = uid
    if (trained) for (const id of ctx.skills.keys()) state.skills.trained[id] = 5
    if (plates) for (const id of ['plug-shield-plate', 'plug-armor-plate', 'plug-hull-plate']) {
      state.moduleBay[id] = 1
      assert(installPlug(state, ctx, id, uid).ok)
    }
    const spec = createPlayerSpec(state, ctx, uid)!
    const near = { hitRate: 0.85, minRangeM: 0, maxRangeM: 10000, falloff: 1 }
    rows.push({ id: def.id, name: def.name, tier: def.tier, trained, plates,
      totalHp: spec.hp.s + spec.hp.a + spec.hp.h, evasion: spec.evasion, plugSlots: def.plugSlots,
      enemy85Hit: hitChance(near, { hitBonus: 0 }, spec, 5000, ctx.balance.battle),
      enemy125Hit: hitChance({ ...near, hitRate: 1.25 }, { hitBonus: 0 }, spec, 5000, ctx.balance.battle),
      enemy125FarHit: hitChance({ ...near, hitRate: 1.25, falloff: 0.5 }, { hitBonus: 0 }, spec, 10000, ctx.balance.battle),
      laserHitUnchanged: 1 })
  }
}
const distribution = [1,4,8].map((count) => {
  const p = 0.5, total = 100
  const shares = Array.from({ length: count }, (_, i) => volleyDamageShareOf(total,count,i))
  assert.equal(shares.reduce((a,b) => a+b,0),total)
  return { count, total, hitChance: p, expectedDamage: total*p,
    variance: shares.reduce((v,d) => v + d*d*p*(1-p),0), allMiss: Math.pow(1-p,count), allHit: Math.pow(p,count) }
})
const path = resolve('tools/_ui-artifacts/per-gun-readout-20261005.json')
mkdirSync(resolve('tools/_ui-artifacts'), { recursive: true })
writeFileSync(path,JSON.stringify({ rows,distribution, note:'固定近远端命中数学读数，不代表整场胜率；光束当前无视闪避。' },null,2),'utf8')
console.log(JSON.stringify({ path, rows, distribution },null,2))
