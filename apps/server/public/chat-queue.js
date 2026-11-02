/**
 * 聊天打包队列：把玩家在 3 秒窗口内连续输入的多条消息合并成一个 WebSocket 帧发出。
 *
 * 为什么需要它：服务端按「帧」限频（相邻帧间隔 ≥ 3 秒、每帧 ≤ 5 条），
 * 逐条发送会被判 rate_limited；把多条打成一帧既省流量，也不触发限频。
 *
 * 这个模块不碰 DOM 与 WebSocket，计时函数可注入，因此能被确定性测试覆盖。
 */

export const DEFAULT_MAX_PER_FRAME = 5;
export const DEFAULT_INTERVAL_MS = 3000;
export const MAX_MESSAGE_CHARS = 500;

/**
 * @param {object} [options]
 * @param {(messages: string[]) => void} [options.send] 发送一帧（通常是 ws.send 的包装）
 * @param {number} [options.maxPerFrame] 单帧最多消息条数
 * @param {number} [options.intervalMs] 相邻两帧最小间隔
 * @param {() => number} [options.now] 当前时间（毫秒）
 * @param {(fn: () => void, ms: number) => unknown} [options.setTimer] 定时器注入
 * @param {(id: unknown) => void} [options.clearTimer] 清定时器注入
 */
export function createBatchQueue(options = {}) {
  const send = options.send ?? (() => {});
  const maxPerFrame = Math.max(1, Math.trunc(options.maxPerFrame ?? DEFAULT_MAX_PER_FRAME));
  const intervalMs = Math.max(0, Math.trunc(options.intervalMs ?? DEFAULT_INTERVAL_MS));
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id));

  /** @type {string[]} */
  let queue = [];
  /** @type {unknown} */
  let timer = null;
  /** 上一帧的发出时间；null 表示还没发过（首帧从入队时刻起算一个完整窗口） */
  let lastSentAt = null;
  let truncated = 0;

  function waitForNextFrame() {
    if (lastSentAt === null) {
      return intervalMs;
    }
    return Math.max(0, intervalMs - (now() - lastSentAt));
  }

  function schedule(delayMs) {
    if (timer !== null || queue.length === 0) {
      return;
    }
    timer = setTimer(() => {
      timer = null;
      flush();
    }, delayMs);
  }

  /** 立即发出队首一帧（最多 maxPerFrame 条），剩下的按间隔再排一次。 */
  function flush() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (queue.length === 0) {
      return [];
    }
    const batch = queue.splice(0, maxPerFrame);
    lastSentAt = now();
    send(batch);
    if (queue.length > 0) {
      schedule(intervalMs);
    }
    return batch;
  }

  /** 入队一条消息；空白消息直接丢弃并返回 false。 */
  function push(text) {
    const raw = typeof text === 'string' ? text : String(text ?? '');
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return false;
    }
    let message = trimmed;
    if (message.length > MAX_MESSAGE_CHARS) {
      message = message.slice(0, MAX_MESSAGE_CHARS);
      truncated += 1;
    }
    queue.push(message);
    schedule(waitForNextFrame());
    return true;
  }

  return {
    push,
    flush,
    /** 待发送条数 */
    pending: () => queue.length,
    /** 距离下一帧还有多少毫秒（无待发消息时为 null） */
    nextDelay: () => (queue.length === 0 ? null : waitForNextFrame()),
    /** 因超长被截断的条数，用于界面提示 */
    truncatedCount: () => truncated,
    /** 断线时清空，避免重连后把旧消息重发 */
    clear() {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      queue = [];
    },
  };
}
