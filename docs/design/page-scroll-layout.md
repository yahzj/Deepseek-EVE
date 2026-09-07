# 一级页不滚 · 布局改造设计（2026-09-08 船长定稿，实施中）

> 状态：**已确认口径，实施分批进行**（批次1 基建+市场+舰船+装配 → 批次2 工业+星图 → 批次3 技能+物品）。
> 权威规则：docs/development-conventions.md 第九章「一级页不滚/滚动只进二级窗口」+ AGENTS.md §6 + 词典 一级页/二级窗口。

## 目标形态
- 一级页（星图/舰船/装配/物品/市场/工业/技能）整页无滚动条，高度 = 主窗口内容区高；
- 滚动只出现在**二级窗口**：功能窗采用「固定头 + 下滚」（Panel 标题/须常显的筛选/说明/排序行固定，下方列表/卡网格独立内滚，复用 `.wui-panel-body` 自带 `flex:1;min-height:0;overflow:auto`）；
- 例外（船长逐项拍板）：物品页仓库/货仓 = 每标签一个内滚窗口（整窗滚）；技能页目录 = 整窗滚；星图·远征 = 星图全窗 + 点选星系的行动列表改**弹窗**（不再挤占地图竖向空间）；
- 红线：内容必须完整装下，禁止硬裁；放不下的页面单独上报讨论，不擅自删滚动。

## 壳层事实（审计 2026-09-08，styles.css 行号）
- 页级滚动唯一来源 `.app-page-content`（2111：`overflow-y:auto`）；改 `overflow:hidden` 后须让页面根吃满：
  `.page-stack`（2121，列 flex 自然高）需 `.page-fill{flex:1;min-height:0}`；
- `.wui-panel` = flex 列 + min-height:0；`.wui-panel-body` = `flex:1;min-height:0;overflow:auto`（ui index.css 59-64）——Panel 被钉高后 body 即内滚；
- 阻碍：`.page-stack > .wui-panel{flex-shrink:0}`（2853）需对"吸满面板"覆盖；市场右栏 `.app-mkt-right > .wui-panel:last-child{flex:1 1 auto}`（7307）是官方试点模板；
- header/活动栏（max-height:230 自滚）/日志栏（320px 宽固定）不受影响；手机横屏 = 虚拟横屏盒（更矮），改造须在矮预算下不裁内容（实机验证点）；
- 死代码可无视：`.app-main/.app-col/.app-right/.app-nav-top/.app-log-wrap` 等旧三栏类无引用。

## 批次 1 页面要点（审计依据）
- **市场 MarketPage**：页顶两条 `app-note` 并入固定头；`.app-mkt-left` 商品列 = Panel 内 `.app-mkt-list`（4167 现 `max-height:520`）改弹性吸满；右列详情 + 我的挂单沿用 7307 弹性链；`≤1180px` 塌单列时右栏在页内纵向内滚承接；
- **舰船 ShipPage**：每 tab 单 Panel + 单列表（舰队卡/图鉴/AI 行）→ 各活跃 Panel `flex:1;min-height:0` 即 body 内滚；
- **装配 FitPage**：内容有界无增长列表；`.app-fit-cols` 双栏放入单 Panel body（body 内滚即可），浮层 app-fit-modal（3527）已有 80vh 内滚范例。

## 批次 2 页面要点
- **工业 IndustryPage**：顶部 app-subtabs(3)=精炼炉/组装机/蓝图书架；每标签单 Panel body 滚；组装机 body 内类型筛选行固定 → body 内拆 固定头+滚区（或整窗滚视实现成本，与船长对齐）；（顺带修正文件头注释与按钮顺序不一致的文案问题）
- **星图 MapPage**：5 标签各自单 Panel body 滚（悬赏 20+ 全宽卡=最大源）；星图·远征 = 地图占窗（整窗滚或按比例自适应）+ 星系行动弹窗（复用弹层族 `.app-modal*`/`app-detail` 内滚范例）。

## 批次 3 页面要点
- **技能 SkillsPage**：队列 Panel 固定 + 目录 Panel `flex:1` 整窗滚（船长拍板整窗滚）；
- **物品 ItemsPage**：仓库/货仓每标签一个内滚窗口承载现有分组（6~7 Panel → 收进单窗；货仓 CargoPage 嵌套 page-stack 不得产生双滚动，其内层自然排布由外层窗承载）。

## 基建（已落地或首批落地）
- `.app-page-content` → `overflow:hidden` + 弹性列；
- `.page-stack.page-fill`（满高骨架）＋ `.app-win-head/.app-win-body`（自绘二级窗固定头/滚体工具类）＋ `wui-panel` 支持 `className`（吸满面板用 `.wui-panel.is-fill` 类，flex:1 1 auto + min-height:0）；
- 样式纪律：滚动条样式复用既有列表/网格族，不新造外观。

## 实施清单（逐页勾选；每页完成后在 App.tsx 的 no-scroll 名单加入该页）
- [x] 批次1：舰船（fleet/AI/shop 各活跃 Panel is-fill）——已上线（App PAGE_NO_SCROLL 含 ship）
- [x] 批次1：市场（说明行固定 + split 弹性占满；左列商品 Panel is-fill body 内滚；右栏沿用 7307 弹性链）——已上线（no-scroll 含 market）
- [x] 批次1：装配（单 Panel is-fill，body 内滚）——已上线（no-scroll 含 fit）
- [x] 批次2：工业（三标签 Panel body 滚）——已上线（no-scroll 含 industry；组装机筛选行固定为后续微调项）
- [x] 批次2：星图（5 标签 Panel body 滚）——已上线（no-scroll 含 map；远征「地图+行动弹窗」为后续独立重构项）
- [x] 批次3：技能（队列固定 + 目录 Panel is-fill 整窗滚）——已上线（no-scroll 含 skills）
- [x] 批次3：物品（仓库/货仓整标签单窗滚 app-win-body；CargoPage 嵌套无双滚）——已上线（no-scroll 含 items）
- [ ] 后续独立项：星图·远征行动列表弹窗化（船长 2026-09-08 拍板方案）
- [ ] 后续微调项：组装机/任务中心等 面板内筛选/子标签行固定（固定头+下滚精细化）
- [ ] 全量回归：桌面各页 + 手机横屏矮高预算（不裁内容红线）+ ≤1180px 窄桌面

