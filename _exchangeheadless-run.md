# 交易所 Mock · 无头驱动运行记录（2026-11-03）

> 本批只做「AI 低思考档试玩」的无头驱动与场景快照：**不接入服务器、不动 UI、不发布**。
> 只新增文件，未修改任何既有文件、未改 package.json、未 commit / push、未发起网络请求。

## 一、结论

- 基线：`main` @ `1835b594`，工作树无已跟踪文件改动（`git diff --stat` 为空）。
- 环境：Windows，Node `v24.19.0`，`tsx v4.23.13`（仓库已有，未加新依赖）。
- 结果：三种模式全部跑通；`--selftest` 两次输出逐字节一致；20 份场景互不共享种子/暖场；
  `--apply` 空跑（20 个 `hold`）20/20 执行成功；额外用一份混合动作验证了
  `buy_spot / buy_long / buy_short / sell / close` 与拒单路径。
- 产物（均为新增）：

| 文件 | 说明 | 大小 |
|---|---|---|
| `tools/_exchange-headless.ts` | 无头驱动（shim + 手动时钟 + 三种 CLI 模式） | 45,323 B |
| `_exchange-scenarios.json` | 20 份场景（机器可读，含 recipe / 指纹 / 盘口 / 账户 / 快讯） | 156,696 B |
| `_exchange-scenarios-prompt.md` | 20 张中文场景卡（给 AI 读） | 47,967 B |
| `_exchange-scenarios-hold-actions.json` | 20 个 `hold` 占位动作（空跑夹具） | 1,597 B |
| `_exchange-scenarios-smoke-actions.json` | 20 个混合动作（各分支冒烟夹具） | 1,931 B |
| `_exchange-ai-result.json` | 当前为 **hold 空跑** 的逐场景结果 | 28,458 B |

## 二、运行记录

### 2.1 `--selftest`（同种子两次输出比对）

命令：

```powershell
npx tsx tools/_exchange-headless.ts --selftest
```

结果（节选）：

```text
[selftest] JSON 字符串一致: true；UTF-8 字节一致: true
[selftest] Markdown 字符串一致: true；UTF-8 字节一致: true
[selftest] 场景数=20 唯一 tick 数=20 tick 区间=[71, 887]
[selftest] JSON SHA-256: a36630ac940785c0020b39d7399f2deb5e5227fcc16208c7b6c921a9dad59a07
[selftest] Markdown SHA-256: cbfcd0d2c1a32ddcc5d626ae0d5c3826faf99eb55b7d830ea199c73ca07bfe04
[selftest] 结果: PASS（逐字节一致），耗时 331 ms
```

（复跑一次为 359 ms，仅耗时波动，输出哈希不变。）

补充用外部文件哈希复核（连续两次 `--snapshot 20` 后比对）：

```text
_exchange-scenarios.json         run1=A36630AC…DAD59A07  run2=A36630AC…DAD59A07  same=True
_exchange-scenarios-prompt.md    run1=CBFCD0D2…CA07BFE04  run2=CBFCD0D2…CA07BFE04  same=True
```

确定性来源：`Date.now()` 在装 shim 时冻结到 `2026-11-03 09:30:00 +08:00`；
每份场景独立 `new MockExchangeClient(seed)`、独立清空内存 `localStorage`；
行情/盘口/事件全部走 Mock 自带的 `createRng(seed)`，本工具不消费任何随机数。

### 2.2 `--snapshot 20` 耗时

```powershell
npx tsx tools/_exchange-headless.ts --snapshot 20
```

```text
[snapshot] 写入 …\_exchange-scenarios.json（156696 字节）
[snapshot] 写入 …\_exchange-scenarios-prompt.md（47967 字节）
[snapshot] 完成：20 份，耗时 205 ms
```

- 脚本内计时：**205–209 ms**（两次实测；20 个 Mock 实例 + 暖场，共约 1 万拍）。
- 端到端墙钟：**1,166 ms**（含 `npx tsx` 启动与编译）。
- 20 份的 tick 互不相同（区间 71–887），种子步长 104729；账户状态按 `id % 4`
  轮换为 现货 / 多 / 空 / 空仓（对应余数 1 / 2 / 3 / 0）。

### 2.3 场景卡样例（场景 01，原文前 15 行）

