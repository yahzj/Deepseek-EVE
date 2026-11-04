# 证券交易所 · Go 技术栈与开源参考调研

> 状态：调研稿（**未动手**）　｜　日期：2026-11-03
> 船长口径（2026-11-03）：「而且最好用go，可以参考人家成熟的」「开源的项目」
> 关联：`stock-exchange-parallel-20261103.md`（并行化决策）、`stock-exchange-backend-b0-20261103.md`（当前 Node B0-1）

---

## 结论先行

1. **选 Go 合理**：撮合引擎的核心诉求（单写者、低延迟、内存可控、静态部署、goroutine 按标的并行）正好是 Go 的强项；2 核机器上比 Node 更容易吃满。
2. **有可直接借鉴的成熟开源**：首选 `intrepidkarthi/orderbook`（Go、MIT、可嵌入、带 WAL/恢复/威胁模型文档），我们知识库已蒸馏过；其余为学习/架构参考，不建议直接当产线依赖。
3. **关键架构共识（比语言更重要）**：**单本订单簿不可并行化**，只能「一个标的 = 一个单写者 goroutine」；并行靠**多标的/多市场分片**。2 核机器上就是「2 个标的并行撮合」，不是把一个簿拆成两半。
4. **可抄清单**：单写者 + 事件流、WAL + 快照恢复、定点整数、盘口价层结构、按标的 shard、操纵威胁模型（spoofing/洗盘/收盘价操纵）。
5. **必须自研**：杠杆/保证金/强平/借券/资金费、AI 人格、游戏化税制与分红、与游戏钱包/账本的对接、确定性回放与对账——开源库只解决「撮合」这一层。
6. **进程边界建议**：Node 主服务（账号/存档/钱包账本/聊天/代理） + **Go 交易所服务**（订单簿/撮合/行情/后续杠杆引擎），资金仍由 Node 单写（Go 通过内部幂等结算接口）。

---

## 一、开源候选清单（按可用度排序）

