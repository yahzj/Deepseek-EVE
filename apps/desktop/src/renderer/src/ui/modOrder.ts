/**
 * **装备库的展示顺序（单点）**——2026-09-24 船长报障：
 * 「物品仓库页面的装备（装备库）排序有问题，现在的排列很混乱，希望**按照武器攻击类别，rank 从低到高排序**」。
 *
 * ## 病根（如实记）
 * 原先装备库直接 `Object.entries(state.moduleBay)` 渲染 ⇒ 顺序 = **获得/存盘顺序**（战士先捡到的排前面），
 * 页面既不按类别也不按档位，看着就是"乱的"。
 *
 * ## 现行口径（船长 2026-09-24 选定「按你推荐来」）
 * 主键 **① 攻击类别**（`kinetic` 动能 → `explosive` 爆破 → `plasma` 能量；与 `DMG_ORDER` 同序）⇒
 * 次键 **② 档位（rank）从低到高**：
 * - **基础型号**（民用 / MK1 / MK2 / MK3 / 异星原型）按 `MOD_FRAME_RANK` 升序；**rank 直接取自 id 的单点规则**
 *   （`civ` -1 · 无后缀 0 · `-1` 1 · `-2` 2 · `-3` 3 · `proto` 3.5）——不靠中文名正则，改名不影响排序；
 * - **势力 / 虫洞专属件**（`mod-lair-*` / `mod-wh-*`）没有 MK 档，**统一排在该类别末尾**、内部按
 *   **名义火力**（`dmgMult × shots ÷ 装填秒`）**由低到高**（同值再按 id，保证稳定）。
 *   为什么不用别的尺：名义火力是玩家一眼能比的量纲，且完全由数据决定、不写死表。
 * - **非武器件**（护盾/装甲/推进/采集/支援…）排在**武器之后**，按核心既有的槽位展示顺序
 *   （`MODULE_SLOTS`）分组，组内按**名称**（同值再按 id）。
 *
 * ⚠ 只决定**展示顺序**：不动任何数据/数值/存档；也不改变筛选（筛选仍在 `itemSubs.ts` 的单点里）。
 */
import { MODULE_SLOTS } from '@whale/core'
import type { DamageType, ModuleDef, ModuleSlot } from '@whale/core'

/** 攻击类别顺序（与战斗画面 `DMG_ORDER`、`DMG_LABEL` 同一套键） */
export const MOD_DMG_ORDER: readonly DamageType[] = ['kinetic', 'explosive', 'plasma']

/** 型号档位（越小越靠前）。民用 = 入门件；异星原型排在 MK3 之后半档（它在数据里确实强于 MK3）。 */
export const MOD_FRAME_RANK: Record<string, number> = {
  civ: -1,
  base: 0,
  mk1: 1,
  mk2: 2,
  mk3: 3,
  proto: 3.5,
  /** 势力 / 虫洞专属件：无 MK 档 ⇒ 排在本类别末尾 */
  special: Number.POSITIVE_INFINITY,
}

/** 从 id 取型号（**单点规则**）：`mod-<槽>[-<系>]-<档>`
 *
 * ⚠ **武器件优先判"势力/虫洞专属"**：`mod-lair-*` / `mod-wh-*` 里也有以 `-1/-2/-3` 结尾的名字
 * （例：虫洞专属「近防炮 MK1」= `mod-wh-e-pd`），只按后缀判会把它错认成基础型号 MK1、插进基础段
 * ——2026-09-24 契约工具第一次跑就抓到了这一条。非武器件不走这条优先判（它们的 `-1/-2/-3` 就是档位）。
 */
