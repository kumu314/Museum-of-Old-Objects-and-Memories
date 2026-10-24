export function WaxSeal({ className = '' }: { className?: string }) {
  return <span className={`workbench-wax-seal ${className}`} aria-hidden="true" />;
}

/** An engraved illustration, never presented as a photograph of the user's object. */
export function ObjectEngraving({ className = '' }: { className?: string }) {
  return <svg className={`workbench-engraving ${className}`} viewBox="0 0 320 260" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.1">
    <path d="m48 93 196-29 40 34v112L81 242 48 205Zm0 0 34 31 202-26M82 124v118M244 64v28M63 80l39-6 12 9-39 7ZM97 68l57-9 8 16-57 9Z"/>
    <path d="m98 138 169-26v81L98 220ZM107 146l148-22v64l-148 23M175 88l48-8 12 10-48 8ZM227 139l25-4v18l-25 4Z"/>
    <ellipse cx="171" cy="167" rx="46" ry="54" transform="rotate(16 171 167)"/><ellipse cx="171" cy="167" rx="39" ry="47" transform="rotate(16 171 167)"/><ellipse cx="171" cy="167" rx="30" ry="36" transform="rotate(16 171 167)"/><ellipse cx="171" cy="167" rx="18" ry="24" transform="rotate(16 171 167)"/>
    <path d="m154 146 24-4 10 22-14 25-24-6-4-23ZM49 196l22 20m-22-29 22 20m-22-29 22 20m-22-29 22 20m-22-29 22 20M33 38v201M20 55h271M28 243h266M296 70v158M27 43l6-5 6 5m-12 190 6 6 6-6M48 19l186 8M92 13v27M218 20v24"/>
    <circle cx="269" cy="40" r="18"/><path d="M269 17v46m-23-23h46m-38-14 30 28m-30 0 30-28"/>
  </svg>;
}

export function StageIcon({ kind }: { kind: '3d' | 'photo' | 'rotate' | 'zoom' }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === '3d' && <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Zm-8 4.5 8 5 8-5m-8 5V21m-4-16 8 5"/></>}
    {kind === 'photo' && <><path d="M4 7h4l2-3h5l2 3h3v13H4Z"/><circle cx="12" cy="13" r="4"/></>}
    {kind === 'rotate' && <><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/></>}
    {kind === 'zoom' && <><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6m-3-3v6"/></>}
  </svg>;
}
