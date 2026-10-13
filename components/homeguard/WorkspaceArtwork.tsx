'use client';

import { createContext, useContext, type ReactNode } from 'react';

export type WorkspaceArtworkKind = 'tests' | 'report' | 'maintenance' | 'moisture' | 'food' | 'pantry' | 'fish' | 'garden' | 'evidence' | 'grower' | 'water' | 'summary';
const ArtworkContext = createContext<WorkspaceArtworkKind>('tests');

export function workspaceArtwork(section: string, view: string): WorkspaceArtworkKind {
  if (section === 'maintenance') return view.startsWith('observation') ? 'moisture' : 'maintenance';
  if (section === 'summary') return 'summary';
  if (section === 'tests') return ['report', 'results', 'attachments', 'history', 'export'].includes(view) ? 'report' : 'tests';
  if (view.startsWith('pantry')) return 'pantry';
  if (view.startsWith('fish')) return 'fish';
  if (view.startsWith('garden')) return 'garden';
  if (view.startsWith('evidence')) return 'evidence';
  if (view.startsWith('grower')) return 'grower';
  if (view === 'water' || view.startsWith('usage')) return 'water';
  return 'food';
}

export function WorkspaceArtworkProvider({ kind, children }: { kind: WorkspaceArtworkKind; children: ReactNode }) {
  return <ArtworkContext.Provider value={kind}>{children}</ArtworkContext.Provider>;
}

