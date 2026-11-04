# 设置界面四项报障修复（字号 / 配色 / 宇宙背景 / 选中按钮）· 2026-11-02

> 状态：**已落地 · 船长验收完成**（2026-11-02 已推送 main）
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

---

## 八、全局字体统一（2026-11-02 追加 · 船长报障）

> 船长原话：「项目UI上我看到还有别的字体，不应该，应该是宋体什么的，全局字体应该统一」

### 病根（实测定位，非猜测）
用 CDP `CSS.getPlatformFontsForNode` 逐节点读**真实渲染字体**（1600×1000 · 科幻未来布局 · 11 个页面/面板）：
- 新 HUD 块里有 **5 处裸 `font-family: monospace`**（`.app-subtab` / `.app-tasktab` / `.app-log-head` /
  `.app-battle-tacs .app-btn` / `.app-fit-stage::before`）落在**中文**元素上；
- `--wui-mono`（Cascadia Mono/Consolas/Courier New）与 `--hud-mono` 只含 Latin 等宽体，无汉字字形 ⇒
  中文回落浏览器默认的 **NSimSun（新宋体）**；
- 全站正文还有**两套栈**：`body` 的雅黑栈 + `html[data-locale='en'] body` 的 Segoe 栈。
⇒ 同一屏出现「雅黑 + 等宽 + 新宋体」三种字形，船长看到的"宋体"即 NSimSun。

### 处方（单点化）
1. `packages/ui/src/index.css` 新增 `--wui-font` 作为**全站唯一正文字体栈**（中英同一栈），
   `--wui-mono` 末尾补中文无衬线兜底（Microsoft YaHei / PingFang SC / Noto Sans SC）；
2. `styles.css` 的 `body` 与 `html[data-locale='en'] body` 都改引 `var(--wui-font)`（英文不再另起一栈）；
3. 5 处裸 `monospace`：中文元素改 `inherit`（页签/日志标题/战术键），装饰性英文标签改 `var(--wui-mono)`；
   7 处 `.is-layout-cosmic` 死规则里的 `monospace, var(--wui-mono)` 一并清成 `var(--wui-mono)`；
4. `_hud-industry.css` 的 `--hud-mono` 补中文无衬线兜底（该页整页用等宽栈）；
5. `ui/fontChoice.ts` 的可选 GNU Unifont 机制不动（仍只在玩家显式选择时覆盖 body）。

### 验证
- 复跑字体审计（同一探针）：「科幻未来 × 深空」11 个页面/面板与「旧版 × 深空」11 个页面/面板，
  **NSimSun/宋体命中 0**；字体构成 = Microsoft YaHei（正文/中文）+ Consolas（等宽数字读数）+
  Segoe UI Symbol/Emoji/Cambria Math（符号与数学字符的正常回退）。
- `ui:theme-check` / `ui:layout-css:check`（已重跑生成件）/ `ui:rot-check` / `typecheck`：全绿；
  desktop 与网页版构建通过。
- 取舍：数字/代码读数**仍保留等宽**（表格对齐与刷新不跳动是刻意设计）；若船长要求连数字也统一到雅黑，
  只需改 `--wui-mono` 一个 token，不必再散改规则。

---

## 九、界面字体两档：默认（雅黑＋Oxanium）／复古（统一 GNU Unifont）（2026-11-02 追加 · 待船长验收）

