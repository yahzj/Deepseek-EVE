import { describe, expect, it } from 'vitest'
import { buildSimContext, factionOfExclusive, L10N } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { fitModule, stackWeight, stackingOf, repairDeprecatedModules } from '../src/equipment'
import { createPlayerSpec, startBattleFor, advanceBattleFor, applyDcGuard, createBattleState, DC_LOCK_MS, battleArcsFor } from '../src/combat'
import { applyDamage } from '../src/combatMath'
import { advancePlayerRebirth, crisisEffectsOf, noteRailAttack, playerGravekeeperSpecOf, syncPlayerCrisis } from '../src/gravekeeperGear'
import { serializeSaveFile, loadSaveFile } from '../src/save'
import { cleanBattle } from '../src/saveBattleClean'
import { recycleProfileOf } from '../src/salvage'
import { rollRareBoxExtra } from '../src/salvage'
import { battleDeviceCyclesOf } from '../src/battleDeviceView'
import { pulseShieldFieldFor, SHIELD_FIELD_COST_PCT } from '../src/combatRepair'
import { injectGravekeeperGearFixture } from '../../../tools/gravekeeper-gear-fixture'
import type { SimContext } from '../src/types'

const ctx = buildSimContext()
const ids = ['mod-gravekeeper-rebirth', 'mod-gravekeeper-crisis', 'mod-gravekeeper-rail'] as const
function world(high: string[] = [ids[2]], mid: string[] = [], low: string[] = []) {
  const state = createInitialState({ nowWallMs: Date.now(), seed: 11 })
  const sid = addShipToFleet(state, 'sh-megalodon'); state.shipId = sid
  state.fleet[sid]!.fitted = { high, mid, low }
  state.warehouse.items['ammo-kinetic-l'] = 100000
  state.warehouse.items['ammo-plasma-l'] = 100000
  state.warehouse.items['repairkit-dc'] = 10
  return { state, sid }
}
function one(mid: string[] = [], low: string[] = []) {
  const { state, sid } = world([ids[2]], mid, low)
  const spec = createPlayerSpec(state, ctx, sid)!
  const foe = { ...spec, tag: 'foe-0', side: 'foe' as const, rebirthRepair: undefined }
  const battle = createBattleState(spec, [foe], 1000, 3000)
  battle.distanceM = 3000
  return { state, sid, spec, battle, rt: battle.units.player! }
}
function shooting(miss = false, copies = 1) {
  const { state, sid } = world(Array(copies).fill(ids[2]))
  const card = { ...ctx.anomalies.get('ano-training')!, id: 'rail-target', ships: undefined, waves: undefined,
    foeHpOverride: 1e9, foeShotDmg: 0, threat: 20, tactic: 'orbit' as const, foeSpeedMps: 0, foeHpSplit: { s: 0, a: 0, h: 1 } }
  const use: SimContext = { ...ctx, anomalies: new Map(ctx.anomalies).set(card.id, card),
    balance: { ...ctx.balance, battle: { ...ctx.balance.battle, hitMin: miss ? 0 : 1, hitMax: miss ? 0 : 1, shieldRegenPerSec: 0 } } }
  const b = startBattleFor(state, use, sid, card.id, 0, 1000)!
  for (const u of Object.values(b.units)) { delete u.enteredAtMs; u.weapons.fill(u.side === 'me' ? 0 : 1e9) }
  b.ammo = { kin: 1000, exp: 0, pla: 0 }
  b.distanceM = 1000; b.myDesireM = 1000
  return { state, sid, card, use, b }
}

