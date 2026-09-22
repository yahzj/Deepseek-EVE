/**
 * **「第一次」任务系列的 13 封通讯**（船长 2026-09-17 教程重做批 · 阶段②收尾）。
 *
 * 船长原话：「**每个'第一次'的任务完成后就会有一则通讯告诉玩家一些相关的情报。**
 * 之前生产舰船的通讯可以合并到这里面。」
 *
 * 口径（沿用 `messages.ts` 的既有纪律）：
 * - 送达条件 = **该「第一次」任务已完成**（新触发 `{ kind: 'firstTask', taskId }`，由 `core/firstTasks`
 *   写入的 `importantTasks[id].done` 判定）⇒ **不再单独挂"造好第一条船"的触发器**（那封并进 `first-ship`）。
 *   ⚠ **2026-09-21 船长令**：任务改成"玩家回任务中心点「完成」才推进" ⇒ 这里的 `done` 落在那**一次点击**上，
 *   通讯自然也在点击之后送达（同一拍性未变）。⇒ 这一点击**同时**发下一条的**起手道具** ⇒ 第三行「随信附…」
 *   写的就是"这一下真正到手的东西"（本条完成奖励 and/or 下一条的起手道具，逐封核对过）。
 * - 发件方 = **舰载信息库 · 检索重启**（船自己的系统，与开场简报同一发件人）。
 * - 正文只给"情报 + 一句建议"，不写开发用语；**玩家就是那条船**（不出现「你的舰船」这类分离说法）。
 * - **13 封的「前往」一律指向「任务中心」**（**2026-09-21 船长令**：「**任务完成后出现的通讯的跳转改为
 *   返回任务中心**」）——读完情报正好顺手点「完成」继续下一步；文案各行独立（同一句话，便于逐条改）。
 *
 * ---
 *
 * **2026-09-22 船长令：正文按船长的任务文本风格重写**（船长原话：「**情报信的文案你没根据我的第一次任务的
 * 文本风格重新写吗？**」）。此前只对齐了顺序与「随信附」几行，**正文 39 行仍是旧档案腔** ⇒ 本批整篇重写。
 *
 * **重写口径（照 `core/src/firstTasks.ts` 里船长那 13 条 detail 的风格）**：
 * 1. **人称**：用「我们 / 你」说话（船长 detail 就是「我们需要重新收集…」「这样就能驱动 AI 副手帮我们
 *    完成工作」「返回星港进行修理吧」这种共事口吻），**不用**第三人称、不写"你的舰船"这类分离说法；
 * 2. **句式**：完整句串联，**少用破折号**（船长几乎不用 ⇒ 每封最多留一处），改用「，」「。」或「：」列举；
 * 3. **语气**：给情报之外**带一句建议或提醒**（船长 detail 的固定动作：「初期建议…」「绝大多数情况下…更划算」
 *    「请做好充足的准备再前往」）；
 * 4. **术语**：页面 / 系统 / 技能名一律加「」（「舰船」页、「AI 核心操作学」、「精炼学」），舰船写
 *    「通名（型号）」（采矿艇（沙猫级）），物品用**内容表里的正式名**（强化采集器 MK1 · 钛钢合金 · 银纹超金属）；
 * 5. **长度**：每行 ≤ 60 字左右（与 detail 同量级），三行分工 = ① 情报 / 机制 ② 建议或提醒 ③ 随信附了什么、
 *    拿去干什么；
 * 6. **主题行保留**「档案补全 · ××」的归档格式（那是发件人"舰载信息库"的落款习惯，与正文口吻不冲突）。
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
      '星图上那些只剩剪影的位置，就是还没解读的未知信号；派一艘深空扫描艇过去就能点亮它。',
      '点亮之后，那处星系的航线、矿带、悬赏与残骸情报才会进入可作业清单；越危险的星系，扫得越久。',
      '随信附一台强化采集器 MK1，下一步要下矿带，正好装上它。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-scan' },
    hint: { text: '回任务中心，点「完成」继续下一步', page: 'task' },
  },
  {
    id: 'first-mine',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 采矿与精炼',
    body: [
      '矿带产出原矿，精炼炉把原矿炼成原材料，而绝大多数蓝图要的正是原材料。',
      '原矿按市价直接卖也能赚钱，不过送进精炼炉再卖通常更划算。',
      '随信附 1,000 单位橄榄岩，精炼炉每批吃 100 单位，这批料够开十炉。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-mine' },
    hint: { text: '回任务中心，点「完成」继续下一步', page: 'task' },
  },
  {
    id: 'first-refine',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 精炼炉',
    body: [
      '精炼炉按批运转：原料足够就一直烧，料尽自动停炉；主控亲自看炉只占一台。',
      '「精炼学」每级 +6% 产出，「高级回收处理」每级 +3%，两条练满合计 165%。',
      '随信附一份「动能弹药生产线」蓝图，它的材料是钛钢合金，正好由原矿炼出来。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-refine' },
    hint: { text: '回任务中心，点「完成」继续下一步', page: 'task' },
  },
  {
    id: 'first-bounty',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 悬赏讨伐',
    body: [
      '各个星系都有常驻悬赏，档位越高敌舰越厚、火力越重，报酬与协会声望也越高。',
      '声望是协会渠道的通行证，市场门槛与虫洞扫描都看它，前期多攒一点不吃亏。',
      '随信附一艘鲣鱼级护卫舰，编入舰队或者改作副船都行。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-bounty' },
    hint: { text: '回任务中心，点「完成」继续下一步', page: 'task' },
  },
  {
    id: 'first-repair',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 损伤与维修',
    body: [
      '战斗结束后护盾会自行回满，装甲与结构的损伤则会跨场保留，只能靠修理组件与港内工位处理。',
      '出航前把装甲与结构修到六成以上，路上能少吃很多亏。',
      '随信附民用船体维修装置 ×1 与民用修理组件 ×20，装上装置就能自己修船。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-repair' },
    hint: { text: '回任务中心，点「完成」继续下一步', page: 'task' },
  },
  {
    id: 'first-salvage',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 残骸打捞',
    body: [
      '星系里的残骸点可以派船打捞，捞回来的残骸送进精炼炉就能回收出各种材料。',
      '回收炉能把残骸里的旧件重新解体成整件装备；带稀有标记的残骸更值钱，也有机会出更好的装备。',
      '随信附 1,000 m³ 高安海盗残骸，送进回收炉就是材料与旧件。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-salvage' },
    hint: { text: '回任务中心，点「完成」继续下一步', page: 'task' },
  },
  {
    id: 'first-skill',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 技能训练',
    body: [
      '技能按现实时间训练，队列排好就能一直练；「高效学习法」能压缩全部训练时间。',
      '「AI 核心操作学」是调度副船与自动产线的前置，越早练越省事。',
      '随信附一枚基础 AI 核心，下一步派副船正好用得上。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-skill' },
    hint: { text: '回任务中心，点「完成」继续下一步', page: 'task' },
  },
  {
    id: 'first-ai',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 副船调度',
    body: [
      '闲置舰船配上一枚 AI 核心就能自己出海，采矿、打捞、驻留待命都能接，每项指派占一枚核心。',
      '战斗、运输与虫洞扫描太复杂，这些暂时还得我们自己跑。',
      '随信附 150 单位钛钢合金与 50 单位银纹超金属，下一步开线正好用这批料。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-ai' },
    hint: { text: '回任务中心，点「完成」继续下一步', page: 'task' },
  },
  {
    id: 'first-produce',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 组装机',
    body: [
      '组装机要三样东西：蓝图、材料、时间；装上 AI 核心就能无人值守开线。',
      '弹药与修理组件这类消耗品最适合常驻开线，装备与舰船则按需排产。',
      '随信附 10,000 信用点，产线的周转金与补料钱。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-produce' },
    hint: { text: '回任务中心，点「完成」继续下一步', page: 'task' },
  },
  {
    id: 'first-order',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 市场交易',
    body: [
      '市场上有三路单子：协会挂出的常驻买卖单、我们自己挂的单、还有贴着价线的巡游抢单。',
      '挂价越贴近收购价线成交越快，挂得高就是在赌巡游采购的运气。',
      '随信附 10,000 信用点，另附一张沙猫级舰船蓝图，照着它就能自造矿船。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-order' },
    hint: { text: '回任务中心，点「完成」继续下一步', page: 'task' },
  },
  {
    id: 'first-ship',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 自造船下线',
    body: [
      '第一艘自造船已经下线；造船与造装备是同一条链路：蓝图、材料、机库工位。',
      '新船先入舰船仓库，在「舰船」页转入舰队，再到「装配」页配好槽位与弹档就能出港。',
      '随信附 10,000 信用点，下一艘船的启动资金。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-ship' },
    hint: { text: '回任务中心，点「完成」继续下一步', page: 'task' },
  },
  {
    id: 'first-haul',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 长途运输',
    body: [
      '站间运输按趟结算，报酬随行情浮动，船上原本的货不受影响。',
      '低安航段会遇袭，出发前把装甲与结构留足余量，也别把身家押在一趟上。',
      '随信附一艘飞鱼级快运舰，跑长途用它更合适。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-haul' },
    hint: { text: '回任务中心，点「完成」继续下一步', page: 'task' },
  },
  {
    id: 'first-wormhole',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: '档案补全 · 虫洞',
    body: [
      '协会声望够了，虫洞扫描阵列可以展开：扫出的通道从第 1 层开始，越深越险，也越肥。',
      '洞内是搜、打、撤三条线，带不回来的等于没有；撤离时临时空间里的东西会全部留下。',
      '随信标记 2 处未探索虫洞坐标，到星图页的「扫描虫洞」标签决定何时进去。',
    ],
    trigger: { kind: 'firstTask', taskId: 'first-wormhole' },
    hint: { text: '回任务中心，点「完成」继续下一步', page: 'task' },
  },
]
