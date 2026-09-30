/** Canvas colours — mirror the CSS tokens in styles/tokens.css. */
export const PALETTE = {
  bg: '#05060b',
  cyan: '#2ee6ff',
  violet: '#8b5cff',
  white: '#f2f5ff',
  success: '#3dffb0',
  error: '#ff5a3d',
  warn: '#ffc14d',
  /** Online opponent. */
  pink: '#ff5ad1',
} as const;

export function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
