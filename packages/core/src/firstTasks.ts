import type { GameState } from './state'
import type { SimContext } from './types'
const DSI_FACTION_ID = 'dsi'
const WORMHOLE_UNLOCK_STANDING = 40

export type FirstStatKey =
  | 'mineUnits'
  | 'salvageRuns'
  | 'repairs'
  | 'bountyWins'
  | 'refineBatches'
  | 'produceUnits'
  | 'orders'
  | 'marketIncome'
  | 'ships'
  | 'aiAssigns'
  | 'haulTrips'
  | 'wormholeRuns'
  | 'rareBoxes'
  | 'whMaxDepth'
  | 'whBossClears'
  | 'matterTechMaxed'
  | 'aiCoreKinds'
  | 'sitesBuilt'

export interface FirstReward {
  isk?: number
  blueprints?: ReadonlyArray<{ blueprintId: string; units: number }>
  ware?: ReadonlyArray<{ itemId: string; units: number }>
  modules?: ReadonlyArray<{ moduleId: string; units: number }>
  ships?: ReadonlyArray<{ defId: string; units: number }>
  aiCores?: ReadonlyArray<{ type: string; units: number }>
  wormholeStock?: number
}

export interface FirstTaskDef {
  id: string
  title: string
  titleEn?: string
  brief: string
  detail: string
  detailEn?: string
  judge: (state: GameState, ctx: SimContext) => number
  commsId: string
  reward?: FirstReward
  startReward?: FirstReward
  chain?: { id: string; name: string; stat: FirstStatKey | 'scan' | 'skills'; tierKey: string }
}

export const CHAIN_TIERS: Readonly<Record<string, readonly number[]>> = {
  scan: [5, 8, 12, 16, 20],
  salvageRuns: [1, 3, 8, 20, 50, 320, 2_000, 12_600, 79_000, 500_000],
  bountyWins: [1, 3, 8, 20, 50, 230, 1_050, 4_800, 21_900, 100_000],
  wormholeRuns: [1, 3, 8, 20, 50, 126, 316, 794, 1_995, 5_000],
  repairs: [1, 3, 8, 20, 50, 180, 650, 2_320, 8_350, 30_000],
  aiAssigns: [1, 3, 8, 20, 50, 180, 650, 2_320, 8_350, 30_000],
  haulTrips: [1, 3, 8, 20, 50, 180, 650, 2_320, 8_350, 30_000],
  marketIncome: [100, 1_000, 10_000, 100_000, 1_000_000, 16_000_000, 250_000_000, 4_000_000_000, 63_000_000_000, 1_000_000_000_000],
  ships: [1, 2, 4, 8, 15, 55, 202, 741, 2_720, 10_000],
  mineUnits: [1_000, 2_500, 6_000, 15_000, 40_000, 190_000, 910_000, 4_370_000, 20_900_000, 100_000_000],
  produceUnits: [10, 25, 60, 150, 400, 3_000, 23_000, 174_000, 1_320_000, 10_000_000],
  refineBatches: [10, 25, 60, 150, 400, 3_000, 23_000, 174_000, 1_320_000, 10_000_000],
  skills: [5, 12, 25, 45, 70, 164, 386, 907, 2_130, 5_000],
}

export const CHAIN_REWARD_ISK_BASE = 2_500

export function chainLevelRewardIsk(level: number): number {
  const n = Math.max(0, Math.floor(level))
  return CHAIN_REWARD_ISK_BASE * n ** 4
}

export function totalSkillLevels(state: GameState): number {
  let n = 0
  for (const v of Object.values(state.skills.trained)) n += v ?? 0
  return n
}

export function dsiStanding(state: GameState): number {
  return state.standingsEarned?.[DSI_FACTION_ID] ?? state.standings?.[DSI_FACTION_ID] ?? 0
}

export const PARALLEL_TAIL_IDS: readonly string[] = ['first-haul', 'first-wormhole']

export function isParallelTail(id: string): boolean {
  return PARALLEL_TAIL_IDS.includes(id)
}

export function sequentialPrefixDone(state: GameState): boolean {
  return FIRST_TASKS.every((d) => isParallelTail(d.id) || state.importantTasks[d.id]?.done === true)
}

