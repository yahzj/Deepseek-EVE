import type { SkillDef } from '@whale/core'

export const TRADE_EXPLORATION_LOGISTICS_SKILLS: readonly SkillDef[] = [

  // ───────── 贸易（V9+：市场税率减免） ─────────
  {
    id: 'accounting',
    name: '会计学',
    group: '贸易',
    rank: 3,
    branch: 'b-market',
    description: '贸易税减免：卖出成交的贸易税每级降低 ⟦8%⟧（与贸易谈判学乘算叠加）。',
  },
  {
    id: 'trade-negotiation',
    name: '贸易谈判学',
    group: '贸易',
    rank: 4,
    branch: 'b-market',
    prereq: ['accounting'],
    description: '协会渠道谈判：贸易税每级再降低 ⟦8%⟧（与会计学乘算叠加）。',
  },
  {
    id: 'bounty-hunting',
    name: '赏金猎手学',
    group: '贸易',
    rank: 4,
    branch: 'b-bounty',
    description: '赏金评估与协会渠道：完成悬赏的奖金每级 +⟦8%⟧（满级 +⟦40%⟧，在随机浮动之上乘算）。',
  },
  {
    id: 'marketing',
    name: '营销学',
    group: '贸易',
    rank: 4,
    branch: 'b-market',
    description: '货物包装与渠道推销：市场卖出结算价每级 +⟦1.2%⟧（满级 +⟦6%⟧，与协会声望加成乘算）。',
  },
  {
    id: 'source-sweeping',
    name: '现货抢购学',
    group: '贸易',
    rank: 4,
    branch: 'b-market',
    description: '供应链情报网络：市场稀有/限定订单的刷新频率每级 ×⟦1.1⟧（满级约 ×⟦1.5⟧）。',
  },
  {
    id: 'secondhand-market',
    name: '二手市场学',
    group: '贸易',
    rank: 2,
    branch: 'b-market',
    description: '旧货市场渠道：市场稀有商品的供给单价格每级 −⟦2%⟧（满级 −⟦10%⟧）。',
  },

  // ───────── 探索（2026-09-04 新组） ─────────
  {
    id: 'deep-space-probing',
    name: '深空探测学',
    group: '探索',
    rank: 3,
    branch: 'b-deep-space',
    description: '星系搜索周期每级缩短 ⟦6%⟧；与高级深空探测学加算叠加。',
  },
  {
    id: 'advanced-deep-space-probing',
    name: '高级深空探测学',
    group: '探索',
    rank: 4,
    branch: 'b-deep-space',
    prereq: ['deep-space-probing'],
    prereqLevel: { 'deep-space-probing': 1 },
    description: '星系搜索周期每级再缩短 ⟦4%⟧；与深空探测学加算叠加。',
  },
  {
    id: 'stellar-archive',
    name: '星系档案学',
    group: '探索',
    rank: 4,
    branch: 'b-deep-space',
    description: '候选星系保存名额每级增加 ⟦2⟧ 个。',
  },
  {
    id: 'signal-analysis',
    name: '信号分析学',
    group: '探索',
    rank: 3, // 2026-09-14 船长：扫描虫洞要 12 小时，故三项扫描技能的难度重排（分析 3 / 测绘 4 / 过滤 5）
    branch: 'b-scan',
    // ⟪文案调整2026-10-06⟫ 旧扫描玩法改名信号空间。
    description: '未知信号解读与锁定：就地扫描与信号空间扫描的窗口每级缩短 ⟦8%⟧（满级 −⟦40%⟧）。',
  },
  {
    id: 'cartography',
    name: '星图测绘学',
    group: '探索',
    rank: 4, // 2026-09-14 船长（同上）
    branch: 'b-scan',
    prereq: ['signal-analysis'],
    // ⟪文案调整2026-10-06⟫ 旧扫描玩法改名信号空间。
    description: '航线标定与跳跃窗优化：就地扫描与信号空间扫描的窗口每级缩短 ⟦6%⟧（满级 −⟦30%⟧；与信号分析学、信号过滤学乘算叠加）。',
  },
  {
    id: 'signal-filtering',
    name: '信号过滤学',
    group: '探索',
    rank: 5, // 2026-09-14 船长（同上）
    branch: 'b-scan',
    prereq: ['cartography'],
    // ⟪文案调整2026-10-06⟫ 旧扫描玩法改名信号空间。
    description: '干扰抑制与信号提纯：就地扫描与信号空间扫描的窗口每级再缩短 ⟦6%⟧（与信号分析学乘算叠加）。',
  },
  {
    // 2026-09-14 船长三条改判（同日追加）：①「星际奇遇学，对缩减虫洞的时间也有效」⇒ 虫洞扫描周期每级 −4%、
    // 满级 −20%（虫洞专属第四项，接线 = `core/wormholeScan.ts happeningsScanFactor`；星图扫描不吃这一项）
    // ②「并移动到探索内」（原属 **贸易** 组）③「rank提升到5」（难度 3→5，单级时长倍数 ×7.98、练满约 89.7 小时）
    // **2026-09-17 船长改判**：「将一些只有满级后才有效果的技能，拆分成每个等级效果」⇒ ① 这条 09-14 曾按
    // 「满级阶跃」落（Lv1~4 对虫洞零效果），本日改回**线性每级 −4%**（满级仍恰 −20%）——旧阶跃口径作废
    id: 'galactic-happenings',
    name: '星际奇遇学',
    group: '探索',
    rank: 5,
    branch: 'b-survive',
    // ⟪文案调整2026-10-06⟫ 只改旧扫描来源，随机事件效果不变。
    description: '奇闻轶事的嗅觉：在线随机事件的来访间隔每级 −⟦8%⟧（满级间隔约为原来的六成）；出击出发时遭遇随机事件的机会每级 ×⟦1.15⟧；信号空间扫描窗口每级缩短 ⟦4%⟧（满级 −⟦20%⟧）。',
  },
  {
    // 2026-09-14 船长四条改判（同日追加）：①「事件分红学，改名事件玄学」②「Rank提高到5」
    // ③「效果添加：降低虫洞内出现空白地点的几率，满级为20%」（四问四答：**相对削减**、分红部分不动、
    //   移入**探索**组、不做特殊重分配）④落到「探索」组内（原属 **贸易** 组）。
    // ⚠ **id 保持 `event-dividend` 不改**：老档 `skills.trained` / 训练队列都按 id 记账，改 id 会丢等级。
    // 接线：分红 = `core/events.ts fireFlavor`（+15%/级，本批一字未动）；
    //       空地点 = `core/wormhole.ts blankShareFactorOf` → `wormholeGrid.ts wormholeEmptyShareFor(depth, 系数)`。
    id: 'event-dividend',
    name: '事件玄学',
    group: '探索',
    rank: 5,
    branch: 'b-survive',
    prereq: ['galactic-happenings'],
    // ⟪文案调整2026-10-06⟫ 旧空白地点来源改名，分红与削减比例不变。
    description: '把每一次巧合都变成收入：随机事件的现金奖励每级 +⟦15%⟧；运气也延伸进信号空间——空间内出现空白地点的几率每级相对削减 ⟦4%⟧（满级 −⟦20%⟧）。',
  },
  {
    // 2026-09-14 船长：「添加 rank4 技能，星图记录学，满级允许玩家虫洞的保存上限+10。」
    // **2026-09-16 船长改判**：「星图记录学，效果错误，应该为每级+2，满级+10。」⇒ 由**阶跃**改为
    // **每级线性 +2**（Lv1 +2 … Lv5 +10，满级总量不变）；接线 = `core/wormholeScan.ts` 的
    // `wormholeStockMaxOf`（基础 5 处 ⇒ 上限 7/9/11/13/15）。
    id: 'chart-archive',
    name: '星图记录学',
    group: '探索',
    rank: 4,
    branch: 'b-scan',
    // ⟪文案调整2026-10-06⟫ 旧坐标库存改名，上限不变。
    description: '深空航图与信号空间档案的整理学：星图上可留存的信号空间坐标每级 +⟦2⟧ 处（满级 +⟦10⟧ 处，由 5 处提到 15 处）。',
  },
  {
    id: 'salvage-diving',
    name: '漂流物打捞学',
    group: '探索',
    rank: 3,
    branch: 'b-survive',
    description: '残骸打捞与战利品收集：远征缴获的物资数量与残骸打捞量每级 +⟦12%⟧（主控与 AI 同享）。',
  },
  {
    id: 'seizure-appraisal',
    name: '缴获评估学',
    group: '探索',
    rank: 2,
    branch: 'b-survive',
    description: '战利品估值与销赃渠道：低安遭遇击退/大捷的缴获信用点每级 +⟦10%⟧。',
  },
  {
    id: 'lowsec-survival',
    name: '低安生存学',
    group: '探索',
    rank: 3,
    branch: 'b-survive',
    description: '危险星域的保命之道：低安被抢的货物损失上限每级 −⟦12%⟧（满级 −⟦60%⟧）。',
  },

  // ───────── 物流（2026-09-04 技能扩军新组；含从舰船组归并的运力技能） ─────────
  {
    id: 'deep-space-logistics',
    name: '深空物流学',
    group: '物流',
    rank: 3,
    branch: 'b-logistics',
    prereq: ['hold-management'],
    description: '深空物流与仓位规划：全舰队货仓容量每级 +⟦4%⟧（满级 +⟦20%⟧；与货舱扩展件/货舱管理学乘算）。',
  },
  {
    id: 'hauler-ops',
    name: '货舰操作',
    group: '物流',
    rank: 2,
    branch: 'b-logistics',
    // ⟪文案调整 2026-09-24⟫ 同批：原「航运舰族专精驾驶：驾驶航运族舰船时…」⇒「航运舰」
    description: '航运舰专精驾驶：驾驶航运舰时货仓容量每级 +⟦5%⟧。',
  },
  {
    id: 'compression',
    name: '压缩技术',
    group: '物流',
    rank: 3,
    branch: 'b-logistics',
    description: '原材料压缩封装：原矿/气体/冰矿的货仓占用体积每级 −⟦6%⟧（满级 −⟦30%⟧）。',
  },
  {
    id: 'hold-management',
    name: '货舱管理学',
    group: '物流',
    rank: 1,
    branch: 'b-logistics',
    description: '舱位规划与收纳：全舰队货仓容量每级再 +⟦3%⟧（与深空物流学乘算叠加）。',
  },
]
