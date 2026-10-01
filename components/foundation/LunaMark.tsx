/** Small, code-native faceted halo. Current color keeps every use theme-aware. */
export default function LunaMark({ size = 32 }: { size?: number }) {
  return <svg className="halo-luna-mark" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
    <path d="M24 3 42.2 13.5v21L24 45 5.8 34.5v-21Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="m15 6 25 9 2 20-26 7L6 24Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" opacity=".7" />
    <path d="m30 5 12 22-12 16L7 31l4-20Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" opacity=".75" />
    <path d="m24 10 12.1 7v14L24 38l-12.1-7V17Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="m24 3 12.1 14 6.1 17.5L24 38 5.8 34.5 11.9 17ZM42.2 13.5 36.1 31 24 45 11.9 31 5.8 13.5 24 10Z" stroke="currentColor" strokeWidth=".8" strokeLinejoin="round" opacity=".55" />
  </svg>;
}
