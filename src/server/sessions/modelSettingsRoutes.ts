import type { FastifyInstance } from "fastify";
import type { OmpModelSettingsService } from "./modelSettingsService.js";

export function registerModelSettingsRoutes(app: FastifyInstance, service: OmpModelSettingsService, prefix = ""): void {
  app.get(`${prefix}/model-settings`, async (_request, reply) => {
    try {
      return await service.getSettings();
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.put<{ Body: { config?: unknown } }>(`${prefix}/model-settings`, async (request, reply) => {
    try {
      return await service.saveSettings(request.body.config ?? {});
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
