import type { AchievementCategory, AchievementDef } from '@whale/core'
import { CHAIN_TIERS, FIRST_TASKS } from '@whale/core'

const TONE_L1 = '#7fd4a8'
const TONE_L4 = '#ffca58'
const TONE_L7 = '#ff9d5c'
const TONE_L10 = '#e07bff'

const STANDARD_LEVELS: readonly number[] = [1, 4, 7, 10]
const STANDARD_TONES: Readonly<Record<number, string>> = {
  1: TONE_L1,
  4: TONE_L4,
  7: TONE_L7,
  10: TONE_L10,
}
const EXPLORER_CHAIN_ID = 'explorer'
const EXPLORER_LEVELS: readonly number[] = [1, 5]
const EXPLORER_TONES: Readonly<Record<number, string>> = { 1: TONE_L1, 5: TONE_L10 }

const TIER_WORDS: readonly string[] = ['见习', '资深', '王牌', '传奇']
const STANDARD_TIER_WORDS: Readonly<Record<number, string>> = {
  1: TIER_WORDS[0]!,
  4: TIER_WORDS[1]!,
  7: TIER_WORDS[2]!,
  10: TIER_WORDS[3]!,
}
const EXPLORER_TIER_WORDS: Readonly<Record<number, string>> = {
  1: TIER_WORDS[0]!,
  5: TIER_WORDS[3]!,
}

const CHAIN_RANK: Readonly<Record<string, string>> = {
  explorer: '探索家',
  digger: '采掘者',
  scavenger: '拾荒者',
  mechanic: '维修师',
  hunter: '赏金猎人',
  refiner: '精炼师',
  lineboss: '产线主管',
  marketeer: '市场老手',
  shipwright: '造船厂主',
  scholar: '学者',
  dispatch: '调度官',
  freight: '货运长',
  abyss: '深渊行者',
}

function chainBadgeName(chainId: string, chainName: string, level: number): string {
  const table = chainId === EXPLORER_CHAIN_ID ? EXPLORER_TIER_WORDS : STANDARD_TIER_WORDS
  const word = table[level] ?? TIER_WORDS[0]!
  return word + (CHAIN_RANK[chainId] ?? chainName)
}

function taskNote(title: string): string {
  return `达成「${title}」时获得的纪念徽章。`
}

function taskAchievements(): AchievementDef[] {
  return FIRST_TASKS.map((task) => ({
    id: `ach-first-${task.id.slice('first-'.length)}`,
    name: task.title,
    note: taskNote(task.title),
    category: 'first-task' as AchievementCategory,
    pattern: 'first',
    tone: TONE_L1,
    source: { kind: 'task' as const, taskId: task.id },
  }))
}

function chainAchievements(): AchievementDef[] {
  const out: AchievementDef[] = []
  for (const task of FIRST_TASKS) {
    const chain = task.chain
    if (!chain) continue
    const isExplorer = chain.id === EXPLORER_CHAIN_ID
    const levels = isExplorer ? EXPLORER_LEVELS : STANDARD_LEVELS
    const tones = isExplorer ? EXPLORER_TONES : STANDARD_TONES
    const top = (CHAIN_TIERS[chain.tierKey] ?? []).length
    for (const level of levels) {
      if (level > top && !isExplorer) continue
      out.push({
        id: `ach-chain-${chain.id}-${level}`,
        name: chainBadgeName(chain.id, chain.name, level),
        note: `「${chain.name}」进度达到 ${level} 级时获得的纪念徽章。`,
        category: 'chain' as AchievementCategory,
        pattern: chain.id,
        tone: tones[level] ?? TONE_L1,
        source: { kind: 'chain' as const, chainId: chain.id, level },
      })
    }
  }
  return out
}

const TONE_MILESTONE = '#f4c95d'

interface MilestoneSpec {
  slug: string
  name: string
  slot: string
  stat: string
  target: number
  note: string
  unit: string
}

