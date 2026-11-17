
/** 三件套（`typeof` 守卫：全局没定义时不抛 ReferenceError —— 这是 JS 里唯一能这么判的写法） */
export const BUILD = {
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
  sha: typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev',
  time: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '—',
} as const

export const BUILD_FORM: 'web' | 'desktop' =
  typeof window !== 'undefined' && (window as { whale?: unknown }).whale !== undefined ? 'desktop' : 'web'
