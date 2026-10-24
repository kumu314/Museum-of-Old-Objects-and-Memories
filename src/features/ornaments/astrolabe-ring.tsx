export function AstrolabeRing() {
  return <div className="astrolabe" aria-hidden="true">
    <svg viewBox="0 0 500 500" className="astrolabe__dial" fill="none">
      <g className="astrolabe__rotation" stroke="currentColor">
        <circle cx="250" cy="250" r="210" strokeWidth="1.3" />
        <circle cx="250" cy="250" r="201" strokeWidth=".5" />
        <circle cx="250" cy="250" r="181" strokeWidth=".6" strokeDasharray="2 9" />
        {Array.from({ length: 120 }, (_, index) => <path key={index} d={`M250 40v${index % 10 === 0 ? 18 : index % 5 === 0 ? 11 : 5}`} transform={`rotate(${index * 3} 250 250)`} strokeWidth={index % 10 === 0 ? 1.5 : .65} />)}
        {[0, 90, 180, 270].map((angle) => <path key={angle} d="m250 30-5-10h10Z" transform={`rotate(${angle} 250 250)`} fill="currentColor" />)}
      </g>
      <g stroke="currentColor" opacity=".35" strokeWidth=".6"><path d="M250 65v370M65 250h370" /><circle cx="250" cy="250" r="136" /><ellipse cx="250" cy="250" rx="88" ry="193" transform="rotate(34 250 250)" /><ellipse cx="250" cy="250" rx="193" ry="72" transform="rotate(-24 250 250)" /></g>
      <g fill="currentColor" textAnchor="middle" fontFamily="Georgia, serif" fontSize="13"><text x="250" y="17">360°</text><text x="482" y="254">90°</text><text x="250" y="490">180°</text><text x="19" y="254">270°</text></g>
    </svg>
    <svg viewBox="0 0 500 500" className="astrolabe__base" fill="none"><circle cx="250" cy="250" r="210" stroke="currentColor" strokeWidth="2" /><circle cx="250" cy="250" r="195" stroke="currentColor" strokeWidth=".8" /><circle cx="250" cy="250" r="180" stroke="currentColor" strokeWidth="9" strokeDasharray="1 10" /></svg>
  </div>;
}
