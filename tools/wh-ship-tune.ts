/**
 * 临时生成器：按船长 2026-09-13 口径重排 15 艘虫洞舰船并**回写 `packages/data/src/ships.ts`**。
 *
 * 口径（全部来自船长逐条裁定）：
 * - 子分类（D 巡洋无子分类）· 名字按子分类统一 · 平均强度 ≥ +10% · 削弱上限 −30% · 每艘 +1 槽位 · 增项上调
 * 用法：`npx tsx tools/_wh-ship-regen.ts`（dry-run 只打印）；加 `--write` 回写文件。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SHIPS, SHIP_BLUEPRINTS } from '@whale/data'

type Sub = {
  label: string
  name: string
  slot: 'high' | 'mid' | 'low'
  /** 三层血占比摆动（相对本船现值，之后归一到 Σ 目标） */
  swing: [number, number, number]
  /** 直接指定三层血（写了就跳过 Σ目标×摆动 的计算；用于"按船点名"的精确值） */
  layers?: [number, number, number]
  /** 直接指定槽位（写了就跳过"当前 +1 槽"的推导；用于船长点名的精确槽位） */
  slots?: { high: number; mid: number; low: number }
  /** 额外 HP 倍率（在 Σ 目标之上再乘；用于"重突 ×1.1"这类点名加成） */
  hpMul?: number
  speed: number
  agility: number
  evasion: number
  signal: number
  lock: number
  scan: number
  cargo: number
  famBonus?: { type: 'kinetic' | 'explosive' | 'plasma'; v: number }
  droneBonus?: number
  bayMul?: number
  hit?: number
  /** 直接追加到块里的原始字段行（新机制字段用；插在 `description` 之前） */
  extra?: string[]
  /** 该船的显式抗性（写了就覆盖族默认 RESIST） */
  resists?: { shieldResist?: Record<string, number>; armorResist?: Record<string, number>; hullResist?: Record<string, number> }
  /** 新的玩家可见说明（旧说明与新数值矛盾，必须同步重写） */
  desc: string
  note: string
}
/** 子分类（键 = 舰船 id） */
const SUB: Record<string, Sub> = {
  'sh-wh-a-frigate': { label: '电子舰', name: '掠袭电子舰', slot: 'mid', swing: [1.1, 1.0, 0.75], speed: 1.0, agility: 0.9, evasion: 1.2, signal: 1.0, lock: 1.5, scan: 1.5, cargo: 0.7, hit: 0.1, extra: ['    wormholeScanRadiusBonus: 1,'], desc: '海盗的电子战艇：火控与回避双高——先锁上、先打中，也更难被咬住；编入虫洞队伍即扩大扫描范围一圈（多艘可叠加）。', note: '**命中 +0.10 · 回避 +20%**（真吃战斗）· **虫洞扫码 +1 圈（编队即生效、可叠加）** · 分辨率 +50%（经济向）· 锁定 +50%（纯展示）｜ 货舱 −30% · 结构血占比 −25% · 机动 −10%' },
  'sh-wh-a-destroyer': { label: '炮艇', name: '掠袭炮艇', slot: 'high', swing: [0.8, 1.2, 1.0], speed: 1.0, agility: 1.0, evasion: 1.0, signal: 1.0, lock: 1.0, scan: 0.8, cargo: 0.7, famBonus: { type: 'kinetic', v: 0.15 }, hit: 0.03, extra: ['    weaponRangeBonusPct: { kinetic: 0.3 },'], desc: '海盗的炮艇：动能炮阵加持，动能武器射程再拉长三成——先在射程外开火；舱位很窄、护盾让位给装甲。', note: '**族武 动能 +0.15 · 动能武器射程 +30%** · 命中 +0.03 ｜ 货舱 −30% · 护盾血占比 −20% · 分辨率 −20%' },
  'sh-wh-a-cruiser': { label: '重型突击巡洋舰', name: '掠袭重型突击巡洋舰', slot: 'high', swing: [0.9, 1.15, 1.05], layers: [375, 225, 255], speed: 0.85, agility: 0.7, evasion: 1.0, signal: 1.2, lock: 1.0, scan: 1.0, cargo: 0.7, resists: { shieldResist: { kinetic: 0.5, explosive: 0.25, plasma: 0.25 }, armorResist: { kinetic: 0.25, explosive: 0.25, plasma: 0.25 }, hullResist: { kinetic: 0.25, explosive: 0.25, plasma: 0.25 } }, desc: '海盗的重型突击巡洋舰：三层抗性齐备、血量再厚一成，专啃硬目标；**没有额外火力加成**，代价是转身慢、舱位小。', note: '**三层抗性：0 抗一律 → 0.25**（护盾动能保留 0.5）· **三层血 ×1.1 = 855** · **移除族武 +0.15**（船长 2026-09-13）｜ 机动 −30% · 货舱 −30% · 信号 +20%' },
  'sh-wh-c-frigate': { label: '截击舰', name: '幼虫截击舰', slot: 'mid', swing: [0.7, 1.1, 1.2], speed: 1.35, agility: 1.35, evasion: 1.0, signal: 1.15, lock: 1.0, scan: 1.0, cargo: 0.7, hit: 0.04, desc: '巢群的活体截击舰：快得不像话，专咬落单的；护盾几乎不设防，靠一层甲壳与一副骨架撑住。', note: '速度 +35% · 机动 +35% · 命中 +0.04 ｜ 货舱 −30% · 护盾血占比 −30% · 信号 +15%' },
  'sh-wh-c-destroyer': { label: '截击舰', name: '甲壳截击舰', slot: 'mid', swing: [0.7, 1.1, 1.2], speed: 1.35, agility: 1.35, evasion: 1.0, signal: 1.15, lock: 1.0, scan: 1.0, cargo: 0.7, hit: 0.04, desc: '巢群的活体截击舰：速度与机动拉满，切入切出；护盾极薄，伤害全由甲与结构承担。', note: '同上（C 族两艘同子分类）' },
  'sh-wh-c-cruiser': { label: '重型突击巡洋舰', name: '巢群重型突击巡洋舰', slot: 'low', slots: { high: 4, mid: 3, low: 5 }, swing: [0.9, 1.15, 1.05], layers: [85, 455, 515], speed: 0.85, agility: 0.7, evasion: 1.0, signal: 1.2, lock: 1.0, scan: 1.0, cargo: 0.7, resists: { shieldResist: { kinetic: 0.25, explosive: 0.25, plasma: 0.25 }, armorResist: { explosive: 0.5, kinetic: 0.25, plasma: 0.25 }, hullResist: { kinetic: 0.25, explosive: 0.25, plasma: 0.25 } }, desc: '巢群的重型突击巡洋舰：三层抗性齐备、甲壳再厚一成，正面硬碰硬；**没有额外火力加成**，转身极慢。', note: '**三层抗性：0 抗一律 → 0.25**（甲爆炸保留 0.5）· **三层血 ×1.1 = 1055** · **移除族武 +0.15** · 低槽 +1 ｜ 机动 −30% · 货舱 −30% · 信号 +20%' },
  'sh-wh-d-frigate': { label: '电子舰', name: '哨戒电子舰', slot: 'mid', swing: [1.1, 1.0, 0.75], layers: [170, 35, 55], speed: 1.0, agility: 0.9, evasion: 1.55, signal: 1.0, lock: 1.5, scan: 1.5, cargo: 0.7, hit: 0.12, extra: ['    wormholeScanRadiusBonus: 1,'], resists: { shieldResist: { kinetic: 0.25, explosive: 0.25, plasma: 0.25 }, armorResist: { explosive: 0.5 }, hullResist: { kinetic: 0.25, explosive: 0.25, plasma: 0.25 } }, desc: '陵墓的电子哨戒舰：护盾占比全批最高、火控与回避一并拉高，替全队先敌开火；编入虫洞队伍即扩大扫描范围一圈（多艘可叠加）。', note: '**D 族特色 = 高护盾比（护盾 65%）** · **三层盾抗 0.25 + 甲爆炸 0.5** · **命中 +0.12 · 回避 +55%** · **虫洞扫码 +1 圈（编队即生效、可叠加）** · 分辨率 +50%（经济向）｜ 货舱 −30% · 机动 −10%' },
  'sh-wh-d-destroyer': { label: '指挥舰', name: '陵卫指挥舰', slot: 'mid', swing: [1.15, 1.0, 0.9], layers: [230, 75, 80], speed: 1.0, agility: 1.0, evasion: 0.9, signal: 1.0, lock: 1.55, scan: 1.55, cargo: 0.75, bayMul: 1.5, droneBonus: 0.08, hit: 0.05, extra: ['    fleetDamageBonusPct: 0.15,'], resists: { shieldResist: { kinetic: 0.25, explosive: 0.25, plasma: 0.25 }, armorResist: { explosive: 0.5 }, hullResist: { kinetic: 0.25, explosive: 0.25, plasma: 0.25 } }, desc: '陵墓的指挥舰：护盾占比高、并给**全编队**的单发伤害加一成半——多艘指挥舰只取最高、不叠加。代价是甲/壳薄：盾一破就很脆。', note: '**D 族特色 = 高护盾比（护盾 60%）** · **全舰单发伤害 +15%（取最高、不叠加）** · 机巢 +50% · 无人机伤害 +0.08 · 命中 +0.05 ｜ **速度/机动不再削**（2026-09-13 船长：D 组已非重装族，种族级削弱移除）· 货舱 −25%（子分类级）· 代价 = 甲/壳薄' },
  'sh-wh-d-cruiser': { label: '', name: '陵寝巡洋舰', slot: 'high', slots: { high: 4, mid: 4, low: 4 }, swing: [1.0, 1.0, 1.0], layers: [510, 155, 255], speed: 1.0, agility: 1.0, evasion: 1.0, signal: 1.0, lock: 1.0, scan: 1.0, cargo: 1.0, resists: { shieldResist: { kinetic: 0.25, explosive: 0.25, plasma: 0.25 }, armorResist: { explosive: 0.5 }, hullResist: { kinetic: 0.25, explosive: 0.25, plasma: 0.25 } }, desc: '陵墓的重装巡洋舰：**护盾占比全批最高**（不再靠总血厚）、炮位最多、舱容最大——靠盾与抗性站在阵线中央。', note: '**无子分类**；**D 族特色 = 高护盾比（护盾 55%）**· 三层盾抗 0.25 + 甲爆炸 0.5 · **血量由最厚 1000 → 920**（船长：移除"血量厚"特点）· 货舱 9000 · 槽 3/5/5 保留' },
  'sh-wh-e-frigate': { label: '鱼雷舰', name: '构件鱼雷舰', slot: 'high', swing: [1.0, 1.1, 1.1], speed: 1.0, agility: 1.0, evasion: 0.75, signal: 1.3, lock: 1.0, scan: 1.0, cargo: 1.0, famBonus: { type: 'explosive', v: 0.15 }, hit: 0.03, desc: '巨构的鱼雷舰：爆破弹头拆甲，命中扎实；信号大、转身笨，得靠队友挡在前面。', note: '族武 爆炸 +0.15 · 命中 +0.03 · 结构血占比提高 ｜ 回避 −25% · 信号 +30% · 机动 −15%' },
  'sh-wh-e-destroyer': { label: '无人机作战舰', name: '机库无人机作战舰', slot: 'mid', swing: [1.15, 0.9, 0.95], speed: 1.0, agility: 1.0, evasion: 1.0, signal: 1.0, lock: 1.0, scan: 1.0, cargo: 0.7, droneBonus: 0.1, bayMul: 1.5, hit: -0.02, desc: '巨构的无人机作战舰：机巢与无人机战力双高，是长时间放飞机群的移动机库；舱位与自射火力都让位给机群。', note: '无人机伤害 +0.10 · 机巢 +50% · CPU +15% ｜ 货舱 −30% · 命中 −0.02' },
  'sh-wh-e-carrier': { label: '无人机作战舰', name: '巨构无人机作战舰', slot: 'mid', swing: [1.15, 0.9, 0.95], speed: 1.0, agility: 1.0, evasion: 1.0, signal: 1.0, lock: 1.0, scan: 1.0, cargo: 0.7, droneBonus: 0.14, bayMul: 1.5, hit: -0.02, desc: '巨构的无人机作战舰：本批机巢最大、无人机伤害最高，放飞即是主武器；舱位让给机库，本舰火力偏辅助。', note: '无人机伤害 +0.14 · 机巢 +50% · CPU +15% ｜ 货舱 −30% · 命中 −0.02' },
  'sh-wh-g-frigate': { label: '侦察舰', name: '幽影侦察舰', slot: 'mid', swing: [1.15, 0.75, 0.85], speed: 1.05, agility: 1.0, evasion: 1.35, signal: 0.65, lock: 1.25, scan: 1.0, cargo: 0.7, hit: 0.06, extra: ['    wormholeScanRadiusBonus: 1,'], desc: '亡军的侦察舰：回避极高、火控不弱——编入虫洞队伍即扩大扫描范围一圈（多艘可叠加），它负责先看见别人。', note: '**回避 +35% · 命中 +0.06**（真吃战斗）· **虫洞扫码 +1 圈（编队即生效、可叠加）** · 信号 −35% · 锁定 +25%（纯展示，叙事用）｜ 货舱 −30% · 甲/壳血占比 −25%' },
  'sh-wh-g-destroyer': { label: '后勤舰', name: '亡军后勤舰', slot: 'low', swing: [1.2, 0.8, 1.0], speed: 1.0, agility: 1.0, evasion: 1.05, signal: 1.0, lock: 1.0, scan: 1.0, cargo: 1.45, bayMul: 1.5, hit: -0.03, desc: '亡军的后勤舰：货舱与机巢最大，跟着编队补给、换机；火力只求自保。', note: '货舱 +45% · 机巢 +50% · 回避 +5% ｜ 命中 −0.03 · 甲血占比 −20%' },
  'sh-wh-g-cruiser': { label: '鱼雷舰', name: '亡军鱼雷舰', slot: 'high', swing: [1.0, 1.1, 1.1], speed: 1.0, agility: 0.85, evasion: 0.75, signal: 1.3, lock: 1.0, scan: 1.0, cargo: 1.0, famBonus: { type: 'explosive', v: 0.15 }, hit: 0.03, desc: '亡军的鱼雷舰：爆破弹头配扎实命中，专挑大目标的装甲；信号大、转身慢，是明牌重锤。', note: '族武 爆炸 +0.15 · 命中 +0.03 · 结构血占比提高 ｜ 回避 −25% · 信号 +30% · 机动 −15%' },
}
/** Σ血目标比（族×档；平均 ≥1.10） */
const RATIO: Record<string, Record<number, number>> = {
  a: { 1: 1.05, 2: 1.15, 3: 1.15 },
  c: { 1: 1.12, 2: 1.2, 3: 1.2 },
  d: { 1: 1.12, 2: 1.25, 3: 1.25 },
  e: { 1: 1.12, 2: 1.15, 3: 1.15 },
  g: { 1: 1.08, 2: 1.12, 3: 1.12 },
}
const RESIST: Record<string, { shieldResist?: Record<string, number>; armorResist?: Record<string, number>; hullResist?: Record<string, number> }> = {
  a: { shieldResist: { kinetic: 0.5 } },
  c: { armorResist: { explosive: 0.5 }, hullResist: { kinetic: 0.25 } },
  d: { armorResist: { explosive: 0.5 }, shieldResist: { plasma: 0.25 } },
  e: { shieldResist: { kinetic: 0.5 }, hullResist: { plasma: 0.25 } },
  g: { shieldResist: { kinetic: 0.5 } },
}
/** 舰船图纸说明的"子分类一句话"（说明契约要求：提到的船名/数值必须与产物一致） */
const BP_LINE: Record<string, string> = {
  'sh-wh-a-frigate': '锁定与分辨率冠绝同级，先看见、先锁上。',
  'sh-wh-a-destroyer': '动能炮阵加持，正面火力扎实。',
  'sh-wh-a-cruiser': '动能火力全开、甲壳同步加厚，专啃硬目标。',
  'sh-wh-c-frigate': '快得不像话——护盾几乎不设防，靠甲壳撑着。',
  'sh-wh-c-destroyer': '速度与机动拉满，伤害全由甲与结构承担。',
  'sh-wh-c-cruiser': '能量主炮配厚甲厚壳，正面硬碰硬。',
  'sh-wh-d-frigate': '锁定与分辨率远压同级，替全队先敌发现。',
  'sh-wh-d-destroyer': '锁定、分辨率与机巢一并拉高，是编队的眼睛与中枢。',
  'sh-wh-d-cruiser': '三层血最厚、炮位最多，站在阵线中央扛火力。',
  'sh-wh-e-frigate': '爆破弹头拆甲，命中扎实。',
  'sh-wh-e-destroyer': '机巢与无人机战力双高，一座能跑的机库。',
  'sh-wh-e-carrier': '机巢最大、无人机伤害最高，放飞即是主武器。',
  'sh-wh-g-frigate': '信号极小、闪避极高——它负责先看见别人。',
  'sh-wh-g-destroyer': '货舱与机巢最大，跟着编队补给、换机。',
  'sh-wh-g-cruiser': '爆破弹头配扎实命中，专挑大目标的装甲。',
}
const slotOf = (s: (typeof SHIPS)[number]): Record<string, number> => s.slots as unknown as Record<string, number>
const sumHp = (s: (typeof SHIPS)[number]): number => (s.shieldHp ?? 0) + (s.armorHp ?? 0) + (s.hullHp ?? 0)
const r5 = (n: number): number => Math.max(5, Math.round(n / 5) * 5)
const r3 = (n: number): number => Math.round(n * 1000) / 1000
const median = (xs: number[]): number => {
  const v = [...xs].sort((a, b) => a - b)
  const m = Math.floor(v.length / 2)
  return v.length % 2 === 1 ? (v[m] as number) : ((v[m - 1] as number) + (v[m] as number)) / 2
}

