/**
 * 通讯消息表（2026-09-11 船长定：NPC 通过"给玩家发消息"补充剧情或发布任务提示）。
 *
 * 口径（详见 `docs/design/comms-20260911.md` 与 `docs/design/npc-factions-20260911.md`）：
 * - 每条 = 一封**收件箱消息**（发件势力/部门 / 内容类型 / 主题 / 正文 / 送达条件）；core 每帧廉价判定、条件满足一次即送达（幂等）。
 * - **发件人不在这里写自由文本**（2026-09-11 v2）：只填 `factionId`（+ 可选 `deptId`、`signer`），
 *   玩家看到的 `势力名 · 部门名` 由 `data/src/commsFactions.ts` 拼出。
 * - **只给提示 + 跳转**：消息可以带一句 `hint` 与目标页，但**不在通讯页里接取或完成任务**。
 * - 任务类内容一律写成"协会的委托/备忘"口吻，跳转只是把玩家带回对应页面，不替代任务板。
 * - 玩家可见文案纪律（约定第十三章）：不出现开发/商讨用词；**不得出现指涉玩家本质的词**
 *   （AI / 智能 / 旧时代 / 人类），也不得用「你的舰船」这类把玩家与船分开的说法——**玩家就是那条船**。
 * - `replies` 为**预留**字段（回复选项接口），本期不启用（`core/comms.ts` 的 COMMS_REPLIES_ENABLED = false）。
 */
import type { CommsMessageDef } from '@whale/core'
import { BRIEFING_INTRO, TUTORIAL_STEPS } from './tutorialSteps'

/**
 * 序章简报（`tut-0`；2026-09-11 船长定）：睁眼动画结束后先送这封，玩家读完点「开始教程」才进第 1 步。
 * 触发器 `{ kind: 'tutorial', step: 0 }` = 到达简报态（`ONB_BRIEFING`）即送达。
 * 发件方 = **舰载信息库 · 检索重启**（船长 2026-09-11：「消息来源修改为信息库检索重启方案」）。
 */
const BRIEFING_MESSAGE: CommsMessageDef = {
  id: 'tut-0',
  factionId: 'archive',
  deptId: 'dept-recall',
  kind: '教程',
  subject: BRIEFING_INTRO.subject,
  body: BRIEFING_INTRO.lines,
  // 2026-09-11 船长：「将训前简报的任务链内的文字高亮」——任务链那七行在正文里加既有的强调样式
  highlight: BRIEFING_INTRO.highlight,
  trigger: { kind: 'tutorial', step: 0 },
  hint: { text: BRIEFING_INTRO.hint, page: 'comms' },
  action: { label: BRIEFING_INTRO.actionLabel, command: 'startTutorial' },
}

/**
 * 序章教程七封通讯（2026-09-11 船长定：**教程融入通讯**——每步开始时送达该步指引，右下角引导卡取消）。
 * 文案与跳转全部取自 `./tutorialSteps`（单一出处）；发件方 = **舰载信息库 · 检索重启**（船自己的系统）。
 */
const TUTORIAL_MESSAGES: readonly CommsMessageDef[] = TUTORIAL_STEPS.map((s) => ({
  id: `tut-${s.step}`,
  factionId: 'archive',
  deptId: 'dept-recall',
  kind: '教程',
  subject: `检索重启 ${s.step}/${TUTORIAL_STEPS.length}：${s.title}`,
  body: s.lines,
  trigger: { kind: 'tutorial', step: s.step },
  hint: { text: s.goal, page: s.page, ...(s.mapTab ? { tab: s.mapTab } : {}), ...(s.shipTab ? { shipTab: s.shipTab } : {}) },
}))

