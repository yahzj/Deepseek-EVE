# 技能训练队列界面优化（2026-09-30 · 三号）

**状态：船长已确认（甲案）· 实现中**

## 0. 船长原话（照抄）

> 「我发现技能队列界面的训练项右侧顶到窗口了，且训练队列过于单一。能否用skill进行下优化？」

**确认阶段的三条答复（2026-09-30）**：
1. 方案：**甲案**（修溢出＋对齐＋每行补大类徽/技能书/队首进度条/轮到还需）。
2. 按钮排列：**仍在信息下方一行，靠右对齐**。
3. 行首徽：不补"圆徽"，原话 ——「**使用技能树内图标模式的的菱形卡片**」
   ⇒ 取**技能树图标模式的六边形卡片**：形状走 `ui/skillTreeLayout.ts` 的平顶六边形（本轮抽出
   `hexPathAt` 供小号复用，树上的 `hexPath` 同源），里头放同一个大类字形 `group-<大类>`，色调取 `toneOf`。

## 1. 现场读数（1340×900 画布 · 档 `docs/test-saves/save-20260920-153914.json.json` · 队列 16 项）

探针：`tools/_probe-train-geom.mts` ＋ `tools/_probe-eval.mts`（一次性，收尾删）；日志 `tools/_ui-artifacts/skills-queue-readings-20260930.log`；
截图 `tools/_ui-artifacts/shots/skills-queue.png`。**以下是读数、不是观感结论**。

### 1.1 「右侧顶到窗口」的归属

| 项 | 读数 |
|---|---|
| 容器 `.app-train-pending` 内容宽 | 753px |
| 每条 `.app-train-chip` 实测宽 | **771px**（＝ 753 ＋ padding 8×2 ＋ border 1×2） |
| 该条计算样式 | `box-sizing: content-box` · `width: 753px` · `padding: 1px 8px` · `border: 1px` |
| 面板体 `.wui-panel-body` | `clientW 777` / `scrollW 783` ⇒ **出现横向滚动条**（`offsetH − clientH = 8`） |
| chip 右缘 / 面板外框右缘 | **993 / 996 ⇒ 只剩 3px**（贴着面板框，且压掉右侧内边距与滚动条槽） |

**归因两条（都是样式泄漏，不是内容太长）**：
1. `.app-train-pending .app-train-chip { display:flex; width:100% }` **没带 `box-sizing: border-box`**；
   而 `.app-chip` 是 `content-box` ＋ 内边距 8px×2 ＋ 描边 1px×2 ⇒ 每条比容器宽 **18px**。
   （同一个坑仓库里记过一次：`styles.css` 顶栏注释「② 写 `width:100%` 但不加 `box-sizing`」。）
2. 文件末尾那条"面板外兜底" `.app-train-chip { display:inline-flex; align-items:center; gap }`
   与队列用的 `.app-train-chip { flex-direction: column; align-items: stretch }` **同权重且在后**
   ⇒ `align-items: center` 生效（实测 `align-items: center`，`main` 块只有 258px 宽、按钮块 27px，
   两块都居中）⇒ 行内容缩在中间、右侧 18px 溢出看起来更贴框。

### 1.2 「过于单一」的读数

- 每行文本片段 **2 个**（技能名＝accent 青 ＋ 时长＝dim 灰）＋ 1 组按钮；字号只有 **11px / 12px** 两档。
- **进度元素 0 个**（连队首也没有进度条；core 的 `skillQueueStatus` 其实已给出 `percent`）。
- 排队项只有"本级时长"一个数（如「第2位 武装舰操作→Lv5 6小时36分48秒」）⇒ **看不出"轮到我还要等多久"**。
- 不显示技能书 / 大类 / 前置依赖 ⇒ 16 行长得一模一样。
- 本档队列内容本身也重复：**维修工程学 Lv1→Lv5 连续 5 条**、**工业理论 Lv3→Lv4 连续 2 条**
  ⇒ 16 条里有 5 条是"同一条技能连升五级"（折叠后为 11 段）。

## 2. 技能依据（`ui-ux-pro-max` 现场检索原文）

