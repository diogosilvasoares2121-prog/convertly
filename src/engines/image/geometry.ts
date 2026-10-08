/** Size of an image after rotation (bounding box for arbitrary angles). */
export function rotatedSize(width: number, height: number, degrees: number): { width: number; height: number } {
  const normalized = ((degrees % 360) + 360) % 360;
  if (normalized === 0 || normalized === 180) return { width, height };
  if (normalized === 90 || normalized === 270) return { width: height, height: width };
  const rad = (normalized * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return { width: Math.round(width * cos + height * sin), height: Math.round(width * sin + height * cos) };
}
