/**
 * 正式工具：**舰船血量读数表**（档位 × 角色）＋**非战斗舰血量基准核算**。
 *
 * 用途（2026-09-15 船长定「非战斗舰血量 = 同档官方战斗舰总血中位 × 0.8」之后常驻）：
 * - 打印全部舰船的三层血量（盾/甲/结构）与总血，按档位 → 角色分组；
 * - 打印各档**官方战斗舰**（role `armed`/`armored`，**不含**虫洞专属 `sh-wh-*`）的总血
 *   中位 / 均值 / 最低 / 最高，以及 ×0.8 的目标值；
 * - 列出**非战斗舰**（`industrial` / `hauler`）现状与目标差额，并给出"按原比例放大三层"的推荐值
 *   （取整余数记入结构层 ⇒ 总血恰为目标）；
 * - 附一条**低安遇袭一口伤害占比**读数（一口 = 威胁 × `foeDpsPerThreat` × `hitFirepowerSec`）。
 *
 * 用法：`npm run ship:hp`（纯读数，不改任何数据）。
 * 口径出处：`packages/data/src/ships.ts` 头注「2026-09-15 船长定」段 ＋
 * `tools/content-check.ts` 的「非战斗舰血量契约」（同表，两处必须同步）。
 */
import { DEFAULT_BALANCE } from '@whale/core'
import { SHIPS } from '@whale/data'

/** 非战斗舰目标总血（与 content-check 的 `CIVILIAN_HP_TARGET` 同源；改一处必改另一处） */
const CIVILIAN_HP_TARGET: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 182, 2: 307, 3: 540, 4: 1018, 5: 1884 }
/** 低安遇袭读数的参考威胁（入门低安卡「烬火围攻战」） */
const AMBUSH_THREAT = 42

interface Row {
  id: string
  name: string
  role: string
  sub: string
  tier: number
  s: number
  a: number
  h: number
  total: number
  /** 虫洞专属（`sh-wh-*`）：算不算"官方同级" */
  wh: boolean
}

const rows: Row[] = SHIPS.map((s) => {
  const meta = s as unknown as { subClass?: string }
  return {
    id: s.id,
    name: s.name,
    role: String(s.role),
    sub: meta.subClass ?? '',
    tier: s.tier,
    s: s.shieldHp,
    a: s.armorHp,
    h: s.hullHp,
    total: s.shieldHp + s.armorHp + s.hullHp,
    wh: s.id.startsWith('sh-wh-'),
  }
})

const TIERS: Array<1 | 2 | 3 | 4 | 5> = [1, 2, 3, 4, 5]
const isCombat = (r: Row): boolean => !r.wh && (r.role === 'armed' || r.role === 'armored')
const isCivilian = (r: Row): boolean => r.role === 'industrial' || r.role === 'hauler'
const median = (xs: number[]): number => {
  const v = [...xs].sort((a, b) => a - b)
  const n = v.length
  if (n === 0) return 0
  return n % 2 === 1 ? v[(n - 1) / 2]! : Math.round((v[n / 2 - 1]! + v[n / 2]!) / 2)
}
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length))

console.log('=== 舰船三层血量（按档位 → 角色）===')
for (const t of TIERS) {
  const list = rows.filter((r) => r.tier === t)
  if (list.length === 0) continue
  console.log(`\n—— T${t} ——`)
  for (const r of list.sort((a, b) => a.role.localeCompare(b.role) || b.total - a.total)) {
    console.log(
      `  ${r.id.padEnd(22)} ${r.name.padEnd(16)} ${(r.role + (r.sub ? `/${r.sub}` : '')).padEnd(20)}` +
        ` 盾${String(r.s).padStart(4)} 甲${String(r.a).padStart(4)} 结${String(r.h).padStart(4)} ⇒ 总 ${String(r.total).padStart(4)}` +
        `${r.wh ? '  [虫洞专属]' : ''}`,
    )
  }
}

console.log('\n=== 各档官方战斗舰（armed/armored，不含虫洞专属）与「中位 ×0.8」目标 ===')
for (const t of TIERS) {
  const combat = rows.filter((r) => r.tier === t && isCombat(r))
  if (combat.length === 0) {
    console.log(`T${t}：无官方战斗舰`)
    continue
  }
  const totals = combat.map((r) => r.total)
  const mid = median(totals)
  console.log(
    `T${t}：${combat.length} 艘（${combat.map((r) => r.id).join(' / ')}）\n` +
      `      总血 中位 **${mid}** · 均值 ${mean(totals)} · 最低 ${Math.min(...totals)} · 最高 ${Math.max(...totals)}` +
      ` ⇒ 目标（中位×0.8）= **${CIVILIAN_HP_TARGET[t]}**${Math.round(mid * 0.8) === CIVILIAN_HP_TARGET[t] ? ' ✓' : `（中位×0.8 = ${Math.round(mid * 0.8)}，与契约表不一致，请核）`}`,
  )
}

console.log('\n=== 非战斗舰（industrial / hauler）：现状 ↔ 目标 ===')
const ambushHit = Math.max(
  1,
  Math.max(1, AMBUSH_THREAT) * DEFAULT_BALANCE.battle.foeDpsPerThreat * DEFAULT_BALANCE.encounter.hitFirepowerSec,
)
for (const r of rows.filter(isCivilian).sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id))) {
  const target = CIVILIAN_HP_TARGET[r.tier as 1 | 2 | 3 | 4 | 5]
  const f = target / r.total
  const ns = Math.round(r.s * f)
  const na = Math.round(r.a * f)
  const drift = target - (ns + na + Math.round(r.h * f))
  const ok = r.total === target ? '✓' : `✗（差 ${target - r.total}）`
  console.log(
    `${r.id.padEnd(16)} T${r.tier}  ${String(r.s).padStart(4)}/${String(r.a).padStart(4)}/${String(r.h).padStart(4)} = ${String(r.total).padStart(4)} ${ok}` +
      ` · 按比例放大建议 ${ns}/${na}/${Math.round(r.h * f) + drift}（×${f.toFixed(2)}）` +
      ` · 一口遇袭 ${ambushHit} 占总血 ${((ambushHit / r.total) * 100).toFixed(1)}%${ambushHit <= r.a ? '（不破甲）' : '（会咬到结构）'}`,
  )
}
console.log(
  `\n（一口遇袭 = 威胁 ${AMBUSH_THREAT} × battle.foeDpsPerThreat ${DEFAULT_BALANCE.battle.foeDpsPerThreat}` +
    ` × encounter.hitFirepowerSec ${DEFAULT_BALANCE.encounter.hitFirepowerSec} 秒 = ${ambushHit} HP；` +
    `口径见 core/hullDamage.ts 的 firepowerHitHp 与 core/encounters.ts）`,
)