describe('守墓三件目录与获取', () => {
  it('合成验收档两舰实际可放飞/开火，配装合法且保存后无人机不丢型号', () => {
    const state=createInitialState({nowWallMs:0})
    injectGravekeeperGearFixture(state)
    const back=loadSaveFile(serializeSaveFile(state)).state
    const carrier=Object.keys(back.fleet).find(sid=>back.fleet[sid]!.defId==='sh-wh-e-carrier')!
    expect(createPlayerSpec(back,ctx,carrier)!.weapons.filter(w=>w.src==='drone')).toHaveLength(8)
    const weapons=createPlayerSpec(back,ctx,back.shipId)!.weapons
    expect(weapons.find(w=>w.railCharge)!.count).toBe(4)
  })
  it('槽位、CPU、唯一与掉落隔离，市场只收不卖、不进黑市', () => {
    expect(ids.map(id => ctx.modules.get(id)!.rack)).toEqual(['low', 'mid', 'high'])
    expect(ids.map(id => ctx.modules.get(id)!.cpuUse)).toEqual([46,40,62])
    expect(recycleProfileOf(ctx, 'wreck-rare-d-inv')!.lairGear).toEqual(ids)
    expect(recycleProfileOf(ctx, 'wreck-rare-d-lo')!.lairGear).not.toContain(ids[0])
    expect(recycleProfileOf(ctx, 'wreck-d-inv')!.lairGear).toBeUndefined()
    for (const id of ids) {
      expect(factionOfExclusive(id)).toBe('D')
      const good = ctx.marketGoods.get(id)!
      expect(good.playerBuyable).toBe(false)
      expect(good.blackMarketBuyable).toBe(false)
      expect(good.basePrice).toBe(10000000)
      expect(good.demandMultiplier).toBe(.25)
      expect([...ctx.blueprints.values()].some(bp => bp.moduleId === id)).toBe(false)
    }
  })
  it('苏生共用普通损管数量上限，装配拒绝第二件，旧非法装配只保留一件', () => {
    const {state,sid}=world([],[],['mod-dc-3'])
    state.moduleBay[ids[0]]=1
    expect(fitModule(state,ids[0],ctx,{shipId:sid,rack:'low'}).ok).toBe(false)
    state.fleet[sid]!.fitted.low=['mod-dc-3',ids[0]]
    repairDeprecatedModules(state,ctx)
    expect(state.fleet[sid]!.fitted.low.filter(id=>id && ctx.modules.get(id)?.unique)).toHaveLength(1)
  })
  it('中文与延期英文均可达，不改数值或擅自翻译', () => {
    const en=buildSimContext('en')
    for(const [i,id] of ids.entries()) {
      expect(en.modules.get(id)!.name).toBe(ctx.modules.get(id)!.name)
      expect(L10N[`mod.gravekeeperGear.${String(i*2+1).padStart(3,'0')}`]!.enDeferred).toBe(true)
    }
  })
  it('真实开箱只抽守墓入侵三件，未集齐时不重复，旧D池保持原件', () => {
    const {state}=world([])
    state.moduleBay={}
    const profile=recycleProfileOf(ctx,'wreck-rare-d-inv')!
    const seen=new Set<string>()
    for(let n=0;n<1000 && seen.size<3;n++) {
      const result=rollRareBoxExtra(state,ctx,profile)
      for(const id of result?.modules ?? []) if(ids.includes(id as typeof ids[number])) {
        expect(seen.has(id)).toBe(false)
        seen.add(id);state.moduleBay[id]=1
      }
    }
    expect([...seen].sort()).toEqual([...ids].sort())
    expect(recycleProfileOf(ctx,'wreck-rare-d-wh')!.lairGear).toEqual(['mod-lair-shield-d','mod-lair-turret-d','mod-lair-armor-d'])
  })
})

