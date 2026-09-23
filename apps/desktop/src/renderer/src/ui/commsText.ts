/**
 * **通讯文案的本地化单点**（2026-09-22 · 船长令「你继续本地化」）。
 *
 * 病根：通讯是**数据侧**文案 —— `CommsMessageDef.subject`（30 封）与势力/部门名（`commsFactions.ts`）
 * 都是纯中文，core 还会把发件人拼成「势力名 · 部门名」再交给界面（`comms.ts` 的 `resolveCommsSender`）
 * ⇒ 英文界面下整页中文（实测通讯页 49 处）。
 *
 * 口径（沿用 `ui/labelsText.ts` 的"中文即键"做法，**data/core 一个字节不动**）：
 * - 发件人：**按中文名映射**（协会/部门名是数据侧稳定中文名）⇒ `commsSenderText()`；
 * - 主题行：**按消息稳定 id 映射**（`CommsMessageDef.id` 是"已送达/已读记账"的稳定键）⇒ `commsSubjectText()`；
 * - 时间：`commsGameClock()` 是中文整句 ⇒ 这里用 core 导出的 `COMMS_DAY_MS` 自己算"第几天 + 时:分"，
 *   句子由 `ui.comms.044` 出。
 * ⚠ **查不到一律原样返回**（新剧本/新部门漏登记时看得见中文，不会静默变空）。
 * ⚠ 新增通讯/部门时**同步在下面两张表加一行**。
 *
 * 本批未覆盖：正文段落（`body`，约 90 行）与部门简介（`brief`，悬停说明）——正文另开一遍。
 */
import { COMMS_DAY_MS } from '@whale/core'
import { isEn, tr } from '../i18n/locale'

/** 势力 / 部门 / 小队名 → l10n id（键 = 数据侧中文名，`ui.comms.001~013`） */
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
}

/**
 * 发件人写法（core 拼好的 `势力名 · 部门名`，或降级时的原文 id）→ 当前语言。
 * 按 ` · ` 拆开逐段映射（分隔符语言中立，照原样拼回；玩家自定义名一类查不到的原样保留）。
 */
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

/** 消息 id → 主题行的 l10n id（键 = `CommsMessageDef.id`，`ui.comms.014~043`） */
const COMMS_SUBJECT_ID: Record<string, string> = {
  // ── 「第一次」13 封（`firstTaskMessages.ts`）──
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
  // ── 开局与协会侧剧本（`messages.ts`）──
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
}

/** 主题行（有登记走当前语言；没登记回落数据侧原文） */
export function commsSubjectText(id: string, fallback: string): string {
  const l10nId = COMMS_SUBJECT_ID[id]
  return l10nId !== undefined ? tr(l10nId) : fallback
}

/** 送达时间（「第 N 天 HH:MM」的本地化版；算法与 core `commsGameClock` 同源） */
export function commsClockText(gameMs: number): string {
  const t = Math.max(0, Math.floor(gameMs))
  const day = Math.floor(t / COMMS_DAY_MS) + 1
  const rest = t % COMMS_DAY_MS
  const hh = String(Math.floor(rest / 3_600_000)).padStart(2, '0')
  const mm = String(Math.floor((rest % 3_600_000) / 60_000)).padStart(2, '0')
  return tr('ui.comms.044', { p1: day, p2: `${hh}:${mm}` })
}

