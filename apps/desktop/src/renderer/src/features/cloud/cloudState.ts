import { ironmanOn, loadSaveFile, SaveError } from '@whale/core'
import { CloudApiError } from './api'
import type { CloudProfile, CloudSave } from './types'

export type CloudNotice = { id: string; params?: Record<string, string | number> }
export type CloudTarget = { server: string; playerId: number }
export type UploadPreview = CloudTarget & { baseVersion: number }
export type DownloadPreview = CloudTarget & { version: number; pilot: string; savedAt: number; ironman: boolean; text: string }
export type PendingRecovery = { owner: CloudProfile; code: string }

export const CLOUD_MAX_TIMER_MS = 2_147_483_647
export function cloudRetryDelay(error: CloudApiError): number {
  const value = (error.extra as { retryAfterMs?: unknown } | undefined)?.retryAfterMs
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= CLOUD_MAX_TIMER_MS
    ? value : error.code === 'login_locked' ? 600_000 : 60_000
}

// 取消后即使传输层忽略 abort，也不能提交旧结果。
export class CloudRequestScope {
  private generation = 0
  private controllers = new Set<AbortController>()
  begin() {
    const generation = this.generation
    const controller = new AbortController()
    this.controllers.add(controller)
    return {
      signal: controller.signal,
      current: () => !controller.signal.aborted && generation === this.generation,
      abort: () => controller.abort(),
      finish: () => this.controllers.delete(controller),
    }
  }
  cancel() {
    this.generation++
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }
}

const ERROR_IDS: Readonly<Record<string, string>> = {
  bad_credentials: 'ui.cloud.101',
  missing_token: 'ui.cloud.102', invalid_token: 'ui.cloud.102', token_expired: 'ui.cloud.102', session_not_found: 'ui.cloud.102',
  username_taken: 'ui.cloud.016', nickname_taken: 'ui.cloud.016',
  bad_username: 'ui.cloud.103', bad_format: 'ui.cloud.103', bad_nickname: 'ui.cloud.103',
  bad_password: 'ui.cloud.104',
  bad_recovery_code: 'ui.cloud.105', recovery_not_found: 'ui.cloud.105', account_not_found: 'ui.cloud.105',
  device_in_use: 'ui.cloud.106', bad_device_code: 'ui.cloud.106', crypto_unavailable: 'ui.cloud.106',
  invalid_server: 'ui.cloud.109', insecure_server: 'ui.cloud.109',
  network_error: 'ui.cloud.110', timeout: 'ui.cloud.111', save_conflict: 'ui.cloud.112',
  save_too_large: 'ui.cloud.113', response_too_large: 'ui.cloud.113', payload_too_large: 'ui.cloud.113',
  malformed_response: 'ui.cloud.114', bad_json: 'ui.cloud.114',
  bad_save_data: 'ui.cloud.115', invalid_base_version: 'ui.cloud.115', bad_base_version: 'ui.cloud.115', invalid_version: 'ui.cloud.115',
  version_not_found: 'ui.cloud.116', not_found: 'ui.cloud.116',
  internal_error: 'ui.cloud.117', request_failed: 'ui.cloud.117',
}

export function cloudErrorNotice(error: unknown, writing = false): CloudNotice {
  if (error instanceof SaveError) return { id: 'ui.cloud.118', params: { p1: error.message } }
  if (!(error instanceof CloudApiError)) return { id: 'ui.cloud.117' }
  if (error.status === 429 || error.code === 'rate_limited' || error.code === 'login_locked') return {
    id: error.code === 'login_locked' ? 'ui.cloud.108' : 'ui.cloud.107',
    params: { p1: Math.ceil(cloudRetryDelay(error) / 1000) },
  }
  if (writing && (error.code === 'timeout' || error.code === 'network_error')) return { id: 'ui.cloud.119' }
  if (ERROR_IDS[error.code]) return { id: ERROR_IDS[error.code]! }
  if (error.status === 401) return { id: 'ui.cloud.102' }
  return { id: 'ui.cloud.117' }
}

export function cloudDownloadPreview(save: CloudSave, target: CloudTarget): DownloadPreview {
  if (save.data === null || save.version < 1) throw new CloudApiError(404, 'version_not_found', '')
  if (new TextEncoder().encode(save.data).byteLength > 10 * 1024 * 1024) throw new CloudApiError(413, 'save_too_large', '')
  const parsed = loadSaveFile(save.data)
  return { ...target, version: save.version, pilot: parsed.state.character.name,
    savedAt: parsed.savedAtWallMs, ironman: ironmanOn(parsed.state), text: save.data }
}

export function matchesCloudTarget(preview: CloudTarget, server: string, playerId: number | undefined): boolean {
  return preview.server === server && preview.playerId === playerId
}

// 仅 renderer 内存，设置分类卸载不会丢失；从不进入偏好、title 或日志。
const recoveryCodes = new Map<string, Map<number, PendingRecovery>>()
export function pendingRecoveryCode(server: string, playerId?: number): PendingRecovery | null {
  const codes = recoveryCodes.get(server)
  if (playerId !== undefined) return codes?.get(playerId) ?? null
  return codes ? [...codes.values()].at(-1) ?? null : null
}
export function rememberRecoveryCode(server: string, owner: CloudProfile, code: string | null): void {
  let codes = recoveryCodes.get(server)
  if (code) {
    if (!codes) { codes = new Map(); recoveryCodes.set(server, codes) }
    codes.set(owner.playerId, { owner: { playerId: owner.playerId, username: owner.username, nickname: owner.nickname }, code })
  } else {
    codes?.delete(owner.playerId)
    if (!codes?.size) recoveryCodes.delete(server)
  }
}
