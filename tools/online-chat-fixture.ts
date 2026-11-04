/** 在线聊天冒烟专用合成数据；无磁盘读取，不接触个人进度或正式账号。 */
import { cloudSettingsFixture, CLOUD_SMOKE_CHARACTER } from './cloud-settings-fixture'

export const CHAT_HISTORY_SIZE = 125
export const CHAT_OWNER_NICKNAME = 'Captain' + 'W'.repeat(17)
export const CHAT_PEER_NICKNAME = 'Peer' + 'W'.repeat(20)
export const CHAT_PRESENCE_NICKNAME = 'PresenceOnlySentinel'
export const CHAT_LONG_TEXT = 'CHAT_SMOKE_LONG_'.padEnd(499, 'W')
export const CHAT_MARKERS = {
  race: 'ZH_SMOKE_HISTORY_REALTIME_OVERLAP',
  zh: 'ZH_SMOKE_PEER_REALTIME',
  en: 'EN_SMOKE_PEER_REALTIME',
  own: 'ZH_SMOKE_OWNER_ECHO',
  away: 'ZH_SMOKE_RECEIVED_WHILE_AWAY',
} as const

export function onlineChatFixture(now = Date.now()): string {
  return cloudSettingsFixture(111, now)
}

export function historyMessages(channel: 'zh' | 'en'): string[] {
  return Array.from({ length: CHAT_HISTORY_SIZE }, (_, index) =>
    index === CHAT_HISTORY_SIZE - 1 ? CHAT_LONG_TEXT : `${channel.toUpperCase()}_SMOKE_HISTORY_${String(index).padStart(3, '0')}`)
}

/** 只返回无凭据的档案投影；完整序列化档仅进入本次临时 profile。 */
export function inspectOnlineChatFixture(text: string) {
  const value = JSON.parse(text)
  return {
    synthetic: value.state.character.name === CLOUD_SMOKE_CHARACTER,
    wallet: value.state.wallet.isk,
    emptyLogs: Array.isArray(value.state.logs) && value.state.logs.length === 0,
    modeChosen: value.state.modeChosen === true,
  }
}