export const FIRST_TASKS: readonly FirstTaskDef[] = [
  // ⟪文案调整 2026-10-04⟫ 船长授权教程整批优化、一次性验收；沿现有中英字段，不改判据及奖励。
  {
    id: 'first-scan',
    title: '第一次扫描',
    titleEn: 'First Scan',
    brief: '对星图上的未知信号执行一次扫描探索',
    detail:
      '到星图点选母港的未知信号，选择「扫描探索」。母港扫描需要 10 秒，完成后会显示这里的矿带、悬赏与残骸。回任务中心点击「完成」，领取奖励并开始下一项。',
    detailEn:
      'Select the unknown signal at your home port on the star map and choose Scan. The home port scan takes 10 seconds and reveals its belts, bounties and wreck sites. Return to the Task Center and click Complete to collect the reward and continue.',
    judge: (state, ctx) => state.exploredGalaxies.filter((g) => ctx.galaxies.has(g)).length,
    commsId: 'first-scan',
    reward: { isk: 10_000 },
    chain: { id: 'explorer', name: '宇宙探索家', stat: 'scan', tierKey: 'scan' },
  },
  {
    id: 'first-mine',
    title: '第一次采集原矿',
    titleEn: 'First Ore Haul',
    brief: '到矿带采一批原矿',
    detail:
      '强化采集器 MK1 已放入装备库。先到「舰船」页换驾驶为磷虾级采矿艇，再到「装配」页装上采集器，然后去星图的「矿带开采」开始采矿。采到原矿即可回任务中心完成；要转去精炼，先停止采矿，等待返港。',
    detailEn:
      'A Reinforced Mining Laser MK1 is in Module Storage. Switch to the Krill-class Mining Corvette on the Ships page, fit the laser on the Fitting page, then start mining from Ore Mining on the star map. Once ore is collected, return to the Task Center to complete the task. Stop mining and wait to return to port before refining.',
    judge: (state) => (state.firstStats?.mineUnits ?? 0),
    commsId: 'first-mine',
    reward: { ware: [{ itemId: 'ore-veldspar', units: 1_000 }] },
    startReward: { modules: [{ moduleId: 'mod-miner-1', units: 1 }] },
    chain: { id: 'digger', name: '深空采掘者', stat: 'mineUnits', tierKey: 'mineUnits' },
  },
  {
    id: 'first-refine',
    title: '第一次操作精炼炉',
    titleEn: 'First Refinery Run',
    brief: '让精炼炉出一批料',
    detail:
      '上一项奖励的橄榄岩已入物品仓库。停靠后，到「工业」页的「精炼炉」选择橄榄岩，用手动工作位开炉。等一批原材料出炉即可回任务中心完成，不必把全部原矿炼完。炉子仍在手动运转时，先停炉再安排出港。',
    detailEn:
      'The Peridotite reward from the previous task is in Item Storage. While docked, select it in Refinery on the Industry page and start a manual run. One completed batch of materials is enough to claim the task; you do not need to refine all the ore. Stop a manual refinery before heading out.',
    judge: (state) => (state.firstStats?.refineBatches ?? 0),
    commsId: 'first-refine',
    reward: { blueprints: [{ blueprintId: 'bp-ammo-kinetic', units: 1 }] },
    chain: { id: 'refiner', name: '精炼师', stat: 'refineBatches', tierKey: 'refineBatches' },
  },
  {
    id: 'first-bounty',
    title: '第一次完成悬赏',
    titleEn: 'First Bounty Cleared',
    brief: '打赢一场悬赏讨伐',
    detail:
      '到星图的「常驻悬赏」查看母港的「演习场驱逐令」。开局自带的基础舰炮就能参与这场演习，不必先买炮或弹药。选择目标出击，打赢一场后回任务中心完成；不需要开启重复清剿。其他悬赏出发前，应先检查装配与敌情。',
    detailEn:
      'Open Standing Bounties on the star map and look for the training-ground bounty at your home port. The built-in basic gun can fight this exercise; no gun or ammunition purchase is needed first. Win one fight and return to the Task Center. Repeat sweeps are not required. Check fittings and enemy details before taking other bounties.',
    judge: (state) => (state.firstStats?.bountyWins ?? 0),
    commsId: 'first-bounty',
    reward: { ships: [{ defId: 'sh-falconet', units: 1 }] },
    chain: { id: 'hunter', name: '赏金猎人', stat: 'bountyWins', tierKey: 'bountyWins' },
  },
  {
    id: 'first-repair',
    title: '第一次维修舰船',
    titleEn: 'First Ship Repair',
    brief: '用修理组件或港内维修修一次船',
    detail:
      '装甲和结构的损伤不会随战斗结束消失。等舰船停靠后，到「舰船」页的舰队列表，选一艘受损舰船，使用港内维修并支付信用点。完成一次实际维修即可回任务中心完成。若当前舰船完好，看看开局已有损伤的鲣鱼级。',
    detailEn:
      'Armor and structure damage remains after a fight. Once docked, select a damaged ship in the fleet list on the Ships page and pay for station repairs. One actual repair is enough to complete this task. If your current ship is undamaged, check the Skipjack-class Frigate that started with damage.',
    judge: (state) => (state.firstStats?.repairs ?? 0),
    commsId: 'first-repair',
    reward: { modules: [{ moduleId: 'mod-hullrep-civ', units: 1 }], ware: [{ itemId: 'repairkit-civ', units: 20 }] },
    chain: { id: 'mechanic', name: '维修技师', stat: 'repairs', tierKey: 'repairs' },
  },
  {
    id: 'first-salvage',
    title: '第一次打捞残骸',
    titleEn: 'First Wreck Salvage',
    brief: '到残骸地点打捞一批',
    detail:
      '打捞器 MK1 已放入装备库。到「装配」页为准备驾驶的舰船装上打捞器，再去星图的「残骸打捞」选择母港残骸场开始作业。收上一批残骸即可回任务中心完成，不必捞满货舱。停止作业后会返港，带回的残骸可送进工业页的回收炉。',
    detailEn:
      'A Salvager MK1 is in Module Storage. Fit it to the ship you intend to fly, then start work at a home-port wreck field from Wreck Salvage on the star map. Collect one batch and return to the Task Center to complete the task; a full hold is not required. Stopping returns you to port. Wreckage can be processed in the recycling unit on the Industry page.',
    judge: (state) => (state.firstStats?.salvageRuns ?? 0),
    commsId: 'first-salvage',
    reward: { ware: [{ itemId: 'wreck-a-hi', units: 1_000 }] },
    startReward: { modules: [{ moduleId: 'mod-salvager-1', units: 1 }] },
    chain: { id: 'scavenger', name: '残骸拾荒者', stat: 'salvageRuns', tierKey: 'salvageRuns' },
  },
  {
    id: 'first-skill',
    title: '第一次学习技能',
    titleEn: 'First Skill Trained',
    brief: '把 AI 核心操作学练到 Lv1',
    detail:
      '到「技能」页的「工程」找到「AI 核心操作学」，把它加入训练队列。练成 Lv1 即满足本项条件，回任务中心点击「完成」。先学这一门，下一项就能启用一枚核心，让闲置舰船替我们作业；不必现在练到 Lv3。',
    detailEn:
      'Find AI Core Operation under Engineering on the Skills page and add it to the training queue. Lv1 is enough for this task; return to the Task Center and click Complete when it finishes. That level lets you activate one core for an idle ship in the next task. Lv3 is not required now.',
    judge: (state) => state.skills.trained['ai-expert'] ?? 0,
    commsId: 'first-skill',
    reward: { isk: 10_000 },
    chain: { id: 'scholar', name: '学而不厌', stat: 'skills', tierKey: 'skills' },
  },
  {
    id: 'first-ai',
    title: '第一次指派 AI 副船',
    titleEn: 'First AI Auxiliary Assigned',
    brief: '给一艘闲置舰船派个 AI 任务',
    detail:
      '基础 AI 核心已到账。先停止主控作业并等返港，换驾驶到另一艘舰船，把装有采集器的磷虾级留作副船。到「舰船」页的「AI 副船」，选磷虾级、基础核心和可用矿带，指派采矿。指派成功即可回任务中心完成，不必等它跑完一趟。',
    detailEn:
      'A Basic AI Core is available. Stop your current work, wait to dock, and switch to another ship, leaving the Krill-class vessel with its mining laser as an auxiliary. In AI Auxiliaries on the Ships page, select that vessel, the Basic core and an available belt, then assign mining. A successful assignment is enough; you do not need to wait for a trip to finish.',
    judge: (state) => (state.firstStats?.aiAssigns ?? 0),
    commsId: 'first-ai',
    reward: { isk: 10_000 },
    startReward: { aiCores: [{ type: 'basic', units: 1 }] },
    chain: { id: 'dispatch', name: '舰队调度', stat: 'aiAssigns', tierKey: 'aiAssigns' },
  },
  {
    id: 'first-produce',
    title: '第一次生产',
    titleEn: 'First Production Run',
    brief: '让组装机造出一件东西',
    detail: '到「工业」页的蓝图书架学习已经领到的「动能弹药生产线」蓝图，再到组装机选择这条生产线，用手动工作位生产一批。起手材料已入物品仓库，不需要把副船的核心收回来。等成品交付后回任务中心完成。',
    detailEn:
      'Learn the Kinetic Ammo blueprint you received earlier from the Blueprint Shelf on the Industry page. Select its production line in the assembler and run one manual batch. Starting materials are in Item Storage; you do not need to recall the auxiliary ship\'s core. Complete the task after the finished goods are delivered.',
    judge: (state) => (state.firstStats?.produceUnits ?? 0),
    commsId: 'first-produce',
    reward: { isk: 10_000 },
    startReward: { ware: [{ itemId: 'min-tritanium', units: 150 }, { itemId: 'min-pyerite', units: 50 }] },
    chain: { id: 'lineboss', name: '产线主管', stat: 'produceUnits', tierKey: 'produceUnits' },
  },
  {
    id: 'first-order',
    title: '第一次挂单销售',
    titleEn: 'First Listing Sold',
    brief: '在市场做成一笔买卖（挂单或市价都算）',
    detail:
      '市场已开放。选一件持有的物品按市价卖出，或买入需要的物资，都能完成本项。也可以提交一张买单或卖单，挂单成功即可，不必等成交。先用少量物资试一次，再回任务中心完成；造船所需的材料先留着。',
    detailEn:
      'The market is open. Sell an item you hold at market price, or buy supplies you need; either completes this task. Posting a buy or sell order also counts as soon as it is accepted, without waiting for a fill. Try a small quantity, then return to the Task Center. Keep materials needed for shipbuilding.',
    judge: (state) => (state.firstStats?.orders ?? 0),
    commsId: 'first-order',
    reward: { isk: 10_000 },
    chain: { id: 'marketeer', name: '市场老手', stat: 'marketIncome', tierKey: 'marketIncome' },
  },
  {
    id: 'first-ship',
    title: '第一条船',
    titleEn: 'First Ship Built',
    brief: '造出第一艘自造船',
    detail: '磷虾级舰船蓝图已放入蓝图书架，先学习它，再到「工业」页的「造船厂」选择磷虾级。准备生产所需的原材料，用手动工作位开工；缺料可继续采矿精炼，或到市场购买。等舰船交付到「舰船仓库」后，回任务中心完成。',
    detailEn:
      'The Krill-class ship blueprint is on the Blueprint Shelf. Learn it, then select the Krill-class vessel in Shipyard on the Industry page. Prepare the listed materials and start a manual build. Mine and refine any missing materials, or buy them at market. Once the hull is delivered to Ship Storage, return to the Task Center to complete the task.',
    judge: (state) => (state.firstStats?.ships ?? 0),
    commsId: 'first-ship',
    reward: { isk: 10_000 },
    startReward: { blueprints: [{ blueprintId: 'sbp-sandcat', units: 1 }] },
    chain: { id: 'shipwright', name: '造船厂主', stat: 'ships', tierKey: 'ships' },
  },
  {
    id: 'first-haul',
    title: '第一次长途运输',
    brief: '完成一趟长途运输',
    titleEn: 'First Long-haul Run',
    detail:
      '长途运输需要两座已建成的空间站。若目前只有母港，先在星图探明红环航道，查看前哨站材料单并完成建设。航线开放后，到「长途运输」选择两站开始往返；完成一趟后回任务中心领取奖励。运输会自动续跑，想停下可在活动栏停止。',
    detailEn:
      'Long-haul transport needs two completed stations. If only the home port is available, first chart Redring Corridor, check the outpost materials bill and finish construction. Once a route is available, choose two stations under Long-haul Transport and start the round trip. Complete one trip to claim the reward. Transport repeats automatically; stop it from the activity bar when needed.',
    judge: (state) => (state.firstStats?.haulTrips ?? 0),
    commsId: 'first-haul',
    reward: { ships: [{ defId: 'sh-flyingfish', units: 1 }] },
    chain: { id: 'freight', name: '星际货运', stat: 'haulTrips', tierKey: 'haulTrips' },
  },
  {
    id: 'first-wormhole',
    title: '第一次信号空间',
    titleEn: 'First Signal Space',
    brief: '把深空工业协会声望攒到 40',
    detail:
      '本项要求累计获得 40 点协会声望，不需要先进入信号空间。到常驻悬赏查看还没拿过首胜声望的目标，逐步积攒；重复清缴同一目标不会再给首胜声望。达标后回任务中心完成，领取两处信号空间坐标，再到「扫描信号空间」检查编队、武器、采集器与打捞器，准备好再进入。',
    detailEn:
      'This task requires 40 total earned Association standing, not entry into a Signal Space. Check Standing Bounties for targets whose first-win standing you have not collected. Repeating the same target does not award that standing again. Once eligible, claim the task to receive two Signal Space coordinates. Then open Scan for Signal Spaces and check your squad, weapons, mining lasers and salvagers before entering.',
    judge: (state) => (dsiStanding(state) >= WORMHOLE_UNLOCK_STANDING ? 1 : 0),
    commsId: 'first-wormhole',
    reward: { wormholeStock: 2 },
    startReward: { modules: [{ moduleId: 'mod-miner-1', units: 1 }, { moduleId: 'mod-salvager-1', units: 1 }] },
    chain: { id: 'abyss', name: '深渊探索者', stat: 'wormholeRuns', tierKey: 'wormholeRuns' },
  },
]