describe('玩家苏生', () => {
  it('同型副船从自身货仓消耗组件，不误扣第一艘同型舰', () => {
    const {state,sid}=world([])
    const second=addShipToFleet(state,'sh-megalodon')
    state.fleet[second]!.fitted.low=[ids[0]]
    state.fleet[sid]!.cargo['repairkit-dc']=2
    state.fleet[second]!.cargo['repairkit-dc']=1
    state.resupplyFromWarehouse=false
    const spec=createPlayerSpec(state,ctx,second)!
    spec.tag='ally-1'
    const b=createBattleState(spec,[],0,1000)
    applyDcGuard(state,b,spec.tag,spec,{s:0,a:0,h:10},1000,'plasma')
    expect(b.meRebirths![spec.tag]).toBeDefined()
    expect(state.fleet[sid]!.cargo['repairkit-dc']).toBe(2)
    expect(state.fleet[second]!.cargo['repairkit-dc']??0).toBe(0)
  })
  it('消耗组件、1秒结构底线、5秒总维修各50%，严格到期且不额外加抗', () => {
    const {state,spec,battle:b,rt}=one([], [ids[0]])
    rt.hp={s:0,a:0,h:10}
    const raw=applyDcGuard(state,b,'player',spec,rt.hp,10000,'plasma')
    rt.hp=applyDamage(rt.hp,spec.resists,raw,'plasma').hp
    expect(rt.hp.h).toBeCloseTo(1,5)
    expect(state.warehouse.items['repairkit-dc']).toBe(9)
    expect(b.dc!.player!.lockUntilMs).toBe(1000+DC_LOCK_MS)
    b.lastTickGameMs=1999
    const guard=applyDcGuard(state,b,'player',spec,rt.hp,10000,'plasma')
    expect(applyDamage(rt.hp,spec.resists,guard,'plasma').hp.h).toBeCloseTo(1,5)
    advancePlayerRebirth(b,spec,6000)
    expect(b.meRebirths!.player!.armorHealed).toBeCloseTo(spec.hp.a*.5)
    expect(b.meRebirths!.player!.hullHealed).toBeCloseTo(spec.hp.h*.5)
    expect(rt.hp.s).toBe(0)
    b.lastTickGameMs=6000
    expect(applyDcGuard(state,b,'player',spec,rt.hp,1e9,'plasma')).toBe(1e9)
    expect(ctx.modules.get(ids[0])!.hullResistAdd).toBeUndefined()
  })
  it('缺组件不触发；维修不复活死舰、满层溢出不追回', () => {
    const {state,spec,battle:b,rt}=one([], [ids[0]])
    state.warehouse.items['repairkit-dc']=0
    expect(applyDcGuard(state,b,'player',spec,{s:0,a:0,h:10},1e9,'plasma')).toBe(1e9)
    expect(b.meRebirths).toBeUndefined()
    state.warehouse.items['repairkit-dc']=1
    applyDcGuard(state,b,'player',spec,{s:0,a:0,h:10},1e9,'plasma')
    advancePlayerRebirth(b,spec,6000)
    rt.hp={s:0,a:0,h:1};advancePlayerRebirth(b,spec,7000)
    expect(rt.hp.a).toBe(0)
    rt.hp.h=0;advancePlayerRebirth(b,spec,8000)
    expect(rt.hp.h).toBe(0)
  })
  it('真实敌方攻击触发苏生，下一拍持续维修，长步与分片维修一致', () => {
    const {state,sid,card,use}=shooting()
    state.fleet[sid]!.fitted.low=[ids[0]]
    const foe={...ctx.foeShips!.get('foe-d-longship')!,hp:1e8,shotDmg:10000,reloadMs:100,rangeMinM:1,rangeMaxM:20000}
    const target={...card,ships:[{ship:foe}],foeHpOverride:undefined}
    const context={...use,anomalies:new Map(use.anomalies).set(card.id,target)}
    const battle=startBattleFor(state,context,sid,card.id,0,1000)!
    for(const rt of Object.values(battle.units)) {delete rt.enteredAtMs;rt.weapons.fill(rt.side==='me'?1e9:0)}
    battle.units.player!.hp={s:0,a:0,h:10}
    battle.distanceM=1000;battle.myDesireM=1000
    for(let t=10;t<=200 && !battle.meRebirths;t+=10) {state.gameMs=t;advanceBattleFor(state,context,battle,sid,card.id)}
    expect(battle.meRebirths!.player).toBeDefined()
    expect(battle.dcKitsUsed).toBe(1)
    expect(battle.ended).toBe(null)
    for(const rt of Object.values(battle.units))rt.weapons.fill(1e9)
    const a=structuredClone(battle),c=structuredClone(battle)
    const spec=createPlayerSpec(state,context,sid)!
    const start=a.meRebirths!.player!.lastRepairAtMs
    for(let t=start+10;t<=start+5000;t+=10)advancePlayerRebirth(a,spec,t)
    advancePlayerRebirth(c,spec,start+5000)
    expect(a.units.player!.hp.a).toBeCloseTo(c.units.player!.hp.a,7)
    expect(a.units.player!.hp.h).toBeCloseTo(c.units.player!.hp.h,7)
  })
})