const wh = SHIPS.filter((s) => s.id.startsWith('sh-wh-'))
const base = SHIPS.filter((s) => !s.id.startsWith('sh-wh-'))
// ⚠ **护栏：本工具只对"未调过的基线"运行**——它按现值 × 摆动重算，二次运行会**叠加**
//（货舱 −30% 会变成 −51%、槽位会再加一格、锁定 +50% 会变成 +125%）。
// 已调过的树上必须先 `git checkout -- packages/data/src/ships.ts packages/data/src/shipBlueprints.ts` 再跑。
// 判据读的是**源文件文本**（不能看 `@whale/data` 的导出：tsx 解析到的是构建产物，会滞后一步）。
const SHIPS_SRC = resolve(process.cwd(), 'packages/data/src/ships.ts')
if (readFileSync(SHIPS_SRC, 'utf8').includes('subClass:') && !process.argv.includes('--force')) {
  throw new Error(
    '检测到 packages/data/src/ships.ts 已带 subClass（= 已调过的树）⇒ 拒绝运行，避免二次叠加。\n' +
      '正确做法：git checkout -- packages/data/src/ships.ts packages/data/src/shipBlueprints.ts 后再跑本工具。',
  )
}
interface Out { id: string; name: string; sub: string; layers: [number, number, number]; cpu: number; slots: Record<string, number>; speed: number; agility: number; evasion: number; signal: number; lock: number; scan: number; cargo: number; bay: number; ratio: number; note: string }
const outs: Out[] = []
for (const s of wh) {
  const fam = s.id.split('-')[2]!
  const sub = SUB[s.id]!
  const peersExact = base.filter((b) => b.tier === s.tier && b.role === s.role)
  const peers = peersExact.length > 0 ? peersExact : base.filter((b) => b.tier === s.tier && b.role === 'armed')
  const refHp = median(peers.map(sumHp))
  const refCpu = median(peers.map((p) => p.cpu ?? 0))
  const target = r5(refHp * RATIO[fam]![s.tier]!)
  const cur: [number, number, number] = [s.shieldHp ?? 0, s.armorHp ?? 0, s.hullHp ?? 0]
  const swung = cur.map((v, i) => v * sub.swing[i]!)
  const k = target / swung.reduce((a, b) => a + b, 0)
  // 点名值优先（`layers` 直接给定；`hpMul` 再乘一道，例如"重突 ×1.1"）
  const layers = (sub.layers
    ? sub.layers.map((v) => r5(v * (sub.hpMul ?? 1)))
    : swung.map((v) => r5(v * k * (sub.hpMul ?? 1)))) as [number, number, number]
  const famCpu = 207 / 6 // 族池平均按 A 族≈34.5 统一取 40（保证新槽能装一件自家件）
  const cpu = Math.max(r5(refCpu * 1.1), r5((s.cpu ?? 0) + 40))
  const slots = sub.slots ? { ...sub.slots } : { ...slotOf(s) }
  if (!sub.slots && sub.label) slots[sub.slot] = (slots[sub.slot] ?? 0) + 1
  outs.push({
    id: s.id, name: sub.name, sub: sub.label || '（无子分类）', layers, cpu, slots,
    speed: Math.round((s.maxSpeedMps ?? 0) * sub.speed),
    agility: r3((s.agility ?? 0) * sub.agility),
    evasion: Math.max(0, r3((s.evasion ?? 0) * sub.evasion)),
    signal: Math.round((s.signatureM ?? 0) * sub.signal),
    lock: Math.round((s.lockRangeM ?? 0) * sub.lock),
    scan: Math.round((s.scanResMm ?? 0) * sub.scan),
    cargo: Math.round(s.cargoM3 * sub.cargo),
    bay: r5((s.droneBayM3 ?? 0) * (sub.bayMul ?? 1)),
    ratio: (layers[0]! + layers[1]! + layers[2]!) / refHp,
    note: sub.note,
  })
  void famCpu
}
console.log('| 舰船 | 改名 | 子分类 | 三层血 | CPU | 槽(高/中/低) | 速/机动/回避 | 信号/锁定/分辨率 | 货舱/机巢 | 比 |')
console.log('|---|---|---|---|---|---|---|---|---|---|')
for (const o of outs) {
  console.log(`| \`${o.id}\` | ${o.name} | ${o.sub} | ${o.layers.join('/')} | ${o.cpu} | ${o.slots.high}/${o.slots.mid}/${o.slots.low} | ${o.speed}/${o.agility}/${o.evasion} | ${o.signal}/${o.lock}/${o.scan} | ${o.cargo}/${o.bay} | ${o.ratio.toFixed(2)} |`)
}
console.log(`\n平均强度 = ${(outs.reduce((a, o) => a + o.ratio, 0) / outs.length).toFixed(3)}`)