export function bumpFirst(state: GameState, key: string, n = 1): void {
  if (n <= 0) return
  const bag = (state.firstStats ??= {})
  bag[key] = (bag[key] ?? 0) + n
}

export function peakFirst(state: GameState, key: string, v: number): void {
  if (!Number.isFinite(v)) return
  const bag = (state.firstStats ??= {})
  const prev = bag[key] ?? 0
  if (v > prev) bag[key] = v
}

export function firstStatOf(state: GameState, key: FirstStatKey | 'scan' | 'skills'): number {
  if (key === 'scan') return state.exploredGalaxies.length
  if (key === 'skills') return totalSkillLevels(state)
  return state.firstStats?.[key] ?? 0
}

export function chainProgressOf(
  state: GameState,
  chain: { stat: FirstStatKey | 'scan' | 'skills'; tierKey: string },
): { count: number; level: number; next: number | null; total: number } {
  const tiers = CHAIN_TIERS[chain.tierKey] ?? []
  const count = firstStatOf(state, chain.stat)
  let level = 0
  for (const t of tiers) if (count >= t) level += 1
  return { count, level, next: tiers.find((t) => count < t) ?? null, total: tiers.length }
}

export function claimableFirstTasks(state: GameState, ctx: SimContext): FirstTaskDef[] {
  const current = FIRST_TASKS.find((d) => !isParallelTail(d.id) && state.importantTasks[d.id]?.done !== true)
  if (current) return current.judge(state, ctx) >= 1 ? [current] : []
  return FIRST_TASKS.filter(
    (d) => isParallelTail(d.id) && state.importantTasks[d.id]?.done !== true && d.judge(state, ctx) >= 1,
  )
}

