import { describe, expect, it } from 'vitest'
import { buildSimContext, FOE_SHIPS } from '@whale/data'
import { createInitialState, addShipToFleet } from '../src/index'
import { applyFoeUnitDamage, createFoeSpecs, createBattleState, applyFoeOverride, activeFoeSpecsOf, advanceBattleFor, startFleetBattleFor, flagshipBattleLedger, DC_LOCK_MS } from '../src/combat'
import { advanceFoeRebirthRepair, gravekeeperResistsOf, syncFoeCapacitors, foeCapacitorMultiplierOf, noteFoeCapacitorAttack } from '../src/gravekeeperCombat'
import { cleanBattle } from '../src/saveBattleClean'
import { foeGunMaxRangeOf, foeGunPowerFactorOf } from '../src/foeRange'
import { FOE_MOUNT_IDS } from '../src/foeMounts'
import { weekendFoePoolOf, weekendFoeCardOf, WEEKEND_FLAGSHIP_POOL_HP, weekendFamilyForWindow, WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS, weekendFlagshipHpRemaining, weekendFlagshipDefeated } from '../src/weekendEvent'
import type { AnomalyDef, SimContext } from '../src/types'
import { weekendStartFlagshipBattle } from '../src/weekendLaunch'
import { weekendApplyBattleOutcome, weekendFlagshipSpecOf } from '../src/weekendBattle'
import { countWare } from '../src/inventory'
import { serializeSaveFile, loadSaveFile } from '../src/save'
import { carryVolleyOverflow } from '../src/combat'
import { addFoeAcidLayer } from '../src/alienEquipment'
import { gravekeeperStatusesOf } from '../src/gravekeeperCombat'
import { resolvePointDefense } from '../src/combatDrones'
import { foeStrengthOf, foeThreatOfAnomaly } from '../src/foeSpecs'
import { foeHpOfThreat } from '../src/foePower'

const ctx = buildSimContext()
const bal = ctx.balance.battle
const ship = (suffix: string) => FOE_SHIPS.find(s => s.id === `foe-d-invasion-${suffix}`)!
function unit(suffix: string) {
  const card: AnomalyDef = { ...ctx.anomalies.get('gravekeeper-drift')!, ships: [{ ship: ship(suffix) }], waves: undefined }
  return createFoeSpecs(card, bal)[0]!
}
function fixture(suffix = 'cruiser') {
  const foe = unit(suffix)
  const me = { ...foe, tag: 'player', side: 'me' as const, foeRebirthProtocol: undefined }
  const b = createBattleState(me, [foe], 1000, 3000)
  b.distanceM = 3000
  return { b, foe, rt: b.units[foe.tag]! }
}

