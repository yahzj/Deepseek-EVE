/**
 * 英文界面词典（**以中文源串为 key**）· P1 骨架 · 2026-09-19。
 *
 * 口径：术语与专名一律以 `docs/glossary-en.md` 为准（装配 = Fitting · 装备 = Modules ·
 * 信用点 = credits · 拆解 = Unbox · 谜质 = Enigma）。
 *
 * 覆盖范围：本批 = **导航 + 设置面板 + 启动文案**（把「可切语言」这条链子验通）；
 * 其余界面字符串由 **P3「界面 chrome 批」** 逐页包 `t(...)` 并在此加词条。
 * ⚠ **只许登记源码里已经存在的中文串**——`npm run l10n:check` 会把「源码里找不到的 key」判为**死 key**（报红），
 * 这条正是为了防「中文原文改了、词典没跟上」。
 *
 * 校验：`npm run l10n:check` —— ① 死 key ② 中英占位符集合必须一致 ③ 英文值禁残留中日韩字符 ④ 值非空且无首尾空格。
 */
export const EN: Record<string, string> = {
  // ── 启动（main.tsx）
  '正在启动星门引擎……': 'Starting the Stargate engine…',
  '启动失败：{err}（详见开发者控制台）': 'Startup failed: {err} (see developer console)',

  // ── 导航（App.tsx · NAV_ITEMS）
  '点击 出港': 'Undock',
  '舰船': 'Ships',
  '装配': 'Fitting',
  '物品': 'Items',
  '市场': 'Market',
  '工业': 'Industry',
  '技能': 'Skills',
  '任务中心': 'Task Center',
  '通讯': 'Comms',

  // ── 设置面板（App.tsx · SettingsPanel；语言开关就在这一屏）
  '设置': 'Settings',
  '界面缩放、字体大小与宇宙背景，即时生效 · 缩放与字号自动记忆':
    'UI zoom, font size and space background — applied instantly; zoom and font size are remembered',
  '界面缩放': 'UI Zoom',
  '整窗缩放：面板几何与文字一起放大/缩小（80%~125%）': 'Whole-window zoom: panel geometry and text scale together (80%–125%)',
  '字体大小': 'Font Size',
  '独立于界面缩放，只调整文字（85%~125%）': 'Independent of UI zoom — text only (85%–125%)',
  '宇宙背景': 'Space Background',
  '未启用': 'Disabled',
  '换一张': 'Reroll',
  '换成另一张随机底图（立即生效）': 'Switch to another random backdrop (applies instantly)',
  '{n} 张无缝星图铺在界面最底层，每次启动随机一张；这里换的这张本场有效（下次启动仍随机）':
    '{n} seamless star charts tile the bottom layer; one is picked at random each launch. A reroll here lasts this session only (next launch is random again).',
  '背景图缺失：当前用的是默认深色底': 'Backdrop missing: using the default dark background',
  '可随时从顶栏「设置」调回': 'Reopen anytime from Settings in the top bar',
  '恢复默认': 'Reset Defaults',
  '完成': 'Done',
  '语言': 'Language',
  '界面语言（即时生效；默认跟随系统）': 'Interface language (applies instantly; defaults to your system language)',

  // ── 常用按钮 / 表头 / 名词（源码里已有这些串；P3 逐页包 t(...) 接线）
  '取消': 'Cancel',
  '全部': 'All',
  '名称': 'Name',
  '数量': 'Qty',
  '等级': 'Level',
  '停止': 'Stop',
  '说明': 'Description',
  '分类': 'Category',
  '装备': 'Modules',
  '装备库': 'Module Storage',
  '蓝图': 'Blueprint',
  '无人机': 'Drone',
  '训练': 'Train',
  '无': 'None',
  '信用点': 'credits',
  '星图': 'Star Map',
  '手册': 'Handbook',

  // ── 蓝图书架（2026-09-19 报障修复：筛选项按现有卡片现算，空态文案随之改写）
  '这一类书架里没有书，也没有可逆向的碎片。': 'No books or redeemable fragments in this category on the shelf.',

  // ── 工业页搜索栏（2026-09-19 船长：精炼炉与组装机各加一个搜索栏）
  '搜索资源、残骸或产出物…': 'Search resources, wrecks or outputs…',
  '搜索蓝图、产物或材料…': 'Search blueprints, products or materials…',

  // ── 任务中心排序（2026-09-19 船长：加「默认排序（从低到高）」与「价值排序（从高到低）」）
  '默认排序（从低到高）': 'Default (low to high)',
  '价值排序（从高到低）': 'Value (high to low)',
  '默认排序 = 按任务级别从低到高（L1→L5）；价值排序 = 按奖励从高到低':
    'Default = by task level, low to high (L1→L5); Value = by reward, high to low',

  // ── 成就徽章（2026-09-20 船长「继续之前的成就系统」· 第一批 = 徽章框架，已完成）
  //    ⚠ 徽章**名称与说明**来自内容表 `data/src/achievements.ts`，其英文覆盖层尚未接 ⇒
  //    那 63 条名称/说明**另行排期**（内容层覆盖层的做法见 `packages/data/src/l10n.ts`）；
  //    这里只登记**界面串**（本就该跟界面批一起做）。
  //    ⚠ 未完成的是**第二批（里程碑成就内容）**——它的文案按约定 §十一之二不排本地化队列，
  //    记号落在 milestone 的落点（`data/src/achievements.ts` 头注释 ＋ `roadmap` 清单行）。
  '成就徽章': 'Achievement Badges',
  '已获得 {n}/{total} 枚': '{n}/{total} earned',
  '「第一次」任务': 'First-Time Tasks',
  '次数链进度': 'Progression Chains',
  '当前 {lv} 级': 'Level {lv}',
  '已获得': 'Earned',
  '尚未获得': 'Not yet earned',
}
