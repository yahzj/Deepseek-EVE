/**
 * 服务端配置：全部集中在这里，部署时可用环境变量覆盖。
 * 单位约定：字节、毫秒、字符数、信用点（整数）。
 */
export interface ServerConfig {
  port: number;
  /** 单份存档体积上限（字节） */
  saveMaxBytes: number;
  /** 每个账号保留的存档历史版本数 */
  saveHistoryVersions: number;
  /** 聊天历史默认拉取条数上限 */
  chatHistoryLimit: number;
  /** 每个频道保留的消息条数（超出后删最旧） */
  chatRetentionPerChannel: number;
  /** 允许跨域访问的来源，默认 *（网页版在 GitHub Pages，跨域必需） */
  corsOrigin: string;
  /** 开放频道 */
  chatChannels: readonly string[];
  /** 一个打包帧最多携带的消息条数 */
  chatBatchMaxMessages: number;
  /** 相邻两个打包帧的最小间隔（防刷屏限频） */
  chatBatchIntervalMs: number;
  /** 单条消息最大字符数 */
  chatMessageMaxChars: number;
  /** 昵称最大字符数 */
  nicknameMaxChars: number;
  /** 内容表目录（items.csv / market.csv / ships.csv ...） */
  contentDir: string;
  /** 公共市场最低价系数：floor = basePrice × 系数 */
  floorRatio: number;
  /** 交易税率（成交额比例，从卖方收入扣） */
  tradeTaxRate: number;
  /**
   * 产出上报：按 market.csv kind 分档的「每分钟每物品」数量**硬顶**。
   * 实际上限还要与「价值配额折算出的件数」取小（见 catalog.productionCapOf），因此这只是天花板。
   */
  productionLimits: Record<string, number>;
  /**
   * 产出上报：每分钟允许入账的物品**价值**配额（信用点，按 market.csv 基准价折算）。
   * 逐物品上限 = min(类别硬顶, 配额 ÷ 基准价)。参考口径：满技能最优矿船实测约 5 万 cr/分钟，
   * 默认 50 万 = 10 倍安全余量。
   */
  productionValueQuota: number;
  /**
   * 叠加闸门：同一批/同一分钟内，各物品「占各自上限的比例」之和的上限。
   * 默认 3 = 允许三种物品同时打满；再高就是「每样都不超但总和离谱」的刷量。
   */
  productionBatchRatio: number;
  /** 单次产出上报最多携带物品种类数 */
  productionMaxEntries: number;
  /** 服务器签发物品实例签名用的种子（部署时务必换成自己的随机串） */
  itemSignSeed: string;
  /** 每个 IP 每分钟允许的注册/登录次数（防脚本刷库） */
  rateLimitAuthPerMin: number;
  /** 每个 IP 每分钟允许的总请求数 */
  rateLimitGlobalPerMin: number;
  /** 是否信任 X-Forwarded-For（放在 Caddy 后面时开；直连公网时必须关） */
  trustProxy: boolean;
}

const num = (env: string | undefined, fallback: number): number => {
  const parsed = Number(env);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const DEFAULT_PRODUCTION_LIMITS: Record<string, number> = {
  item: 8000,
  module: 40,
  ship: 6,
  blueprint: 10,
  aicore: 6,
};

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: num(process.env.WHALE_SERVER_PORT, 8787),
    saveMaxBytes: num(process.env.WHALE_SAVE_MAX_BYTES, 10 * 1024 * 1024),
    saveHistoryVersions: num(process.env.WHALE_SAVE_HISTORY, 10),
    chatHistoryLimit: num(process.env.WHALE_CHAT_HISTORY, 100),
    chatRetentionPerChannel: num(process.env.WHALE_CHAT_RETENTION, 5000),
    corsOrigin: process.env.WHALE_CORS_ORIGIN ?? '*',
    chatChannels: ['zh', 'en'],
    chatBatchMaxMessages: num(process.env.WHALE_CHAT_BATCH_MAX, 5),
    chatBatchIntervalMs: num(process.env.WHALE_CHAT_INTERVAL_MS, 3000),
    chatMessageMaxChars: num(process.env.WHALE_CHAT_MSG_CHARS, 500),
    nicknameMaxChars: num(process.env.WHALE_NICK_MAX_CHARS, 24),
    contentDir: process.env.WHALE_CONTENT_DIR ?? 'content-csv',
    floorRatio: Number(process.env.WHALE_FLOOR_RATIO ?? 0.6),
    tradeTaxRate: Number(process.env.WHALE_TRADE_TAX ?? 0.05),
    productionLimits: DEFAULT_PRODUCTION_LIMITS,
    productionValueQuota: num(process.env.WHALE_PROD_VALUE_QUOTA, 500_000),
    productionBatchRatio: num(process.env.WHALE_PROD_BATCH_RATIO, 3),
    productionMaxEntries: num(process.env.WHALE_PROD_MAX_ENTRIES, 50),
    itemSignSeed: process.env.WHALE_ITEM_SEED ?? 'whale-dev-seed-change-me',
    rateLimitAuthPerMin: num(process.env.WHALE_RATE_AUTH, 20),
    rateLimitGlobalPerMin: num(process.env.WHALE_RATE_GLOBAL, 600),
    trustProxy: process.env.WHALE_TRUST_PROXY === '1',
    ...overrides,
  };
}
