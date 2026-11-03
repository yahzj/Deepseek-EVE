import { useEffect, useState } from 'react'
import { CloudDownload, CloudUpload, Copy, LogIn, LogOut, RefreshCw, Save, X } from 'lucide-react'
import type { GameEngine } from '../../game/engine'
import { useL10n } from '../../i18n/locale'
import { useCloudAccount } from './useCloudAccount'
import './cloud.css'

function timeLabel(value: number): string {
  return value > 0 ? new Date(value).toLocaleString() : '—'
}

export function CloudSavePanel({ engine, onApplyingChange }: { engine: GameEngine; onApplyingChange?: (on: boolean) => void }) {
  const { t } = useL10n()
  const cloud = useCloudAccount(engine)
  const [confirmRecoveryClose, setConfirmRecoveryClose] = useState(false)
  const profile = cloud.profile
  const blocked = cloud.busy || cloud.coolingDown
  useEffect(() => { onApplyingChange?.(cloud.applying) }, [cloud.applying, onApplyingChange])

  return (
    <section className="app-settings-row app-cloud" aria-busy={cloud.busy} data-cloud-applying={cloud.applying || undefined}>
      <h3 className="app-settings-label">{t('ui.cloud.001')}</h3>
      <div className="app-cloud-section">
        <div className="app-cloud-heading"><strong>{t('ui.cloud.002')}</strong></div>
        {profile ? (
          <div className="app-cloud-account">
            <div className="app-cloud-profile">
              <span>{t('ui.cloud.005')}</span>
              <strong>{profile.nickname}</strong>
              <span>{t('ui.cloud.014')}: {profile.username ?? t('ui.cloud.006')}</span>
            </div>
            <button className="app-btn is-small" onClick={cloud.logout} disabled={blocked}><LogOut size={14} />{t('ui.cloud.007')}</button>
            {cloud.localExitOffered ? <button className="app-btn is-small" onClick={cloud.localLogout} disabled={cloud.applying}>{t('ui.cloud.008')}</button> : null}
          </div>
        ) : (
          <>
            <div className="app-cloud-modes" role="group" aria-label={t('ui.cloud.009')}>
              {(['login', 'signup', 'recovery'] as const).map(value => (
                <button key={value} className={`app-btn is-small${cloud.mode === value ? ' is-primary' : ''}`} aria-pressed={cloud.mode === value} onClick={() => cloud.setMode(value)} disabled={cloud.busy}>
                  {t(value === 'login' ? 'ui.cloud.010' : value === 'signup' ? 'ui.cloud.011' : 'ui.cloud.012')}
                </button>
              ))}
            </div>
            {cloud.mode === 'recovery' ? (
              <label className="app-cloud-field">
                <span>{t('ui.cloud.013')}</span>
                <input value={cloud.recoveryCode} onChange={event => cloud.setRecoveryCode(event.target.value)} autoComplete="off" />
              </label>
            ) : (
              <>
                <label className="app-cloud-field">
                  <span>{t('ui.cloud.014')}</span>
                  <input value={cloud.username} onChange={event => cloud.setUsername(event.target.value)} autoComplete="username" disabled={cloud.busy} />
                </label>
                {cloud.mode === 'signup' && cloud.available !== null ? <span className={cloud.available ? 'app-cloud-ok' : 'app-cloud-error'}>{t(cloud.available ? 'ui.cloud.015' : 'ui.cloud.016')}</span> : null}
                <label className="app-cloud-field">
                  <span>{t('ui.cloud.017')}</span>
                  <input type="password" value={cloud.password} onChange={event => cloud.setPassword(event.target.value)} autoComplete={cloud.mode === 'signup' ? 'new-password' : 'current-password'} />
                </label>
              </>
            )}
            <div className="app-settings-btns">
              <button className="app-btn is-small is-primary" onClick={cloud.submitAuth} disabled={blocked || !cloud.serverConfigured || (cloud.mode === 'signup' && cloud.available === false)}><LogIn size={14} />{t(cloud.mode === 'login' ? 'ui.cloud.018' : cloud.mode === 'signup' ? 'ui.cloud.019' : 'ui.cloud.020')}</button>
            </div>
          </>
        )}
        {cloud.freshRecoveryCode ? (
          <div className="app-cloud-recovery" role="alert">
            <strong>{t('ui.cloud.021')}</strong>
            <span>{t('ui.cloud.047', { p1: cloud.freshRecoveryCode.owner.nickname, p2: cloud.freshRecoveryCode.owner.username ?? '-', p3: cloud.freshRecoveryCode.owner.playerId })}</span>
            <code>{cloud.freshRecoveryCode.code}</code>
            <div className="app-settings-btns">
              <button className="app-btn is-small" onClick={() => void cloud.copyRecovery()}><Copy size={14} />{t('ui.cloud.022')}</button>
              <button className="app-btn is-small" onClick={() => setConfirmRecoveryClose(true)}><X size={14} />{t('ui.cloud.023')}</button>
            </div>
            {confirmRecoveryClose ? <div className="app-cloud-confirm">
              <span>{t('ui.cloud.024')}</span>
              <button className="app-btn is-small is-danger" onClick={() => { cloud.dismissRecovery(); setConfirmRecoveryClose(false) }}>{t('ui.cloud.025')}</button>
              <button className="app-btn is-small" onClick={() => setConfirmRecoveryClose(false)}>{t('ui.cloud.026')}</button>
            </div> : null}
          </div>
        ) : null}
      </div>

      <div className="app-cloud-section">
        <div className="app-cloud-heading">
          <strong>{t('ui.cloud.027')}</strong>
          <button className="app-btn is-small" onClick={cloud.refresh} disabled={!profile || blocked}><RefreshCw size={14} />{t('ui.cloud.028')}</button>
        </div>
        {profile ? <>
          <div className="app-cloud-latest">
            <span>{t('ui.cloud.029')}</span>
            <strong>{cloud.latest ? cloud.latest.version > 0 ? `v${cloud.latest.version}` : t('ui.cloud.037') : t('ui.cloud.030')}</strong>
            {cloud.latest?.createdAt ? <time>{timeLabel(cloud.latest.createdAt)}</time> : null}
          </div>
            <div className="app-settings-btns">
              <button className="app-btn is-small" onClick={cloud.previewUpload} disabled={blocked || cloud.savePaused}><CloudUpload size={14} />{t('ui.cloud.031')}</button>
              <button className="app-btn is-small" onClick={() => cloud.previewDownload()} disabled={blocked || cloud.latest?.version === 0}><CloudDownload size={14} />{t('ui.cloud.032')}</button>
            </div>
          <div className="app-cloud-versions" aria-label={t('ui.cloud.033')}>
            {cloud.versions.map(version => <div className="app-cloud-version" key={version.version}>
              <span>v{version.version}</span><time>{timeLabel(version.createdAt)}</time>
              <button className="app-btn is-small" title={`${t('ui.cloud.032')} v${version.version}`} aria-label={`${t('ui.cloud.032')} v${version.version}`} onClick={() => cloud.previewDownload(version.version)} disabled={blocked}><CloudDownload size={14} /></button>
            </div>)}
          </div>
          {cloud.uploadConfirm ? (
            <div className="app-cloud-confirm" role="group" aria-label={t('ui.cloud.034')}>
              <p>{t('ui.cloud.035', { p1: profile.nickname, p2: profile.username ?? '-', p3: cloud.uploadConfirm.baseVersion })}</p>
              <p>{cloud.uploadConfirm.baseVersion > 0 ? t('ui.cloud.036') : t('ui.cloud.037')}</p>
              <div className="app-settings-btns">
                <button className="app-btn is-small is-primary" onClick={cloud.confirmUpload} disabled={blocked || cloud.savePaused}><Save size={14} />{t('ui.cloud.038')}</button>
                <button className="app-btn is-small" onClick={() => cloud.setUploadConfirm(null)}><X size={14} />{t('ui.cloud.026')}</button>
              </div>
            </div>
          ) : null}
          {cloud.downloadCandidate ? (
            <div className="app-cloud-confirm" role="group" aria-label={t('ui.cloud.039')}>
              <p>{t('ui.cloud.035', { p1: profile.nickname, p2: profile.username ?? '-', p3: cloud.downloadCandidate.version })}</p>
              <p>{t('ui.cloud.040', { p1: cloud.downloadCandidate.version, p2: cloud.downloadCandidate.pilot, p3: timeLabel(cloud.downloadCandidate.savedAt), p4: cloud.downloadCandidate.ironman ? t('ui.cloud.041') : t('ui.cloud.042') })}</p>
              <p>{t('ui.cloud.046')}</p>
              <div className="app-settings-btns">
                <button className="app-btn is-small is-danger" onClick={cloud.confirmDownload} disabled={blocked || cloud.savePaused}><CloudDownload size={14} />{t('ui.cloud.063')}</button>
                <button className="app-btn is-small" onClick={() => cloud.setDownloadCandidate(null)}><X size={14} />{t('ui.cloud.026')}</button>
              </div>
            </div>
          ) : null}
          {cloud.savePaused ? <span className="app-cloud-error">{t('ui.cloud.044')}</span> : null}
        </> : <span className="app-cloud-muted">{t('ui.cloud.045')}</span>}
        <div className="app-cloud-status" role="status" aria-live="polite">{cloud.applying ? t('ui.cloud.130') : cloud.status ? t(cloud.status.id, cloud.status.params) : ''}</div>
      </div>
    </section>
  )
}
