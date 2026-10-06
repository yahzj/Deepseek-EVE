/**
 * **架构契约体检 · 取数与派生**（`npm run arch:guard` · 2026-09-27 建 · 三号 verify）
 *
 * 起因（船长原话照抄）：「**现在的开发流程挺混乱的，各种代码都是地方单独调用，我们能否商量下，进行开发流程规范？**」
 * 参照物 = `pattern-enforcement`（jagreehal/jagreehal-claude-skills）的核心口径
 * **「Documentation is a ritual. Rules are enforcement.」**——没有能让构建失败的规则，模式就只是建议。
 * 本工具照抄它的**思路**（封跨层直读 ＋ 分层方向），但用**本仓风格**实现：纯读源码文本、零新依赖、报红 exit 1
 * （与 `ui:attr-check` / `ui:subs-check` / `content:check` 同构）。**本仓不依赖 ESLint，不引入 ESLint。**
 *
 * ⚠ **与既有护栏的分工（防两套口径打架）**：`ui-subs-check.ts` 的 Check 2「本地化直读契约」已经管了
 * **"中文标签表/函数"**（`RACK_LABELS` / `SLOT_LABELS` / `shipRoleLabel` …，理由＝英文界面会漏中文）。
 * ⇒ 本工具**只管"游戏数据表"**（`SHIPS` / `ITEMS` / `MODULES` / `BLUEPRINTS` / `SKILLS` / `BELTS` …），
 * **不重复管标签类符号**；标签类请回看 `ui-subs-check`。
 *
 * 四项检查：
 *   F1 **分层边界**：渲染层不许直接读"游戏数据表"，只许清单里的文件读（`ALLOW_TABLE_READERS`，逐条写理由）。
 *      数据层本该只有一个产地 = 渲染层的 `game/engine.ts`（它建 `ctx`）；其余页面/面板要什么字段，
 *      应当**从 `ctx` 取**（必要时提出取数需求，由单点提供）。
 *   F2 **单点覆盖**：渲染层本地定义的函数名，撞上 `SINGLE_SOURCE`（`docs/single-source.md` 的机器可读副本）
 *      里已登记的单点导出名 ⇒ 报红（＝"同一件事又写了一份"）。
 *      ⚠ **已知局限（如实登记，不装成能全查）**：**"异名同义"的重复机器判不出来**
 *      （实测：26 个局部 helper 名撞 1565 个导出名，命中 0）——那部分进
 *      `docs/review/arch-guard-baseline-<日期>.md` 交船长裁，本工具不假装全知。
 *   F3 **索引自检**：索引里写的"落点文件"必须真实存在、`SINGLE_SOURCE` 里的"单点导出"必须在源码里真的导出
 *      ⇒ 悬空即红（防索引变成废纸）。
 *   F4 **取数口契约**：一级页/面板不许自己 new 引擎旁路取数（`buildSimContext(...)`）——那是 `engine.ts` 的活。
 *   F5 **跳转目标契约**：活动栏跳转表指向的页/页签必须真实存在。
 *   F6 **日期格式化本地化**（**2026-09-29 加**）：渲染层不许写死 `toLocaleDateString('zh-CN')` 这类
 *      **把语言焊死**的调用 —— 英文界面下它的输出顺序仍是中文的。走 `i18n/fmt.ts` 的
 *      `fmtDate` / `fmtDateTime`（内部取 `localeTag()`）。
 *      ⚠ **只管日期/时间**：`toLocaleString('zh-CN')` 用于**数字千分位**时在 zh/en 下逐位同值
 *      （`i18n/fmt.ts` 头注已写明）⇒ 那 ~180 处不在本检查范围内（避免大批无收益改动）。
 *   F7 **落盘心跳单点**（**2026-09-29 加**）：自动存盘的间隔**只许有一个出处**
 *      （`game/engine.ts` 的 `SAVE_INTERVAL_MS`）。起因 = 船长当日令「**存档间隔不是太短了，
 *      延迟到1分钟**」：这个数一旦散落，就会出现"心跳 60 秒、别处还写 15 秒"的双口径，
 *      而且**改小了没人拦**（存档写得越频越不易察觉，只在低端机上表现为卡顿）。
 *      ⇒ 报红两种情形：① `SAVE_INTERVAL_MS` 不是 60_000（改回更短的值要显式改本检查并写理由）；
 *      ② 落盘 `setInterval` 里写了**裸数字**（绕过常量的第二出处）。
 *   F8 **主控活动切换契约**（**2026-10-02 加** · stage 2 的契约护栏）：起因 = 船长报障
 *      「**实验室的主控活动并不占用主控，是BUG**」＋ 裁定乙案。报红三类：
 *      ① core 的 `start*` 主控入口漏调 `applyActivityGate`/`gateMainActivity*`（接力入口按委托链算过）；
 *      ② 登记在册的入口改名/删除（逼一次人工复核）；
 *      ③ `MainActivityKind` 每个档位必须"能被 `mainActivityOf` 探测到 · 在两张档位表里恰好占一档 ·
 *      可中断的必须有 `haltActivityForSwitch` 分支"（实验室那次就是这三处对不上）。
 *   F9 **相对导入环自检**（**2026-10-02 加** · 代码审查的"破环"护栏）：起因 = 全库代码审查
 *      （`docs/design/code-review-20261002.md` §6）实测 `packages/core/src` 有 34 处**运行期**模块环
 *      （最大 13 个模块），且 `54cfc050` 已因此炸过一次"模块环启动崩溃"。只认相对导入的**运行期**边
 *      （`import type` 不算）；**新增环 = 红**，基线里已不存在的环 = 提示（破一条、从 `F9_CYCLE_BASELINE`
 *      删一条，直到基线清零）。基线是存量快照，不是"允许作恶"的白名单。
 *
 * 用法：`npm run arch:guard`（或 `npx tsx tools/arch-guard.ts`，加 `--list` 打印全部读数）。
 * **反例实测**（每条判据都要证明它真能报红，见头注末的「自检记录」）。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）
 *   - 本工具最后核对：**2026-10-02**（当日读数：F1~F7 各 0 处 · **F8 0 处**（同日新增）·
 *     **F9 新增环 0 处 / 基线 0 条**（同日新增，2026-10-02 当天破环工程收官清零））
 *   - 判据：新增"游戏数据表"时**同步登记进 `DATA_TABLES`**，否则它照样能被页面直读而无人拦；
 *     新增单点时**同步登记进 `SINGLE_SOURCE` 与 `docs/single-source.md`**（两处一起，F3 会核对）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
// F5 用：直接跑真实的跳转表（纯函数、只依赖 MapTab 类型）⇒ 契约与实现同源，不抄一份
import { goFor } from '../apps/desktop/src/renderer/src/ui/activityGo'

const ROOT = process.cwd()
const RENDERER = join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'src')
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', '.git'])
const LIST = process.argv.includes('--list')
/** F9 用：破环成功的提示（不报红） */
const f9Notes: string[] = []