| # | 命中 | 原文（节选） | 对本次的作用 |
|---|---|---|---|
| 1 | `ux` · Content · **Compact Label Overflow**（High） | 「Do: Boundary only unpredictable values; use **nowrap with a shrinkable label**」/「Don't: Let one compact label wrap to a second line」 | 支持"整块宽度必须把自身内边距/描边算进去"（border-box），且信息行不换行、用可缩字段 |
| 2 | `ux` · Accessibility · **Color Only**（High，前一轮命中） | 「Color is not the only indicator」 | 大类区分必须**图形＋文字**同行，不许只染色 |
| 3 | `ux` · Feedback · **Progress Indicators**（Medium） | 「Do: Step indicators or progress bar」/「Don't: No indication of progress」 | 支持队首补进度条、排队项补"轮到还需"的步骤读数 |
| 4 | `ux` · Typography · **Font Size Scale**（Medium，前一轮命中） | 统一模数档位 | 每行要有"名称（大字）＋ 次要信息（小字）"两档，别全 11px |
| 5 | `stacks/react.csv` · Rendering · **Use keys properly**（High） | 「Use stable IDs as keys」/「Don't: Array index as key for dynamic lists」 | 现键 `skillId-queueIndex` 带下标；若做"合并同级"或行内进度动画，重排会整行重挂 ⇒ 需稳定键 |

**未命中（照实说）**：`"dense list row visual hierarchy" --domain ux`、`"grouping related list items" --domain ux`、
`"chip overflow nowrap flex shrink" --stack react` 三问 **0 命中**（后者 closest = sharing）
⇒ 这三处不引技能结论，按仓库自身约定走（§6 复刻同级相似项 ＋ §九 形状只许 SVG）。

## 3. 三个方案（我的意见：选甲）

### 甲案（推荐）＝ 修障 ＋ 每行补真实信息（不动引擎语义）

1. **修溢出**：`.app-train-pending .app-train-chip` 补 `box-sizing: border-box`。
   验收读数：chip 宽 = 容器宽 753；面板体 `scrollW = clientW`（横滚条消失）；chip 右缘 975（离面板外框 21px）。
2. **修对齐泄漏**：把队列那条的 `align-items` 明确成 `stretch`（或把末尾兜底条折叠掉重复声明），
   让信息块左对齐、按钮行可控对齐（不再"两块都居中"）。
3. **每行补信息**（全部取现成数据，`engine.ctx.skills` 的 `SkillDef` ＋ `skillQueueStatus`）：
   - 行首加**大类圆徽**：`<Glyph name={'group-'+def.group} size={15} color={toneOf('group-'+def.group)} />`
     —— 与技能树页同一个映射（`SkillsTreePage.tsx` 385/531/584 行就是这么用的），不新造图形、不新造色。
   - 名称后加**技能书名**小字（`skillBranchText(def.branch)`），必要时加大类名（`skillGroupText`）。
   - 队首加**进度条 ＋ 百分比**：复刻活动窗口「技能训练」那套 `.app-activitybar-track/.app-activitybar-fill`
     （core 已给 `percent`，目前队列页完全没用）。
   - 排队项加**「轮到还需 ≈X」**：＝ 前面所有项剩余之和（本档最长一条读数：队尾那条约 3 天 9 小时）。
     ⚠ 口径要落 core 单点（`skillQueueStatus` 的条目补 `etaMs`）+ 用例，renderer 不做结算算术。
   - 行高保持两行（信息一行、按钮一行），不加第三行 ⇒ 每行约 35→44px。
4. 不改纵向单列（2026-09-30 令）、不改按钮"在信息下方"（2026-09-25 令）、不动引擎/存档。

### 乙案 ＝ 甲案 ＋ **同一技能的连续多级折叠成一段**

- 显示成「维修工程学 Lv1→Lv5 · 5 级 · 累计 10小时12分」，本档 16 条 → 11 段。
- 代价：排序/取消的作用对象从"一条"变成"一段"⇒ 要 core 新 API（`moveQueueRun` / `dequeueRun`）＋用例，
  且"× 取消整段还是只取消首级"要船长裁定。**风险最高，建议单独一批**。

### 丙案 ＝ 只修障（1＋2），信息构成一字不动。

## 4. 风险与护栏

