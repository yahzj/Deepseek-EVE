import { developmentFixture } from './development-fixture'
import { StageTwoSession } from './StageTwoSession'
import { manufacturingRecipe } from './manufacturing-baseline'

/** 所有筹备通过原模块命令完成；舰船仅为独立预览合成输入。 */
export function stageTwoFixture() {
  const base = developmentFixture()
  const check = (result: { ok: boolean; reason?: string }) => { if (!result.ok) throw new Error(`第二阶段夹具失败：${result.reason}`) }
  check(base.developmentCommand({ kind: 'expand' })); base.advance(240)
  check(base.developmentCommand({ kind: 'power-upgrade', cellIndex: 0 })); base.advance(60)
  check(base.developmentCommand({ kind: 'life-upgrade', cellIndex: 1 })); base.advance(90)
  for (const [facility, cellIndex, minutes] of [['manufacturing', 9, 90], ['training', 10, 90], ['warning', 11, 60]] as const) {
    check(base.command({ kind: 'build', facility, cellIndex })); base.advance(minutes)
  }
  base.setInventory('ore-veldspar', 100)
  check(base.refiningCommand({ kind: 'assign', cellIndex: 3, personIndex: 3, itemId: 'ore-veldspar' })); base.advance(1)
  check(base.refiningCommand({ kind: 'stop', cellIndex: 3 }))
  const recipe = manufacturingRecipe('bp-part-circuit', 0)!
  for (const [id, n] of Object.entries(recipe.input)) base.setInventory(id, Math.max(base.host.available(id), n))
  check(base.manufacturingCommand({ kind: 'assign', cellIndex: 9, personIndex: 3, blueprintId: 'bp-part-circuit', batches: 1 })); base.advance(1)
  base.setInventory('ammo-kinetic-l', 5000)
  base.setInventory('repairkit-civ', 40)
  base.setInventory('repairkit-mil', 20)
  return new StageTwoSession(base)
}