/** 允许直接读「游戏数据表」的文件（逐条写理由；其余渲染层文件一律不许） */
const ALLOW_TABLE_READERS: Record<string, string> = {
  'game/engine.ts':
    '渲染层的数据产地——它读 data 表建 `ctx`（`buildSimContext`）；页面要字段应当从 ctx 取，不许自己再读表',
  'i18n/locale.tsx': '本地化单点自身（读 `L10N` 文案表，英文界面全靠它）',
  // 下面四条是 2026-09-27 首轮体检的存量登记（**只登记不红**）：都有"读它是对的"的理由，
  // 但其中前两条含玩家可见文案 ⇒ 已记进 `docs/review/arch-guard-baseline-20260927.md` 备船长裁。
  'panels/Handbook.tsx':
    '物资图鉴的卡片构造单点：读 `FACTION_CODEX`（势力档案原始表）与 `FOE_SHIPS`（敌舰原始表）来建卡片；' +
    '⚠ 这两张表是**原始中文表**，英文界面下是否漏中文待核（已登记进清单，本批不改）',
  'panels/Wormhole.tsx': '`WORMHOLE_FAMILY_CARDS` 只用来做**族 → 卡 id 的反查**（`Object.keys/values` 匹配 id），不显示文本',
  'panels/SignalSpace.tsx': '旧探索面板从verify物化；WORMHOLE_FAMILY_CARDS仅用于族卡反查，与Wormhole面板同口径',
  'ui/wreckFlavor.tsx': '`FRAGMENT_RECIPES` 只按 `tier` 取配方行喂回收读数（id 与数值），不显示文本；逻辑在 core 单点',
  'ui/labelsText.ts':
    '**族徽判据单点**（2026-09-27 从 `panels/Handbook.tsx` 迁入）：读 `FACTION_CODEX` 只为两件事——' +
    '① `factionOfExclusive(id)` 反查某件内容属于哪一族；② 族字母 → 势力**全称文案 id**（`nameId`）。' +
    '两条都**不显示原始中文文本**（全称经 `tr(nameId)` 按当前语言取词），且必须与图鉴同一把尺 ⇒ 只能读表',
}

/**
 * 「游戏数据表」符号（大写导出）：渲染层只许 `ALLOW_TABLE_READERS` 里的文件读。
 * ⚠ 只收**游戏数据**；**标签/枚举/常量不算**（标签类由 `ui-subs-check` 的本地化直读契约管）。
 */
const DATA_TABLES: readonly string[] = [
  // data 侧内容表
  'SHIPS', 'MODULES', 'ITEMS', 'BLUEPRINTS', 'SHIP_BLUEPRINTS', 'SKILLS', 'BELTS', 'GALAXIES',
  'GALAXY_EDGES', 'DIALOGUES', 'ANOMALIES_FLAVORED', 'SKILL_GROUPS', 'FOE_SHIPS',
  'FACTION_CODEX', 'FRAGMENT_RECIPES', 'WORMHOLE_FAMILY_CARDS',
  // 本地化覆盖表（英文界面靠它；页面直读会绕过当前语言）
  'EN_SHIPS', 'EN_MODULES', 'EN_ITEMS_ALL', 'EN_SKILLS', 'EN_ANOMALIES', 'EN_BLUEPRINTS',
  'EN_SHIP_BLUEPRINTS', 'EN_FOE_SHIPS', 'EN_GALAXIES', 'EN_BELTS', 'EN_STATIONS', 'EN_COMMS_FACTIONS',
]

/**
 * 单点注册表（机器可读副本；人读版 = `docs/single-source.md`，两处必须同时登记，F3 会核对）。
 * `exported: false` = 该单点是**模块内私有实现**（如 `crestFamOf`）——F3 只校验"声明在不在"，
 * 其余文件出现同名定义照样按 F2 报红。
 */
