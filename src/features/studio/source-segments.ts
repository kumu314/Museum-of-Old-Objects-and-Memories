import type { SourceSegment } from '../../contracts/ai';

export function sourceSegmentsFromText(rawStory: string, transcript: string | null, previous: SourceSegment[]): SourceSegment[] {
  const unused = [...previous];
  const result: SourceSegment[] = [];
  for (const source of ['rawStory', 'transcript'] as const) {
    const text = source === 'rawStory' ? rawStory : transcript ?? '';
    for (const paragraph of text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)) {
      const characters = Array.from(paragraph);
      for (let start = 0; start < characters.length; start += 6_000) {
        const fragment = characters.slice(start, start + 6_000).join('');
        const index = unused.findIndex((segment) => segment.source === source && segment.text === fragment);
        const original = index < 0 ? undefined : unused.splice(index, 1)[0];
        result.push({ id: original?.id ?? crypto.randomUUID(), source, text: fragment });
      }
    }
  }
  return result;
}
