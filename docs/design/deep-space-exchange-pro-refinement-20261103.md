# 深空证券交易所 · 专业界面重构与活动栏常驻监控设计（2026-11-03）

## 状态
- 状态：已获船长授权实施完毕并通过全量验收
- 日期：2026-11-03
- 船长原话：
  1. 「可以的，你做吧，只做UI，留后端接口，文档要留档和维护，然后在界面最左侧的玩家活动那块区域，增加一个股市在“副AI活动“的最下方，解锁了股市就显示出来，并且显示自己买了什么股票，收益是多少。可以点击快速进入到股市界面」
  2. 「挺好的，现在。按钮和功能可以用不同的颜色区别对待，但是要有逻辑。就是股市界面的」
  3. 「然后我们看看还有什么问题，我用红框标注的地方都有问题」
  4. 「K线图阴阳线都没有啊，都是阳线呀，你要不查查看标准是什么。」
  5. 「红框标注的地方不对，买入 卖出 不就是做多和做空吗，为什么只能买入后卖出」
  6. 「可以的，也要支持单独平仓，和一键平仓」
  7. 「股市简易看盘，鼠标移动到K线图上 映射坐标不对，这个是什么意思，你检查一下」
  8. 「更新一下文档吧」
  9. 「然后自己帮我git push」

## 范围与不做
- **范围**：
  1. 专业模式（ProExchange）界面全面减负重构：聚焦挂单、杠杆与自动量化交易；
  2. 砍掉繁琐的五档深度盘口与逐笔成交，改为「多空张力能量条」；
  3. 移除常驻底部的内滚流水窗（Records），释放主屏纵向空间；
  4. 专业 K 线图（Chart.tsx）实现基于时间轴的鼠标滚轮无级缩放（Zoom In/Out）与鼠标拖拽平移（Pan）；
  5. 右侧升级为双核交易舱：顶部大 Tab 一键切换【挂单&杠杆】与【智能量化网格】；
  6. 最左侧活动栏（ActivityBar.tsx）在「副AI活动」最下方增加「股市活动监控卡片」，展示持仓标的与浮动收益，支持点击一键直达股市界面；
  7. 样式严格写在 `exchange.css` 和活动栏样式中，严格遵循色板契约与 UI 规范；
  8. 消除全部 Emoji，按钮接入 IBM Carbon 矢量图标（@carbon/icons-react）；
  9. 建立自洽的功能按钮色彩语义体系（做多绿、做空红、现货青蓝、理财金、量化紫、危险暗红）；
  10. 修复截图三大红框（标的列表双行舒展、大盘战况仪表填补左下死黑空洞、指标开关连体对齐、杠杆多空呼吸边框与方向图标）；
  11. K 线图遵循正统金融权威标准：阳线空心中空（独立上下分段影线）、阴线实心填充、平盘十字星刚劲横档、成交量柱虚实呼应；
  12. 极简看盘重构为双向多空交易（看涨买多/看跌卖空），0 持仓也能直接借券卖空，彻底消除“只能买入后卖出”；
  13. 极简持仓战报全面支持多头单独平仓、空头单独平仓与一键全部清仓；
  14. 修复 SimpleChart 鼠标物理像素与 SVG viewBox 虚拟坐标系混淆导致的十字光标映射漂移 Bug。
- **不做**：
  - 不修改核心经济引擎与复杂服务端撮合协议，保持数据层契约隔离；
  - 严禁读写或修改个人真实存档，严格遵守真档只读保护。

