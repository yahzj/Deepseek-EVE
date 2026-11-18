import { COMMS_DAY_MS } from '@whale/core'
import { L10N, l10nEntryText } from '@whale/data'
import type { CommsEntryView, CommsRewardLine } from '@whale/core'
import { isEn, paramText, tr } from '../i18n/locale'

const COMMS_NAME_ID: Record<string, string> = {
  深空工业协会: 'ui.comms.001',
  打捞队工会: 'ui.comms.002',
  信息库: 'ui.comms.003',
  检索重启: 'ui.comms.004',
  航行管制: 'ui.comms.005',
  基建部: 'ui.comms.006',
  测绘处: 'ui.comms.007',
  工业部: 'ui.comms.008',
  冶炼组: 'ui.comms.009',
  训练处: 'ui.comms.010',
  财务处: 'ui.comms.011',
  航线安全: 'ui.comms.012',
  老陈一队: 'ui.comms.013',
  黑市: 'ui.comms.074',
  违禁品柜: 'ui.comms.075',
}

export function commsSenderText(from: string): string {
  if (from === '') return from
  return from
    .split(' · ')
    .map((part) => {
      const id = COMMS_NAME_ID[part]
      return id !== undefined ? tr(id) : part
    })
    .join(' · ')
}

const COMMS_SUBJECT_ID: Record<string, string> = {
  'msg-industrial-fleet-risk': 'ui.commsIndustrialRisk.001',
  'first-scan': 'ui.comms.014',
  'first-mine': 'ui.comms.015',
  'first-refine': 'ui.comms.016',
  'first-bounty': 'ui.comms.017',
  'first-repair': 'ui.comms.018',
  'first-salvage': 'ui.comms.019',
  'first-skill': 'ui.comms.020',
  'first-ai': 'ui.comms.021',
  'first-produce': 'ui.comms.022',
  'first-order': 'ui.comms.023',
  'first-ship': 'ui.comms.024',
  'first-haul': 'ui.comms.025',
  'first-wormhole': 'ui.comms.026',
  'msg-briefing': 'ui.comms.027',
  'msg-welcome': 'ui.comms.028',
  'msg-survey-memo': 'ui.comms.029',
  'msg-cinder-warning': 'ui.comms.030',
  'msg-industry-shift': 'ui.comms.031',
  'msg-refinery-note': 'ui.comms.032',
  'msg-salvage-crew': 'ui.comms.033',
  'msg-site-thanks': 'ui.comms.034',
  'msg-auro-megastructure': 'ui.comms.035',
  'msg-exile-swarm': 'ui.comms.036',
  'msg-lowsec-rules': 'ui.comms.037',
  'msg-redring-outpost': 'ui.comms.038',
  'msg-wormhole-nebula': 'ui.comms.039',
  'msg-wormhole-unlock': 'ui.comms.040',
  'msg-ambush-retreat': 'ui.comms.041',
  'msg-first-ship': 'ui.comms.042',
  'msg-pirate-capture-web': 'ui.comms.043',
  'msg-wh-siege': 'ui.comms.067',
  'msg-blackbox-plug-unlock': 'ui.comms.079',
  'msg-lab-contraband': 'ui.comms.076',
  'msg-black-market-unlock': 'ui.commsBlackMarket.001',
  'msg-fleet-command-unlock': 'ui.commsFleetUnlock.001',
}

const COMMS_DIALOGUE_ID: Record<string, { subject: string; prefix: string; speaker: string; count: number }> = {
  'dlg-redring-intro': { subject: 'ui.commsDialogue.001', prefix: 'ui.commsRedintro', speaker: 'ui.commsSpeaker.001', count: 5 },
  'dlg-redring-done': { subject: 'ui.commsDialogue.002', prefix: 'ui.commsReddone', speaker: 'ui.commsSpeaker.001', count: 6 },
  'dlg-cinder-intro': { subject: 'ui.commsDialogue.003', prefix: 'ui.commsCinderintro', speaker: 'ui.commsSpeaker.002', count: 4 },
  'dlg-cinder-done': { subject: 'ui.commsDialogue.004', prefix: 'ui.commsCinderdone', speaker: 'ui.commsSpeaker.002', count: 6 },
}