const SINGLE_SOURCE: readonly { concept: string; symbol: string; file: string; exported: boolean }[] = [
  { concept: '静态JSON参数与代码文本装配', symbol: 'staticDataGroup', file: 'packages/data/src/staticData.ts', exported: true },
  { concept: '数值编辑字段与范围计划', symbol: 'planDocuments', file: 'tools/data-editor-schema.ts', exported: true },
  { concept: '限额慢补货配置判据', symbol: 'hasLimitedSupply', file: 'packages/core/src/marketLimitedSupply.ts', exported: true },
  { concept: '限额慢补货额度核销', symbol: 'consumeLimitedSupply', file: 'packages/core/src/marketLimitedSupply.ts', exported: true },
  { concept: '武器组炮数', symbol: 'volleyGunCountOf', file: 'packages/core/src/combatVolley.ts', exported: true },
  { concept: '齐射总伤逐炮守恒分摊', symbol: 'volleyDamageShareOf', file: 'packages/core/src/combatVolley.ts', exported: true },
  { concept: '黑市累计声望入口门槛', symbol: 'blackMarketUnlocked', file: 'packages/core/src/blackMarket.ts', exported: true },
  { concept: '黑市候选池与例外购买资格', symbol: 'blackMarketCandidateGoods', file: 'packages/core/src/blackMarket.ts', exported: true },
  { concept: '黑市本地日界', symbol: 'blackMarketDayStart', file: 'packages/core/src/blackMarket.ts', exported: true },
  { concept: '黑市下次刷新时间', symbol: 'blackMarketNextRefresh', file: 'packages/core/src/blackMarket.ts', exported: true },
  { concept: '黑市新货架商品组数量', symbol: 'blackMarketLotQuantity', file: 'packages/core/src/blackMarket.ts', exported: true },
  { concept: '黑市锁定交付数量与旧货架兼容', symbol: 'blackMarketOfferQuantity', file: 'packages/core/src/blackMarket.ts', exported: true },
  { concept: '市场商品可读名称', symbol: 'marketGoodDisplayName', file: 'apps/desktop/src/renderer/src/ui/marketGoodHover.tsx', exported: true },
  { concept: '市场蓝图产物与材料悬停行', symbol: 'blueprintHoverLines', file: 'apps/desktop/src/renderer/src/ui/marketGoodHover.tsx', exported: true },
  { concept: '市场商品卡与完整详情同源', symbol: 'marketGoodInfo', file: 'apps/desktop/src/renderer/src/ui/marketGoodHover.tsx', exported: true },
  { concept: '虫洞整备库存与容量预览', symbol: 'wormholePreparationPlan', file: 'packages/core/src/wormholePreparation.ts', exported: true },
  { concept: '虫洞按现役机型生成一套备用目标', symbol: 'wormholePreparationFillPlan', file: 'packages/core/src/wormholePreparation.ts', exported: true },
  { concept: '虫洞按所选模板填写总量与库存差额', symbol: 'wormholeTemplateFillPlan', file: 'packages/core/src/wormholePreparationTemplates.ts', exported: true },
  { concept: '虫洞随档整备模板清洗与数量上限', symbol: 'cleanWormholePreparationTemplates', file: 'packages/core/src/wormholePreparationTemplates.ts', exported: true },
  { concept: '旧信号空间与未来虫洞的文案ID选择', symbol: 'signalSpaceTextId', file: 'packages/core/src/explorationText.ts', exported: true },
  { concept: '虫洞有限物资占格（含战斗预载）', symbol: 'wormholeSupplyCells', file: 'packages/core/src/wormholeSupplies.ts', exported: true },
  { concept: '虫洞当前地点实物格板', symbol: 'wormholeGroundBoard', file: 'packages/core/src/wormholeGround.ts', exported: true },
  { concept: '虫洞撤离清单与容量核对', symbol: 'wormholeExtractionPlan', file: 'packages/core/src/wormholeExtraction.ts', exported: true },
  { concept: '虫洞事件选项费用与结果预览', symbol: 'wormholeEventPreview', file: 'packages/core/src/wormholeExpedition.ts', exported: true },
  { concept: '虫洞出发锁定的有限补给包', symbol: 'wormholeSupplyPackageOf', file: 'packages/core/src/wormholePreparation.ts', exported: true },
  { concept: '虫洞可见警戒与有限巡逻节拍', symbol: 'wormholePatrolAfterAction', file: 'packages/core/src/wormholePatrol.ts', exported: true },
  { concept: '虫洞新规则敌人实际属性预算', symbol: 'wormholeExpeditionCard', file: 'packages/core/src/wormholeExpeditionFoes.ts', exported: true },
  { concept: '虫洞真实有限补给探索策略', symbol: 'wormholeRunExpeditionPolicy', file: 'packages/core/src/wormholeExpeditionPolicy.ts', exported: true },
  { concept: '虫洞已知守卫战有限供货只读预估', symbol: 'wormholeGuardRiskPreview', file: 'packages/core/src/wormholeExpeditionPolicy.ts', exported: true },
  { concept: '虫洞事件费用与后果展示', symbol: 'wormholeEventView', file: 'packages/core/src/wormholeExpeditionView.ts', exported: true },
  { concept: '虫洞可见巡逻预兆与路径摘要', symbol: 'wormholeAlertView', file: 'packages/core/src/wormholeExpeditionView.ts', exported: true },
  { concept: '虫洞已揭露敌情与实际威胁预览', symbol: 'wormholeEncounterView', file: 'packages/core/src/wormholeExpeditionView.ts', exported: true },
  { concept: '纯货舰模块能力兼容', symbol: 'moduleAllowedOnShip', file: 'packages/core/src/shipFitting.ts', exported: true },
  { concept: '物品领域分类与未知条目兜底', symbol: 'itemCategoryOf', file: 'apps/desktop/src/renderer/src/ui/itemSubs.ts', exported: true },
  { concept: '市场领域分类及细分判定', symbol: 'marketDomainPasses', file: 'apps/desktop/src/renderer/src/ui/itemSubs.ts', exported: true },
  { concept: '网页重连存档进度摘要', symbol: 'reconnectProgress', file: 'apps/desktop/src/renderer/src/game/saveReconnect.ts', exported: true },
  { concept: '网页重连有效状态内容比较', symbol: 'sameReconnectProgress', file: 'apps/desktop/src/renderer/src/game/saveReconnect.ts', exported: true },
  { concept: '入侵残骸每族余额与箱子读数', symbol: 'weekendWreckPoolsOf', file: 'packages/core/src/salvage.ts', exported: true },
  { concept: '入侵残骸旧账迁移与新桶归一', symbol: 'normalizeWeekendWreckRecord', file: 'packages/core/src/weekendWreckLedger.ts', exported: true },
  { concept: '聚焦阵列波内修正率（射程与防空同源）', symbol: 'coronaFocusBonusOf', file: 'packages/core/src/coronaFocus.ts', exported: true },
  { concept: '仿真上下文（页面取数的唯一入口）', symbol: 'buildSimContext', file: 'packages/data/src/context.ts', exported: true },
  { concept: '渲染层引擎（ctx 的产地，页面取数都从它来）', symbol: 'GameEngine', file: 'apps/desktop/src/renderer/src/game/engine.ts', exported: true },
  { concept: '玩家可见文案唯一表（id → 各语言）', symbol: 'L10N', file: 'packages/data/src/l10n/table.ts', exported: true },
  { concept: '标签取词单点（槽类/槽位/舰级/地点/机型…）', symbol: 'kindText', file: 'apps/desktop/src/renderer/src/ui/labelsText.ts', exported: true },
  { concept: '族徽判据收窄（判"有没有族"只走它）＋族徽可读名', symbol: 'crestFamOf', file: 'apps/desktop/src/renderer/src/ui/labelsText.ts', exported: true },
  { concept: '取色跨表兜底（TONES → ICO_TONES → NAV_TONES）', symbol: 'toneOfAny', file: 'apps/desktop/src/renderer/src/ui/tones.ts', exported: true },
  { concept: '图鉴卡片构造（模块/舰船/物品/蓝图同源）', symbol: 'itemCellOf', file: 'apps/desktop/src/renderer/src/panels/handbookDetail.tsx', exported: true },
  { concept: '悬停提示接管层（全站唯一延迟与优先级）', symbol: 'TIP_DELAY_MS', file: 'apps/desktop/src/renderer/src/ui/Tooltip.tsx', exported: true },
  { concept: '视口懒挂载（大列表流式加载）', symbol: 'LazyMount', file: 'apps/desktop/src/renderer/src/ui/LazyMount.tsx', exported: true },
  { concept: '势力族色（星图族标签 / 战场敌舰 / 图鉴族徽同源）', symbol: 'FOE_ACCENT', file: 'apps/desktop/src/renderer/src/ui/tones.ts', exported: true },
  { concept: '物品稀有度分档', symbol: 'itemRarityTierOf', file: 'packages/data/src/rarityTier.ts', exported: true },
  { concept: '装备归属档（高/中/低/舰船插件）', symbol: 'rackDimKeyOf', file: 'apps/desktop/src/renderer/src/ui/itemSubs.ts', exported: true },
  { concept: '技能取消级联基线（只报"因本次取消才失效"的项）', symbol: 'preexistingUnmet', file: 'packages/core/src/skillQueue.ts', exported: false },
  { concept: '存档清洗白名单（新增随档字段必须两处落笔）', symbol: 'normalizeState', file: 'packages/core/src/save.ts', exported: false },
  { concept: '活动栏「停止/取消」按钮文案（两套外壳共用）', symbol: 'stopLabel', file: 'apps/desktop/src/renderer/src/panels/activityStopLabel.ts', exported: true },
  { concept: '活动栏行「点击去哪」的跳转表（两套外壳共用）', symbol: 'goFor', file: 'apps/desktop/src/renderer/src/ui/activityGo.ts', exported: true },
  {
    concept: '矿带每小时产出与行情产值（排序与矿带卡面共用 · 2026-09-30 船长令「原矿价值最高的排序已经落后」）',
    symbol: 'beltYieldRows',
    file: 'packages/core/src/mining.ts',
    exported: true,
  },
  {
    concept: '手动工作位被谁占着（炉/回收炉/拆解台/制造线/实验室共用那一个名额 · 2026-10-01 船长令「和旧的工业一样，主控正在活动时禁止按钮」）',
    symbol: 'manualSlotOf',
    file: 'packages/core/src/activityGate.ts',
    exported: true,
  },
]

