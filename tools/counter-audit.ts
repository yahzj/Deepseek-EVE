/**
 * **层位克制 + "敌人抗性"体检**（正式入库 · 2026-09-13）。
 *
 * 用途：一页纸回答两个反复被问到的问题——
 *   ① 克制表当前是什么、**旧值 → 新值**让「对某血型敌舰的有效伤害」变了多少（解析口径）；
 *   ② 「针对有不同抗性的敌人，伤害测过吗」——把**抗性链路的现状**摊开：
 *      `applyDamage` 本身吃不吃抗性（单元级实测）· 敌舰侧到底有没有抗性（全卡扫描）·
 *      真实战斗里只有**血型（三层配比）**在拉开伤害（实跑对照）。
 *
 * 用法：`npx tsx tools/counter-audit.ts`
 *
 * 读数列义：
 * - ①「有效倍率」= Σ 层占比 × `typeLayerMult`（血型占比取 `foeLayerSplit`，与建档同源）；
 * - ②「扣血」= 单发 1000 打满血 1000/1000/1000 三层后的**逐层实际扣除**（抗性只作用于本层）；
 * - ③ 空 = 该路径没有抗性数据；
 * - ④「时长/我伤/敌残」= 真实战斗推演（4×T3 满配编队，同卡仅改 `defProfile`）。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v25**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-13**（当日核对：克制表 kinetic/explosive 逆克制 0.5→0.75 ·
 *     `applyDamage` 抗性签名 · 敌舰建档 `resists: {}` · `ANOMALIES` 血型分布）
 *   - 本工具最后跑过：**2026-09-13**
 *   - 判据：`CURRENT_STATE_VERSION − v25 ≥ 2` ⇒ **必须重跑核对**（存档结构跨了一个大版本）
 */
import { addShipToFleet, createInitialState, createPlayerSpec } from '@whale/core'
import type { DamageType, DefProfile, GameState, SimContext } from '@whale/core'
import { FOE_SHIPS, buildSimContext } from '@whale/data'
import {
  advanceBattleFor,
  applyDamage,
  createFoeSpecs,
  foeLayerSplit,
  startFleetBattleFor,
  typeLayerMult,
} from '../packages/core/src/combat'

