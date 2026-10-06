import { useId } from 'react'
import { tr } from '../i18n/locale'
import { Glyph } from './Glyphs'

/** 屏幕信号层独立动画，不对整幅立绘做动态滤镜或React换帧。 */
export function MerchantMonitor({ mood }: { mood: 'idle' | 'pitch' | 'deal' }) {
  const id = useId().replace(/:/g, '')
  const clip = `merchant-screen-${id}`
  const scan = `merchant-scan-${id}`
  return <div className={`app-bm-monitor is-${mood}`} role="img" aria-label={tr('ui.blackMarket.023')}>
    <svg viewBox="0 0 420 350" className="app-bm-monitor-art" aria-hidden="true">
      <defs>
        <clipPath id={clip}><rect x="26" y="24" width="368" height="282" rx="12" /></clipPath>
        <pattern id={scan} x="0" y="0" width="4" height="5" patternUnits="userSpaceOnUse">
          <path d="M0 0H4" className="app-bm-scanline" />
        </pattern>
      </defs>
      <rect x="4" y="3" width="412" height="329" rx="17" className="app-bm-monitor-case" />
      <path d="M19 317V20Q19 15 25 15H395Q401 15 401 20V317" className="app-bm-monitor-rim" />
      <rect x="26" y="24" width="368" height="282" rx="12" className="app-bm-monitor-glass" />
      <g clipPath={`url(#${clip})`}>
        <path d="M45 67H76M45 67V87M375 67H344M375 67V87M45 275H76M45 275V255M375 275H344M375 275V255" className="app-bm-screen-guide" />
        <g className="app-bm-merchant-image">
          <g transform="translate(78 34)">
            <g className="app-bm-comms-portrait" transform={mood === 'pitch' ? 'rotate(-2 132 145)' : mood === 'deal' ? 'rotate(1 132 145)' : undefined}>
              <g transform="scale(11)">
                <path d="M3.6 14.5C2.5 7.4 5.9 0.4 12 0.4C18.1 0.4 21.5 7.4 20.4 14.5L22.6 22.8L18.5 23.5L16.8 16.1H7.2L5.5 23.5L1.4 22.8Z" className="app-bm-merchant-hood" />
                <path d="M5.2 13.8C4.6 7.4 7.8 2.7 12 2.7C16.2 2.7 19.4 7.4 18.8 13.8L17.9 17H6.1Z" className="app-bm-merchant-hood-opening" />
                <path d="M3.6 14.5L5.5 20.6L4.2 23.2M20.4 14.5L18.5 20.6L19.8 23.2M4.1 7.5L6.2 4.6M19.9 7.5L17.8 4.6" className="app-bm-merchant-hood-seam" />
              </g>
              <Glyph name="faction-octopus" size={264} color="currentColor" className="app-bm-comms-avatar" />
              <g transform="scale(11)" className="app-bm-merchant-monocle">
                <circle cx="14.94" cy="8.25" r="2.55" />
                <path d="M17.08 9.65C18.1 10.8 18.2 12.3 17.6 13.9C17.1 15.5 17.9 16.8 19.1 17.3" />
                <path d="M13.35 6.72L14.1 6.25" className="app-bm-monocle-reflection" />
              </g>
            </g>
          </g>
        </g>
        <rect x="26" y="24" width="368" height="282" rx="12" fill={`url(#${scan})`} />
        <g className="app-bm-signal-band">
          <path d="M26 50H394M26 54H394M26 61H394" />
          <rect x="26" y="48" width="368" height="18" />
        </g>
        <path d="M33 30H181L34 166Z" className="app-bm-screen-reflection" />
      </g>
      <path d="M30 318H140M280 318H363M35 324H135M285 324H357" className="app-bm-monitor-vents" />
      <circle cx="378" cy="319" r="4" className="app-bm-monitor-led" />
      <path d="M178 332V340H242V332M153 345H267" className="app-bm-monitor-stand" />
    </svg>
  </div>
}