export function firstTaskText(
  def: Pick<FirstTaskDef, 'title' | 'titleEn' | 'detail' | 'detailEn'>,
  locale: 'zh' | 'en',
  field: 'title' | 'detail',
): string {
  if (locale !== 'en') return field === 'title' ? def.title : def.detail
  if (field === 'title') return def.titleEn ?? def.title
  return def.detailEn ?? def.detail
}

export function isFirstTaskCurrent(state: GameState, id: string): boolean {
  if (isParallelTail(id)) {
    const prefixNext = FIRST_TASKS.find((d) => !isParallelTail(d.id) && state.importantTasks[d.id]?.done !== true)
    return prefixNext === undefined && state.importantTasks[id]?.done !== true
  }
  const current = FIRST_TASKS.find((d) => !isParallelTail(d.id) && state.importantTasks[d.id]?.done !== true)
  return current?.id === id
}

export function advanceFirstChains(state: GameState): Array<{ id: string; name: string; level: number; isk: number }> {
  const out: Array<{ id: string; name: string; level: number; isk: number }> = []
  for (const def of FIRST_TASKS) {
    if (!def.chain) continue
    const key = `chain-${def.chain.id}`
    const { level } = chainProgressOf(state, def.chain)
    const before = state.importantTasks[key]?.delivered ?? 0
    if (level <= before) continue
    state.importantTasks[key] = { done: false, delivered: level }
    let isk = 0
    for (let i = before + 1; i <= level; i++) isk += chainLevelRewardIsk(i)
    out.push({ id: def.chain.id, name: def.chain.name, level, isk })
  }
  return out
}

