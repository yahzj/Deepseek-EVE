/**
 * 交易所业务错误（前端与 Mock 共用）。
 *
 * 为什么单独一个文件：`client.ts` 要 import Mock 做装配，Mock 又要抛业务错误；
 * 错误类若也住在 `client.ts` 就形成运行时循环依赖。放在这里，两边都只依赖它。
 */
export class ExchangeError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'ExchangeError'
  }
}
