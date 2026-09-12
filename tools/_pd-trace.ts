/** 临时探针（三号 · 任务收尾即删）：近防炮「反应式令牌」链路逐步记账，找出开火次数远低于
 * 令牌数的原因。引擎步长 = `BATTLE_STEP_MS`（100ms）⇒ 以 100ms 推进可读到每一步的真实状态。
 *
 * 用法：npx tsx tools/_pd-trace.ts [卡id] [seed]
 */
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState } from '@whale/core'
import type { GameState, SimContext } from '@whale/core'
import { advanceBattleFor, createPlayerSpec, startBattleFor, waveGapTotalMs } from '../packages/core/src/combat'

const ctx = buildSimContext() as SimContext
const CARD = process.argv[2] ?? 'ano-titan-wreck'
const SEED = Number(process.argv[3] ?? 1)
const SKILLS: Record<string, number> = Object.fromEntries(
  [
    'gunnery', 'kinetic-gunnery', 'missile-launching', 'laser-cannon', 'fire-control', 'reload-drills',
    'drone-warfare', 'drone-servicing', 'ammunition-condensing', 'shield-operation', 'energy-management',
    'hull-upgrades', 'shield-tuning', 'armor-tuning', 'armed-ops', 'armored-ops', 'vector-maneuvering',
    'evasion-maneuvering', 'targeting-integration', 'ship-systems-engineering',
  ].map((k) => [k, 3]),
)

