# 全局 UI/UX 20 轮深度审核与自动化修复全记录（2026-11-04）

## 状态
- 状态：自动化执行中（/goal 长跑任务）
- 日期：2026-11-04
- 船长指令：
  「你开20轮审核慢慢来，专门审核UI/UX的问题，先审核10轮股市的UI/UX问题，然后在审核10轮所有的UI/UX的问题，并且全部修复，自动统一git push上去，保留后端接入的逻辑功能的情况下修复问题。20轮不能并行，只能一轮一轮来，不着急，慢慢来。你全自动化，我要去睡觉了。不能卡壳问我问题或者运行命令卡死。」
- 策略：严格单轮串行推进，每轮独立建档、派工、修复、闭环契约核验并本地 Commit，第 20 轮结束后统一 Push 远端。

## 20 轮任务规划矩阵

| 轮次 | 审查模块与主题 | 重点检查与优化方向 | 状态 |
| :--- | :--- | :--- | :--- |
| **第 01 轮** | 股市 · 极简看盘全局布局与自适应 | 容器高度自适应、栅格分配、不同分辨率下防溢出与对齐 | 已完成 ✓ |
| **第 02 轮** | 股市 · 极简买卖双向舱交互与输入 | 现金输入体验、快捷筹码高光、防呆拦截、回车快捷下单 | 已完成 ✓ |
| **第 03 轮** | 股市 · 极简持仓战报与多空平仓交互 | 单独平多/平空与一键全平微动效、收益实时跳字稳定性 | 已完成 ✓ |
| **第 04 轮** | 股市 · 专业 K 线图时间轴与指标体系 | 准星吸附、极值标记防裁切、指标药丸开关状态、空心阳线与实心阴线渲染 | 已完成 ✓ |
| **第 05 轮** | 股市 · 专业挂单与多空杠杆交易舱 | 分段按钮呼吸光、价格/数量步进、失焦校验、强平风险警戒条 | 已完成 ✓ |
| **第 06 轮** | 股市 · 自动量化交易机器人面板 | 策略表单前置拦截、网格区间可视化、启停按钮动词语义、防误触 | 已完成 ✓ |
| **第 07 轮** | 股市 · 标的行情卡片与左下大盘战况仪表 | 双行紧凑卡片、持仓徽标、多空涨跌比双色槽、成交额格式化 | 已完成 ✓ |
| **第 08 轮** | 股市 · 低风险理财与快讯跑马灯 | 理财计息跳动平滑性、快讯走马灯悬停暂停、多空舆情色彩规范 | 已完成 ✓ |
| **第 09 轮** | 股市 · 活动栏快捷监控微卡片与路由直达 | 侧栏卡片排版、红绿盈亏色板规范、点击直达路由状态保持 | 已完成 ✓ |
| **第 10 轮** | 股市 · 全 6 套主题对比度与可访问性终审 | daylight / contrast / cb 全主题下的视觉清晰度、无残留硬编码、a11y | 已完成 ✓ |
| **第 11 轮** | 全局 · 顶栏与全局底栏导航系统 | 顶栏资源读数排版、底栏功能图标与光晕、活动栏展开折叠动效 | 已完成 ✓ |
| **第 12 轮** | 全局 · 舰船管理与装配面板 | 装备槽位网格、装配对比 Tooltip、属性面板同名检查、族徽渲染 | 已完成 ✓ |
| **第 13 轮** | 全局 · 工业制造与研发装配流程 | 配方列表滚动、材料扣除前馈、制造进度倒计时、批量拖动条 | 已完成 ✓ |
| **第 14 轮** | 全局 · 星图与深空雷达探测系统 | 星系天体悬停高亮、跳跃航线连线、星图缩放平移、深空星云层次 | 已完成 ✓ |
| **第 15 轮** | 全局 · 战斗视界与战场动态 HUD | 护盾/装甲/结构三色血条、动能/爆破/能量伤害飘字层级、战斗日志回溯 | 待开始 |
| **第 16 轮** | 全局 · 虫洞与空间信号矩阵解密 | 矩阵探测网格、波形共振图对齐、信标解锁动效、探索结算弹窗 | 待开始 |
| **第 17 轮** | 全局 · 物品背包与仓储物流交互 | 物品槽位悬停浮层、稀有度边框、堆叠数量角标、分类筛选 Tab | 待开始 |
| **第 18 轮** | 全局 · 任务中心与成就图鉴手册 | 任务追踪进度条、奖励领取正反馈微动效、成就点亮、手册检索 | 待开始 |
| **第 19 轮** | 全局 · 通用弹窗、设置面板与 Tooltip | 统一 Tooltip 延迟与防闪烁、全局模态居中、ESC 退出、设置选项 | 待开始 |
| **第 20 轮** | 全局 · 全端分辨率响应式与全主题终审闭环 | 1080P/2K/4K/窄窗适配、全主题色板契约回归、整库构建回归、统一 Push | 待开始 |



