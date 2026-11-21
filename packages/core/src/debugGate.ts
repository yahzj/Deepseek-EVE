
function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

export function isLocalDebugOrigin(protocol: string, hostname: string): boolean {
  const proto = (protocol || '').toLowerCase()
  if (proto !== 'http:' && proto !== 'https:') return false
  const host = (hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  if (host.endsWith('.local')) return true
  return isPrivateIPv4(host)
}
