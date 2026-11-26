import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync("examples/companion/web/index.html", "utf8");
const key = "persona:clownfish";
const space = { id: "space-precise", title: "当前项目", status: "active" };
const oldMessage = { text: "原对话消息", side: "me" };

function implementation(...names: string[]) {
  return names.map((name) => {
    const match = source.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]+?^\\}`, "m"));
    assert.ok(match, name);
    return match[0];
  }).join("\n");
}

function boot(handoff: null | { spaceId: string }) {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const statuses: string[] = [];
  const installs: typeof space[] = [];
  let active = true;
  let legacy = 0;
  let response: () => Promise<unknown> = async () => ({ space });
  const context = {
    projectChatHandoff: handoff,
    projectChatView: { key, conversationId: "old" },
    projectChatDeliveryScope: new Map([[key, "old"]]),
    conversationTreesReadable: true,
    URLSearchParams,
    window: {
      ClownfishChatProjectProgress: {
        normalizeProjectId: (id: string) => id,
        snapshot: (input: unknown) => input,
      },
    },
    maybeStartGoalConversation: () => { legacy++; },
    projectChatViewIsCurrent: () => active,
    setProjectProgressStatus: (text: string) => statuses.push(text),
    installProjectChat: (_view: unknown, project: typeof space) => { installs.push(project); return true; },
    async api(path: string, body?: unknown) { calls.push({ path, body }); return response(); },
  };
  const run = runInNewContext(
    implementation("maybeOpenProjectChat") + "\nmaybeOpenProjectChat", context,
  ) as () => Promise<void>;
  return {
    run, calls, statuses, installs, context, legacy: () => legacy,
    cancel: () => { active = false; },
    respond: (next: () => Promise<unknown>) => { response = next; },
  };
}

test("project startup only reads the exact ID and consumes invalid handoffs independently of older deep links", async () => {
  const ordinary = boot(null);
  await ordinary.run();
  assert.equal(ordinary.legacy(), 1);
  assert.deepEqual(ordinary.calls, []);

  const invalid = boot({ spaceId: "" });
  await invalid.run();
  assert.equal(invalid.legacy(), 0);
  assert.deepEqual(invalid.calls, []);
  assert.deepEqual(invalid.installs, []);

  const valid = boot({ spaceId: space.id });
  await valid.run();
  assert.deepEqual(valid.calls, [{ path: "/api/capabilities/space?id=space-precise&view=chat-progress", body: undefined }]);
  assert.deepEqual(valid.installs, [space]);
  assert.equal(valid.legacy(), 0);
  assert.match(source, /projectChatHandoff = consumeProjectChatHandoff\(\);[\s\S]*\nstartAgentEventStream\(\);/);
});

test("late, malformed and unavailable project previews never start a different chat or fall through to old start-up actions", async () => {
  const delayed = boot({ spaceId: space.id });
  let complete!: (value: unknown) => void;
  delayed.respond(() => new Promise((resolve) => { complete = resolve; }));
  const waiting = delayed.run();
  delayed.cancel();
  complete({ space });
  await waiting;
  assert.deepEqual(delayed.installs, []);
  assert.equal(delayed.legacy(), 0);

  for (const result of [null, { space: { ...space, id: "other" } }]) {
    const mismatched = boot({ spaceId: space.id });
    mismatched.respond(async () => result);
    await mismatched.run();
    assert.deepEqual(mismatched.installs, []);
    assert.match(mismatched.statuses.at(-1)!, /无法打开/);
  }
  const missing = boot({ spaceId: space.id });
  missing.respond(async () => { throw { status: 404, data: { code: "project_not_found" } }; });
  await missing.run();
  assert.deepEqual(missing.installs, []);
  assert.match(missing.statuses.at(-1)!, /项目已不存在/);
});

test("installation always stages a new empty chat and restores the original node on storage or render failure", () => {
  for (const failure of ["", "storage", "render"]) {
    const original = { id: "old", config: { workMode: "task" }, projectSpaceId: "old-space", messages: [oldMessage] };
    const nodes: Record<string, typeof original> = { old: original };
    const tree = { activeId: "old", nodes };
    const chatLogs = { [key]: original.messages };
    const bindingLabels = new Map();
    const events: string[] = [];
    const install = runInNewContext(implementation("installProjectChat") + "\ninstallProjectChat", {
      projectChatViewIsCurrent: () => true,
      projectBindingLabels: bindingLabels,
      projectChatNavigation: 0,
      openedProjectChatId: "",
      conversationTrees: { [key]: tree },
      chatLogs,
      makeConversationNode(mode: string) {
        assert.equal(mode, "chat");
        return { id: "new", config: { workMode: mode }, messages: [] };
      },
      flushConversationDraft() { events.push("draft:" + tree.activeId); },
      renderLog() {
        events.push("render:" + tree.activeId);
        if (failure === "render" && tree.activeId === "new") throw new Error("render failed");
      },
      renderContacts() {},
      renderConversationHeader() {},
      restoreConversationDraft() {},
      saveConversationTrees() { events.push("persist:" + tree.activeId); return failure !== "storage"; },
      saveLogs() {},
      currentComposerInput() { return { focus() { events.push("focus"); } }; },
    }) as (view: { key: string; conversationId: string }, project: typeof space) => boolean;

    assert.equal(install({ key, conversationId: "old" }, space), !failure);
    assert.equal(events[0], "draft:old");
    assert.deepEqual(original, { id: "old", config: { workMode: "task" }, projectSpaceId: "old-space", messages: [oldMessage] });
    if (failure) {
      assert.deepEqual(Object.keys(nodes), ["old"]);
      assert.equal(tree.activeId, "old");
      assert.equal(chatLogs[key], original.messages);
      assert.equal(bindingLabels.size, 0);
      if (failure === "render") assert.ok(!events.includes("persist:new"));
    } else {
      assert.equal(tree.activeId, "new");
      assert.deepEqual(nodes.new.messages, []);
      assert.equal(nodes.new.projectSpaceId, space.id);
      assert.deepEqual(events, ["draft:old", "render:new", "persist:new", "focus"]);
    }
  }
});

test("the real goal/watch polling handlers preserve the pre-request node and only acknowledge durable delivery", async () => {
  type Entry = { text: string; deliveryId?: string };
  const nodes: Record<string, { id: string; title: string; updatedAt: number; messages: Entry[] }> = {
    old: { id: "old", title: "旧", updatedAt: 0, messages: [] },
    explicit: { id: "explicit", title: "显式", updatedAt: 0, messages: [] },
    fresh: { id: "fresh", title: "新", updatedAt: 0, messages: [] },
  };
  const tree = { activeId: "old", nodes };
  const acknowledgements: Array<{ path: string; body: unknown }> = [];
  const presented: string[] = [];
  const scope = new Map([[key, "old"]]);
  const pending = new Map<string, (data: unknown) => void>();
  let writable = true;
  let uuid = 0;
  const functions = runInNewContext(
    implementation("recordProjectChatDelivery", "pollGoalCheckIns", "pollWatchAlerts") +
      "\n({ pollGoalCheckIns, pollWatchAlerts })",
    {
      APP_PERSONA_ID: "clownfish", goalCheckInBusy: false, watchAlertBusy: false, MAX_LOG_MESSAGES: 500,
      conversationTrees: { [key]: tree }, chatLogs: { [key]: nodes.old.messages },
      crypto: { randomUUID: () => String(++uuid) },
      logKey: () => key,
      captureProjectChatDelivery: () => scope,
      isOnboardingComplete: () => true,
      conversationTitle: (_messages: Entry[], title: string) => title,
      saveConversationTrees: () => writable,
      saveLogs() {}, updateRailStats() {}, renderContacts() {}, renderConversationHeader() {},
      currentComposerInput: () => null,
      addRow: (_side: string, _who: string, text: string) => presented.push(text),
      async api(path: string, body?: unknown) {
        if (body) { acknowledgements.push({ path, body }); return {}; }
        return new Promise((resolve) => pending.set(path, resolve));
      },
    },
  ) as { pollGoalCheckIns(): Promise<void>; pollWatchAlerts(): Promise<void> };

  const goal = functions.pollGoalCheckIns();
  const watch = functions.pollWatchAlerts();
  tree.activeId = "fresh";
  pending.get("/api/personal-work/goals/checkins")?.({
    checkIns: [{ id: "goal", title: "有明确会话", sessionId: "explicit", pendingSince: "now" }],
  });
  pending.get("/api/watch/alerts")?.({ alerts: [{ id: "watch", itemText: "旧对话", message: "更新" }] });
  await Promise.all([goal, watch]);
  assert.equal(nodes.fresh.messages.length, 0);
  assert.match(nodes.explicit.messages[0].text, /有明确会话/);
  assert.match(nodes.old.messages[0].text, /旧对话/);
  assert.deepEqual(presented, []);
  assert.equal(acknowledgements.length, 2);

  const retained = functions.pollWatchAlerts();
  delete nodes.old;
  pending.get("/api/watch/alerts")?.({ alerts: [{ id: "deferred", itemText: "旧节点已删", message: "更新" }] });
  await retained;
  assert.equal(acknowledgements.length, 2);

  const failedWrite = functions.pollGoalCheckIns();
  writable = false;
  pending.get("/api/personal-work/goals/checkins")?.({
    checkIns: [{ id: "failed", title: "写入失败", sessionId: "explicit", pendingSince: "now" }],
  });
  await failedWrite;
  assert.equal(nodes.explicit.messages.length, 1);
  assert.equal(nodes.fresh.messages.length, 0);
  assert.equal(acknowledgements.length, 2);
});