describe('守墓入侵内容', () => {
  it('四档裸血、最终血型、回避与挂载，不触碰旧D舰', () => {
    expect(['cruiser','bastion','oathkeeper','eternal-tomb'].map(s => ship(s).hp)).toEqual([480,1080,1840,39200])
    const specs = ['cruiser','bastion','oathkeeper','eternal-tomb'].map(unit)
    expect(specs.map(s => s.evasion)).toEqual([.25,.15,.08,.05])
    expect(specs.map(s => s.hp)).toEqual([{s:324,a:216,h:180},{s:729,a:243,h:202.5},{s:1242,a:414,h:345},{s:26460,a:17640,h:14700}])
    expect(ship('eternal-tomb').mounts).toEqual([FOE_MOUNT_IDS.dCoatingArmor, FOE_MOUNT_IDS.dShieldCapacitor])
    expect(specs[1]!.resists.armor).toEqual({kinetic:.75,explosive:.75,plasma:.75})
    expect(specs[1]!.resists.hull).toEqual({kinetic:.75,explosive:.75,plasma:.75})
    expect(specs[1]!.resists.shield).toBeUndefined()
    expect(FOE_SHIPS.find(s => s.id === 'foe-d-throne')!.mounts).toEqual([FOE_MOUNT_IDS.supportCall])
  })
  it('编成与独立池齐备，前三期不变；旗舰30万最后覆盖且不重复放大', () => {
    expect(weekendFoePoolOf('D', false)).toEqual(['gravekeeper-drift','gravekeeper-line'])
    expect(weekendFoePoolOf('D', true)).toEqual(['gravekeeper-line','gravekeeper-main'])
    expect(weekendFoeCardOf('D', 'flagship')).toBe('gravekeeper-flagship')
    expect([0,1,2,3].map(n => weekendFamilyForWindow(WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS+n*7*86400000))).toEqual(['R','C','H','D'])
    const base = ctx.anomalies.get('gravekeeper-flagship')!
    expect(base.waves!.map(w => w.units)).toEqual([3,3,2,4])
    const derived = applyFoeOverride(base, {bossShipId:ship('eternal-tomb').id,bossHp:WEEKEND_FLAGSHIP_POOL_HP,bossHpMax:WEEKEND_FLAGSHIP_POOL_HP,bossHpLayers:{s:135000,a:90000,h:75000}})
    const boss = activeFoeSpecsOf(derived, bal, 3).find(f => f.foeShipId === ship('eternal-tomb').id)!
    expect(boss.hp).toEqual({s:135000,a:90000,h:75000})
  })
  it('四张新编成与真实威胁一致，普通单舰与旗舰小队各走原标尺', () => {
    const cases = [
      ['gravekeeper-drift',91,[['巡陵级','巡陵级','巡陵级'],['守墓长舰','守墓长舰']]],
      ['gravekeeper-line',99,[['巡陵级','巡陵级'],['碑卫级','碑卫级','静滞卫舰']]],
      ['gravekeeper-main',153,[['碑卫级','巡陵级','巡陵级'],['守墓长舰','守墓长舰'],['守誓级','静滞卫舰','静滞卫舰']]],
      ['gravekeeper-flagship',196,[['巡陵级','巡陵级','巡陵级'],['守墓王座舰','静滞卫舰','静滞卫舰'],['守誓级','守墓王座舰'],['永陵级','守墓王座舰','静滞卫舰','静滞卫舰']]],
    ] as const
    for (const [id, threat, formation] of cases) {
      const card = ctx.anomalies.get(id)!
      expect(card.waves!.map(w => w.units)).toEqual(formation.map(w => w.length))
      expect(card.waves!.map((_, i) => activeFoeSpecsOf(card,bal,i).map(s => s.name))).toEqual(formation)
      expect(card.threat).toBe(threat)
      expect(foeThreatOfAnomaly(card,id.endsWith('flagship') ? 10 : 3,bal)).toBe(threat)
      expect(card.ships!.every(slot=>JSON.stringify(slot.dmgMix)===JSON.stringify(card.dmgMix))).toBe(true)
    }
  })
  it('永陵参照墨潮厚血比例，196由真实预算反算；满池/残池不再吃卡倍率', () => {
    const card=ctx.anomalies.get('gravekeeper-flagship')!
    expect(ship('eternal-tomb').hp).toBe(FOE_SHIPS.find(s=>s.id==='foe-h-ink-flagship')!.hp)
    const natural=foeStrengthOf(card,bal)
    const budget=5*natural.x/(10*Math.sqrt(1.5))
    expect(budget).toBeGreaterThan(foeHpOfThreat(195,bal))
    expect(budget).toBeLessThanOrEqual(foeHpOfThreat(196,bal))
    expect(natural.hp).toBeCloseTo(137661.099,3)
    const throneSpecs=[1,2,3].map(i=>activeFoeSpecsOf(card,bal,i).find(s=>s.foeShipId==='foe-d-throne')!)
    expect(throneSpecs.every(s=>s.foeSupportCall?.delaySec===20)).toBe(true)
    const full=applyFoeOverride(card,{strengthMul:2,bossShipId:ship('eternal-tomb').id,bossHp:300000,bossHpLayers:{s:135000,a:90000,h:75000}})
    const boss=activeFoeSpecsOf(full,bal,3).find(s=>s.foeShipId===ship('eternal-tomb').id)!
    expect(boss.hp).toEqual({s:135000,a:90000,h:75000})
    const remaining=applyFoeOverride(card,{bossShipId:ship('eternal-tomb').id,bossHp:100,bossHpLayers:{s:0,a:0,h:100}})
    expect(activeFoeSpecsOf(remaining,bal,3).find(s=>s.foeShipId===ship('eternal-tomb').id)!.hp).toEqual({s:0,a:0,h:100})
  })
})

