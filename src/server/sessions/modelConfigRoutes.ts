import type { FastifyInstance } from "fastify";
import type { OmpModelConfigService } from "./modelConfigService.js";

export function registerModelConfigRoutes(app: FastifyInstance, service: OmpModelConfigService, prefix = ""): void {
  app.get(`${prefix}/model-config`, async (_request, reply) => {
    try {
      return await service.getConfig();
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.put<{ Body: { config?: unknown } }>(`${prefix}/model-config`, async (request, reply) => {
    try {
      return await service.saveConfig(request.body.config ?? {});
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