export function commsDialogueText<T extends { id?: string; title: string; lines: readonly { speaker: string; text: string }[] }>(script: T): T {
  const spec = script.id ? COMMS_DIALOGUE_ID[script.id] : undefined
  if (!isEn() || !spec || spec.count !== script.lines.length) return script
  return {
    ...script,
    title: commsSenderText(script.title),
    lines: script.lines.map((line, i) => ({
      ...line,
      speaker: tr(spec.speaker),
      text: tr(`${spec.prefix}.${String(i + 1).padStart(3, '0')}`),
    })),
  }
}

export function commsSubjectText(
  id: string,
  fallback: string,
  dynamic?: { subjectId?: string; params?: Readonly<Record<string, string | number>> },
): string {
  if (dynamic?.subjectId !== undefined) {
    const raw = dynamic.params ?? {}
    const out: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'parts') continue
      if (typeof v !== 'string' && typeof v !== 'number') continue
      out[k] = v
    }
    for (const [k, v] of Object.entries(raw)) {
      if (!k.endsWith('Id') || typeof v !== 'string') continue
      const slot = k.slice(0, -2)
      if (out[slot] !== undefined) out[slot] = paramText(v)
    }
    return tr(dynamic.subjectId, out)
  }
  const l10nId = COMMS_SUBJECT_ID[id] ?? (id.startsWith('dlg:') ? COMMS_DIALOGUE_ID[id.slice(4)]?.subject : undefined)
  return l10nId !== undefined ? tr(l10nId) : fallback
}

export function commsClockText(gameMs: number): string {
  const t = Math.max(0, Math.floor(gameMs))
  const day = Math.floor(t / COMMS_DAY_MS) + 1
  const rest = t % COMMS_DAY_MS
  const hh = String(Math.floor(rest / 3_600_000)).padStart(2, '0')
  const mm = String(Math.floor((rest % 3_600_000) / 60_000)).padStart(2, '0')
  return tr('ui.comms.044', { p1: day, p2: `${hh}:${mm}` })
}

const COMMS_ALIGN_ID: Record<string, string> = {
  官方: 'ui.comms.045',
  民间: 'ui.comms.046',
  系统: 'ui.comms.047',
  中立: 'ui.comms.078',
}
const COMMS_KIND_ID: Record<string, string> = {
  剧情: 'ui.comms.048',
  提示: 'ui.comms.049',
  委托: 'ui.comms.050',
}
const COMMS_HINT_ID: Record<string, string> = {
  [L10N['ui.comms.051']!.zh]: 'ui.comms.051',
  [L10N['ui.comms.052']!.zh]: 'ui.comms.052',
  '星图 · 点选未知信号开始扫描': 'ui.comms.053',
  '星图 · 出发前看清目标星系的安全等级。': 'ui.comms.054',
  '星图 · 残骸打捞页有各星系的残骸存量。': 'ui.comms.055',
  '星图 · 出港 · 「扫描虫洞」标签开始扫描': 'ui.comms.056',
  '星图 · 选「红环航道」查看建站交付。': 'ui.comms.057',
  '舰船页 · 「舰船仓库」可转入舰队或出售': 'ui.comms.058',
  '工业页 · 造一批修理组件，给船装上维修装置': 'ui.comms.059',
  '工业页可以同时开多台炉子。': 'ui.comms.060',
  '技能页可以先把精炼学排进队列。': 'ui.comms.061',
  '副站建成后泊位、维修、补给与换船全部开放。': 'ui.comms.062',
  '前往声望商店兑换': 'ui.Expedition.442',
  '出发前先去装配页检查一遍武器与防护。': 'ui.comms.063',
  '出发前在装配页把对空火力与装甲补齐。': 'ui.comms.064',
  '打之前先去装配页，把对空火力带上。': 'ui.comms.065',
  '想先看看这片星域长什么样？去星图认认路。': 'ui.comms.066',
  '到「技能」页的「工程」里训练 AI 核心操作学': 'ui.comms.068',
  '星图 · 被占星系有红色发光与旗标': 'ui.comms.069',
  查看详细奖励: 'ui.comms.070',
  '工业页的实验室能造这两样。': 'ui.comms.077',
  [L10N['ui.commsBlackMarket.005']!.zh]: 'ui.commsBlackMarket.005',
  [L10N['ui.commsFleetUnlock.004']!.zh]: 'ui.commsFleetUnlock.004',
  [L10N['ui.commsIndustrialRisk.004']!.zh]: 'ui.commsIndustrialRisk.004',
}

