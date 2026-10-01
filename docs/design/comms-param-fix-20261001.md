# 文案占位符漏出两处（工作文档）

- **状态：进行中**（2026-10-01 开工；根因已定位、修复已落地、闸门已跑，待船长验收与合入）
- 经办：三号（worktree `Deepseek-EVE-verify`，分支 `verify`）
- 归档时：关键结论并入 `docs/roadmap.md` 一条精简条目后删除本文件（§十五 文档工作流）

## 1. 船长原话（照抄）

> 「关于前几轮的「工业通报：黑匣可以换舰船插件了」，本地存档显示的是'{p1} ×{p2}'」
> 「顺便检查下随机事件，我在部分随机事件中依旧看到了这个」

## 2. 现象与根因（两条独立缺陷，同一类病根）

**病根共性**：带 `{pN}` 的**模板**被"不会喂参数"的渲染点用掉了 —— `interpolate()` 找不到键就**原样保留** `{pN}`，
玩家直接读到占位符（静默失败）。

### ① 通讯主题行（船长报的这条）

- **落点**：`apps/desktop/src/renderer/src/ui/commsText.ts` 的 `COMMS_SUBJECT_ID['msg-blackbox-plug-unlock'] = 'ui.comms.072'`。
- **根因**：`ui.comms.072` 是**奖励清单的模板**（`{p1} ×{p2}`，由 `commsRewardText()` 喂两个参数），
  而 `COMMS_SUBJECT_ID` 是**静态·无参**映射表 —— `commsSubjectText()` 对它只做 `tr(l10nId)`（不喂参）⇒ 主题行原样印出 `{p1} ×{p2}`。
- **引入**：我（三号）2026-09-30 本地化批（提交 `b3157736`）登记这张映射时挂错了 id。
- **为什么此前没被拦住**：`l10n:params` 只扫 `tr('字面量')` 形态，**看不见"映射表的值"**（`tr(l10nId)`）——本批给工具补了判据。

### ② 插件日志（查"随机事件里的那个"时扫出来的第二处）

- **落点**：`packages/core/src/plugs.ts:155` 的 `addLog(..., 'core.plug.001', { p1: def.name })`。
- **根因**：`core.plug.001` 的模板要 **p1/p2** 两个槽（`已为 {p1} 装上插件：{p2}。`），调用点只喂了 `p1` ⇒ `{p2}` 原样漏出。
- **引入**：插件批提交 `bdc214a0`（2026-09-27 前后）；那批的 `text` 把**船名写进了正文**、模板的 `p2` 便一直没人喂。
- **玩家看到**：装插件那一刻的日志/弹卡「已为 「XX」装上插件：{p2}。插件装上后无法拆下。」
- **是不是"随机事件"**：核过 `events.ts` 的全部 9 个 `logEvent` 调用点（含 `.084~.090` 五条带槽模板）**参数都齐**，
  随机事件模块本身没有漏参 ⇒ 船长看到的极可能就是这条**装插件日志**（它与随机事件同走日志区/小弹卡），或①那条通讯。

## 3. 全仓普查（探针 `tools/_probe-param-usage.mts`，一次性）

三条判据一次扫全仓 **231 个源码文件 / 4,875 条 l10n**：

| 判据 | 结果 |
|---|---|
| A · `Record<string,string>` 映射表的值指向**带参模板** | **1 处**：就是上面①（`COMMS_SUBJECT_ID → ui.comms.072`）—— 修后应归零 |
| B · core/data 里 `addLog` / `logEvent` 的 id 与参数对账 | 13 处命中：**1 处实缺**（②`core.plug.001` 缺 p2）· 12 处为**展开语法/变量传参**（逐条看过形状，键都齐，属静态判不出的正常写法） |
| C · 通讯正文表（`COMMS_BODY_EN`）与数据侧 msg id 对账 | 正文表多 13 键（`first-*` 系列在 `firstTaskMessages.ts`，不在本对账范围）· **数据侧缺英文覆盖 0 条** |

## 4. 修复清单

| 文件 | 改动 |
|---|---|
| `packages/data/src/l10n/table.ts` | 新增 `ui.comms.079`（首匣通讯主题行，中英齐）；`ui.comms.072` 回归本职（奖励清单模板），一字未动 |
| `apps/desktop/src/renderer/src/ui/commsText.ts` | `COMMS_SUBJECT_ID['msg-blackbox-plug-unlock']`：`ui.comms.072` → `ui.comms.079`（带 `⟪文案调整 2026-10-01⟫` 记号） |
| `packages/core/src/plugs.ts` | 装插件日志补喂 `p2`（插件名）；正文只留船名（原先正文把船名与插件名都写进去了，补参后会重复） |
| 同上（数据侧 `text`） | 与模板对齐：「已为「XX」装上插件：YY。插件装上后无法拆下。」（引擎日志兜底串，测试引用它） |

## 5. 验证

- `npx tsx tools/_probe-param-usage.mts`：A 判据 0 处 · B 判据实缺 0 处。
- `npm run l10n:check` / `l10n:params` / `content:check` / `typecheck` / `test -w @whale/core` 全绿（读数见汇报）。
- `tools/_probe-comms-subject.mts` 与 `tools/_probe-param-usage.mts` 为**一次性探针**：留一条（B 判据有复用价值，建议转正进 `l10n:params`），其余收尾删除。

## 6. ⟪文案调整台账⟫（§十三）

| 日期 | id / 位置 | 原 → 新 | 依据 |
|---|---|---|---|
| 2026-10-01 | `msg-blackbox-plug-unlock` 主题行（`commsText.ts` 的 `COMMS_SUBJECT_ID`） | 错挂 `ui.comms.072`（奖励清单模板）→ 新 id `ui.comms.079`「工业通报：黑匣可以换舰船插件了」 | 船长报障（§1） |
| 2026-10-01 | `core.plug.001`（装插件日志） | 模板要 p2 却没人喂 ⇒ 补喂插件名；正文去掉重复的插件名 | 船长报障（§1）＋ 探针 B 判据 |

## 7. 待裁决点

1. `core.plug.001` 的**措辞**：现行模板「已为 {p1} 装上插件：{p2}。插件装上后无法拆下。」在补参后完全成立，
   我按此对齐了数据侧兜底串；若你要更短的说法（如「{p1} 已装上插件 {p2}，装上后无法拆下。」），说一声。
2. 是否把探针 B 判据**转正**进 `npm run l10n:params`（能拦住同类病根，但要处理 12 处展开写法的白名单）。
