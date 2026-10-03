# 交接卡：新三号（2026-09-30 · 本会话交班）

- **一句话**：本会话把**工业 HUD 接手批（组装机/造船厂 HUD 化 ＋ 精炼炉批）**、**技能训练队列三批**、
  **首访实验室的黑市通讯**、**网页版导入存档的手机修复**、以及更早的**矿带排序 / 战斗界面布局 / 顶栏声望口径**
  全部做完并合入 main；`main == verify`，可以接着干。
- 本卡写给**零上下文的下一任三号（核验/收尾）**：开工先读 `AGENTS.md` → `docs/catalog.md` → 本卡，再动手。
- 状态：**交接中**（工作文档已按 §8 归档；本卡是交接件，按 §8 在工作结束后归档）

---

## §0 一分钟开工

| 项 | 值 |
|---|---|
| 工作树 | `H:\大鲸鱼\Deepseek-EVE-verify`（分支 **`verify`**，**不叫 d3**）· 主树 `H:\大鲸鱼\Deepseek-EVE`（`main`，**一号与船长独占**）· 二号 `...\Deepseek-EVE-d2` |
| 基线 | **`main` == `verify`**（本卡提交时 main = `fcebe963` 的那一批之后；用 `git -C 主树 log --oneline -1` 与 `git log --oneline -1` 对表）· 三号**永不写主树**：改动一律在 verify 提交，**确认主树干净**（只许有别人的未跟踪件）后 `git -C 主树 merge --ff-only verify` |
| 远端 | `origin` = `https://github.com/yahzj/Deepseek-EVE.git`（本机直连不通，推送要带代理；**推送闸门**：只在"确实完成"后推，等船长发话 —— 本次船长已说"我让一号推送"） |
| 六道闸门 | `npm run typecheck` · `npm run test -w @whale/core` · `npm run content:check` · `npm run l10n:check` · `npm run ui:rot-check` · `npm run ui:theme-check` |
| 改了 CSS 还要 | `npm run ui:layout-css`（生成件 `ui/layout-css/*`）＋ `npm run ui:layout-css:check` |
| 改了存档结构 | `npm run save:roundtrip-audit`（本次因新增 `state.labOpened` 跑过） |
| 文档改动 | `npm run docs:index`（改完必跑）· `npm run docs:seal`（滚动窗口越窗即封存） |
| 提交钩子 | `.githooks/pre-commit` 三档：❌ 闸门未过 · ⚠️ **需裁决**（暂存区含 `save.ts`/`test-saves`/`ironman`，或 `docs-seal.ts`/`balance.ts`）⇒ **拒绝提交**，要求先向船长报告 |

---

## §1 你的边界（与历任一三号同一套）

1. **汇报开头先写「报告老大喵」**（2026-09-27 船长令）。
2. **永不写主树**；合入前先 `git -C 主树 status --porcelain`。
3. **禁止子代理 / workflow / Ralph**（§5.1，底层规则）。
4. **浏览器进程只碰自己能证明的那一个**（§6）：`Start-Process` 记 PID、非默认端口、收尾只 kill 自己那个。
5. **UI 观感归船长**：只报读数型事实（几何/溢出/对比度/构成），写明"这是读数、不是观感结论"。
6. **文档纪律（§8）**：开工先建 `docs/design/<主题>-<YYYYMMDD>.md`；工作期间只改它（＋代码/数据/测试）；
   归档三步＝并入 roadmap/词典 → 删工作文档 → `docs:index`；**只归档自己的文档**，别人的一律不碰。
7. **编码纪律（§4）**：写中文盘用 .NET 显式 UTF-8；批量写文档后自查 BOM / 行尾（docs 全是 **CRLF**）/ 乱码。
8. **新增：§九之八「UI 审核」**（本会话按船长令新立，见 `docs/development-conventions.md`）：
   船长每提一处 UI 修改 ⇒ ① 先查 code 现状 ② 用 `ui-ux-pro-max` 判一次（命中不到就**收窄重试一次**，
   仍无 ⇒ **如实说"技能里没有这条依据"**，不许编）③ 回话给**技能依据 ＋ 我的意见 ＋ 风险与护栏**
   ④ 才动工（涉及版式/图形/数值口径的先出中文设计总结等确认）。**我自己提议的 UI 改动同样走这三步。**

---

## §2 本会话交付（提交号可直接 `git show`）

