/**
 * V12 战斗校准工具：真实内容数据的"船 × 目标"预估胜率矩阵。
 *
 * 用法：npm run battle:calibrate
 * 说明（中文）：对每艘船两种装配（裸船 / MK1 轻炮）与两种炮术（0/5）计算 battleWinPreview
 * （期望推演，无随机），输出矩阵供人工核对 battle 常量（见 balance.ts battle 块）。
 * 数值初值 → 依据矩阵再做系统性校准（当前版本先人工阅读 + 后置自动断言）。
 */
import {
  addShipToFleet,
  battleWinPreview,
  createInitialState,
  type GameState,
  type SimContext,
} from '@whale/core'
import { ANOMALIES, MODULES, SHIPS, buildSimContext } from '@whale/data'

const ctx = buildSimContext()
const bal = ctx.balance.battle

/** 造状态：把船加进舰队（可选装配炮台），技能按档 */
function makeState(shipId: string, turretId: string | null, gunnery: number, seed = 1): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 10_000_000
  addShipToFleet(state, shipId)
  if (state.shipId !== shipId) {
    state.shipId = shipId
  }
  if (gunnery > 0) state.skills.trained['gunnery'] = gunnery
  if (turretId) {
    const fleet = state.fleet[shipId]!
    fleet.fitted = { miner: null, cargo: null, turret: turretId, shield: null, armor: null, propulsion: null }
  }
  return state
}

const TURRETS = ['mod-turret-civ', 'mod-turret-1', 'mod-turret-2', 'mod-turret-3', 'mod-turret-proto'] as const
const MOD = new Map(MODULES.map((m) => [m.id, m]))

function row(role: string, shipId: string, gunnery: number, turret: string | null): string {
  const state = makeState(shipId, turret, gunnery)
  const cells: string[] = []
  for (const a of ANOMALIES) {
    const p = battleWinPreview(state, ctx as SimContext, a, shipId)
    cells.push(`${Math.round(p * 100)}`)
  }
  const t = turret ? (MOD.get(turret)?.name ?? turret) : '裸船'
  return `${role}\t${shipId}\t${t}\t炮术${gunnery}\t${cells.join('\t')}`
}

function header(): string {
  return `role\tship\t装配\t技能\t${ANOMALIES.map((a) => a.name).join('\t')}`
}

console.log('══ V12 预估胜率矩阵（%） ══')
console.log(header())
for (const ship of SHIPS) {
  // 裸船（基础舰炮）
  console.log(row(ship.role, ship.id, 0, null))
  console.log(row(ship.role, ship.id, 5, null))
  // 与角色匹配的一档炮：武装/航运系用重型 MK2，其余轻型 MK1（展示各档差异取中）
  const turretId = ship.role === 'armed' || ship.role === 'hauler' ? 'mod-turret-2' : 'mod-turret-1'
  console.log(row(ship.role, ship.id, 5, turretId))
}
console.log('（敌方 threat 卡面：' + ANOMALIES.map((a) => `${a.name}=${a.threat}`).join('、') + '）')
void bal