## 第 01 轮：股市 · 极简看盘全局布局、栅格自适应与响应式排版（已闭环）
- **修改文件**：
  - `apps/desktop/src/renderer/src/features/exchange/components/SimpleExchange.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/components/SimpleChart.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/components/FundCard.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/exchange.css`
- **问题与重构**：
  1. 重构极简看盘为三栏栅格布局（左栏星际企业榜 240px、中栏走势图+双向交易舱 1fr、右栏持仓战报+债券基金理财 340px），消除左栏堆叠双重滚动与溢出；
  2. 走势图 HUD 标签升级为胶囊样式并添加 white-space: nowrap 防挤压折行，视口高度紧凑微调至 150px 为交易舱留足视界；
  3. 输入框与快捷筹码按钮严格统一 30px 高度与 6px 间隙，预估行采用等宽字体两端对齐；
  4. 持仓战报多空子行增加左侧鲜艳语义边框与上下分割线，数据改为 2x2 网格消除折行，【一键全平】升级为高危险警告操作，与单独平仓拉开层级；
  5. 修复理财卡片买入/赎回按钮 flex 撑满与高度统一，修复 FundCard.tsx 编译类型引用。
- **验证结果**：
  - `typecheck`、`ui:theme-check`、`ui:rot-check` 全部 100% 绿灯通过。


## 第 02 轮：股市 · 极简买卖双向舱交互与输入（已闭环）
- **修改文件**：
  - `apps/desktop/src/renderer/src/features/exchange/components/SimpleTrade.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/exchange.css`
- **问题与重构**：
  1. 现金/股数输入交互升级：输入框自动过滤非法字符并剔除冗余前导 0；支持 Enter 回车快捷下单、ArrowUp/ArrowDown 依市价按 1 股步进微调、Esc 快速清空；
  2. 内置步进微调按钮 [-] 与 [+] 以及一键清空 [✕]，操作极度顺畅；
  3. 快捷筹码按钮（25%、50%、75%、MAX/全仓）新增点击高光保持动效，全仓按钮赋予高阶金色微光，杜绝资金溢出；
  4. 交易按钮多级防呆保护：细分「订单提交中」、「可用资金不足」、「请输入金额」、「金额超限」等多重边界；在无法下单时呈现优雅 disabled 禁用态并在防呆提示条指引玩家；可下单时提供就绪微光与回车引导；
  5. 买多（看涨绿光）与卖空（看跌红光）色彩语义与 Tab 切换平滑无跳动。
- **验证结果**：
  - `typecheck`、`ui:theme-check`、`ui:rot-check` 全部 100% 绿灯通过。


## 第 03 轮：股市 · 极简持仓战报与多空平仓交互（已闭环）
- **修改文件**：
  - `apps/desktop/src/renderer/src/features/exchange/components/SimplePosition.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/exchange.css`
