import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupParticipationFor,
  resolveGroupReplyRoute,
  selectGroupResponderIds,
} from "../../examples/companion/group-routing.js";

const advisoryGroupId = "nemos_advisory_group";
const members = [
  { id: "zhiwei", name: "知微" },
  { id: "bezos", name: "贝索斯" },
  { id: "vogels", name: "沃纳" },
];

test("顾问团普通消息只由知微统筹，且不被误判为明确 @", () => {
  const route = resolveGroupReplyRoute(advisoryGroupId, "分析一下这个产品", members, advisoryGroupId);
  assert.deepEqual(selectGroupResponderIds(members.map((member) => member.id), route), ["zhiwei"]);
  assert.deepEqual(groupParticipationFor("zhiwei", route), {
    directlyMentioned: false,
    coordinating: true,
  });
});

test("顾问团明确 @ 专家时只由被点名专家回复", () => {
  const route = resolveGroupReplyRoute(advisoryGroupId, "@贝索斯 看一下长期战略", members, advisoryGroupId);
  assert.deepEqual(selectGroupResponderIds(members.map((member) => member.id), route), ["bezos"]);
  assert.deepEqual(groupParticipationFor("bezos", route), {
    directlyMentioned: true,
    coordinating: false,
  });
  assert.deepEqual(groupParticipationFor("zhiwei", route), {
    directlyMentioned: false,
    coordinating: false,
  });
});

test("支持全角 @、角色 id 和一轮点名多人", () => {
  const route = resolveGroupReplyRoute(advisoryGroupId, "＠bezos 和 @沃纳 一起看", members, advisoryGroupId);
  assert.deepEqual(selectGroupResponderIds(members.map((member) => member.id), route), ["bezos", "vogels"]);
});

test("自建群即使包含知微，普通消息仍由全体成员回复", () => {
  const route = resolveGroupReplyRoute("custom_group", "大家怎么看", members, advisoryGroupId);
  assert.deepEqual(selectGroupResponderIds(members.map((member) => member.id), route), ["zhiwei", "bezos", "vogels"]);
  assert.deepEqual(groupParticipationFor("zhiwei", route), {
    directlyMentioned: false,
    coordinating: false,
  });
});

test("顾问团被用户移除知微后不再强制统筹", () => {
  const withoutCoordinator = members.filter((member) => member.id !== "zhiwei");
  const route = resolveGroupReplyRoute(advisoryGroupId, "继续讨论", withoutCoordinator, advisoryGroupId);
  assert.deepEqual(selectGroupResponderIds(withoutCoordinator.map((member) => member.id), route), ["bezos", "vogels"]);
});

test("路由会忽略不在群里的回复角色", () => {
  const ids = members.map((member) => member.id);
  assert.deepEqual(selectGroupResponderIds(ids, { responderPersonaIds: ["missing"] }), ids);
});