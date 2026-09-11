// server.ts 的路由处理函数已按域拆到 examples/companion/routes/ 下。
//
// 凡是用源码文本断言「服务端有没有暴露某个接口」的测试，都必须看整个路由面：
// 只读 server.ts 会让 doesNotMatch 守卫在代码搬走后变成空转——那比断言失败更危险。
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export function readServerRouteSurface(): string {
  const companionRoot = resolve(__dirname, "..", "..", "examples", "companion");
  const routesRoot = join(companionRoot, "routes");
  return [join(companionRoot, "server.ts"), ...readdirSync(routesRoot).map((file) => join(routesRoot, file))]
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}
