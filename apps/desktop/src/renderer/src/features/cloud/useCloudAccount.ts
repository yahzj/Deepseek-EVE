import { useCallback, useEffect, useRef, useState } from 'react'
import { CloudApiError, createCloudApi } from './api'
import type { CloudApi } from './api'
import type { CloudAuthResponse, CloudProfile, CloudSave } from './types'
import { readCloudPreferences, saveCloudSession } from './preferences'
import type { GameEngine } from '../../game/engine'
import { CLOUD_MAX_TIMER_MS, CloudRequestScope, cloudDownloadPreview, cloudErrorNotice, cloudRetryDelay, matchesCloudTarget, pendingRecoveryCode, rememberRecoveryCode } from './cloudState'
import type { CloudNotice, DownloadPreview, UploadPreview } from './cloudState'

type AuthMode = 'login' | 'signup' | 'recovery'
type Ticket = ReturnType<CloudRequestScope['begin']>

export function useCloudAccount(engine: GameEngine) {
  const [preferences, setPreferences] = useState(readCloudPreferences)
  const { server, session } = preferences
  const token = session?.token ?? ''
  const [profile, setProfile] = useState<CloudProfile | null>(null)
  const [mode, setModeState] = useState<AuthMode>('login')
  const [username, setUsernameState] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [freshRecoveryCode, setRecoveryCodeState] = useState(() => pendingRecoveryCode(server, session?.playerId))
  const [available, setAvailable] = useState<boolean | null>(null)
  const [latest, setLatest] = useState<Omit<CloudSave, 'data'> | null>(null)
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [status, setStatus] = useState<CloudNotice | null>(null)
  const [localExitOffered, setLocalExitOffered] = useState(false)
  const [uploadConfirm, setUploadConfirm] = useState<UploadPreview | null>(null)
  const [downloadCandidate, setDownloadCandidate] = useState<DownloadPreview | null>(null)
  const [savePaused, setSavePaused] = useState(() => engine.saveWriteState() !== 'ok')
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const scope = useRef(new CloudRequestScope())
  const mounted = useRef(false)
  const active = useRef(preferences)
  const busyRef = useRef(false)
  const applyingRef = useRef(false)
  const precheck = useRef<Ticket | null>(null)
  const verifiedIdentity = useRef('')

  const cancel = useCallback(() => {
    scope.current.cancel(); precheck.current = null; busyRef.current = false
  }, [])
  const resetCloud = useCallback(() => {
    setProfile(null); setLatest(null)
    setUploadConfirm(null); setDownloadCandidate(null); setLocalExitOffered(false)
  }, [])
  const clearSession = useCallback(() => {
    if (applyingRef.current) return
    const current = active.current
    cancel(); verifiedIdentity.current = ''
    saveCloudSession(current.server, null)
    active.current = { server: current.server, session: null }
    setPreferences(active.current); resetCloud(); setBusy(false); setRecoveryCodeState(null)
  }, [cancel, resetCloud])
  const handleError = useCallback((error: unknown, writing = false) => {
    if (error instanceof CloudApiError) {
      if (error.status === 401) clearSession()
      if (error.status === 429) {
        const delay = cloudRetryDelay(error)
        setCooldownUntil(Date.now() + delay)
        setStatus({ id: error.code === 'login_locked' ? 'ui.cloud.108' : 'ui.cloud.107', params: { p1: Math.ceil(delay / 1000) } })
        return
      }
    }
    setStatus(cloudErrorNotice(error, writing))
  }, [clearSession])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; cancel() }
  }, [cancel])
  // 只跟随已应用的 server/token；更新资料对象不会再次触发核验。
  useEffect(() => {
    if (!server || !token || verifiedIdentity.current === `${server}\n${token}`) return
    const ticket = scope.current.begin()
    setBusy(true); busyRef.current = true
    void (async () => {
      try {
        const verified = await createCloudApi({ server, token }).profile(ticket.signal)
        if (!ticket.current() || !mounted.current) return
        const confirmed: CloudAuthResponse = { ...verified, token }
        verifiedIdentity.current = `${server}\n${token}`
        saveCloudSession(server, confirmed)
        active.current = { server, session: confirmed }
        setPreferences(active.current); setProfile(verified)
        setRecoveryCodeState(pendingRecoveryCode(server, verified.playerId))
      } catch (error) {
        if (ticket.current() && mounted.current) handleError(error)
      } finally {
        if (ticket.current() && mounted.current) { busyRef.current = false; setBusy(false) }
        ticket.finish()
      }
    })()
    return () => { ticket.abort(); ticket.finish() }
  }, [server, token, handleError])
  useEffect(() => engine.subscribe(() => setSavePaused(engine.saveWriteState() !== 'ok')), [engine])
  useEffect(() => {
    if (!cooldownUntil) return
    const timer = setTimeout(() => setCooldownUntil(0), Math.min(CLOUD_MAX_TIMER_MS, Math.max(0, cooldownUntil - Date.now())))
    return () => clearTimeout(timer)
  }, [cooldownUntil])

  const setUsername = useCallback((value: string) => {
    precheck.current?.abort(); setAvailable(null); setUsernameState(value)
  }, [])
  const setMode = useCallback((value: AuthMode) => {
    precheck.current?.abort()
    setAvailable(null); setPassword(''); setRecoveryCode(''); setModeState(value)
    if (value === 'signup') setUsernameState('')
  }, [])
  useEffect(() => {
    if (mode !== 'signup' || profile || !server || cooldownUntil || busy || !username.trim()) return
    const ticket = scope.current.begin()
    precheck.current = ticket
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await createCloudApi({ server, token: '' }).usernameAvailable(username.trim(), ticket.signal)
          if (!ticket.current() || !mounted.current) return
          setAvailable(result.available)
          if (!result.available) setStatus({ id: result.reason === 'bad_format' ? 'ui.cloud.103' : 'ui.cloud.016' })
        } catch (error) {
          if (ticket.current() && mounted.current) handleError(error)
        } finally { ticket.finish() }
      })()
    }, 350)
    return () => { clearTimeout(timer); ticket.abort(); ticket.finish() }
  }, [busy, cooldownUntil, handleError, mode, profile, server, username])

  const run = useCallback(async (work: (api: CloudApi, ticket: Ticket) => Promise<void>, writing = false) => {
    if (!mounted.current || busyRef.current || !active.current.server || cooldownUntil > Date.now()) return
    precheck.current?.abort()
    const ticket = scope.current.begin()
    const current = active.current
    busyRef.current = true; setBusy(true); setStatus(null)
    try {
      await work(createCloudApi({ server: current.server, token: current.session?.token ?? '' }), ticket)
    } catch (error) {
      if (ticket.current() && mounted.current) handleError(error, writing)
    } finally {
      if (ticket.current() && mounted.current) { busyRef.current = false; setBusy(false) }
      ticket.finish()
    }
  }, [cooldownUntil, handleError])

  const submitAuth = useCallback(() => {
    if ((mode === 'recovery' ? !recoveryCode.trim() : !username.trim() || !password) || profile) return
    void run(async (api, ticket) => {
      const auth = mode === 'recovery' ? await api.redeemRecovery(recoveryCode.trim(), undefined, ticket.signal)
        : mode === 'signup' ? await api.signup(username.trim(), password, ticket.signal)
          : await api.login(username.trim(), password, ticket.signal)
      if (!ticket.current() || !mounted.current) return
      if (auth.recoveryCode) rememberRecoveryCode(server, auth, auth.recoveryCode)
      setRecoveryCodeState(pendingRecoveryCode(server, auth.playerId))
      setPassword(''); setRecoveryCode('')
      const verified = await createCloudApi({ server, token: auth.token }).profile(ticket.signal)
      if (!ticket.current() || !mounted.current) return
      const confirmed = { ...verified, token: auth.token }
      verifiedIdentity.current = `${server}\n${auth.token}`
      saveCloudSession(server, confirmed)
      active.current = { server, session: confirmed }
      setPreferences(active.current); resetCloud(); setProfile(verified)
      setStatus({ id: auth.recoveryCode ? 'ui.cloud.021' : 'ui.cloud.120' })
    })
  }, [mode, password, profile, recoveryCode, resetCloud, run, server, username])

  const localLogout = useCallback(() => { clearSession(); setStatus({ id: 'ui.cloud.122' }) }, [clearSession])
  const logout = useCallback(() => {
    void run(async (api, ticket) => {
      try { await api.logout(ticket.signal) } catch (error) {
        if (ticket.current() && mounted.current) {
          setLocalExitOffered(true); handleError(error)
          if (!(error instanceof CloudApiError && (error.status === 401 || error.status === 429))) setStatus({ id: 'ui.cloud.123' })
        }
        return
      }
      if (!ticket.current() || !mounted.current) return
      let noticeId = 'ui.cloud.131'
      try {
        // 同一API实例仍持有退出前token；兼容后端旧令牌回退，不凭logout成功宣称撤销。
        await api.profile(ticket.signal)
      } catch (error) {
        noticeId = error instanceof CloudApiError && error.status === 401 ? 'ui.cloud.121' : 'ui.cloud.122'
      }
      if (!ticket.current() || !mounted.current) return
      clearSession(); setStatus({ id: noticeId })
    })
  }, [clearSession, handleError, run])

  const readMetadata = useCallback(async (api: CloudApi, ticket: Ticket) => {
    const save = await api.saveLatest(ticket.signal)
    if (!ticket.current() || !mounted.current) return
    setLatest({ version: save.version, createdAt: save.createdAt, size: save.size }); setUploadConfirm(null)
  }, [])
  const refresh = useCallback(() => { if (profile) void run(readMetadata) }, [profile, readMetadata, run])
  const previewUpload = useCallback(() => {
    if (!profile || engine.saveWriteState() !== 'ok') return
    setUploadConfirm(null); setDownloadCandidate(null)
    void run(async (api, ticket) => {
      const save = await api.saveLatest(ticket.signal)
      if (!ticket.current() || !mounted.current) return
      setLatest({ version: save.version, createdAt: save.createdAt, size: save.size })
      setUploadConfirm({ server, playerId: profile.playerId, baseVersion: save.version })
    })
  }, [engine, profile, run, server])
  const confirmUpload = useCallback(() => {
    const confirmation = uploadConfirm
    if (!confirmation || !profile || !matchesCloudTarget(confirmation, server, profile.playerId) || engine.saveWriteState() !== 'ok') return
    setUploadConfirm(null)
    void run(async (api, ticket) => {
      const snapshot = await engine.exportCloudSave()
      if (!ticket.current() || !mounted.current || engine.saveWriteState() !== 'ok') return
      if (!snapshot.ok || snapshot.text === undefined) { setStatus({ id: 'ui.cloud.124' }); return }
      try {
        const uploaded = await api.uploadSave(snapshot.text, confirmation.baseVersion, ticket.signal)
        if (!ticket.current() || !mounted.current) return
        setLatest({ version: uploaded.version, size: uploaded.size })
        setStatus({ id: 'ui.cloud.125', params: { p1: uploaded.version } })
      } catch (error) {
        if (!ticket.current() || !mounted.current) return
        if (error instanceof CloudApiError && error.status === 409) {
          setStatus({ id: 'ui.cloud.112' }); await readMetadata(api, ticket); return
        }
        throw error
      }
    }, true)
  }, [engine, profile, readMetadata, run, server, uploadConfirm])
  const previewDownload = useCallback(() => {
    if (!profile) return
    setDownloadCandidate(null); setUploadConfirm(null)
    void run(async (api, ticket) => {
      const save = await api.saveLatest(ticket.signal)
      if (!ticket.current() || !mounted.current) return
      setDownloadCandidate(cloudDownloadPreview(save, { server, playerId: profile.playerId }))
    })
  }, [profile, run, server])
  const confirmDownload = useCallback(() => {
    const candidate = downloadCandidate
    if (!candidate || !profile || !matchesCloudTarget(candidate, server, profile.playerId) || engine.saveWriteState() !== 'ok') return
    setDownloadCandidate(null)
    void run(async (api, ticket) => {
      // 预览后 token 可能过期；网络阶段取消绝不进入旧读档链。
      const verified = await api.profile(ticket.signal)
      if (!ticket.current() || !mounted.current || !matchesCloudTarget(candidate, server, verified.playerId) || engine.saveWriteState() !== 'ok') return
      applyingRef.current = true
      setApplying(true)
      try {
        const result = await engine.importCloudSave(candidate.text)
        if (!ticket.current() || !mounted.current) return
        setStatus(result.ok ? { id: 'ui.cloud.126' } : { id: 'ui.cloud.127', params: { p1: result.error ?? '' } })
      } finally {
        applyingRef.current = false
        if (mounted.current) {
          setApplying(false)
          setSavePaused(engine.saveWriteState() !== 'ok')
        }
      }
    })
  }, [downloadCandidate, engine, profile, run, server])
  const copyRecovery = useCallback(async () => {
    if (!freshRecoveryCode) return
    const ticket = scope.current.begin()
    try {
      await navigator.clipboard.writeText(freshRecoveryCode.code)
      if (ticket.current() && mounted.current) setStatus({ id: 'ui.cloud.128' })
    } catch {
      if (ticket.current() && mounted.current) setStatus({ id: 'ui.cloud.129' })
    } finally { ticket.finish() }
  }, [freshRecoveryCode])
  const dismissRecovery = useCallback(() => {
    if (freshRecoveryCode) rememberRecoveryCode(server, freshRecoveryCode.owner, null)
    setRecoveryCodeState(null)
  }, [freshRecoveryCode, server])

  return {
    serverConfigured: server !== '', session, profile, mode, setMode, username, setUsername, password, setPassword,
    recoveryCode, setRecoveryCode, freshRecoveryCode, dismissRecovery, available, busy, applying, status, latest,
    uploadConfirm, downloadCandidate, setUploadConfirm, setDownloadCandidate, submitAuth, logout, localLogout, localExitOffered,
    refresh, previewUpload, confirmUpload, previewDownload, confirmDownload, copyRecovery, savePaused, coolingDown: cooldownUntil > Date.now(),
  }
}
