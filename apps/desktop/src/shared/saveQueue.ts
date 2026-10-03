/** 同一保存域的异步操作按入队顺序执行；失败只回到本次调用者，不毒化后续队列。 */
export function createSaveQueue(): <T>(operation: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
}
