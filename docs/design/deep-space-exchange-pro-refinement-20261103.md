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

## 二轮独立审核与复核验收（2026-11-03 Double Check）
- **审查员角色**：独立审查员（Auditor）
- **核验清单与排查结论**：
  1. **Emoji 与非常规字符彻底归零核验**：
     - 使用全量 Unicode 正则探针扫描所有 TSX/TS/CSS 文件，Emoji 命中数为 0，完全达标；
  2. **IBM Carbon 图标（@carbon/icons-react）全量复核**：
     - K 线缩放（ZoomIn, ZoomOut, Reset）、挂单与杠杆（Target/Crosshair）、自动交易（Bot, Play, Pause, TrashCan, Add, ChevronDown, ChevronRight）、持仓与委托（ChartCandlestick, Receipt, Close, TrashCan）、模式切换（Portfolio, Analytics）、快讯走马灯（Bullhorn）、交易面板（SendAlt, Checkmark）全部贴合语义；
     - 现货持仓行“卖出”按钮补齐 `<Close size={12} />`，与杠杆“平仓”保持同类操作的一致性；
     - `.ex-auto-caret` 补充 `display: inline-flex; align-items: center; justify-content: center;`，确保折叠箭头垂直居中；
     - 自动量化交易按钮动作文案优化为清晰动词「暂停」/「启用」（`T.strategyPause` / `T.strategyResume`），彻底消除状态名词与动作按钮混淆；
  3. **交互逻辑、数据边界与世界观文案审查**：
     - 消除残留的 `cr` 货币符号（`BondCard.tsx`、`ActivityBar.tsx`、`MockExchangeClient.ts`），全量统一为星际通用货币 `ISK`；
     - 左侧活动栏 `ActivityBar.tsx` 股市监控卡片数据格式强化：
       - 计算总投资成本/保证金，严格展示净盈亏数值与净收益率百分比（如 `收益 +1,234.56 ISK (+12.34%)`）；
       - 补齐 `.app-activitybar-exch-btn .app-ai-act-sub.is-up`（`--wui-tone-profit`）与 `.is-down`（`--wui-tone-loss`）红绿主题色板规则，修复原样式脱节无色问题；
       - 点击卡片正常激活 `onGoPage('exchange')` 直达股市交易大厅；
     - 现货/多头/空头表单联动与市价全平逻辑严密，无类型或状态竞态。


## 三轮色彩语义化落地（2026-11-03 Exchange Button & Feature Color Semantics）
- **背景**：根据船长显式批准的色彩语义方案，彻底解决深空交易所内各类交互按钮与操作状态缺乏视觉色彩逻辑、对比度弱或信息区分度不足的问题。
- **落实明细**：
  1. **分段切换按钮（`.ex-seg-btn`）**：
     - 现货模式（`.is-spot.is-on`）：深空青蓝边框与微光（`--wui-cyan`），内发光强化定位感；
     - 做多看涨（`.is-long.is-on`）：做多看涨底色荧光绿（`--wui-tone-gain`），配合深色高对比文字与轻微辉光；
     - 做空看跌（`.is-short.is-on`）：做空看跌底色激进赤红（`--wui-tone-loss`），配合高亮浅色文字与警示辉光。
  2. **主下单与保存大按钮（`.ex-primary`）**：
     - 现货下单（`.is-spot`）：深空青蓝渐变 `linear-gradient(135deg, rgb(var(--wui-cyan)), rgb(var(--wui-blue)))`，高对比深色字；
     - 做多下单（`.is-long`）：看涨荧光绿渐变 `linear-gradient(135deg, rgb(var(--wui-tone-gain)), rgb(var(--wui-accent)))`，深色文字配合 `--wui-tone-gain` 辉光；
     - 做空下单（`.is-short`）：看跌赤红渐变 `linear-gradient(135deg, rgb(var(--wui-tone-loss)), rgb(var(--wui-danger-deep)))`，浅色文字配合 `--wui-tone-loss` 辉光；
     - 算法量化保存（`.is-algo`）：科技紫蓝渐变 `linear-gradient(135deg, rgb(var(--wui-purple)), rgb(var(--wui-cyan)))`，突出量化策略智能质感。
  3. **次级与状态微按钮（`.ex-mini-btn`）**：
     - 盘口快捷取价与满仓 MAX（`.is-accent`）：高亮青蓝细边框，字体为 `rgb(var(--wui-cyan))`；
     - 现货卖出与杠杆平仓（`.is-close`）：结清仓位弱红警示框，悬停时为 `rgb(var(--wui-tone-loss) / 0.15)` 背景与高亮红字；
     - 撤单操作（`.is-cancel`）：悬停时弱红 `rgb(var(--wui-danger-deep) / 0.15)` 背景，字与垃圾桶图标变红；
     - 策略恢复/启用（`.is-play`）：活力绿 `rgb(var(--wui-tone-gain) / 0.15)` 背景，字和播放图标为 `rgb(var(--wui-tone-gain))`；
     - 策略暂停（`.is-pause`）：警示黄 `rgb(var(--wui-amber) / 0.15)` 背景，字和暂停图标为 `rgb(var(--wui-amber))`；
     - 策略删除（`.is-trash`）：悬停时暗红警示 `rgb(var(--wui-danger-deep) / 0.15)`。
  4. **稳健理财卡片（`.ex-bond`）**：
     - 买入理财（`.is-bond-buy`）：金黄高光渐变 `linear-gradient(135deg, rgb(var(--wui-gold)), rgb(var(--wui-amber)))`，深色高对比文字；
     - 赎回理财（`.is-bond-redeem`）：稳健金色边框，悬停带金色柔和微光。