/** F4：渲染层一级页/面板不许自己建仿真上下文（那是 `engine.ts` 的活） */
const CONTEXT_BUILDERS: readonly string[] = ['buildSimContext']

type Hit = { check: string; file: string; line: number; detail: string; fix: string }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
  return out
}

/** 去掉注释（块注释 + 行注释），避免"注释里提到符号名"被误判（口径同 ui-subs-check） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '')
}

/** 本文件从 @whale/core|data **具名导入**的符号（`import type` 只取类型的场合另判） */
function importsFromCoreData(src: string): { symbol: string; line: number; typeOnly: boolean }[] {
  const out: { symbol: string; line: number; typeOnly: boolean }[] = []
  const re = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]@whale\/(?:core|data)['"]/g
  for (const m of src.matchAll(re)) {
    const typeOnly = m[1] !== undefined
    const line = src.slice(0, m.index ?? 0).split('\n').length
    for (const raw of m[2].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0]?.trim()
      if (name) out.push({ symbol: name, line, typeOnly })
    }
  }
  return out
}

/** 模块作用域声明（`export` 可为无）：`const NAME` / `function NAME` */
function localDeclarations(src: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = []
  const re = /^[ \t]*(?:export\s+)?(?:const|function|let)\s+([A-Za-z_$][\w$]*)/gm
  for (const m of src.matchAll(re)) {
    out.push({ name: m[1], line: src.slice(0, m.index ?? 0).split('\n').length })
  }
  return out
}

/**
 * 从一个 `function NAME(` 声明处取出**函数体文本**（先按圆括号配对接掉参数表，再按大括号配对接体）。
 *
 * ⚠ 参数表里可能有**对象类型字面量**（`opts?: { a: string }`）⇒ 一见到 `{` 就当函数体是错的
 * （2026-10-02 写 F8 普查原型时实测踩到：抽出来的"体"只有类型那一截）。
 */
function fnBodyOf(text: string, declIndex: number): string | null {
  let par = 0
  let i = text.indexOf('(', declIndex)
  if (i < 0) return null
  for (; i < text.length; i++) {
    if (text[i] === '(') par++
    else if (text[i] === ')') {
      par--
      if (par === 0) break
    }
  }
  const open = text.indexOf('{', i)
  if (open < 0) return null
  let depth = 0
  for (let k = open; k < text.length; k++) {
    if (text[k] === '{') depth++
    else if (text[k] === '}') {
      depth--
      if (depth === 0) return text.slice(open, k + 1)
    }
  }
  return null
}

/** 数组字面量里的单引号字符串项（`export const X: T[] = ['a', 'b']`；注释已被 `stripComments` 清掉）
 *  ⚠ 必须从 **`=` 之后**再找 `[`：类型注解里就有方括号（`readonly MainActivityKind[]`）
 *  ⇒ 从声明处直接找 `[` 会命中类型那一对，切出来是空串（2026-10-02 实测踩到：11 个档位全报"没登记"）。 */
function stringItemsOf(text: string, decl: string): string[] {
  const i = text.indexOf(decl)
  if (i < 0) return []
  const eq = text.indexOf('=', i)
  if (eq < 0) return []
  const open = text.indexOf('[', eq)
  const close = text.indexOf(']', open)
  if (open < 0 || close < 0) return []
  return [...text.slice(open, close).matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]!)
}

/** 对象字面量里的 `键: 值`（`export const X: T = { a: true }`；同样从 `=` 之后找 `{`） */
function objectItemsOf(text: string, decl: string): Record<string, string> {
  const i = text.indexOf(decl)
  if (i < 0) return {}
  const eq = text.indexOf('=', i)
  if (eq < 0) return {}
  const open = text.indexOf('{', eq)
  const close = text.indexOf('}', open)
  if (open < 0 || close < 0) return {}
  const out: Record<string, string> = {}
  for (const m of text.slice(open, close).matchAll(/([A-Za-z0-9_]+)\s*:\s*([A-Za-z0-9_]+)/g)) out[m[1]!] = m[2]!
  return out
}

const hits: Hit[] = []
const rendererFiles = walk(RENDERER)
const relOf = (p: string): string => relative(RENDERER, p).replace(/\\/g, '/')

/* ═══════════ F1 · 分层边界：渲染层不许直读游戏数据表 ═══════════ */
for (const file of rendererFiles) {
  const rel = relOf(file)
  if (ALLOW_TABLE_READERS[rel] !== undefined) continue
  const src = readFileSync(file, 'utf8')
  for (const imp of importsFromCoreData(src)) {
    if (imp.typeOnly) continue // `import type` 不读值，放行
    if (!DATA_TABLES.includes(imp.symbol)) continue
    hits.push({
      check: 'F1',
      file: rel,
      line: imp.line,
      detail: `直读游戏数据表 \`${imp.symbol}\``,
      fix: `改从 ctx 取（页面拿到的 \`ctx\` 已按当前语言覆盖）；缺字段就提取数需求给单点，别在页面里读表`,
    })
  }
}

/* ═══════════ F2 · 单点覆盖：已有单点的事，别处又写一份（同名判据） ═══════════ */
const registered = new Map(SINGLE_SOURCE.map((s) => [s.symbol, s]))
for (const file of rendererFiles) {
  const rel = relOf(file)
  const src = stripComments(readFileSync(file, 'utf8'))
  for (const decl of localDeclarations(src)) {
    const reg = registered.get(decl.name)
    if (reg === undefined) continue
    if (reg.file.endsWith(rel)) continue // 单点自己的实现
    hits.push({
      check: 'F2',
      file: rel,
      line: decl.line,
      detail: `本地又定义了一份 \`${decl.name}\`（单点 = ${reg.file}）`,
      fix: `删掉本地实现，改从单点导入：${reg.concept}`,
    })
  }
}