- **问题与重构**：
  1. 现货多头（青边）、杠杆多头（绿边）与融券空头（红边）三种持仓卡片信息层级分明，徽标与总净浮盈胶囊清晰醒目；
  2. 数据全量绑定等宽字体 `var(--wui-mono)` 与 `tabular-nums`，彻底消除行情跳变时的字符抖动；
  3. 杠杆多头与融券空头新增「强平风险健康度指示条」，根据距爆仓安全垫自动呈现安全/预警/极危三档色彩与动态进度槽；
  4. 单独平仓支持独立的平仓中 loading 态与防并发互斥；
  5. 【一键全部平仓】建立二次确认防误触体系（首次点击激活 3 秒危险呼吸光晕确认态，倒计时显示「确定全平? (3s)」，提供单独取消按钮，超时自动复位），彻底避免误操作。
- **验证结果**：
  - `typecheck`、`ui:theme-check`、`ui:rot-check` 全部 100% 绿灯通过。


## 第 04 轮：股市 · 专业 K 线图时间轴与指标体系（已闭环）
- **修改文件**：
  - `apps/desktop/src/renderer/src/features/exchange/components/chart/Crosshair.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/components/chart/Chart.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/components/chart/Candles.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/components/chart/VolumePane.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/exchange.css`
- **问题与重构**：
  1. 十字准星与坐标轴胶囊联动：鼠标移动时，X 轴底部时间胶囊与 Y 轴右侧价格胶囊动态跟随并增加 Clamp 边界内缩防裁切；鼠标移出时 0.15s 平滑淡出；
  2. 极值标记（最高价 H / 最低价 L）折线标尺增加边界预留内缩（顶 14px 底 6px），彻底消除标签穿出 SVG 视口隐患；
  3. 技术指标药丸开关与曲线同色呼应：MA5 绑定黄金色、MA20 绑定科技紫、RSI14 绑定冰青色、成交量绑定琥珀金，微按压缩放动效；
  4. 阴阳线权威渲染：阳线中空内透率 0.05，上下分段引线腹部不穿堂；阴线纯实心饱满；平盘十字星采用 1px 刚劲横档线；副图增加清爽分割线。
- **验证结果**：
  - `typecheck`、`ui:theme-check`、`ui:rot-check` 全部 100% 绿灯通过。


## 第 05 轮：股市 · 专业挂单与多空杠杆交易舱（已闭环）
- **修改文件**：
  - `apps/desktop/src/renderer/src/features/exchange/components/TradePanel.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/texts.ts`
  - `apps/desktop/src/renderer/src/features/exchange/exchange.css`
- **问题与重构**：
  1. 交易模式切换（现货/做多/做空）配置呼吸光晕微动效与沉降指示条；
  2. 杠杆倍数升级为椭圆数值药丸胶囊（2x/5x/10x/20x/50x），高杠杆配备警示点，超范围档位优雅半透明虚线禁用；
  3. 市价单模式启用虚线沉降锁定态与「市价锁定」徽章，点击可一键解锁；数量输入补全 75% 快捷比例并支持失焦正整数校验；
  4. 财务预估明细全量绑定等宽字体与表格数字对齐，强平距离不足 15% 时激活危险告警卡片与红光脉冲；
  5. 确认下单大按钮增设实时防呆校验指示条与优雅禁用态联动，彻底消灭所有裸色与字面量。
- **验证结果**：
  - `typecheck`、`ui:theme-check`、`ui:rot-check` 全部 100% 绿灯通过。


## 第 06 轮：股市 · 自动量化交易机器人面板（已闭环）
- **修改文件**：
  - `apps/desktop/src/renderer/src/features/exchange/components/bot/BotPanel.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/components/AutoTrade.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/mock/MockExchangeClient.ts`
  - `apps/desktop/src/renderer/src/features/exchange/texts.ts`
  - `apps/desktop/src/renderer/src/features/exchange/exchange.css`