## 架构与模块清单
1. `apps/desktop/src/renderer/src/panels/ActivityBar.tsx`：在「副AI活动」底部接入股市监控微卡片，获取快照持仓与盈亏，支持一键 `onGoPage('exchange')`；
2. `apps/desktop/src/renderer/src/features/exchange/components/chart/Chart.tsx`：引入 `visibleCount` 与 `panOffset`，接管 `onWheel`（滚轮时间轴缩放）与鼠标平移；连体药丸化指标开关；
3. `apps/desktop/src/renderer/src/features/exchange/components/chart/Candles.tsx`：实现权威金融标准空心阳烛与实心阴烛，重构上下分段独立影线与十字星横档；
4. `apps/desktop/src/renderer/src/features/exchange/components/SimpleChart.tsx`：面积渐变走势图，物理到虚拟 viewBox 归一化转换，实现鼠标与触控 1:1 吸附；
5. `apps/desktop/src/renderer/src/features/exchange/components/SimpleTrade.tsx`：极简双向交易舱，支持【看涨 · 买多】与【看跌 · 卖空】现金前馈直接开仓；
6. `apps/desktop/src/renderer/src/features/exchange/components/SimplePosition.tsx`：极简持仓战报，支持现货/多头/空头分别【单独平仓】与【一键全部平仓】；
7. `apps/desktop/src/renderer/src/features/exchange/components/StockList.tsx`：标的列表升级为现代双行紧凑行情卡片，根治文字竖排叠字；
8. `apps/desktop/src/renderer/src/features/exchange/components/MarketOverview.tsx`：左栏底部大盘多空战况仪表，填补左下空洞；
9. `apps/desktop/src/renderer/src/features/exchange/components/ProExchange.tsx`：专业模式总览，大屏 K 线 + 多空能量槽 + 双核战术舱；
10. `apps/desktop/src/renderer/src/features/exchange/components/TradePanel.tsx`：现货/做多/做空三态分段与主下单按钮智能色彩联动；
11. `apps/desktop/src/renderer/src/features/exchange/components/Positions.tsx`：持仓作战席，支持现货卖出、杠杆平仓与委托撤销的色彩语义化；
12. `apps/desktop/src/renderer/src/features/exchange/components/AutoTrade.tsx`：量化策略机器人，启停动词消歧、表单前置拦截、科技紫大按钮；
13. `apps/desktop/src/renderer/src/features/exchange/components/BondCard.tsx`：稳健理财卡片，金黄高光买入与稳健金色赎回；
14. `apps/desktop/src/renderer/src/features/exchange/exchange.css`：为以上所有交互与组件提供像素级深空科幻 HUD 样式，严格遵守色板契约。

## 迭代历程记录

### 一轮 界面审查、Emoji 清除与 IBM Carbon 矢量图标引入（2026-11-03 Review & Icons）
- **落实明细**：
  1. 彻底清除业务界面与注释中的所有 Emoji（火箭、闪电、快进、双刀、卷轴、机器人、准星等全部清零）；
  2. 全面接入 IBM Carbon 矢量图标（@carbon/icons-react）：`ZoomIn`, `ZoomOut`, `Reset`, `Target`, `Bot`, `ChartCandlestick`, `Receipt`, `Portfolio`, `Analytics`, `Bullhorn`, `SendAlt`, `Checkmark`, `Close`, `TrashCan`, `Play`, `Pause`, `Add`, `ChevronDown`, `ChevronRight` 等；
  3. 防御性加固：TradePanel 现价除零防御，AutoTrade 策略表单前置校验。

### 二轮 独立审核与复核验收（2026-11-03 Double Check）
- **落实明细**：
  1. 编写 Unicode 正则探针扫描目标目录全量文件，确认 Emoji 残留数绝对为 0；
  2. 现货持仓行“卖出”补齐 `<Close size={12} />` 图标保持同类一致性；
  3. 自动量化交易动作按钮优化为清晰动词「暂停」/「启用」（`T.strategyPause` / `T.strategyResume`）；
  4. 消除残留的 `cr` 货币符号，全量统一为星际通用货币 `ISK`；
  5. 左侧活动栏 `ActivityBar.tsx` 补齐红绿盈亏色板契约，支持精准百分比展示与直达股市大厅。

