class FakeAudio {
  static all: FakeAudio[] = []
  src = ''
  loop = false
  preload = ''
  volume = 0
  paused = true
  constructor(src: string) {
    this.src = src
    FakeAudio.all.push(this)
  }
  play(): Promise<void> {
    this.paused = false
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
  }
}

type Channel = {
  set(url: string | null, volume: number): void
  pause(): void
  resume(): void
  destroy(): void
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const failures: string[] = []
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message)
}

async function main(): Promise<void> {
  ;(globalThis as unknown as { Audio: unknown }).Audio = FakeAudio
  const { LoopChannel } = await import('../apps/desktop/src/renderer/src/game/audio/loops')
  const live = () => FakeAudio.all.filter((audio) => !audio.paused && audio.src !== '')
  const channel = new LoopChannel(200, 60) as unknown as Channel

  channel.set('A', 1)
  channel.set('B', 1)
  check(live().length === 2, `正常交叉淡变应有 2 个实例，实际 ${live().length}`)

  channel.set('A', 1)
  const backToA = live()
  check(backToA.length === 2, `切回淡出中的曲目后总实例应仍为 2，实际 ${backToA.length}`)
  check(backToA.filter((audio) => audio.src === 'A').length === 1, '切回淡出中的曲目不应产生同曲双份')

  await sleep(320)
  check(live().length === 1 && live()[0]?.src === 'A', '淡变结束后应只剩当前曲 1 个实例')

  channel.set('B', 1)
  channel.set('C', 1)
  channel.set('D', 1)
  const rapid = live()
  check(rapid.length <= 2, `快速连切时并发实例应不超过 2，实际 ${rapid.length}`)
  const srcs = rapid.map((audio) => audio.src)
  check(new Set(srcs).size === srcs.length, `快速连切时不应出现同曲多实例：${srcs.join(',')}`)

  await sleep(320)
  check(live().length === 1, `快速连切淡变结束后应只剩 1 个实例，实际 ${live().length}`)

  channel.set('E', 1)
  channel.pause()
  channel.resume()
  check(live().every((audio) => audio.src !== 'D'), 'resume 时不应复活已淡出的旧实例')

  channel.destroy()
  check(live().length === 0, 'destroy 后不应残留播放实例')

  if (failures.length > 0) {
    for (const message of failures) console.error(`✗ ${message}`)
    process.exitCode = 1
    return
  }
  console.log('✓ 循环音频通道检查通过（并发上限 / 同曲复活 / 淡变清理 / 恢复 / 销毁）')
}

void main()