- **问题与重构**：
  1. 策略表单前置拦截：支持网格下限/上限关系校验、2~50 格格数限制与可用现金超额预警，输入框失焦纠错与红框提示；
  2. 微型网格区间可视化条（GridVisualizer）：动态渲染下限跌幅、现价游标指示器、上限涨幅及网格套利密度刻度线，支持上下越界警示；
  3. 启停按钮动词与微动效规范：部署策略赋予科技紫发光微光动效，终止策略升级为「终止策略并撤单」并增加 3.5 秒内联二次确认防手滑机制；
  4. 运行状态卡片：支持绿点呼吸灯动效，套利次数、已实现利润、APR 等数值全量绑定等宽字体与表格数字对齐，零 Emoji 与无裸色字面量。
- **验证结果**：
  - `typecheck`、`ui:theme-check`、`ui:rot-check` 全部 100% 绿灯通过。


## 第 07 轮：股市 · 标的行情卡片与左下大盘战况仪表（已闭环）
- **修改文件**：
  - `apps/desktop/src/renderer/src/features/exchange/format.ts`
  - `apps/desktop/src/renderer/src/features/exchange/components/StockList.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/components/SimpleStockList.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/components/MarketOverview.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/exchange.css`
- **问题与重构**：
  1. 标的列表卡片重构：代码、板块徽标与持仓徽标双行紧凑对齐，公司名称自适应省略截断，彻底消除竖排与折行叠字；
  2. 价格与涨跌幅徽标严格绑定等宽字体与表格数字对齐，高对比度区分涨绿跌红；
  3. 持仓徽标群：当玩家持有现货（金/青）、杠杆多头（涨绿）、融券空头（跌红）时在卡片直观呈现多空仓位与股数，消除误判；
  4. 大盘战况仪表（MarketOverview）：星深综指升级为大号等宽字体与涨跌额胶囊；多空情绪双色槽增加状态标签与涨跌家数比；全市场成交额与成交量以规范化易读格式（如 99.45M ISK）等宽排版展示；
  5. 列表滚动条增加极简半透明轨道美化，选中标的增加高能光条与微光渐变，零 Emoji，全色板契约达标。
- **验证结果**：
  - `typecheck`、`ui:theme-check`、`ui:rot-check` 全部 100% 绿灯通过。


## 第 08 轮：股市 · 低风险理财与快讯跑马灯（已闭环）
- **修改文件**：
  - `apps/desktop/src/renderer/src/features/exchange/components/BondCard.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/components/FundCard.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/components/NewsTicker.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/ExchangePage.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/texts.ts`
  - `apps/desktop/src/renderer/src/features/exchange/exchange.css`
- **问题与重构**：
  1. 债券（BondCard）与保底基金（FundCard）本金、已计利息、本息合计等全量绑定等宽字体 `var(--wui-mono)` 与表格数字对齐；利息跳动平滑脉冲并采用增益绿突出展示；
  2. 新增快捷比例按钮组（25% / 50% / 全买/全投），支持失焦防呆自动纠偏，现金不足时优雅禁用并悬停防呆提示；
  3. 顶栏财经快讯跑马灯严格规范舆情色彩：利多看涨绿、利空看跌红、中性青蓝；
  4. 快讯跑马灯添加硬件加速并支持鼠标悬停平滑暂停，关联标的代码高亮展示为可点击交互徽标并打通点击直达行情联动。
- **验证结果**：
  - `typecheck`、`ui:theme-check`、`ui:rot-check` 全部 100% 绿灯通过。


## 第 09 轮：股市 · 活动栏快捷监控微卡片与路由直达（已闭环）
- **修改文件**：
  - `apps/desktop/src/renderer/src/features/exchange/selectedCode.ts`
  - `apps/desktop/src/renderer/src/features/exchange/components/SidebarExchangeCard.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/ExchangePage.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/exchange.css`
  - `apps/desktop/src/renderer/src/panels/ActivityBar.tsx`
