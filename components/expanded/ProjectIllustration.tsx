import './explore-action-visuals.css';

export type ActionArtwork = 'garden' | 'tree' | 'bee' | 'solar' | 'water' | 'soil' | 'compost' | 'cleanup' | 'air' | 'food' | 'home';
const projectArtwork: Record<string, ActionArtwork> = {
  'demo-habitat-project': 'garden', 'balcony-pollinators': 'garden', 'community-garden': 'garden',
  'native-tree': 'tree', 'winter-habitat': 'tree', 'bee-house': 'bee', 'solar-oven': 'solar',
  'soil-test-plan': 'soil', 'home-compost': 'compost', 'community-cleanup': 'cleanup',
  'food-waste-week': 'food', 'air-cleaner-plan': 'air', 'moisture-check': 'home',
};
export const artworkForProject = (id: string): ActionArtwork => projectArtwork[id] ?? 'water';

/** Decorative project sketches, never measured plans or images of actual venues. */
export default function ProjectIllustration({ kind, compact = false }: { kind: ActionArtwork; compact?: boolean }) {
  return <span className={`ex-action-art ex-action-art--${kind}${compact ? ' ex-action-art--small' : ''}`} data-artwork={kind} aria-hidden="true">
    <svg viewBox="0 0 280 170" fill="none" focusable="false">
      <path className="ex-art-ground" d="M18 145C76 133 98 151 150 142S230 136 266 147" />
      <g stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {kind === 'bee' ? <><path className="ex-art-fill" d="M79 137V67L140 27l61 40v70Z" /><path d="m67 71 73-52 73 52M95 139V79h90v60M140 82v52" /><g className="ex-art-ink">{[103,119,160,177].map(x => <g key={x}>{[90,108,126].map(y => <circle key={y} cx={x} cy={y} r="5" />)}</g>)}</g><path className="ex-art-accent" d="M223 59c9-12 15-1 9 4 14-2 15 10 2 13-11 3-17-9-11-17Z" /><path d="m219 70-12 5" /></>
        : kind === 'solar' ? <><path className="ex-art-fill" d="m82 87 111-29 18 70-111 28Z" /><path className="ex-art-accent" d="m82 87 12-63 97 11 2 23Z" /><path d="m97 94 85-22 12 46-85 22ZM228 27v15m-26-8 10 9m30 13h16m-32 13-8 9" /><path d="M161 53c-6 3-10 9-9 15m-15-21c-8 5-12 12-10 22" /><path d="m173 95 7 24" /></>
        : kind === 'tree' ? <><path d="M136 143V75m0 25-19-15m20 33 22-20" /><path className="ex-art-fill" d="M100 92c-31-2-28-38-10-44-4-23 28-33 43-20 17-20 49-4 46 15 24 4 38 39 9 50-20 11-67 9-88-1Z" /><path className="ex-art-accent" d="M49 129c4-17 25-17 31-2m113 4c-3-14 19-21 30-8" /><path d="M58 143v-15m144 13v-15" /></>
        : kind === 'garden' ? <><path className="ex-art-fill" d="m66 117 11 30h128l10-30Z" /><path d="M90 116V67m43 49V48m42 68V71m25 45V61" /><path className="ex-art-accent" d="M90 89c-25 0-26-18-26-18 25-2 26 18 26 18Zm43-22c-25-3-20-23-20-23 21 2 20 23 20 23Zm43 29c23-4 22-23 22-23-21-1-22 23-22 23Z" /><path d="M79 61c-17-9-4-25 11-15 16-12 31 7 13 17-2 11-23 12-24-2Zm43-24c-16-8-3-25 10-16 15-10 28 6 13 15-3 9-20 10-23 1Z" /><path d="m197 49 5-18m-14 6 23 11" /></>
        : kind === 'compost' ? <><path className="ex-art-fill" d="M88 71h108l-10 75H98Z" /><path d="M79 71h125m-108 25h91m-87 26h83M112 71l-10-14m34 12 8-17m26 18 11-18" /><path className="ex-art-accent" d="M123 40c-3-21 21-23 24-36 17 24-1 48-24 36Z" /><path d="m124 45 20-22m-74 88-11 8m147 1 12-8" /></>
        : kind === 'cleanup' ? <><path className="ex-art-fill" d="m112 74-9 14-9 44c16 17 66 17 84 0l-8-44-13-14Z" /><path d="m113 77 2-21h39l3 21m-34 20-3 31m29-34 6 34M72 43l15 99m-20-97 10-4m-5 99 28-4" /><path className="ex-art-accent" d="M205 122c-21-3-27-20-19-36 21 0 32 19 19 36Z" /><path d="m200 132-4-32" /></>
        : kind === 'air' ? <><path className="ex-art-fill" d="M104 70h77v77h-77Z" /><path d="m104 70 14-13h76l-13 13m0 77 13-13V57" /><path d="M117 89h49m-49 13h49m-49 13h49m-49 13h49M52 68c45 0 39-36 22-33m124 68c33 0 35-26 20-30M45 95h41m114 30c42 0 46-15 34-19" /></>
        : kind === 'food' ? <><path className="ex-art-fill" d="M78 102h125l-16 43H93Z" /><path className="ex-art-accent" d="M104 99c-20-2-29-29-14-43 10-12 27-3 34-1 7-8 25-7 26 10 3 23-10 36-28 36M166 99l-9-40 20-5 10 45" /><path d="m111 57 7-20m-9 5c-7-15-24-13-24-13 4 19 24 13 24 13Zm54 23 17-3m-16 15 18-3m-18 15 20-3" /></>
        : kind === 'soil' ? <><path className="ex-art-fill" d="M67 112c38-11 80-10 118 0l26 33H47Z" /><path d="M120 108V57m-19 31 19 8m2-18 20-11" /><path className="ex-art-accent" d="M120 75c-24-3-26-23-26-23 26-3 26 23 26 23Zm3-16c0-23 24-28 24-28 5 23-24 28-24 28Z" /><path d="m188 42-30 91m20-84 20 7M63 129h22m51 2h21" /><path d="M218 92h22v43h-22Zm-4 0h30" /></>
        : kind === 'home' ? <><path className="ex-art-fill" d="M91 52h96v91H91Z" /><path d="M138 52v91M91 97h96m-105 50h114" /><path className="ex-art-accent" d="M113 84c-21-20 10-47 10-47s15 33-10 47Z" /><path d="M211 64v53m0-18c22-2 21-21 21-21-21 0-21 21-21 21Z" /></>
        : <><path className="ex-art-fill" d="M78 96h54v49H78Zm82-26h48v75h-48Z" /><path d="M69 96h72m13-26h61m-48 22h34m-34 15h34m-34 15h34" /><path className="ex-art-accent" d="M99 83c-34-24 3-57 3-57s35 33-3 57Z" /><path d="m225 45-2 10m-34-7 3-16M44 128c27-10 31-32 14-36" /></>}
      </g>
      <path className="ex-art-detail" d="M31 52c14-7 20-2 26-9m178 95 13-7" />
    </svg>
  </span>;
}
