/** 小船曲线隔离worker，由small-ship-preview.ts打包并注入曲线；不可独立冒称正式平衡。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-05。
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  addShipToFleet, adjustDroneLoad, cpuBudgetOf, createInitialState,
  droneCpuUsed, droneLoadM3, fitModule, fittedCpuUsed, installPlug, shipSlotsWithPlugsOf,
} from '@whale/core'
import type { GameState } from '@whale/core'
import { buildSimContext } from '@whale/data'
import { advanceBattleFor, stampFoeArrivalFx, startFleetBattleFor } from '../packages/core/src/combat'
import { hitChance } from '../packages/core/src/combatMath'
import { droneBayTotalM3 } from '../packages/core/src/equipment'
import { wormholeAdmission } from '../packages/core/src/wormhole'
import type { PreviewCurve } from './small-ship-curves'

declare const __PREVIEW_CURVE__: PreviewCurve
const curve = __PREVIEW_CURVE__
const ctx = buildSimContext()
const quick = process.argv.includes('--quick')
const focus = process.argv.includes('--focus')
const seedIndex = process.argv.indexOf('--seeds')
const seedCount = seedIndex < 0 ? (quick ? 2 : 5) : Number(process.argv[seedIndex + 1])
assert(Number.isInteger(seedCount) && seedCount > 0 && seedCount <= 20)
const seeds = Array.from({ length: seedCount }, (_, i) => 105 + i * 73)
const plates = ['plug-shield-plate', 'plug-armor-plate', 'plug-hull-plate']
const supportShips = [...ctx.ships.values()].filter((s) => s.id.startsWith('sh-wh-'))
const candidates = focus ? supportShips.filter((s) => ['sh-wh-a-frigate','sh-wh-c-frigate','sh-wh-d-destroyer','sh-wh-g-destroyer'].includes(s.id))
  : quick ? supportShips.filter((s) => ['sh-wh-a-frigate', 'sh-wh-d-destroyer', 'sh-wh-e-carrier'].includes(s.id)) : supportShips
const targets = [
  { id: 'wh-pirate-warband', depth: 2, family: 'A' },
  { id: 'wh-alien-hive', depth: 2, family: 'C' },
  { id: 'wh-grave-throne', depth: 2, family: 'D' },
  { id: 'wh-titan-hulk', depth: 2, family: 'E' },
  { id: 'wh-exile-line', depth: 2, family: 'G' },
  { id: 'ink-harass', depth: 0, family: 'H' },
  { id: 'ink-raid', depth: 0, family: 'H' },
  { id: 'ink-main', depth: 0, family: 'H' },
  { id: 'corona-drift', depth: 0, family: 'R' },
  { id: 'corona-split', depth: 0, family: 'R' },
  { id: 'wh-pirate-warband', depth: 5, family: 'A' },
  { id: 'wh-alien-hive', depth: 5, family: 'C' },
  { id: 'wh-grave-throne', depth: 5, family: 'D' },
  { id: 'wh-titan-hulk', depth: 5, family: 'E' },
  { id: 'wh-exile-line', depth: 5, family: 'G' },
  { id: 'wh-pirate-warband', depth: 8, family: 'A' },
  { id: 'wh-grave-throne', depth: 8, family: 'D' },
  { id: 'wh-exile-line', depth: 8, family: 'G' },
]
const scenarios = focus ? targets.filter((s) => s.id==='ink-main'||s.depth===8&&['A','D'].includes(s.family))
  : quick ? targets.filter((s) => ['wh-pirate-warband','wh-grave-throne','ink-raid'].includes(s.id) && s.depth <= 2) : targets

function addLoadout(state: GameState, id: string, withPlates: boolean) {
  const uid = addShipToFleet(state, id), def = ctx.ships.get(id)!
  if (withPlates) for (const plate of plates) {
    state.moduleBay[plate] = (state.moduleBay[plate] ?? 0) + 1
    const result = installPlug(state, ctx, plate, uid)
    assert(result.ok, result.ok ? '' : result.error)
  }
  const chosen: string[] = []
  const rejected: string[] = []
  function fit(id: string) {
    state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
    const result = fitModule(state, id, ctx, { shipId: uid })
    if (result.ok) chosen.push(id)
    else rejected.push(id + ': ' + result.error)
    return result.ok
  }
  // 所有场景同配装；后勤先留工位，机巢型先留舰载机位，防御优先再补输出。
  fit('mod-prop-2')
  fit('mod-shield-kin-2')
  if (def.repairPulseTargetsFleet) fit('mod-hullrep-2')
  fit('mod-shield-pla-2')
  fit('mod-shield-exp-2')
  fit('mod-armor-kin-2')
  fit('mod-armor-pla-2')
  fit('mod-armor-exp-2')
  if ((def.droneBayM3 ?? 0) >= 100) {
    fit('mod-drone-tac-2')
    fit('mod-drone-relay-2')
  }
  const maxGuns = (def.slots?.high ?? 0) - chosen.filter((id) => ctx.modules.get(id)!.rack === 'high').length
  for (let i = 0; i < maxGuns; i++) if (!fit('mod-missile-2')) break
  const droneId = (def.droneBayM3 ?? 0) >= 100 ? 'drone-heavy' : 'drone-assault'
  state.warehouse.items[droneId] = 10000
  for (let i = 0; i < 20; i++) if (!adjustDroneLoad(state, ctx, droneId, 1, uid).ok) break
  const fleet = state.fleet[uid]!, slots = shipSlotsWithPlugsOf(state, ctx, uid)
  assert(fleet.fitted.high.length <= slots.high && fleet.fitted.mid.length <= slots.mid && fleet.fitted.low.length <= slots.low)
  const cpuUsed = fittedCpuUsed(fleet.fitted,ctx,def) + droneCpuUsed(fleet.droneLoad,ctx) + (fleet.plugs ?? []).reduce((n,id)=>n+(ctx.modules.get(id)?.cpuUse??0),0)
  assert(cpuUsed <= cpuBudgetOf(state,ctx,uid))
  assert(droneLoadM3(fleet.droneLoad,ctx) <= droneBayTotalM3(def,fleet.fitted,ctx))
  const hullValue = ctx.marketGoods.get(id)?.basePrice ?? def.priceIsk
  const moduleValue = chosen.reduce((n,id)=>n+(ctx.marketGoods.get(id)?.basePrice??0),0)
  const droneValue = Object.entries(fleet.droneLoad ?? {}).reduce((n,[id,q])=>n+(ctx.marketGoods.get(id)?.basePrice??0)*q,0)
  // 插件生产以一枚黑匣为主料；这里只报告通用黑匣参照值，不冒称交易或实际完整BOM成本。
  const plugBlackboxReference = (fleet.plugs?.length ?? 0) * (ctx.marketGoods.get('blackbox-universal')?.basePrice ?? 0)
  return { uid, id, name:def.name, modules:chosen, rejected, drones:fleet.droneLoad ?? {}, cpuUsed,
    cpuCap:cpuBudgetOf(state,ctx,uid), hullValue, moduleValue, droneValue, plugBlackboxReference }
}
function prepare(candidate: string, level: number, withPlates: boolean, seed: number) {
  const state = createInitialState({ nowWallMs: 1791180000000, seed })
  state.debugQuick = false
  state.wallet.isk = 1e12
  state.standingsEarned = { dsi:200 }
  for (const id of ctx.skills.keys()) state.skills.trained[id] = level
  const loadouts = Array.from({ length:3 },()=>addLoadout(state,'sh-thresher',true))
  loadouts.push(addLoadout(state,candidate,withPlates))
  const ids = loadouts.map((l)=>l.uid)
  state.shipId = ids[0]!
  for (const id of ['ammo-kinetic-l','ammo-plasma-l','ammo-explosive-l','repairkit-mil']) state.warehouse.items[id] = 1000000
  const admission = wormholeAdmission(ctx,ids)
  assert(admission.ok)
  return { state, ids, loadouts, admission }
}

const mathRows: object[]=[]
for (const aim of [0,0.5,0.85,1,1.25,1.6,2]) for (const evasion of [0,0.1,0.316,0.5,0.8,0.9]) for (const df of [0.5,0.75,1]) {
  const p = hitChance({hitRate:aim,minRangeM:0,maxRangeM:1000,falloff:df},{hitBonus:0},{evasion},1000,ctx.balance.battle)
  assert(Number.isFinite(p)&&p>=0&&p<=1)
  mathRows.push({aim,evasion,df,p})
}
const cells: any[]=[]
const configs = ['sh-thresher',...candidates.map((s)=>s.id)]
const skills = quick ? [3] : [3,5]
for (const level of skills) for (const candidate of configs) for (const withPlates of focus ? [true] : [false,true]) for (const target of scenarios) {
  const results: any[]=[]
  let loadouts: ReturnType<typeof addLoadout>[] = [], admission: ReturnType<typeof wormholeAdmission> | undefined
  for (const seed of seeds) {
    const prepared = prepare(candidate,level,withPlates,seed)
    const {state,ids} = prepared
    loadouts=prepared.loadouts;admission=prepared.admission
    const candidateDef = ctx.ships.get(candidate)!
    const marks = target.depth ? {depth:target.depth,kind:'node' as const,waves:1} : undefined
    const battle = startFleetBattleFor(state,ctx,ids,target.id,0,null,marks)!
    assert(battle,'无法建立战斗 '+target.id)
    if(marks)stampFoeArrivalFx(battle)
    const tag='ally-3', initial = battle.units[tag]!.hpMax!
    const beforeAmmo = {...battle.ammo}
    let firstFire: number | null = null, deadAt: number | null=null, damage=0, suppressedMs=0, supportMs=0, weightedDistance=0, ticks=0
    for (let at=100;at<=ctx.balance.battle.maxBattleMs+100;at+=100) {
      const seq = battle.fxSeq
      state.gameMs=at
      advanceBattleFor(state,ctx,battle,ids[0]!,target.id)
      const events=battle.fx.filter((fx)=>fx.seq>=seq&&fx.side==='me'&&fx.tag===tag&&!fx.web&&!fx.blink&&!fx.droneDown)
      for (const event of events) { if(firstFire===null)firstFire=at;damage+=event.dmg??0 }
      const hp = battle.units[tag]!.hp
      if(deadAt===null&&hp.s+hp.a+hp.h<=0)deadAt=at
      if(hp.s+hp.a+hp.h>0) {
        if((candidateDef.foeRangeDebuffPct??0)>0)suppressedMs+=100
        if(candidateDef.fleetDamageBonusPct||candidateDef.repairPulseTargetsFleet)supportMs+=100
      }
      weightedDistance+=battle.distanceM;ticks++
      if(battle.ended)break
    }
    assert(battle.ended)
    const at=battle.lastTickGameMs-battle.startedAtGameMs
    const losses=Object.values(battle.units).filter((u)=>u.side==='me'&&u.hp.s+u.hp.a+u.hp.h<=0).length
    const rest=battle.units[tag]!.hp
    results.push({seed,win:battle.ended==='me',seconds:at/1000,losses,candidateDead:deadAt!==null,
      candidateSurvivalSeconds:(deadAt??at)/1000,firstFireSeconds:firstFire===null?null:firstFire/1000,
      candidateAliveShare:(deadAt??at)/Math.max(1,at),
      candidateDamage:damage,candidateHpFraction:(rest.s+rest.a+rest.h)/(initial.s+initial.a+initial.h),
      rangeSuppressionSeconds:suppressedMs/1000,supportEligibleSeconds:supportMs/1000,
      averageDistance:weightedDistance/Math.max(1,ticks),ammoUsed:Object.keys(beforeAmmo).reduce((n,key)=>n+beforeAmmo[key as keyof typeof beforeAmmo]-battle.ammo[key as keyof typeof beforeAmmo],0),
      dronesLost:Object.values(battle.droneLost ?? {}).reduce((n,q)=>n+q,0)})
  }
  const avg=(key:string)=>results.reduce((n,r)=>n+Number(r[key]),0)/results.length
  cells.push({curve,candidate,name:ctx.ships.get(candidate)!.name,tier:ctx.ships.get(candidate)!.tier,level,withPlates,target,
    budget:{hull:loadouts.reduce((n,l)=>n+l.hullValue,0),modules:loadouts.reduce((n,l)=>n+l.moduleValue,0),drones:loadouts.reduce((n,l)=>n+l.droneValue,0),plugBlackboxReference:loadouts.reduce((n,l)=>n+l.plugBlackboxReference,0)},
    admission,loadouts,summary:{winRate:avg('win'),candidateDeathRate:avg('candidateDead'),candidateSurvivalSeconds:avg('candidateSurvivalSeconds'),candidateAliveShare:avg('candidateAliveShare'),candidateHpFraction:avg('candidateHpFraction'),candidateDamage:avg('candidateDamage'),fleetLosses:avg('losses'),seconds:avg('seconds'),rangeSuppressionSeconds:avg('rangeSuppressionSeconds'),supportEligibleSeconds:avg('supportEligibleSeconds'),ammoUsed:avg('ammoUsed'),dronesLost:avg('dronesLost'),averageDistance:avg('averageDistance')},results})
  if(cells.length%24===0)console.log(curve+'完成'+cells.length+'组，每组'+seedCount+'种子')
}
const out=resolve('tools/_ui-artifacts/small-ship-preview')
mkdirSync(out,{recursive:true})
writeFileSync(resolve(out,`report-${curve}${focus?'-focus':quick?'-quick':''}.json`),JSON.stringify({curve,quick,focus,seeds,mathRows,cells,note:'仅合成配装战斗预演，不代表新档养成、完整虫洞趟或相同总价。光束必中与基础血量保持。'},null,2),'utf8')
console.log(JSON.stringify({curve,ok:true,cells:cells.length,seeds:seedCount,battles:cells.length*seedCount}))