| 提交 | 内容 | 状态 |
|---|---|---|
| `e41220df` | 矿带排序口径改「每小时产出 × 当前行情价」＋选项改「行情产值最高」（船长令：「矿带开采的排序，原矿价值最高的排序已经落后」） | 已合入 main |
| `ae468fd0` | 战斗界面：我方射程明文回归 ＋ 炮/冷却上移、距离条下移并与拖动条合并（船长令） | 已合入 main |
| `dff0ea45` | 顶栏声望改显示「当前余额」（可支配）＋ 门槛提示一律改称「累计」（船长令） | 已合入 main |
| `6e1a7a3a` | **工业 HUD 接手批**：组装机/造船厂 HUD 化 ＋ 技能体检修正（船长令「一号准备了一个工业界面重制，我希望你接手。使用skill来调整」） | 已合入 main |
| `4c87dc24` | 精炼炉批：产出读数块上移 ＋ 圆环按产值占比分段染色 ＋ 投料两族筛选/搜索 ＋ 三处自造刻度换真值（船长令「按照真实数值修正」＋「新增UI审核」） | 已合入 main |
| `a05696a9` + `06436f78` | 队列「置顶无效」排查＋修：core 出 `queueMovePlan`，挪不动的箭头置灰＋就地说明原因（含验收读数提交） | 已合入 main |
| `08ee0319` | 工业 HUD 四页签「优先使用的 AI」选择器（左可见标签 ＋ 右「剩余 N 枚」；落点＝各页"队列/配方"窗口顶部） | 已合入 main |
| `b22977c0` + `1ec65d40` | 缺料标红（悬浮窗＋表格行）＋「单独起一行」；**顺带修**：`--hud-*` 令牌在悬浮卡里取不到（令牌块 selector 扩为 `.hud, .app-tip`） | 已合入 main |
| `b3157736` + `11ee3669` | 首访实验室的黑市通讯：新势力「黑市 · 违禁品柜」＋新触发种 `labOpened` ＋ 染色两段（含门槛句） | 已合入 main |
| `fcebe963` | 网页版「导入存档」手机修复：input 挂进 DOM ＋ 放宽 `accept` ＋ 宽限分环境 ＋ 看门狗交代 | 已合入 main |

> 相邻批次（`2e1320c0` / `4866d253` / `3badec26` / `1341e27a` 等工业 HUD 窄档、工位折叠、默认窗口尺寸）
> 是**一号**的后续，不在本会话名下；本次只归档自己的工作文档。

---

## §3 分批要点与验收读数（要复核时看这些）

| 批 | 关键结论 | 读数/截图落点 |
|---|---|---|
| 工业 HUD（组装机/造船厂/精炼炉/缺料/AI 选择器） | ✦ 组装机/造船厂 HUD 化；✦ 精炼炉左列＝产出读数块（圆环按**产值/h 占比** ≤5 段＋"其他"）＋工位表；✦ **缺料**＝红字 `--hud-short`（六套主题同值 `#E53935`）＋行尾真值「缺 N」＋单独一行，只在**未开工**时标；✦ **AI 选择器**四页签各一处（精炼炉=工位窗口顶部、组装机=制造队列、造船厂=在建舰船、实验室=配方详情）＋「剩余 N 枚」(`countAiCore`)；✦ 悬浮卡的 HUD 令牌现在挂在 `.hud, .app-tip`（卡由 Tooltip 全局层渲染，原先取不到令牌 ⇒ 整卡配色/字体静默失效） | `tools/_ui-artifacts/{hud-ai-pick,hud-short-mark,refine-ai-slot}-readings-20260930.log` ＋ `shots/hud-ai-pick-*.png`、`shots/hud-short-mark.png` |
| 技能训练队列 | ✦ 溢出根因＝`.app-train-chip` 缺 `box-sizing`（每条宽 18px）＋兜底条覆盖 `align-items`；✦ 每行＝六边形徽（复用 `hexPathAt`）＋技能书＋队首进度条＋「轮到还需 ≈X」（core `totalRemainingMs`/`pending[].etaMs` 前缀和）；✦ 「置顶无效」＝顺序契约静默回滚＋同技能多级按位置重算等级 ⇒ 判据落 core `queueMovePlan`，界面置灰＋悬停说明＋点了就地讲原因（`aria-disabled`，不是原生 disabled） | `tools/_ui-artifacts/{skills-queue-readings,queue-pin-readings,queue-pin-ui-readings}-20260930.log` ＋ `shots/skills-queue*.png` |
| 黑市通讯 | ✦ 势力 `black-market`「黑市 · 违禁品柜」（章鱼人 · **中立** · 金 · 章鱼头）；✦ 触发 `{ kind:'labOpened' }` 读 `state.labOpened`（`save.ts` 三态读写 ＋ `noteLabOpened()` 唯一置位点）；✦ 通讯 `msg-lab-contraband`（诱导口吻五段 ＋ `highlight` **两段**）；✦ 顺手补发射器说明两条真规则（母港/已建副站不能点 · 高安付 10 点声望） | `tools/_ui-artifacts/lab-comms-readings-20260930.log` ＋ `shots/comms-lab-contraband.png` |
| 导入存档 | ✦ 根因＝`<input type=file>` **从没挂进 DOM**（UC 这类内置内核不弹选择器）＋ `accept` 太窄 ＋ 取消判定只挂焦点/可见性且宽限 2.1s（没弹时**永久 hang**）；✦ 修法＝挂进 body ＋ 放宽 accept ＋ 宽限分环境（触屏 8s/桌面 2.1s）＋ **看门狗 3.5s** ＋ 取消不再静默 | `tools/_ui-artifacts/import-input-readings-20260930.log` |
| 矿带/战斗/声望 | ✦ 矿带排序改「每小时产出 × 行情价」；✦ 战斗＝我方射程明文回归＋炮/冷却上移、距离条与拖动条合并；✦ 顶栏声望＝当前（可支配）＋门槛提示改称「累计」 | `tools/_ui-artifacts/{belt-sort,belt-sort-ui,battle-layout,battle-fit,standing}-readings-20260930.log` |