export function modFrameOf(def: Pick<ModuleDef, 'id' | 'damageType'>): keyof typeof MOD_FRAME_RANK {
  const tail = def.id.replace(/^mod-/, '')
  if (def.damageType !== undefined && /^(lair|wh)-/.test(tail)) return 'special'
  if (/(^|-)civ$/.test(tail) || /-civ(-|$)/.test(tail)) return 'civ'
  if (/(^|-)proto$/.test(tail) || /-proto(-|$)/.test(tail)) return 'proto'
  if (/-3$/.test(tail)) return 'mk3'
  if (/-2$/.test(tail)) return 'mk2'
  if (/-1$/.test(tail)) return 'mk1'
  // 其余无名后缀件（含非武器的 `mod-lair-*` / `mod-wh-*`）：一律当"专属"
  if (/^(lair|wh)-/.test(tail)) return 'special'
  return 'base'
}

/**
 * 名义火力（**仅供"同类别内势力/专属件"的次序参照**）。
 *
 * ⚠ **两种数据形态都要吃**：基础型号写 `dmgMult`（相对倍率，民用 1.0 起）、
 * 势力/专属件**直接写绝对值单发**（`dmgMult: 11.5` 那种）——两者量纲不同，故取**数值**而不区分来源；
 * 没有 `reloadMs` 的件返回 0（排在组内最前）。非武器件恒 0。
 */
export function nominalDpsOf(def: ModuleDef): number {
  if (def.dmgMult === undefined || !def.reloadMs) return 0
  return (def.dmgMult * (def.shots ?? 1)) / (def.reloadMs / 1000)
}

/** 是否"能打伤害的武器件"（判据 = 有 `damageType`；全仓 26 件） */
export function isWeaponModule(def: ModuleDef): boolean {
  return def.damageType !== undefined
}

/** 武器槽（三类武器的物理槽位）；非武器件没有位置 —— 它们排在武器之后 */
const WEAPON_SLOTS: readonly ModuleSlot[] = ['turret', 'missile', 'laser']

/** 排序键：`[武器段 0/1, 类别序, 档位, 火力, 槽位序, 名称, id]`（逐段比较，任意一段不同即定序） */
export function modOrderKey(def: ModuleDef): [number, number, number, number, number, string, string] {
  const slotIdx = MODULE_SLOTS.indexOf(def.slot)
  if (isWeaponModule(def)) {
    const dt = MOD_DMG_ORDER.indexOf(def.damageType as DamageType)
    const frame = MOD_FRAME_RANK[modFrameOf(def)] ?? 0
    return [0, dt < 0 ? MOD_DMG_ORDER.length : dt, frame, nominalDpsOf(def), slotIdx, def.name, def.id]
  }
  return [1, 0, 0, 0, slotIdx, def.name, def.id]
}

/** 通用比较：逐段比，数字比大小、字符串比字典序 */
export function compareModOrder(a: ModuleDef, b: ModuleDef): number {
  const ka = modOrderKey(a)
  const kb = modOrderKey(b)
  for (let i = 0; i < ka.length; i++) {
    const x = ka[i] as number | string
    const y = kb[i] as number | string
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return String(x).localeCompare(String(y), 'zh-Hans-CN')
  }
  return 0
}

/** 把装备库条目（`[id, 数量]`）按上式排好；查不到的 id 排在最后（原样保留，不丢条目）
 *  ⚠ 形参收 **`ReadonlyMap`**（`SimContext.modules` 就是只读表；写成 `Map` 会 typecheck 报错）。 */
export function sortModEntries(
  entries: ReadonlyArray<readonly [string, number]>,
  ctx: { modules: ReadonlyMap<string, ModuleDef> },
): Array<[string, number]> {
  const known: Array<[string, number]> = []
  const unknown: Array<[string, number]> = []
  for (const e of entries) (ctx.modules.has(e[0]) ? known : unknown).push([e[0], e[1]])
  known.sort((x, y) => compareModOrder(ctx.modules.get(x[0])!, ctx.modules.get(y[0])!))
  unknown.sort((x, y) => x[0].localeCompare(y[0]))
  return [...known, ...unknown]
}
