# T6 事件日志分类修正与配色（状态：已确认）

> 来源：船长测试反馈单 T6（roadmap 置顶，批次 A）。2026-09-04 先做全量分类审计，
> 审计结果与语义口径（甲）经船长确认后实现。
> 关联：`docs/roadmap.md` T1–T11 清单、`docs/architecture.md` 里程碑表。

## 语义规则（口径甲，船长确认）

- **trade 交易/资金**：有 ISK 收付或市场订单动作——买卖与挂单/撤单成交、购买
  （船/核心/物品/蓝图付款）、维修与制造费用支出、远征奖金与 +ISK 事件；
- **info 信息/流程**：无资金变动的流程与搬运——作业开始/完成/停止/召回、切换驾驶、
  装配/卸装、制造/造船完成入库存、自动返港卸货与仓库搬运、扫描、离线结算、教程公告；
- queue 训练队列 / levelup 升级 / warn 警告异常失利 / system 系统——不变。

## 审计修正（core 8 处）

| 位置 | 原 kind | 新 kind |
|---|---|---|
| shipyard 切换驾驶 | trade | info |
| equipment 装配 / 卸下（×2） | trade | info |
| manufacturing 制造完成 / 造船完成（×2） | trade | info |
| mining 自动返港卸货 / 换船善后到港卸货（×2） | trade | info |
| ai / industry 自动挂收购单（×2） | info | trade |

核查无问题的保持原样（市场成交/挂单/撤单 trade、购入核心与维修付费 trade、远征 +ISK/🎁
与大捷战报 trade、失利 warn、学习蓝图与市价簿补充说明 info 等）。

## 视觉（ui + renderer）

- 色板拉开色距（低饱和、不刺眼，`wui-log-*`）：system 紫 / levelup 金加粗 /
  warn 红 + 行首红竖条 + 极淡红底 / queue 淡青 / info 蓝灰 / trade 绿；
- 日志面板过滤开关 = 图例：每类前加同色**色点**，悬停显示该类别语义说明
  （App KIND_DESC）；色值与 ui css 同一字面值，注释互指同步。

## 涉及文件
- core 8 处 kind 修正（shipyard/equipment/manufacturing/mining/ai/industry）；
- ui：`index.css`（六类色值 + warn 竖条）、`LogList.tsx` 头注释；
- renderer：`App.tsx`（色点 + KIND_DESC 语义说明）；
- 文档本文件。

## 验证
- core 测试 227/227 绿（无 kind 断言受影响）；typecheck/build 通过；
- Electron CDP：六类开关色点 = 6、六个 `wui-log-*` 计算色全部唯一（含 system 变量）。