export function commsAlignText(alignment: string): string {
  const id = COMMS_ALIGN_ID[alignment]
  return id !== undefined ? tr(id) : alignment
}
export function commsKindText(kind: string): string {
  const id = COMMS_KIND_ID[kind]
  return id !== undefined ? tr(id) : kind
}
export function commsHintText(text: string): string {
  const id = COMMS_HINT_ID[text]
  return id !== undefined ? tr(id) : text
}

const COMMS_BODY_EN: Record<string, readonly string[]> = {
  'msg-industrial-fleet-risk': [
    l10nEntryText(L10N['ui.commsIndustrialRisk.002']!, 'en'),
    l10nEntryText(L10N['ui.commsIndustrialRisk.003']!, 'en'),
  ],
  'msg-black-market-unlock': [
    l10nEntryText(L10N['ui.commsBlackMarket.002']!, 'en'),
    l10nEntryText(L10N['ui.commsBlackMarket.003']!, 'en'),
    l10nEntryText(L10N['ui.commsBlackMarket.004']!, 'en'),
  ],
  'msg-fleet-command-unlock': [
    l10nEntryText(L10N['ui.commsFleetUnlock.002']!, 'en'),
    l10nEntryText(L10N['ui.commsFleetUnlock.003']!, 'en'),
  ],
  'first-scan': [
    L10N['ui.firstScan.001']!.en,
    L10N['ui.firstScan.002']!.en,
    L10N['ui.firstScan.003']!.en,
  ],
  'first-mine': [
    L10N['ui.firstMine.001']!.en,
    L10N['ui.firstMine.002']!.en,
    L10N['ui.firstMine.003']!.en,
  ],
  'first-refine': [
    L10N['ui.firstRefine.001']!.en,
    L10N['ui.firstRefine.002']!.en,
    L10N['ui.firstRefine.003']!.en,
  ],
  'first-bounty': [
    L10N['ui.firstBounty.001']!.en,
    L10N['ui.firstBounty.002']!.en,
    L10N['ui.firstBounty.003']!.en,
  ],
  'first-repair': [
    L10N['ui.firstRepair.001']!.en,
    L10N['ui.firstRepair.002']!.en,
    L10N['ui.firstRepair.003']!.en,
  ],
  'first-salvage': [
    L10N['ui.firstSalvage.001']!.en,
    L10N['ui.firstSalvage.002']!.en,
    L10N['ui.firstSalvage.003']!.en,
  ],
  'first-skill': [
    L10N['ui.firstSkill.001']!.en,
    L10N['ui.firstSkill.002']!.en,
    L10N['ui.firstSkill.003']!.en,
  ],
  'first-ai': [
    L10N['ui.firstAi.001']!.en,
    L10N['ui.firstAi.002']!.en,
    L10N['ui.firstAi.003']!.en,
  ],
  'first-produce': [
    L10N['ui.firstProduce.001']!.en,
    L10N['ui.firstProduce.002']!.en,
    L10N['ui.firstProduce.003']!.en,
  ],
  'first-order': [
    L10N['ui.firstOrder.001']!.en,
    L10N['ui.firstOrder.002']!.en,
    L10N['ui.firstOrder.003']!.en,
  ],
  'first-ship': [
    L10N['ui.firstShip.001']!.en,
    L10N['ui.firstShip.002']!.en,
    L10N['ui.signalSpace.009']!.en,
  ],
  'first-haul': [
    L10N['ui.firstHaul.001']!.en,
    L10N['ui.firstHaul.002']!.en,
    L10N['ui.signalSpace.010']!.en,
  ],
  'first-wormhole': [
    L10N['ui.signalSpace.011']!.en,
    L10N['ui.signalSpace.012']!.en,
    L10N['ui.signalSpace.013']!.en,
  ],
  'msg-welcome': [
    L10N['ui.commsWelcome.001']!.en,
    L10N['ui.commsWelcome.002']!.en,
  ],
  'msg-survey-memo': [
    L10N['ui.commsSurvey.001']!.en,
    L10N['ui.commsSurvey.002']!.en,
    L10N['ui.commsSurvey.003']!.en,
  ],
  'msg-industry-shift': [
    L10N['ui.commsIndustry.001']!.en,
    L10N['ui.commsIndustry.002']!.en,
    L10N['ui.commsIndustry.003']!.en,
  ],
  'msg-refinery-note': [
    L10N['ui.commsSmelt.001']!.en,
    L10N['ui.commsSmelt.002']!.en,
    L10N['ui.commsSmelt.003']!.en,
  ],
  'msg-salvage-crew': [
    L10N['ui.commsSalvage.001']!.en,
    L10N['ui.commsSalvage.002']!.en,
    L10N['ui.commsSalvage.003']!.en,
    L10N['ui.commsSalvage.004']!.en,
  ],
  'msg-site-thanks': [
    L10N['ui.commsThanks.001']!.en,
    L10N['ui.commsThanks.002']!.en,
    L10N['ui.commsThanks.003']!.en,
  ],
  'msg-redring-outpost': [
    L10N['ui.commsOutpost.001']!.en,
    L10N['ui.commsOutpost.002']!.en,
    L10N['ui.commsOutpost.003']!.en,
    L10N['ui.commsOutpost.004']!.en,
  ],
  'msg-first-ship': [
    L10N['ui.commsFirstship.001']!.en,
    L10N['ui.commsFirstship.002']!.en,
    L10N['ui.commsFirstship.003']!.en,
    L10N['ui.commsFirstship.004']!.en,
  ],
  'msg-wh-siege': [
    L10N['ui.commsSiege.001']!.en,
    L10N['ui.commsSiege.002']!.en,
    L10N['ui.commsSiege.003']!.en,
  ],
  'msg-lab-contraband': [
    L10N['ui.commsContraband.001']!.en,
    L10N['ui.commsContraband.002']!.en,
    L10N['ui.commsContraband.003']!.en,
    L10N['ui.commsContraband.004']!.en,
    L10N['ui.commsContraband.005']!.en,
  ],
  'msg-briefing': [
    L10N['ui.firstBriefing.001']!.en,
    L10N['ui.firstBriefing.002']!.en,
  ],
  'msg-lowsec-rules': [
    L10N['ui.commsLowsec.001']!.en,
    L10N['ui.commsLowsec.002']!.en,
    L10N['ui.commsLowsec.003']!.en,
  ],
  'msg-wormhole-unlock': [
    L10N['ui.signalSpace.005']!.en,
    L10N['ui.signalSpace.006']!.en,
    L10N['ui.signalSpace.007']!.en,
    L10N['ui.signalSpace.008']!.en,
  ],
  'msg-auro-megastructure': [
    L10N['ui.commsAuro.001']!.en,
    L10N['ui.commsAuro.002']!.en,
    L10N['ui.commsAuro.003']!.en,
    L10N['ui.commsAuro.004']!.en,
  ],
  'msg-exile-swarm': [
    L10N['ui.commsExile.001']!.en,
    L10N['ui.commsExile.002']!.en,
    L10N['ui.commsExile.003']!.en,
  ],
  'msg-wormhole-nebula': [
    L10N['ui.signalSpace.004']!.en,
    L10N['ui.commsNebula.002']!.en,
    L10N['ui.commsNebula.003']!.en,
  ],
  'msg-ambush-retreat': [
    L10N['ui.commsRetreat.001']!.en,
    L10N['ui.commsRetreat.002']!.en,
    L10N['ui.commsRetreat.003']!.en,
    L10N['ui.commsRetreat.004']!.en,
  ],
  'msg-pirate-capture-web': [
    L10N['ui.commsWeb.001']!.en,
    L10N['ui.commsWeb.002']!.en,
    L10N['ui.commsWeb.003']!.en,
    L10N['ui.commsWeb.004']!.en,
  ],
  'msg-blackbox-plug-unlock': [
    L10N['ui.commsPlug.001']!.en,
    L10N['ui.commsPlug.002']!.en,
    L10N['ui.commsPlug.003']!.en,
  ],
  'msg-cinder-warning': [
    L10N['ui.commsCinder.001']!.en,
    L10N['ui.commsCinder.002']!.en,
    L10N['ui.commsCinder.003']!.en,
  ],
}

