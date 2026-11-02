# 云存档 / 聊天服务器 · 交接说明

> 收尾日期：2026-11-02　｜　代码位置：`apps/server/`　｜　状态：**服务端已上线可跑，公网入口待放行**

---

## 1. 一句话现状

后端已经完整可用并通过端到端验证（HTTP 15 项 + WebSocket 8 项全绿，单元/集成测试 83/83）。
**唯一卡点**：腾讯云控制台防火墙只放行 22 端口，外网访问不到 8787，需要手动加一条规则。
游戏客户端**尚未接入**，本来就说好「做到需要改前端时再通知」——现在正是那个点。

---

## 2. 服务器

| 项目 | 值 |
| --- | --- |
| 实例 | `lhins-2ko2lh7m`（轻量应用服务器） |
| 公网 IP | `123.207.188.192` |
| 登录 | `ubuntu` / 免密 sudo |
| 系统 | Ubuntu 24.04.4 LTS，2 核 / 1.9 G 内存 / 40 G 盘（已用 16%） |
| Node | v22.21.1，装在 `/usr/local/lib/nodejs`，`/usr/local/bin/npx` 可用 |
| 代码目录 | `/home/ubuntu/whale-server`（39 M，含 `content-csv/`、`public/`、`node_modules/`） |
| 服务单元 | `whale-server.service`（systemd，`Restart=always`，端口 8787） |
| 数据库 | `/home/ubuntu/whale-server/data/whale-server.db`（SQLite，当前 692 K） |
| 备份 | `/var/backups/whale/`，root crontab 每日 04:20 执行 `/usr/local/bin/whale-backup.sh`（内部用 `VACUUM INTO` 生成一致快照，正确做法），保留 7 天 |
| 服务器防火墙 | ufw 已启用，放行 22 / 8787（配置正确，不是卡点） |
| 实测负载 | 内存 509/1967 MB，负载 0.00，基本空转 |

常用命令：

```bash
sudo systemctl status whale-server       # 看状态
sudo systemctl restart whale-server      # 重启（改静态文件后必须重启，服务有内存缓存）
sudo journalctl -u whale-server -n 100 -f # 看日志
curl -s http://127.0.0.1:8787/health     # 健康检查
```

---

## 3. 上线前必须先还的安全债

按重要性排序，**转为正式服之前一条都不能省**：

1. **重置 ubuntu 密码**——当前密码在对话记录里明文出现过，视为已泄露。
2. **改 SSH 密钥登录，关闭密码登录**（`PasswordAuthentication no`）。
3. **换 `WHALE_ITEM_SEED`**——默认值是 `whale-dev-seed-change-me`，物品实例签名会被人逆推。
4. **防火墙只留 22 / 80 / 443**，8787 仅在测试期开放，正式服建议走 Caddy 反代 443 后关掉 8787。
5. 加域名 + Caddy 自动 HTTPS（WebSocket 走 `wss://` 才能被 https 页面调用）。

---

## 4. 立刻要做的唯一动作（放行 8787）

腾讯云控制台 → 轻量应用服务器 → 实例 `lhins-2ko2lh7m` → **防火墙** → 添加规则：

- 应用类型：自定义
- 协议：**TCP**
- 端口：**8787**
- 来源：`0.0.0.0/0`

加完即可访问 `http://123.207.188.192:8787/`（云端客户端）。

> 已用 tcpdump 抓包确认：外部连接时服务器网卡**一个包都收不到**，所以问题 100% 在控制台这一层，服务器内部无需再改。

**临时替代方案**：SSH 隧道也能用，本机 `18787` 映射到远端 `8787`，浏览器开 `http://localhost:18787` 即可。隧道脚本是临时的，重启电脑就没了，不能当正式方案。

---

## 5. 代码地图

```
apps/server/
├── src/
│   ├── main.ts            进程入口：建库、读配置、起 HTTP+WS
│   ├── config.ts          全部配置（环境变量 + 默认值）
│   ├── db.ts              SQLite 建表与迁移
│   ├── auth.ts            设备码注册/登录、恢复码生成轮换与换机迁移
│   ├── http-api.ts        REST 路由分发（唯一出口）
│   ├── chat.ts            WebSocket 双频道聊天、3 秒打包帧、在线名单
│   ├── catalog.ts         读 content-csv 建物品/舰船目录、最低价基准
│   ├── ledger.ts          双分录账本 + prev_hash 哈希链、余额校验
│   ├── production.ts      产出上报校验（配额 + 比例闸门 + 审计）
│   ├── market.ts          冻结式挂单撮合、5% 税、最低价拦截
│   ├── instance-props.ts  实例属性快照白名单校验（舰船/装备/蓝图）
│   ├── rate-limit.ts      进程内滑动窗口限流
│   ├── static.ts          静态文件服务（白名单 MIME、拒绝路径穿越）
│   └── app.ts             组装 HTTP/WS handler
├── public/                云端客户端（纯静态，可直接给玩家看）
│   ├── index.html / app.css / app.js
│   ├── api-client.js      REST + WS 封装，**不依赖 DOM**，正式接入直接复用
│   ├── chat-queue.js      3 秒打包队列，计时器可注入（便于测试）
│   └── debug.html         调试台（/debug 仍可访问）
├── content-csv/           游戏数据副本（物品/舰船/配方等）
└── README.md              接口一览 / 环境变量 / 部署清单
```