> 船长原话（照抄）：
> ①「我想试试，英文和数字用这个 "D:\Downloads\unscii-16 (1).otf" 字体显示，行不行呀」
> ②「不是我的意思这不是单独的，是跟unifont一起显示，不用单独做选项，并且设置里，的选项不要叫GNU Unifont，叫复古」
> ③「这个16的字体不太行，换成 "D:\Downloads\unscii-8-tall.otf" 这个看看」
> ④「unscii-8-tall效果太差了，我想换成 "D:\Downloads\Oxanium-VariableFont_wght.ttf"」
> ⑤「现在这个效果很好，但是不适合复古这个选项，可以把这个中英字体跟默认做到一块去。」
> ⑥「我不是这个意思，默认是微软雅黑+Oxanium（英文/数字），复古是GNU Unifont "D:\Downloads\Eunomia-Bold.otf"（英文/数字）」
> ⑦「可以了，复古这个选项里，还是统一只用unifont这个字体吧，字体选择是会默认保存这个配置的把，下次再打开的时候会是我选的那一个。」
> ⇒ 迭代链：unscii-16 → unscii-8-tall → Oxanium（并入默认）→ Eunomia（试掉）→ **最终双档**：
> **默认 = 微软雅黑（中文）+ Oxanium（英文/数字）；复古 = 统一只用 GNU Unifont（中文 + 英文/数字）**。

### 最终口径（按第⑥⑦条）
- 设置「界面字体」两档：**默认** / **复古**（不做第三个单独选项）。
- **默认**：不挂字体属性 ⇒ `packages/ui/src/index.css` 的 `--wui-font` / `--wui-mono` 生效
  （Oxanium 英文/数字 + 系统微软雅黑中文；emoji 系统兜底）。
- **复古**：`<html data-ui-font="retro">` + `--ui-font`（**GNU Unifont 全包**：中文 + 英文/数字都是
  它的像素点阵字形，系统中文栈兜底）；同时覆盖 `--wui-mono` / `.hud` 的 `--hud-mono`（读数也统一 Unifont）。
- **保存**：点选即写 `localStorage['whale-idle:ui-font']`（本机偏好、不进存档），启动由
  `prebootRenderer()` 读回并应用 ⇒ 刷新/重启后仍是玩家选的那一档（已在无头浏览器验证：点选复古后刷新仍为复古）。
- 兼容旧值：早期版本存过 `'unifont'` / `'unscii'`，读到自动迁移为 `retro`。

### 落地
- 字体资产（二进制原样复制）：`assets/fonts/oxanium-variable.ttf`（43,108B，可变字重 wght 200–800）、
  `assets/fonts/unifont-18.0.01.otf`（GNU Unifont，含 CJK；复古档全字体）；试排的 unscii 两版与
  Eunomia Bold 均已移除；
- 授权文件：`oxanium-LICENSE.txt`（OFL 1.1 全文）、`unifont-18.0.01-LICENSE.txt`（双许可全文）；
- `packages/ui/src/index.css`：默认 `--wui-font` / `--wui-mono` = Oxanium + 微软雅黑；
- `panels/appSettings.css`：两枚 `@font-face`；`[data-ui-font]` 覆盖 body/表单控件；
  `[data-ui-font='retro']` 覆盖 `--wui-mono` 与 `.hud` 的 `--hud-mono`（均以 GNU Unifont 打头）；
- `ui/fontChoice.ts`：`FontChoice = 'default' | 'retro'`；点选即落盘，启动读回（持久化实现单点）；
- `panels/appSettings.tsx`：恢复「界面字体」行（默认/复古两按钮）与「恢复默认」一并重置字体；
  授权弹窗两个字体小节（Unifont / Oxanium，l10n `ui.App.192`–`194`）；
- `_hud-industry.css`：默认 `--hud-mono` 以 Oxanium + 雅黑打头；
- `tools/release-rights`：`THIRD-PARTY-NOTICES.txt` 收录 `===== GNU Unifont 18.0.01 =====` 与
  `===== Oxanium / The Oxanium Project Authors =====`（OFL 1.1 全文），专项测试与 README 输入清单同步；
- 文案：`ui.App.178`–`195`（字体行 + 授权弹窗），登记 `docs/l10n-pending.md`。

### 验证
- 无头 Chrome 实测（CDP `CSS.getPlatformFontsForNode`）：
  · 默认档（不设偏好）：英文/数字混合文本 = **Oxanium（数字/英文）+ 微软雅黑（中文）**；
  · 复古档（点选「复古」）：**全部文本 = GNU Unifont**（英文/数字/中文同一套点阵字形）；
  · 点选即时生效；刷新后 `data-ui-font='retro'` 与 `localStorage['whale-idle:ui-font']='retro'` 都保持；
