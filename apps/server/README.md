# @whale/server — 云存档与聊天服务器

大鲸鱼-深空放置的在线服务端：**设备码免登录 + 恢复码找回 + REST 云存档（带历史版本）+ WebSocket 双频道聊天 + 双分录账本 + 订单簿市场**。
可独立部署：不依赖仓库其他 workspace，把本目录整个拷到服务器即可（另需内容表目录 `content-csv/`）。

> 运行环境要求：Node.js ≥ 22.5（用到内置 `node:sqlite`，无需编译原生模块）。

## 本地运行

```bash
npm install                       # 在仓库根执行一次（workspace 自动装好依赖）
npm run start -w @whale/server    # 启动，默认 0.0.0.0:8787
npm run test -w @whale/server     # 全部测试（83 个确定性用例）
```

数据落盘在 `apps/server/data/whale-server.db`（SQLite，自动建目录，已加入 .gitignore）。
内容表默认读 `content-csv/`（items.csv / market.csv / ships.csv / modules.csv / plugs.csv / plugBlueprints.csv）。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `WHALE_SERVER_PORT` | 8787 | 监听端口 |
| `WHALE_SERVER_DB` | `data/whale-server.db` | SQLite 路径 |
| `WHALE_CONTENT_DIR` | `content-csv` | 内容表目录 |
| `WHALE_SAVE_MAX_BYTES` | 10485760 | 单份存档字节上限（10MB） |
| `WHALE_SAVE_HISTORY` | 10 | 每账号保留存档历史版本数 |
| `WHALE_CHAT_HISTORY` | 100 | 聊天历史拉取上限 |
| `WHALE_CHAT_RETENTION` | 5000 | 每频道保留消息条数（超出删最旧） |
| `WHALE_CORS_ORIGIN` | `*` | 允许跨域的来源（网页版在 GitHub Pages，跨域必需） |
| `WHALE_CHAT_BATCH_MAX` | 5 | 单个打包帧最大消息条数 |
| `WHALE_CHAT_INTERVAL_MS` | 3000 | 相邻打包帧最小间隔（限频） |
| `WHALE_CHAT_MSG_CHARS` | 500 | 单条消息字符上限 |
| `WHALE_NICK_MAX_CHARS` | 24 | 昵称字符上限 |
| `WHALE_FLOOR_RATIO` | 0.6 | 公共市场最低价系数（floor = basePrice × 系数） |
| `WHALE_TRADE_TAX` | 0.05 | 交易税（从卖方收入扣） |
| `WHALE_PROD_MAX_ENTRIES` | 50 | 单次产出上报最多物品种类数 |
| `WHALE_PROD_VALUE_QUOTA` | 500000 | 每分钟允许入账的物品**价值**配额（信用点）；逐物品上限 = min(类别硬顶, 配额 ÷ 基准价) |
| `WHALE_PROD_BATCH_RATIO` | 3 | 叠加闸门：同一分钟内各物品「占各自上限比例」之和的上限 |
| `WHALE_RATE_AUTH` | 20 | 每 IP 每分钟注册/登录次数上限 |
| `WHALE_RATE_GLOBAL` | 600 | 每 IP 每分钟总请求数上限 |
| `WHALE_TRUST_PROXY` | 关 | 放在 Caddy 反代后面时设 `1`（读 X-Forwarded-For）；直连公网时必须关，否则限流可被伪造头绕过 |
| `WHALE_ITEM_SEED` | 开发用默认值 | 物品实例签名种子，**生产必须换随机串** |

## 通用约定（客户端接入前必读）

- 请求与响应都是 JSON；出错统一返回 `{code, message}`；
- 客户端只需要「**服务器地址 + 端口**」一个配置项（例 `http://1.2.3.4:8787`），WebSocket 由同地址推导（`http→ws`、`https→wss`）；
- 推荐接入顺序：注册/登录拿 token → `GET /api/saves/latest` 与本地比较 → 上传或下载存档 → 连 WebSocket 聊天 → 需要交易时再拉 `/api/wallet`、`/api/inventory`、`/api/ledger/entries?since=`；
- 限流：每 IP 每分钟 600 次总请求、20 次注册/登录；超限返回 **429 + `retry-after` 头**，客户端应退避重试而不是死循环；
- 状态码约定：