describe('危机超载', () => {
  it('未装新件的动态规格与原对象一致，普通损管不生成苏生/危机/蓄能状态', () => {
    const {state,sid}=world(['mod-turret-kin-3'],[],['mod-dc-3'])
    const spec=createPlayerSpec(state,ctx,sid)!
    const b=createBattleState(spec,[],0,1000)
    expect(playerGravekeeperSpecOf(b,spec)).toBe(spec)
    b.units.player!.hp.s=0
    syncPlayerCrisis(b,[spec])
    expect(b.meCrisisActive).toBeUndefined()
    expect(noteRailAttack(b,spec,0,2940)).toBe(2940)
    expect(b.meRailStacks).toBeUndefined()
    applyDcGuard(state,b,'player',spec,{s:0,a:0,h:10},1000,'plasma')
    expect(b.meRebirths).toBeUndefined()
  })
  it('护盾力场扣到空盾立即启用，即使同拍随后被队友回盾也不退出', () => {
    const {spec,battle:b,rt}=one([ids[1]])
    const ally={...spec,tag:'ally-1'}
    b.units[ally.tag]={...rt,tag:ally.tag,hp:{s:0,a:100,h:100},hpMax:{s:100,a:100,h:100},weapons:[1000]}
    rt.hp.s=rt.hpMax!.s*SHIELD_FIELD_COST_PCT
    pulseShieldFieldFor(b,[spec,ally],{pct:.1},spec)
    expect(rt.hp.s).toBe(0)
    expect(b.meCrisisActive!.player).toBe(true)
    rt.hp.s=100;syncPlayerCrisis(b,[spec])
    expect(b.meCrisisActive!.player).toBe(true)
  })
  it('同舰多件正负同权重，未空盾无效，回盾不退出，不污染基础规格', () => {
    const {state,sid}=world([ids[2],'mod-laser-3','mod-missile-3'],[ids[1],ids[1]])
    state.fleet[sid]!.droneLoad={'drone-scout':1}
    const spec=createPlayerSpec(state,ctx,sid)!
    const b=createBattleState(spec,[],1000,3000)
    const before=JSON.stringify(spec)
    const fx=crisisEffectsOf([ctx.modules.get(ids[1])!,ctx.modules.get(ids[1])!])!
    expect(fx.rangeMul).toBeCloseTo(1.4*(1+.4*stackWeight(2)))
    expect(fx.damageMul).toBeCloseTo(1.3*(1+.3*stackWeight(2)))
    expect(fx.speedMul).toBeCloseTo(.4*(1-.6*stackWeight(2)))
    expect(stackingOf(ctx.modules.get(ids[1])!).group).toBe('curve')
    syncPlayerCrisis(b,[spec]);expect(b.meCrisisActive).toBeUndefined()
    b.units.player!.hp.s=0;syncPlayerCrisis(b,[spec])
    const active=playerGravekeeperSpecOf(b,spec)
    expect(active.speedMps).toBeCloseTo(spec.speedMps*fx.speedMul)
    for(const [i,w] of spec.weapons.entries()) {
      const out=active.weapons[i]!
      if(w.src==='turret') expect(out.maxRangeM).toBe(Math.round(w.maxRangeM*fx.rangeMul))
      else expect(out.maxRangeM).toBe(w.maxRangeM)
      if(w.src==='drone') {
        expect(out.shotDmg).toBe(w.shotDmg)
        expect(out.reloadMs).toBe(Math.round(w.reloadMs*fx.droneCycleMul))
      }
    }
    b.units.player!.hp.s=spec.hp.s
    syncPlayerCrisis(b,[spec]);expect(b.meCrisisActive!.player).toBe(true)
    expect(JSON.stringify(spec)).toBe(before)
  })
  it('首次队列和初始计时只缩短一次，之后攻击周期走独立乘数，队友不受益', () => {
    const {spec,battle:b,rt}=one([ids[1]])
    spec.weapons=[{...spec.weapons[0]!,src:'drone',reloadMs:4400}]
    b.dronePools={'player:0':{s:1,a:1,h:1,alive:true,evasion:0,launched:false}}
    b.droneLaunchBy={player:{q:['player:0'],nextAtMs:500,gapMs:500,reviveGapMs:500}}
    rt.weapons=[4400];rt.hp.s=0
    syncPlayerCrisis(b,[spec]);expect(rt.weapons[0]).toBe(2200)
    expect(b.droneLaunchBy.player!.nextAtMs).toBe(250)
    expect(b.droneLaunchBy.player!.gapMs).toBe(250)
    expect(b.droneLaunchBy.player!.reviveGapMs).toBe(500)
    syncPlayerCrisis(b,[spec]);expect(rt.weapons[0]).toBe(2200)
    expect(playerGravekeeperSpecOf(b,spec).weapons[0]!.reloadMs).toBe(2640)
    expect(playerGravekeeperSpecOf(b,{...spec,tag:'ally-1'}).weapons[0]!.reloadMs).toBe(4400)
  })
  it('真实无人机首轮计时减半，成功出击后的攻击周期乘0.6而非单发增伤', () => {
    const {state,sid,card,use}=shooting()
    state.fleet[sid]!.fitted={high:[],mid:[ids[1]],low:[]}
    state.fleet[sid]!.droneLoad={'drone-scout':2}
    const fresh=startBattleFor(state,use,sid,card.id,0,1000)!
    fresh.distanceM=1000;fresh.myDesireM=1000
    for(const rt of Object.values(fresh.units)) {delete rt.enteredAtMs;if(rt.side==='foe')rt.weapons.fill(1e9)}
    const spec=createPlayerSpec(state,use,sid)!
    const index=spec.weapons.findIndex(w=>w.src==='drone')
    expect(index).toBeGreaterThanOrEqual(0)
    const initial=fresh.units.player!.weapons[index]!
    fresh.units.player!.hp.s=0
    state.gameMs=10;advanceBattleFor(state,use,fresh,sid,card.id)
    expect(fresh.units.player!.weapons[index]).toBeCloseTo(initial*.5-10)
    for(let t=20;t<=10000 && fresh.dronePools![`player:${index}`]!.launched===false;t+=10) {
      state.gameMs=t;advanceBattleFor(state,use,fresh,sid,card.id)
    }
    expect(fresh.dronePools![`player:${index}`]!.launched).toBe(true)
    expect(fresh.units.player!.weapons[index]).toBe(Math.round(spec.weapons[index]!.reloadMs*.6))
    const active=playerGravekeeperSpecOf(fresh,spec)
    expect(active.weapons[index]!.shotDmg).toBe(spec.weapons[index]!.shotDmg)
    expect(active.weapons[index]!.maxRangeM).toBe(spec.weapons[index]!.maxRangeM)
  })
})

