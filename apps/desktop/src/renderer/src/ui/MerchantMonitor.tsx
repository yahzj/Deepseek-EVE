import { useId } from 'react'
import { tr } from '../i18n/locale'

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
          <path d="M107 296C117 256 140 231 165 225L255 225C283 233 307 259 317 296Z" className="app-bm-merchant-coat" />
          <path d="M163 220L186 263L210 241L235 263L258 220M187 262L175 296M235 262L245 296M210 241V296" className="app-bm-merchant-seam" />
          <path d="M146 136C139 89 153 51 180 40C203 30 240 37 257 58C274 80 278 112 270 143L262 180C257 205 238 229 210 232C179 230 156 207 151 181Z" className="app-bm-merchant-head" />
          <path d="M166 80C180 65 202 59 224 65M249 84L256 103M154 118L162 139M151 166L163 176M270 162L260 176" className="app-bm-merchant-detail" />
          <path d="M159 120C169 107 187 107 199 119M220 118C232 106 250 109 259 122" className="app-bm-merchant-brow" />
          <g className="app-bm-merchant-eyes">
            <ellipse cx="180" cy="128" rx="17" ry="11" />
            <ellipse cx="239" cy="128" rx="17" ry="11" />
            <path d="M182 119V135M236 119V135" />
          </g>
          <path d="M201 139L197 161Q210 168 223 160L219 142" className="app-bm-merchant-detail" />
          <path d={mood === 'deal' ? 'M184 180Q210 205 238 180' : mood === 'pitch' ? 'M184 181Q214 196 238 178' : 'M188 185Q212 190 234 183'} className="app-bm-merchant-mouth" />
          <path d="M154 178C139 185 127 204 132 222C137 240 125 250 113 243C101 236 105 218 111 203C117 188 111 173 99 179C88 184 88 206 92 225C97 251 81 271 62 259C42 246 57 226 63 233" className="app-bm-merchant-tentacle" />
          <path d="M169 206C160 222 157 249 170 258C182 266 189 249 182 238C172 219 192 215 196 232C201 250 199 272 182 283" className="app-bm-merchant-tentacle" />
          <g className="app-bm-merchant-hand">
            <path d="M263 177C282 186 290 205 286 221C280 243 297 252 310 238C319 229 308 218 301 207C290 190 301 177 313 189C323 199 319 215 328 228C338 244 357 236 354 221C352 214 345 215 344 223" className="app-bm-merchant-tentacle" />
          </g>
          <path d="M269 205C272 222 258 241 260 261C263 281 284 283 290 268C294 258 286 251 281 256" className="app-bm-merchant-tentacle" />
          <g className="app-bm-merchant-detail">
            <circle cx="113" cy="232" r="3" /><circle cx="101" cy="213" r="3" /><circle cx="88" cy="250" r="3" />
            <circle cx="175" cy="253" r="3" /><circle cx="184" cy="271" r="3" /><circle cx="304" cy="230" r="3" />
            <circle cx="325" cy="218" r="3" /><circle cx="342" cy="233" r="3" />
          </g>
          <path d="M149 267H170M253 275H275" className="app-bm-merchant-seam" />
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