- `typecheck` / `content:check` / `l10n:check` / `release:rights:test` / `ui:tokens` / `ui:theme-check`
  / `ui:layout-css:check`：全绿；desktop 与网页版构建通过，产物内两枚字体齐全；
- 取舍：默认档 Oxanium 为矢量字体（任意字号清晰）；复古档 Unifont 是 16px 网格点阵，12–13px 会缩放，
  字号拉到 ~125%（≈16px）最锐利。观感由船长裁定。

---

## 十、出击地图（星图）观感微调（2026-11-02 追加 · 待船长验收）

> 船长原话（照抄）：「红框标注的母港的圆要比所有人都大一号，然后绿框标注，没有标注全，但是类似的这些标题的字号都要再小2号。这个出击地图的英文和数字的字号要在大2号」

### 口径
- 「号」按**星图 SVG 单位 2 个单位**落地（星图按容器整体缩放到约 1.95～2.3 倍显示 ⇒ 观感约 ±4～5px）。
- 母港圆：**r 11 → 13**（普通星系 8、未探索 7），保证"母港比所有星系都显眼"。
- 星系名（`.app-map-label`，含母港名）：**11px → 9px**。
- 地图上的英文/数字：边线分钟读数 `.app-map-min` **9px → 11px**；⚔/⚑ 数量徽标 `.app-map-bounty`
  **10px → 12px**；缩放读数 `.app-map-zoom-val` **10.5px → 12.5px**。
- 徽标放大后基线上移 3 单位（y−12 → y−15）、避让带同步（-24..-10 → -27..-13），避免字腹压住圆点。

### 落地
- `panels/StarMap.tsx`：新增 `HUB_DOT_R = 13` 并用在节点 `r=`；两处徽标基线/避让带调整；
  `FACTION_BOX_M` 注释同步（34 仍框得住 r=13）。
- `styles.css`：上述 4 条字号（均用 `calc(var(--wui-fs-*) ± 2px)` 保留字号滑块的 `--ui-fs` 系数）——
  **改完已跑 `npm run ui:layout-css` 重生成两份布局样式**。
- 未改：名称带避让的几何常量（名称变小只让排布更松、不会更挤）。

### 验证
- 无头 Chrome（1600×1000 · modern · 深空）实测：`hubR=13`（其余 8）、名称计算字号 9px（渲染 ≈17.6px）、
  分钟读数 11px（渲染 ≈21.5px）、徽标 12px；截图 `tools/_ui-artifacts/fixprobe/map-1-default.png`。
- `typecheck` / desktop 构建通过；`ui:rot-check` 通过。
- 待船长看观感：若「2号」指别的量级（如 +/- 4px），只需改这 4 条 CSS + `HUB_DOT_R` 一处。

---

## 十一、界面配色精简与文案两字化（2026-11-02 追加）

> 船长原话（照抄）：「设置里的“界面配色”中的跟随系统选项不要了。还有亮白太丑了，这个亮色模式还不如不做，真的丑的不要不要的，”暖色护眼“和“色盲友好”的文案不对，尽量改成两个字」

### 调整项
1. **移除「跟随系统」选项**：从 `THEME_CHOICES` 移除 `'auto'`，不再向玩家提供系统跟随。若本地偏好为 `auto` 则平滑回落默认 `deepspace`。
2. **移除「亮白」选项**：从 `THEME_CHOICES` 移除 `'daylight'`。若本地偏好为 `daylight` 自动回落 `deepspace`。
3. **文案两字化**：
   - 「暖色护眼」精简为：**「暖色」**（`ui.App.134`）。
   - 「色盲友好」精简为：**「色盲」**（`ui.App.136`）。
4. **说明文案同步**：更新 `ui.App.132`，消除已废除的“亮白”与“跟随系统”描述，同步新的两字名称。

### 验证
- `npm run typecheck`：通过。
- `npm run content:check`：通过。
- `npm run ui:theme-check`：通过。
- `npm run ui:rot-check`：通过。