// l10n-keep-start：下面三张表的**中文是键**（数据侧取值：立场 `CommsFactionAlignment`、内容类型 `CommsKind`、
// 跳转说明 `hint.text` 逐句独立）——渲染前一律过本文件的 `comms*Text()` 取当前语言，故不是漏译。
/** 立场片（数据侧 `CommsFactionAlignment`：官方 / 民间 / 系统） */
const COMMS_ALIGN_ID: Record<string, string> = {
  官方: 'ui.comms.045',
  民间: 'ui.comms.046',
  系统: 'ui.comms.047',
}
/** 内容类型片（数据侧 `CommsKind`：剧情 / 提示 / 委托） */
const COMMS_KIND_ID: Record<string, string> = {
  剧情: 'ui.comms.048',
  提示: 'ui.comms.049',
  委托: 'ui.comms.050',
}
/** 跳转栏那句说明（数据侧 `hint.text`，逐句独立） */
const COMMS_HINT_ID: Record<string, string> = {
  '回任务中心，点「完成」继续下一步': 'ui.comms.051',
  待办清单在任务中心: 'ui.comms.052',
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
  '出发前先去装配页检查一遍武器与防护。': 'ui.comms.063',
  '出发前在装配页把对空火力与装甲补齐。': 'ui.comms.064',
  '打之前先去装配页，把对空火力带上。': 'ui.comms.065',
  '想先看看这片星域长什么样？去星图认认路。': 'ui.comms.066',
}
// l10n-keep-end

/** 立场 / 内容类型 / 跳转说明的本地化取词（查不到原样回落） */
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

/**
 * **通讯正文的英文**（本批：「第一次」13 封任务信 = 39 行；协会侧 17 封的 58 行与部门简介 `brief` 下一批）。
 *
 * 为什么英文正文放在渲染层：正文里嵌着**玩家可见的物品/技能/舰船名与数值**，要与中文原文**逐行对齐**
 * 整段替换；data / core 继续给中文兜底不动。
 * ⚠ **物品与技能名一律用游戏既有官方英文**（2026-09-22 用临时脚本从"内容 id → `packages/data/src/l10n.ts`
 * 英文表"导出对照后逐条核对）：Peridotite / Tritanium Alloy / Silvervein Supermetal /
 * Reinforced Mining Laser MK1 / Basic AI core / Skipjack-class Frigate / Flyingfish-class Courier /
 * Sandcat-class Mining Corvette / Civilian Hull Repair Unit / Civilian Repair Kit /
 * Accelerated Learning / AI Core Operation / Reprocessing / Refining。
 * ⚠ **行数必须与中文逐行对齐**：`commsBodyText()` 在行数不符时**回落到中文**（宁可整段中文，也不许错行串位）。
 */
