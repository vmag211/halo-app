/** Decorative fieldbook sketch. No dates, status, measurements or controls. */
export default function WeekScene() {
  return <svg className="mw-fieldbook" viewBox="0 0 120 118" fill="none" aria-hidden="true" focusable="false">
    <path className="mw-fieldbook-paper" d="M15 53h48v48H15z" fill="currentColor" fillOpacity=".06" stroke="currentColor" strokeOpacity=".65" />
    <path className="mw-fieldbook-lines" d="M24 62h24M24 73h29M24 83h16M24 93h23" stroke="currentColor" strokeOpacity=".5" strokeLinecap="round" />
    <path className="mw-fieldbook-stem" d="M50 105C57 91 67 75 79 60C87 50 93 38 98 16" stroke="currentColor" strokeLinecap="round" />
    <path className="mw-fieldbook-leaf" d="M62 86C46 78 45 68 49 58C61 61 67 72 62 86Z" fill="currentColor" fillOpacity=".17" stroke="currentColor" />
    <path className="mw-fieldbook-leaf" d="M77 65C61 57 61 45 66 35C78 40 82 52 77 65Z" fill="currentColor" fillOpacity=".12" stroke="currentColor" />
    <path className="mw-fieldbook-leaf" d="M87 47C96 31 106 31 114 35C108 47 100 50 87 47Z" fill="currentColor" fillOpacity=".18" stroke="currentColor" />
    <path className="mw-fieldbook-leaf" d="M94 30C82 23 83 14 88 6C97 10 98 20 94 30Z" fill="currentColor" fillOpacity=".1" stroke="currentColor" />
    <path d="M70 106h24M10 108h26" stroke="currentColor" strokeOpacity=".35" strokeLinecap="round" />
  </svg>;
}