```text
## 场景 01 ｜ 焦点 SMHI ｜ tick 71
> 种子 20365832 · 暖场 67 拍 · 预热动作：市价买入 SMHI 现货 370,000 cr · 快照间隔 4 拍 · 指纹 c2fc741a9dd455d1
指数 961.75（-3.82%）｜四家标的现价与涨跌：
- SMHI 星海重工/军工 现价 122.31 涨跌 +11.37% 开 109.83 高 168.03 低 97.90
- UGMC 联星矿业/采矿 现价 45.47 涨跌 -3.67% 开 47.20 高 56.79 低 42.30
- OJLS 欧吉物流/物流 现价 88.44 涨跌 +14.39% 开 77.31 高 98.44 低 75.26
- ABSI 深空蓝图/科技 现价 180.81 涨跌 -1.74% 开 184.01 高 244.72 低 159.85
五档盘口（价格×股数）：
- SMHI 买 122.13×56,247 122.03×58,570 121.93×44,857 121.83×43,220 121.73×34,494
- SMHI 卖 122.49×56,247 122.59×58,570 122.69×44,857 122.79×43,220 122.89×34,494
- UGMC 买 45.38×119,208 45.34×115,026 45.30×90,286 45.26×77,587 45.22×65,043
- UGMC 卖 45.56×119,208 45.60×115,026 45.64×90,286 45.68×77,587 45.72×65,043
- OJLS 买 88.29×80,334 88.22×61,903 88.15×59,027 88.08×57,635 88.01×37,744
- OJLS 卖 88.59×80,334 88.66×61,903 88.73×59,027 88.80×57,635 88.87×37,744
- ABSI 买 180.58×39,875 180.44×27,090 180.30×27,086 180.16×20,846 180.02×18,885
```

（第 16 行起为 ABSI 卖五档、账户、持仓/现货、最近 3 条快讯与动作说明；完整卡见
`_exchange-scenarios-prompt.md`。）

### 2.4 `--apply` 空跑（20 个 hold）

```powershell
npx tsx tools/_exchange-headless.ts --apply _exchange-scenarios-hold-actions.json
```

```text
[apply] 完成：20 份，执行成功 20，有成交 0，爆仓 5，耗时 462 ms
```

- 端到端墙钟：**1,409 ms**；每份都先按 recipe 重建并比对状态指纹，20/20 指纹一致。
- 脚本内计时：**462–481 ms**（两次实测）。
- 聚合：`pnl` 平均 **+94,020.84**，合计 **+1,880,416.74**，最大 **+572,961.52**（场景 01），
  最小 **-136,022.49**（场景 14）；15/20 的期末权益发生了变化。
- 「hold 不等于零盈亏」：5 份纯空仓场景（04/08/12/16/20）权益完全不动；
  其余场景带有预热现货/杠杆仓，1440 拍里价格继续走，权益随之变化。
- 「爆仓」5 份（03/06/10/14/18，均为预热杠杆仓在窗口内被强平清空）。
- 逐场景结果（完整字段见 `_exchange-ai-result.json`）：

```text
id 动作   成交   期末权益           盈亏           最大回撤   强平  爆仓
 1 hold   False  10,570,135.79     +572,961.52    1.96%     0    False
 2 hold   False  10,003,589.52      +19,149.91    1.06%     3    False
 3 hold   False   9,953,515.61      -30,667.19    0.40%     3    True
 4 hold   False  10,000,000.00           0.00    0.00%     0    False
 5 hold   False  10,501,353.56     +503,855.90    2.04%     0    False
 6 hold   False   9,894,134.31      -91,183.08    0.93%     4    True
 7 hold   False  10,130,885.62     +142,504.56    0.62%     0    False
 8 hold   False  10,000,000.00           0.00    0.00%     0    False
 9 hold   False  10,157,347.86     +137,448.86    3.49%     0    False
10 hold   False   9,903,316.71      -90,602.44    2.41%     4    True
11 hold   False  10,136,396.85     +136,833.30    0.70%     0    False
12 hold   False  10,000,000.00           0.00    0.00%     0    False
13 hold   False  10,516,021.02     +533,519.47    2.62%     0    False
14 hold   False   9,880,518.77     -136,022.49    1.65%     3    True
15 hold   False  10,114,353.31     +119,415.56    0.49%     0    False
16 hold   False  10,000,000.00           0.00    0.00%     0    False
17 hold   False  10,010,550.69       +8,006.32    2.29%     0    False
18 hold   False   9,901,750.87      -90,306.46    1.75%     5    True
19 hold   False  10,142,502.00     +145,503.00    0.66%     0    False
20 hold   False  10,000,000.00           0.00    0.00%     0    False
```