const COMMS_BODY_EN: Record<string, readonly string[]> = {
  'first-scan': [
    'On the star map, those silhouettes are unknown signals nobody has read yet. Send a deep-space scanning craft over and one lights up.',
    'Only once a system is lit do its routes, belts, bounties and wreck sites enter your work list. The more dangerous the system, the longer the scan.',
    'Enclosed: one Reinforced Mining Laser MK1. A belt is next on the list, so fit it now.',
  ],
  'first-mine': [
    'Belts yield raw ore, the refinery turns raw ore into materials, and most blueprints ask for materials.',
    'Selling raw ore at market price does pay, but running it through the refinery first usually pays better.',
    'Enclosed: 1,000 units of Peridotite. The refinery takes 100 units a batch, so this is ten batches.',
  ],
  'first-refine': [
    'The refinery works in batches: it burns while the feed lasts and stops on its own when it runs out. Working a furnace by hand occupies one unit.',
    'Refining adds 6% output per level and Reprocessing adds 3%; both maxed comes to 165%.',
    'Enclosed: a Kinetic Ammo blueprint. Its material is Tritanium Alloy, which raw ore refines into.',
  ],
  'first-bounty': [
    'Every system keeps standing bounties. The higher the tier, the thicker the hulls and the heavier the guns, and the better the pay and Association standing.',
    'Standing is your pass on Association channels: market thresholds and wormhole scanning both read it, so banking some early never hurts.',
    'Enclosed: one Skipjack-class Frigate. Add it to the fleet or repurpose it as a support ship.',
  ],
  'first-repair': [
    'Shields refill on their own after a fight, but armor and hull damage carries across engagements, and only repair kits and station berths can fix it.',
    'Before undocking, bring armor and hull above sixty percent; the trip gets a lot cheaper that way.',
    'Enclosed: 1 Civilian Hull Repair Unit and 20 Civilian Repair Kits. Fit the unit and the ship can patch itself.',
  ],
  'first-salvage': [
    'Wreck sites in a system can be salvaged by sending a ship over, and the wreckage you bring back refines into all kinds of materials.',
    'The recycling unit can strip old modules out of wreckage as whole items. Wrecks marked rare are worth more and can hold better gear.',
    'Enclosed: 1,000 m³ of high-sec pirate wreckage. Through the recycling unit it becomes materials and old modules.',
  ],
  'first-skill': [
    'Skills train in real time and the queue keeps them going. Accelerated Learning compresses all training time.',
    'AI Core Operation is the prerequisite for dispatching support ships and running automated lines, so training it early saves trouble.',
    'Enclosed: one Basic AI core. You will want it for the support ship assignment next.',
  ],
  'first-ai': [
    'An idle ship with an AI core can put to space on its own: mining, salvaging and standing by are all on offer, and each assignment takes one core.',
    'Combat, hauling and wormhole scanning are too involved for now, so we still fly those ourselves.',
    'Enclosed: 150 units of Tritanium Alloy and 50 of Silvervein Supermetal. The next production line can use exactly this batch.',
  ],
  'first-produce': [
    'The assembler needs three things: a blueprint, materials and time. Fit an AI core and the line runs unattended.',
    'Consumables like ammo and repair kits are the best candidates for a standing line; modules and ships are built to order.',
    'Enclosed: 10,000 credits, working capital for the line and its resupply.',
  ],
  'first-order': [
    'The market carries three kinds of orders: the standing buy and sell books, our own listings, and roaming buyers who snap up anything near the price line.',
    'The closer your ask sits to the buy line, the faster it fills. Pricing high is a bet on a roaming buyer turning up.',
    'Enclosed: 10,000 credits, plus a Sandcat-class ship blueprint. Follow it and you can build your own mining ship.',
  ],
  'first-ship': [
    'Your first home-built ship has rolled out. Shipbuilding and module building are one chain: blueprint, materials, hangar berth.',
    'A new hull lands in ship storage first. Move it into the fleet on the Ships page, then fit slots and ammo on the Fitting page before undocking.',
    'Enclosed: 10,000 credits, seed money for the next hull.',
  ],
  'first-haul': [
    'Station-to-station hauling settles per trip and the pay floats with the market. Cargo already aboard is unaffected.',
    'Low-sec legs get ambushed. Leave margin in armor and hull before departure, and do not stake everything on one run.',
    'Enclosed: one Flyingfish-class Courier. It suits the long routes better.',
  ],
  'first-wormhole': [
    'With enough Association standing the wormhole scanning array can deploy: the passages it finds start at layer 1, and the deeper you go the deadlier and the richer it gets.',
    'Inside, the work splits three ways: search, fight, withdraw. Anything you cannot carry out does not count, and whatever sits in temporary space is left behind on withdrawal.',
    'Two unexplored wormhole coordinates are marked for you. Decide when to go in from the “Scan for wormholes” tab on the star map.',
  ],
  // ── 协会侧短札（2026-09-22 第四批；长设定的几封见文件末的挂账注释）──
  'msg-welcome': [
    'Pilot, the Association comms terminal is now wired into this ship. From here on, Association departments, partners and acquaintances along the routes will message you directly.',
    'The “Comms” item in the nav flashes while anything is unread, and reading a letter clears it. We only send the important things once, and we will not chase you.',
    'The standing rule: work you can do yourself is yours to do. To see what is on offer right now, check the board in the Task Center.',
  ],
  'msg-survey-memo': [
    'You have mapped enough systems for the Survey Office to leave a memo here.',
    'Those unlit “unknown signals” on the star map usually settle two things at once: the route and the supply. Plenty of belts and wreck fields sit in systems nobody has visited.',
    'One reminder: the lower the security level, the longer an on-site scan takes, so do not park a scanner in low-sec and wait for it to finish on its own.',
  ],
  'msg-industry-shift': [
    'Credits piling up? A word from the Industry Dept: an idle berth is money burned.',
    'The refinery and the wreck recycling unit can run several units in parallel. Work one by hand and let AI cores handle the rest, one each. Materials settle per batch and a unit stops when the feed runs out, so nobody has to sit and watch it.',
    'Short on AI cores? Buy more, or train AI Core Operation to raise the limit.',
  ],
  'msg-refinery-note': [
    'People keep asking whether refining pays, so the Smelting Group will lay it out.',
    'From the same batch of raw ore, Refining adds a tenth more output per level and Reprocessing stacks another step on top. The longer ore sits in your hold, the wider that gap gets.',
    'One more note: a rare wreck goes into the recycling unit one item per run. Starting a run books that item into the unit, the card shows what is left inside, and anything unburned comes back to item storage when the unit stops.',
  ],
  'msg-salvage-crew': [
    'A few of us old salvagers drift from system to system. Wreck fields never run short of things; what runs short is people willing to stop and pick them up.',
    'Common wreckage breaks down into guaranteed raw materials, with a chance of modules and blueprint fragments. Rare wreckage from a lair is worth more, and the recycling unit can strip whole modules out of it.',
    'One reminder: wreckage is booked by volume, and a full hold sends the ship home on its own. Want to carry more? Fit a bigger hold first.',
  ],
  'msg-site-thanks': [
    'On the first shift of the Redring Outpost running on the grid, the whole Infrastructure Dept salutes you.',
    'From today, the mining ships, repair ships and supply ships on this corridor all pass through a berth you built. The Association base network has one more node, and it carries your name.',
    'If the next station is yours as well, the Association settles construction materials by tier as always, without taking an extra credit.',
  ],
  'msg-redring-outpost': [
    'The Infrastructure Dept would like a word about the “Redring Corridor” you just lit on the star map: the corridor has no usable berth, and the Association plans to place an outpost there. The site is already surveyed.',
    'The work is not contracted out whole. It comes as a materials list: deliver one tier of materials to advance one stage, and the final stage brings it onto the grid, opening berths, repairs, resupply and ship swaps together.',
    'If you are interested, keep the materials in your hold and deliver them on site. The Association settles by tier and takes no extra credit.',
  ],
  'msg-first-ship': [
    'The Industry Dept saw your assembler line hand over its first hull. From this ship on, your capacity is no longer limited to parts and ammo.',
    'The hull sits in Ship Storage on the Ships page; anything the assembler finishes lands there first and stacks by type. Click “Move into fleet” on that entry and it joins the hangar, ready for a pilot swap or an AI core assignment.',
    'Selling happens there too: ship storage sells directly, filling a standing buy order on the spot or listing the hull automatically if nobody is buying, and a listing can be pulled back to storage at any time.',
    'One storage rule: only ships with modules removed, structure and armor intact and an empty hold are accepted; a hull you are flying or one on an AI task has to be freed up first.',
  ],
}

// l10n-keep-start：下面这张表的**中文是键**（数据侧 `brief` 悬停说明原文，逐条独立）
/**
 * **部门/势力简介的英文**（本批：13 条 —— 悬停说明 `fromBrief`）。
 * 键 = 数据侧中文简介原文（逐条独立），与名称映射同一套"中文即键"口径。
 */
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

/** 简介（悬停说明）：英文；查不到原样返回中文 */
export function commsBriefText(brief: string): string {
  if (!isEn()) return brief
  return COMMS_BRIEF_EN[brief] ?? brief
}
// l10n-keep-end

/** 正文段落（英文；查不到或行数不符 ⇒ 原样返回中文，绝不错行） */
export function commsBodyText(id: string, paragraphs: readonly string[]): readonly string[] {
  if (!isEn()) return paragraphs
  const en = COMMS_BODY_EN[id]
  return en !== undefined && en.length === paragraphs.length ? en : paragraphs
}
