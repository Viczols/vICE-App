import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

type WsClient = {
  send: (data: string) => void;
  readyState?: number;
};

declare module "fastify" {
  interface FastifyInstance {
    wsClients: Set<WsClient>;
    broadcastWs: (payload: unknown) => void;
    broadcastServerEvent: (serverId: string, payload: unknown) => void;
    emitServerEvent: (serverId: string, payload: unknown) => void;
  }
}

export default fp(async function wsHubPlugin(fastify: FastifyInstance) {
  fastify.decorate("wsClients", new Set<WsClient>());

  fastify.decorate("broadcastWs", (payload: unknown) => {
    const serialized = JSON.stringify(payload);

    for (const client of fastify.wsClients) {
      try {
        client.send(serialized);
      } catch {
        fastify.wsClients.delete(client);
      }
    }
  });

  // Broadcast server-scoped events to all clients.
  // Frontend already filters by payload.serverId / selected server.
  fastify.decorate("broadcastServerEvent", (_serverId: string, payload: unknown) => {
    const serialized = JSON.stringify(payload);

    for (const client of fastify.wsClients) {
      try {
        client.send(serialized);
      } catch {
        fastify.wsClients.delete(client);
      }
    }
  });

  fastify.decorate("emitServerEvent", (serverId: string, payload: unknown) => {
    fastify.broadcastServerEvent(serverId, payload);
  });
});