export function chainPendingRewardIsk(state: GameState, chainId: string): number {
  const def = FIRST_TASKS.find((d) => d.chain?.id === chainId)
  if (!def?.chain) return 0
  const { level } = chainProgressOf(state, def.chain)
  const paid = state.firstStats?.[`paid-${def.chain.id}`] ?? 0
  if (level <= paid) return 0
  let sum = 0
  for (let i = paid + 1; i <= level; i++) sum += chainLevelRewardIsk(i)
  return sum
}

export function claimChainReward(state: GameState, chainId: string): number {
  const def = FIRST_TASKS.find((d) => d.chain?.id === chainId)
  if (!def?.chain) return 0
  const { level } = chainProgressOf(state, def.chain)
  const paid = state.firstStats?.[`paid-${def.chain.id}`] ?? 0
  if (level <= paid) return 0
  const isk = chainPendingRewardIsk(state, chainId)
  bumpFirst(state, `paid-${def.chain.id}`, level - paid)
  state.wallet.isk += isk
  return isk
}

export const FIRST_UNLOCKS: Readonly<Record<string, string>> = {
  market: 'first-produce',
  mapMine: 'first-scan',
  mapBounty: 'first-scan',
  mapSalvage: 'first-scan',
  mapHaul: 'first-scan',
}