describe('磁轨附伤与随档', () => {
  it('能量附伤独立吃装甲能量抗性，不继承动能主段层克制和实收折扣', () => {
    const {state,sid,card,use}=shooting()
    const ship={...ctx.foeShips!.get('foe-d-longship')!,hp:1e8,split:{s:0,a:1,h:0},armorResist:{kinetic:.1,plasma:.6},mounts:[],shotDmg:0}
    const target={...card,ships:[{ship}],foeHpOverride:undefined}
    const local={...use,anomalies:new Map(use.anomalies).set(card.id,target)}
    const fresh=startBattleFor(state,local,sid,card.id,0,1000)!
    for(const rt of Object.values(fresh.units)){delete rt.enteredAtMs;rt.weapons.fill(rt.side==='me'?0:1e9)}
    fresh.distanceM=1000;fresh.myDesireM=1000;fresh.meRailStacks={'player#0':5}
    const raw=createPlayerSpec(state,local,sid)!.weapons[0]!.shotsByType!.kinetic!
    const rt=fresh.units['foe-0']!
    const first=applyDamage(rt.hp,{armor:ship.armorResist},raw,'kinetic')
    const second=applyDamage(first.hp,{armor:ship.armorResist},Math.round(raw*1.5),'plasma')
    state.gameMs=10;advanceBattleFor(state,local,fresh,sid,card.id)
    expect(fresh.stats.meDmg).toBeCloseTo(first.dealt+second.dealt,5)
  })
  it.each(['s','a','h'] as const)('真实%s层结算：两段各自层克制，危机增益只乘一次', layer => {
    const {state,sid,card,use,b}=shooting()
    state.fleet[sid]!.fitted.mid=[ids[1]]
    const original=createPlayerSpec(state,use,sid)!
    const spec=playerGravekeeperSpecOf({...b,meCrisisActive:{player:true},meRailStacks:{'player#0':5}},original)
    const raw=spec.weapons[0]!.shotsByType!.kinetic!
    const baseDamage=original.weapons[0]!.shotsByType!.kinetic!
    expect(raw).toBe(Math.round(baseDamage*1.3))
    b.meCrisisActive={player:true};b.meRailStacks={'player#0':5}
    const rt=b.units['foe-0']!
    rt.hp={s:layer==='s'?1e8:0,a:layer==='a'?1e8:0,h:1e8}
    rt.hpMax={...rt.hp}
    const hpBefore={...rt.hp}
    const first=applyDamage(hpBefore,{},raw,'kinetic')
    const second=applyDamage(first.hp,{},Math.round(raw*1.5),'plasma')
    state.gameMs=10;advanceBattleFor(state,use,b,sid,card.id)
    expect(b.stats.meDmg).toBeCloseTo(first.dealt+second.dealt,5)
    expect(b.ammo.kin).toBe(999)
    expect(b.ammo.pla).toBe(0)
  })
  it('跨波/读档后继续叠层，战斗视图周期与能量系数同源且只读', () => {
    const {state,sid,card,use,b}=shooting()
    b.meRailStacks={'player#0':3}
    const original=JSON.stringify(b)
    const view=battleArcsFor(state,use,{battle:b,anomaly:card,leaderShipId:sid})!
    const w=view.weapons.find(w=>w.src==='turret')!
    expect(w.railStacks).toBe(3)
    expect(w.railEnergyPct).toBeCloseTo(90)
    expect(w.cycleMs).toBe(Math.round(createPlayerSpec(state,use,sid)!.weapons[0]!.reloadMs*1.3))
    expect(JSON.stringify(b)).toBe(original)
  })
  it('波次推进不重置磁轨层数，保存重载后下一轮继续累计', () => {
    const {state,sid,card,use,b}=shooting()
    const multi={...card,waves:[{units:1,hpShare:.5},{units:1,hpShare:.5}]}
    const context={...use,anomalies:new Map(use.anomalies).set(card.id,multi)}
    b.meRailStacks={'player#0':3}
    b.units['foe-0']!.hp={s:0,a:0,h:0};b.units.player!.weapons[0]=0
    for(let t=10;t<=6000 && (b.waveIdx??0)===0;t+=10) {state.gameMs=t;advanceBattleFor(state,context,b,sid,card.id)}
    expect(b.waveIdx).toBe(1)
    expect(b.meRailStacks!['player#0']).toBe(3)
    const restored=cleanBattle(JSON.parse(JSON.stringify(b)))!
    for(const rt of Object.values(restored.units)) {delete rt.enteredAtMs;rt.weapons.fill(rt.side==='me'?0:1e9)}
    restored.distanceM=1000;restored.myDesireM=1000
    restored.ammo.kin=100
    state.gameMs=restored.lastTickGameMs+10
    advanceBattleFor(state,context,restored,sid,card.id)
    expect(restored.meRailStacks!['player#0']).toBe(4)
  })
  it('危机/苏生装置行直接读持久账本，不另造循环或修改战斗', () => {
    const {state,sid,spec,battle:b}=one([ids[1]],[ids[0]])
    b.meCrisisActive={player:true}
    b.meRebirths={player:{repairUntilMs:6000,lastRepairAtMs:1000,armorHealed:0,hullHealed:0}}
    b.dc={player:{lockUntilMs:2000,used:true}}
    const snapshot=JSON.stringify(b)
    const rows=battleDeviceCyclesOf(state,ctx,b,[{spec,shipId:sid,name:spec.name}],()=>({boosting:false,remainMs:0,cycleMs:0,posMs:0}))
    expect(rows.find(r=>r.kind==='crisis-overload')!.state).toBe('active')
    const dc=rows.find(r=>r.kind==='damage-control')!
    expect(dc.cycleMs).toBe(5000);expect(dc.remainingMs).toBe(5000)
    expect(JSON.stringify(b)).toBe(snapshot)
  })
  it('未叠层基础名义伤害为MK3的90%，每层附伤加法而非增动能主段', () => {
    const rail=ctx.modules.get(ids[2])!, mk3=ctx.modules.get('mod-turret-kin-3')!
    expect((rail.dmgMult!/rail.reloadMs!)/(mk3.dmgMult!/mk3.reloadMs!)).toBeCloseTo(.9,5)
    const {spec,battle:b}=one()
    const raw=spec.weapons[0]!.shotsByType!.kinetic
    for(let n=0;n<=7;n++) {
      const out=playerGravekeeperSpecOf(b,spec,true).weapons[0]!
      expect(out.shotsByType!.kinetic).toBe(raw)
      expect(out.secondaryDamagePct).toBeCloseTo(.3*Math.min(n,5))
      expect(out.secondaryDamageType).toBe('plasma')
      expect(out.reloadMs).toBe(Math.round(spec.weapons[0]!.reloadMs*(1+.1*Math.min(n,5))))
      noteRailAttack(b,spec,0,spec.weapons[0]!.reloadMs)
    }
  })
  it.each([1,2])('真实齐射%d门只增加1层，附段沿破片炮共用命中且不另耗弹', copies => {
    const {state,sid,card,use,b}=shooting(false,copies)
    const spec=createPlayerSpec(state,use,sid)!
    const raw=spec.weapons[0]!.shotsByType!.kinetic!
    state.gameMs=10;advanceBattleFor(state,use,b,sid,card.id)
    expect(b.meRailStacks!['player#0']).toBe(1)
    expect(b.stats.meShots).toBe(copies)
    expect(b.ammo.kin).toBe(1000-copies)
    const first=b.stats.meDmg
    b.units.player!.weapons[0]=0
    state.gameMs=20;advanceBattleFor(state,use,b,sid,card.id)
    expect(b.meRailStacks!['player#0']).toBe(2)
    expect(b.stats.meDmg-first).toBeGreaterThan(first)
    expect(b.ammo.pla).toBe(0)
    expect(b.units.player!.weapons[0]).toBe(Math.round(spec.weapons[0]!.reloadMs*1.2))
    expect(raw).toBeGreaterThan(0)
  })
  it('未命中叠层，缺弹/射程外不叠层', () => {
    const {state,sid,card,use,b}=shooting(true)
    state.gameMs=10;advanceBattleFor(state,use,b,sid,card.id)
    expect(b.meRailStacks!['player#0']).toBe(1)
    expect(b.stats.meHits).toBe(0)
    b.units.player!.weapons[0]=0;b.ammo.kin=0
    state.gameMs=20;advanceBattleFor(state,use,b,sid,card.id)
    expect(b.meRailStacks!['player#0']).toBe(1)
    b.units.player!.weapons[0]=0;b.ammo.kin=100;b.distanceM=30000;b.myDesireM=30000
    state.gameMs=30;advanceBattleFor(state,use,b,sid,card.id)
    expect(b.meRailStacks!['player#0']).toBe(1)
  })
  it('三类状态真实存档两次往返保留，非法层数清洗封顶', () => {
    const {state,spec,battle:b}=one([ids[1]],[ids[0]])
    applyDcGuard(state,b,'player',spec,{s:0,a:0,h:10},1e9,'plasma')
    b.units.player!.hp.s=0;syncPlayerCrisis(b,[spec]);noteRailAttack(b,spec,0,5800)
    state.gameMs=b.lastTickGameMs
    state.encounter={...state.encounter,active:true,shipId:state.shipId,galaxyId:'galaxy-hub',anomalyId:'ano-training',battle:b,name:'装备测试',threat:20,origin:'测试',invitedAtGameMs:0,deadlineGameMs:999999}
    const back=loadSaveFile(serializeSaveFile(loadSaveFile(serializeSaveFile(state)).state)).state.encounter.battle!
    expect(back.meRebirths).toEqual(b.meRebirths)
    expect(back.meCrisisActive).toEqual(b.meCrisisActive)
    expect(back.meRailStacks).toEqual(b.meRailStacks)
    b.meRailStacks!['player#0']=999
    expect(cleanBattle(b)!.meRailStacks!['player#0']).toBe(5)
  })
})
