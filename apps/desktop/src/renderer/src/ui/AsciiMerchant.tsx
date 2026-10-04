import { useEffect, useState } from 'react'
import { tr } from '../i18n/locale'

/** 等宽字符格，换帧不改占位尺寸。 */
export function merchantFrame(frame: number, mood: 'idle' | 'pitch' | 'deal'): string {
  const eye = frame % 7 === 5 ? '-' : mood === 'deal' ? '^' : mood === 'pitch' ? '@' : 'o'
  const hand = frame % 2 ? '~' : '_'
  return [
    '           .----------.           ',
    '         .\'  .------.  \'.         ',
    '        /   /        \\   \\        ',
    `       |   |  ${eye}    ${eye}  |   |       `,
    '       |   |    __    |   |       ',
    '        \\  \\  \\__/  /  /        ',
    '         \\  \'------\'  /         ',
    '       .--\'----------\'--.        ',
    '      /    .--------.    \\       ',
    '     |    /  /\\  \\  \\    |      ',
    '     |   |  /  \\  |  |   |      ',
    '   __/   | /    \\ |  |   \\__    ',
    `  /${hand}    / /      \\ \\ \\    ${hand}\\   `,
    ' /  /--\' /        \\ \'--\\  \\   ',
    '(  (   _/   /\\     \\_   )  )   ',
    ' \\__\\ (___/  \\_____) /__/    ',
    '     \\____/    \\____/         ',
  ].map((line) => line.padEnd(36, ' ')).join('\n')
}

export function AsciiMerchant({ mood }: { mood: 'idle' | 'pitch' | 'deal' }) {
  const [frame, setFrame] = useState(0)
  const [still, setStill] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setStill(media.matches || document.body.classList.contains('no-fx'))
    const observer = new MutationObserver(sync)
    media.addEventListener('change', sync)
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    sync()
    return () => { media.removeEventListener('change', sync); observer.disconnect() }
  }, [])
  useEffect(() => {
    if (still) return
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % 14), 420)
    return () => window.clearInterval(timer)
  }, [still])
  return <div className="app-bm-portrait" role="img" aria-label={tr('ui.blackMarket.023')}>
    <pre aria-hidden="true">{merchantFrame(still ? 0 : frame, mood)}</pre>
  </div>
}