/* ═══════════ F3 · 索引自检：索引写的落点必须真实存在 ═══════════ */
const allSources = new Map<string, string>() // 路径 → 源码（懒加载）
const sourceOf = (p: string): string => {
  const cached = allSources.get(p)
  if (cached !== undefined) return cached
  const abs = join(ROOT, p)
  const text = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
  allSources.set(p, text)
  return text
}
for (const s of SINGLE_SOURCE) {
  if (!existsSync(join(ROOT, s.file))) {
    hits.push({
      check: 'F3',
      file: s.file,
      line: 1,
      detail: `单点索引指向的文件不存在（关注点：${s.concept}）`,
      fix: '修正 `SINGLE_SOURCE` 与 `docs/single-source.md` 里的落点路径',
    })
    continue
  }
  const src = sourceOf(s.file)
  const declared = s.exported
    ? new RegExp(`export\\s+(?:const|function|class|interface|type|enum)\\s+${s.symbol}\\b`).test(src)
    : new RegExp(`(?:^|\\n)[ \\t]*(?:export\\s+)?(?:const|function|class)\\s+${s.symbol}\\b`).test(src)
  if (!declared) {
    hits.push({
      check: 'F3',
      file: s.file,
      line: 1,
      detail: `单点索引里的 \`${s.symbol}\` 在 ${s.file} 里找不到${s.exported ? '导出' : '声明'}（关注点：${s.concept}）`,
      fix: '改名/搬家后必须同步索引（两处一起改：本文件 + docs/single-source.md）',
    })
  }
}