| 状态码 | 含义 | 典型场景 |
|---|---|---|
| 400 | 参数非法 | 设备码格式、缺 `hullId`、快照字段不合法 |
| 401 | 未登录 / token 失效 | 重新登录即可（旧 token 会被新登录顶掉） |
| 404 | 不存在 | 设备未注册、指定版本的存档不存在 |
| 409 | 冲突 | 昵称被占用、存档 `baseVersion` 落后、挂单时物品/实例不在手 |
| 413 | 体积超限 | 存档 > 10MB、请求体过大 |
| 422 | 业务规则拒绝 | 卖单低于最低价、产出超速率/价值上限 |
| 429 | 限流 | 见上 |
| 500 | 服务器内部错误 | 已被兜底捕获，不会泄露堆栈 |

## 接口一览

鉴权：`Authorization: Bearer <token>`（注册/登录时签发，重新登录会使旧 token 失效）。

### 账号与恢复

| 接口 | 说明 |
|---|---|
| `POST /api/auth/register` | `{deviceCode, nickname}` → `{token, playerId, nickname, recoveryCode}`；恢复码只在注册时返回一次 |
| `POST /api/auth/login` | `{deviceCode}` → 同上（不含恢复码）；设备不存在返回 404 |
| `POST /api/auth/recovery/redeem` | `{recoveryCode, deviceCode}` → 迁移到新设备并返回新 token；旧设备码立即失效 |
| `POST /api/auth/recovery/rotate` | 重新签发恢复码，旧码作废 |
| `GET/PUT /api/profile` | 查询 / 修改昵称 |

### 云存档

| 接口 | 说明 |
|---|---|
| `GET /api/saves/latest` | `{version, data}`；从未上传返回 `{version: 0, data: null}` |
| `PUT /api/saves` | `{data, baseVersion?}`；`baseVersion` 落后于服务器版本 → **409 save_conflict**，省略视为强制覆盖 |
| `GET /api/saves/versions` / `GET /api/saves/versions/:v` | 历史版本列表 / 下载指定版本 |

### 产出、钱包、库存

| 接口 | 说明 |
|---|---|
| `POST /api/production/report` | `{batchId, clientTs?, items:[{itemDefId, qty, instanceId?, props?}]}`；幂等批次、逐物品每分钟上限 + 跨物品总产值闸门，超限整批拒绝并记审计 |
| `GET /api/wallet` | `{credits, escrow, available}` |
| `GET /api/inventory` | 可堆叠物（含冻结量）与实例物品（含属性快照） |
| `GET /api/items/verify?instanceId=` | 返回服务器签名 `HMAC(id|定义|归属)`，用于客户端校验实例真伪 |

### 市场（订单簿）

| 接口 | 说明 |
|---|---|
| `GET /api/market/catalog?q=` | 物品目录，含 `basePrice`、`floorPrice`、`instanceBased` |
| `GET /api/market/book/:itemDefId` | 买卖盘（价格聚合）+ 最低价 |
| `POST /api/market/orders` | `{side, itemDefId, qty, price, instanceId?}`；卖单低于最低价返回 **422 below_floor_price** |
| `DELETE /api/market/orders/:id` | 撤单，退回冻结资产 |
| `GET /api/market/orders/mine` / `GET /api/market/trades?itemDefId=` | 我的订单 / 近期成交 |

### 账本与审计

| 接口 | 说明 |
|---|---|
| `GET /api/ledger/entries?since=&limit=` | 自己的流水（带 `hash`，可本地复核） |
| `GET /api/ledger/verify` | 全链哈希校验，返回 `{chainOk, checked, brokenAt}` |

## 经济规则（实现口径）

- **物品唯一编号**：实例物品（舰船/装备/蓝图/AI 核心）由服务器签发 `instanceId + HMAC 签名`，归属以 `items` 表为准；
- **产出半权威（逐物品阈值）**：客户端上报结算批次，服务器对**每个物品**单独算上限：
  - 原料/材料（可堆叠、单价 ≤ 2000 cr）：`min(类别硬顶, max(配额 ÷ 基准价, 2000))`——**有 2000/分钟的数量保底**，否则 1300 cr 的虚空母矿会被价值折算压到 384/分钟，正常采矿全被误拒；
  - 成品与珍稀掉落（装备/舰船/蓝图/核心、高价箱与黑匣）：`min(类别硬顶, 配额 ÷ 基准价)`，最低 1；
  - 再叠加**叠加闸门**：同一分钟内「各物品入账量 ÷ 各自上限」之和不得超过 `WHALE_PROD_BATCH_RATIO`（默认 3）。
    用**比例**而不是绝对产值，是因为绝对闸门会误杀单件高价物——一艘 6750 万的战列舰本身就超过任何合理的「每分钟产值」。
  效果：12 cr 橄榄岩 8000/分钟、1300 cr 虚空母矿 2000/分钟、1200 cr 的穿梭机 4 艘/分钟、6750 万战列舰与 8000 万黑匣各 1 个/分钟，531 个物品无需逐物手配数字；
  口径参考：满技能最优矿船实测约 5 万 cr/分钟毛收入、约 3000 单位/分钟，默认配额 50 万 = 10 倍安全余量。超限整批拒绝（不部分入账）并写 `production_events` 审计；
