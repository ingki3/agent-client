# `.pen` archive — read-only

이 디렉토리의 `.pen` 파일 4종은 **read-only 아카이브**입니다. 디자인 SoT 는 Google Stitch 로 이전되었습니다.

- `AgentClient.pen`
- `AgentClient-recovery.pen`
- `AgentClient 복사본.pen`
- `backup.pen`

## SoT 위치

- **Stitch project**: [`projects/8790013448398782796`](https://stitch.withgoogle.com/projects/8790013448398782796)
- **Design system (Light)**: `assets/710295331295340808` (`AgentClient`)
- **Design system (Dark fork)**: `assets/133f01f5e8c44432b6bc608ff2c92821` (`AgentClient Dark`)
- **DESIGN.md** (디자인 토큰·매핑·플로우 SoT 문서): 같은 저장소의 [`./DESIGN.md`](./DESIGN.md) — 합쳐진 매핑표/토큰/플로우/drift 박제

## 규칙

- **신규 편집 금지**. 모든 화면/토큰 변경은 Stitch MCP (`mcp__stitch__*`) 로 수행한다.
- **pencil MCP / `pencil` CLI 호출 금지** — 이전 회귀로 인해 폐기됨 (memory `feedback_pen_save.md`).
- 본 파일들은 회귀 시 시각 비교용 historical reference 로만 사용한다.
- 파일에 `chmod 444` 가 적용되어 있을 수 있음 (운영자 승인 시).

## 이전 마이그레이션 트레일

- BIZ-211 (parent): pen `.pen` → Stitch 이전
- BIZ-211a~g: 묶음별 frame 이전 (재사용 컴포넌트 / Onboarding & Auth / Inbox & Chat / Inline Cards / Trace Panel / Mutation / Cover·Header·EX)
- BIZ-211h: Finalize — 본 README + DESIGN.md + read-only 마킹

## Off-tree 백업

- `/tmp/AgentClient.pen.bak.BIZ-211.20260516-200331` (1.38MB, Phase 1)
- `/tmp/agentclient-pen-png/<id>.png` 80장 (Phase 1 PNG export)
- `/tmp/biz21{5,6,7}-mapping.json` (sub-issue 단위 매핑)
- `/tmp/agentclient-design.md` (Phase 2 design system 박제)

`/tmp` 는 재부팅 시 소실 가능 — 영구 위치 이전은 운영자 결정 (BIZ-220 단계).