/** Editorial drawings for navigation, not photographs, measurements or test instructions. */
export function WorkspaceArtwork({ kind: explicit, compact = false }: { kind?: WorkspaceArtworkKind; compact?: boolean }) {
  const context = useContext(ArtworkContext); const kind = explicit ?? context;
  return <span className={`hg-work-art${compact ? ' hg-work-art--compact' : ''}`} data-work-art={kind} aria-hidden="true">
    <svg viewBox="0 0 240 170" fill="none" focusable="false">
      <path className="hg-art-base" d="M20 149c54-9 96 7 143-1s38-5 59 0" />
      <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {kind === 'tests' ? <>
          <path className="hg-art-paper" d="M64 22h85l19 20v99H64Z" /><path d="M149 22v21h19M79 52h42m-42 16h68m-68 17h42m-42 17h68" />
          <path className="hg-art-color" d="M145 80h38v57c0 19-38 19-38 0Z" /><path d="M140 79h48m-35 20h22m-22 13h22m-22 13h22" /><path className="hg-art-soft" d="M33 101c-18-14 3-39 3-39s23 28-3 39Z" />
        </> : kind === 'report' || kind === 'summary' ? <>
          <path className="hg-art-soft" d="M58 29h110v117H58Z" /><path className="hg-art-paper" d="M70 17h107v125H70Z" />
          <path d="M87 39h54m-54 16h72m-72 15h62M87 91h15v16H87Zm25 0h15v16h-15Zm25 0h22v16h-22ZM87 123h45" />
          {kind === 'summary' ? <><path className="hg-art-color" d="m172 99 25-9 23 9v26c0 13-14 21-23 26-10-5-25-13-25-26Z" /><path d="m186 118 9 9 13-19" /></> : <><path className="hg-art-color" d="m171 135 34-71 11 5-34 71-13 11Z" /><path d="m201 73 12 6m-44 71 12-10" /></>}
        </> : kind === 'maintenance' ? <>
          <path className="hg-art-soft" d="M46 147V66l63-43 67 43v81Z" /><path d="m36 69 73-51 77 51M59 83h34v37H59Zm48 66v-42h31v42" />
          <path className="hg-art-paper" d="M154 89h55v60h-55Z" /><path d="M154 105h55m-42-23v15m27-15v15m-28 24h9m13 0h9m-31 14h9" />
          <path className="hg-art-color" d="M120 43c-3-14 9-25 21-18l-10 11 10 11 12-10c6 11-3 22-16 21l-26 29-12-12Z" />
        </> : kind === 'moisture' ? <>
          <path className="hg-art-paper" d="M51 27h113v111H51Z" /><path d="M107 27v111M51 81h113m-121 60h130" />
          <path className="hg-art-color" d="M73 64c-20-16 3-34 3-34s21 23-3 34Zm64 45c-17-14 3-31 3-31s18 21-3 31Z" />
          <path className="hg-art-soft" d="M179 89h35v59h-35Z" /><path d="M188 100h18v15h-18Zm9 26v9m-9-6h4m10 0h4" />
        </> : kind === 'pantry' ? <>
          <path className="hg-art-paper" d="M44 23h77v121H44Z" /><path d="M44 68h77M107 43v13m0 25v22M53 145v6m58-6v6" />
          <path className="hg-art-color" d="M148 77h39v68h-39Z" /><path d="M143 76h49m-43-8h36m-24 23h17m-17 15h17M132 149h82" />
          <path className="hg-art-soft" d="M191 124c-7-22 13-32 13-32 14 24-4 37-13 32Z" /><path d="m195 147 8-31" />
        </> : kind === 'fish' ? <>
          <path className="hg-art-soft" d="M27 101c37-28 78 18 117-6s49-1 69-7v48H27Z" /><path d="M27 100c37-28 78 18 117-6s49-1 69-7M35 135c23-6 45 7 67 1m55-11c20-8 35 5 52 0" />
          <path className="hg-art-color" d="M63 73c23-24 55-24 81-7l24-17v44l-24-15c-25 18-56 17-81-5Z" /><path d="M85 62c8 8 8 17 0 24m34-22 9-11m-5 26 11 11" /><circle cx="78" cy="71" r="2" fill="currentColor" />
          <path className="hg-art-paper" d="M177 17h31v47h-31Z" /><path d="M184 27h17m-17 9h17m-17 9h11" />
        </> : kind === 'garden' || kind === 'grower' || kind === 'food' ? <>
          <path className="hg-art-paper" d="m46 110 11 35h114l12-35Z" /><path d="M41 110h146M65 111V62m43 49V42m40 68V72" />
          <path className="hg-art-color" d="M65 88c-24-3-23-24-23-24 23-2 23 24 23 24Zm45-26c-26-4-25-26-25-26 24-2 25 26 25 26Zm40 32c24-4 23-24 23-24-23-1-23 24-23 24Z" />
          <path className="hg-art-soft" d="M111 46c0-28 29-32 29-32 4 25-29 32-29 32Z" />
          {kind === 'grower' ? <><path className="hg-art-paper" d="M182 75h37v69h-37Z" /><path d="M177 75h47m-33 17h19m-19 12h19m-19 12h19m-19 12h12" /></> : <><path d="M202 146v-33m0 14c-21-2-20-23-20-23 20 0 20 23 20 23Zm0-12c0-22 22-28 22-28 5 24-22 28-22 28Z" /></>}
        </> : kind === 'evidence' ? <>
          <path className="hg-art-paper" d="M52 25h109v116H52Z" /><path d="M70 45h50m-50 16h73m-73 15h51m-51 21h32m-32 17h24" />
          <circle className="hg-art-soft" cx="156" cy="113" r="28" /><path d="m176 134 27 26M143 112h27m-14-13v26" />
        </> : <>
          <path className="hg-art-paper" d="M47 72h65v74H47Z" /><path d="M57 85h43m-43 17h43m-43 17h43m-43 17h26" />
          <path className="hg-art-color" d="M82 57c-28-19 3-48 3-48s30 30-3 48Z" />
          <path className="hg-art-soft" d="M145 102c0-31 15-47 35-49 2 35-11 49-35 49Z" /><path d="M143 147v-44m0 19c-28-3-30-25-30-25 27-2 30 25 30 25Zm4-13 24-32M190 142h29m-25-10h20" />
        </>}
      </g>
    </svg>
  </span>;
}