- §6 复刻同级相似项：徽/色调取自技能树，进度条取自活动窗口；不新造样式族。
- §九 形状只许 SVG：大类徽是既有 SVG 字形；进度条是既有 DOM 条，不用 CSS 造形。
- 颜色不能是唯一载体（技能 2）：徽是"图形 ＋ 技能书文字"双载体。
- §九之七 悬停只走 `ui/Tooltip.tsx`，同一元素只许带一个机制（若要"悬浮看这条技能说明"，用 `hoverTipProps` 一族，不叠加 `title`）。
- 一级页不滚：修完必须无横滚条（读数验收）；面板体内纵向滚动与现状一致。
- 改 `styles.css` 必跑 `npm run ui:layout-css`（会同步生成 `styles-classic.css`/`styles-modern.css`）＋ `ui:rot-check`、`ui:theme-check`、`layout-css:check`。
- 新文案走 id 表（`packages/data/src/l10n/table.ts`，zh＋en），跑 `l10n:check`/`l10n:render`/`content:check`（陈旧术语契约）。
- 已知缺口：`Glyphs.tsx` 只有 6 枚大类圆徽（舰船/工业/战斗/工程/贸易/矿业），**「探索」「物流」缺**，会落到兜底图形 ⇒ 待船长定是否顺手补两枚。

## 5. 待裁决点（已裁决 2026-09-30）

1. 选甲 / 乙 / 丙 ⇒ **甲案**（乙案单独一批，见 §3）。
2. 按钮行的横向对齐 ⇒ **仍在信息下方一行、靠右对齐**（守住 2026-09-25 令）。
3. 是否补「探索」「物流」两枚圆徽 ⇒ **不补**；行首改用技能树图标模式的六边形卡片（见 §0 第 3 条）。

## 6. 本批实现（逐条）

| 文件 | 改动 |
|---|---|
| `packages/core/src/engine.ts` | `QueueView` 补 `totalRemainingMs`；`pending[]` 补 `etaMs`（"轮到还需"＝前面所有条目剩余之和的前缀和，与总时长同一游标） |
| `packages/core/tests/queue-reorder.test.ts` | 新增一组用例：`etaMs` 前缀和、末项收口＝总时长、空队列为 0 |
| `apps/desktop/.../ui/skillTreeLayout.ts` | 抽出 `hexPathAt(cx,cy,w,h)`；`hexPath` 改为调用它（六边形算法仍只有一份） |
| `apps/desktop/.../pages/skillShared.tsx` | 队列每行重构：行首六边形徽（`QueueHexBadge`）＋技能名（12px 大字）＋技能书名（可缩）＋队首进度条与百分比＋「练这一级需 X」/「剩 X」＋「轮到还需 ≈X」；总时长改读 `view.totalRemainingMs`；行 key 由 `skillId-queueIndex` 改为 `skillId-targetLevel`（稳定键） |
| `apps/desktop/.../styles.css` | `.app-train-pending .app-train-chip` 补 `box-sizing: border-box` ＋ `align-items: stretch`；删掉文件末尾那条"面板外兜底"的 `.app-train-chip`（`align-items:center` 泄漏源）；信息行 `nowrap`＋可缩字段；按钮行 `justify-content: flex-end`；新增 `.app-train-hex*/.app-train-name/.app-train-branch/.app-train-bar/.app-train-pct/.app-train-eta` |
| `apps/desktop/.../ui/layout-css/styles-{classic,modern}.css` | `npm run ui:layout-css` 生成（同上改动） |
| `packages/data/src/l10n/table.ts` | 新增 `ui.SkillsPage.050`「轮到还需 ≈ {p1}」/「Starts in ≈ {p1}」 |

## 7. 修后验收读数（同一画布 1340×900 · 同一档 · 追加在 `skills-queue-readings-20260930.log`）

| 项 | 修前 | 修后 |
|---|---|---|
| chip 宽 / 容器宽 | 771 / 753（＋18px） | **753 / 753**（`box-sizing: border-box`） |
| chip 右缘 / 面板外框 | 993 / 996（只剩 3px） | **975 / 996**（留出 21px） |
| 面板体 clientW / scrollW | 777 / 783 ⇒ **有横向滚动条** | **777 / 777 ⇒ 无横向滚动条** |
| 每行进度元素 | 0 | 队首 **1**（240px 条 ＋ 54%）· 有承接进度的排队项各 1 |
| 每行信息段数 | 2（名称＋时长） | 5–6（六边形徽＋名称 12px＋技能书名＋进度/时长＋轮到还需） |
| 「轮到还需」自洽 | — | 第 3 位＝**11小时12分54秒** ＝ 队首剩余 4小时36分6秒 ＋ 第 2 位本级 6小时36分48秒 ✅ |
| 按钮行 | 居中（左缘 578–624） | **靠右**（左缘 907–953，`×` 收在内容右缘 966） |
| 行高 / 面板体可视高 | 35 / 591（scrollH 674） | 45 / 599（scrollH 834 ⇒ 面板体内纵向滚动，与修前同一手法；一级页本身不滚） |

