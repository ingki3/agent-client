// 봇 자신을 식별하는 도메인 표현. infrastructure 의 TgBotUser 와 분리되어
// application layer 가 wire 타입에 결합되지 않게 한다 (TECH_SPEC §2.3).

export interface BotIdentity {
  id: string;
  isBot: boolean;
  firstName: string;
  username: string | null;
}
