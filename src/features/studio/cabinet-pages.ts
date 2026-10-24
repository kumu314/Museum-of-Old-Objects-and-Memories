import { cabinetPage, slotsPerPage } from '../../contracts/primitives';
export { cabinetPage, cabinetPosition, slotsPerPage } from '../../contracts/primitives';
type Positioned = { slotIndex: number };
export function firstEmptySlot(exhibits: readonly Positioned[]): number {
  const occupied = new Set(exhibits.map(({ slotIndex }) => slotIndex));
  let slot = 0;
  while (occupied.has(slot)) slot += 1;
  return slot;
}
export function cabinetPageCount(exhibits: readonly Positioned[]): number {
  return exhibits.reduce((count, { slotIndex }) => Math.max(count, cabinetPage(slotIndex) + 1), 1);
}
export function exhibitsOnPage<T extends Positioned>(exhibits: readonly T[], page: number): T[] {
  return exhibits.filter(({ slotIndex }) => cabinetPage(slotIndex) === page)
    .map((item) => ({ ...item, slotIndex: item.slotIndex % slotsPerPage }));
}