---

## 6. 关键设计口径（改代码前必读）

| 主题 | 口径 |
| --- | --- |
| 权威模型 | 混合权威：存档由客户端计算，**物品与信用点的进出必须过服务器账本** |
| 账号 | 设备码注册即登录；恢复码用于换机迁移（可轮换，旧码作废） |
| 存档 | 保留 10 个历史版本；`baseVersion` 落后于服务器则返回 409，防旧档覆盖新进度 |
| 聊天 | `zh` / `en` 双频道；客户端 3 秒打包一帧；每帧 ≤5 条、单条 ≤500 字；每频道保留 5000 条 |
| 账本 | 双分录 + `prev_hash` 哈希链，只追加；`escrow_delta` 单独记冻结变动；禁负余额；`/api/ledger/verify` 校验链 |
| 市场 | 冻结式挂单（卖单锁物品、买单锁钱），价格优先/时间优先，**成交价取 maker 报价**；抽 5% 税入系统账户；禁自成交 |
| 最低价 | `floor = floor(basePrice × WHALE_FLOOR_RATIO)`，默认 0.6，**只卡新卖单，不撤旧单** |
| 产出校验 | 逐物品上限：原料 `min(kind硬顶, max(配额÷基准价, 2000保底))`；成品/珍稀 `min(kind硬顶, 配额÷基准价)`（最低 1）。配额默认 50 万 cr/分钟 |
| 批量闸门 | 比例制：`Σ(入账量 ÷ 各自上限) ≤ 3`，超限**整批拒绝**并写入 `production_events` 审计 |
| 舰船快照 | 白名单 `hullId/name/fit/plugs/hp`；`hullId` 必须等于商品定义；`fit` 不超槽位且每件为 module；`plugs` ≤8；`hp` ≤ 白板×2+1000；≤2 KB |
| 蓝图 | 普通蓝图消耗 1 本永久学会；`singleUse` 图纸只能造一次、不能学；均按实例流转 |
| 限流 | 每 IP 每分钟 600 次；注册/登录 20 次；429 带 `retry-after`。`WHALE_TRUST_PROXY=1` 时读 `X-Forwarded-For`（**上 Caddy 后必须开**） |
| 实例签名 | `signInstance(seed, instanceId, itemDefId, ownerId)` = HMAC-SHA256 前 32 位 |

完整设计档：`docs/design/cloud-server-20261102.md`

---

## 7. 环境变量（`src/config.ts`）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `WHALE_SERVER_PORT` | 8787 | 监听端口 |
| `WHALE_SERVER_DB` | `data/whale-server.db` | 数据库路径 |
| `WHALE_SAVE_MAX_BYTES` | 10 MB | 单档上限 |
| `WHALE_SAVE_HISTORY` | 10 | 存档历史版本数 |
| `WHALE_CHAT_HISTORY` / `WHALE_CHAT_RETENTION` | 100 / 5000 | 拉取条数上限 / 每频道保留 |
| `WHALE_CHAT_BATCH_MAX` / `WHALE_CHAT_INTERVAL_MS` / `WHALE_CHAT_MSG_CHARS` | 5 / 3000 / 500 | 打包帧约束 |
| `WHALE_FLOOR_RATIO` | 0.6 | 最低价系数 |
| `WHALE_TRADE_TAX` | 0.05 | 成交税率 |
| `WHALE_PROD_VALUE_QUOTA` / `WHALE_PROD_BATCH_RATIO` / `WHALE_PROD_MAX_ENTRIES` | 500000 / 3 / 50 | 产出配额与闸门 |
| `WHALE_ITEM_SEED` | `whale-dev-seed-change-me` | **正式服必须换随机串** |
| `WHALE_RATE_AUTH` / `WHALE_RATE_GLOBAL` | 20 / 600 | 限流阈值（次/分钟） |
| `WHALE_TRUST_PROXY` | 未开 | 反代后设 `1` |

改环境变量：编辑 `/etc/systemd/system/whale-server.service` 的 `Environment=` 行，然后
`sudo systemctl daemon-reload && sudo systemctl restart whale-server`。

