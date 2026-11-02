# 设置界面四项报障修复（字号 / 配色 / 宇宙背景 / 选中按钮）· 2026-11-02

> 状态：施工中，待船长验收（本地未提交）
> 归档契约：遵守 `AGENTS.md` §8 与开发约定 §十五；船长验收并合入 main 后把关键结论并入现行文档、本文件移入 `docs/design/archive/`。

---

## 一、船长原话（照抄）

> 「这个项目的 设置界面中， 字体大小的调节是没有用的，修复一下。还有 界面配色 除了深空之外的很多颜色都是错的，这个需要修复。在界面布局是科幻未来的情况下，宇宙背景看不见了。这个也要修复。界面布局中，选中科幻未来，这个按钮会变成彩虹流动的颜色。你开始修吧。」

> 「你开一个子代理并行去做一个事：增加一个字体选择的功能在设置界面，就在字体大小那个地方放置在他下方。然后把字体“D:\Downloads\unifont-18.0.01 (1).otf”嵌入到项目里，作为可选字体之一。这个字体是GNU授权，记得在设置的最最下方增加一个许可按钮把这些授权书内容统统都写进入。这两个事情互相不打扰的，派完任务，你继续干你的活。」

---

## 二、范围与不做（Boundary）

### 做（In Scope）
1. 设置「字体大小」真正生效（含重启后保持）。
2. 界面配色六套中除深空外的其它五套在「科幻未来」布局下颜色正确（随主题走）。
3. 「科幻未来」布局下宇宙背景（`--space-bg`）恢复可见。
4. 「界面布局」里被选中的「科幻未来」按钮不再是渐变/光晕四层叠加的"彩虹流动"观感，改为克制的主题色平涂。
5. 子代理并行交付：设置「字体大小」下方新增「界面字体」（默认系统字体 / 内嵌 GNU Unifont 18.0.01）；
   设置最底部新增「许可与授权」按钮，弹窗列出 GNU Unifont 授权全文与项目许可声明。

### 不做（Out of Scope）
1. 不改任何**已发布**玩家文案；字体大小行的说明句仍是旧文（"85%~125%"与实际上限 150% 的历史口径差，
   属既有问题，未经文案授权不动，已在「待裁决」里记一笔）。
2. 不重做科幻未来的视觉体系（本轮只修四类"错误"，不改船长已验收的天青航电风格）。
3. 不动并行会话在途的文件（声音系统 `sfx.ts` / `audio/` / `SfxConsole.tsx`、l10n 英文准备）；
   本批只落 UI 域（样式 / 设置面板 / 字体模块 / 主题令牌）。

---

## 三、四类病根与处方

### 1. 字体大小调节无效
- **病根 A（覆盖面）**：2026-09-05 首版只让 6 个类（`.app-inv-*` / `.app-sr-*` / `.app-chip` / `.app-btn`）
  自己乘 `--ui-fs`，其余 200+ 处 `font-size: var(--wui-fs-*)` 一动不动 ⇒ 拖滑块几乎看不出变化。
- **病根 B（启动不应用）**：`--ui-fs` 只在**设置面板挂载时**写到 `.app-root` 上；重启/刷新后不应用，
  且写在 `.app-root` 上时字阶令牌（声明在 `:root`）解析不到该变量。
- **处方**：
  - `packages/ui/src/index.css` 的 18 档字阶改为 `calc(Npx * var(--ui-fs, 1))`（字阶自身即缩放基准）；
  - 调用点不再自乘 `--ui-fs`（styles.css 27 处 `calc(...)` 拆掉，避免叠成平方影响）；
  - 新增 `ui/uiScale.ts`（读/写/钳制单点），`game/boot.ts` 的 `prebootRenderer()` 启动即应用
    `--ui-fs` 到 `<html>`；设置面板拖动仍即时写同一处；
  - `--app-head-fs` 同步吃系数；新版 HUD 块与 `_hud-industry.css` 里的固定 px 字号全部换字阶令牌。

### 2. 除深空外的配色错误
- **病根**：2026-11-02「科幻未来」视觉重塑把 392 处颜色写成 hex/rgba 字面量（天青 + 近黑面板），
  `ui:theme-check` 的 ④ 字面量闸门因此一直红着；切换亮白/高对比/暖色/纯黑/色盲时 HUD 区块仍钉死深空色
  ⇒ 半明半暗、整体错色。
