
import { EXCH_PREF, readExchangeCode, writeExchangePref } from './viewPrefs'

export const DEFAULT_EXCHANGE_CODE = 'XJZG'

let currentSelectedCode = readExchangeCode(DEFAULT_EXCHANGE_CODE)
type CodeListener = (code: string) => void
const listeners = new Set<CodeListener>()

export function getExchangeSelectedCode(): string {
  return currentSelectedCode
}

export function setExchangeSelectedCode(code: string): void {
  if (!code) return
  currentSelectedCode = code
  writeExchangePref(EXCH_PREF.code, code)
  for (const fn of listeners) {
    try {
      fn(code)
    } catch {
    }
  }
}

export function subscribeExchangeSelectedCode(fn: CodeListener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
