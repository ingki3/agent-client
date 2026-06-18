import Fastify from "fastify";

export function createRelayApp() {
  return Fastify({ logger: false, bodyLimit: 60 * 1024 * 1024 });
}
