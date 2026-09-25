# 调试模式「只有本地开启、发布版关闭且隐藏」（2026-09-25）

状态：**已实现 · 待船长验收**（**未推送** —— 船长令「先不要推送」）
船长原话（照抄）：
- 「**推送前关闭设置里的调试模式开关**」
- （我问"您指的是撤掉这一行、还是确认默认是关的"后）「**是否可以设置只有本地开启，上传后的版本都是关闭隐藏的**」
- 「**你先完成设置的改动**」

## 一、口径

| | 本机（开发 / 内网联调） | 发布版 |
| --- | --- | --- |
| 设置页「调试模式」那一行 | **渲染**（可开可关） | **不渲染** |
| 顶栏「⇄ 调试」「⏱ 性能」 | 开关打开后出现 | **永不出现**（手动置标志也不生效） |
| 性能采集（`perfAutoEnabled`） | 同上 | 恒关 |
| 虫洞入口 / 调试导航项（走 `debugEnabled`） | 同上 | 恒关 |

**「本机」判据**（`@whale/core` 的 `isLocalDebugOrigin`，**失败即关**）：
- 协议必须是 `http:` / `https:` —— `file:` 等**非 http 协议一律按发布版**（桌面打包版就是这一类）；
- 宿主算本机的只有：`localhost` · `127.0.0.1` · `::1` · `*.local` · **内网 IPv4**（`10.x` / `172.16~31.x` / `192.168.x`）。
  ⚠ 留内网是**故意的**：船长要用手机连电脑的内网地址测网页版，手机上正是靠它才看得见虫洞等调试入口。
- 公网域名、公网 IP、非 `127.0.0.1` 的环回（如 `127.0.0.2`）、空值 ⇒ 一律 false。

**同产物、不改构建流程**：判定在运行时做 ⇒ 不存在"忘了切发布模式"的风险（发布版就是同一份 `dist`）。

## 二、实现

- **新增** `packages/core/src/debugGate.ts`：纯判定 `isLocalDebugOrigin(protocol, hostname)`（不碰 `location`/`localStorage` ⇒ 可单测）。
- **新增** `packages/core/tests/debug-gate.test.ts`：判定表 5 组（本机 / 内网 / 公网与边界 / 非 http 协议 / 空值）。
- **新增** `apps/desktop/src/renderer/src/game/debugFlag.ts`：本机门禁 ∧ 标志位 ——
  `debugAllowed()`（本机判定）· `debugEnabled()`（**发布版恒 false**）· `setDebugEnabled()`。
- **改** `panels/DebugPanel.tsx`：只做转发（`export { debugAllowed, debugEnabled, setDebugEnabled } from '../game/debugFlag'`）
  ⇒ 既有调用点（`Expedition` 等）的 import 一条都不用改。
- **改** `App.tsx`：设置页那一行改成 `debugAllowed() ? (…行…) : null`。
- **改** `game/perf.ts`：`perfAutoEnabled()` 从"裸读 localStorage"改为走 `debugEnabled()` ⇒ 发布版不再可能被一行手写 localStorage 悄悄打开采集。

## 三、实测读数（同一份产物、只换 origin；无头 Chrome 1280×800）

| origin | `whale-idle:debug` | 设置页那一行 | 顶栏「⇄ 调试」 | 顶栏「⏱ 性能」 |
| --- | --- | --- | --- | --- |
| `localhost:4199`（本机） | 空 | **存在**（按钮「开启」） | 无 | 无 |
| `localhost:4199`（本机） | 手动置 `1` | **存在**（按钮「已开启」） | **有** | **有** |
| `127.0.0.2:4198`（非本机） | 空 | **不渲染** | 无 | 无 |
| `127.0.0.2:4198`（非本机） | 手动置 `1` | **不渲染** | **无** | **无** |

（`127.0.0.2` 是环回但不是 `127.0.0.1` ⇒ 正好用来在本机演"发布版"这条路径。）

## 四、涉及文件

**新增**：`packages/core/src/debugGate.ts` · `packages/core/tests/debug-gate.test.ts` · `apps/desktop/src/renderer/src/game/debugFlag.ts`
**修改**：`packages/core/src/index.ts`（导出门禁）· `apps/desktop/src/renderer/src/panels/DebugPanel.tsx`（改转发）· `apps/desktop/src/renderer/src/App.tsx`（设置行条件渲染）· `apps/desktop/src/renderer/src/game/perf.ts`（采集开关收口）
**未改**：样式一条没动（不需要 `ui:layout-css`）；文案表不动（那四条文案本机仍在用）。

## 五、验证

- `typecheck`（4 包）· 新增用例 5 条通过 · `content:check` · `ui:rot-check` · `ui:theme-check` · `l10n:check` · `build`。
- 上表四条读数（读数不是观感结论）。

## 六、边界与已知取舍

- **内网 IP 也算本机**：为船长手机测网页版保留（否则手机上虫洞等入口全没了）。代价：局域网自建同乐场景下调试模式也可用 —— 公网发布不受影响。
- **桌面打包版（`file:`）算发布版**：开发时用 `npm run dev`（走 `localhost`）仍有调试模式；打包给玩家的产物没有。
- **存档里的 `debugQuick`（1 秒化）不在本门禁范围内**：它是存档里的另一个开关（默认 false），入口在调试面板里 ⇒ 发布版够不到；但**开发机上的老档若留着 `true`，读档后仍会 1 秒化**（换档/清档即恢复）。
- 设置页那一行在发布版**整行不渲染**（不是禁用），l10n 里那四条文案在发布版属于"表里有、源码那处不渲染"——`l10n:check` 按"源码仍引用"处理，不报未接线。