---

## 8. 部署与验证

**部署**（改完代码后）：

```bash
# 本机打包源码（data/ 与 node_modules/ 不要传）
scp -r apps/server/src apps/server/public apps/server/content-csv apps/server/package.json ubuntu@123.207.188.192:~/whale-server/
ssh ubuntu@123.207.188.192 'sudo systemctl restart whale-server && curl -s http://127.0.0.1:8787/health'
```

> 注意：`public/` 的文件是**启动时读进内存缓存**的，改了必须重启服务才生效。

**本地验证**：

```bash
cd apps/server && npm test        # 83 个测试
npm run typecheck                 # 零错误
```

**已验证过的端到端链路**（2026-11-02，经隧道跑真机）：

- HTTP：健康检查、设备码注册、档案读写、存档上传 v1→v2、旧版本 409 冲突、历史版本列表、市场目录搜橄榄岩（basePrice 12 / floor 7）、订单簿、未知物品 404、钱包、库存、账本哈希链 `chainOk=true`、聊天历史
- WebSocket：`hello` 携带双频道、`presence` 上线通知、zh/en 频道互不串台、单帧超 5 条被拒、3 秒发言间隔限流、消息落库
- 防护实测：昵称重复 409、设备码非 8~64 位字母数字 400、注册 20 次/分钟限流

---

## 9. 待办（按优先级）

**P0 — 能用**
1. 控制台放行 TCP 8787，公网访问 `http://123.207.188.192:8787/` 走一遍真实浏览器流程。

**P1 — 能正式**

2. 还清第 3 节五笔安全债。
3. 域名 + Caddy 反代 443，开 `WHALE_TRUST_PROXY=1`，客户端地址改 `https://`。
4. 检查备份真的每天在跑（明天 04:20 之后看 `/var/backups/whale/` 是否多出文件）。

**P2 — 接游戏（这是下一个对话最可能做的事）**

5. 复用 `public/api-client.js` + `public/chat-queue.js` 接进客户端，开关式：不填服务器地址就单机玩。
6. 接入面板四块：
   - 云端设置：服务器地址、设备码、昵称、恢复码、同步按钮
   - 聊天窗口：zh/en 双频道 + 在线名单
   - 市场界面：搜索、订单簿、挂单/撤单、我的订单
   - 库存/钱包/账本：与本地存档对账，物品实例以服务器为准

**P3 — 运营（目前故意没做）**

7. 管理后台：封禁、删档、人工补发。
8. 举报与聊天审计流程。

---

## 10. 临时工具说明

调试期用过的 SSH 脚本放在本机 `%TEMP%\whale-ssh`（`probe.js` / `status.js` / `netcheck.js` / `snif.js` / `e2e.js` / `e2e-chat.js` / `tunnel.js`），基于 ssh2 库写的，**里面硬编码了明文密码**，重启电脑后会被清理。正式点上线后不要再依赖它们，改用 SSH 密钥 + `scp`/`rsync`。

---

## 11. 收尾动作记录（2026-11-02 15:00）

- 服务器测试数据已清空：重置前 25 个测试账号 / 4 份存档 / 8 条消息 / 7 条账本流水，现全部为 0，服务已重启并健康。数据库是全新库，可以直接当正式服开始用。
- 备份目录只保留一份有效快照 `whale-server-20261102-1321.db`（已验证可读）。手动搬出的 `testdata-*.db` 因为只搬主库没带 WAL 无法打开，已删除，避免将来恢复时误用。
- 临时 SSH 隧道已关闭，`http://localhost:18787` 不再可用——正式入口等控制台放行 8787。
- 全量测试 83/83 通过，`tsc --noEmit` 零错误。

---

## 12. 工作树未提交说明

当前 `main` 分支同时有**两批**未提交改动，**不要混在一个 commit 里**：

**本项目（云服务器）产生的**：
- `apps/server/`（整个目录，未跟踪）
- `docs/design/cloud-server-20261102.md`（未跟踪）
- `.gitignore` 追加 3 行（忽略 `apps/server/data/`）
- `package-lock.json`（为 `apps/server` 登记 `ws` 依赖）

**另一批在途改动（release-rights，不是云服务器工作）**：
`AGENTS.md`、`README.md`、`apps/desktop/*`、`docs/*`、`package.json`、`tools/release-rights/`、`LICENSE.txt`、`web/vite.config.ts`

建议提交顺序：

```bash
# 先提交云服务器这一批
git add apps/server .gitignore docs/design/cloud-server-20261102.md package-lock.json
git commit -m "feat(server): 云存档与双频道聊天服务器"

# release-rights 那批按它自己的节奏提交
```