- apply 自身也做了两次复跑：`_exchange-ai-result.json` 的 SHA-256 两次均为
  `3FADF9588C3616BB97F6A6592667E287CE41CC4EE0DCADA5B5A0F2873F0ACA13`（逐字节一致）。
- 额外混合动作冒烟（`_exchange-scenarios-smoke-actions.json`，非最终空跑结果）：
  19/20 执行成功、15 份有成交；覆盖买现货、开多/开空、全量/定量卖出、平仓；
  场景 08 故意用 `notional=1` 触发「买不到 1 股」拒单，结果正确记为
  `executed=false / error.code=unknown`，其余场景不受影响。

## 三、关键实现与口径

### 3.1 Node shim（动态 import 之前完成）

- `globalThis.window = globalThis`；`document = { visibilityState: 'visible', addEventListener, removeEventListener }`。
- `localStorage`：内存版 `Map`，提供 `getItem/setItem/removeItem/clear/key/length`；
  每建一份场景前 `clear()`，避免上一份的模拟盘持久化串场。
- `setInterval`：**假定时器**（只返回自增 id，不真正调度）。Mock 构造函数会
  `startEngine()` 建 1 秒定时器；无头模式必须换手动时钟，否则进程被 interval 吊住。
- `clearInterval` / `addEventListener('pagehide')` / `visibilitychange`：空操作。
- `Date.now`：冻结到 `2026-11-03 09:30:00 +08:00`，否则快照里的 `ts` 会随真实时间漂移，
  逐字节比对必然失败。
- Mock 的 `stop()` 只落盘、**不停止行情**（挂机语义），所以没有调 `stop()`；
  构造后直接清空私有 `timer` 并置 `null`，明确「引擎由本工具手动推进」。

### 3.2 手动时钟与私有 `advance()`

- 唯一依赖的私有实现是 `(client as any).advance(n)`（TypeScript `private` 只在编译期受限）。
- 为什么逐拍 `advance(1)` 而不是一次 `advance(1440)`：
  1. 最大回撤需要逐拍权益曲线；
  2. Mock 的 `advance(count)` 在 `count > 1` 时置 `silent = true`，会**抑制 `margin_call` 广播**，
     一次推进就检测不到强平，逐拍才能订阅到爆仓事件。
- 代价：`--apply` 每份 1440 次 `advance(1)` + `getAccount()`；实测 20 份约 0.5 s，可接受。

### 3.3 场景 recipe 与重建

- 配方只依赖 id：`seed = 20261103 + id × 104729`，`warmupTicks = 24 + id × 43`，
  `gapTicks = 3 + ((id × 5) % 4)`，焦点按 4 标的轮换。
- 预热动作按 `id % 4` 轮换：1=市价买现货、2=5x 开多、3=2x 开空、0=空仓；
  杠杆只用 2x/5x，快照间隔压到 3–6 拍，保证快照时仓位还活着（否则卡片写“预热开空”，持仓栏却是空的）。
- `recipe` 全量写进 `_exchange-scenarios.json`；`--apply` 用同一函数重建，并比对
  `fingerprint`（tick/价格/现金/持仓/快讯 id 的 SHA-256 前 16 位）。不一致会中止并提示重跑快照，
  不会拿错位的状态继续算。

### 3.4 动作语义

- 全部用**市价单**：Mock 的杠杆单是 IOC（吃不完即撤），限价不穿价会直接报 `no_liquidity`，
  对低思考档 AI 的验收没有意义。
- `buy_spot`：`notional` = 买入金额（默认 200,000），按卖一价折算股数。
- `buy_long` / `buy_short`：`notional` = 保证金（默认 200,000），
  `qty = floor(notional / (price × (1/L + fee)))`，校验标的 `maxLeverage`。
- `sell`：卖出现货；省略 `notional` = 全部可卖，给定则按买一价折算并夹到可卖量。
- `close`：平掉该标的最大一笔杠杆仓（先按 qty 降序取仓），不需要 notional/leverage。
- `hold`：不操作，仅占位。
- 动作失败不中止整批：记在 `error` 里，继续跑下一份；只有「场景指纹不一致」才整批中止。

### 3.5 指标口径

