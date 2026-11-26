import assert from "node:assert/strict";
import test from "node:test";

const handoff = require("../../examples/companion/web/assets/project-chat-handoff.js");
const token = "e913d821-09b6-4f95-a846-c1b6aac7e367";
const other = "41b3f24e-0a6d-4d11-a7e0-37ff064c19e5";
const now = 1_706_000_000_000;
const projectId = "项目&来源?编号";

function browser(search = "") {
  const records = new Map<string, string>();
  const navigations: string[] = [];
  const activity: string[] = [];
  const location = { search, hash: "" };
  return {
    records, location, navigations, activity,
    storage: {
      setItem: (key: string, value: string) => { records.set(key, value); },
      getItem: (key: string) => records.get(key) ?? null,
      removeItem: (key: string) => { activity.push("remove"); records.delete(key); },
    },
    history: {
      state: null,
      replaceState(_state: unknown, _title: string, url: string) {
        activity.push("scrub");
        navigations.push(url);
        location.search = new URL(url, "http://127.0.0.1").search;
      },
    },
  };
}

test("project transfer navigates with only a nonce and consumes the exact ID before returning", () => {
  const page = browser();
  const href = handoff.start(page.storage, projectId, { token, now });
  assert.equal(href, "/?projectTransfer=" + token);
  assert.deepEqual([...page.records.values()].map(value => JSON.parse(value)), [
    { version: 1, spaceId: projectId, createdAt: now },
  ]);
  page.location.search = new URL(href, "http://127.0.0.1").search;
  assert.deepEqual(handoff.consume(page.location, page.history, page.storage, { now }), { spaceId: projectId });
  assert.deepEqual(page.activity, ["remove", "scrub"]);
  assert.deepEqual(page.navigations, ["/"]);
  assert.equal(page.records.size, 0);
  assert.equal(handoff.consume(page.location, page.history, page.storage, { now }), null);
  page.location.search = "?projectTransfer=" + token;
  assert.deepEqual(handoff.consume(page.location, page.history, page.storage, { now }), { spaceId: "" });
  const independentTab = browser("?projectTransfer=" + token);
  assert.deepEqual(handoff.consume(independentTab.location, independentTab.history, independentTab.storage, { now }), { spaceId: "" });
});

test("expired, future, malformed, or unavailable records are ignored and cannot be recovered by reloading", () => {
  for (const raw of [
    JSON.stringify({ version: 1, spaceId: projectId, createdAt: now - 120_001 }),
    JSON.stringify({ version: 1, spaceId: projectId, createdAt: now + 1 }),
    JSON.stringify({ version: "1", spaceId: projectId, createdAt: now }),
    JSON.stringify({ version: 1, spaceId: " bad id", createdAt: now }),
    "{}".repeat(300), "{",
  ]) {
    const page = browser("?projectTransfer=" + token);
    page.storage.setItem("clownfish-project-chat-transfer-v1:" + token, raw);
    assert.deepEqual(handoff.consume(page.location, page.history, page.storage, { now }), { spaceId: "" });
    assert.equal(page.records.size, 0);
    assert.deepEqual(page.navigations, ["/"]);
  }
  const inaccessible = browser("?projectTransfer=" + token);
  assert.deepEqual(handoff.consume(inaccessible.location, inaccessible.history, null, { now }), { spaceId: "" });
  assert.deepEqual(inaccessible.navigations, ["/"]);
  const scrubFails = browser("?projectTransfer=" + token);
  handoff.start(scrubFails.storage, projectId, { token, now });
  scrubFails.history.replaceState = () => { throw new Error("history blocked"); };
  assert.deepEqual(handoff.consume(scrubFails.location, scrubFails.history, scrubFails.storage, { now }), { spaceId: "" });
  assert.equal(scrubFails.records.size, 0);
});

test("duplicated or mixed launch actions are rejected and scrubbed before another handler can reuse them", () => {
  for (const conflict of [
    "projectTransfer=" + other, "projectTransfer=" + token, "goal=work&goalId=a&session=s&title=t",
    "discuss=a", "idea=a", "projectTransfer=invalid",
  ]) {
    const page = browser("?projectTransfer=" + token + "&screen=chat&" + conflict);
    page.location.hash = "#settings";
    handoff.start(page.storage, projectId, { token, now });
    if (conflict.includes(other)) handoff.start(page.storage, "other-project", { token: other, now });
    assert.deepEqual(handoff.consume(page.location, page.history, page.storage, { now }), { spaceId: "" });
    assert.equal(page.records.size, 0);
    assert.deepEqual(page.navigations, ["/?screen=chat#settings"]);
  }
  const unrelated = browser("?goal=work");
  assert.equal(handoff.consume(unrelated.location, unrelated.history, unrelated.storage, { now }), null);
  assert.deepEqual(unrelated.navigations, []);
});

test("invalid IDs and storage failures produce no launch URL", () => {
  const page = browser();
  for (const invalid of ["", " a ", "a\nb", "a".repeat(121), "\ud800"]) {
    assert.throws(() => handoff.start(page.storage, invalid, { token, now }));
  }
  assert.throws(() => handoff.start(page.storage, projectId, { token: "reusable", now }));
  assert.throws(() => handoff.start({ setItem() { throw new Error("storage blocked"); } }, projectId, { token, now }));
  assert.equal(page.records.size, 0);
});
