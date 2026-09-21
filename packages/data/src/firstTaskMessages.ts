/**
 * **「第一次」任务系列的 13 封通讯**（船长 2026-09-17 教程重做批 · 阶段②收尾）。
 *
 * 船长原话：「**每个'第一次'的任务完成后就会有一则通讯告诉玩家一些相关的情报。**
 * 之前生产舰船的通讯可以合并到这里面。」
 *
 * 口径（沿用 `messages.ts` 的既有纪律）：
 * - 送达条件 = **该「第一次」任务已完成**（新触发 `{ kind: 'firstTask', taskId }`，由 `core/firstTasks`
 *   写入的 `importantTasks[id].done` 判定）⇒ **不再单独挂"造好第一条船"的触发器**（那封并进 `first-ship`）。
 * - 发件方 = **舰载信息库 · 检索重启**（船自己的系统，与开场简报同一发件人）。
 * - 正文只给"情报 + 一句提示"，不写开发用语；**玩家就是那条船**（不出现「你的舰船」这类分离说法）。
 */
import type { CommsMessageDef } from '@whale/core'

export const FIRST_TASK_MESSAGES: readonly CommsMessageDef[] = [
  {
    id: 'first-scan',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 星图扫描',
    body: [
      '星图上那些只剩剪影的位置，是尚未解读的未知信号；派深空扫描艇跑一趟就能点亮它。',
      '点亮之后，那处星系的矿带、航道与驻留势力才会进入可作业清单。',
      '随信附一台采集器 MK1——装上它，采掘效率更高。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-scan' },
    hint: { text: '去星图看看点亮了哪些地方', page: 'map' },
  },
  {
    id: 'first-mine',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 采矿与精炼',
    body: [
      '矿带产出原矿；精炼炉把原矿炼成原材料，原材料才是绝大多数蓝图的用料。',
      '随信附一台打捞器 MK1——装上即可用于打捞作业。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-mine' },
    hint: { text: '去工业页看看精炼炉与组装机', page: 'industry' },
  },
  {
    id: 'first-salvage',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 残骸打捞',
    body: [
      '残骸堆拆解出的保底原材料可直接入炉；带稀有标记的残骸价值更高。',
      '回收炉能把残骸里的旧件重新解体成整件装备，值得留一批专门拆。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-salvage' },
    hint: { text: '在星图里挑一处残骸地点', page: 'map' },
  },
  {
    id: 'first-repair',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 损伤与维修',
    body: [
      '护盾脱战后自行回满；装甲与结构的损伤会跨场保留，需要修理组件或港内工位处理。',
      '航行前把装甲与结构修到六成以上，能少吃很多亏。',
      '随信附民用修理组件 ×20——野外应急够用一阵。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-repair' },
    hint: { text: '舰船页可以修理与补给', page: 'ship' },
  },
  {
    id: 'first-bounty',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 悬赏讨伐',
    body: [
      '悬赏按威胁分档：威胁越高，敌舰越厚、火力越重，报酬与声望也越高。',
      '声望是协会渠道的通行证——市场声望门槛、虫洞扫描解锁都看它。',
      '随信附一艘鲣鱼级护卫舰——编入舰队或改作副船都行。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-bounty' },
    hint: { text: '星图里的常驻悬赏可以接着打', page: 'map' },
  },
  {
    id: 'first-refine',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 精炼炉',
    body: [
      '精炼炉按批运转：料尽自动停炉，装满则按批续烧，主控亲自看炉只占一台。',
      '「精炼学」每级 +6% 产出、「高级回收处理」每级 +3%，两条练满可到 165%。',
      '随信附一份「动能弹药生产线」蓝图——材料是钛钢合金，正好由原矿炼出。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-refine' },
    hint: { text: '工业页的精炼炉可以多开几台', page: 'industry' },
  },
  {
    id: 'first-produce',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 组装机',
    body: [
      '组装机要三样：一张蓝图、够用的材料、以及时间——装上 AI 核心就能无人值守开线。',
      '弹药与修理组件这类消耗品最适合常驻开线，装备与舰船则按需排产。',
      '随信附一张沙猫级舰船蓝图——照着它就能再造几艘矿船。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-produce' },
    hint: { text: '工业页可给产线装 AI 核心', page: 'industry' },
  },
  {
    id: 'first-order',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 市场挂单',
    body: [
      '市场吃三路单子：协会挂出的常驻买卖单、自留的挂单、以及贴着价线的巡游抢单。',
      '挂价越贴近收购价线，成交越快；挂得高就是在赌巡游采购的运气。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-order' },
    hint: { text: '市场页可以看行情与我的挂单', page: 'market' },
  },
  {
    id: 'first-ship',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 自造船下线',
    body: [
      '第一艘自造船已经下线：舰船蓝图 + 材料 + 机库工位，和造装备是同一条链路。',
      '新船入机库待命；装配页配好槽位与弹档，就能编入出港编队。',
      '随信附一台民用船体维修装置——结构层能自己回一点。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-ship' },
    hint: { text: '去舰船页看看新船', page: 'ship' },
  },
  {
    id: 'first-skill',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 技能训练',
    body: [
      '技能按现实时长训练，队列排好就能一直练；「高效学习法」能压缩全部训练时间。',
      '「AI 核心操作学」是调度副船与自动产线的前置，越早练越省事。',
      '随信附一枚基础 AI 核心——装到闲置舰船上，它就能自己出海。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-skill' },
    hint: { text: '技能页可以排队训练', page: 'skills' },
  },
  {
    id: 'first-ai',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 副船调度',
    body: [
      '闲置舰船配上 AI 核心就能自己出海：采矿、打捞、驻留待命都能接。',
      '每项指派占一枚核心；核心等级越高，作业效率越高。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-ai' },
    hint: { text: '舰船页可给副船派活', page: 'ship' },
  },
  {
    id: 'first-haul',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 长途运输',
    body: [
      '站间运输按趟结算，报酬随行情浮动；船上原本的货不受影响。',
      '低安航段的运输会遇袭，出发前把装甲与结构留足余量。',
      '随信附一艘飞鱼级快运舰——跑长途用它更合适。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-haul' },
    hint: { text: '星图的长途运输页可以接下一趟', page: 'map' },
  },
  {
    id: 'first-wormhole',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 虫洞',
    body: [
      '协会声望已够，虫洞扫描阵列可以展开：扫出的通道从第 1 层开始，越深越险、也越肥。',
      '洞内是搜、打、撤三条线——带不回来的，等于没有。',
      '随信标记 2 处虫洞坐标（未探索）——到「扫描虫洞」页决定何时进入。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-wormhole' },
    hint: { text: '去星图的「扫描虫洞」看看', page: 'map' },
  },
]
