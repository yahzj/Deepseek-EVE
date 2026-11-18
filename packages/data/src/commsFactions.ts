import type { CommsFactionDef } from '@whale/core'

const ACADEMY_DEPTS: CommsFactionDef['departments'] = [
  {
    id: 'dept-nav-control',
    name: '航行管制',
    brief: '协会的航道管理部门：登记呼号、发布航线与通行提示。',
    kinds: ['剧情', '提示'],
  },
  {
    id: 'dept-infra',
    name: '基建部',
    brief: '协会的建站部门：负责前哨站立项、施工与并网。',
    kinds: ['剧情', '提示', '委托'],
  },
  {
    id: 'dept-survey',
    name: '测绘处',
    brief: '协会的星域测绘部门：整理未知信号与已探明星系的资料。',
    kinds: ['剧情', '提示'],
  },
  {
    id: 'dept-industry',
    name: '工业部',
    brief: '协会的产能管理部门：盯站内工位与生产线，专发产能提醒。',
    kinds: ['提示'],
  },
  {
    id: 'dept-smelt',
    name: '冶炼组',
    brief: '协会的精炼技术部门：给矿料与回收炉的产出算账。',
    kinds: ['提示'],
  },
  {
    id: 'dept-training',
    name: '训练处',
    brief: '协会的技能训练部门：主管技能队列与训练科目登记。',
    kinds: ['剧情', '提示'],
  },
  {
    id: 'dept-finance',
    name: '财务处',
    brief: '协会的结算部门：管酬金、档位与建材结算。',
    kinds: ['提示', '委托'],
  },
  {
    id: 'dept-route-safety',
    name: '航线安全',
    brief: '协会的航线安全部门：发布危险星区与编队活动提示。',
    kinds: ['剧情', '提示'],
  },
]

export const FACTION_OCTOPUS_GLYPH = 'faction-octopus'

export const FACTION_CORE_GLYPH = 'nav-ai'

export const COMMS_FACTIONS: readonly CommsFactionDef[] = [
  {
    id: 'archive',
    name: '信息库',
    species: '舰载系统',
    alignment: '系统',
    tone: 'var(--wui-tone-nav-ai)',
    glyph: FACTION_CORE_GLYPH,
    brief: '船自己的舰载信息库：自检后按条目回放记录，情报与建议都由它送达。',
    kinds: ['提示'],
    departments: [
      {
        id: 'dept-recall',
        name: '检索重启',
        brief: '信息库按条目重新载入记录的过程：把记下来的事一条条念给你听。',
        kinds: ['提示'],
      },
    ],
  },
  {
    id: 'dshi',
    name: '深空工业协会',
    species: '章鱼人',
    alignment: '官方',
    tone: 'var(--wui-tone-nav-mail)',
    glyph: FACTION_OCTOPUS_GLYPH,
    brief: '章鱼人的官方行业组织，对外自称「协会」：管航道、建站点、定酬金，也训练新手飞行员。',
    kinds: ['剧情', '提示', '委托'],
    departments: ACADEMY_DEPTS,
  },
  {
    id: 'salvage-guild',
    name: '打捞队工会',
    species: '章鱼人',
    alignment: '民间',
    tone: 'var(--wui-tone-nav-salvage)',
    glyph: FACTION_OCTOPUS_GLYPH,
    brief: '章鱼人的民间行会，与协会同族不同行：一帮在各星系转悠的老打捞，专捡没人要的残骸。',
    kinds: ['剧情', '提示'],
    departments: [
      {
        id: 'dept-salvage-crew',
        name: '老陈一队',
        brief: '常年在外圈转的打捞小队，残骸场里的门道比谁都熟。',
        kinds: ['剧情', '提示'],
      },
    ],
  },
  {
    id: 'black-market',
    name: '黑市',
    species: '章鱼人',
    alignment: '中立',
    tone: 'var(--wui-tone-nav-shop)',
    glyph: FACTION_OCTOPUS_GLYPH,
    brief: '不问来路的买卖人：违禁货、溢价现货、没人认领的东西，他们都要。',
    kinds: ['剧情', '提示'],
    departments: [
      {
        id: 'dept-contraband',
        name: '违禁品柜',
        brief: '黑市里经手违禁货的那一格：信标、超频包这类东西的用法与后果，他们最清楚。',
        kinds: ['提示'],
      },
    ],
  },
]

export function buildCommsFactionCatalog(): ReadonlyMap<string, CommsFactionDef> {
  return new Map(COMMS_FACTIONS.map((f) => [f.id, f]))
}

export const FACTION_AVATARS: Record<string, string> = {
  archive: FACTION_CORE_GLYPH,
  dshi: FACTION_OCTOPUS_GLYPH,
  'salvage-guild': FACTION_OCTOPUS_GLYPH,
  'black-market': FACTION_OCTOPUS_GLYPH,
}

export function buildCommsDeptCatalog(): ReadonlyMap<string, CommsFactionDef['departments'][number]> {
  const out = new Map<string, CommsFactionDef['departments'][number]>()
  for (const f of COMMS_FACTIONS) {
    for (const d of f.departments) out.set(`${f.id}/${d.id}`, d)
  }
  return out
}
