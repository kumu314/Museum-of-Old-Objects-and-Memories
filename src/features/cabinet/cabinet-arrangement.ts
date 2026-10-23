export type CabinetArrangement = readonly {
  readonly id: string;
  readonly slot: number;
  readonly plaqueText: string;
}[];

export const MAX_PLAQUE_LENGTH = 24;

function validateSlot(slot: unknown): asserts slot is number {
  if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > 5) {
    throw new RangeError('柜格必须为 0 至 5 的整数');
  }
}

function normalizePlaqueText(text: unknown): string {
  if (typeof text !== 'string') throw new TypeError('铭牌文字必须为字符串');
  const trimmed = text.trim();
  if (!trimmed) throw new RangeError('铭牌文字不能为空');
  if ([...trimmed].length > MAX_PLAQUE_LENGTH) {
    throw new RangeError(`铭牌文字不能超过 ${MAX_PLAQUE_LENGTH} 个字符`);
  }
  return trimmed;
}

export function validateArrangement(value: unknown, expectedIds: readonly string[]): CabinetArrangement {
  if (!Array.isArray(value)) throw new TypeError('陈列数据必须为数组');
  const entries: readonly unknown[] = value;
  if (entries.length !== expectedIds.length) throw new RangeError('陈列数据必须包含全部展品');
  const expected = new Set(expectedIds);
  const ids = new Set<string>();
  const slots = new Set<number>();

  return Array.from(entries, entry => {
    if (typeof entry !== 'object' || entry === null || !('id' in entry) || typeof entry.id !== 'string') {
      throw new TypeError('陈列条目必须包含有效的展品 ID');
    }
    if (!expected.has(entry.id)) throw new RangeError(`未知展品：${entry.id}`);
    if (ids.has(entry.id)) throw new RangeError(`展品 ID 重复：${entry.id}`);
    if (!('slot' in entry)) throw new TypeError('陈列条目缺少柜格');
    validateSlot(entry.slot);
    if (slots.has(entry.slot)) throw new RangeError(`柜格重复：${entry.slot}`);
    if (!('plaqueText' in entry)) throw new TypeError('陈列条目缺少铭牌文字');
    const plaqueText = normalizePlaqueText(entry.plaqueText);
    ids.add(entry.id);
    slots.add(entry.slot);
    return { id: entry.id, slot: entry.slot, plaqueText };
  });
}

export function moveExhibitToSlot(
  arrangement: CabinetArrangement,
  id: string,
  targetSlot: number,
): CabinetArrangement {
  validateSlot(targetSlot);
  const source = arrangement.find(entry => entry.id === id);
  if (!source) throw new RangeError(`未知展品：${id}`);
  if (source.slot === targetSlot) return arrangement;

  return arrangement.map(entry => {
    if (entry.id === id) return { ...entry, slot: targetSlot };
    if (entry.slot === targetSlot) return { ...entry, slot: source.slot };
    return entry;
  });
}

export function setPlaqueText(arrangement: CabinetArrangement, id: string, text: string): CabinetArrangement {
  const source = arrangement.find(entry => entry.id === id);
  if (!source) throw new RangeError(`未知展品：${id}`);
  const plaqueText = normalizePlaqueText(text);
  if (source.plaqueText === plaqueText) return arrangement;
  return arrangement.map(entry => entry.id === id ? { ...entry, plaqueText } : entry);
}