---

## §4 开放项（要船长一句话的，已登记进 `docs/roadmap.md`「待办活面」）

1. **黑市门槛机制**（累计声望 ≥100 ⇒ 黑市溢价现货）—— 船长令**先挂起**；⚠ 现状是**承诺先行、机制在后**（信里已写门槛句，船长明确接受）。
2. **训练队列乙案**（同技能多级折叠成段）—— 船长选了甲案（已落），乙案未选。
3. **「优先使用的 AI」是否跨页常驻**（现为四页签各一处）—— 未裁。
4. **书架「缺料」chip 仍是金色**（与卡片红字不同色）—— 未裁。
5. **`EN_COMMS_FACTIONS` 只覆盖势力/部门名**，`brief` 在英文界面仍中文（既有缺口＋本次新势力同样）。
6. **网页版导入真机 UC 复测**（本机无 UC，只验了现场读数＋哨兵档端到端导入）。
7. **主树桌面产物需重建**（`apps/desktop/out` 仍是旧构建；我没在主树跑构建，怕扰一号）。

---

## §5 环境与收尾状态

- **进程**：本会话自起的网页预览（后台任务）与无头 Chrome 已在收尾时关闭；`tools/_ui-artifacts/` 下的读数日志与截图**保留**（它们在 gitignore 内）。
- **临时探针**：本会话用过的一次性探针（`tools/_probe-*.mts`）已按工具纪律**删除**；要复现读数就照 §3 表里的日志重写（方法都写在日志与工作文档归档条目里）。
- **工作文档**：本会话 7 份已按 §8 归档（关键内容并入 `docs/roadmap.md` 与 `docs/glossary.md`），工作文档本身已删除。
- **主树**：本次合入后 main == verify；主树里别人的未跟踪文件（`docs/exports/*`、`docs/test-saves/修复存档.json`、`tools/_probe-e2e2.mts`）**一个字没动**。

---

## §6 本会话踩过的坑（省你重踩）

1. **JSDoc 里写 `*/` 会提前闭合注释**：注释里想写"通配 MIME"别直接写那两个字面量，否则整段代码错位（TS 报一串 `Identifier expected`），而且 `content:check` 的**文案纯净契约**还会报"连续两个星号"。
2. **PowerShell 传多行参数会被按行拆开**：`npx tsx tools/_probe-eval.mts "<多行 JS>"` 只会拿到第一行（页面报 `Unexpected end of input`）
   ⇒ `_probe-eval` 已支持 `@<文件>`（多行表达式写文件里再传路径）。
3. **`save.ts` 一动，提交钩子必拦**（B-2 需裁决档）：按钩子要求**先向船长报告存档改动并拿到批准**再提交；
   钩子没有放行开关，批准后用 `git commit --no-verify`，并在汇报里单独说明理由（钩子头部就是这么规定的）。
4. **改了 `state.ts` 的新字段，`save.ts` 的清洗器必须同步登记**：漏登记会被 `save.test` 的往返用例抓住（79 vs 80 键），
   症状是"读档后新标记消失"。
5. **`.hud-*` 令牌只在 `.hud` 作用域**：悬浮卡由 Tooltip 全局层渲染（在 `.hud` 之外）⇒ 要写 `.hud, .app-tip`。
6. **合并前先看主树是否干净**：本会话两次遇到一号在主树有未提交改动（先是 `core/index.ts` + `l10n/table.ts`，
   后是 `styles.css` + 两份 `layout-css` + `INDEX.md`）⇒ `git merge --ff-only` 被拒。**不要 stash/提交别人的改动**，
   等他们提交后再 rebase ＋ ff 合入。
7. **`ui:layout-css` 生成件要跟着提交**：改 `styles.css` 或 `ui/layout-css/*.css` 后不跑它，`ui:layout-css:check` 会红。