- **最低价**：`floor = floor(basePrice × WHALE_FLOOR_RATIO)`，只约束新挂卖单；存量挂单不撤、可继续成交；
- **冻结式挂单**：卖单冻结物品（`item_stacks.locked` / `items.status='listed'`），买单冻结信用点（`wallets.escrow`）；撤单或成交后剩余冻结原路退回；
- **撮合**：价格优先、时间优先；**成交价取先挂单方（maker）报价**，买方多冻结的差额在订单结束时退回；**不允许自成交**；
- **交易税**：成交额 × 5%，从卖方收入扣，进系统账户（不回收给玩家，作为货币回收池）；
- **账本**：所有资产变动先写 `ledger_entries`（双分录、`prev_hash` 哈希链、只追加），再改物化状态，同一事务完成；篡改任意一条都会被 `ledger/verify` 定位。

### 实例快照校验（防改档）

舰船按实例流转，快照就是市场里的「货况」，所以服务端对**舰船**做严格校验（规则在 `src/instance-props.ts`）：

| 规则 | 说明 | 错误码 |
|---|---|---|
| 必须有 `hullId` | 且必须等于商品定义（防拿便宜船套贵船壳） | `missing_ship_props` / `ship_hull_mismatch` |
| 字段白名单 | 只允许 `hullId`、`name`、`fit`、`plugs`、`hp` | `unknown_ship_prop` |
| 装配不超槽位 | `fit` 件数 ≤ ships.csv 的高+中+低槽总数，且每件必须是已知装备 | `ship_fit_overflow` / `unknown_module` |
| 插件不超 8 个 | `plugs` 每项必须是已知物品 | `bad_ship_plugs` / `unknown_plug` |
| 耐久不超白板 2 倍+1000 | 给装配与插件加成留余量，超出视为改档 | `ship_hp_overflow` |
| 快照 ≤ 2KB | 所有实例物品通用 | `props_too_large` |

装备/蓝图/AI 核心不做价值校验（价值由 `basePrice` 决定），只校验「是对象 + ≤ 2KB」。

### 蓝图规则（与游戏内一致）

- **普通蓝图**：一本书 = 一个实例，学习时消耗 1 本并永久记入 `learnedRecipes`；多余的仍可挂市场交易；
- **一次性图纸**（`singleUse`）：不能学习，只能到组装机用掉一次；同样按实例流转；
- 服务端只保证「一本蓝图 = 一个唯一实例、归属唯一」，是否已学属于存档内容（客户端演算 + 云存档备份）。

## WebSocket 聊天

连接：`ws(s)://<host>/api/chat/ws?token=<token>`。

- 频道：`zh` / `en`；
- 打包帧：`{"type":"batch","channel":"zh","messages":["你好","挖矿去了"]}`（客户端建议每 3 秒一包）；
- 服务器逐条校验落库后按帧广播；限频：批间隔 < 3 秒返回 `error/rate_limited`；单帧 > 5 条、单条 > 500 字符、空帧拒绝；
- 连接即收 `hello`（在线名单），上下线广播 `presence`；服务器每 30 秒 ping。

## 自带客户端页面（不参与游戏构建）

服务启动后访问 `http://<服务器>:8787/` 即打开**云端客户端**（深空主题单页，服务器地址可填任意值，也支持 `?server=http://ip:8787` 预填）：