- **处方**：新增 20 个 **HUD 语义令牌**（`--wui-hud-primary` / `-hover` / `-active` / `-ok` / `-warn` /
  `-warn-soft` / `-gold` / `-danger` / `-accent` / `-text*` 四档 / `-ink` / `-bg-base` / `-surface*` 四档），
  在 `packages/ui/src/index.css` 末尾按**六套主题**各给一档；深空档 = 改造前逐值同色（老玩家零变化）。
  styles.css 里 356 处颜色字面量换成 `rgb(var(--wui-hud-*) / α)`，`.app-root.is-layout-modern` 的
  `--hud-*` 别名同步指向新令牌（原 `--hud-primary-rgb` 三元组撤掉，改用 `rgb(var(--wui-hud-primary) / α)`）。
  亮白主题额外给「科幻未来」补一条无照片的浅色背景块（与经典版一样的「甲案」口径）。

### 3. 科幻未来布局下宇宙背景消失
- **病根**：`.app-root.is-layout-modern` 用 `background:` **简写**重写了根背景（简写会重置 background-image），
  把基础 `.app-root` 的 `var(--space-bg)` 星图底整层盖掉，只剩不透明深空底色。
- **处方**：改为显式分层——最底层 `var(--space-bg, none)`（512px 无缝平铺）＋ 其上 `--wui-scrim` 55%
  蒙层 ＋ HUD 微光/网格，`background-repeat/position/size` 逐层给值；亮白主题（不铺照片）用
  `[data-theme='daylight'] .app-root.is-layout-modern` 覆盖成浅色渐变（特异性 0,3,0）。

### 4. 选中「科幻未来」按钮的"彩虹流动"观感
- **现象**：选中态原为「135° 双段渐变 + 外发光 + 内发光 + 文字光晕」四层叠加，且在部分显卡/色彩配置下
  会叫色带 / 光晕流动；同时它不随主题走。
- **处方**：选中态统一改为**令牌色平涂**（`--wui-hud-primary` 16% 底 + 85% 描边 + 主色字），
  去掉渐变、text-shadow 与双发光；`.is-active` / `aria-pressed` / `aria-selected` 同批收敛；
  悬停字色由白改主题主色（亮白下悬停底是浅面，白字会看不见）。
- ⚠ 当前构建复现不到"彩虹"本身（读数为纯蓝渐变、无动画）；本处按"花哨渐变+光晕"这一最可能成因收敛，
  若船长仍看到彩色流动，请给截图/说明（可能是显卡/宽色域渲染差异）。

---

## 四、子代理并行任务（字体选择 + 许可弹窗）

- 执行者：`font-license-agent`（Team 子代理，写作用文件白名单：`panels/appSettings.tsx`、
  新建 `panels/appSettings.css` / `ui/fontChoice.ts` / `assets/fonts/` / `assets/licenses/`、
  `packages/data/src/l10n/table.ts` 增量、`docs/l10n-pending.md` 增量）
- 交付：设置「字体大小」下方「界面字体」（默认 / GNU Unifont）；内嵌
  `assets/fonts/unifont-18.0.01.otf`（5,320,148 字节，原样二进制）；启动接线由 Lead 在
  `game/boot.ts` 的 `prebootRenderer()` 里 `applyFontChoice(readFontChoice())`；
  设置最底部「许可与授权」按钮 + 全文弹窗（GNU Unifont GPLv2 全文 + 字体嵌入例外 + OFL 1.1（如有）+
  项目 AGPLv3/商业双许可声明）。
- 文案纪律：中文落地、`en: ''`、`enDeferred: true`，登记 `docs/l10n-pending.md`，`npm run l10n:check` 绿。

---

## 五、验证（本地）

- [x] `npm run ui:theme-check`：通过（574 个 token、键集一致、深空基线未动、无残留字面量、对比度达标）
- [x] `npm run ui:theme-check` 内的 `ui:tokens` / `dmg-color-check`：通过
- [x] `npm run ui:layout-css` + `ui:layout-css:check`：通过（modern 479KB / classic 498KB）
- [x] `npm run ui:rot-check`：通过；`npm run arch:guard`：通过
- [x] `npm run typecheck`（4 包）：通过
- [x] `npm run content:check`：通过（子代理最初 `ui.App.185` 含「获取日期 2026-11-02」被内容体检抓出 ⇒
      已改为日期只留代码注释、玩家文案不出现）
- [x] `npm run l10n:check` / `npm run l10n:params`：通过（新增 `ui.App.178`–`191` 中文落地 + `enDeferred`）
- [x] `npm run release:rights:test`：通过；`npm run build`（electron-vite）：通过，
      `apps/desktop/out/renderer/assets/unifont-18.0.01-*.otf` 5,320.15 kB 已随包；
      `npm run release:rights:check`：desktop 通过（web 侧待网页版重建后复跑）
