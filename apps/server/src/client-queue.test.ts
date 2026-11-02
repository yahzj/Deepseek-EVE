import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * 聊天打包队列的确定性用例。
 * 这些逻辑跑在浏览器里，但计时器是注入的，所以能在 Node 里精确验证「3 秒一帧、每帧 ≤5 条」。
 */
interface BatchQueue {
  push(text: string): boolean;
  flush(): string[];
  pending(): number;
  nextDelay(): number | null;
  truncatedCount(): number;
  clear(): void;
}

type CreateBatchQueue = (options?: {
  send?: (messages: string[]) => void;
  maxPerFrame?: number;
  intervalMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}) => BatchQueue;

const moduleUrl = new URL('../public/chat-queue.js', import.meta.url).href;
const { createBatchQueue } = (await import(moduleUrl)) as unknown as {
  createBatchQueue: CreateBatchQueue;
};

function fakeClock() {
  let time = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => time,
    setTimer: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.set(id, { at: time + ms, fn });
      return id;
    },
    clearTimer: (id: unknown) => {
      timers.delete(id as number);
    },
    advance(ms: number) {
      const target = time + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        time = timer.at;
        timer.fn();
      }
      time = target;
    },
  };
}

function harness() {
  const clock = fakeClock();
  const frames: string[][] = [];
  const queue = createBatchQueue({
    send: (messages) => frames.push(messages),
    intervalMs: 3000,
    maxPerFrame: 5,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, frames, queue };
}

describe('聊天打包队列', () => {
  it('3 秒窗口内的多条消息打成一个帧', () => {
    const { clock, frames, queue } = harness();
    queue.push('你好');
    queue.push('挖矿去了');
    assert.equal(queue.pending(), 2);
    clock.advance(2999);
    assert.equal(frames.length, 0, '不到 3 秒不发送');
    clock.advance(1);
    assert.deepEqual(frames, [['你好', '挖矿去了']]);
    assert.equal(queue.pending(), 0);
  });

  it('超过单帧上限的消息分帧发送，且间距不小于 3 秒', () => {
    const { clock, frames, queue } = harness();
    for (let index = 1; index <= 7; index += 1) {
      queue.push(`第 ${index} 条`);
    }
    clock.advance(3000);
    assert.equal(frames.length, 1);
    assert.equal(frames[0]!.length, 5, '单帧最多 5 条');
    clock.advance(2999);
    assert.equal(frames.length, 1, '第二帧要等满 3 秒');
    clock.advance(1);
    assert.equal(frames.length, 2);
    assert.deepEqual(frames[1], ['第 6 条', '第 7 条']);
  });

  it('紧接上一帧后入队的消息，从上一帧起算 3 秒', () => {
    const { clock, frames, queue } = harness();
    queue.push('第一帧');
    clock.advance(3000);
    assert.equal(frames.length, 1);
    clock.advance(100);
    queue.push('第二帧');
    clock.advance(2899);
    assert.equal(frames.length, 1, '距上一帧不足 3 秒不能发');
    clock.advance(1);
    assert.deepEqual(frames[1], ['第二帧']);
  });

  it('空白消息被丢弃，超长消息按 500 字符截断', () => {
    const { clock, frames, queue } = harness();
    assert.equal(queue.push('   '), false);
    assert.equal(queue.push(''), false);
    assert.equal(queue.pending(), 0);

    assert.equal(queue.push('长'.repeat(620)), true);
    assert.equal(queue.truncatedCount(), 1);
    clock.advance(3000);
    assert.equal(frames[0]![0]!.length, 500);
  });

  it('断线清空后不会把旧消息重发', () => {
    const { clock, frames, queue } = harness();
    queue.push('断线前');
    queue.clear();
    assert.equal(queue.pending(), 0);
    clock.advance(6000);
    assert.deepEqual(frames, []);
  });
});
