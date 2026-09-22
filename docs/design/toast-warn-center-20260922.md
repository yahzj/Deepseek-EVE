# 浮动提示分档：警告居中 · 普通回屏幕下方（2026-09-22 船长令）

> **状态：进行中**（已落码 · 四闸门自测全绿 · **观感待船长验收**；按 §8，归档时并入 roadmap 与约定 §九）
>
> **船长原话（照抄）**：「**将警告提示和普通提示做出区分。普通提示位于原本的屏幕下方（比如拾取提示这类），
> 警告类的位于屏幕中间。**」

## 一、改了什么（一处 CSS，两档分流）

`apps/desktop/src/renderer/src/styles.css` 的 `.app-toast`：

| 档 | 判定（既有 `warn` 形参） | 位置 | 描边 |
|---|---|---|---|
| **普通提示** | `onToast(text)` / `warn = false`（拾取、装载、装配、停炉、停止开采…这类"事情办成了"） | **屏幕下方** `bottom: 26px` + `translateX(-50%)`（**回到 09-20 之前那一档**） | 青 `--wui-accent` |
| **警告类** | `onToast(text, true)`（`cmdText(r)` 报错/被拒、会中断或有代价的警告、`engine.onSystemNotice` 系统通知） | **屏幕正中** `top: 50%` + `translate(-50%, -50%)` | 红 `--wui-red` |

- **与旧裁定的关系**：2026-09-20 船长曾令「先将错误提示移动到屏幕中间」⇒ 当时**两档都居中**；
  本轮按新口径**拆开**——普通提示回底部、警告保持居中。旧那句的"一律居中"作废（新裁定写在 CSS 注释里）。
- **不动**：自动隐藏 3.2s · 整条可点关闭 · `z-index: 200`（在通用弹层 120 / 战斗画面 100 之上、
  手机选择器 320 之下）· 底色/内边距/字号/圆角/阴影 · `.app-event-toast`（随机事件小弹卡，仍在 `bottom: 78px`，
  与回到底部的普通提示**上下不重叠**：26px 档 ≈ 26–58px，事件卡 ≥ 78px）。
- **不会同屏**：`App.tsx` 只有一个 `toast` 槽（后来的顶掉前一条）⇒ 不存在两档互挤的问题。

## 二、为什么不新增开关 / 不改调用点

`ToastFn` 的第二个形参 `warn?: boolean` 本来就是"警告/普通"的分档（全渲染层 105 处调用点都按它分流），
本轮**只把两档的落点分开**：调用点、文案 id、交互（点击关闭）一律不动 ⇒ 零回归面。

判定抽查（普通档落底部的都是"操作成功/拾取"类）：
`CargoPage`（装载/卸货）· `ItemsPage`（拾取入库/出售）· `FitPage`（装配/卸下）· `IndustryPage`（停炉/停线）·
`MapPage`（停止开采）· `CommsPage`（全部已读）等；警告档 = 所有 `cmdText(r) || … , true` 的失败回执 ＋ 首击警告
（长途运输那套）＋ 未解锁页面提示 ＋ 引擎系统通知。

## 三、自测读数（2026-09-22 · 观感结论归船长）

- `npm run typecheck` 0 错 · `npm run test -w @whale/core` **182 文件 / 2073 例全绿**；
- `npm run ui:rot-check` ✅（旋转模式那条 `max-width: min(560px, calc(100vh - 40px))` 照旧生效；
  本轮没有新增按物理单位定尺寸的声明）；
- `npm run content:check` ✅ · `npm run l10n:check` ✅ · `npm run build` ✅；
- **读数（非观感）**：构建产物 `apps/desktop/out/renderer/assets/index-*.css` 里已含
  `.app-toast { bottom: 26px; transform: translateX(-50%) }` 与 `.app-toast.is-warn { top: 50%; bottom: auto;
  transform: translate(-50%, -50%) }` 两条；普通提示与随机事件小弹卡在纵向不重叠（26px vs 78px）。
- ⚠ **观感（位置是否合适、要不要给警告档再加权重）由船长验收**；若要在警告档加图标/加粗/投影，
  说一句即可（本轮刻意没自造新样式，见约定 §六）。

## 四、归档时要做（备忘）

1. `docs/development-conventions.md` §九（UI）补一条「浮动提示两档落点：普通=屏幕下方、警告=屏幕正中」；
2. `docs/roadmap.md` 记一条（与本批"第一次任务回写"同批推送时一起）；
3. 删本件 → `npm run docs:index`。