- [x] **THIRD-PARTY-NOTICES 收录内嵌字体**（Lead 收尾）：`tools/release-rights/index.ts` 的第三方清单
      加入 GNU Unifont 18.0.01 授权原文（含 GPLv2 全文 / 字体嵌入例外 / OFL 1.1），README 输入清单与
      专项测试同步更新
- [x] 无头 Chrome（1600×1000）截图核对：深空/亮白/高对比/暖色/纯黑/色盲 × 科幻未来 + 旧版；
      宇宙背景强制换星云图确认可见；字号 150% 截图确认全站文字缩放（label 12→18px、正文中位数 11→16.5px）、
      设置面板可滚动；字体档切 GNU Unifont 即时生效且**重启后保持**；许可弹窗 4 段全文
      （字体内嵌声明 181 字 / 官方 LICENSE 24,142 字 / 项目声明 / 双许可含 AGPLv3 全文）可滚动
- [x] 单点收尾（Lead）：`panels/appSettings.tsx` 的 `readNum` / `ZOOM_KEY` / `FS_KEY` 与 `ui/uiScale.ts`
      的重复实现合并为单一来源（启动路径与面板路径只此一份）
- [ ] 观感验收：船长亲自裁定

## 六、待裁决点

1. 字体大小行的说明文字仍是「85%~125%」，与实际可调上限 150%（2026-09-22 船长令放宽）不符；
   是否连同中英文案一起改成「85%~150%」？（文案改动需船长明确授权）
2. 「界面缩放」的本机偏好在重启后同样不自动应用（与本批字号病根 B 同源但不在本例报障内）；
   是否顺手接线（在 App 挂载时 applyZoom）？
3. 若「彩虹流动」仍复现，需要船长提供复现环境（截图 / 显示器色彩配置 / 是否桌面版）以定位。
4. Unifont 是 16px 网格的像素点阵字体，在 12–13px 基准字号下会有轻微缩放观感；是否要为主界面配
   「整数字号档」另议（本批未改字阶基准，守"默认字号不动"）。

---

## 七、授权与许可内容的发布口径（2026-11-02 追加 · 船长已裁定）

背景：子代理报告「已按令把两条外部链接（原项目仓库 / 原站）从**游戏内授权内容**里移除」。Lead 复核后
把 4 个待决点提交船长，**船长 2026-11-02 18:02 四项裁定：保留删链接 / 根文件保持原文 / 保留个人主页 /
悬空句改「请联系作者」**。

### 最终落地（工作区未提交）
- `assets/licenses/project-LICENSE-statement.txt` = 根 `LICENSE.txt` 副本，差异仅三处：
  ① 删 `原项目：https://github.com/yahzj/Deepseek-EVE`；② 删 `原站：https://yahzj.github.io/Deepseek-EVE/`；
  ③ 第二节末句「请通过原项目联系作者」→「请联系作者」（删链接后消除指代悬空）。
- `assets/licenses/project-LICENSE-dual-licensing.txt` = 根 `LICENSE` 副本，差异仅一处：
  删英文商业许可联系段的 `Repository: https://github.com/yahzj/Deepseek-EVE`。
- **保留**：作者行「作者：ya（GitHub：yahzj）」与双许可联系段个人主页链接（署名 + 商业联系入口）。
- 其余正文（四节声明、双许可条款、AGPLv3 全文、Unifont 授权全文）一字未动；渲染层 grep 两串外部链接 0 命中。
- **根 `LICENSE.txt` / `LICENSE` 保持原文**：`tools/release-rights` 产出（发行包 `LICENSE.txt` /
  `copyright.html`）仍为根原文 ⇒ 发行包版权页与仓库一致。
- 合规口径：AGPLv3 §13（网络服务需提供 Corresponding Source）与作者署名不因游戏内删链接而免除；
  本次只调整**游戏内展示副本**，不是删减授权或放弃权利。

### 复核与执行
- `content:check` / `l10n:check` / `desktop typecheck`：全绿；
- 因 `?raw` 授权文本随 JS 打包 ⇒ 已重跑 `npm run build`（desktop）与网页版构建，并复跑
  `release:rights:check`（两端版权头 / 第三方许可 / 无源码映射）；发行包 `THIRD-PARTY-NOTICES.txt`
  已含 GNU Unifont 18.0.01 授权原文。
- 后续维护注意：根文件与游戏内副本现在**有意不同**（副本删 3 处）；改根 `LICENSE*` 时需同步核对副本差异，
  避免把发行包口径带进游戏内或反之。