### 三轮 色彩语义化落地（2026-11-03 Feature Color Semantics）
- **落实明细**：
  1. 现货模式（`.is-spot`）：深空青蓝边框与微光（`--wui-cyan`）；
  2. 做多模式（`.is-long`）：看涨荧光绿底色与渐变（`--wui-tone-gain`），配合高对比深色字；
  3. 做空模式（`.is-short`）：看跌激进赤红底色与渐变（`--wui-tone-loss`），配合高对比浅色字；
  4. 算法量化（`.is-algo`）：科技紫蓝渐变（`--wui-purple` 至 `--wui-cyan`）；
  5. 状态微按钮：盘口/全仓高亮青蓝（`.is-accent`）、平仓/卖出弱红警示（`.is-close`）、撤单暗红（`.is-cancel`）、策略启用绿（`.is-play`）、策略暂停黄（`.is-pause`）、策略删除红（`.is-trash`）；
  6. 稳健理财（`.is-bond`）：金黄高光买入（`.is-bond-buy`）与稳健金色赎回（`.is-bond-redeem`）。

### 四轮 截图三大红框排版重构与大盘战况仪表（2026-11-03 Three Redbox Fixes & Market Overview）
- **落实明细**：
  1. **红框 1 标的列表双行舒展卡片（StockList.tsx & exchange.css）**：
     - 彻底废除 272px 宽度下硬挤的 4 列 Grid（原第一列仅剩 32px 导致“星海重工”挤成竖排错乱叠字）；
     - 升级为双行高密度现代金融行情卡片架构：左半上行大号金色代码加粗 + 板块微标，下行公司全名平整显示不折行；右半上行等宽最新价，下行红绿涨跌胶囊；右上角标注精致金色持仓角标（`[持 X 股]`）；
  2. **填补左下方死黑留白空洞（新增 MarketOverview.tsx）**：
     - 在左栏底部新增独立组件 `MarketOverview.tsx`，实时展示星深综合指数、涨跌家数比双色进度条（2 涨 / 2 跌）、24H 全市场成交总量，彻底消除原低风险理财移走后的 400px+ 空洞；
  3. **红框 2 K 线顶栏技术指标开关连体药丸化（Chart.tsx & exchange.css）**：
     - 将 `MA5 / MA20 / 成交量 / RSI14` 升级为紧凑连体胶囊开关组，高度与左侧周期按钮（24px）严格像素级同轴对齐，消除贴边与挤扁；
     - 激活状态与主副图曲线色彩深度绑定：`MA5`（均线金黄 `--wui-gold`）、`MA20`（均线晶体紫 `--wui-purple`）、`成交量`（副图青蓝 `--wui-cyan`）、`RSI14`（震荡橙 `--wui-amber`）；
  4. **红框 3 下单面板模式多空辨识度强化（TradePanel.tsx & exchange.css）**：
     - 未激活态赋予微弱的做多绿与做空红呼吸边框（`rgb(var(--wui-tone-gain) / 0.4)` / `rgb(var(--wui-tone-loss) / 0.4)`），消除死黑与单调；
     - 接入精准方向 IBM Carbon 矢量图标：`<Portfolio size={13} /> 现货`、`<ArrowUpRight size={13} /> 杠杆多`、`<ArrowDownRight size={13} /> 杠杆空`；
     - 激活态分别爆发做多荧光绿与做空深红渐变光晕，多空战术状态一目了然。

### 五轮 K 线图阴阳线标准形态重构（2026-11-03 K-Line Candlestick Visual Standards）
- **落实明细**：
  1. **阳线标准空心化（Hollow Up-Candle）**：
     - 收盘价高于开盘价（`b.c >= b.o`）：采用标准空心形态，描边为 `currentColor`（`1.2px`），内部注入微弱底色 `rgb(var(--wui-tone-gain) / 0.08)`，既透视底层深空暗色，又强化暗调背景下的实体轮廓；
     - 影线结构精细化：拆分为从最高价到实体的上影线和从实体到底部的下影线，彻底杜绝一根长线直接横穿空心蜡烛腹部的视觉破绽；
  2. **阴线标准实心化（Solid Down-Candle）**：
     - 收盘价低于开盘价（`b.c < b.o`）：维持饱满实心形态（`fill: currentColor; stroke: currentColor;`），与空心阳线形成强烈的虚实多空张力对比；
  3. **平盘十字星形态强化（Doji）**：
     - 收盘价等于开盘价（`b.c === b.o`）：打上 `.is-doji` 标记，实体高度保持最小 `1px` 并以实心色块渲染，确保零厚度实体在各种分辨率下均表现为清晰刚劲的水平横档；
  4. **副图成交量柱虚实呼应（Volume Pane）**：
     - 阳线成交量（`.ex-vol-bar.is-up`）：采用 `rgb(var(--wui-tone-gain) / 0.25)` 浅充底与 `rgb(var(--wui-tone-gain) / 0.85)` 明晰描边，呈现通透镂空感；
     - 阴线成交量（`.ex-vol-bar.is-down`）：采用 `rgb(var(--wui-tone-loss) / 0.65)` 实心填充，无描边，与主图阴阳节奏高度统一。