- **问题与重构**：
  1. 新增独立的 `selectedCode.ts` 单点状态与事件总线，实现跨组件平滑定位与订阅响应；
  2. 重构活动栏专属微卡片（SidebarExchangeCard），彻底消除文字截断与折行叠字；
  3. 双行高密度 HUD 结构：顶行展示代码（金色加粗）、持仓微标、最新价与涨跌幅微胶囊；底行展示持仓浮盈/浮亏标签与净盈亏金额，或未持仓直达引导；
  4. 点击该微卡片平滑跳转深空证券交易所页面（page = 'exchange'），精准自动高亮选中主力持仓标的；
  5. 交易所状态订阅从 ActivityBar 剥离并下沉至组件内部，消除秒级全栏重渲染，提升渲染性能；零 Emoji，全色板契约达标。
- **验证结果**：
  - `typecheck`、`ui:theme-check`、`ui:rot-check` 全部 100% 绿灯通过。


## 第 10 轮：股市 · 全 6 套主题对比度与可访问性终审（已闭环）
- **修改文件**：
  - `apps/desktop/src/renderer/src/features/exchange/format.ts`
  - `apps/desktop/src/renderer/src/features/exchange/exchange.css`
  - `apps/desktop/src/renderer/src/features/exchange/components/Positions.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/components/SimplePosition.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/components/SimpleTrade.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/components/BondCard.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/components/FundCard.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/components/TradePanel.tsx`
  - `apps/desktop/src/renderer/src/features/exchange/components/NewsTicker.tsx`
- **问题与重构**：
  1. daylight（浅色模式）深度适配：修复实色大操作按钮在浅色下的文字不可读问题，统一使用浅白字体保证对比度 > 5:1；增加面板与卡片 1px 细微边界与微阴影，防止浅色融化；
  2. contrast（高对比度模式）深度适配：消除低透明度衰减边框，全量提升为鲜明实线边框并增强 outline 轮廓；
  3. cb（色弱友好模式）形态强化：新增 pnlMoney 格式化，正负数显式强制带 +/- 符号；多头胶囊采用实线边框、空头胶囊采用虚线边框，仅凭线型与正负号即可无障碍辨识多空；
  4. 键盘 a11y 强化：统一配置规范的 :focus-visible 焦点轮廓，补充纯图标与快捷按钮的 title/aria-label 提示；
  5. 自动化无头回归：tools/exchange-headless.ts --selftest 两次 20 份场景 SHA-256 逐字节比对 100% 一致通过。
- **验证结果**：
  - `typecheck`、`ui:theme-check`、`ui:rot-check`、`exchange-headless selftest` 全部 100% 绿灯通过。


## 第 11 轮：全局 · 顶栏与全局底栏导航系统（已闭环）
- **修改文件**：
  - `apps/desktop/src/renderer/src/ui/AppShell.tsx`
  - `apps/desktop/src/renderer/src/styles.css`
- **问题与重构**：
  1. 顶栏资源读数（信用点钱包、声望）全量绑定等宽字体 `var(--wui-mono)` 与表格数字对齐，消除数值变动时的宽度抖动；
  2. 顶栏右侧在线时长升级为微光胶囊 `.app-clock`，规范群号、公告、手册、设置等操作区按钮的统一尺寸、间距与微光反馈；清理多处裸色字面量阴影；
  3. 全局底栏导航项强化垂直居中排版与文字防溢出截断（`text-overflow: ellipsis`）；激活选中态新增顶部全息微光指示线条（::before 2px 科技发光带）与图标发光滤镜；
  4. 核心「点击出港」按钮优化深空科技质感，引入平滑呼吸微光动效（`app-nav-featured-breathe`），hover 时聚拢悬浮；
  5. 修正红点未读徽章绝对定位与深色衬底防裁切；活动栏展开/折叠增加平滑渐变过渡，杜绝生硬跳变。
- **验证结果**：
  - `typecheck`、`ui:theme-check`、`ui:rot-check` 全部 100% 绿灯通过。


## 第 12 轮：全局 · 舰船管理与装配面板（已闭环）
- **修改文件**：
  - `apps/desktop/src/renderer/src/features/ships/info/cards.tsx`
  - `apps/desktop/src/renderer/src/pages/FitPage.tsx`
  - `apps/desktop/src/renderer/src/styles.css`
  - `apps/desktop/src/renderer/src/ui/layout-css/styles-classic.css`
  - `apps/desktop/src/renderer/src/ui/layout-css/styles-modern.css`
