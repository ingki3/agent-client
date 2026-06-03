/**
 * GFM full-spec 16-case fixture (FR-15).
 *
 * 의도: 채팅 메시지 단위에서 마주칠 마크다운 16 케이스를 모두 한 곳에 모아둔다.
 *   - 단위 테스트: parser 가 16 케이스 모두에 대해 기대한 BlockNode 시그니처를 만든다
 *   - 시각 검증 (별도 sub-issue, RN runtime): Markdown 컴포넌트가 light/dark 양쪽에서
 *     깨지지 않고 그려지는지 캡처
 *   - perf bench: 16 케이스 직렬 (≈ 1KB) 입력에 대한 parseMarkdown(parse only, no render)
 *     평균 < 16ms 목표
 */

export interface MarkdownCase {
  id: string;
  label: string;
  source: string;
  /** Expected top-level block types in order. Verified by parser test. */
  expectedBlockTypes: string[];
}

export const MARKDOWN_CASES: MarkdownCase[] = [
  {
    id: 'h1-h6',
    label: '헤더 1~6',
    source: [
      '# H1', '## H2', '### H3', '#### H4', '##### H5', '###### H6',
    ].join('\n\n'),
    expectedBlockTypes: ['heading', 'heading', 'heading', 'heading', 'heading', 'heading'],
  },
  {
    id: 'emphasis',
    label: 'Bold / Italic / Strikethrough 혼합',
    source: '**굵게** _기울임_ ~~취소선~~ 한 줄.',
    expectedBlockTypes: ['paragraph'],
  },
  {
    id: 'inline-code',
    label: '인라인 코드',
    source: '터미널에서 `npm test` 를 실행합니다.',
    expectedBlockTypes: ['paragraph'],
  },
  {
    id: 'fenced-js',
    label: '펜스 코드 — JavaScript',
    source: [
      '```js',
      'const greet = (name) => `Hello, ${name}!`;',
      '// inline comment',
      'console.log(greet("world"));',
      '```',
    ].join('\n'),
    expectedBlockTypes: ['code'],
  },
  {
    id: 'fenced-ts',
    label: '펜스 코드 — TypeScript',
    source: [
      '```ts',
      'export interface Buddy {',
      '  id: string;',
      '  displayName: string;',
      '}',
      '```',
    ].join('\n'),
    expectedBlockTypes: ['code'],
  },
  {
    id: 'fenced-bash',
    label: '펜스 코드 — bash',
    source: [
      '```bash',
      '# 시작',
      'export NODE_ENV=production',
      'npm run build && echo done',
      '```',
    ].join('\n'),
    expectedBlockTypes: ['code'],
  },
  {
    id: 'unordered-list',
    label: '정렬 없는 리스트',
    source: '- 사과\n- 바나나\n- 체리',
    expectedBlockTypes: ['list'],
  },
  {
    id: 'nested-list',
    label: '중첩 리스트',
    source: [
      '- 상위 1',
      '  - 하위 1.1',
      '  - 하위 1.2',
      '- 상위 2',
    ].join('\n'),
    expectedBlockTypes: ['list'],
  },
  {
    id: 'checkbox',
    label: '체크박스 (task list)',
    source: [
      '- [x] 완료된 항목',
      '- [ ] 진행 중',
      '- [ ] 대기',
    ].join('\n'),
    expectedBlockTypes: ['list'],
  },
  {
    id: 'table',
    label: 'Table (GFM)',
    source: [
      '| 이름 | 역할 | 비고 |',
      '|------|:----:|----:|',
      '| Alice | dev | active |',
      '| Bob | design | leave |',
    ].join('\n'),
    expectedBlockTypes: ['table'],
  },
  {
    id: 'blockquote',
    label: 'Blockquote',
    source: '> 인용 한 줄.\n> 두 번째 줄.',
    expectedBlockTypes: ['blockquote'],
  },
  {
    id: 'link',
    label: '인라인 링크',
    source: '[Anthropic](https://anthropic.com) 으로 이동.',
    expectedBlockTypes: ['paragraph'],
  },
  {
    id: 'image',
    label: '인라인 이미지',
    source: '![아이콘](https://example.com/icon.png)',
    expectedBlockTypes: ['paragraph'],
  },
  {
    id: 'hr',
    label: '수평선',
    source: '위\n\n---\n\n아래',
    expectedBlockTypes: ['paragraph', 'hr', 'paragraph'],
  },
  {
    id: 'emoji',
    label: '이모지',
    source: '🎉 출시 축하 ✅ 모든 테스트 통과 💪',
    expectedBlockTypes: ['paragraph'],
  },
  {
    id: 'mixed',
    label: '혼합 — 헤더 + 단락 + 리스트',
    source: [
      '## 요약',
      '',
      '오늘 작업한 내용:',
      '',
      '- **인증** 흐름 작성',
      '- _마크다운_ 렌더러 추가',
      '- `outbox` 큐 보완',
      '',
      '내일 확인 사항은 [백로그](https://example.com/backlog) 참고.',
    ].join('\n'),
    expectedBlockTypes: ['heading', 'paragraph', 'list', 'paragraph'],
  },
];

/** Concatenated source — used by perf bench so a single run touches all 16 cases. */
export const MARKDOWN_ALL = MARKDOWN_CASES.map((c) => `<!-- ${c.id} -->\n${c.source}`).join('\n\n');
