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
          <path d="M147 124C119 150 128 193 113 218C101 239 77 227 87 209C89 205 94 204 98 208C99 187 95 158 103 122C111 82 133 51 157 43L189 48Z" className="app-bm-merchant-tentacle" />
          <path d="M265 71C302 99 305 139 297 175C289 202 305 230 289 244C279 253 260 251 257 238C275 234 270 218 260 199L246 107Z" className="app-bm-merchant-tentacle" />
          <path d="M105 299L117 240Q127 219 174 210H240Q276 216 292 244L311 299Z" className="app-bm-merchant-coat" />
          <path d="M180 181V214Q211 239 237 211V180" className="app-bm-merchant-head" />
          <path d="M174 211L156 230L184 264L204 228M240 210L264 227L235 262L213 228M204 229L194 299M213 229L229 299M130 250L147 299M279 254L270 299" className="app-bm-merchant-seam" />
          <path d="M135 271H163V288H139ZM243 267H270V285H239Z" className="app-bm-merchant-seam" />
          <path d="M179 222Q207 250 237 221M189 243L202 290" className="app-bm-merchant-detail" />
          <path d="M145 120L120 104L127 142L151 151M267 117L296 99L286 140L264 150" className="app-bm-merchant-head" />
          <path d="M132 117L138 138M282 113L274 137" className="app-bm-merchant-detail" />
          <path d="M152 86Q207 49 262 91L268 135Q266 172 244 191Q219 211 194 202Q157 189 150 152Z" className="app-bm-merchant-head" />
          <path d="M147 107C123 83 139 45 163 38C185 26 220 35 236 29C267 36 285 61 279 92L263 121L252 89C228 91 215 78 209 65C201 87 177 104 150 110Z" className="app-bm-merchant-tentacle" />
          <path d="M145 104C147 130 144 158 151 180C157 195 171 183 166 173C161 164 167 130 179 102M257 82C287 105 275 135 278 157C280 175 302 177 305 163C306 157 301 152 296 157C294 139 300 105 282 86" className="app-bm-merchant-tentacle" />
          <path d="M154 59Q180 37 204 47M226 46Q255 45 265 62" className="app-bm-merchant-detail" />
          <path d="M161 117L195 111M225 111Q245 106 257 117" className="app-bm-merchant-brow" />
          <g className="app-bm-merchant-eyes">
            <path d="M157 134Q177 113 199 129Q194 153 173 151Q159 148 157 134ZM222 130Q242 112 262 132Q258 151 239 150Q226 148 222 130Z" />
            <ellipse cx="183" cy="134" rx="7" ry="12" className="app-bm-merchant-pupil" />
            <ellipse cx="240" cy="133" rx="7" ry="12" className="app-bm-merchant-pupil" />
            <circle cx="185" cy="130" r="2" className="app-bm-merchant-glint" /><circle cx="242" cy="129" r="2" className="app-bm-merchant-glint" />
          </g>
          <path d="M211 145L207 158L218 156M164 162L177 165M249 162L255 156" className="app-bm-merchant-detail" />
          <path d={mood === 'deal' ? 'M190 172Q217 195 242 168L238 181Q215 198 197 181Z' : mood === 'pitch' ? 'M193 176Q218 188 242 167M237 166L246 169' : 'M198 179Q219 183 238 171'} className="app-bm-merchant-mouth" />
          <path d="M137 63Q167 26 207 38Q258 33 278 77" className="app-bm-merchant-headset" />
          <rect x="129" y="107" width="17" height="40" rx="7" className="app-bm-merchant-headset" />
          <path d="M136 144L141 159H158" className="app-bm-merchant-seam" />
          <circle cx="160" cy="159" r="3" className="app-bm-merchant-pupil" />
          <g className="app-bm-merchant-hand">
            <path d="M279 285Q328 302 340 270L344 242L324 238Q318 264 292 255Z" className="app-bm-merchant-coat" />
            <path d="M325 240L318 219Q309 207 315 199Q321 194 328 211L330 215L333 182Q334 174 340 176Q345 178 343 199L346 184Q350 175 355 180Q358 184 352 205L357 194Q362 190 365 195Q367 201 357 218L350 243Q338 249 325 240Z" className="app-bm-merchant-head" />
            <path d="M325 240L351 244M335 216L345 220" className="app-bm-merchant-seam" />
          </g>
          <g className="app-bm-merchant-detail">
            <ellipse cx="115" cy="144" rx="4" ry="7" /><ellipse cx="112" cy="167" rx="4" ry="7" /><ellipse cx="107" cy="190" rx="4" ry="6" />
            <ellipse cx="289" cy="128" rx="3" ry="5" /><ellipse cx="288" cy="145" rx="3" ry="5" /><ellipse cx="287" cy="162" rx="3" ry="5" />
            <circle cx="160" cy="146" r="3" /><circle cx="157" cy="163" r="3" /><circle cx="270" cy="221" r="3" /><circle cx="271" cy="237" r="3" />
          </g>
          <circle cx="182" cy="236" r="6" className="app-bm-merchant-badge" /><path d="M180 233L184 236L180 239" className="app-bm-merchant-seam" />
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