- **问题与重构**：
  1. 装备槽位网格重构：槽位左上角渲染势力族徽角标（`crestFamOf`），状态分明（空槽天青虚线、已装配 5 阶稀有度边框与微光、选中态全息高光聚光边框、锁定态显式禁用）；
  2. 候选卡装配对比全量注入悬停富卡 Tooltip，提升项使用增益绿、下降项使用预警红，摆脱界面截断限制；
  3. 核心负载条（CPU / PG）：平滑曲线过渡，超载（>100%）激活高亮危险红光脉冲；
  4. 属性面板数值全量绑定等宽字体 `var(--wui-mono)` 与表格数字对齐，护盾/装甲/结构/抗性/速度等参数左标右值工整对齐；
  5. 铲除样式中裸色字面量，保持中英口径单点 `fitHiddenBaseKeys()` 契约，双布局一致性检查 100% 通过。
- **验证结果**：
  - `typecheck`、`ui:theme-check`、`ui:rot-check`、`ui:layout-css:check` 全部 100% 绿灯通过。


## 第 13 轮：全局 · 工业制造与研发装配流程（已闭环）
- **修改文件**：
  - `apps/desktop/src/renderer/src/features/industry/BlueprintCard.tsx`
  - `apps/desktop/src/renderer/src/features/industry/HudManufacturing.tsx`
  - `apps/desktop/src/renderer/src/styles.css`
- **问题与重构**：
  1. 配方科技品级（T1~T5）与势力族徽（`crestFamOf`）卡头渲染，分类 Tab 切换顺滑，滚动条美化与底部防裁切截断；
  2. 材料需求明细全面升级：物品图标、拥有量/需求量比例徽章（充足温和绿、缺料警示红）、数量全量绑定等宽数字与表格对齐；
  3. 缺料前馈警示条：当材料不足时，制造主按钮不仅优雅禁用，下方更以警示条直接罗列缺失材料清单；
  4. 批量制造步进器（1~MAX）与快捷 MAX 按钮，实时对比单次耗时与总计耗时；
  5. 制造队列卡片动态平滑进度条、等宽倒计时跳字，制造完成时激活金色流光待领取动效，零 Emoji，全色板契约达标。
- **验证结果**：
  - `typecheck`、`ui:theme-check`、`ui:rot-check`、39 项制造核心单元测试全部 100% 绿灯通过。


## 第 14 轮：全局 · 星图与深空雷达探测系统（已闭环）
- **修改文件**：
  - `apps/desktop/src/renderer/src/panels/StarMap.tsx`
  - `apps/desktop/src/renderer/src/styles.css`
  - `apps/desktop/src/renderer/src/ui/Tooltip.tsx`
- **问题与重构**：
  1. 星系天体节点光晕与多层级结构：在 SVG defs 中引入高安、低安、零安/法外、母港金辉等天体径向渐变光晕；母港星系增强空间站同心轨道环与十字定位标记，副空间站增设轨道环标识；
  2. 鼠标悬停时的星系战术情报卡（GalaxyIntelTip）：结构化呈现安等评级、主权、族徽、矿脉、设施、异常点统计，左右对齐与等宽数字排版，移除孤立 data-tip 统一收敛至富卡；
  3. 安全等级色彩规范统一：高安绿色、低安警戒黄/橙、零安法外危险红；
  4. 航线与跳跃网络可视化：选中星系相连航线自动呈现辉光加粗高亮，并叠加平滑流动光斑虚线动效（2s 周期，遵从 prefers-reduced-motion）；
  5. 控制工具栏缩放复位按键微动效，高倍缩放与密集网格下增加文字多层投影防遮挡，拓宽 Tooltip 支持 SVG 容器，零 Emoji，全色板契约达标。
- **验证结果**：
  - `typecheck`、`ui:theme-check`、`ui:rot-check`、40 项星图几何单测全部 100% 绿灯通过。
