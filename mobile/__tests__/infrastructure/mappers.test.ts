import { tgUserToBotIdentity } from '@/infrastructure/api/mappers';

describe('tgUserToBotIdentity', () => {
  it('maps wire user to domain BotIdentity with string id', () => {
    const identity = tgUserToBotIdentity({
      id: 9876543210123,
      is_bot: true,
      first_name: 'Buddy',
      username: 'buddy_bot',
    });
    expect(identity).toEqual({
      id: '9876543210123',
      isBot: true,
      firstName: 'Buddy',
      username: 'buddy_bot',
    });
  });

  it('null-coalesces missing username', () => {
    const identity = tgUserToBotIdentity({ id: 1, is_bot: true, first_name: 'X' });
    expect(identity.username).toBeNull();
  });
});
