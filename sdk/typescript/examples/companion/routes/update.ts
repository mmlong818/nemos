// 检查新版本：页面打开时读状态（到期才联网），用户在侧栏或设置里开关。
import { Type } from "typebox";
import type { ServerResponse } from "node:http";
import type { AppUpdateChecker } from "../app-update.js";
import { route, type RouteEntry } from "./table.js";

export interface UpdateDeps {
  readonly appUpdate: AppUpdateChecker;
  readonly send: (res: ServerResponse, code: number, body: unknown, type?: string) => void;
}

export function createUpdateRoutes(deps: UpdateDeps): RouteEntry[] {
  const { appUpdate, send } = deps;
  return [
    route("GET", "/api/app-update", async ({ res }) => {
      send(res, 200, await appUpdate.refreshIfDue());
    }),
    route("POST", "/api/app-update", Type.Object({ enabled: Type.Boolean() }), async ({ res }, body) => {
      send(res, 200, await appUpdate.setEnabled(body.enabled));
    }),
  ];
}
