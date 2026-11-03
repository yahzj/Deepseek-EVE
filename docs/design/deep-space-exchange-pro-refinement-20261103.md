# 深空证券交易所 · 专业界面重构与活动栏常驻监控设计（2026-11-03）

## 状态
- 状态：已获船长授权实施中
- 日期：2026-11-03
- 船长原话：「可以的，你做吧，只做UI，留后端接口，文档要留档和维护，然后在界面最左侧的玩家活动那块区域，增加一个股市在“副AI活动“的最下方，解锁了股市就显示出来，并且显示自己买了什么股票，收益是多少。可以点击快速进入到股市界面」

## 范围与不做
- **范围**：
  1. 专业模式（ProExchange）界面全面减负重构：聚焦挂单、杠杆与自动量化交易；
  2. 砍掉繁琐的五档深度盘口与逐笔成交，改为「多空张力能量条」；
  3. 移除常驻底部的内滚流水窗（Records），释放主屏纵向空间；
  4. 专业 K 线图（Chart.tsx）实现基于时间轴的鼠标滚轮无级缩放（Zoom In/Out）与鼠标拖拽平移（Pan）；
  5. 右侧升级为双核交易舱：顶部大 Tab 一键切换【挂单&杠杆】与【智能量化网格】；
  6. 最左侧活动栏（ActivityBar.tsx）在「副AI活动」最下方增加「股市活动监控卡片」，展示持仓标的与浮动收益，支持点击一键直达股市界面；
  7. 样式严格写在 `exchange.css` 和活动栏样式中，严格遵循色板契约与 UI 规范。
- **不做**：
  - 不修改核心经济引擎与复杂服务端撮合协议，保持数据层契约隔离；
  - 不破坏既有极简模式与现有测试用例。

## 架构与模块清单
1. `apps/desktop/src/renderer/src/panels/ActivityBar.tsx`：在「副AI活动」底部接入股市监控微卡片，获取快照持仓与盈亏，支持一键 `onGoPage('exchange')`；
2. `apps/desktop/src/renderer/src/features/exchange/components/chart/Chart.tsx`：引入 `visibleCount` 与 `panOffset`，接管 `onWheel`（滚轮时间轴缩放）与鼠标平移；
3. `apps/desktop/src/renderer/src/features/exchange/components/ProExchange.tsx`：中栏重构为「大屏 K 线」+「多空能量槽与持仓战报」，右栏重构为「双核交易舱（挂单杠杆 / 自动交易 Tabs）」；
4. `apps/desktop/src/renderer/src/features/exchange/exchange.css`：为新布局、滚轮拖拽手势、多空能量条和活动栏卡片提供赛博科幻样式。
