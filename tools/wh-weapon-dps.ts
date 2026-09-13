/**
 * **虫洞专属武器 vs 制式 MK3 · 输出能力对比**（正式入库 · 2026-09-13）。
 *
 * 用途：回答"新武器到底比制式强多少"——**走引擎自身口径**（`createPlayerSpec` 在 T5 `sh-colossal` 上
 * 逐件只装一门武器、技能全 0、基础弹），读真实**单发 / 装填 / 射程**，再算标称 DPS = 单发 × 命中 × 1000/装填。
 *
 * 用法：`npx tsx tools/wh-weapon-dps.ts`
 *
 * 读数列义：
 * - 「标称 DPS」= **不含距离衰减、不含层位克制**的对单体口径（可横向比武器本体；实战还要乘衰减/克制）；
 * - 「含副段」= 把 `secondaryDamagePct`（掠袭破片炮的 +50% 动能）按同命中率折算进去；
 * - 「每发耗弹」> 1 表示该武器一发吃多发弹药（陵卫连装炮 = 2）⇒ 看"按弹药计的续航"要再折一半。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0** · 存档结构：**v25**（`CURRENT_STATE_VERSION`）
 *   - 最后核对：**2026-09-13**（当日核对：7 组配对 · 基础弹 dmg 6/7/9 · 参考船 `sh-colossal`）
 *   - 判据：`CURRENT_STATE_VERSION − v25 ≥ 2` ⇒ 必须重跑核对
 */import { addShipToFleet, createInitialState, createPlayerSpec } from '@whale/core'
import type { SimContext } from '@whale/core'
import { buildSimContext, MODULES } from '@whale/data'

const ctx: SimContext = buildSimContext()

const PAIRS: Array<[string, string | null, string]> = [
  ['mod-wh-a-frag', 'mod-turret-kin-3', 'A 掠袭破片炮 ↔ 攻坚炮台 MK3'],
  ['mod-wh-g-turret', 'mod-turret-kin-3', 'G 亡军残炮 ↔ 攻坚炮台 MK3'],
  ['mod-wh-d-turret', 'mod-turret-kin-3', 'D 陵卫连装炮 ↔ 攻坚炮台 MK3'],
  ['mod-wh-c-laser', 'mod-laser-3', 'C 生体棱镜束 ↔ 激光炮 MK3'],
  ['mod-wh-d-laser', 'mod-laser-3', 'D 陵寝棱镜炮 ↔ 激光炮 MK3'],
  ['mod-wh-c-missile', 'mod-missile-3', 'C 孢子导弹巢 ↔ 导弹架 MK3'],
  ['mod-wh-e-pd', 'mod-pd-e-3', 'E 巨构近防阵列 ↔ 近防炮 MK3'],
]
const AMMO: Record<string, string> = { kinetic: 'ammo-kinetic-l', explosive: 'ammo-explosive-l', plasma: 'ammo-plasma-l' }

interface Row {
  id: string
  name: string
  dmg: number
  hit: number
  reload: number
  range: number
  dps: number
  ammoPerShot: number
  secPct: number
  secType: string
  type: string
}
function measure(id: string): Row | null {
  const state = createInitialState({ nowWallMs: 0, seed: 5 })
  for (const k of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l', 'ammo-kinetic-2', 'ammo-explosive-2', 'ammo-plasma-2']) {
    state.warehouse.items[k] = 5_000
  }
  const uid = addShipToFleet(state, 'sh-colossal')
  state.fleet[uid]!.fitted = { high: [id], mid: [], low: [] }
  state.shipId = uid
  const spec = createPlayerSpec(state, ctx, uid)
  if (!spec) return null
  const w = spec.weapons.find((x) => x.kind !== 'fixed' || spec.weapons.length === 1)
  if (!w) return null
  const shots = w.shotsByType as Partial<Record<string, number>> | undefined
  const dmg = typeof w.shotDmg === 'number' ? w.shotDmg : Object.values(shots ?? {}).reduce((a, b) => a + (b ?? 0), 0)
  const hit = (w as unknown as { hitRate?: number }).hitRate ?? 1
  const reload = w.reloadMs
  const mod = MODULES.find((m) => m.id === id)!
  // 命中率取武器本体（spec 里不直接带）
  const hitRate = mod.hitRate ?? 1
  void hit
  return {
    id,
    name: mod.name,
    dmg,
    hit: hitRate,
    reload,
    range: w.maxRangeM,
    dps: (dmg * hitRate * 1000) / reload,
    ammoPerShot: w.ammoPerShot ?? 1,
    secPct: w.secondaryDamagePct ?? 0,
    secType: String(w.secondaryDamageType ?? '—'),
    type: String(mod.damageType ?? '—'),
  }
}

for (const [wh, mk3, label] of PAIRS) {
  const a = measure(wh)
  const b = mk3 ? measure(mk3) : null
  if (!a) {
    console.log(`${label}：未测到`)
    continue
  }
  const secDps = a.secPct > 0 ? (a.dmg * a.secPct * a.hit * 1000) / a.reload : 0
  console.log(
    `\n【${label}】\n` +
      `  虫洞 ${a.name}：单发 ${a.dmg.toFixed(1)}（${a.type}）· 命中 ${a.hit} · 装填 ${a.reload}ms · 射程 ${a.range}m · 每发耗弹 ${a.ammoPerShot}` +
      (secDps > 0 ? ` · 副段 +${(a.secPct * 100).toFixed(0)}% ${a.secType}` : '') +
      `\n     ⇒ 标称 DPS ${a.dps.toFixed(2)}${secDps > 0 ? `（含副段 ${(a.dps + secDps).toFixed(2)}）` : ''}` +
      (b
        ? `\n  制式 ${b.name}：单发 ${b.dmg.toFixed(1)}（${b.type}）· 命中 ${b.hit} · 装填 ${b.reload}ms · 射程 ${b.range}m · 每发耗弹 ${b.ammoPerShot}` +
          `\n     ⇒ 标称 DPS ${b.dps.toFixed(2)}` +
          `\n  **倍数：单发 ×${(a.dmg / b.dmg).toFixed(2)} · DPS ×${(a.dps / b.dps).toFixed(2)}` +
          `${secDps > 0 ? `（含副段 ×${((a.dps + secDps) / b.dps).toFixed(2)}）` : ''}**`
        : ''),
  )
}