describe('苏生协议', () => {
  it('致命保底、同拍多段保底与严格1秒截止；不误记击杀、不消费玩家组件', () => {
    const { b, foe, rt } = fixture()
    const hit = applyFoeUnitDamage(b, foe, 1e6, 'plasma')
    expect(hit.killedNow).toBe(false)
    expect(rt.hp.h).toBeCloseTo(1,5)
    expect(rt.downAtMs).toBeUndefined()
    expect(b.foeRebirths![foe.tag]!.lockUntilMs).toBe(1000+DC_LOCK_MS)
    for (let n=0;n<50;n++) applyFoeUnitDamage(b,foe,1e6,'kinetic')
    expect(rt.hp.h).toBeCloseTo(1,5)
    b.lastTickGameMs = 1999
    applyFoeUnitDamage(b,foe,1e6,'plasma')
    expect(rt.hp.h).toBeCloseTo(1,5)
    b.lastTickGameMs = 2000
    expect(applyFoeUnitDamage(b,foe,1e6,'plasma').killedNow).toBe(true)
    expect(b.dcKitsUsed).toBeUndefined()
    expect(rt.downAtMs).toBe(2000)
    expect(applyFoeUnitDamage(b,foe,1e6,'plasma').killedNow).toBe(false)
  })
  it('五秒合计甲/结构各100%，满层溢出不积存，死后不复活，账本读档不刷新', () => {
    const {b,foe,rt} = fixture('oathkeeper')
    applyFoeUnitDamage(b,foe,1e6,'plasma')
    b.lastTickGameMs=2000
    advanceFoeRebirthRepair(b,foe,2000)
    expect(rt.hp.a).toBeCloseTo(foe.hp.a*.2,6)
    expect(rt.hp.h).toBeCloseTo(1+foe.hp.h*.2,6)
    const restored = cleanBattle(JSON.parse(JSON.stringify(b)))!
    expect(restored.foeRebirths).toEqual(b.foeRebirths)
    expect(cleanBattle(restored)!.foeRebirths).toEqual(b.foeRebirths)
    rt.hp.a=0;rt.hp.h=1
    b.lastTickGameMs=6000
    advanceFoeRebirthRepair(b,foe,6000)
    expect(b.foeRebirths![foe.tag]!.armorHealed).toBeCloseTo(foe.hp.a,6)
    expect(b.foeRebirths![foe.tag]!.hullHealed).toBeCloseTo(foe.hp.h,6)
    rt.hp.a=0;rt.hp.h=0
    advanceFoeRebirthRepair(b,foe,9000)
    expect(rt.hp).toEqual({s:0,a:0,h:0})
  })
  it('满层时损失的维修额度不会在维修截止后追回', () => {
    const {b,foe,rt}=fixture()
    applyFoeUnitDamage(b,foe,1e6,'plasma')
    rt.hp={...foe.hp}
    advanceFoeRebirthRepair(b,foe,6000)
    rt.hp.a=0;rt.hp.h=1
    advanceFoeRebirthRepair(b,foe,7000)
    expect(rt.hp.a).toBe(0)
    expect(rt.hp.h).toBe(1)
  })
})

