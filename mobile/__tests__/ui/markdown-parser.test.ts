import { parseMarkdown } from '@/ui/markdown/parser';
import { highlight } from '@/ui/markdown/syntax';

import { MARKDOWN_ALL, MARKDOWN_CASES } from '../__fixtures__/markdown-cases';

describe('parseMarkdown — 16 GFM cases', () => {
  for (const tc of MARKDOWN_CASES) {
    it(`${tc.id}: ${tc.label}`, () => {
      const doc = parseMarkdown(tc.source);
      const types = doc.blocks.map((b) => b.type);
      expect(types).toEqual(tc.expectedBlockTypes);
    });
  }

  it('nested-list yields a nested `list` block inside the item', () => {
    const doc = parseMarkdown(
      '- 상위\n  - 하위 a\n  - 하위 b\n',
    );
    expect(doc.blocks[0]?.type).toBe('list');
    if (doc.blocks[0]?.type === 'list') {
      const top = doc.blocks[0].items[0]!;
      expect(top.blocks.some((b) => b.type === 'list')).toBe(true);
    }
  });

  it('checkbox carries `task` + `checked` flags', () => {
    const doc = parseMarkdown('- [x] done\n- [ ] todo');
    expect(doc.blocks[0]?.type).toBe('list');
    if (doc.blocks[0]?.type === 'list') {
      expect(doc.blocks[0].items[0]?.task).toBe(true);
      expect(doc.blocks[0].items[0]?.checked).toBe(true);
      expect(doc.blocks[0].items[1]?.checked).toBe(false);
    }
  });

  it('table align array reflects GFM colons', () => {
    const doc = parseMarkdown('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
    expect(doc.blocks[0]?.type).toBe('table');
    if (doc.blocks[0]?.type === 'table') {
      expect(doc.blocks[0].align).toEqual(['left', 'center', 'right']);
      expect(doc.blocks[0].rows).toHaveLength(1);
    }
  });

  it('image inline collapses into the paragraph children', () => {
    const doc = parseMarkdown('![alt](https://example.com/a.png)');
    expect(doc.blocks[0]?.type).toBe('paragraph');
    if (doc.blocks[0]?.type === 'paragraph') {
      const image = doc.blocks[0].children.find((c) => c.type === 'image');
      expect(image).toBeDefined();
      if (image?.type === 'image') {
        expect(image.src).toBe('https://example.com/a.png');
        expect(image.alt).toBe('alt');
      }
    }
  });

  it('drops raw HTML (security guard)', () => {
    const doc = parseMarkdown('<script>alert(1)</script>\n\n안전한 단락');
    // The script block is dropped; only the trailing paragraph survives.
    expect(doc.blocks.some((b) => b.type === 'paragraph')).toBe(true);
    expect(JSON.stringify(doc)).not.toContain('script');
  });
});

describe('highlight syntax tokenizer', () => {
  it('tags JS keywords / strings / numbers / comments', () => {
    const segs = highlight(
      'const x = 42; // note\nconst y = "hello";',
      'js',
    );
    const kinds = segs.map((s) => s.kind);
    expect(kinds).toContain('keyword');
    expect(kinds).toContain('number');
    expect(kinds).toContain('comment');
    expect(kinds).toContain('string');
  });

  it('JSON: only string/number/boolean are colored', () => {
    const segs = highlight('{"k": "v", "n": 1, "b": true}', 'json');
    expect(segs.some((s) => s.kind === 'string')).toBe(true);
    expect(segs.some((s) => s.kind === 'number')).toBe(true);
    expect(segs.some((s) => s.kind === 'boolean')).toBe(true);
  });

  it('unknown language returns one plain segment', () => {
    const segs = highlight('foo bar baz', 'cobol');
    expect(segs).toEqual([{ kind: 'plain', text: 'foo bar baz' }]);
  });
});

describe('parseMarkdown perf — < 16ms per 1KB', () => {
  it('parses the full 16-case fixture under 16ms / KB', () => {
    const sizeKb = Math.max(1, Math.ceil(Buffer.byteLength(MARKDOWN_ALL, 'utf8') / 1024));

    // Warm-up.
    parseMarkdown(MARKDOWN_ALL);

    const iterations = 50;
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      parseMarkdown(MARKDOWN_ALL);
    }
    const elapsedNs = process.hrtime.bigint() - start;
    const avgMs = Number(elapsedNs) / iterations / 1_000_000;
    const perKbMs = avgMs / sizeKb;

    // Log so CI captures the number (visible in test output).

    console.info(
      `[markdown perf] size=${sizeKb}KB avg=${avgMs.toFixed(2)}ms perKB=${perKbMs.toFixed(2)}ms`,
    );
    expect(perKbMs).toBeLessThan(16);
  });
});
