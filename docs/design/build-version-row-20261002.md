# 设置页「客户端版本」那一行（构建时注入 · 只读 ＋ 一键复制）

- **状态**：进行中（实现完成 · 本批闸门与构建读数见 §四；等船长验收观感）
- **船长令**：**「版本号可以落码」**（＝批准我递上去的文案草稿与方案）
- **船长原话（照抄）**：

  > 「**建议在设置里给游戏添加版本号，否则无法判断玩家当前版本**」

- **三问裁定（船长）**：① 值 = **版本号 · 构建 sha · 构建日期 · 运行形态**；② 本批**只做显示**
  （「发现新版本 ⇒ 提示刷新」留下一批）；③ 命名「**客户端版本**」＋ **放设置页最上方**。
- **本批落点（模块自报 §2.1）**：**界面与设置**（另加两处**构建配置**与一个构建期小工具，属工程侧、
  不计业务域）。**参照的同类子模块**：设置面板里既有的只读行（语言 / 界面布局 / 取用来源）＋
  性能 HUD 的「复制报告」那套剪贴板写法（连同 `document.execCommand('copy')` 兜底）。**是否跨域**：**否**。

## 一、为什么值要带"构建 sha/日期"（而不只是版本号）

玩家报障时最常见的"版本对不上"是**网页版被浏览器缓存住旧产物**：同一个 `0.1.0` 底下已经有很多次
构建，光看版本号判不出他到底刷没刷新。带上构建 sha ＋ 构建日期才能一眼分辨；运行形态（网页版/桌面版）
则省掉"你用的是哪个版本的游戏"这一问。

## 二、值从哪来（构建时注入 · 单点）

`tools/build-info.ts` 是**唯一注入点**，两套构建各写一句 `define: buildInfoDefine()`：
`web/vite.config.ts`（GitHub Pages 那条）＋ `apps/desktop/electron.vite.config.ts`（renderer 段）。

| 项 | 取法 | 缺省 |
|---|---|---|
| 版本号 | `apps/desktop/package.json` 的 `version`（`release.yml` 头注本来就要求它与发布 tag 一致 ⇒ 唯一权威现成，不另立版本文件） | `0.0.0` |
| sha | CI 的 `GITHUB_SHA`（Actions 默认注入，**不用改工作流**），本地回落 `git rev-parse --short HEAD`（7 位） | `dev` |
| 时间 | 构建时刻，**固定按 UTC+8 记**（本地构建是本地时区、CI 是 UTC —— 不钉死时区会为同一次构建写出两个戳） | `—` |

渲染层读法 = `apps/desktop/src/renderer/src/game/buildInfo.ts`（`BUILD` ＋ `BUILD_FORM`，
三个值都带 `typeof` 兜底 ⇒ 构建器没注入也照常显示、不炸）。**运行形态**判据 = 有没有
`window.whale`（Electron 预加载的安全桥）：有 = 桌面版，没有 = 网页版。

## 三、界面与文案

设置面板**最上方**新增一行（沿用既有 `.app-settings-row` 结构：标签 ＋ 只读值 ＋ 按钮 ＋ 小字说明）：

```
客户端版本        0.1.0 · 构建 2026-10-03 08:28 · eebd614d · 桌面版      [复制]
这一行标明当前运行的版本；反馈问题时请一并提供。
```

**文案台账**（whale-copy §2.7；新写文案**先经船长批准**才落码 —— 草稿已在汇报里递审、船长回
「版本号可以落码」）：

| id | 中文 | English | 依据 |
|---|---|---|---|
| `ui.App.168` | 客户端版本 | Client version | 船长令；避开游戏内已有的「版本号」（**铁人档世代号**） |
| `ui.App.169` | {p1} · 构建 {p2} · {p3} · {p4} | {p1} · built {p2} · {p3} · {p4} | 同上（四槽 = 版本 / 时间 / sha / 形态） |
| `ui.App.170` | 这一行标明当前运行的版本；反馈问题时请一并提供。 | This line shows the version currently running; include it when reporting a problem. | 同上 |
| `ui.App.171` | 复制 | Copy | 同上 |
| `ui.App.172` / `.173` | 网页版 / 桌面版 | Web / Desktop | 同上 |

复制成功的提示**复用现成的 `ui.App.044`「✓ 已复制」**（不新造同义串）。

## 四、涉及文件与验证

- **新增**：`tools/build-info.ts`（注入单点）· `apps/desktop/src/renderer/src/game/buildInfo.ts`（读取口）·
  本工作文档。
- **修改**：`web/vite.config.ts` ＋ `apps/desktop/electron.vite.config.ts`（各加 `define`）·
  `apps/desktop/src/renderer/src/env.d.ts`（三个 `declare const`）·
  `apps/desktop/src/renderer/src/panels/appSettings.tsx`（最上方那一行 ＋ 复制处理）·
  `packages/data/src/l10n/table.ts`（6 条新 id）。
- **不做**（本批边界）：**不做**「发现新版本 ⇒ 提示刷新」（船长选"留下一批"）；**不动**存档结构；
  **不动**发布流程与工作流文件。

**验证读数**（构建产物里真的注入了 —— 这是"接线没接错"的硬证据）：

```
桌面产物 apps/desktop/out/renderer/assets/index-ClPjSj16.js：
  const BUILD = { version: "0.1.0", sha: "eebd614d", time: "2026-10-03 08:28" };
  const BUILD_FORM = typeof window !== "undefined" && wi…
网页产物 web/dist/assets/index-dQ4Y-JoA.js：
  const av={version:"0.1.0",sha:"eebd614d",time:"2026-10-03 08:28"},qme=typeof window<"u"&&wi…
```

其余闸门：`typecheck`（四包 0 错）· `l10n:check`（无死引用 / 占位符对齐 ⇒ 6 条新 id 都被真正引用）·
`l10n:params` · `content:check` · `ui:rot-check` · `ui:layout-css:check`（样式未动）· `arch:guard`
（F1~F9 零处）· 桌面 `npm run build` ＋ 网页 `web && npm run build` 双双成功。
⚠ 渲染层没有用例脚手架（全仓现状）⇒ 这一行的断言走"构建产物 grep ＋ 五个闸门 ＋ 两套构建成功"，
**观感（够不够醒目、位置顺不顺眼）留船长看本地构建**。
