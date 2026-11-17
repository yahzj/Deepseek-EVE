import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { moneyExactText, moneyFitCandidates, moneyFullCandidates, type MoneyLang } from '@whale/core'
import { tr, useL10n } from '../i18n/locale'

const PROBE_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  visibility: 'hidden',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  contain: 'layout style',
}

export function MoneyFit({
  amount,
  className,
  unit,
  exact,
  full,
}: {
  amount: number
  className?: string
  unit?: string
  exact?: string
  full?: boolean
}) {
  const boxRef = useRef<HTMLSpanElement | null>(null)
  const probeRef = useRef<HTMLSpanElement | null>(null)
  const { locale } = useL10n()
  const lang: MoneyLang = locale === 'en' ? 'en' : 'zh'
  const [text, setText] = useState(() => moneyExactText(amount, lang))

  const pick = (): void => {
    const box = boxRef.current
    const probe = probeRef.current
    if (!box || !probe) return
    const cs = getComputedStyle(box)
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
    const avail = box.clientWidth - padX
    if (avail <= 0) return
    const strip = (c: string): string => c.replace(/\s?(信用点|credits?|ISK)$/, '').trim()
    const raw = full === true ? moneyFullCandidates(amount, lang) : moneyFitCandidates(amount, lang)
    const cands = unit === undefined ? raw : raw.map(strip)
    const unitRe = /(信用点|credits?|ISK)$/
    const withUnit = raw.filter((c) => unitRe.test(c))
    const noUnit = raw.filter((c) => !unitRe.test(c))
    const ordered = unit !== undefined ? cands : [...withUnit, ...noUnit.map(strip)]
    let chosen = ordered[ordered.length - 1]!
    for (const c of ordered) {
      probe.textContent = unit === undefined ? c : `${c} ${unit}`
      if (probe.scrollWidth <= avail + 1) {
        chosen = c
        break
      }
    }
    setText((prev) => (prev === chosen ? prev : chosen))
    if (localStorage.getItem('whale-idle:debug') === '1') {
      box.dataset.mfDebug = `avail=${Math.round(avail)} lang=${lang} unit=${unit ?? '-'} full=${full === true ? 1 : 0} raw=[${raw.join(' | ')}] ordered=[${ordered.join(' | ')}] chosen=${chosen}`
    }
  }

  useLayoutEffect(pick, [amount, lang, full])
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => pick())
    ro.observe(box)
    return () => ro.disconnect()
  }, [amount, lang, full])
  useEffect(() => {
    const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts
    if (fonts?.ready) void fonts.ready.then(() => pick())
  }, [amount, lang, full])

  return (
    <span
      ref={boxRef}
      className={className}
      title={exact ?? tr("ui.MoneyFit.001", { p1: moneyExactText(amount, lang) })}    >
      {text}
      {unit !== undefined ? <span className="app-standing-key"> {unit}</span> : null}
      <span ref={probeRef} style={PROBE_STYLE} aria-hidden="true" />
    </span>
  )
}