const FITS: Record<string, string[]> = {
  '5×近防炮MK1': ['mod-pd-e', 'mod-pd-e', 'mod-pd-e', 'mod-pd-e', 'mod-pd-e'],
  '2×近防炮MK1+3×动能MK2': ['mod-pd-e', 'mod-pd-e', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
  '1×近防炮MK1+4×动能MK2': ['mod-pd-e', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
  '1×近防炮MK2+4×动能MK2': ['mod-pd-e-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
  '1×近防炮MK3+4×动能MK2': ['mod-pd-e-3', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
}
const FIT = process.argv[4] ?? '5×近防炮MK1'
const state: GameState = createInitialState({ nowWallMs: 0, seed: SEED })
const uid = addShipToFleet(state, 'sh-hammerhead')
state.shipId = uid
for (const [k, v] of Object.entries(SKILLS)) state.skills.trained[k] = v
for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[key] = 20_000
state.fleet[uid]!.fitted = {
  high: [...(FITS[FIT] ?? FITS['5×近防炮MK1']!)],
  mid: ['mod-prop-2', 'mod-shield-pla-2', 'mod-track-2', 'mod-gyro-2'],
  low: ['mod-stab-pla-2', 'mod-armor-pla-2', 'mod-armor-plate-2'],
}
const spec = createPlayerSpec(state, ctx, uid)!
const pdIdx = spec.weapons.map((w, i) => (w.canHitDrones ? i : -1)).filter((i) => i >= 0)
console.log(`卡=${CARD} seed=${SEED} 我方武器=${spec.weapons.map((w) => `${w.label}${w.canHitDrones ? '(防空)' : ''}`).join(' / ')}`)

/** 玩家武器条目 → 弹种与名义单发（打机群时的 dmg 就是它） */
for (const i of pdIdx) {
  const w = spec.weapons[i]!
  console.log(
    `  防空槽 ${i}：${w.label} 命中=${w.hitRate.toFixed(3)} 射程=${w.minRangeM}~${w.maxRangeM} 衰减=${w.falloff} 装填=${w.reloadMs}ms 单发=${JSON.stringify(w.shotsByType)}`,
  )
}

const b = startBattleFor(state, ctx, uid, CARD, 0, 1000)!
if (!b) throw new Error('开战失败')
const budget = ctx.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(ctx.anomalies.get(CARD), ctx.balance.battle)
let lastSeq = 0
const startAt = b.startedAtGameMs
let steps = 0
let tokenSteps = 0
let tokenReadySteps = 0
let shotSteps = 0
let shots = 0
let tokenWastedNoCand = 0
let tokenLostReload = 0
let attacks = 0
let atkSteps = 0
let kills = 0
let focusChanges = 0
let prevFocus = ''
let focusOnKill = 0
const poolKeys = new Set<string>()
for (const [tag, arr] of Object.entries(b.foeDronePools ?? {}))
  for (let i = 0; i < arr.length; i++) if (arr[i]!.alive) poolKeys.add(`${tag}#${i}`)
const trace: string[] = []
for (let t = 100; t <= budget; t += 100) {
  state.gameMs = startAt + t
  advanceBattleFor(state, ctx, b, uid, CARD)
  steps++
  let pdShotsStep = 0
  let atkStep = 0
  for (const e of b.fx) {
    if (e.seq <= lastSeq) continue
    lastSeq = e.seq
    if (e.pd === true) {
      pdShotsStep++
      shots++
    } else if (e.side === 'foe' && e.src === 'drone') {
      atkStep++
      attacks++
    }
  }
  if (atkStep > 0) atkSteps++
  const meRt = b.units['player']
  const ready = pdIdx.filter((i) => (meRt?.weapons[i] ?? 0) <= 0).length
  const token = b.droneHitAt?.me !== undefined
  if (t >= 17500 && t <= 24000)
    trace.push(
      `  [dump] t=${(t / 1000).toFixed(1)}s 距离=${Math.round(b.distanceM)} 敌机开火=${atkStep} ` +
        `令牌=${token ? '有' : '无'} 防空装填=${pdIdx.map((i) => Math.round(meRt?.weapons[i] ?? 0)).join(',')} ` +
        `近防炮开火=${pdShotsStep}`,
    )
  if (token) {
    tokenSteps++
    if (ready > 0) tokenReadySteps++
    else tokenLostReload++
  }
  if (pdShotsStep > 0) shotSteps++
  if (token && ready > 0 && pdShotsStep === 0) tokenWastedNoCand++
  // **集火锁定**：本槽锁的那一架是否跨拍保持（换靶次数 vs 击落次数）
  const focusNow = JSON.stringify(
    (b.mePdFocus ?? []).map((f) => (f ? `${f.tag}#${f.idx}` : null)),
  )
  if (focusNow !== prevFocus) {
    if (prevFocus !== '') focusChanges++
    prevFocus = focusNow
  }
  for (const [tag, arr] of Object.entries(b.foeDronePools ?? {}))
    for (let i = 0; i < arr.length; i++) {
      const key = `${tag}#${i}`
      const p = arr[i]!
      if (p.alive && !poolKeys.has(key)) poolKeys.add(key)
      if (!p.alive && poolKeys.has(key)) {
        poolKeys.delete(key)
        kills++
        focusOnKill++
      }
    }
  if (trace.length < 12 && (token || pdShotsStep > 0 || atkStep > 0))
    trace.push(
      `  t=${(t / 1000).toFixed(1)}s 距离=${Math.round(b.distanceM)} 敌机开火=${atkStep} 令牌=${token ? '有' : '无'} 就绪防空槽=${ready} 近防炮开火=${pdShotsStep}`,
    )
  if (b.ended) break
}
const pools = Object.values(b.foeDronePools ?? {}).flat()
console.log('前若干步样本：\n' + trace.join('\n'))
console.log(
  `\n总步数=${steps}（每步 100ms）\n` +
    `敌机开火事件=${attacks}（发生在 ${atkSteps} 步内 ⇒ 同一步内多架齐射会被并成 1 个令牌）\n` +
    `令牌出现步数=${tokenSteps}\n` +
    `  ├ 令牌 + 有炮就绪=${tokenReadySteps}（=${((tokenReadySteps / Math.max(1, tokenSteps)) * 100).toFixed(0)}%）\n` +
    `  ├ 令牌 + 全在装填=${tokenLostReload}\n` +
    `  └ 令牌 + 有炮就绪但**没开火**=${tokenWastedNoCand}（选不到靶/未命中不推进=0 则正常）\n` +
    `近防炮实际开火=${shots}（分布在 ${shotSteps} 步）\n` +
    `**集火锁定换靶次数=${focusChanges}**（对比：击落 ${kills} 架 ⇒ 理想值 ≈ 击落数）\n` +
    `击落=${kills}｜期末在空=${pools.filter((p) => p.alive && p.inHangar !== true).length}｜备用剩=${pools.filter((p) => p.inHangar === true).length}` +
    `｜结束=${b.ended ?? '未结束'}｜时长=${((b.lastTickGameMs - startAt) / 1000).toFixed(1)}s｜末距=${Math.round(b.distanceM)}`,
)
console.log(
  `\n换算：令牌 → 开火 的转化率 = ${((shots / Math.max(1, tokenSteps)) * 100).toFixed(0)}%` +
    `｜开火 → 攻击事件 = ${((shots / Math.max(1, attacks)) * 100).toFixed(0)}%` +
    `｜开火速率 = ${(shots / ((b.lastTickGameMs - startAt) / 1000)).toFixed(2)} 发/秒`,
)
const G = globalThis as unknown as Record<string, number>
console.log(
  `\n【引擎内部计数】令牌置位=${G.__tokSet ?? 0}（每架敌机每次开火各置一次）｜pickFoeDroneTarget 调用=${G.__pdCalls ?? 0}` +
    `｜其中无令牌=${G.__pdNoTok ?? 0}｜有令牌=${G.__pdWithTok ?? 0}` +
    `｜有令牌但选不到靶=${G.__pdNoCand ?? 0}｜选出靶=${G.__pdPicked ?? 0}｜实际开火（fx 计）=${shots}`,
)
