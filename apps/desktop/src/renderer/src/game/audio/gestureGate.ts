export function webAwaitingFirstGesture(): boolean {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
    if (!/^https?:$/.test(window.location.protocol)) return false
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } }).userActivation
    return ua?.hasBeenActive === false
  } catch {
    return false
  }
}
