// 临时探针：导出全部悬赏卡的敌方配置与属性（实建档值）；用完即删
import { buildSimContext } from '../packages/data/src/index'
import {
  createFoeSpecs,
  foeDesiredRange,
  foeDamageComposition,
  lairAnomalyOf,
  LAIR_THREAT_MUL,
} from '../packages/core/src/index'

const ctx = buildSimContext()
const bal = ctx.balance.battle
type Def = ReturnType<typeof ctx.anomalies.get> extends infer T ? NonNullable<T> : never

const cards = [...ctx.anomalies.values()].filter((d) => d.hidden !== true && d.foeFamily)
cards.sort((a, b) => (a.threat ?? 0) - (b.threat ?? 0))

const num = (n: number) => n.toLocaleString('zh-CN')
const stat = (def: Def) => {
  const specs = createFoeSpecs(def, bal)
  let hp = 0
  let gun = 0
  let drone = 0
  let droneN = 0
  for (const u of specs) {
    hp += u.hp.s + u.hp.a + u.hp.h
    for (const w of u.weapons) {
      if (w.src === 'drone') {
        drone += w.shotDmg ?? 0
        droneN += 1
      } else gun += w.shotDmg ?? 0
    }
  }
  return { specs, hp, gun, drone, droneN, volley: gun + drone }
}

console.log(`### 悬赏卡总表（${cards.length} 张 · 按威胁升序）\n`)
console.log('| # | 卡 | 族 | 星系(sec) | 威胁 | 档 | 战术 | 血型 | 构成 | 编成 | 总血 | 总单发(炮/机) | 交距 | 速度 | 机群 | 奖金 | standing | 秒 |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
cards.forEach((def, i) => {
  const g = ctx.galaxies.get(def.galaxyId)!
  const s = stat(def)
  const mix = foeDamageComposition(def)
    .map((r) => `${r.type === 'kinetic' ? '动' : r.type === 'explosive' ? '爆' : '能'}${Math.round(r.share * 100)}`)
    .join('/')
  const comp = (def.ships ?? [])
    .map((sl) => `${sl.ship.name}×${sl.count ?? 1}${sl.escort ? '(轻装)' : ''}`)
    .join(' + ')
  const per = s.specs[0]!
  console.log(
    `| ${i + 1} | **${def.name}**<br>\`${def.id}\` | ${def.foeFamily} | ${g.name}(${g.security}) | **${def.threat}** | L${def.lairLevel ?? '-'} | ${def.tactic ?? 'orbit'} | ${def.defProfile ?? '-'} | ${mix} | ${comp || '（旧路径）'} | ${num(Math.round(s.hp))} | ${num(s.volley)}（${s.gun}/${s.drone}） | ${num(foeDesiredRange(per, s.specs, bal))}m | ${per.speedMps} | ${s.droneN ? `${s.droneN} 架` : '—'} | ${num(def.rewardIsk ?? 0)} | ${def.standingReq ?? '-'}/${def.standingGain ?? '-'} | ${def.combatSeconds ?? '-'} |`,
  )
})

console.log('\n### 逐单位明细（实建档）\n')
for (const def of cards) {
  const s = stat(def)
  console.log(`**${def.name}**（${def.id} · 威胁 ${def.threat}）`)
  for (const u of s.specs) {
    const gun = u.weapons.find((w) => w.src !== 'drone')!
    const wing = u.weapons.filter((w) => w.src === 'drone')
    const shape = wing.length
      ? `机群 ${wing[0]!.artId} ×${wing.length} 单发 [${wing.map((w) => w.shotDmg).join('/')}] 射程 ${num(wing[0]!.maxRangeM)}m 命中 ${wing[0]!.hitRate} 装填 ${wing[0]!.reloadMs}ms`
      : '无机群'
    console.log(
      `  - ${u.tag}「${u.name}」血 ${num(Math.round(u.hp.s + u.hp.a + u.hp.h))}（${u.hp.s.toFixed(0)}/${u.hp.a.toFixed(0)}/${u.hp.h.toFixed(0)}）｜速度 ${u.speedMps}｜` +
        `炮台 单发 ${gun.shotDmg} 射程 ${num(gun.minRangeM)}~${num(gun.maxRangeM)}m 命中 ${gun.hitRate} 装填 ${gun.reloadMs}ms ${gun.kind}｜${shape}`,
    )
  }
  console.log('')
}

console.log('### 窝点派生缩放（档位 → 威胁/血量/火力倍率）\n')
console.log(JSON.stringify(LAIR_THREAT_MUL))
const sample = cards.filter((d) => d.lairLevel === 3).slice(0, 3)
for (const def of sample) {
  for (const tier of [1, 2, 3] as const) {
    if (tier > (def.lairLevel ?? 1)) continue
    const lair = lairAnomalyOf(def, tier)
    const s = stat(lair)
    console.log(
      `  ${def.name} · 窝点 T${tier}（威胁 ${lair.threat}）：总血 ${num(Math.round(s.hp))}｜总单发 ${num(s.volley)}（炮 ${s.gun}/机 ${s.drone}）｜交距 ${num(foeDesiredRange(s.specs[0]!, s.specs, bal))}m｜奖金 ${num(lair.rewardIsk ?? 0)}`,
    )
  }
}
