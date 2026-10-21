/** Small decorative line drawings. They never represent measurements or live conditions. */
export function HomeWorkspaceScene() {
  return <svg className="hg-scene" viewBox="0 0 260 88" fill="none" aria-hidden="true" focusable="false">
    <path className="hg-scene-ground" d="M12 77C57 72 85 80 126 77s77-6 122 0" />
    <g className="hg-scene-tests">
      <path className="hg-scene-wash" d="M65 71V17h78l21 21v35H65Z" />
      <path d="M71 71V13h73l20 20v39M144 13v21h20M86 31h31M86 44h53M86 55h34" />
      <path d="M171 37h24m-20 0v24c0 13 16 13 16 0V37m-16 18h16" />
      <path className="hg-scene-drift" d="M178 63h9M201 18v9m-4-5h8M49 44v8m-4-4h8" />
    </g>
    <g className="hg-scene-maintenance">
      <path className="hg-scene-wash" d="m73 43 52-32 53 32v32H73V43Z" />
      <path d="m58 45 67-38 66 38M73 38v36h105V38M114 75V50h25v25M85 44h17v16H85V44Zm65 0h16v16h-16V44Z" />
      <path className="hg-scene-drift" d="M29 57h21c12 0 12-14 3-14m144 17h17c12 0 12-14 3-14m-15-17h20" />
      <path d="M184 75c0-18 9-24 19-22 0 11-5 18-19 22Z" />
    </g>
    <g className="hg-scene-food">
      <path className="hg-scene-wash" d="M70 45h104l-8 29H79l-9-29Z" />
      <path d="M63 45h116M73 45l8 29h81l8-29M94 44c-15-14-9-27 4-24 3-12 17-12 19 0m9 24c0-18 11-28 25-26-1 13-8 23-25 26Zm3-4 17-17M114 45c-4-17-2-29 5-36 8 12 9 24 1 36" />
      <path className="hg-scene-leaf" d="M190 76V41m0 17c-15-1-23-10-21-20 15 1 23 7 21 20Zm0-8c0-15 9-23 21-22 1 12-7 22-21 22Z" />
      <path d="M50 64c-6-6-8-11-8-16-7 9-11 17-6 22s14 1 14-6Z" />
    </g>
    <g className="hg-scene-summary">
      <path className="hg-scene-wash" d="M80 17h80v57H80Z" />
      <path d="M76 72V13h85v60M86 7h84v60M90 29h30M90 41h56M90 51h45M90 61h32" />
      <path d="m170 43 22 8v13c0 10-13 15-22 19-10-4-22-9-22-19V51l22-8Z" />
      <path className="hg-scene-drift" d="M55 42v10m-5-5h10M196 17v9m-4-5h8" />
    </g>
  </svg>;
}