const ctx: SimContext = buildSimContext()
const TYPES: DamageType[] = ['kinetic', 'explosive', 'plasma']
const LAYERS = ['shield', 'armor', 'hull'] as const
const PROFILES: DefProfile[] = ['shield', 'armor', 'balanced']
const pct = (v: number): string => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`

// ─────────────── ① 克制表 + 三血型的有效倍率（旧值 → 新值） ───────────────
/** 2026-09-13 改动前的旧表（仅本工具用于对照，不参与结算） */
const OLD_TABLE: Record<DamageType, readonly [number, number, number]> = {
  kinetic: [1.5, 0.5, 1],
  explosive: [0.5, 1.5, 1],
  plasma: [1.25, 1, 1],
}

console.log('=== ① 层位克制表（盾/甲/结构）与三血型有效倍率 ===')
for (const t of TYPES) {
  const row = LAYERS.map((l) => typeLayerMult(t, l))
  console.log(`  ${t.padEnd(9)} 表 ${row.map((v) => `×${v}`).join(' / ')}  旧 ${OLD_TABLE[t].map((v) => `×${v}`).join(' / ')}`)
  for (const p of PROFILES) {
    const split = foeLayerSplit(p)
    const shares = [split.s, split.a, split.h]
    const eff = row.reduce((a, v, i) => a + v * (shares[i] ?? 0), 0)
    const effOld = OLD_TABLE[t].reduce((a, v, i) => a + v * (shares[i] ?? 0), 0)
    console.log(
      `      血型 ${p.padEnd(8)} 占比 ${shares.map((v) => (v * 100).toFixed(0) + '%').join('/')}` +
        ` ⇒ 有效倍率 ${effOld.toFixed(4)} → ${eff.toFixed(4)}（${pct(eff / effOld - 1)}）`,
    )
  }
}

// ─────────────── ② applyDamage 抗性矩阵（抗性本身吃不吃、吃在哪一层） ───────────────
console.log('\n=== ② applyDamage 抗性矩阵（单发 1000 · 满血 1000/1000/1000）===')
for (const t of TYPES) {
  const cells: string[] = []
  for (const rl of [null, ...LAYERS] as Array<(typeof LAYERS)[number] | null>) {
    const resists = rl ? ({ [rl]: { [t]: 0.3 } } as never) : ({} as never)
    const out = applyDamage({ s: 1000, a: 1000, h: 1000 }, resists, 1000, t)
    const taken = [1000 - out.hp.s, 1000 - out.hp.a, 1000 - out.hp.h]
    cells.push(`${rl === null ? '无抗' : `${rl}抗0.3`} 扣血 ${taken.map((v) => v.toFixed(0)).join('/')}`)
  }
  console.log(`  ${t.padEnd(9)} ${cells.join('  |  ')}`)
}

// ─────────────── ③ 敌舰侧有没有抗性（全卡扫描 + 数据字段自检） ───────────────
console.log('\n=== ③ 敌卡抗性现状（全量扫描 `createFoeSpecs`）===')
let cardsWithResist = 0
let unitsWithResist = 0
let cards = 0
let units = 0
for (const card of ctx.anomalies.values()) {
  cards++
  const specs = createFoeSpecs(card, ctx.balance.battle)
  units += specs.length
  const hit = specs.filter((s) => s.resists && Object.keys(s.resists).length > 0)
  if (hit.length > 0) {
    cardsWithResist++
    unitsWithResist += hit.length
    console.log(`  ⚠ ${card.id} ${hit.map((s) => s.tag).join(',')} ⇒ ${JSON.stringify(hit[0]!.resists)}`)
  }
}
const foeShipResistFields = FOE_SHIPS.filter((s) => {
  const rec = s as unknown as Record<string, unknown>
  return rec.shieldResist || rec.armorResist || rec.hullResist
}).length
console.log(
  `  扫到敌卡 ${cards} 张 / 敌舰单位 ${units} 条 ⇒ 带抗性单位 **${unitsWithResist}** 条` +
    `（${cardsWithResist} 张卡）；敌舰卡数据里写了抗性字段的 **${foeShipResistFields}** 条`,
)
console.log('  ⇒ 结论：**敌人侧目前没有抗性这条链路**（我方打敌舰只吃层克制 + 血型）。')

// ─────────────── ④ 真实战斗：同卡只改血型（唯一变量） ───────────────
const REF_SHIP = 'sh-thresher'
const REF_FIT = {
  high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
  mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'],
  low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
}
/**
 * 参考编队的技能档（战斗系 Lv3）。
 * ⚠ **2026-09-20 修**：原先 5 个 id 是假的（`missile-ops`/`shield-ops`/`armor-ops`/
 * `evasive-maneuvers`/`targeting`）⇒ 等于没训练，读数虚假悲观；真实 id 见 `data/src/skills.ts`。
 * 同类问题由 `npm run skill:audit` 常驻体检。
 */
const SKILLS: Record<string, number> = {
  gunnery: 3,
  'missile-launching': 3,
  'shield-operation': 3,
  'armored-ops': 3,
  'evasion-maneuvering': 3,
  'targeting-integration': 3,
}

function makeFleet(seed: number): { state: GameState; uids: string[] } {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 20_000_000
  for (const [id, lv] of Object.entries(SKILLS)) state.skills.trained[id] = lv
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[key] = 5_000
  const uids: string[] = []
  for (let i = 0; i < 4; i++) {
    const uid = addShipToFleet(state, REF_SHIP)
    state.fleet[uid]!.fitted = { high: [...REF_FIT.high], mid: [...REF_FIT.mid], low: [...REF_FIT.low] }
    uids.push(uid)
  }
  state.shipId = uids[0]!
  return { state, uids }
}

/** 真实战斗推演（推到分出胜负或打满上限） */
function runBattle(
  seed: number,
  cardId: string,
): { sec: number; meDmg: number; meShots: number; foeFrac: number; ended: string } {
  const { state, uids } = makeFleet(seed)
  // `desireM` = 开局即交战（不给 ⇒ 前 30s 全在接近段，层差异被接近时间抹平）
  const battle = startFleetBattleFor(state, probeCtx, uids, cardId, 0, ENGAGE_M)
  if (!battle) return { sec: 0, meDmg: 0, meShots: 0, foeFrac: 0, ended: '开不了战' }
  const foeTags = Object.values(battle.units)
    .filter((u) => u.side === 'foe')
    .map((u) => u.tag)
  const foeFrac = (): number => {
    let cur = 0
    let max = 0
    for (const tag of foeTags) {
      const u = battle.units[tag]!
      cur += u.hp.s + u.hp.a + u.hp.h
      max += (u.hpMax?.s ?? 0) + (u.hpMax?.a ?? 0) + (u.hpMax?.h ?? 0)
    }
    return max > 0 ? cur / max : 0
  }
  let guard = 0
  while (!battle.ended && guard < 900) {
    state.gameMs += 1_000
    advanceBattleFor(state, probeCtx, battle, uids[0]!, cardId)
    guard++
  }
  return {
    sec: Math.max(0, (battle.lastTickGameMs - battle.startedAtGameMs) / 1000),
    meDmg: battle.stats.meDmg,
    meShots: battle.stats.meShots,
    foeFrac: foeFrac(),
    ended: battle.ended === 'me' ? '我胜' : battle.ended === 'foe' ? '我败' : '打满',
  }
}

// 基卡 = 最高威胁的那张；只重写**每一条目的 `split`（三层配比）** = 唯一变量。
// ⚠ 现网敌卡**全部走舰级路径**（`anomaly.ships`）⇒ 卡面 `defProfile` 不再参与建档，
// 血型由条目 `split ?? ship.split` 决定（旧的威胁推导路径才读 `defProfile`）。
// 血量/伤害**同倍缩放**（`hpMul`/`dmgMul`，三格一致 ⇒ 不改变变量）：参考编队（4×T3）单轮
// raw ≈ 4560 ⇒ 威胁 96 的**原始血量（5730）只够 1~2 轮齐射**，层差异会被"过量伤害 + 逐轮取整"
// 整片抹平（三格读数同值）。⇒ 血量 ×4 让战斗 ≈ 20s 且**逐层穿完**，敌伤 ×0.1 保证我方活得下来，
// 这样"三血型的时长/齐射数差"才是真差异。
const HP_MUL = 4
const DMG_MUL = 0.1
/** 开局交距（米）：不给 `desireM` 时前 30s 全在接近段，会把层差异抹平 */
const ENGAGE_M = 1_500
const allCards = [...ctx.anomalies.values()].sort((a, b) => a.threat - b.threat)
const base = allCards[allCards.length - 1]!
const probeCtx: SimContext = { ...ctx, anomalies: new Map(ctx.anomalies) } as SimContext
for (const p of PROFILES) {
  const split = foeLayerSplit(p)
  const clone = {
    ...base,
    id: `probe-${p}`,
    defProfile: p,
    ships: base.ships?.map((slot) => ({
      ...slot,
      split,
      hpMul: (slot.hpMul ?? 1) * HP_MUL,
      dmgMul: (slot.dmgMul ?? 1) * DMG_MUL,
    })),
  }
  probeCtx.anomalies.set(`probe-${p}`, clone)
  // 自检：血型是否真的进了建档（Σ 三层血 + 占比）
  const specs = createFoeSpecs(clone, ctx.balance.battle)
  const tot = specs.reduce(
    (a, u) => ({ s: a.s + u.hp.s, a: a.a + u.hp.a, h: a.h + u.hp.h }),
    { s: 0, a: 0, h: 0 },
  )
  const sum = tot.s + tot.a + tot.h
  console.log(
    `  建档自检 ${p.padEnd(8)} ${specs.length} 单位 · 总血 ${Math.round(sum)}` +
      ` · 占比 ${[tot.s, tot.a, tot.h].map((v) => ((v / sum) * 100).toFixed(0) + '%').join('/')}`,
  )
}

console.log(
  `\n=== ④ 真实战斗：同卡只改血型（基卡 ${base.id} ${base.name} · 威胁 ${base.threat}` +
    ` · 血/伤各 ×${HP_MUL}，三格一致 · 开局交距 ${ENGAGE_M}m）===`,
)
console.log(`  编队 4×${REF_SHIP}（${REF_FIT.high.length}×${REF_FIT.high[0]}）· 技能 Lv3 · 每格 3 播种`)
for (const p of PROFILES) {
  const runs = [1, 7, 13].map((s) => runBattle(s, `probe-${p}`))
  const avg = (f: (r: (typeof runs)[number]) => number): number => runs.reduce((a, r) => a + f(r), 0) / runs.length
  console.log(
    `  血型 ${p.padEnd(8)} 时长 ${avg((r) => r.sec).toFixed(1)}s · 开火 ${Math.round(avg((r) => r.meShots))} 次` +
      ` · 我方总伤害 ${Math.round(avg((r) => r.meDmg))}` +
      ` · 敌方残血 ${(avg((r) => r.foeFrac) * 100).toFixed(1)}% · 判定 ${runs.map((r) => r.ended).join('/')}`,
  )
}

// ─────────────── ⑤ 引擎真函数手推：击杀所需齐射数（同装配 × 三血型） ───────────────
// ④ 里 `stats.meDmg` = **实际扣血**（打死后必然等于总血）⇒ 只有"时长/开火次数"看得出差异；
// 这一段把层配比的影响从战斗时钟里剥出来：真武器（`createPlayerSpec`）× 真扣血
// （`applyDamage`）逐轮推进，数"打光三层要几轮齐射"。
const diag = makeFleet(1)
const flagSpec = createPlayerSpec(diag.state, ctx, diag.uids[0]!)
const allW = flagSpec?.weapons ?? []
console.log('\n  [诊断] 旗舰武器条目（`shotDmg` 为空的走 `shotsByType` 分弹种）：')
for (const w of allW) {
  console.log(
    `    ${w.kind} 条数=${w.count ?? 1} shotDmg=${w.shotDmg ?? '-'} shotsByType=${JSON.stringify(w.shotsByType ?? {})}` +
      ` fixedType=${w.fixedType ?? '-'} 装填=${w.reloadMs}ms`,
  )
}
/** 每轮齐射的 raw，按弹种拆开（`shotsByType` 优先，其次 `shotDmg × 条数`） */
const volleyByType = new Map<DamageType, number>()
for (const w of allW) {
  const n = w.count ?? 1
  const byType = w.shotsByType as Partial<Record<DamageType, number>> | undefined
  if (byType && Object.keys(byType).length > 0) {
    for (const [t, v] of Object.entries(byType)) {
      volleyByType.set(t as DamageType, (volleyByType.get(t as DamageType) ?? 0) + (v ?? 0) * n)
    }
  } else if (w.shotDmg) {
    const t = (w.fixedType ?? 'kinetic') as DamageType
    volleyByType.set(t, (volleyByType.get(t) ?? 0) + w.shotDmg * n)
  }
}
const chunks = [...volleyByType.entries()].sort((a, b) => b[1] - a[1])
const volleyRaw = chunks.reduce((a, [, v]) => a + v, 0)
/** 旧表（2026-09-13 改动前）对拍：`applyDamage` 里是 `mult × (1 − 抗性)`，
 *  故"旧 0.5 / 新 0.75"可用**等效抗性 1/3** 精确模拟（0.75 × 2/3 = 0.5）——不必维护第二份表。 */
const LEGACY_SHIM: Parameters<typeof applyDamage>[1] = {
  shield: { explosive: 1 / 3 },
  armor: { kinetic: 1 / 3 },
}

/** 打光一组三层血池要几轮齐射（`shim` 非空 = 旧表对拍） */
function volleysToKill(pools0: Array<{ s: number; a: number; h: number }>, shim?: Parameters<typeof applyDamage>[1]): number {
  const pools = pools0.map((hp) => ({ hp: { ...hp } }))
  let volleys = 0
  while (pools.some((q) => q.hp.s + q.hp.a + q.hp.h > 0) && volleys < 5_000) {
    // 每种弹种各自按"盾→甲→结构"消耗（与 `applyDamage` 同序）
    for (const [t, chunk] of chunks) {
      let rest = chunk
      for (const q of pools) {
        if (rest <= 0) break
        const out = applyDamage(q.hp, shim ?? {}, rest, t)
        rest -= out.dealt
        q.hp = out.hp
      }
    }
    volleys++
  }
  return volleys
}

console.log('\n=== ⑤ 击杀所需齐射数（真武器 × `applyDamage` 逐层推进）===')
console.log(
  `  旗舰 ${REF_SHIP} 武器 ${allW.length} 条 · 单轮 raw ${volleyRaw.toFixed(0)}` +
    ` · 弹种构成 ${chunks.map(([t, v]) => `${t} ${v.toFixed(0)}（${((v / Math.max(1, volleyRaw)) * 100).toFixed(0)}%）`).join(' / ')}`,
)
for (const p of PROFILES) {
  const specs = createFoeSpecs(probeCtx.anomalies.get(`probe-${p}`)!, ctx.balance.battle)
  // 再放大到"单轮 raw 的 ~100 倍"（= ④ 那份血池 ×10）⇒ 层差异不再被逐轮取整吃掉
  const POOL_SCALE = 10
  const pools = specs.map((s) => ({
    s: s.hp.s * POOL_SCALE,
    a: s.hp.a * POOL_SCALE,
    h: s.hp.h * POOL_SCALE,
  }))
  const now = volleysToKill(pools)
  const before = volleysToKill(pools, LEGACY_SHIM)
  console.log(
    `  血型 ${p.padEnd(8)} 新表 ${now} 轮 · 旧表（等效） ${before} 轮` +
      ` ⇒ ${before === now ? '±0' : `${(((now - before) / before) * 100).toFixed(1)}%`}`,
  )
}

// ─────────────── ⑥ 颗粒度敏感度：为什么"低阶夹具"会被同一次改动翻盘 ───────────────
// 夹具常是"每层 30 血、单发 30"这种极端颗粒度：层倍率 0.5 → 0.75 会把"两发破层"变成"一发破层"
// ⇒ 该层 TTK 腰斩；而真实量级（层血 ≫ 单发）下同一改动只有 +8.2%（balanced 血型，见 ①）。
console.log('\n=== ⑥ 颗粒度敏感度（单发 30 动能 · 每层 30 血 × 3 层）===')
const tiny = [{ s: 30, a: 30, h: 30 }]
const tinyChunks: Array<[DamageType, number]> = [['kinetic', 30]]
const save = chunks.splice(0, chunks.length, ...tinyChunks)
const tinyNow = volleysToKill(tiny)
const tinyBefore = volleysToKill(tiny, LEGACY_SHIM)
chunks.splice(0, chunks.length, ...save)
console.log(
  `  每层血 30 / 单发 30：新表 ${tinyNow} 发 · 旧表 ${tinyBefore} 发` +
    ` ⇒ ${(((tinyNow - tinyBefore) / tinyBefore) * 100).toFixed(1)}%（同一次改动，真实量级只有 +8.2%）`,
)
