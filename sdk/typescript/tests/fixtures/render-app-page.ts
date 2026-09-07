import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderAppPage } from "../../examples/companion/app-navigation.js";

/** UI assertions inspect the page as served, including the shared navigation. */
export function readAppHtml(file: string, path = file === "work.html" ? "/automations" : "/" + file): string {
  return renderAppPage(readFileSync(join(process.cwd(), "examples", "companion", "web", file), "utf8"), path);
}