- `pnl = equityEnd - equityAfterAction`：本次动作持有期盈亏（动作手续费已计入 `after`）。
- `totalPnl = equityEnd - 10,000,000`：含暖场预热仓位影响的整段变化。
- `maxDrawdown / maxDrawdownPct`：动作后权益曲线的峰值回撤（正数，百分比）。
- `blownUp`：窗口内至少一个仓位被强平清空（`fullyClosed`），或期末权益 ≤ 0。
- `forwardMinutes(1440)`：任务书把 1 个「分钟刻度」按 1 拍推进，即 **1440 拍**。
  Mock 内 `TICKS_PER_GAME_DAY = 60`，所以实际跨越 **24 个游戏日**（约 70 次随机事件、24 次分红），
  比字面「1 游戏日」更狠；这是为了让 20 个场景在秒级内跑出足够的强平/回撤样本。
  `_exchange-ai-result.json` 的 `meta.forwardTicks = 1440` 与 `tickEnd = tickStart + 1440` 可核对。

## 四、已知风险

1. **私有 `advance()` 的兼容性**：`advance` 是 `private`，改名/改签名/改异步后本工具会直接报错
   （好过静默丢拍），但需要跟着改工具；它不属于 `ExchangeClient` 契约，Mock 重构没有义务保留。
2. **shim 覆盖度**：目前只补了 `window.setInterval/clearInterval/addEventListener/removeEventListener/
   localStorage` 与 `document.visibilityState/addEventListener/removeEventListener`。
   若 Mock 新增 `requestAnimationFrame`、`WebSocket`、`crypto`、`matchMedia` 等浏览器 API，
   或改用 `new Date()` 参与行情计算，工具会报错或失去可复现性。
3. **后续 UI 改动可能改变私有实现**：本工具依赖构造即启动、`advance(count)` 的步序、
   `margin_call` 广播、`stop()` 不停止行情等原型语义；UI 批次调整这些内部行为时，
   场景结果不能与旧记录直接比较。场景文件里的 `fingerprint` 只能发现「重建状态变了」，
   发现不了「同一状态但窗口内行为变了」。
4. **Mock 行情极度波动**：暖场 100–900 拍内就能出现 ±40% 的日内波幅（事件冲击 + 5 倍波动放大
   + Student-t 肥尾），50x 仓位可能在早期小幅回撤就强平、也可能吃到巨大单边。
   本批结果是「驱动与场景是否可用」的验证，**不是经济数值/杠杆平衡结论**。
5. **口径差异**：`forwardMinutes(1440)` 实际推进 1440 拍 = 24 个游戏日，不是 Mock 内的一日
   （60 拍）；对「1 游戏日」字面语义有疑问时以本节为准。`close` 之后 `pnl = 0` 是因为已无敞口，
   平仓本身的盈亏在 `totalPnl` 与 `equityAfterAction` 里。
6. **文件覆盖**：`--apply` 会直接覆盖 `_exchange-ai-result.json`（无历史版本）；
   跑混合动作冒烟会临时占用同一文件，最终已恢复为 hold 空跑结果。
7. **时间显示依赖本机时区**：快照 JSON 的时间戳是固定 epoch，跨机器一致；
   但场景卡里的 `HH:MM:SS` 用本机时区格式化，换时区后 Markdown 文本可能不同
   （JSON 与指纹不受影响）。
8. **预热仓位是合成夹具**：`sell`/`close` 需要对象，才在暖场后加了一笔 2x/5x 背景仓；
   它不代表 AI 的杠杆选择，也不参与 AI 评分。若后续不需要，可把 `preAction.kind` 全部设成 `none`
   后重跑快照。

## 五、复现命令

```powershell
# 1) 确定性自检（约 0.3 s）
npx tsx tools/_exchange-headless.ts --selftest

# 2) 生成 20 份场景与场景卡
npx tsx tools/_exchange-headless.ts --snapshot 20

# 3) 空跑（20 个 hold）
npx tsx tools/_exchange-headless.ts --apply _exchange-scenarios-hold-actions.json

# 4) 混合动作冒烟（可选，会覆盖 _exchange-ai-result.json）
npx tsx tools/_exchange-headless.ts --apply _exchange-scenarios-smoke-actions.json
```

## 六、边界确认

- 只新增上述文件；`git status --short` 里的其他未跟踪文件（`_exchange-playtest-report.md`、
  `tools/_exchange-playtest.ts`、`docs/design/*`）属于并行任务，未触碰。
- 未修改 `features/exchange/**`、未改 `package.json`、未接服务器/未发网络请求、未 commit / push。
- 观感与玩法验收仍由船长判定；本记录只证明「无头驱动 + 场景快照 + 决策回放」这条链路可用。