- **涉及组件**：
  - `TradePanel.tsx`（下单模式与主按钮分流）
  - `Positions.tsx`（平仓、卖出、撤销）
  - `AutoTrade.tsx`（策略启停、删除、创建保存）
  - `BondCard.tsx`（债券申购与赎回）
  - `exchange.css`（色彩与渐变修饰类定义）
- **核验标准**：严格依循 `--wui-*` 变量三元组与 `rgb(var(...))` 包裹规范，零 Emoji 残留，全量通过类型与主题体检。

## 四轮 K 线图阴阳线标准形态重构（2026-11-03 K-Line Candlestick Visual Standards）
- **背景**：响应船长关于“K 线图阴阳线标准形态”的审查意见，参考国内外金融权威标准（通达信、同花顺、TradingView Hollow Candles、日本蜡烛图正统规范），彻底纠正此前所有蜡烛无差别涂抹为实心色块的问题。
- **落实明细**：
  1. **阳线标准空心化（Hollow Up-Candle）**：
     - 收盘价高于开盘价（`b.c >= b.o`）：`.ex-chart-svg .is-up .ex-candle-body` 采用标准空心形态，描边为 `currentColor`（`1.2px`），内部注入微弱底色 `rgb(var(--wui-tone-gain) / 0.08)`，既透视底层深空暗色，又强化暗调背景下的实体轮廓；
     - 影线结构精细化：拆分为从最高价到实体的上影线和从实体到底部的下影线，彻底杜绝一根长线直接横穿空心蜡烛腹部的视觉破绽；
  2. **阴线标准实心化（Solid Down-Candle）**：
     - 收盘价低于开盘价（`b.c < b.o`）：`.ex-chart-svg .is-down .ex-candle-body` 维持饱满实心形态（`fill: currentColor; stroke: currentColor;`），与空心阳线形成强烈的虚实多空张力对比；
  3. **平盘十字星形态强化（Doji）**：
     - 收盘价等于开盘价（`b.c === b.o`）：打上 `.is-doji` 标记，实体高度保持最小 `1px` 并以实心色块渲染，确保零厚度实体在各种分辨率下均表现为清晰刚劲的水平横档；
  4. **副图成交量柱虚实呼应（Volume Pane）**：
     - 阳线成交量（`.ex-vol-bar.is-up`）：采用 `rgb(var(--wui-tone-gain) / 0.25)` 浅充底与 `rgb(var(--wui-tone-gain) / 0.85)` 明晰描边，呈现通透镂空感；
     - 阴线成交量（`.ex-vol-bar.is-down`）：采用 `rgb(var(--wui-tone-loss) / 0.65)` 实心填充，无描边，与主图阴阳节奏高度统一。
- **涉及文件**：
  - `apps/desktop/src/renderer/src/features/exchange/exchange.css`
  - `apps/desktop/src/renderer/src/features/exchange/components/chart/Candles.tsx`
  - `docs/design/deep-space-exchange-pro-refinement-20261103.md`
