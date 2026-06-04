import type { MessageStreamEvent } from "./types.js";

type Subscriber = {
  peerId: number;
  send: (event: MessageStreamEvent) => void;
};

const subscribers = new Set<Subscriber>();

export const messageStreams = {
  subscribe(peerId: number, send: (event: MessageStreamEvent) => void): () => void {
    const sub: Subscriber = { peerId, send };
    subscribers.add(sub);
    return () => subscribers.delete(sub);
  },

  publish(peerId: number, event: MessageStreamEvent): void {
    for (const sub of subscribers) {
      if (sub.peerId !== peerId) continue;
      try {
        sub.send(event);
      } catch {
        subscribers.delete(sub);
      }
    }
  },
};
