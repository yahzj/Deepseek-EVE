/**
 * **装备库展示顺序 · 契约与读数**（正式工具 · 2026-09-24 船长报障后入库）。
 *
 * 船长原话：「**物品仓库页面的装备（装备库）排序有问题，现在的排列很混乱，希望按照武器攻击类别，
 * rank 从低到高排序。**」⇒ 口径与单点见 `apps/desktop/src/renderer/src/ui/modOrder.ts`
 * （攻击类别 → 档位从低到高；势力/专属件排该类别末尾、内部按名义火力升序；非武器件按槽位分组在后）。
 *
 * 本工具做两件事（**只读**，不写任何文件）：
 * 1. **契约核对**（不过即红 `exit 1`）——用**真排序函数**排一遍全目录，校验：
 *    ① 武器段在前、非武器段在后；
 *    ② 同类别内**档位单调不减**（民用 → MK1 → MK2 → MK3 → 异星原型），
 *       且**势力/专属件一律排在基础型号之后**；
 *    ③ **MK1/MK2/MK3 三个基础型号在每一类里齐备且次序正确**（**民用档只有动能系有**，故不强制）；
 *    ④ 非武器件按槽位展示顺序（`MODULE_SLOTS`）分组、组内有序。
 * 2. **读数**——把三类武器的完整顺序摊出来，供船长一眼核对（`--all` 连非武器件一起印）。
 *
 * 用法：`npx tsx tools/mod-order-check.ts [--all]`
 */
import { MODULES } from '../packages/data/src/modules'
import { MODULE_SLOTS } from '@whale/core'
import { compareModOrder, isWeaponModule, modFrameOf, nominalDpsOf } from '../apps/desktop/src/renderer/src/ui/modOrder'
import type { DamageType, ModuleDef } from '../packages/core/src/types'

const DT_LABEL: Record<DamageType, string> = { kinetic: '动能', explosive: '爆破', plasma: '能量' }
const FRAME_LABEL: Record<string, string> = {
  civ: '民用',
  base: '基础',
  mk1: 'MK1',
  mk2: 'MK2',
  mk3: 'MK3',
  proto: '异星原型',
  special: '势力/专属',
}
const ORDER: readonly DamageType[] = ['kinetic', 'explosive', 'plasma']
const errors: string[] = []

const sorted = [...(MODULES as ModuleDef[])].sort(compareModOrder)
const weapons = sorted.filter(isWeaponModule)
const others = sorted.filter((m) => !isWeaponModule)

/* ── ① 段序：武器在前 ── */
const firstOther = sorted.findIndex((m) => !isWeaponModule(m))
const lastWeapon = sorted.map(isWeaponModule).lastIndexOf(true)
if (firstOther >= 0 && lastWeapon > firstOther) {
  errors.push('武器段与非武器段交错：先出现的非武器件在第 ' + (firstOther + 1) + ' 位，而武器最后一件在第 ' + (lastWeapon + 1) + ' 位')
}

/* ── ② / ③ 逐类别核：档位单调不减、专属件在后、四档齐备 ── */
for (const dt of ORDER) {
  const group = weapons.filter((m) => m.damageType === dt)
  if (group.length === 0) {
    errors.push(`类别 ${DT_LABEL[dt]} 一件武器都没有（数据异常）`)
    continue
  }
  const frames = group.map((m) => modFrameOf(m))
  const firstSpecial = frames.indexOf('special')
  if (firstSpecial >= 0) {
    const after = frames.slice(firstSpecial)
    if (after.some((f) => f !== 'special')) {
      errors.push(`类别 ${DT_LABEL[dt]}：势力/专属件之后又出现了基础型号（${after.join(' → ')}）`)
    }
  }
  const baseFrames = frames.filter((f) => f !== 'special')
  const rank = (f: string): number =>
    f === 'civ' ? -1 : f === 'base' ? 0 : f === 'mk1' ? 1 : f === 'mk2' ? 2 : f === 'mk3' ? 3 : 3.5
  for (let i = 1; i < baseFrames.length; i++) {
    if (rank(baseFrames[i]!) < rank(baseFrames[i - 1]!)) {
      errors.push(`类别 ${DT_LABEL[dt]}：档位不是从低到高（${FRAME_LABEL[baseFrames[i - 1]!] ?? baseFrames[i - 1]} → ${FRAME_LABEL[baseFrames[i]!] ?? baseFrames[i]}）`)
    }
  }
  /** ⚠ 只要求 **MK1/MK2/MK3 齐备**（三系都有）；**民用档只有动能系有**（`mod-turret-civ`）
   *  —— 契约不该要求数据里不存在的东西（第一版写了 civ，被自己的工具判红，已改）。 */
  for (const need of ['mk1', 'mk2', 'mk3'] as const) {
    if (!baseFrames.includes(need)) errors.push(`类别 ${DT_LABEL[dt]}：基础型号缺 ${FRAME_LABEL[need]}`)
  }
  // 势力件内部按名义火力升序
  const specials = group.filter((m) => modFrameOf(m) === 'special')
  for (let i = 1; i < specials.length; i++) {
    const a = nominalDpsOf(specials[i - 1]!)
    const b = nominalDpsOf(specials[i]!)
    if (b < a) {
      errors.push(`类别 ${DT_LABEL[dt]}：势力件未按名义火力升序（${specials[i - 1]!.name} ${a.toFixed(2)} → ${specials[i]!.name} ${b.toFixed(2)}）`)
    }
  }
}

/* ── ④ 非武器件：槽位顺序单调不减 ── */
let lastSlot = -1
for (const m of others) {
  const idx = MODULE_SLOTS.indexOf(m.slot)
  if (idx < lastSlot) errors.push(`非武器件槽位顺序回退：${m.name}（${m.slot}）出现在更靠后的槽位之后`)
  lastSlot = Math.max(lastSlot, idx)
}

/* ── 读数 ── */
console.log('· 装备库展示顺序（前 26 件 = 武器段，按攻击类别 → 档位从低到高）：')
console.log('  #   类别  型号        名称                        CPU  名义火力')
weapons.forEach((m, i) => {
  const dt = DT_LABEL[m.damageType as DamageType] ?? String(m.damageType)
  const frame = FRAME_LABEL[modFrameOf(m)] ?? modFrameOf(m)
  const dps = nominalDpsOf(m)
  console.log(
    `  ${String(i + 1).padStart(3)} ${dt.padEnd(5)} ${frame.padEnd(11)} ${m.name.padEnd(26)} ${String(m.cpuUse).padStart(4)}  ${dps > 0 ? dps.toFixed(2) : '—'}`,
  )
})
console.log(`\n· 非武器件 ${others.length} 件：按槽位分组（${MODULE_SLOTS.filter((s) => others.some((m) => m.slot === s)).join(' → ')}）`)
if (process.argv.includes('--all')) {
  console.log('  #   槽位          名称                        CPU')
  others.forEach((m, i) => {
    console.log(`  ${String(i + 1).padStart(3)} ${m.slot.padEnd(13)} ${m.name.padEnd(26)} ${String(m.cpuUse).padStart(4)}`)
  })
}

if (errors.length > 0) {
  console.error('')
  for (const e of errors) console.error('❌ ' + e)
  console.error(`❌ 装备库排序契约未通过：${errors.length} 条`)
  process.exit(1)
}
console.log('')
console.log('✅ 装备库排序契约通过：武器段在前（动能 → 爆破 → 能量）· 各类别档位从低到高（民用 → MK1 → MK2 → MK3 → 异星原型）· 势力/专属件排各类末尾且按名义火力升序 · 非武器件按槽位分组在后。')