| 项目 | 语言/许可 | 是什么 | 借鉴价值 | 成熟度判断 |
|---|---|---|---|---|
| [intrepidkarthi/orderbook](https://github.com/intrepidkarthi/orderbook) | Go / MIT | 可嵌入 CLOB + 撮合引擎，定点小数、价格-时间优先；文档含交易所架构、WAL/恢复、操纵威胁模型 | **最高**：数据结构、单写者模型、恢复方案、威胁模型 | 库级可用，生产前需自测；文档质量高 |
| [Curton/GoMatchingKernel](https://pkg.go.dev/github.com/Curton/GoMatchingKernel) | Go / 学习项目 | SkipList 撮合、GTC/IOC/FOK/POC、WAL、快照、redo | 读代码学撮合细节与 WAL 设计 | 作者自述「study project」，不建议产线直接用 |
| [mtepenner/hft-matching-engine](https://github.com/mtepenner/hft-matching-engine) | C++ 簿 + Go 网关 | LMAX Disruptor 架构、锁自由 ring buffer、FIX 网关 | 架构图与低延迟工程手法 | 演示项目，撮合核心非 Go |
| [raiashpanda007/rivon](https://socket.dev/go/package/github.com/raiashpanda007/rivon) | Go/TS 全栈 | 加密交易所参考：Redis Stream 驱动引擎、内存钱包校验、DB writer、WS 网关 | 多服务拓扑与「钱包校验在内存」思路 | 架构参考，组件多、依赖重 |
| [smarty/go-disruptor](https://coscup.org/2026/session/KXANFQ/) | Go | Ring buffer 并发原语 | 高吞吐事件传递（我们的量级用 channel 就够） | 原语级，非业务 |

> 注：以上信息来自公开检索结果（外部内容，仅作参考），落地前需核对许可证与维护状态。

---

## 二、可抄清单（按优先级）

1. **单写者原则**：一个标的的订单簿只由一个 goroutine 写；外部命令经 channel 投递给它。并行轴 = 标的数量，不是同一簿多线程。
   - 公开 benchmark 显示：1 簿 ≈ 87.6 万 ops/s，2 簿并行 164 万、4 簿 197 万（GOMAXPROCS=4）——**分片才是扩展路径**。
2. **事件流 + WAL**：撮合产生不可变事件（成交/订单状态变更），先 WAL 再改物化状态；恢复 = 快照 + 重放。
3. **定点整数**：价格/数量全整数，禁止浮点（我们 Node 版已按此约定）。
4. **价层结构**：买盘降序/卖盘升序的价层映射 + 档内 FIFO；五档聚合 O(1)~O(logN)。
5. **威胁模型**：spoofing（虚假挂单）、wash trading（自成交/对敲）、marking the close（收盘价操纵）——直接对应我们「坐庄监管罚没」的检测规则。
6. **行情扇出**：撮合线程只产出事件，WS 推送由独立 goroutine/连接池消费，不阻塞撮合。

## 三、必须自研（开源不覆盖）

- 杠杆/保证金/强平/借券/资金费（设计稿已定：90x、双仓位模式、档位费率、标记价防插针）；
- AI 人格生态（六个人格、情绪/记忆/适应、公平红线）；
- 游戏化税制、分红池、保险基金、销毁池科目；
- 与游戏钱包/账本的接入（服务端权威、单写）；
- 确定性回放、审计与对账（跨 Node/Go 两进程）。

---

## 四、推荐技术选型（Go 交易所服务）

| 项 | 选择 | 理由 |
|---|---|---|
| 运行时 | Go 1.22+，`GOMAXPROCS=2` | 2 核直接用满；按标的 goroutine 分片 |
| HTTP | 标准库 `net/http` | 无需框架，减少依赖 |
| WebSocket | `github.com/coder/websocket`（或 gorilla/websocket） | 行情推送 |
| 存储 | SQLite（`modernc.org/sqlite` 纯 Go 静态编译） | 与现有服务端一致；单机规模足够 |
| 进程间通信 | 先 HTTP/JSON over Unix socket + 共享密钥；后续可升 gRPC | 简单可调试，避免过早引入 protobuf |
| 部署 | 两个 systemd 单元：`whale-server`(8787) + `whale-exchange`(8788 localhost) | 隔离与独立重启 |

---

## 五、进程边界与资金一致性

```
客户端 ──▶ Node 主服务(8787) ──反向代理──▶ Go 交易所(8788, localhost)
              │  鉴权/存档/钱包/账本            │ 订单簿/撮合/行情/(后续杠杆/AI)
              │  唯一写库者                     │ 不直接改钱包
              └────── 内部幂等结算 API ◀────────┘ 成交后请求记账，主服务写 ledger 并回执
```

- **资金单写**：Go 侧只在内存记账与停机快照；每笔成交/费用调用主服务 `/internal/settle`（幂等 batchId），主服务写 `ledger_entries` 与钱包。
- **失败补偿**：Go 侧保留 pending settle 队列，主服务不可用时重试；对账任务定期比对两边余额。
- **鉴权**：主服务代理时校验 Bearer 并注入内部头 + 共享密钥；Go 只信任来自 localhost 代理的请求。
- **确定性**：Go 侧全整数、固定种子、事件日志；重启从自身 SQLite 恢复订单簿与 seq。

---

## 六、风险

1. **双运行时**：服务器要装 Go、多一个 systemd/日志/监控；部署脚本变复杂。
2. **跨进程资金一致性**：幂等 + 对账必须做对，否则会出「成交了但钱没扣」的事故。
3. **规则漂移**：Node 版 B0-1 已有测试；Go 版要重建等价测试，避免两套口径。
4. **过早优化**：当前 4 标的、撮合极轻，Go 的收益主要是「隔离 + 未来扩容」，不是眼前性能。
5. **许可证合规**：引用库前核对 MIT/Apache 与署名要求。

---

## 七、下一步（待船长点头，不动手）

1. 先读成熟实现（`intrepidkarthi/orderbook` 文档 + GoMatchingKernel 源码），产出一份「裁剪清单」：哪些直接抄、哪些改造、哪些自研；
2. 再做 Go 撮合服务最小骨架（不接资金，先跑通下单/撤单/盘口/成交事件 + 测试）；
3. 最后接内部结算与主服务代理，保留 Node B0-1 作对照与回滚。

---

## 八、存储结构设计（Go 服务版）

### 8.1 总原则：两张账，分开存，各自单写

| 存储 | 归属 | 存什么 | 写入者 |
|---|---|---|---|
| **钱账** `whale-server.db`（SQLite） | Node 主服务 | 账号/sessions、云存档、聊天、钱包、**账本**、交易所资金账户、入金/出金、现货市场、销毁池 | 只有 Node 写 |
| **市账** `whale-exchange.db`（SQLite）+ 事件日志 | Go 交易所 | 订单、成交、盘口快照、K 线、市场事件、AI 人格状态、市场审计 | 只有 Go 写 |

> 两个进程绝不共写同一个 SQLite 文件：SQLite 单写者 + 无跨进程事务，共写必然出现写锁竞争与「成交了但钱没扣」的不一致。分开存、用幂等结算接口与日对账连接。

### 8.2 Go 侧表结构（首批）

| 表 | 关键列 | 索引/约束 |
|---|---|---|
| `exchange_orders` | id、account_id、client_order_id、code、side、type、price、qty、qty_remaining、status、seq、created_at、updated_at | `UNIQUE(account_id, client_order_id)`；`(code, side, status, price, seq)` |
| `exchange_trades` | id、code、buy_order_id、sell_order_id、buyer_id、seller_id、qty、price、gross、fee、settle_batch_id、created_at | `(code, id DESC)`；`(settle_batch_id)` 用于对账/幂等 |
| `exchange_positions`（B1） | account_id、code、side、qty、avg_entry、leverage、margin、realized_pnl、updated_at | `PK(account_id, code, side)` |
| `exchange_margin_events`（B1） | id、account_id、code、kind(强平/调整)、price、qty、detail_json、created_at | `(account_id, id DESC)` |
| `exchange_klines` | code、interval、bucket_ts、o/h/l/c/v | `PK(code, interval, bucket_ts)`，保留 30 天 |
| `exchange_events` | id、code/sector、type、payload_json、starts_at、ends_at | `(code, starts_at)` |
| `exchange_agents`（B2） | persona、capital、positions_json、emotion、memory_json、updated_at | PK(persona) |
| `exchange_audit` | id、account/persona、kind、ref、detail_json、ts | 只追加 |
| `exchange_meta` | key/value：`seq`、`rng_seed`、`rng_counter`、`contract_version` | PK(key) |
| `exchange_snapshots` | id、taken_at、last_seq、book_json、orders_json | 保留最近 N 份 |

### 8.3 运行时与恢复

1. **内存权威**：订单簿、seq、持仓缓存全在内存；表是持久化副本。
2. **事件日志（WAL）**：每拍产出的事件（下单/撤单/成交/状态变更）**先 append 到事件日志文件**（行式 JSON/二进制，带校验），再异步批量写表。
3. **快照**：每 N 分钟或每 M 条事件写入 `exchange_snapshots`（五档聚合 + 全量未成交订单 + seq + 随机数状态）。
4. **恢复**：启动 = 载入最近快照 → 重放快照后的事件日志 → 重建内存簿 → 校验 `seq` 单调；与 Node 通过 `settle_batch_id` 对账补差。
5. **停机**：`SIGTERM` 时先停撮合、flush 事件日志、写最终快照，再退出。

### 8.4 与 Node 的钱账衔接

- 每笔成交/费用汇总为一个 **settle batch**：Go 调 Node `/internal/settle`，Node 在单事务里写 `ledger_entries` + 钱包 + `exchange_accounts`，返回 batch 回执；
- Go 侧 `exchange_trades.settle_batch_id` 记录回执；未回执的批次进 pending 队列重试；
- **每日对账任务**：`Σ Go 成交资金变化 == Node 账本资金变化`，差异报警并人工核对；
- 入金/出金仍由 Node 处理（钱账唯一写者），Go 只读余额缓存并在结算时更新。

### 8.5 容量估算（2 核 / 40G 盘现用 5.9G）

| 数据 | 估算 |
|---|---|
| 成交 | 4 标的 × 每日至多数千笔 ≈ 1~2 万行/日（很小） |
| 1 分钟 K 线 | 4 × 1440 = 5,760 行/日，30 天 ≈ 17 万行 |
| 事件日志 | 每拍最多数十条，压缩后每天几十 MB；保留 7 天即可 |
| 快照 | 每份几十 KB~几 MB，保留最近 10 份 |

> 结论：数据量对 SQLite/单机完全无压力；重点不是容量，而是**恢复正确性与跨进程对账**。

