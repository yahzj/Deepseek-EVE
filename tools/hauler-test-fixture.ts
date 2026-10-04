/**
 * 货舰验收夹具：由make-test-save的hauler分支在全新初始档上调用，不读写个人档。
 * 版本自检：游戏版本 v0.1.0 · 存档结构 v31 · 最后核对 2026-10-04 · 最后跑过 2026-10-04。
 */
import { buildSimContext } from '@whale/data'
import { addShipToFleet, FIRST_TASKS, fitModule, repairDeprecatedModules } from '@whale/core'
import type { GameState } from '@whale/core'

export function injectHaulerTestState(s: GameState): string[] {
  const ctx = buildSimContext()
  s.modeChosen = true
  s.wallet.isk = 500_000_000
  s.standings.dsi = 60
  s.standingsEarned = { dsi: 60 }
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  for (const task of FIRST_TASKS) s.importantTasks[task.id] = { done: true }
  s.commsDelivered ??= {}
  s.commsRead ??= {}
  for (const msg of ctx.commsMessages.values()) {
    s.commsDelivered[msg.id] = 0
    s.commsRead[msg.id] = true
  }
  s.commsPopups = []
  for (const id of ['navigation', 'warp-drive-operation', 'acceleration-control', 'spaceship-command', 'hauler-ops', 'hold-management', 'deep-space-logistics']) s.skills.trained[id] = 3
  for (const mod of ctx.modules.values()) s.moduleBay[mod.id] = 10
  for (const item of ctx.items.values()) {
    if (item.kind === 'ammo' || item.kind === 'kit' || item.kind === 'drone') s.warehouse.items[item.id] = 1000
  }
  for (const id of ['sh-flyingfish', 'sh-sailfish', 'sh-manatee', 'sh-swordfish', 'sh-bowhead', 'sh-hawksbill', 'sh-nautilus']) {
    const uid = addShipToFleet(s, id)
    if (id === 'sh-manatee') s.shipId = uid
  }
  s.learnedRecipes = [...new Set([...s.learnedRecipes, 'sbp-manatee'])]
  s.blueprintStock['sbp-once-manatee'] = 2
  for (const m of ctx.shipBlueprints.get('sbp-manatee')!.materials) s.warehouse.items[m.itemId] = m.count * 3
  repairDeprecatedModules(s, ctx)
  for (const id of ['mod-salvager-2', 'mod-shield-ext-2', 'mod-shield-kin-2', 'mod-hullrep-2', 'mod-cargo-2', 'mod-dc-2']) {
    const r = fitModule(s, id, ctx)
    if (!r.ok) throw new Error(`${id}: ${r.error}`)
  }
  return ['海牛驾驶与七型舰船对照、备件与制造材料齐备；普通模式、首次任务完成、通讯已读。']
}
