import type { BotIdentity } from '@/domain/value-objects/BotIdentity';
import { toChatId } from '@/domain/value-objects/ChatId';

import type { TgBotUser } from './types';

export function tgUserToBotIdentity(user: TgBotUser): BotIdentity {
  return {
    id: toChatId(user.id),
    isBot: user.is_bot,
    firstName: user.first_name,
    username: user.username ?? null,
  };
}
