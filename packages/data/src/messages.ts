import { COMMAND_STANDING_REQUIRED, type CommsMessageDef } from '@whale/core'
import { FIRST_TASK_MESSAGES } from './firstTaskMessages'
import { L10N } from './l10n/table'

const BRIEFING_MESSAGE: CommsMessageDef = {
  id: 'msg-briefing',
  factionId: 'archive',
  deptId: 'dept-recall',
  kind: '提示',
  subject: L10N['ui.comms.027']!.zh,
  body: [
    L10N['ui.firstBriefing.001']!.zh,
    L10N['ui.firstBriefing.002']!.zh,
  ],
  trigger: { kind: 'start' },
  hint: { text: L10N['ui.comms.052']!.zh, page: 'task', taskTab: 'important' },
}

export const COMMS_MESSAGES: readonly CommsMessageDef[] = [
  {
    id: 'msg-industrial-fleet-risk', factionId: 'dshi', deptId: 'dept-route-safety', kind: '提示',
    subject: L10N['ui.commsIndustrialRisk.001']!.zh,
    body: [L10N['ui.commsIndustrialRisk.002']!.zh, L10N['ui.commsIndustrialRisk.003']!.zh],
    trigger: { kind: 'industrialFleetRisk' }, holdWhenBusy: true,
    hint: { text: L10N['ui.commsIndustrialRisk.004']!.zh, page: 'ship', shipTab: 'fleet' },
  },
  ...FIRST_TASK_MESSAGES,
  BRIEFING_MESSAGE,
  {
    id: 'msg-welcome',
    factionId: 'dshi',
    deptId: 'dept-nav-control',
    kind: '剧情',
    subject: L10N['ui.comms.028']!.zh,
    body: [
      L10N['ui.commsWelcome.001']!.zh,
      L10N['ui.commsWelcome.002']!.zh,
    ],
    trigger: { kind: 'start' },
    hint: { text: '想先看看这片星域长什么样？去星图认认路。', page: 'map' },
  },
  {
    id: 'msg-survey-memo',
    factionId: 'dshi',
    deptId: 'dept-survey',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.029']!.zh,
    body: [
      L10N['ui.commsSurvey.001']!.zh,
      L10N['ui.commsSurvey.002']!.zh,
      L10N['ui.commsSurvey.003']!.zh,
    ],
    trigger: { kind: 'explored', count: 3 },
    hint: { text: '星图 · 点选未知信号开始扫描', page: 'map' },
  },
  {
    id: 'msg-cinder-warning',
    factionId: 'dshi',
    deptId: 'dept-route-safety',
    kind: '剧情',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.030']!.zh,
    body: [
      L10N['ui.commsCinder.001']!.zh,
      L10N['ui.commsCinder.002']!.zh,
      L10N['ui.commsCinder.003']!.zh,
    ],
    trigger: { kind: 'galaxy', galaxyId: 'galaxy-cinder' },
    hint: { text: '出发前先去装配页检查一遍武器与防护。', page: 'fit' },
  },
  {
    id: 'msg-industry-shift',
    factionId: 'dshi',
    deptId: 'dept-industry',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.031']!.zh,
    body: [
      L10N['ui.commsIndustry.001']!.zh,
      L10N['ui.commsIndustry.002']!.zh,
      L10N['ui.commsIndustry.003']!.zh,
    ],
    trigger: { kind: 'isk', amount: 50000 },
    hint: { text: '工业页可以同时开多台炉子。', page: 'industry' },
  },
  {
    id: 'msg-refinery-note',
    factionId: 'dshi',
    deptId: 'dept-smelt',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.032']!.zh,
    body: [
      L10N['ui.commsSmelt.001']!.zh,
      L10N['ui.commsSmelt.002']!.zh,
      L10N['ui.commsSmelt.003']!.zh,
    ],
    trigger: { kind: 'skill', skillId: 'refining', level: 2 },
    hint: { text: '技能页可以先把精炼学排进队列。', page: 'skills' },
  },
  {
    id: 'msg-salvage-crew',
    factionId: 'salvage-guild',
    deptId: 'dept-salvage-crew',
    kind: '提示',
    subject: L10N['ui.comms.033']!.zh,
    body: [
      L10N['ui.commsSalvage.001']!.zh,
      L10N['ui.commsSalvage.002']!.zh,
      L10N['ui.commsSalvage.003']!.zh,
      L10N['ui.commsSalvage.004']!.zh,
    ],
    trigger: { kind: 'explored', count: 6 },
    hint: { text: '星图 · 残骸打捞页有各星系的残骸存量。', page: 'map', tab: 'salvage' },
  },
  {
    id: 'msg-site-thanks',
    factionId: 'dshi',
    deptId: 'dept-infra',
    kind: '剧情',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.034']!.zh,
    body: [
      L10N['ui.commsThanks.001']!.zh,
      L10N['ui.commsThanks.002']!.zh,
      L10N['ui.commsThanks.003']!.zh,
    ],
    trigger: { kind: 'siteBuilt', siteId: 'site-redring' },
    hint: { text: '副站建成后泊位、维修、补给与换船全部开放。', page: 'ship' },
  },

  {
    id: 'msg-auro-megastructure',
    factionId: 'dshi',
    deptId: 'dept-survey',
    kind: '剧情',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.035']!.zh,
    body: [
      L10N['ui.commsAuro.001']!.zh,
      L10N['ui.commsAuro.002']!.zh,
      L10N['ui.commsAuro.003']!.zh,
      L10N['ui.commsAuro.004']!.zh,
    ],
    trigger: { kind: 'galaxy', galaxyId: 'galaxy-auro' },
    hint: { text: '出发前在装配页把对空火力与装甲补齐。', page: 'fit' },
  },
  {
    id: 'msg-exile-swarm',
    factionId: 'dshi',
    deptId: 'dept-route-safety',
    kind: '剧情',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.036']!.zh,
    body: [
      L10N['ui.commsExile.001']!.zh,
      L10N['ui.commsExile.002']!.zh,
      L10N['ui.commsExile.003']!.zh,
    ],
    trigger: { kind: 'foeFamily', family: 'G' },
    hint: { text: '打之前先去装配页，把对空火力带上。', page: 'fit' },
  },
  {
    id: 'msg-wh-siege',
    factionId: 'dshi',
    deptId: 'dept-route-safety',
    kind: '剧情',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.067']!.zh,
    body: [
      L10N['ui.commsSiege.001']!.zh,
      L10N['ui.commsSiege.002']!.zh,
      L10N['ui.commsSiege.003']!.zh,
    ],
    trigger: { kind: 'wormholeSiege' },
  },
  {
    id: 'msg-lowsec-rules',
    factionId: 'dshi',
    deptId: 'dept-route-safety',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.037']!.zh,
    body: [
      L10N['ui.commsLowsec.001']!.zh,
      L10N['ui.commsLowsec.002']!.zh,
      L10N['ui.commsLowsec.003']!.zh,
    ],
    trigger: { kind: 'lowSec' },
    hint: { text: '星图 · 出发前看清目标星系的安全等级。', page: 'map' },
  },
  {
    id: 'msg-redring-outpost',
    factionId: 'dshi',
    deptId: 'dept-infra',
    kind: '委托',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.038']!.zh,
    body: [
      L10N['ui.commsOutpost.001']!.zh,
      L10N['ui.commsOutpost.002']!.zh,
      L10N['ui.commsOutpost.003']!.zh,
      L10N['ui.commsOutpost.004']!.zh,
    ],
    trigger: { kind: 'galaxy', galaxyId: 'galaxy-redring' },
    hint: { text: '星图 · 选「红环航道」查看建站交付。', page: 'map' },
  },
  {
    id: 'msg-wormhole-nebula',
    factionId: 'dshi',
    deptId: 'dept-survey',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.039']!.zh,
    body: [
      L10N['ui.signalSpace.004']!.zh,
      L10N['ui.commsNebula.002']!.zh,
      L10N['ui.commsNebula.003']!.zh,
    ],
    trigger: { kind: 'wormholeNebula' },
  },
  {
    id: 'msg-wormhole-unlock',
    factionId: 'dshi',
    deptId: 'dept-survey',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.signalSpace.025']!.zh,
    body: [
      L10N['ui.signalSpace.005']!.zh,
      L10N['ui.signalSpace.006']!.zh,
      L10N['ui.signalSpace.007']!.zh,
      L10N['ui.signalSpace.008']!.zh,
    ],
    trigger: { kind: 'standing', factionId: 'dsi', min: 40 },
    popup: true,
    hint: { text: '星图 · 出港 · 「扫描信号空间」标签开始扫描', page: 'map' },
  },
  {
    id: 'msg-ambush-retreat',
    factionId: 'dshi',
    deptId: 'dept-route-safety',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.041']!.zh,
    body: [
      L10N['ui.commsRetreat.001']!.zh,
      L10N['ui.commsRetreat.002']!.zh,
      L10N['ui.commsRetreat.003']!.zh,
      L10N['ui.commsRetreat.004']!.zh,
    ],
    trigger: { kind: 'ambushRetreat' },
    hint: { text: '工业页 · 造一批修理组件，给船装上维修装置', page: 'industry' },
  },
  {
    id: 'msg-first-ship',
    factionId: 'dshi',
    deptId: 'dept-industry',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.042']!.zh,
    body: [
      L10N['ui.commsFirstship.001']!.zh,
      L10N['ui.commsFirstship.002']!.zh,
      L10N['ui.commsFirstship.003']!.zh,
      L10N['ui.commsFirstship.004']!.zh,
    ],
    trigger: { kind: 'shipBuilt' },
    hint: { text: '舰船页 · 「舰船仓库」可转入舰队或出售', page: 'ship', shipTab: 'store' },
  },
  {
    id: 'msg-pirate-capture-web',
    factionId: 'dshi',
    deptId: 'dept-route-safety',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.043']!.zh,
    body: [
      L10N['ui.commsWeb.001']!.zh,
      L10N['ui.commsWeb.002']!.zh,
      L10N['ui.commsWeb.003']!.zh,
      L10N['ui.commsWeb.004']!.zh,
    ],
    trigger: { kind: 'foeShipSeen', shipId: 'foe-pirate-raider' },
    holdWhenBusy: true,
  },
  {
    id: 'msg-blackbox-plug-unlock',
    factionId: 'dshi',
    deptId: 'dept-industry',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.079']!.zh,
    body: [
      L10N['ui.commsPlug.001']!.zh,
      L10N['ui.commsPlug.002']!.zh,
      L10N['ui.commsPlug.003']!.zh,
    ],
    trigger: { kind: 'blackboxSeen' },
    hint: { text: '前往声望商店兑换', page: 'industry', action: 'plug-exchange' },
  },
  {
    id: 'msg-lab-contraband',
    factionId: 'black-market',
    deptId: 'dept-contraband',
    kind: '提示',
    subject: L10N['ui.comms.076']!.zh,
    body: [
      L10N['ui.commsContraband.001']!.zh,
      L10N['ui.commsContraband.002']!.zh,
      L10N['ui.commsContraband.003']!.zh,
      L10N['ui.commsContraband.004']!.zh,
      L10N['ui.commsContraband.005']!.zh,
    ],
    highlight: [
      L10N['ui.commsContraband.004']!.zh,
      L10N['ui.commsContraband.005']!.zh,
    ],
    trigger: { kind: 'labOpened' },
    hint: { text: '工业页的实验室能造这两样。', page: 'industry' },
  },
  {
    id: 'msg-black-market-unlock',
    factionId: 'black-market',
    deptId: 'dept-contraband',
    kind: '提示',
    subject: L10N['ui.commsBlackMarket.001']!.zh,
    body: [
      L10N['ui.commsBlackMarket.002']!.zh,
      L10N['ui.commsBlackMarket.003']!.zh,
      L10N['ui.commsBlackMarket.004']!.zh,
    ],
    trigger: { kind: 'standing', factionId: 'dsi', min: 100 },
    hint: { text: L10N['ui.commsBlackMarket.005']!.zh, page: 'market' },
  },
  {
    id: 'msg-fleet-command-unlock',
    factionId: 'dshi',
    deptId: 'dept-training',
    kind: '提示',
    subject: L10N['ui.commsFleetUnlock.001']!.zh,
    body: [
      L10N['ui.commsFleetUnlock.002']!.zh,
      L10N['ui.commsFleetUnlock.003']!.zh,
    ],
    trigger: { kind: 'standing', factionId: 'dsi', min: COMMAND_STANDING_REQUIRED },
    popup: true,
    hint: { text: L10N['ui.commsFleetUnlock.004']!.zh, page: 'skills', tab: '舰船', skillBranch: 'b-command' },
  },
]

export function buildCommsCatalog(): ReadonlyMap<string, CommsMessageDef> {
  const messages = [...COMMS_MESSAGES].sort((a, b) => Number(b.id === 'msg-fleet-command-unlock') - Number(a.id === 'msg-fleet-command-unlock'))
  return new Map(messages.map((m) => [m.id, m]))
}
