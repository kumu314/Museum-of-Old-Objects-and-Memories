/** Deterministic placement keeps server rendering and hydration identical. */
export function FloatingDust() {
  return <div className="floating-dust" aria-hidden="true">{Array.from({ length: 30 }, (_, index) =>
    <i key={index} style={{ left: `${(index * 37 + 11) % 100}%`, top: `${(index * 23 + 7) % 100}%`,
      width: `${index % 3 + 1}px`, height: `${index % 3 + 1}px`,
      animationDuration: `${22 + index % 9 * 3}s`, animationDelay: `${-index * 2.7}s` }} />
  )}</div>;
}