/** 全部通讯消息（id 稳定；新增即追加，不要改既有 id——已读/送达按 id 记账） */
export const COMMS_MESSAGES: readonly CommsMessageDef[] = [
  BRIEFING_MESSAGE,
  ...TUTORIAL_MESSAGES,
  {
    id: 'msg-welcome',
    factionId: 'dshi',
    deptId: 'dept-nav-control',
    kind: '剧情',
    subject: '终端接入确认：呼号已登记',
    body: [
      '飞行员，协会的通讯终端已经接到你这条船上。往后协会各部门、合作方与航线上的熟人，有事都会直接发到这里。',
      '导航栏「通讯」上有未读时图标会闪，点开读完即止——重要的事我们只发一次，不会反复催。',
      '老规矩：能自己干的活，协会不替你做；要看当下有什么可接的活，去任务中心看板。',
    ],
    trigger: { kind: 'start' },
    hint: { text: '想先看看这片星域长什么样？去星图认认路。', page: 'map' },
  },
  {
    id: 'msg-survey-memo',
    factionId: 'dshi',
    deptId: 'dept-survey',
    kind: '提示',
    subject: '测绘备忘：未知信号优先',
    body: [
      '你探明的星系已经够多了，这里有一份测绘处的备忘。',
      '星图上那些还没点亮的「未知信号」，扫开之后往往同时解决两件事：一是航路，二是货源——很多矿带与残骸场就在没人去过的星系里。',
      '顺带提醒：安全等级越低的地方，就地扫描越费时间，别在低安挂着一台扫描等它自己好。',
    ],
    trigger: { kind: 'explored', count: 3 },
    hint: { text: '星图 · 点选未知信号开始扫描', page: 'map' },
  },
  {
    id: 'msg-cinder-warning',
    factionId: 'dshi',
    deptId: 'dept-route-safety',
    kind: '剧情',
    subject: '航线警告：烬火星区',
    body: [
      '烬火星区能见度极差，灰霾里蹲着的舰影比雷达上看到的多。',
      '协会不建议没有改装的船单舰深入：那边动手的多是火力齐全的编队，一旦进了它们的射程，跑不跑得掉只看装甲。',
      '真要进去，先在装配上把装甲与推进器补齐，再带上备弹——那里的战斗不会给你第二次装填的机会。',
    ],
    trigger: { kind: 'galaxy', galaxyId: 'galaxy-cinder' },
    hint: { text: '出发前先去装配页检查一遍武器与防护。', page: 'fit' },
  },
  {
    id: 'msg-industry-shift',
    factionId: 'dshi',
    deptId: 'dept-industry',
    kind: '提示',
    subject: '产能提醒：别让工位空着',
    body: [
      '账上有余钱了？协会工业部提醒一句：站内工位空着就是白亏。',
      '精炼炉与残骸回收炉可以多台并行——你亲自盯一台，其余交给 AI 核心各管一台；原料按批实时结算，料尽自动停炉，不用守着。',
      'AI 核心不够就先补核心，或者训练「AI 核心操作学」把启用上限抬上去。',
    ],
    trigger: { kind: 'isk', amount: 50000 },
    hint: { text: '工业页可以同时开多台炉子。', page: 'industry' },
  },
  {
    id: 'msg-refinery-note',
    factionId: 'dshi',
    deptId: 'dept-smelt',
    kind: '提示',
    subject: '冶炼交底：精炼学值不值',
    body: [
      '有人问精炼到底划不划算，冶炼组给个交底。',
      '同一批矿石，精炼学每级多出一成产出，高级回收处理再叠一档——矿石在手上越久，这两项的差别越明显。',
      '另外记一条：稀有残骸进回收炉是「一件一炉」，起炉即把那件料收进炉内料账，卡面会写清炉内料余多少，停炉时没烧完的部分会退回物品仓库。',
    ],
    trigger: { kind: 'skill', skillId: 'refining', level: 2 },
    hint: { text: '技能页可以先把精炼学排进队列。', page: 'skills' },
  },
  {
    id: 'msg-salvage-crew',
    factionId: 'salvage-guild',
    deptId: 'dept-salvage-crew',
    kind: '提示',
    subject: '漂着的东西比你想象的多',
    body: [
      '我们几个老打捞的在各个星系转，残骸场里的东西从来不缺，缺的是愿意停船捡的人。',
      '普通残骸拆解出保底矿物，另有概率翻出装备与蓝图碎片；窝点打下来的稀有残骸更值钱，回收炉里能开出整件装备。',
      '提醒一句：残骸按体积记账，货舱塞满了就自动返航——想多捡，先把货舱换大点。',
    ],
    trigger: { kind: 'explored', count: 6 },
    hint: { text: '星图 · 残骸打捞页有各星系的残骸存量。', page: 'map', tab: 'salvage' },
  },
  {
    id: 'msg-site-thanks',
    factionId: 'dshi',
    deptId: 'dept-infra',
    kind: '剧情',
    subject: '并网致谢：前哨站已点亮',
    body: [
      '红环前哨站并网运行的第一个班次，基建部全体向你致意。',
      '从今天起，这条航线上跑的矿船、维修船与补给船都会经过你建的泊位——协会基地网络里，多了一个署你名字的节点。',
      '下一座站点如果也交给你，协会照旧按档结算建材，不多收一分。',
    ],
    trigger: { kind: 'siteBuilt', siteId: 'site-redring' },
    hint: { text: '副站建成后泊位、维修、补给与换船全部开放。', page: 'ship' },
  },
]

/** 通讯消息目录（core 判定触发器；按 id 稳定查表） */
export function buildCommsCatalog(): ReadonlyMap<string, CommsMessageDef> {
  return new Map(COMMS_MESSAGES.map((m) => [m.id, m]))
}
