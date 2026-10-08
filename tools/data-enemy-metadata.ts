/** 显式刷新编辑器来源描述；不写数字参数，名称/编成仍以代码目录为准。 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ANOMALIES, FOE_SHIPS, FOE_DRONES } from '@whale/data'
import { FOE_MOUNTS } from '@whale/core'
import type { EnemyDataTable } from './data-editor-contract'
import type { EnemySourceRow } from './data-editor-enemy-schema'
const file = resolve(process.cwd(), 'packages/data/src/static/enemyFields.json')
const meta = JSON.parse(readFileSync(file, 'utf8')) as Record<EnemyDataTable, EnemySourceRow[]>
const tableOf = (id: string): EnemyDataTable => meta.invasionFleets.some(row => row.id === id) ? 'invasionFleets' : meta.wormholeFleets.some(row => row.id === id) ? 'wormholeFleets' : 'bounties'
for (const [table, rows] of Object.entries(meta) as Array<[EnemyDataTable, EnemySourceRow[]]>) for (const row of rows) {
  const ship = FOE_SHIPS.find(ship => ship.id === row.id)
  const card = ANOMALIES.find(card => card.id === row.id)
  const drone = FOE_DRONES.find(drone => drone.id === row.id)
  row.name = ship?.name ?? card?.name ?? drone?.name ?? FOE_MOUNTS[row.id as keyof typeof FOE_MOUNTS]?.name ?? row.name
  row.entries = card?.ships?.map((slot, index) => ({ index, name: slot.ship.name, id: slot.ship.id, type: 'ships',
    note: `挂载：${slot.mounts === undefined ? '继承舰级' : '条目替换'}；${slot.firepowerAnchor !== undefined ? '总单发锚点优先于火力倍率' : '沿用源倍率'}；未设覆写项继承舰级`,
  })) ?? ship?.drones?.map((slot, index) => ({ index, name: slot.drone.name, id: slot.drone.id, type: 'drones', note: '舰级携带机型；数量为源参数' })) ?? []
  const usedShips = FOE_SHIPS.filter(item => table === 'foeShips' ? item.id === row.id || row.id === 'c-family-resists' && item.family === 'C' : table === 'foeDrones' ? item.drones?.some(slot => slot.drone.id === row.id || row.id === 'g-bee-shared' && slot.drone.id.startsWith('foe-drone-g-bee-')) : table === 'foeMounts' && item.mounts?.some(id => id === row.id))
  row.references = ANOMALIES.filter(item => item.ships?.some(slot => usedShips.includes(slot.ship) || table === 'foeMounts' && (slot.mounts ?? slot.ship.mounts)?.some(id => id === row.id))).map(card => ({ table: tableOf(card.id), id: card.id, name: card.name }))
  row.notes = [...(table === 'bounties' && card?.hidden ? ['隐藏旧遭遇兼容卡，不属于当前常驻悬赏。'] : []), ...(ship?.dmgMix?.plasma && ship.energyForm !== 'spit' ? ['能量光束不消费命中参数，其他弹系仍按引擎取值。'] : [])]
}
writeFileSync(file, JSON.stringify(meta, null, 2) + '\n', 'utf8')
console.log('敌人名称、具名编队与影响引用已刷新；数字参数未写入。')
