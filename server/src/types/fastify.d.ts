import "fastify";

declare module "fastify" {
  interface FastifyInstance {
    auth: (request: any, reply: any) => Promise<void>;
  }
}