const COMMS_BRIEF_EN: Record<string, string> = {
  '协会的航道管理部门：登记呼号、发布航线与通行提示。':
    'The Association department for shipping lanes: registers callsigns and issues route and transit notices.',
  '协会的建站部门：负责前哨站立项、施工与并网。':
    'The Association department for construction: handles outpost proposals, works and grid hookup.',
  '协会的星域测绘部门：整理未知信号与已探明星系的资料。':
    'The Association department for surveying: keeps the records on unknown signals and charted systems.',
  '协会的产能管理部门：盯站内工位与生产线，专发产能提醒。':
    'The Association department for output: watches station berths and production lines, and sends production reminders.',
  '协会的精炼技术部门：给矿料与回收炉的产出算账。':
    'The Association department for refining: runs the numbers on ore and recycling output.',
  '协会的技能训练部门：主管技能队列与训练科目登记。':
    'The Association department for training: runs the skill queue and registers training subjects.',
  '协会的结算部门：管酬金、档位与建材结算。':
    'The Association department for settlement: handles pay, tiers and construction material accounts.',
  '协会的航线安全部门：发布危险星区与编队活动提示。':
    'The Association department for route safety: issues notices on dangerous systems and fleet activity.',
  '船自己的舰载信息库：自检后按条目回放记录，情报与建议都由它送达。':
    'The ship’s own onboard archive: after a self-check it replays its records entry by entry, and it is the sender for both intelligence and advice.',
  '信息库按条目重新载入记录的过程：把记下来的事一条条念给你听。':
    'The archive reloading its records entry by entry: reading back what it noted, one item at a time.',
  '章鱼人的官方行业组织，对外自称「协会」：管航道、建站点、定酬金，也训练新手飞行员。':
    'The official octopus trade body, calling itself “the Association”: it runs the lanes, builds the outposts, sets the pay, and trains new pilots.',
  '章鱼人的民间行会，与协会同族不同行：一帮在各星系转悠的老打捞，专捡没人要的残骸。':
    'A civilian octopus guild, same people as the Association but a different trade: old salvagers drifting between systems, picking up wreckage nobody else wants.',
  '常年在外圈转的打捞小队，残骸场里的门道比谁都熟。':
    'A salvage crew that works the outer systems year round, and knows the wreck fields better than anyone.',
}

