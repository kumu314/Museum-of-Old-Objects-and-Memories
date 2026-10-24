export function createFrameClock() {
  let previous: number | null = null;
  return {
    delta(timestamp: number): number {
      const elapsed = previous === null ? 1 / 60 : (timestamp - previous) / 1000;
      previous = timestamp;
      return elapsed;
    },
    reset(): void { previous = null; },
  };
}
