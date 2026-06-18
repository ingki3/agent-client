/**
 * deleteMessage — D-02 길게 누름 → [삭제] 옵션.
 *
 * 실패한 (혹은 queued) 송신 메시지를 사용자가 명시적으로 폐기할 때 호출. 봇에는 전달된
 * 적이 없으므로 서버 측 삭제는 시도하지 않는다. SQLite + outbox 만 정리한다.
 */
import { MessageNotFoundError, type ChatUseCaseDeps } from './types';

export interface DeleteMessageInput {
  clientMessageId: string;
}

export async function deleteMessage(
  deps: ChatUseCaseDeps,
  input: DeleteMessageInput,
): Promise<void> {
  const stored = deps.messagesRepo.findByClientMessageId(input.clientMessageId);
  if (!stored) throw new MessageNotFoundError(input.clientMessageId);
  deps.db.transaction(() => {
    deps.outboxRepo.remove(stored.clientMessageId);
    deps.db.run('DELETE FROM messages WHERE client_message_id = ?', [
      stored.clientMessageId,
    ]);
  });
}