if (process.argv.includes('--write')) {
  const path = resolve(process.cwd(), 'packages/data/src/ships.ts')
  // ⚠ 源文件是 **CRLF**：先归一成 LF 便于按行正则，写回时再还原 CRLF（编码纪律）
  let text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  for (const o of outs) {
    const s = wh.find((x) => x.id === o.id)!
    const sub = SUB[o.id]!
    const fam = o.id.split('-')[2]!
    const re = new RegExp(`(  \\{\\n    id: '${o.id}',[\\s\\S]*?\\n  \\},)`)
    const m = text.match(re)
    if (!m) throw new Error(`未命中 ${o.id}`)
    let blk = m[1]!
    const setNum = (key: string, val: number): void => { blk = blk.replace(new RegExp(`(${key}: )-?[0-9_.]+`), `$1${val}`) }
    blk = blk.replace(/(name: ')[^']*(')/, `$1${o.name}$2`)
    if (sub.label && !blk.includes('subClass:')) blk = blk.replace(/(\n    role: '[^']*',)/, `$1\n    subClass: '${sub.label}',`)
    // 子分类设计口径注释（挂在 subClass 行后；字段上的旧数值注释在下面统一清掉，避免与新数值矛盾）
    if (sub.label && !blk.includes('子分类「')) {
      blk = blk.replace(/(\n    subClass: '[^']*',)/, `$1\n    // 子分类「${sub.label}」（船长 2026-09-13）：${sub.note}`)
    }
    // 清掉本次改动字段上的旧尾注释（旧值已变，留着就是错的）
    blk = blk.replace(
      /^(\s*)(shieldHp|armorHp|hullHp|cpu|agility|evasion|hitBonus|powerBonus|droneBayM3|maxSpeedMps|lockRangeM|signatureM|scanResMm|cargoM3|slots): ([^,\n]+), \/\/ .*$/gm,
      '$1$2: $3,',
    )
    // 玩家可见说明同步重写（旧说明与新数值矛盾）
    blk = blk.replace(/(\n    description: ')[^']*(')/, `$1${sub.desc}$2`)
    setNum('shieldHp', o.layers[0]!)
    setNum('armorHp', o.layers[1]!)
    setNum('hullHp', o.layers[2]!)
    setNum('cpu', o.cpu)
    setNum('maxSpeedMps', o.speed)
    setNum('agility', o.agility)
    setNum('evasion', o.evasion)
    setNum('signatureM', o.signal)
    setNum('lockRangeM', o.lock)
    setNum('scanResMm', o.scan)
    setNum('cargoM3', o.cargo)
    setNum('droneBayM3', o.bay)
    blk = blk.replace(/(slots: \{ high: )[0-9]+(, mid: )[0-9]+(, low: )[0-9]+/, `$1${o.slots.high}$2${o.slots.mid}$3${o.slots.low}`)
    const hit = r3((s.hitBonus ?? 0) + (sub.hit ?? 0))
    setNum('hitBonus', hit)
    const res = sub.resists ?? RESIST[fam]!
    const resLines = [
      res.shieldResist ? `    shieldResist: ${JSON.stringify(res.shieldResist)},` : '',
      res.armorResist ? `    armorResist: ${JSON.stringify(res.armorResist)},` : '',
      res.hullResist ? `    hullResist: ${JSON.stringify(res.hullResist)},` : '',
    ].filter(Boolean).join('\n')
    // 抗性：点名值优先（覆盖族默认）；已有抗性行的船先删旧行再插新行
    if (resLines) {
      blk = blk.replace(/^ {4}(shieldResist|armorResist|hullResist): .*$\n?/gm, '')
      blk = blk.replace(/(\n    description:)/, `\n${resLines}$1`)
    }
    if (sub.famBonus && !blk.includes('weaponFamilyBonus:')) {
      blk = blk.replace(/(\n    description:)/, `\n    weaponFamilyBonus: { ${sub.famBonus.type}: ${sub.famBonus.v} },\n    description:`)
    }
    if (sub.droneBonus && !blk.includes('droneDmgBonus:')) {
      blk = blk.replace(/(\n    description:)/, `\n    droneDmgBonus: ${sub.droneBonus},\n    description:`)
    }
    // 新机制字段（点名追加；重复运行不叠加）
    for (const line of sub.extra ?? []) {
      const key = line.trim().split(':')[0]!
      if (!blk.includes(`${key}:`)) blk = blk.replace(/(\n    description:)/, `\n${line}$1`)
    }
    text = text.replace(m[1]!, blk)
  }
  // ── 舰船图纸同步：改名 + 重写说明（说明契约会核对"说明里的船名/数值 = 产物实际"）──
  const bpPath = resolve(process.cwd(), 'packages/data/src/shipBlueprints.ts')
  let bpText = readFileSync(bpPath, 'utf8').replace(/\r\n/g, '\n')
  for (const o of outs) {
    const one = BP_LINE[o.id]!
    const re = new RegExp(`(\\{\\n    id: 'sbp-${o.id.replace('sh-', '')}'[\\s\\S]*?\\n  \\},)`)
    const mm = bpText.match(re)
    if (!mm) throw new Error(`蓝图未命中 sbp-${o.id}`)
    let b = mm[1]!
    b = b.replace(/(name: ')[^']*(')/, `$1${o.name}图纸（一次性）$2`)
    b = b.replace(/(description: ')[^']*(')/, `$1「${o.name}」总装图纸，写在整块母岩切片上——**只能用一次**。${one}$2`)
    bpText = bpText.replace(mm[1]!, b)
  }
  const enc = new TextEncoder()
  writeFileSync(path, enc.encode(text.replace(/\n/g, '\r\n')))
  writeFileSync(bpPath, enc.encode(bpText.replace(/\n/g, '\r\n')))
  console.log(`\n✅ 已回写 ${path}（${outs.length} 艘）与 ${bpPath}（图纸 ${outs.length} 张）`)
}
