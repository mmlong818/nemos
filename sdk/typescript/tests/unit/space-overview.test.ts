import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CapabilityRuntime, type CapabilityArtifact, type CapabilityTask } from "../../examples/companion/capabilities.js";
import { KnowledgeLibrary } from "../../examples/companion/knowledge-library.js";
import { createCapabilityRoutes, type CapabilityDeps } from "../../examples/companion/routes/capabilities.js";
import { RouteTable, type RouteRequest } from "../../examples/companion/routes/table.js";

test("项目详情按持久关联过滤后再限量，仅返回可展示字段且不改变存储", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "clownfish-space-overview-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const options = {
    dataDir,
    personas: () => [{ id: "clownfish", name: "小丑鱼" }],
    notify: async () => { assert.fail("查看项目不能运行任务"); },
  };
  const initial = new CapabilityRuntime(options);
  const spaceA = initial.createSpace({ title: "同名项目", description: "A 的说明" });
  const spaceB = initial.createSpace({ title: "同名项目", description: "B 的说明" });
  const empty = initial.createSpace({ title: "空项目" });
  const createTask = (title: string, spaceId?: string) => initial.createTask({
    title, personaId: "clownfish", capabilityId: "document-draft", instruction: "简要整理资料", spaceId,
  });
  const waitingA = [createTask("等待一", spaceA.id), createTask("等待二", spaceA.id)]
    .sort((a, b) => a.id.localeCompare(b.id));
  const activeA = createTask("仍在推进", spaceA.id);
  const pausedA = createTask("暂停", spaceA.id);
  const completedA = createTask("完成", spaceA.id);
  const archivedA = createTask("已归档任务", spaceA.id);
  const taskB = createTask("B 的任务", spaceB.id);
  const unassigned = createTask("无项目任务");
  const tie = "2026-01-01T00:00:00.000Z";
  const newer = "2026-02-01T00:00:00.000Z";
  for (const task of waitingA) initial.updateTaskStoryline({ id: task.id, status: "waiting", nextAction: `${task.title}的下一步` });
  initial.updateTaskStoryline({ id: pausedA.id, status: "paused", nextAction: "暂停不作为下一步" });
  initial.updateTaskStoryline({ id: completedA.id, status: "completed", nextAction: "完成不作为下一步" });
  initial.updateTaskStoryline({ id: archivedA.id, status: "waiting", nextAction: "归档不作为下一步" });
  initial.archiveTask(archivedA.id);

  const tasksFile = join(dataDir, "capabilities", "tasks.json");
  const storedTasks = JSON.parse(readFileSync(tasksFile, "utf8")) as CapabilityTask[];
  for (const task of storedTasks) if (waitingA.some(({ id }) => id === task.id)) task.updatedAt = tie;
  writeFileSync(tasksFile, JSON.stringify(storedTasks));

  const artifact = (id: string, taskId: string, createdAt: string): CapabilityArtifact => ({
    id, taskId, title: id, capabilityId: "document-draft", personaId: "clownfish", format: "md",
    createdAt, file: `private/${id}.md`, summary: "内部成果内容",
  });
  const artifactsA = Array.from({ length: 7 }, (_, i) => artifact(`a-${i}`, activeA.id, tie));
  const artifactsB = Array.from({ length: 81 }, (_, i) => artifact(`b-${i}`, taskB.id, newer));
  const artifactsFile = join(dataDir, "capabilities", "artifacts.json");
  writeFileSync(artifactsFile, JSON.stringify([...artifactsA.reverse(), ...artifactsB,
    artifact("unassigned", unassigned.id, newer), artifact("orphan", "deleted-task", newer)]));
  const runtime = new CapabilityRuntime(options);
  assert.ok(runtime.snapshot().artifacts.every((item) => item.taskId !== activeA.id));

  const knowledgeLibrary = new KnowledgeLibrary(dataDir);
  const materialsA = Array.from({ length: 6 }, (_, i) => knowledgeLibrary.create({
    title: `A 的资料 ${i}`, content: "a".repeat(181) + "不会出现在摘要中的长正文", spaceId: spaceA.id,
  }));
  const archivedMaterial = knowledgeLibrary.create({ title: "被归档的 A 资料", content: "草稿", spaceId: spaceA.id });
  knowledgeLibrary.archive(archivedMaterial.id);
  const materialB = knowledgeLibrary.create({ title: "B 的资料", content: "B 的正文", spaceId: spaceB.id });
  knowledgeLibrary.create({ title: "无归属的资料", content: "仅在资料库内可见" });

  type Overview = NonNullable<ReturnType<CapabilityRuntime["spaceOverview"]>> & {
    materials: Array<{ id: string; excerpt: string }>;
    counts: { materials: number };
  };
  const responses: Array<{ status: number; body: unknown }> = [];
  const deps = { capabilities: runtime, knowledgeLibrary,
    send: (_res: RouteRequest["res"], status: number, body: unknown) => { responses.push({ status, body }); },
  } satisfies Partial<CapabilityDeps>;
  const routes = new RouteTable().add(...createCapabilityRoutes(deps as Partial<CapabilityDeps> as CapabilityDeps));
  const path = "/api/capabilities/space";
  assert.ok(routes.find("POST", path));
  const get = async (id?: string) => {
    const query = new URLSearchParams(id === undefined ? {} : { id });
    await routes.find("GET", path)!.handler({ req: {} as RouteRequest["req"], res: {} as RouteRequest["res"],
      pathname: path, url: `${path}?${query}`, query }, undefined);
    return responses.at(-1)!;
  };

  const checkedFiles = [tasksFile, artifactsFile, join(dataDir, "capabilities", "spaces.json"), join(dataDir, "knowledge", "items.json")];
  const before = checkedFiles.map((file) => readFileSync(file));
  assert.equal((await get()).status, 400);
  assert.equal((await get("missing-space")).status, 404);
  const resultA = await get(spaceA.id);
  assert.equal(resultA.status, 200);
  const a = resultA.body as Overview;
  assert.equal(a.space.description, "A 的说明");
  assert.deepEqual(a.tasks.map(({ id }) => id), [...waitingA, activeA, pausedA, completedA].map(({ id }) => id));
  assert.deepEqual(a.nextAction, { taskId: waitingA[0]!.id, taskTitle: waitingA[0]!.title,
    status: "waiting", text: `${waitingA[0]!.title}的下一步` });
  assert.deepEqual(a.counts, { tasks: 6, artifacts: 7, materials: 6 });
  assert.deepEqual(a.artifacts.map(({ id }) => id), ["a-0", "a-1", "a-2", "a-3", "a-4", "a-5"]);
  assert.equal(a.materials.length, 5);
  assert.ok(a.materials.every((item) => item.excerpt.length === 180 && materialsA.some(({ id }) => id === item.id)));
  assert.ok(a.materials.every((item) => !("content" in item)));
  assert.ok(a.artifacts.every((item) => !("file" in item)));
  const b = (await get(spaceB.id)).body as Overview;
  assert.deepEqual(b.tasks.map(({ id }) => id), [taskB.id]);
  assert.equal(b.nextAction?.taskId, taskB.id);
  assert.equal(b.nextAction?.status, "active");
  assert.deepEqual(b.materials.map(({ id }) => id), [materialB.id]);
  assert.ok(b.artifacts.every((item) => item.taskId === taskB.id));
  const emptyView = (await get(empty.id)).body as Overview;
  assert.deepEqual(emptyView.counts, { tasks: 0, artifacts: 0, materials: 0 });
  assert.equal(emptyView.nextAction, null);
  assert.deepEqual(checkedFiles.map((file) => readFileSync(file)), before);

  runtime.updateTask({ id: activeA.id, spaceId: spaceB.id });
  assert.deepEqual(((await get(spaceA.id)).body as Overview).artifacts, []);
  assert.equal(((await get(spaceB.id)).body as Overview).counts.artifacts, 88);
  runtime.deleteTask(activeA.id);
  assert.equal(((await get(spaceB.id)).body as Overview).counts.artifacts, 81);
  runtime.updateTaskStoryline({ id: waitingA[0]!.id, status: "completed" });
  runtime.updateTaskStoryline({ id: waitingA[1]!.id, status: "paused" });
  assert.equal(((await get(spaceA.id)).body as Overview).nextAction, null);
  runtime.updateTaskStoryline({ id: waitingA[1]!.id, status: "waiting" });
  runtime.updateSpace({ id: spaceA.id, status: "archived" });
  const archived = (await get(spaceA.id)).body as Overview;
  assert.equal(archived.space.status, "archived");
  assert.equal(archived.nextAction, null);
  assert.equal(archived.counts.materials, 6);
});
