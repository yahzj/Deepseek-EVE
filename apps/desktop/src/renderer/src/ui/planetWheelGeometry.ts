export const PLANET_WHEEL_SIZE = 360
export function planetWheelPosition(anchor: { x: number; y: number }, width: number, height: number) {
  const half = PLANET_WHEEL_SIZE / 2, pad = 12
  const axis = (at: number, extent: number) => extent >= PLANET_WHEEL_SIZE + pad * 2
    ? Math.min(extent - half - pad, Math.max(half + pad, at)) : extent / 2
  return { x: axis(anchor.x, width), y: axis(anchor.y, height) }
}