const UNLOCK_AT_TASK: Readonly<Record<string, string>> = {
  industry: 'first-refine',
}

export function isFirstBountyBattle(state: GameState, anomalyId: string | null, shipId: string): boolean {
  return anomalyId === 'ano-training' && shipId === state.shipId && state.importantTasks['first-bounty']?.done !== true
}

export const FIRST_BOUNTY_HIT_BONUS = 0.5
export const FIRST_BOUNTY_EVASION_BONUS = 0.5

export function applyFirstBountyBuff(spec: { hitBonus: number; evasion: number }): void {
  spec.hitBonus += FIRST_BOUNTY_HIT_BONUS
  spec.evasion += FIRST_BOUNTY_EVASION_BONUS
}

export function unlocked(state: GameState, key: string): boolean {
  const at = UNLOCK_AT_TASK[key]
  if (at !== undefined) {
    const idx = FIRST_TASKS.findIndex((d) => d.id === at)
    if (idx <= 0) return true
    for (let i = 0; i < idx; i++) {
      if (state.importantTasks[FIRST_TASKS[i]!.id]?.done !== true) return false
    }
    return true
  }
  const need = FIRST_UNLOCKS[key]
  if (!need) return true
  return state.importantTasks[need]?.done === true
}
export function unlockNeedTitle(key: string): string | undefined {
  const at = UNLOCK_AT_TASK[key]
  if (at !== undefined) {
    const idx = FIRST_TASKS.findIndex((d) => d.id === at)
    return (idx > 0 ? FIRST_TASKS[idx - 1] : FIRST_TASKS[0])?.title
  }
  const need = FIRST_UNLOCKS[key]
  return need === undefined ? undefined : FIRST_TASKS.find((d) => d.id === need)?.title
}
export function visibleFirstTasks(state: GameState, locale: 'zh' | 'en' = 'zh'): FirstTaskDef[] {
  const localized = (d: FirstTaskDef): FirstTaskDef =>
    locale === 'en'
      ? { ...d, title: firstTaskText(d, 'en', 'title'), detail: firstTaskText(d, 'en', 'detail') }
      : d
  const next = FIRST_TASKS.find((d) => !isParallelTail(d.id) && state.importantTasks[d.id]?.done !== true)
  if (next) return [localized(next)]
  return FIRST_TASKS.filter((d) => isParallelTail(d.id) && state.importantTasks[d.id]?.done !== true).map(localized)
}

