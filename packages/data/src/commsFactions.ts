/**
 * NPC 势力档案（协会侧；2026-09-11 通讯 v2 船长定）。
 *
 * 世界观口径（详见 `docs/design/npc-factions-20260911.md`）：
 * - **官方势力 = 章鱼人**（无更正式族名；协会对外自称「协会」）；打捞队工会等其他 NPC 同为章鱼人，**同族不同行会**；
 * - 章鱼人**不追问船里是谁**：把玩家当**普通承包舰船**，不做特殊对待，也不谈人类（人类早已离开/消失在深空）；
 * - 玩家被称**「飞行员」**（协会职务称呼，与物种无关；自定义名 = 呼号）。
 *
 * 数据纪律（新增势力/部门必须同步「数据 + 词典 + 契约」三处）：
 * - `id` 稳定、不复用；部门 `id` 在势力内唯一；
 * - `tone` 取色与既有系统同源（协会 = `nav-mail` 同族的青白蓝，打捞队工会 = `nav-salvage` 同族的青）；
 * - `glyph` 必须是既有 SVG 线稿图标名（`apps/desktop/src/renderer/src/ui/Glyphs.tsx` 的 `NAV_TONES`/`ICO_TONES` 家族）；
 * - `kinds` = 该势力**允许发的内容类型白名单**（消息的 `kind` 必须落在发件势力的白名单里，契约强制）。
 */
import type { CommsFactionDef } from '@whale/core'

/** 深空工业协会（章鱼人 · 官方）：8 个会对外发消息的部门 */
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

/**
 * 官方章鱼人头像（2026-09-11 船长定：绘制章鱼头代表官方，之后都用于代表官方章鱼人）。
 *
 * **所有 NPC 势力的物种都是「章鱼人」**，故 NPC 头像一律用这枚 glyph（`ui/Glyphs.tsx` 的 `faction-octopus`）；
 * 不同势力/行会**只靠 `tone` 色调区分**，不再另画新头像——新增 NPC 势力时沿用本常量。
 */
export const FACTION_OCTOPUS_GLYPH = 'faction-octopus'

/**
 * 舰载信息库（船自己的系统）头像（2026-09-11 船长：「头像换成类似核心的SVG」）。
 * 与 NPC 分开：教程/简报这类**船内系统来信**用「核心」形图标（`nav-ai`，粉色调），
 * 协会 NPC 的来信仍用章鱼头。
 */
export const FACTION_CORE_GLYPH = 'nav-ai'

/** 全量势力档案（id 稳定；NPC 与船内系统共用一张表，靠 `alignment` 区分） */
export const COMMS_FACTIONS: readonly CommsFactionDef[] = [
  {
    /**
     * 舰载信息库（2026-09-11 船长定：「消息来源修改为信息库检索重启方案」）。
     * **不是 NPC**：它是船自己的系统，醒来自检后按条目回放既有记录——
     * 教程与简报就以「检索重启」的名义从这里发到收件箱（头像用核心形图标，与 NPC 的章鱼头分开）。
     */
    id: 'archive',
    name: '信息库',
    species: '舰载系统',
    alignment: '系统',
    tone: '#ff8ab5',
    glyph: FACTION_CORE_GLYPH,
    brief: '这条船自己的舰载信息库：自检后按条目回放既有记录，教程与行动建议都以它检索重启的方式送达。',
    kinds: ['教程', '提示'],
    departments: [
      {
        id: 'dept-recall',
        name: '检索重启',
        brief: '信息库按条目重新载入记录的过程：把该干的活按顺序念给你听。',
        kinds: ['教程', '提示'],
      },
    ],
  },
  {
    id: 'dshi',
    name: '深空工业协会',
    species: '章鱼人',
    alignment: '官方',
    tone: '#9fd8ff',
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
    tone: '#6fe3f0',
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
]

/** 势力目录（core 解析发件人；按 id 稳定查表） */
export function buildCommsFactionCatalog(): ReadonlyMap<string, CommsFactionDef> {
  return new Map(COMMS_FACTIONS.map((f) => [f.id, f]))
}

/**
 * 势力 → 头像（2026-09-11 船长：「头像换成类似核心的SVG」⇒ 按发件方分两种头像）。
 *
 * **船内系统（信息库）用「核心」形图标**（`nav-ai`，粉色调）；**NPC 势力一律用官方章鱼头**
 * （`faction-octopus`，只靠 `tone` 区分行会）。新增势力时：NPC 沿用章鱼头，船内系统沿用核心。
 * 界面拿到不在表里的图标名时**降级用章鱼头**（见 `resolveCommsSender` 的注释）。
 */
export const FACTION_AVATARS: Record<string, string> = {
  archive: FACTION_CORE_GLYPH,
  dshi: FACTION_OCTOPUS_GLYPH,
  'salvage-guild': FACTION_OCTOPUS_GLYPH,
}

/** 部门目录（键 = `势力 id/部门 id`，core 解析发件部门；省得逐层查找） */
export function buildCommsDeptCatalog(): ReadonlyMap<string, CommsFactionDef['departments'][number]> {
  const out = new Map<string, CommsFactionDef['departments'][number]>()
  for (const f of COMMS_FACTIONS) {
    for (const d of f.departments) out.set(`${f.id}/${d.id}`, d)
  }
  return out
}
