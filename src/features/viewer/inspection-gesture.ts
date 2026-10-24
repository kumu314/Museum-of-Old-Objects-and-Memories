interface Point { x: number; y: number; startX: number; startY: number; type: string; moved: boolean }

/** Pointer ownership for a single viewer; any multi-pointer gesture suppresses picking. */
export function createInspectionGesture() {
  const points = new Map<number, Point>();
  let multiple = false;
  return {
    has(id: number) { return points.has(id); },
    begin(id: number, x: number, y: number, type: string) {
      if (points.has(id)) return;
      multiple ||= points.size > 0;
      points.set(id, { x, y, startX: x, startY: y, type, moved: false });
    },
    move(id: number, x: number, y: number) {
      const point = points.get(id);
      if (!point) return null;
      const pair = [...points.values()].slice(0, 2);
      const [first, second] = pair;
      const before = first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
      const dx = x - point.x; const dy = y - point.y;
      point.x = x; point.y = y;
      point.moved ||= Math.hypot(x - point.startX, y - point.startY) >= 5;
      if (points.size === 1) return { dx, dy, zoomFactor: 1 };
      const after = first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
      return { dx: 0, dy: 0, zoomFactor: first?.type === 'touch' && second?.type === 'touch' && before > 0 && after > 0 ? after / before : 1 };
    },
    end(id: number, x: number, y: number) {
      const point = points.get(id);
      if (!point) return false;
      const click = !multiple && !point.moved && Math.hypot(x - point.startX, y - point.startY) < 5;
      points.delete(id);
      if (points.size === 0) multiple = false;
      return click;
    },
    cancel() {
      const ids = [...points.keys()]; points.clear(); multiple = false; return ids;
    },
  };
}