### 六轮 极简看盘双向多空交易与单独/一键平仓重构（2026-11-03 Simple Trade & Position Refactoring）
- **落实明细**：
  1. **极简买卖舱升级（SimpleTrade.tsx）**：
     - 废除原先单向卖出现货逻辑，将两个 Tab 升级为【看涨 · 买多】（`buy`）与【看跌 · 卖空】（`short`）；
     - 统一以【投入现金 ISK】为输入口径，支持 25% / 50% / 75% / 全仓 快捷筹码；
     - 实时前馈换算：买多按 1x 现货计算预计股数与手续费；做空按 2x 杠杆融券市价开空，零门槛借券卖出（0 股也能借券开空），明示占用保证金与手续费；
     - 动作按钮与特征提示：买多提示“看涨买入，价格上涨即享现货增值”，大按钮高光绿；卖空提示“零门槛借券做空，价格下跌即赚取丰厚差价”，大按钮高光红。
  2. **持仓战报升级（SimplePosition.tsx）**：
     - 汇聚当前标的之现货多头、逐仓多头与融券空头全部持仓；
     - 各子仓位配备专属【单独平仓】微按钮：现货提供 `<Close size={12} /> 平多变现`；融券空头提供 `<Close size={12} /> 平空结清`（调用 `client.closePosition(code, 'short')`）；杠杆多头提供 `<Close size={12} /> 平多结清`；
     - 顶部配备醒目的【一键全部平仓】大按钮，一键市价卖出该标的所有现货并结清所有杠杆多空单，全部变现为可用资金；
     - 呈现当前标的总净盈亏与净收益率总览；
     - 空状态优雅提示“暂未持有该标的仓位，可在左侧买卖舱输入金额，一键看涨买多或看跌做空”。

### 七轮 极简 K 线图鼠标悬停坐标映射修复（2026-11-03 SimpleChart Coordinate Mapping Fix）
- **病因分析**：
  - 原代码在 `onMouseMove` 中直接使用 `const ratio = (relX - padX) / usableW`，其中 `relX` 是 `getBoundingClientRect()` 测出的容器真实屏幕物理像素宽度（可达 800~1200px），而 `padX`（14）与 `usableW`（612）是 SVG 内部写死的固定虚拟尺寸（`viewBox="0 0 640 170"`）；
  - 这种量纲混淆导致鼠标移动到容器 60% 宽度处时，计算出的 `ratio` 已经强行达到 1.0（被 `Math.min(1, ...)` 卡死在最右端），造成“鼠标在屏幕中央偏右，光标虚线却已飞速撞墙死锁在最右侧”的严重错位失真。
- **落实明细**：
  - 将鼠标物理屏幕 X 坐标先行映射到 SVG viewBox 局部坐标系：`const svgX = ((e.clientX - rect.left) / rect.width) * width`；
  - 再基于统一的 viewBox 坐标系计算有效数据绘图区的归一化比例：`const ratio = Math.max(0, Math.min(1, (svgX - padX) / usableW))`；
  - 同步引入 `onTouchMove` 触控滑动支持与触摸结束自动重置光标；
  - 无论界面在何种分辨率或容器宽度下拉伸，垂直十字虚线与数据圆圈均实现像素级 1:1 吸附于鼠标指针下方。
