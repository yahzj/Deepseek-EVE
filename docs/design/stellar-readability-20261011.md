# 星系星图可读性修正

> **状态：已实现并自检，待船长观感验收**（一号 · main · 2026-10-11）
> 船长原话：「悬浮窗限宽导致悬浮窗内的文字查看费力，建议放宽限制，且星系星图界面内的星球特性样式没有改变」「星系星图界面，光照的明暗对比过高，星球的背光面完全看不到，虽然符合实际，但是对玩家观察星球造成了困扰，应该削减暗面的暗度，让玩家能够造成观察星球」「确认」
> 范围/不做：放宽共享悬浮窗并保持边界安全、星图复用特性标签、星球暗面提亮；不改玩法/存档/公转自转/尺寸/随机序列，不新增依赖或英文，不推送。
> 待裁决点：无。全局悬浮窗会影响其他页面表现，属于本批已明确说明并确认的共享底层改动，不改其业务。

## 已确认方案与依据

- 悬浮窗桌面上限560px、手机旋转逻辑空间上限600px，均受可用区约束，短提示按内容收窄；参数名不被长值过度压缩，允许正常换行，不缩字号/省略文字，不改500ms延迟、皮肤、层级或单例机制。
- 上述裁定替换2026-09-30的380px/420px限宽，权威正文与变更记录同步；根AGENTS不改。
- 星图目标详情复用`PlanetTraitTags`和公开勘探视图，与地表同样的配色、富卡及点击/键盘详情，不泄露隐藏条目。
- 普通星系环境光0.32、黑洞0.24、无恒星0.20；减轻材质暗色二次压暗，亮面不额外过曝；恒星方向/近远光强与无恒星暗背景关系保留。颜色适配发生在材质输出后，不改变地貌与透明形状生成。地图与预览共用renderer。
- 技能判定：ui-ux-pro-max UX「Text Reflow and Spacing」支持流动尺寸/内容高度而非裁字，「Chip Collection Reflow」支持标签换行保留文字；65~75字符行长用于一般文本参考，560/600px是项目选择。对游戏行星阴影无直接匹配，暗面方案为读代码后的项目判断，不套文字对比度标准。

## 参照与单点

星系探索域沿`stellarIllumination`和原PixelPlanets renderer，标签沿地表组件；共享Tooltip的布局收边提成同源纯函数，登记护栏/人读索引，原悬停接管不换机制。验证以专项、真实GPU像素与隐藏原生几何为技术证据，观感由船长验收。

## 清单

- [x] 悬浮窗宽度、参数排版与规则同步。
- [x] 星图特性标签漏接修正。
- [x] 暗面提亮并保留光向/距离关系。
- [x] 护栏、双端构建、GPU与跨尺寸原生检查。
- [x] 最终专项与待审交付记录齐备，正常钩子本地提交，不推送。

## 实施与验证

- `tooltipLayout`提供同源宽高和定位，`TooltipLayer`内联应用并在窗口变化时收起旧提示。富卡按内容计算宽度；参数名列同时写width与flex-basis，避免只写basis时固有宽度漏算、数值列被压成0px的回归。只改变悬浮窗中的参数列，不改变页面属性表。
- `StellarExplorer`替换旧span列表，直接复用`PlanetTraitTags`与dynamicCatalog；以公开view.id作为组件key，切换星球不残留旧详情。初探/隐藏信息继续通过`planetSurveyView`过滤。
- renderer在输出后按光强插值gamma（暗面0.7、亮面1）提亮颜色，光照乘数封顶1.05；不改上游材质、噪声、透明轮廓或恒星自发光。真实GPU对照`830da494`：七类背光侧平均RGB和提高约2.8~3.8倍，无星整体提高约2.9~3.6倍；同种子轮廓像素数完全相同、光向切换成立、时间变化非空、无星地貌不随假光向改变、小视口复用像素一致，WebGL错误0。这些为像素读数，不代替观感。
- 最终54条UI/材质/同步/面积专项、229条搜索/保存/命令/网格/地表回归与20条共享悬浮层相关战斗UI用例（合计303条）通过；四包类型、内容/本地化/参数、旋转/主题、架构/悬停机制/样式分拆门禁通过。旧Vite提示保留，桌面与Web产物已更新；全量core仍留船长明确集中验收。
- 隐藏Electron可读性专项：modern-zh-desktop和classic-en-mobile均通过真实点击/Enter、标签富卡、长短提示、四角避让、深浅主题与原数据守恒。桌面长提示560px、短提示59px；480×360窄视口限宽464px。手机390×740旋转逻辑1200×632：长提示600px、短提示67px，参数名列112px、横向溢出0。原生窗口最小尺寸阻止物理480px缩窗，窄窗改为CDP视口仿真，不改产品限制。
- 动态桌面专项通过七类/六种中心材质像素、近远/无星递减、公转/自转/暂停/减少动态、缩放/拖动同帧（误差<0.000004）、上下文丢失恢复、地表返回与数据守恒。全部使用随机本机端口、隔离合成档和自建隐藏进程，不读取个人真档；不冒称实体手机性能或完整设备矩阵。
- 本批功能域为星系探索，沿已有地表标签、原PixelPlanets renderer及共享Tooltip；无业务跨域，共享悬浮窗全站表现变化已由船长明确确认。规则正文/变更记录当场更新，旧设计/上一批工作文档不归档；不新增依赖/文案/英文/公告、不推送。

## 修改文件

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/renderer/src/panels/StellarExplorer.tsx` | 星图目标详情接公开特性标签，切星球重置详情 |
| `apps/desktop/src/renderer/src/panels/stellarMotion.ts` | 已确认的三档环境光 |
| `apps/desktop/src/renderer/src/ui/stellarPlanetShader.ts` | 暗面颜色gamma与光照乘数上限 |
| `apps/desktop/src/renderer/src/ui/Tooltip.tsx` | 宽高/首帧/实测定位走同源，尺寸变化收起旧提示 |
| `apps/desktop/src/renderer/src/ui/tooltipGeometry.ts` | 新增纯布局函数 |
| `apps/desktop/src/renderer/src/styles.css` | 悬浮窗内容宽度、参数列，不改页面属性表 |
| `apps/desktop/src/renderer/src/ui/layout-css/styles-modern.css` | 从源码生成新版样式 |
| `apps/desktop/src/renderer/src/ui/layout-css/styles-classic.css` | 从源码生成旧版样式 |
| `packages/core/tests/tooltip-readability-20261011.test.ts` | 几何/窄窗/短文本与真实单例接线 |
| `packages/core/tests/stellar-hud-20261009.test.ts` | 星图标签复用、未知隔离与切星球身份 |
| `packages/core/tests/stellar-motion-20261009.test.ts` | 环境光与远近/无星关系 |
| `tools/stellar-material-check.cjs` | GPU旧/新暗面像素与轮廓对照 |
| `tools/stellar-native-check.cjs` | 新可读性入口、原动态像素参数追平 |
| `tools/README.md` | 原生/GPU工具用途和覆盖边界 |
| `tools/arch-guard.ts` | 布局单点登记 |
| `docs/single-source.md` | 布局单点人读索引 |
| `docs/development-conventions.md` | 已获船长确认的悬浮窗新限宽口径 |
| `docs/development-conventions-changelog.md` | 本次裁定留痕 |
| `docs/design/stellar-readability-20261011.md` | 本批方案、实施与验证，待观感验收 |
| `docs/INDEX.md` | 工具生成目录 |