⚠ 以上全是**读数**；「好不好看」由船长判（§六）。

## 8. 追加批：队列「置顶无效」排查 ＋ 修法（同日 · 船长裁定甲）

**船长原话**：
> 「我发现部分技能在队列中置顶无效，进行下排查」

**排查读数**（日志 `tools/_ui-artifacts/queue-pin-readings-20260930.log`；探针 `tools/_probe-queue-pin.mts`）——
两种机制，都不是"按钮坏了"：

1. **顺序契约挡下 ＋ 完全静默**（`moveQueueItem` 传 catalog 时校验"没有哪一项排在它要的前置之前"，
   破了整单回滚返回 false；界面 `onClick` 丢弃返回值、`moveQueueAt` 只在成功时 notify）⇒ 玩家点 ⇈/↑
   **毫无反馈**。复现（真实入口 `planPrereqChain`＋`enqueueSkill`）：`舰船操控学→Lv1 | 导航学→Lv1`，
   对导航学置顶 ⇒ 返回 false，界面无提示。
2. **同技能多级按位置重算等级**⇒ 点哪条都一样：本档 维修工程学 5 条、工业理论 2 条，
   第 13/14/15/16 位的 ⇈ 与第 12 位**逐字相同**；相邻同级互换（`[A Lv1, A Lv2]` 点第 2 条 ⇈/↑）
   **返回 true 但队列逐项没变**。

**修法（甲案）**：core 出纯计划 `queueMovePlan(state, from, to, catalog)`（与 `moveQueueItem` 同一套判据：
`reorderQueue` ＋ `firstOrderBlocker` 单点），界面据此**置灰 ＋ 说明原因**，点了就地讲清楚。

| 文件 | 改动 |
|---|---|
| `packages/core/src/engine.ts` | 抽出 `firstOrderBlocker`（`queueOrderOk` 与计划共用）· `queueHeadProgress` / `reorderQueue`（`moveQueueItem` 改为"先算新队列、校验通过才写回"，不再需要整单还原）· 新增 `queueMovePlan` ＋ `QueueMovePlan` |
| `packages/core/src/index.ts` | 导出 `queueMovePlan` / `QueueMovePlan` |
| `packages/core/tests/queue-reorder.test.ts` | 新增一组用例：契约挡住（带 p1/p2/p3 卡点）· 挪了等于没挪（并断言队列逐项不变）· 挪得动时计划与引擎一致 · 越界不抛错 |
| `apps/desktop/.../pages/skillShared.tsx` | 三个箭头先问 `queueMovePlan`：`aria-disabled` ＋ `.is-off` 置灰 ＋ `title` 写明原因；点了在**那一行底下**就地显示原因（`.app-train-note`）；`↑/↓/⇈` 与队首 `↓` 一并改（原"队尾 ↓ 用原生 disabled ⇒ title 永远弹不出来"的毛病一并修掉） |
| `apps/desktop/.../styles.css` | `.app-train-arrow.is-off`（与 `:disabled` 同长相）· 悬停高亮排除 `.is-off` · 新增 `.app-train-note`（警示色小字，写在行内） |
| `apps/desktop/.../ui/layout-css/styles-{classic,modern}.css` | `npm run ui:layout-css` 生成 |
| `packages/data/src/l10n/table.ts` | `core.engine.022`（挪不过去：…需 Lv{p2}，当前只有 Lv{p3}）· `core.engine.023`（挪了等于没挪）· `core.engine.024`（越界）· `ui.SkillsPage.051`（兜底说明） |

**验收读数**（1340×900 · 造出"前置在前、目标在后"的 17 条队列；日志 `queue-pin-ui-readings-20260930.log`）：

| 项 | 读数 |
|---|---|
| 箭头总数 / 置灰数 | 49 / **14** |
| 「挪不过去」样例 | 「星质地质学 需 Lv1，当前只有 Lv0。」（该行 ⇈/↑/↓ 三个一起挡下——↓ 也会让后一条排在它的前置之前） |
| 「挪了等于没挪」样例 | 「同一技能在队列里按位置逐级排，这一步与它前一条等价。」 |
| 队尾 ↓ / 末行 ↑ | 置灰：`已在队尾` / `挪了等于没挪` |
| 点"挪不过去"的 ⇈ | 说明出现在**被点那一行内**，且落在面板可视区内（说明顶 533 ∈ 面板体 294–893） |
| 无需挡下的行 | 末行 ⇈ 仍可点（`off=false`）——置灰只针对真挪不动的 |