export function commsBriefText(brief: string): string {
  if (!isEn()) return brief
  return COMMS_BRIEF_EN[brief] ?? brief
}

export function commsBodyText(id: string, paragraphs: readonly string[]): readonly string[] {
  if (!isEn()) return paragraphs
  if (id.startsWith('dlg:')) {
    const spec = COMMS_DIALOGUE_ID[id.slice(4)]
    if (!spec || spec.count !== paragraphs.length) return paragraphs
    const script = commsDialogueText({ id: id.slice(4), title: '', lines: paragraphs.map((text) => ({ speaker: '', text })) })
    return script.lines.map((line) => `${line.speaker}: ${line.text}`)
  }
  const en = COMMS_BODY_EN[id]
  return en !== undefined && en.length === paragraphs.length ? en : paragraphs
}


export function commsInstanceParams(
  params?: Readonly<Record<string, string | number>>,
): Record<string, string | number> {
  const src = params ?? {}
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(src)) {
    if (k.endsWith('Id')) continue
    const ref = src[`${k}Id`]
    out[k] = typeof ref === 'string' ? paramText(ref) : v
  }
  return out
}

export function commsRewardText(
  rewards: readonly CommsRewardLine[] | undefined,
  itemNameOf: (itemId: string) => string,
): string | undefined {
  if (rewards === undefined || rewards.length === 0) return undefined
  return rewards
    .map((r) =>
      r.isk !== undefined
        ? tr('ui.comms.071', { p1: r.isk.toLocaleString() })
        : tr('ui.comms.072', { p1: itemNameOf(r.itemId ?? ''), p2: r.qty ?? 1 }),
    )
    .join(tr('ui.comms.073'))
}

export function commsEntrySubjectText(
  entry: CommsEntryView,
  itemNameOf: (itemId: string) => string = (id) => id,
): string {
  if (entry.subjectId === undefined) return commsSubjectText(entry.id, entry.subject)
  const params = commsInstanceParams(entry.textParams)
  const list = commsRewardText(entry.rewards, itemNameOf)
  if (list !== undefined) params['p3'] = list
  return tr(entry.subjectId, params)
}

export function commsEntryBodyText(
  entry: CommsEntryView,
  itemNameOf: (itemId: string) => string = (id) => id,
): readonly string[] {
  if (entry.bodyIds === undefined) return commsBodyText(entry.id, entry.paragraphs)
  const params = commsInstanceParams(entry.textParams)
  const list = commsRewardText(entry.rewards, itemNameOf)
  if (list !== undefined) params['p3'] = list
  return entry.bodyIds.map((id) => tr(id, params))
}