export function firstTaskProgress(state: GameState): { done: number; total: number } {
  const done = FIRST_TASKS.filter((d) => state.importantTasks[d.id]?.done === true).length
  return { done, total: FIRST_TASKS.length }
}

export function firstTaskNotice(
  state: GameState,
  locale: 'zh' | 'en' = 'zh',
): { taskId: string; title: string; ready: boolean } | null {
  const shown = visibleFirstTasks(state, locale)
  if (shown.length === 0) return null
  const ready = shown.some((d) => d.id === state.firstTaskReadyId)
  const sig = shown.map((d) => d.id).join('|') + (ready ? '|ready' : '')
  if (state.firstTaskSeenId === sig) return null
  return { taskId: shown[0]!.id, title: shown.map((d) => d.title).join(locale === 'en' ? ', ' : '、'), ready }
}

export function firstTasksMarkSeen(state: GameState): boolean {
  const shown = visibleFirstTasks(state)
  if (shown.length === 0) return false
  const ready = shown.some((d) => d.id === state.firstTaskReadyId)
  const sig = shown.map((d) => d.id).join('|') + (ready ? '|ready' : '')
  if (state.firstTaskSeenId === sig) return false
  state.firstTaskSeenId = sig
  return true
}

export interface MilestoneChainRow {
  chainId: string
  name: string
  taskId: string
  taskTitle: string
  unlocked: boolean
  level: number
  total: number
  count: number
  next: number | null
  pendingIsk: number
  nextRewardIsk: number
}

export function milestoneBoard(state: GameState): MilestoneChainRow[] {
  const rows: MilestoneChainRow[] = []
  for (const def of FIRST_TASKS) {
    const chain = def.chain
    if (!chain) continue
    const prog = chainProgressOf(state, chain)
    const done = state.importantTasks[def.id]?.done === true
    const maxed = prog.level >= prog.total
    rows.push({
      chainId: chain.id,
      name: chain.name,
      taskId: def.id,
      taskTitle: def.title,
      unlocked: done,
      level: prog.level,
      total: prog.total,
      count: prog.count,
      next: prog.next,
      pendingIsk: chainPendingRewardIsk(state, chain.id),
      nextRewardIsk: maxed ? 0 : chainLevelRewardIsk(prog.level + 1),
    })
  }
  return rows
}

export interface FirstTaskRow {
  def: FirstTaskDef
  done: boolean
  level: number
  total: number
  count: number
  next: number | null
  pendingIsk: number
  nextRewardIsk: number
  hidden: boolean
}

export function firstTaskBoard(state: GameState): FirstTaskRow[] {
  const rows: FirstTaskRow[] = visibleFirstTasks(state).map((def) => {
    const done = state.importantTasks[def.id]?.done === true
    const prog = def.chain ? chainProgressOf(state, def.chain) : null
    const pendingIsk = def.chain ? chainPendingRewardIsk(state, def.chain.id) : 0
    const maxed = prog !== null && prog.level >= prog.total
    return {
      def,
      done,
      level: prog?.level ?? 0,
      total: prog?.total ?? 0,
      count: prog?.count ?? 0,
      next: prog?.next ?? null,
      pendingIsk,
      nextRewardIsk: maxed ? 0 : chainLevelRewardIsk((prog?.level ?? 0) + 1),
      hidden: done && maxed && pendingIsk <= 0,
    }
  })
  const rank = (r: FirstTaskRow): number => (r.pendingIsk > 0 ? 0 : r.done ? 1 : 2)
  return rows.filter((r) => !r.hidden).sort((a, b) => rank(a) - rank(b))
}


