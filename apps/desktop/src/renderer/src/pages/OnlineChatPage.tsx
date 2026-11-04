import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Clock3, Send, X } from 'lucide-react'
import { Panel } from '@whale/ui'
import { useL10n } from '../i18n/locale'
import type { OnlineChatController } from '../features/cloud/useOnlineChat'
import type { ToastFn } from './common'

function timeLabel(ts: number, locale: 'zh' | 'en'): string {
  return new Date(ts).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })
}

export function OnlineChatPage({ chat, onToast, onOpenSettings }: {
  chat: OnlineChatController
  onToast: ToastFn
  onOpenSettings: () => void
}): ReactNode {
  const { t } = useL10n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [stickToBottom, setStickToBottom] = useState(true)

  useEffect(() => { chat.activate() }, [chat.activate])
  useEffect(() => { setStickToBottom(true) }, [chat.channel])
  useEffect(() => {
    const node = scrollRef.current
    if (!node || !stickToBottom) return
    node.scrollTop = node.scrollHeight
  }, [chat.messages, stickToBottom])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!chat.send(chat.draft)) onToast(t('ui.chat.015'), true)
  }

  if (!chat.authenticated) {
    return (
      <div className="page-stack page-fill">
        <Panel className="is-fill win-fixed-body" title={t('ui.chat.001')}>
          <div className="app-win-body app-online-chat-login">
            <span className="app-dim">{t('ui.chat.002')}</span>
            <button className="app-btn is-primary" onClick={onOpenSettings}>{t('ui.chat.003')}</button>
          </div>
        </Panel>
      </div>
    )
  }

  return (
    <div className="page-stack page-fill">
      <Panel className="is-fill win-fixed-body" title={t('ui.chat.001')}>
        <div className="app-win-body app-online-chat-body">
          <div className="app-online-chat-toolbar">
            <span className="app-online-chat-count" role="status" aria-atomic="true">
              {t('ui.chat.004', { count: chat.onlineCount ?? '-' })}
            </span>
            <div className="app-tabs app-online-chat-channels" role="group" aria-label={t('ui.chat.005')}>
              {(['zh', 'en'] as const).map((channel) => (
                <button key={channel} className={`app-tab${chat.channel === channel ? ' is-active' : ''}`}
                  aria-pressed={chat.channel === channel} onClick={() => chat.selectChannel(channel)}>
                  {t(channel === 'zh' ? 'ui.chat.006' : 'ui.chat.007')}
                </button>
              ))}
            </div>
          </div>
          <div className="app-online-chat-history" ref={scrollRef} role="log" aria-live={chat.historyLoading || chat.olderLoading ? 'off' : 'polite'} aria-relevant="additions text"
            onScroll={(event) => {
              const node = event.currentTarget
              setStickToBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 64)
            }}>
            {chat.historyLoaded && chat.hasMore ? (
              <button className="app-btn is-small app-online-chat-older" disabled={chat.olderLoading} onClick={() => void chat.loadOlder()}>
                <ArrowUp size={14} />{t(chat.olderLoading ? 'ui.chat.009' : 'ui.chat.008')}
              </button>
            ) : null}
            {!chat.historyLoading && chat.historyLoaded && chat.messages.length === 0 ? <div className="app-online-chat-empty">{t('ui.chat.010')}</div> : null}
            {chat.messages.map((message) => (
              <article key={message.id === null ? `local-${message.clientId}` : `server-${message.id}`}
                className={`app-online-chat-message${message.own ? ' is-own' : ''}${message.delivery === 'failed' ? ' is-failed' : ''}`}
                data-chat-message-id={message.id ?? undefined}>
                <header>
                  <strong>{message.nickname}</strong>
                  <time>{timeLabel(message.ts, chat.locale)}</time>
                  {message.delivery === 'sent' || message.delivery === 'uncertain' || message.delivery === 'queued'
                    ? <span className="app-online-chat-delivery" role="img" title={t(message.delivery === 'queued' ? 'ui.chat.029' : 'ui.chat.025')}
                        aria-label={t(message.delivery === 'queued' ? 'ui.chat.029' : 'ui.chat.025')}><Clock3 size={13} /></span> : null}
                  {message.delivery === 'queued' && message.clientId
                    ? <button className="app-btn is-small app-online-chat-cancel" title={t('ui.chat.028')} aria-label={t('ui.chat.028')}
                        onClick={() => chat.dismiss(message.clientId!)}><X size={13} /></button> : null}
                </header>
                <p>{message.text}</p>
                {message.delivery === 'failed' && message.clientId ? (
                  <div className="app-online-chat-failed">
                    <span>{message.error ?? t('ui.chat.026')}</span>
                    <button className="app-btn is-small" onClick={() => chat.retry(message.clientId!, message.text)}>{t('ui.chat.013')}</button>
                    <button className="app-btn is-small" title={t('ui.chat.014')} aria-label={t('ui.chat.014')} onClick={() => chat.dismiss(message.clientId!)}><X size={14} /></button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          {!stickToBottom && chat.messages.length > 0 ? (
            <button className="app-btn is-small app-online-chat-jump" onClick={() => {
              const node = scrollRef.current
              if (node) node.scrollTop = node.scrollHeight
              setStickToBottom(true)
            }}><ArrowDown size={14} />{t('ui.chat.016')}</button>
          ) : null}
          <form ref={formRef} className="app-online-chat-compose" onSubmit={submit}>
            <textarea className="app-online-chat-input" aria-label={t('ui.chat.017')} maxLength={500} rows={2}
              value={chat.draft} onChange={(event) => chat.setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.preventDefault()
                  formRef.current?.requestSubmit()
                }
              }} />
            <button className="app-btn is-primary app-online-chat-send" type="submit" disabled={!chat.draft.trim()} title={t('ui.chat.018')} aria-label={t('ui.chat.018')}>
              <Send size={16} />
            </button>
            <span className="app-dim app-online-chat-limit">{chat.draft.length}/500</span>
          </form>
        </div>
      </Panel>
    </div>
  )
}
