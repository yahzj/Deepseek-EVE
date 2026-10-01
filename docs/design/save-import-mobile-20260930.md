# 网页版「导入存档」手机端修复（2026-09-30 · 三号）

**状态：已实现·自测全绿·待合并**（UC 真机复测要请那位玩家再试一次，见 §5）

## 0. 船长原话（照抄）

> 「玩家反应，手机UC浏览器，只能导出存档，不能导入」

（处置裁定）「**文本粘贴就不要了，其他按你推荐**」⇒ 只做最小修（§3 那四条），**不加**文本粘贴通道。

## 1. 现状读数（修复前 · 无头 Chrome ＋ 安卓/UC UA ＋ 触屏仿真）

探针 `tools/_probe-import-input.mts`（挂钩 `HTMLInputElement.prototype.click`，记录被点的 file input 现场）：

```
打开存档管理 = true · 点到「导入存档…」= true
file input 被 click 的现场：[{ 在文档里: false, 父节点: null, accept: ".json,application/json" }]
界面反应（toast）：（无）
```

⇒ **三条根因**（都是读数，不是猜）：

| # | 根因 | 后果 |
|---|---|---|
| ① | **`<input type=file>` 从来没挂进文档**（`isConnected = false` / `parentElement = null`；代码里还留着 `input.remove()`，说明当时以为挂上了） | 桌面 Chromium 肯为游离节点弹选择器；**Android 的 UC / QQ / 微信这类内置内核普遍不肯** ⇒ 点了什么也不发生 |
| ② | `accept` 太窄（`.json,application/json`） | 安卓选择器常按 **MIME** 过滤，而手机上保存的存档 MIME 往往是 `application/octet-stream` 或空 ⇒ 文件在选择器里**灰掉**、选不中 |
| ③ | 判"取消"**只挂在 `focus` / 可见性回来**上，且宽限只有 2.1 秒 | 选择器**没弹**时这两个事件一个都不来 ⇒ **promise 永远不 resolve、界面一直 busy** ⇒ 彻底没动静；选择器**弹了**时手机从"文件"App/云盘翻档常超 2 秒 ⇒ 选了也白选（`done` 一置位，真 `change` 被挡） |

对照：导出走 `navigator.share`（手机上的可靠通道）⇒ 正好解释玩家说的「只能导出、不能导入」。

## 2. 技能依据（`ui-ux-pro-max` 现场检索原文）

- `ux` · Accessibility · **Dragging Movements**（High，WCAG 2.2 AA）：「requires a **single-pointer
  alternative** for author-controlled drag operations」/「Don't: **Make dragging the only way** to reorder
  resize or select」⇒ 原则＝**不能只有一条输入通道**。⚠ 如实标注：它讲拖拽，属**同类原则、非逐字命中**。
- `ux` · Forms/Accessibility · **Focusable Error Summary**（High）：「An error summary for failed validation …
  must be easy to find by keyboard and screen reader users；Don't: Replace inline errors with a
  visual-only summary」⇒ 失败/取消要**看得见的交代**，不能只有静默。
- （`file upload paste fallback` 那句查询 **0 命中**，照实说。）

## 3. 实现（四条，全在 `pickImportSave`）

| # | 改法 |
|---|---|
| ① | input **挂进 `<body>`** 再点（`position:fixed; left:-9999px; 1×1px; opacity:0`，**不用 `display:none`**：个别内核把 display:none 的 input 也当不可交互），`finish` 时移除 |
| ② | `accept` 放宽为 `.json,application/json,text/plain,application/octet-stream,*/*`（末尾通配兜底） |
| ③ | **取消宽限按环境分开**：`touchLike()`（`navigator.maxTouchPoints > 0` 或 `matchMedia('(hover: none)')`，无 UA 嗅探）⇒ 触屏 **8 秒**、桌面 2.1 秒；仍只在焦点/可见性回来后才开始计时（选择器开着不该计时） |
| ④ | **看门狗**：点下去后 **3.5 秒**内页面**既没失焦也没隐藏**（正常弹选择器时窗口必然 blur / 页面必然 hidden）⇒ 判"没弹出来"，按取消返回（不再永久 hang） |

界面侧（`panels/SaveManager.tsx`）：取消**不再静默** ⇒ 弹一条**可操作**的可见提示
（`ui.SaveManager.031`：「没有读到存档文件。若刚才没有弹出文件选择器（部分手机浏览器的内置内核不支持），
请用系统自带浏览器打开本页再试一次。」）。⚠ 真取消与"没弹出来"无法区分，故这句两种情况都说得通并给出路。

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/renderer/src/game/storage.ts` | 上面四条 ＋ `touchLike()` 小工具；注释记明三次报障的来龙去脉 |
| `apps/desktop/src/renderer/src/panels/SaveManager.tsx` | `handleImport` 的取消分支改成给可见提示 |
| `packages/data/src/l10n/table.ts` | 新增 `ui.SaveManager.031`（zh＋en） |

**不动**：存档格式、`save.ts`、导入链的校验与离线补齐（`engine.importSaveFromFile` 一字未改）。

## 4. 验收读数（修复后 · 同一环境）

探针 `tools/_probe-import-input.mts` ＋ `tools/_probe-import-e2e.mts`；日志
`tools/_ui-artifacts/import-input-readings-20260930.log`

| 项 | 读数 |
|---|---|
| ① input 现场 | `{ 在文档里: **true**, 父节点: **BODY**, accept: ".json,application/json,text/plain,application/octet-stream,**\*/\***", 可见: "0" }` |
| ② 端到端导入 | 用 CDP `DOM.setFileInputFiles` 真喂一份哨兵档（信用点 = 123,456,789）⇒ 顶栏信用点由 166,003,585 变成 **123,456,789** ✅ 并弹「已从所选文件导入存档（未备份原档…）」 |
| ③ 没弹选择器 | 不再 hang：**3.6 秒**时出现可见提示「没有读到存档文件。若刚才没有弹出文件选择器…」；6.9 秒随 toast 生命周期自动消失（时间线实测：404ms 无 → 3637ms 有 → 6862ms 无） |

闸门：typecheck ✅ · content:check ✅ · l10n:check ✅ · ui:rot-check ✅ · web＋desktop 构建 ✅
（本批不碰 `save.ts`，提交钩子正常放行）。

## 5. 诚实边界（不许含糊）

- 我这台机器上**没有 UC 浏览器**，因此我能给的证据是：**根因读数**（修复前 `isConnected = false`）＋
  无头 Chrome 里的**端到端导入读数**（哨兵档真的换档成功）＋ 静态复核（input 已挂进 DOM、accept 已放宽、
  看门狗有交代）。**真机 UC 是否恢复，要请那位玩家再试一次** —— 我不替他下结论。
- 兼容性取舍：看门狗 3.5 秒取的是"个别机器 blur 慢一点也不误判"的余量；万一某平台弹了选择器却既不 blur
  也不 hidden（罕见），会误判成取消并给提示——玩家重试一次即可，比"永远没动静"好。

## 6. 挂账

- **文本粘贴导入**：船长 2026-09-30 明确「**文本粘贴就不要了**」⇒ 不做（已登记：若将来仍有内置浏览器
  连文件选择器都不给，这是最后一条兜底路）。