describe('永陵挂载', () => {
  it('只实际装甲损失叠层；每层独立5秒、百分点加算、上限90%', () => {
    const {b,foe,rt}=fixture('eternal-tomb')
    applyFoeUnitDamage(b,foe,10,'plasma')
    expect(b.foeCoatingLayers).toBeUndefined()
    rt.hp.s=0
    applyFoeUnitDamage(b,foe,10,'plasma')
    b.lastTickGameMs=2000
    applyFoeUnitDamage(b,foe,10,'plasma')
    const base={armor:{kinetic:.1,plasma:.2}}
    expect(gravekeeperResistsOf(b,foe,base,2000).armor!.kinetic).toBeCloseTo(.2)
    expect(gravekeeperResistsOf(b,foe,base,6000).armor!.kinetic).toBeCloseTo(.15)
    for(let i=0;i<30;i++) applyFoeUnitDamage(b,foe,1,'plasma')
    expect(gravekeeperResistsOf(b,foe,base,2000).armor!.plasma).toBe(.9)
    expect(gravekeeperResistsOf(b,foe,base,8000)).toBe(base)
    const before=b.foeCoatingLayers?.[foe.tag]?.length ?? 0
    rt.hp.a=0
    applyFoeUnitDamage(b,foe,1,'plasma')
    expect(b.foeCoatingLayers?.[foe.tag]?.length ?? 0).toBe(before)
  })
  it('共享池入场已空盾也蓄能；回盾不退出，射程/衰减与电子压制同源', () => {
    const {b,foe,rt}=fixture('eternal-tomb')
    rt.hp.s=0
    syncFoeCapacitors(b,[foe])
    const w=foe.weapons[0]!
    expect(foeGunMaxRangeOf(b,foe,w)).toBe(21000)
    expect(foeGunPowerFactorOf(b,foe,w,21000)).toBeCloseTo(.2)
    b.meFoeRangeDebuff=.15
    expect(foeGunMaxRangeOf(b,foe,w)).toBe(18900)
    rt.hp.s=100
    syncFoeCapacitors(b,[foe])
    expect(b.foeShieldCapacitorActive![foe.tag]).toBe(true)
    for(let i=0;i<40;i++) noteFoeCapacitorAttack(b,foe,0)
    expect(foeCapacitorMultiplierOf(b,foe,0,'damageMul')).toBeCloseTo(1.3**40,4)
    expect(foeCapacitorMultiplierOf(b,foe,'pd','damageMul')).toBe(1)
  })
  it('真引擎八炮齐射只叠一次，下一轮间隔立即乘1.1，同齐射不偷吃新增伤害', () => {
    const state=createInitialState({nowWallMs:0,seed:11})
    const sid=addShipToFleet(state,'sh-thresher');state.shipId=sid
    state.fleet[sid]!.fitted={high:['mod-laser-3'],mid:[],low:[]}
    const base=ctx.anomalies.get('gravekeeper-flagship')!
    const one:AnomalyDef={...base,id:'gravekeeper-test',waves:undefined,ships:[{ship:ship('eternal-tomb')} ]}
    const anomalies=new Map(ctx.anomalies);anomalies.set(one.id,one)
    const context:SimContext={...ctx,anomalies}
    const b=startFleetBattleFor(state,context,[sid],one.id,0,null)!
    b.units.player!.hp={s:1e9,a:1e9,h:1e9};b.units.player!.hpMax={s:1e9,a:1e9,h:1e9}
    b.units.player!.weapons=[1e8]
    const f=activeFoeSpecsOf(one,bal,0)[0]!
    b.units[f.tag]!.hp.s=0
    state.gameMs=10;advanceBattleFor(state,context,b,sid,one.id)
    expect(b.stats.foeShots).toBe(8)
    expect(b.foeShieldCapacitorAttacks![`${f.tag}#0`]).toBe(1)
    expect(b.units[f.tag]!.weapons[0]).toBe(6600)
    expect(flagshipBattleLedger(b,[f.foeShipId!]).rawDmg).toBeGreaterThanOrEqual(0)
  })
  it('负面酸蚀在镀层后减百分点，护盾/结构不获得镀层抗性', () => {
    const {b,foe,rt}=fixture('eternal-tomb')
    rt.hp.s=0
    applyFoeUnitDamage(b,foe,10,'plasma')
    addFoeAcidLayer(b,foe.tag,{cutPct:.15,durationMs:10000},b.lastTickGameMs)
    const before=rt.hp.a
    applyFoeUnitDamage(b,foe,10,'plasma')
    expect(before-rt.hp.a).toBeCloseTo(11)
    expect(gravekeeperResistsOf(b,foe,{shield:{kinetic:.2},hull:{plasma:.1}},b.lastTickGameMs).hull).toEqual({plasma:.1})
  })
  it('齐射溢火遇到苏生停止；致死叠层不反过来改变该次溢火', () => {
    const {b,foe,rt}=fixture('eternal-tomb')
    const next=unit('cruiser');next.tag='foe-next'
    b.units[next.tag]={...rt,tag:next.tag,hp:{s:0,a:0,h:20},hpMax:{s:0,a:0,h:20},weapons:[0]}
    rt.hp={s:0,a:5,h:5}
    const before={...rt.hp}
    const hit=applyFoeUnitDamage(b,foe,30,'plasma')
    expect(hit.killedNow).toBe(true)
    const carried=carryVolleyOverflow(b,[foe,next],foe.tag,'plasma',30,before,3,hit.resistsUsed)
    expect(carried.hits).toBe(1)
    expect(b.units[next.tag]!.hp.h).toBeCloseTo(1,5)
    expect(b.foeRebirths![next.tag]).toBeTruthy()
  })
  it('运行态在清洗后丢弃，协议进度随真实存档两次往返保留，状态视图只读', () => {
    const {b,foe}=fixture()
    applyFoeUnitDamage(b,foe,1e6,'plasma')
    b.foeShieldCapacitorActive={[foe.tag]:true}
    b.foeShieldCapacitorAttacks={[`${foe.tag}#0`]:20}
    b.foeCoatingLayers={[foe.tag]:[{untilMs:10000}]}
    const state=createInitialState({nowWallMs:Date.now(),seed:23})
    state.encounter={...state.encounter,active:true,battle:b,shipId:state.shipId,galaxyId:'galaxy-hub',anomalyId:'gravekeeper-drift',name:'测试',threat:66,origin:'测试',invitedAtGameMs:0,deadlineGameMs:99999}
    const one=loadSaveFile(serializeSaveFile(state)).state
    const two=loadSaveFile(serializeSaveFile(one)).state
    expect(two.encounter!.battle!.foeRebirths).toEqual(b.foeRebirths)
    expect(two.encounter!.battle!.foeShieldCapacitorAttacks).toBeUndefined()
    expect(two.encounter!.battle!.foeCoatingLayers).toBeUndefined()
    const before=JSON.stringify(b)
    expect(gravekeeperStatusesOf(b,[foe])[0]!.used).toBe(true)
    expect(JSON.stringify(b)).toBe(before)
  })
  it('真正旗舰入口以30万最后修正；击杀发D匣且结算不误发墨潮匣', () => {
    const now=Date.now()
    const state=createInitialState({nowWallMs:now,seed:11})
    state.exploredGalaxies=[...ctx.galaxies.keys()]
    state.standings.dsi=100;state.standingsEarned={dsi:100}
    state.weekendEvent={seq:901,family:'D',coreId:'galaxy-maw',peripheryIds:[],startedAtWallMs:now,contributed:{'galaxy-maw':1},flagshipHpMax:300000,flagshipHpDone:299900}
    const spec=weekendFlagshipSpecOf(state,ctx,now)!
    const b=weekendStartFlagshipBattle(state,ctx,now,[state.shipId])!
    expect(b.foeOverride!.bossMaxLayers).toEqual({s:135000,a:90000,h:75000})
    b.waveIdx=3
    state.gameMs=10
    advanceBattleFor(state,ctx,b,state.shipId,spec.cardId)
    const foes=activeFoeSpecsOf(applyFoeOverride(ctx.anomalies.get(spec.cardId)!,b.foeOverride!),bal,3)
    const boss=foes.find(f=>f.foeShipId===ship('eternal-tomb').id)!
    expect(b.units[boss.tag]!.hp).toEqual({s:0,a:0,h:100})
    applyFoeUnitDamage(b,boss,1000,'plasma')
    expect(b.bossDownAtMs).toBeDefined()
    weekendApplyBattleOutcome(state,ctx,spec.cardId,true,now,b,{galaxyId:'galaxy-maw',kind:'flagship'})
    expect(countWare(state,'blackbox-d')).toBe(1)
    expect(countWare(state,'blackbox-h')).toBe(0)
    expect(state.weekendEvent?.family).toBe('D')
  })
  it('旗舰允许多场累计：第二场读取第一场剩余池，不要求单场击沉', () => {
    const now = new Date(2026, 9, 16, 20).getTime()
    let state = createInitialState({ nowWallMs: now, seed: 11 })
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    state.standings.dsi = 100
    state.standingsEarned = { dsi: 100 }
    state.weekendEvent = {
      seq: 902, family: 'D', coreId: 'galaxy-maw', peripheryIds: [], startedAtWallMs: now,
      contributed: { 'galaxy-maw': 1 }, flagshipHpMax: WEEKEND_FLAGSHIP_POOL_HP,
    }
    const cardId = 'gravekeeper-flagship'
    const hint = { galaxyId: 'galaxy-maw', kind: 'flagship' as const }
    const first = weekendStartFlagshipBattle(state, ctx, now, [state.shipId])!
    expect(first.foeOverride!.bossHp).toBe(300_000)
    first.waveIdx = 3
    state.gameMs = 10
    advanceBattleFor(state, ctx, first, state.shipId, cardId)
    const boss = Object.values(first.units).find(u => u.foeShipId === ship('eternal-tomb').id)!
    boss.hp.s -= 80_000
    expect(flagshipBattleLedger(first, [ship('eternal-tomb').id]).rawDmg).toBe(80_000)
    weekendApplyBattleOutcome(state, ctx, cardId, false, now, first, hint)
    expect(weekendFlagshipDefeated(state.weekendEvent)).toBe(false)
    expect(weekendFlagshipHpRemaining(state.weekendEvent)).toBe(220_000)
    weekendApplyBattleOutcome(state, ctx, cardId, false, now, first, hint)
    expect(state.weekendEvent!.flagshipHpDone).toBe(80_000)
    expect(countWare(state, 'blackbox-d')).toBe(0)
    state = loadSaveFile(serializeSaveFile(state)).state
    state.gameMs = 20
    const second = weekendStartFlagshipBattle(state, ctx, now, [state.shipId])!
    expect(second.foeOverride!.bossHp).toBe(220_000)
    expect(second.foeOverride!.bossHpLayers).toEqual({ s: 55_000, a: 90_000, h: 75_000 })
    expect(second.foeOverride!.bossMaxLayers).toEqual({ s: 135_000, a: 90_000, h: 75_000 })
    second.waveIdx = 3
    state.gameMs = 30
    advanceBattleFor(state, ctx, second, state.shipId, cardId)
    const secondBoss = Object.values(second.units).find(u => u.foeShipId === ship('eternal-tomb').id)!
    secondBoss.hp = { s: 0, a: 75_000, h: 75_000 }
    expect(flagshipBattleLedger(second, [ship('eternal-tomb').id]).rawDmg).toBe(70_000)
    weekendApplyBattleOutcome(state, ctx, cardId, false, now, second, hint)
    expect(weekendFlagshipHpRemaining(state.weekendEvent)).toBe(150_000)
    expect(countWare(state, 'blackbox-d')).toBe(0)
    state.gameMs = 40
    const third = weekendStartFlagshipBattle(state, ctx, now, [state.shipId])!
    expect(third.foeOverride!.bossHpLayers).toEqual({ s: 0, a: 75_000, h: 75_000 })
    third.waveIdx = 3
    state.gameMs = 50
    advanceBattleFor(state, ctx, third, state.shipId, cardId)
    const thirdSpecs = activeFoeSpecsOf(applyFoeOverride(ctx.anomalies.get(cardId)!, third.foeOverride!), bal, 3)
    const thirdBoss = thirdSpecs.find(f => f.foeShipId === ship('eternal-tomb').id)!
    applyFoeUnitDamage(third, thirdBoss, 1e9, 'plasma')
    expect(flagshipBattleLedger(third, [ship('eternal-tomb').id]).rawDmg).toBe(150_000)
    weekendApplyBattleOutcome(state, ctx, cardId, false, now, third, hint)
    expect(state.weekendEvent!.flagshipHpDone).toBe(300_000)
    expect(state.weekendEvent!.flagshipDown).toBe('player')
    expect(third.bossDownAtMs).toBeDefined()
    expect(countWare(state, 'blackbox-d')).toBe(1)
  })
  it('未命中的武器不增加蓄能次数，也不误更新其他武器计数', () => {
    const state=createInitialState({nowWallMs:0,seed:11})
    const s={...ship('eternal-tomb'),energyForm:undefined,dmgMix:{kinetic:1},hitRate:0}
    const card:AnomalyDef={...ctx.anomalies.get('gravekeeper-drift')!,id:'gravekeeper-miss',waves:undefined,ships:[{ship:s}]}
    const anomalies=new Map(ctx.anomalies);anomalies.set(card.id,card)
    const useCtx:SimContext={...ctx,anomalies,balance:{...ctx.balance,battle:{...bal,hitMin:0,hitMax:0}}}
    const b=startFleetBattleFor(state,useCtx,[state.shipId],card.id,0,null)!
    const f=activeFoeSpecsOf(card,useCtx.balance.battle,0)[0]!
    b.units[f.tag]!.hp.s=0
    state.gameMs=10;advanceBattleFor(state,useCtx,b,state.shipId,card.id)
    expect(b.stats.foeShots).toBe(8)
    expect(b.stats.foeHits).toBe(0)
    expect(b.foeShieldCapacitorAttacks).toBeUndefined()
    expect(b.units[f.tag]!.weapons[0]).toBe(6000)
  })
  it('苏生维修按相同时间推进与离线整段推进一致', () => {
    const {b,foe}=fixture()
    applyFoeUnitDamage(b,foe,1e6,'plasma')
    const a=structuredClone(b),c=structuredClone(b)
    for(let t=1010;t<=6000;t+=10) advanceFoeRebirthRepair(a,foe,t)
    advanceFoeRebirthRepair(c,foe,6000)
    expect(a.units[foe.tag]!.hp.a).toBeCloseTo(c.units[foe.tag]!.hp.a,6)
    expect(a.units[foe.tag]!.hp.h).toBeCloseTo(c.units[foe.tag]!.hp.h,6)
    expect(a.foeRebirths![foe.tag]!.lastRepairAtMs).toBe(c.foeRebirths![foe.tag]!.lastRepairAtMs)
  })
  it('全部武器包含近防，近防攻击次数与主炮独立，首发不偷吃新增伤害', () => {
    const {b,foe,rt}=fixture('eternal-tomb')
    rt.hp.s=0;syncFoeCapacitors(b,[foe])
    b.dronePools={'player:0':{s:100000,a:100000,h:100000,alive:true,evasion:0,artId:'drone-heavy',launched:true}}
    b.pdCd=[0];b.droneHitAt={foe:b.lastTickGameMs}
    const state=createInitialState({nowWallMs:0,seed:11})
    resolvePointDefense(state,b,[foe],{...bal,pdAcc:2},10)
    expect(b.foeShieldCapacitorAttacks![`${foe.tag}#pd`]).toBe(1)
    expect(b.foeShieldCapacitorAttacks![`${foe.tag}#0`]).toBeUndefined()
    expect(b.pdCd[0]).toBeCloseTo(Math.max(100,Math.round(bal.pdJudgementMs))*1.1-10)
  })
})