/* ═══════════ F4 · 取数口契约：页面/面板不许自己建仿真上下文 ═══════════ */
for (const file of rendererFiles) {
  const rel = relOf(file)
  if (rel === 'game/engine.ts') continue
  if (!/^(pages|panels)\//.test(rel)) continue
  const src = stripComments(readFileSync(file, 'utf8'))
  src.split('\n').forEach((line, i) => {
    for (const fn of CONTEXT_BUILDERS) {
      if (new RegExp(`\\b${fn}\\s*\\(`).test(line)) {
        hits.push({
          check: 'F4',
          file: rel,
          line: i + 1,
          detail: `页面旁路取数：自己调 \`${fn}()\``,
          fix: '取数走引擎给的那一份 ctx，不要在页面里重建上下文',
        })
      }
    }
  })
}

/* ═══════════ F5 · 跳转目标契约：活动栏「点击去哪」必须落在真实存在的页/页签上 ═══════════
 * 起因（船长 2026-09-27 报障）：「**送快递时，点击活动栏玩家的活动，跳转到空页面**」——
 * 跳转表里还写着 `mapTab: 'task'`，而「任务中心」2026-09-14 已从星图页搬成独立一级页
 * ⇒ `setMapTab('task')` 之后星图页六个页签的条件渲染全落空 = 空白页。
 * 本检查把"跳转目标"变成契约：**页签必须是 `MAP_TABS` 里真实存在的键** ＋ **目的地名 id 必须在唯一表里**。
 */
{
  const mapTabsSrc = sourceOf('apps/desktop/src/renderer/src/pages/MapPage.tsx')
  const realTabs = new Set([...mapTabsSrc.matchAll(/\{\s*key:\s*'([a-z]+)'/g)].map((m) => m[1]))
  const l10nSrc = sourceOf('packages/data/src/l10n/table.ts')
  const kinds = [
    'mining', 'scan', 'salvage', 'expedition', 'return', 'transit', 'standby', 'wormhole',
    'courier', 'hauling', 'loop', 'manufacture', 'refine', 'train',
  ]
  if (realTabs.size === 0) {
    hits.push({
      check: 'F5',
      file: 'apps/desktop/src/renderer/src/pages/MapPage.tsx',
      line: 1,
      detail: '读不出 `MAP_TABS` 的页签键（判据失效）',
      fix: 'MAP_TABS 的写法变了 ⇒ 同步更新 arch-guard 的 F5 判据（必须继续读真实的 key 字面量）',
    })
  }
  for (const k of kinds) {
    const t = goFor(k)
    if (t.mapTab !== undefined && realTabs.size > 0 && !realTabs.has(t.mapTab)) {
      hits.push({
        check: 'F5',
        file: 'apps/desktop/src/renderer/src/ui/activityGo.ts',
        line: 1,
        detail: `活动 \`${k}\` 跳的星图页签 \`${t.mapTab}\` 在 MAP_TABS 里不存在（会落到空白页）`,
        fix: `改跳真实页签（现有：${[...realTabs].join(' / ')}），或改跳它真正所属的一级页`,
      })
    }
    if (!l10nSrc.includes(`"${t.labelId}"`)) {
      hits.push({
        check: 'F5',
        file: 'apps/desktop/src/renderer/src/ui/activityGo.ts',
        line: 1,
        detail: `活动 \`${k}\` 的目的地名 id \`${t.labelId}\` 不在 l10n 唯一表里`,
        fix: '在 packages/data/src/l10n/table.ts 补这条 id（zh + en），或改用已有的 id',
      })
    }
  }
}

/* ═══════════ F6 · 日期格式化本地化：渲染层不许把语言焊死 ═══════════
 * 起因（**2026-09-29 船长令**：英文界面残留中文清理 · 甲案）：`toLocaleDateString('zh-CN')` 这类写法
 * 在英文界面下照样按中文顺序出日期。走 `i18n/fmt.ts` 的 `fmtDate` / `fmtDateTime` 即可。
 * ⚠ 只管**日期/时间**：`toLocaleString('zh-CN')` 用于数字千分位时 zh/en 逐位同值 ⇒ 不报。
 */
{
  const DATE_LOCALE = /toLocale(Date|Time)String\s*\(\s*['"]zh-CN['"]/g
  for (const file of rendererFiles) {
    const rel = relOf(file)
    if (rel === 'i18n/fmt.ts') continue // 本地化封装自家（它有 localeTag() 那条）
    const src = stripComments(readFileSync(file, 'utf8'))
    src.split('\n').forEach((line, i) => {
      if (!DATE_LOCALE.test(line)) return
      DATE_LOCALE.lastIndex = 0
      hits.push({
        check: 'F6',
        file: rel,
        line: i + 1,
        detail: '把语言焊死的日期格式化（`toLocaleDateString(\'zh-CN\')`）',
        fix: '改走 `i18n/fmt.ts` 的 `fmtDate` / `fmtDateTime`（内部取 `localeTag()`）',
      })
    })
  }
}

/* ═══════════ F7 · 落盘心跳单点：间隔只许有一个出处 ═══════════
 * 起因（**2026-09-29 船长令**：「**存档间隔不是太短了，延迟到1分钟**」；原 15 秒）：
 * 间隔值散落就会出现"心跳 60 秒、别处还写 15 秒"的双口径，且**改小了没人拦**。
 * 判据两条：① `SAVE_INTERVAL_MS` 必须存在且等于 60_000；② 落盘 `setInterval` 里不许写裸数字。
 */
{
  const EXPECTED = 60_000
  const ENGINE_REL = 'game/engine.ts'
  const engineFile = rendererFiles.find((f) => relOf(f) === ENGINE_REL)
  if (engineFile === undefined) {
    hits.push({
      check: 'F7',
      file: ENGINE_REL,
      line: 0,
      detail: '找不到落盘心跳所在的文件（路径变了？本检查需同步更新）',
      fix: '确认 `apps/desktop/src/renderer/src/game/engine.ts` 还在；不在则改本检查的路径',
    })
  } else {
    const src = stripComments(readFileSync(engineFile, 'utf8'))
    const decl = /const\s+SAVE_INTERVAL_MS\s*=\s*([0-9_]+)/.exec(src)
    const value = decl === null ? null : Number(decl[1]!.replace(/_/g, ''))
    if (value === null) {
      hits.push({
        check: 'F7',
        file: ENGINE_REL,
        line: 0,
        detail: '`SAVE_INTERVAL_MS` 不见了（落盘心跳间隔失去了单点出处）',
        fix: '恢复 `const SAVE_INTERVAL_MS = 60_000` 并让 `ensureSaveInterval` 用它',
      })
    } else if (value !== EXPECTED) {
      hits.push({
        check: 'F7',
        file: ENGINE_REL,
        line: 0,
        detail: `落盘心跳 = ${value} ms，与船长给定的 ${EXPECTED} ms（1 分钟）不一致`,
        fix: `改回 ${EXPECTED}；确有新裁决时**同时**更新本检查的 EXPECTED 并在提交说明里写理由`,
      })
    }
    // ② 落盘 setInterval 里写裸数字 = 绕过常量的第二出处
    const rawTick = /setInterval\s*\(\s*\([^)]*\)\s*=>\s*\{[^}]*persist\(\)[^}]*\}\s*,\s*[0-9_]/.exec(src)
    if (rawTick !== null) {
      hits.push({
        check: 'F7',
        file: ENGINE_REL,
        line: src.slice(0, rawTick.index).split('\n').length,
        detail: '落盘定时器里写了裸数字（绕开 `SAVE_INTERVAL_MS` 的第二出处）',
        fix: '把 `setInterval(..., N)` 改成 `setInterval(..., SAVE_INTERVAL_MS)`',
      })
    }
  }
}

/* ═══════════ F8 · 主控活动切换契约：入口必过门禁 ＋ 登记表与实现一致 ═══════════
 * 起因（**船长 2026-10-01 报障 ＋ 裁定**）：「**实验室的主控活动并不占用主控，是BUG。建议将这方面
 * 做一个规则，主控在做什么的时候天然排除其他主控可以做的活**」→ 裁定**乙案** ＝ 登记表 ＋ 两两互斥矩阵
 * ＋ **契约护栏**（工作文档 `docs/design/activity-gate-registry-20261001.md`）。
 * stage 1（登记表 + 活动栏接入）已落；**本检查 = stage 2 的契约护栏**，钉住两类漂移：
 *
 *   ① **入口漏调门禁**：core 导出的 `start*` 主控入口（＋登记在册的少数非 `start` 命名入口）
 *      必须**直接**调 `applyActivityGate` / `applyActivityHandoff` / `gateMainActivity*`，
 *      或**经委托链（≤4 层）**走到一个调了的入口（接力入口 `startMiningFromExpedition` /
 *      `startExpeditionFromMining` 就是靠委托：它们自己不过门禁，落到 `startMining` / `startExpedition`）。
 *   ② **登记表与实现脱节**：`MainActivityKind` 的每个档位必须
 *      ⑴ 在 `mainActivityOf` 里能被**探测到**（实验室那次的病根就是"停机有档、探测没档"）
 *      ⑵ 在 `AUTO_HALT_KINDS` / `WARN_KINDS` 两档登记里**恰好占一档**（互斥且覆盖）
 *      ⑶ 可中断（`INTERRUPTIBLE === true`）的档位必须在 `state.haltActivityForSwitch` 里有 `case`。
 *
 * ⚠ **白名单逐条写明理由**（船长条文：「白名单要写明理由」）；名单里的入口**改名/删除会报红**
 * ——逼一次人工复核，避免"改了名就悄悄脱离护栏"。
 * ⚠ **刻度说明**：本检查按**源码文本**判（零依赖、与其它 F 同构），不做真正的 AST 解析
 * ⇒ 判据是"够用的近似"：它抓的是"新入口忘了过门禁"这类**整条缺失**，不抓"调了但参数写错"。
 */
{
  const CORE_DIR = join(ROOT, 'packages', 'core', 'src')
  const coreSrc = new Map<string, string>()
  for (const name of readdirSync(CORE_DIR)) {
    if (name.endsWith('.ts')) coreSrc.set(name, stripComments(readFileSync(join(CORE_DIR, name), 'utf8')))
  }

  const GATE_CALL = /(applyActivityGate|applyActivityHandoff|gateMainActivity|gateMainActivityHandoff)\s*\(/
  const fns = new Map<string, { file: string; gate: boolean; calls: string[] }>()
  for (const [file, text] of coreSrc) {
    for (const m of text.matchAll(/export (?:async )?function ([A-Za-z0-9_]+)\s*\(/g)) {
      const body = fnBodyOf(text, m.index ?? 0)
      if (body === null) continue
      fns.set(m[1]!, {
        file,
        gate: GATE_CALL.test(body),
        calls: [...body.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map((x) => x[1]!),
      })
    }
  }
  /** 这一条入口最终会不会走到门禁（直接调，或沿委托链 ≤4 层走到一个调了的） */
  const reachesGate = (name: string, depth = 0, seen = new Set<string>()): boolean => {
    const f = fns.get(name)
    if (f === undefined) return false
    if (f.gate) return true
    if (depth >= 4 || seen.has(name)) return false
    seen.add(name)
    return f.calls.some((c) => reachesGate(c, depth + 1, seen))
  }
  const lineOfFn = (file: string, name: string): number => {
    const t = coreSrc.get(file) ?? ''
    const i = t.indexOf('function ' + name + '(')
    return i < 0 ? 0 : t.slice(0, i).split('\n').length
  }
  const push = (file: string, line: number, detail: string, fix: string): void => {
    hits.push({ check: 'F8', file: `packages/core/src/${file}`, line, detail, fix })
  }

  /** **登记在册的主控入口**：名字不以 `start` 开头的那几个（普查 2026-10-01 / 10-02 两轮） */
  const REGISTRY: readonly { fn: string; note: string }[] = [
    { fn: 'goStandbyAt', note: '前往星系（驻留）· 档位 standby' },
    { fn: 'wormholeScanStart', note: '扫描虫洞 · 档位 wormholeScan' },
    { fn: 'wormholeEntryAutoStops', note: '进虫洞那一刻的自动停机（handoff 判据）' },
    { fn: 'wormholeEntryBlockReason', note: '进虫洞的拦截判据（handoff 判据）' },
    { fn: 'startMiningFromExpedition', note: '接力入口：委托 startMining' },
    { fn: 'startExpeditionFromMining', note: '接力入口：委托 startExpedition' },
  ]
  /** **有意不过门禁的入口**（白名单 · 逐条理由） */
  const EXEMPT: readonly { fn: string; reason: string }[] = [
    { fn: 'startScan', reason: '星图扫描：船长 2026-09-15 令「不占主控活动」' },
    { fn: 'startTransitHome', reason: '换港返航：属 LOCKED 档（锁定态由 cannotInterruptReason 统一挡）' },
    { fn: 'startBattleFor', reason: '开战：非主控活动入口（战斗中由 cannotInterruptReason 的锁定态挡）' },
    { fn: 'startFleetBattleFor', reason: '编队开战：同上' },
  ]

  const entries = new Set<string>(REGISTRY.map((r) => r.fn))
  for (const name of fns.keys()) if (name.startsWith('start')) entries.add(name)

  for (const name of entries) {
    if (reachesGate(name)) continue
    if (EXEMPT.some((e) => e.fn === name)) continue
    const f = fns.get(name)
    if (f === undefined) continue
    push(
      f.file,
      lineOfFn(f.file, name),
      `主控活动入口 \`${name}\` 没走活动门禁（直接调、委托链都没有，也不在豁免名单里）`,
      '在入口里调 `applyActivityGate(state, \'<档位>\', ctx)`（或委托给一个调了的入口）；确属非主控活动 ⇒ 加进本检查的 `EXEMPT` 并写明理由',
    )
  }
  for (const r of [...REGISTRY, ...EXEMPT]) {
    if (fns.has(r.fn)) continue
    push(
      'activityGate.ts',
      0,
      `登记在册的入口 \`${r.fn}\` 在 core 里找不到了（${'note' in r ? (r as { note: string }).note : (r as { reason: string }).reason}）`,
      '入口改名/删除 ⇒ 同步本检查的 REGISTRY/EXEMPT 与工作文档（这是逼一次人工复核，不是误报）',
    )
  }

  /* ── 登记表 ↔ 实现一致性（档位三分） ── */
  const gateText = coreSrc.get('activityGate.ts') ?? ''
  const stateText = coreSrc.get('state.ts') ?? ''
  const kinds = ((): string[] => {
    const i = gateText.indexOf('export type MainActivityKind')
    if (i < 0) return []
    const end = gateText.indexOf('\nexport ', i + 10)
    const seg = gateText.slice(i, end < 0 ? undefined : end)
    return [...seg.matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]!)
  })()
  const autoHalt = stringItemsOf(gateText, 'AUTO_HALT_KINDS')
  const warn = stringItemsOf(gateText, 'WARN_KINDS')
  const interruptible = objectItemsOf(gateText, 'INTERRUPTIBLE')
  const mainOfIdx = gateText.indexOf('export function mainActivityOf')
  const mainBody = mainOfIdx < 0 ? null : fnBodyOf(gateText, mainOfIdx)
  const haltIdx = stateText.indexOf('export function haltActivityForSwitch')
  const haltBody = haltIdx < 0 ? null : fnBodyOf(stateText, haltIdx)

  if (kinds.length === 0) {
    push('activityGate.ts', 0, '读不到 `MainActivityKind` 的档位清单（本检查失效，需同步更新）', '确认 `export type MainActivityKind = | \'a\' | ...` 的写法没变')
  }
  for (const k of kinds) {
    if (mainBody !== null && !mainBody.includes(`'${k}'`)) {
      push(
        'activityGate.ts',
        lineOfFn('activityGate.ts', 'mainActivityOf'),
        `档位 \`${k}\` 在 \`mainActivityOf\` 里探测不到（登记了却没人认领 ⇒ 该活动跑着时门禁会以为"主控空着"）`,
        `在 \`mainActivityOf\` 里补这一档的判据（实验室那次漏登记就是这条）`,
      )
    }
    if (!autoHalt.includes(k) && !warn.includes(k)) {
      push(
        'activityGate.ts',
        0,
        `档位 \`${k}\` 既不在 \`AUTO_HALT_KINDS\` 也不在 \`WARN_KINDS\`（它的切换档位没有登记）`,
        `按船长口径归入"直接切"或"先警告"其一（两档互斥且必须覆盖全部档位）`,
      )
    }
    if (interruptible[k] === 'true' && haltBody !== null && !haltBody.includes(`'${k}'`)) {
      push(
        'state.ts',
        lineOfFn('state.ts', 'haltActivityForSwitch'),
        `档位 \`${k}\` 是可中断的，但 \`haltActivityForSwitch\` 里没有它的 \`case\`（判据说能停、停机路径不会停）`,
        `在 \`haltActivityForSwitch\` 里补这一档的停机分支`,
      )
    }
  }
  for (const k of autoHalt) {
    if (warn.includes(k)) {
      push('activityGate.ts', 0, `档位 \`${k}\` 同时在 \`AUTO_HALT_KINDS\` 与 \`WARN_KINDS\` 里（两档互斥）`, '从其中一张表里删掉它')
    }
  }
}

/* ═══════════ F9 · 相对导入环自检（2026-10-02 加 · 代码审查的"破环"护栏） ═══════════
 * 起因：2026-10-02 全库代码审查（`docs/design/code-review-20261002.md` §6）实测 `packages/core/src`
 * 有 30+ 处**运行期**模块环（最大一条 13 个模块），且 `54cfc050` 已因此炸过一次"模块环启动崩溃"；
 * 渲染层实测 0 处。破环是渐进工程（工作文档 `docs/design/refactor-modularization-20261002.md` 批次 3 的计划），
 * 本检查保证**只会变少、不许变多**。
 *
 * 判据：只认**相对导入**的运行期边——① `import {…} from` / `export {…} from` 花括号形态
 * （`import type` / `export type` 不算——不产生运行期环）；② 裸副作用导入 `import './x'`；
 * ③ **值位**动态导入（`import('./x').类型名` 是纯类型位、编译期擦除，不算）。
 * 注释已由 `stripComments` 清掉。环 = DFS 回边，规范化（旋转到字典序最小）后与 `F9_CYCLE_BASELINE`
 * 比对：**新增环 = 红**；基线里已不存在的环 = 控制台提示（破环成功，请从基线删掉那条，不报红）。
 * ⚠ 每破一条环就从基线删一条，直到基线清零。基线是**存量快照**，不是"允许作恶"的白名单。
 */
{
  const trees = [RENDERER, join(ROOT, 'packages', 'core', 'src'), join(ROOT, 'packages', 'data', 'src')]
  const n = (p: string): string => p.replace(/\\/g, '/')
  const files: string[] = []
  for (const t of trees) walk(t, files)
  const byPath = new Set(files.map((f) => n(f)))
  const EXTS = ['', '.ts', '.tsx', '.mts', '/index.ts', '/index.tsx', '/index.mts']
  const treeOf = (p: string): string => trees.find((t) => n(p).startsWith(n(t) + '/')) ?? ''
  const graph = new Map<string, string[]>()
  // 只认花括号形态的 from 子句（`import {…} from` / `export {…} from`，含跨行与 `import type {}`）：
  // 旧正则 `[^'"]*?from` 会跨语句偷梁换柱——`export const X = 0` 一路扫到文件后面另一条语句的
  // `from './y'`，造出幻影边（2026-10-02 实测 `salvage→state`、`state→types` 两条幻影边喂出一个假环）。
  // 全库无默认导入 / `import * as` / `export * from` 形态（已核），此收紧不丢真边。
  const stmtRe = /(?:import|export)\s+(?:type\s+)?\{[^}]*\}\s*from\s*['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const f of files) {
    const src = stripComments(readFileSync(f, 'utf8'))
    const deps: string[] = []
    let m: RegExpExecArray | null
    while ((m = stmtRe.exec(src)) !== null) {
      if (m[0].startsWith('import type') || m[0].startsWith('export type')) continue
      if (m[3] !== undefined) {
        // 动态导入只认"值位"：`import('./x').类型名` 是纯类型位（编译期擦除，不产生运行期边）；
        // `import('./x').then(` / `await import('./x')` / `import('./x')()` 等值位形态才计数。
        // 实测全库 135 处动态导入全是类型位，此判据不改变现有读数。
        const tail = src.slice((m.index ?? 0) + m[0].length)
        if (/^\s*\.\s*[A-Za-z_$][\w$]*\s*(?!\()/.test(tail)) continue
      }
      const spec = m[1] ?? m[2] ?? m[3]
      if (spec === undefined || !spec.startsWith('.')) continue
      const base = n(resolve(dirname(f), spec))
      const hit = EXTS.map((x) => base + x).find((p) => byPath.has(p))
      if (hit !== undefined) deps.push(hit)
    }
    graph.set(n(f), deps)
  }
  const color = new Map<string, number>()
  const stack: string[] = []
  const found = new Set<string>()
  function dfs(u: string): void {
    color.set(u, 1)
    stack.push(u)
    for (const v of graph.get(u) ?? []) {
      if (treeOf(v) !== treeOf(u)) continue
      const c = color.get(v) ?? 0
      if (c === 1) {
        const i = stack.indexOf(v)
        const body = [...stack.slice(i), v].slice(0, -1).map((x) => relative(ROOT, x).replace(/\\/g, '/'))
        if (body.length === 0) continue // 自导入（残影，正常写法里不存在）
        let best = 0
        for (let k = 1; k < body.length; k++) if (body[k]! < body[best]!) best = k
        found.add([...body.slice(best), ...body.slice(0, best)].join(' → '))
      } else if (c === 0) dfs(v)
    }
    stack.pop()
    color.set(u, 2)
  }
  for (const f of files) if ((color.get(n(f)) ?? 0) === 0) dfs(n(f))

  if (process.argv.includes('--f9-dump')) {
    // 维护模式（破环批次用）：把当前全部环打成 JSON 数组，覆盖写入基线文件后即可提交
    console.log(JSON.stringify([...found].sort()))
    process.exit(0)
  }

  /**
   * **存量基线**（独立数据文件 `tools/arch-guard-baseline-cycles.json`；破一条删一条）。
   * 初始快照 2026-10-02 实测 34 条；破环工程（工作文档 refactor-modularization-20261002.md）逐条收账，
   * **同日收官：基线清零**（34 → 0；此后 F9 = 纯"不许新增运行期环"闸门）。
   * 同日判据修正：旧正则把「跨语句 from」与「类型位动态导入」误算成运行期边，喂出 6 条幻影环
   * （salvage→state→types 等）；收紧判据后 20 → 14 条，剩余全部为实测运行期环。
   * ⚠ 环串里的箭头与 `--f9-dump` 输出**逐字一致**（空格-箭头-空格），手工编辑时别改分隔符。
   */
  const F9_CYCLE_BASELINE: readonly string[] = JSON.parse(
    readFileSync(join(ROOT, 'tools', 'arch-guard-baseline-cycles.json'), 'utf8'),
  ) as string[]
  for (const c of [...found].sort()) {
    if (F9_CYCLE_BASELINE.includes(c)) continue
    hits.push({
      check: 'F9',
      file: c.split(' → ')[0] ?? '',
      line: 0,
      detail: `新增运行期模块环：${c}`,
      fix: '断开环上任一条运行期 import（优先把被借函数挪到依赖更低的模块，或降为 import type）；确属有意 ⇒ 登记进 F9 基线并写理由',
    })
  }
  for (const b of F9_CYCLE_BASELINE) {
    if (found.has(b)) continue
    f9Notes.push(`破环成功（基线里的环已不存在，请把它从 F9_CYCLE_BASELINE 删掉）：${b}`)
  }
}

/* ═══════════ 输出 ═══════════ */
const byCheck = new Map<string, Hit[]>()
for (const h of hits) {
  const arr = byCheck.get(h.check) ?? []
  arr.push(h)
  byCheck.set(h.check, arr)
}

console.log(
  `架构契约体检：渲染层扫了 ${rendererFiles.length} 个文件 · 游戏数据表 ${DATA_TABLES.length} 个 · ` +
    `单点登记 ${SINGLE_SOURCE.length} 条`,
)
if (LIST) {
  console.log('  允许直读数据表的文件：' + Object.keys(ALLOW_TABLE_READERS).join(' · '))
  console.log('  单点清单：' + SINGLE_SOURCE.map((s) => s.symbol).join(' · '))
}

const LABEL: Record<string, string> = {
  F1: 'F1 分层边界（页面直读数据表）',
  F2: 'F2 单点覆盖（同一件事又写一份）',
  F3: 'F3 索引自检（索引与代码不一致）',
  F4: 'F4 取数口契约（页面旁路建上下文）',
  F5: 'F5 跳转目标契约（活动栏点击落在不存在的页/页签）',
  F6: 'F6 日期格式化本地化（把语言焊死）',
  F7: 'F7 落盘心跳单点（间隔散落 / 被人改短）',
  F8: 'F8 主控活动切换契约（入口漏调门禁 / 登记表与实现不一致）',
  F9: 'F9 相对导入环自检（新增运行期模块环）',
}
for (const key of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9']) {
  const list = byCheck.get(key) ?? []
  if (list.length === 0) {
    console.log(`✅ ${LABEL[key]}：0 处`)
    continue
  }
  console.log(`❌ ${LABEL[key]}：${list.length} 处`)
  for (const h of list) {
    console.log(`  · ${h.file}:${h.line}  ${h.detail}`)
    console.log(`      修法：${h.fix}`)
  }
}

if (hits.length > 0) {
  console.log(`\n共 ${hits.length} 处。规范见 docs/development-conventions.md「取数与派生纪律」；单点索引见 docs/single-source.md。`)
}
for (const note of f9Notes) console.log(`ℹ ${note}`)
process.exit(hits.length === 0 ? 0 : 1)
