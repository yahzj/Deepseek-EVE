
export type BusyLabelId =
  | 'planetDelivery'
  | 'wormhole'
  | 'mining'
  | 'miningOut'
  | 'miningBack'
  | 'salvage'
  | 'salvageOut'
  | 'salvageBack'
  | 'hauling'
  | 'courier'
  | 'patrolTo'
  | 'patrol'
  | 'whscan'
  | 'expedition'
  | 'expOut'
  | 'expCombat'
  | 'expBack'
  | 'refine'
  | 'manufacture'
  | 'lab'
  | 'deliver'
  | 'unload'
  | 'aiMining'
  | 'aiMiningOut'
  | 'aiMiningBack'
  | 'aiPatrolTo'
  | 'aiPatrol'
  | 'aiExpedition'
  | 'aiExpOut'
  | 'aiExpCombat'
  | 'aiExpBack'

export const BUSY_LABEL_ID: Readonly<Record<BusyLabelId, string>> = {
  planetDelivery: 'core.busy.031',
  wormhole: 'core.busy.001',
  mining: 'core.busy.002',
  miningOut: 'core.busy.003',
  miningBack: 'core.busy.004',
  salvage: 'core.busy.005',
  salvageOut: 'core.busy.006',
  salvageBack: 'core.busy.007',
  hauling: 'core.busy.008',
  courier: 'core.busy.009',
  patrolTo: 'core.busy.010',
  patrol: 'core.busy.011',
  whscan: 'core.busy.012',
  expedition: 'core.busy.013',
  expOut: 'core.busy.014',
  expCombat: 'core.busy.015',
  expBack: 'core.busy.016',
  refine: 'core.busy.017',
  manufacture: 'core.busy.018',
  lab: 'core.busy.030',
  deliver: 'core.busy.019',
  unload: 'core.busy.020',
  aiMining: 'core.busy.021',
  aiMiningOut: 'core.busy.022',
  aiMiningBack: 'core.busy.023',
  aiPatrolTo: 'core.busy.024',
  aiPatrol: 'core.busy.025',
  aiExpedition: 'core.busy.026',
  aiExpOut: 'core.busy.027',
  aiExpCombat: 'core.busy.028',
  aiExpBack: 'core.busy.029',
}

export const BUSY_TEXT: Readonly<Record<BusyLabelId, string>> = {
  planetDelivery: '星球物资运输中',
  wormhole: '虫洞探索中',
  mining: '采矿中',
  miningOut: '采矿·出航中',
  miningBack: '采矿·返航中',
  salvage: '打捞中',
  salvageOut: '打捞·出航中',
  salvageBack: '打捞·返航中',
  hauling: '长途运输中',
  courier: '快递投送中',
  patrolTo: '掩护巡逻·前往{p1}中',
  patrol: '掩护巡逻中',
  whscan: '扫描虫洞中',
  expedition: '远征中',
  expOut: '远征·出航中',
  expCombat: '远征·交火中',
  expBack: '远征·返航中',
  refine: '亲自开炉精炼中',
  manufacture: '亲自开线制造中',
  lab: '亲自运转实验室中',
  deliver: '建站交付中',
  unload: '返航卸货中',
  aiMining: 'AI 采矿中',
  aiMiningOut: 'AI 采矿·出航中',
  aiMiningBack: 'AI 采矿·返航中',
  aiPatrolTo: 'AI 掩护巡逻·去程中',
  aiPatrol: 'AI 掩护巡逻中',
  aiExpedition: 'AI 远征中',
  aiExpOut: 'AI 远征·去程中',
  aiExpCombat: 'AI 远征·交火中',
  aiExpBack: 'AI 远征·返航中',
}

export interface BusyLabel {
  error: string
  errorId: string
  errorParams?: Readonly<Record<string, string | number>>
}

export function busyLabel(id: BusyLabelId, params?: Readonly<Record<string, string | number>>): BusyLabel {
  const raw = BUSY_TEXT[id]
  const text = params ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : raw
  return { error: text, errorId: BUSY_LABEL_ID[id], ...(params ? { errorParams: params } : {}) }
}
