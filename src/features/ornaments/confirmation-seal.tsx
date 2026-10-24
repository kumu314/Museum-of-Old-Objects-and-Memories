export function ConfirmationSeal() {
  return <svg className="confirmation-seal" viewBox="0 0 80 80" aria-hidden="true" fill="none">
    <path d="m9 6 61 2 3 60-6 6-58-3-3-58Z" fill="#8e2e23" stroke="#c86b4b" strokeWidth="2" />
    <path d="M13 13h53v53H13Z" stroke="#e8b580" strokeWidth="1.3" />
    {/* Engraved, seal-script-inspired strokes; the adjacent text carries the status. */}
    <g stroke="#f0c591" strokeWidth="2.3" strokeLinecap="square" strokeLinejoin="round">
      <path d="M20 21h17M24 21v15h11V26h-7M19 31v8h18M45 20h15v17H45V25h10v7h-5M20 47h17M28 44v18M20 54h17v8H20v-8M45 45h16v7H45v11h16V57H49M54 42v6" />
    </g>
    <path d="m10 29 4 2m49 37 4 3M29 9l3 4M7 55l5-2" stroke="#301610" strokeWidth="2" opacity=".65" />
  </svg>;
}