function milestoneAchievements(): AchievementDef[] {
  const specs: MilestoneSpec[] = [
    { slug: 'wh-depth-2', slot: 'depth', name: '初入深渊', stat: 'whMaxDepth', target: 2, unit: ' 层', note: '在信号空间中到达第 {n}。' },
    { slug: 'wh-depth-3', slot: 'depth', name: '深渊宿将', stat: 'whMaxDepth', target: 3, unit: ' 层', note: '在信号空间中到达第 {n}。' },
    { slug: 'wh-depth-4', slot: 'depth', name: '深渊之主', stat: 'whMaxDepth', target: 4, unit: ' 层', note: '在信号空间中到达第 {n}。' },
    { slug: 'wh-depth-5', slot: 'depth', name: '深渊彼岸', stat: 'whMaxDepth', target: 5, unit: ' 层', note: '在信号空间中到达第 {n}。' },
    { slug: 'wh-boss-2', slot: 'guard', name: '斩层者', stat: 'whBossClears', target: 2, unit: ' 个', note: '累计击破 {n}层末守卫。' },
    { slug: 'wh-boss-4', slot: 'guard', name: '守关终结者', stat: 'whBossClears', target: 4, unit: ' 个', note: '累计击破 {n}层末守卫。' },
    { slug: 'box-1', slot: 'cache', name: '初启箱庭', stat: 'rareBoxes', target: 1, unit: ' 件', note: '累计取得 {n}稀有残骸额外战利品。' },
    { slug: 'box-5', slot: 'cache', name: '拾荒老手', stat: 'rareBoxes', target: 5, unit: ' 件', note: '累计取得 {n}稀有残骸额外战利品。' },
    { slug: 'box-20', slot: 'cache', name: '拾荒名匠', stat: 'rareBoxes', target: 20, unit: ' 件', note: '累计取得 {n}稀有残骸额外战利品。' },
    { slug: 'box-60', slot: 'cache', name: '拾荒巨匠', stat: 'rareBoxes', target: 60, unit: ' 件', note: '累计取得 {n}稀有残骸额外战利品。' },
    { slug: 'box-150', slot: 'cache', name: '箱庭之主', stat: 'rareBoxes', target: 150, unit: ' 件', note: '累计取得 {n}稀有残骸额外战利品。' },
    { slug: 'core-1', slot: 'core', name: '初识核心', stat: 'aiCoreKinds', target: 1, unit: ' 类', note: '获得过 {n} AI 核心。' },
    { slug: 'core-2', slot: 'core', name: '双子核', stat: 'aiCoreKinds', target: 2, unit: ' 类', note: '获得过 {n} AI 核心。' },
    { slug: 'core-3', slot: 'core', name: '三核共鸣', stat: 'aiCoreKinds', target: 3, unit: ' 类', note: '获得过 {n} AI 核心。' },
    { slug: 'core-4', slot: 'core', name: '四核同心', stat: 'aiCoreKinds', target: 4, unit: ' 类', note: '获得过 {n} AI 核心。' },
    { slug: 'site-1', slot: 'outpost', name: '拓荒者', stat: 'sitesBuilt', target: 1, unit: ' 座', note: '建成 {n}副空间站。' },
    { slug: 'site-2', slot: 'outpost', name: '双站总督', stat: 'sitesBuilt', target: 2, unit: ' 座', note: '建成 {n}副空间站。' },
    { slug: 'tech-tree', slot: 'tech', name: '谜质通晓', stat: 'matterTechMaxed', target: 24, unit: ' 项', note: '谜质科技树 {n}研究全部满级。' },
  ]
  return specs.map((s) => ({
    id: `ach-mile-${s.slug}`,
    name: s.name,
    note: s.note.replace('{n}', `${s.target}${s.unit}`),
    category: 'milestone' as AchievementCategory,
    pattern: `mile-${s.slot}`,
    tone: TONE_MILESTONE,
    source: { kind: 'milestone' as const, stat: s.stat, target: s.target },
  }))
}

function ironmanAchievements(): AchievementDef[] {
  return [
    {
      id: 'ach-ironman',
      name: '铁人',
      note: '以铁人模式开局或转换：存档代次只前进，装载更早的档会被拒绝。',
      category: 'ironman',
      pattern: 'ach-ironman',
      tone: '#c9a227',
      hidden: true,
      source: { kind: 'ironman' },
    },
    {
      id: 'ach-ironman-closed',
      name: '铁人 · 已关闭',
      note: '关闭过铁人模式：代次从此冻结，不再上升。',
      category: 'ironman',
      pattern: 'ach-ironman',
      tone: '#8a8f98',
      hidden: true,
      source: { kind: 'ironmanClosed' },
    },
  ]
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  ...taskAchievements(),
  ...chainAchievements(),
  ...milestoneAchievements(),
  ...ironmanAchievements(),
]

export function achievementOf(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id)
}

export function achievementsOfChain(chainId: string): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => a.source.kind === 'chain' && a.source.chainId === chainId)
}