- **账号**：注册/登录、恢复码签发与迁移、改昵称、钱包余额；
- **云存档**：拖拽/选择存档 JSON → 上传（自动带 `baseVersion`，409 冲突时给出「先拉云端 / 确认覆盖」）、拉取云端版本、另存为文件、历史版本列表（逐版本下载与回滚）；
- **聊天**：zh/en 双频道各自的历史与未读红点、在线名单、3 秒打包发送（窗口内多条合一帧）、断线自动重连；
- **市场**：目录搜索（含基准价/最低价）、买卖盘、下单（实例物品自动列出手头的实例）、我的订单与撤单、近期成交；
- **库存 / 账本**：堆叠与实例物品（含属性快照、实例签名核验）、产出手动入账（测试通道）、流水与全链校验。

游戏客户端正式接入时同样只认「服务器地址 + 端口」，并可直接复用 `public/api-client.js`（HTTP 封装）与 `public/chat-queue.js`（打包队列）这两个无 DOM 依赖的模块——它们都有确定性测试覆盖。

接口级联调页保留在 `http://<服务器>:8787/debug`。

## 腾讯云部署清单（Ubuntu 24.04 轻量应用服务器）

```bash
# 1. 装 Node.js 22（国内建议用 npmmirror 二进制，避开官方源慢）
curl -fsSL https://npmmirror.com/mirrors/node/v22.21.1/node-v22.21.1-linux-x64.tar.xz -o /tmp/node.tar.xz
sudo mkdir -p /usr/local/lib/nodejs && sudo tar -xJf /tmp/node.tar.xz -C /usr/local/lib/nodejs
sudo ln -sf /usr/local/lib/nodejs/node-v22.21.1-linux-x64/bin/{node,npm,npx} /usr/local/bin/

# 2. 上传代码与内容表
#    本地：把 apps/server/* 拷到 ~/whale-server，把 content-csv/*.csv 拷到 ~/whale-server/content-csv/
cd ~/whale-server && npm install --no-audit --no-fund && npx tsx --test src/*.test.ts

# 3. systemd 常驻
sudo tee /etc/systemd/system/whale-server.service > /dev/null <<'EOF'
[Unit]
Description=Whale Idle cloud save & chat server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/whale-server
ExecStart=/usr/local/bin/npx tsx src/main.ts
Environment=WHALE_SERVER_PORT=8787
Environment=WHALE_ITEM_SEED=换成你自己的随机串
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now whale-server

# 4. 防火墙（测试期直连端口；正式期只留 22/80/443 走 Caddy）
sudo ufw allow 22/tcp && sudo ufw allow 8787/tcp && sudo ufw --force enable
```

**腾讯云控制台还要放行端口**：实例 → 防火墙 → 添加规则 TCP 8787（测试期）/ 80、443（正式期）。

### 每日备份

```bash
sudo mkdir -p /var/backups/whale
sudo tee /usr/local/bin/whale-backup.sh > /dev/null <<'EOF'
#!/bin/sh
set -e
STAMP=$(date +%Y%m%d-%H%M)
cd /home/ubuntu/whale-server
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/whale-server.db');db.exec(\"VACUUM INTO '/var/backups/whale/whale-server-$STAMP.db'\");db.close();"
find /var/backups/whale -name 'whale-server-*.db' -mtime +7 -delete
EOF
sudo chmod +x /usr/local/bin/whale-backup.sh
( sudo crontab -l 2>/dev/null; echo '20 4 * * * /usr/local/bin/whale-backup.sh' ) | sudo crontab -
```

### HTTPS（转正式时）

域名解析到公网 IP（国内地域需 ICP 备案，中国香港免备案）→ 装 Caddy：

```
your.domain.com {
    reverse_proxy 127.0.0.1:8787
}
```

`sudo systemctl reload caddy` 后客户端改连 `https://your.domain.com`（WSS 同域自动升级）。

## 已知边界（后续迭代）

- 存档仍由客户端演算，服务器不做全量权威演算；物品/信用点的进出走服务器账本；
- 产出阈值已改为**逐物品**（价值配额折算 + 类别硬顶 + 跨物品价值闸门）；配额是按「满技能最优矿船 ≈ 5 万 cr/分钟」的 10 倍定的，等有真实玩家数据后可下调；
- 舰船快照校验是**结构合法性**校验（槽位/耐久/字段），不是逐配件 CPU 合法性校验——那需要把引擎的配装校验搬到服务端，成本高且容易与引擎口径漂移，暂不做；
- 无管理后台（封禁/删档/人工补发）与举报流程，小圈子阶段先不做；
- 限流是**进程内**滑动窗口，重启即清零、多进程不共享；单机单进程部署下够用；
- token 无过期机制（设备码免登录的预期行为），恢复码是唯一的账号迁移通道。
