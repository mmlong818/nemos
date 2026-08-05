import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupParticipationFor,
  resolveGroupReplyRoute,
  selectGroupResponderIds,
} from "../../examples/companion/group-routing.js";

const advisoryGroupId = "nemos_advisory_group";
const members = [
  { id: "clownfish", name: "小丑鱼" },
  { id: "long_term_strategy", name: "长期战略顾问" },
  { id: "system_architecture", name: "系统架构师" },
];

test("顾问团普通消息只由小丑鱼统筹，且不被误判为明确 @", () => {
  const route = resolveGroupReplyRoute(advisoryGroupId, "分析一下这个产品", members, advisoryGroupId);
  assert.deepEqual(selectGroupResponderIds(members.map((member) => member.id), route), ["clownfish"]);
  assert.deepEqual(groupParticipationFor("clownfish", route), {
    directlyMentioned: false,
    coordinating: true,
  });
});

test("顾问团明确 @ 专家时只由被点名专家回复", () => {
  const route = resolveGroupReplyRoute(advisoryGroupId, "@长期战略顾问 看一下长期战略", members, advisoryGroupId);
  assert.deepEqual(selectGroupResponderIds(members.map((member) => member.id), route), ["long_term_strategy"]);
  assert.deepEqual(groupParticipationFor("long_term_strategy", route), {
    directlyMentioned: true,
    coordinating: false,
  });
  assert.deepEqual(groupParticipationFor("clownfish", route), {
    directlyMentioned: false,
    coordinating: false,
  });
});

test("支持全角 @、角色 id 和一轮点名多人", () => {
  const route = resolveGroupReplyRoute(advisoryGroupId, "＠long_term_strategy 和 @系统架构师 一起看", members, advisoryGroupId);
  assert.deepEqual(selectGroupResponderIds(members.map((member) => member.id), route), ["long_term_strategy", "system_architecture"]);
});

test("自建群即使包含小丑鱼，普通消息仍由全体成员回复", () => {
  const route = resolveGroupReplyRoute("custom_group", "大家怎么看", members, advisoryGroupId);
  assert.deepEqual(selectGroupResponderIds(members.map((member) => member.id), route), ["clownfish", "long_term_strategy", "system_architecture"]);
  assert.deepEqual(groupParticipationFor("clownfish", route), {
    directlyMentioned: false,
    coordinating: false,
  });
});

test("顾问团被用户移除小丑鱼后不再强制统筹", () => {
  const withoutCoordinator = members.filter((member) => member.id !== "clownfish");
  const route = resolveGroupReplyRoute(advisoryGroupId, "继续讨论", withoutCoordinator, advisoryGroupId);
  assert.deepEqual(selectGroupResponderIds(withoutCoordinator.map((member) => member.id), route), ["long_term_strategy", "system_architecture"]);
});

test("路由会忽略不在群里的回复角色", () => {
  const ids = members.map((member) => member.id);
  assert.deepEqual(selectGroupResponderIds(ids, { responderPersonaIds: ["missing"] }), ids);
});