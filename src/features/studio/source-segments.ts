import type { SourceSegment } from '../../contracts/ai';

export function sourceSegmentsFromText(rawStory: string, transcript: string | null, previous: SourceSegment[]): SourceSegment[] {
  const unused = [...previous];
  type Fragment = Pick<SourceSegment, 'source' | 'text'> & { start: number; end: number };
  const fragments: Fragment[] = [];
  for (const source of ['rawStory', 'transcript'] as const) {
    const text = source === 'rawStory' ? rawStory : transcript ?? '';
    let cursor = 0;
    for (const paragraph of text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)) {
      let offset = text.indexOf(paragraph, cursor);
      const characters = Array.from(paragraph);
      for (let start = 0; start < characters.length; start += 6_000) {
        const fragment = characters.slice(start, start + 6_000).join('');
        fragments.push({ source, text: fragment, start: offset, end: offset + fragment.length });
        offset += fragment.length;
      }
      cursor = offset;
    }
  }
  const grouped: Fragment[] = [];
  let merged = 0;
  for (const fragment of fragments) {
    const tail = grouped.at(-1);
    // Blank lines should not make a valid story exceed the shared 40-segment limit.
    if (fragments.length - merged > 40 && tail?.source === fragment.source) {
      const original = fragment.source === 'rawStory' ? rawStory : transcript ?? '';
      // Keep the actual separator so the merged segment remains a substring of its source.
      const combined = original.slice(tail.start, fragment.end);
      if (Array.from(combined).length <= 6_000) {
        tail.text = combined; tail.end = fragment.end;
        merged += 1;
        continue;
      }
    }
    grouped.push(fragment);
  }
  return grouped.map(({ source, text }) => {
    const index = unused.findIndex((segment) => segment.source === source && segment.text === text);
    const original = index < 0 ? undefined : unused.splice(index, 1)[0];
    return { id: original?.id ?? crypto.randomUUID(), source, text };
  });
}
