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
  { id: "product_lead", name: "产品顾问" },
  { id: "critical_thinking", name: "思考教练" },
  { id: "long_term_strategy", name: "长期战略顾问" },
  { id: "system_architecture", name: "系统架构师" },
  { id: "lean_engineering", name: "精简开发顾问" },
];

test("顾问团的任务消息会邀请相关专家，并由小丑鱼最后统筹", () => {
  const route = resolveGroupReplyRoute(advisoryGroupId, "分析一下这个产品", members, advisoryGroupId);
  assert.deepEqual(selectGroupResponderIds(members.map((member) => member.id), route), ["product_lead", "critical_thinking", "clownfish"]);
  assert.deepEqual(groupParticipationFor("clownfish", route), {
    directlyMentioned: false,
    coordinating: true,
  });
});

test("顾问团闲聊仍只由小丑鱼回应", () => {
  const route = resolveGroupReplyRoute(advisoryGroupId, "在吗？", members, advisoryGroupId);
  assert.deepEqual(selectGroupResponderIds(members.map((member) => member.id), route), ["clownfish"]);
});

test("顾问团的犹豫和继续指令也会邀请专家", () => {
  for (const text of ["我没想好", "继续"]) {
    const route = resolveGroupReplyRoute(advisoryGroupId, text, members, advisoryGroupId);
    assert.deepEqual(selectGroupResponderIds(members.map((member) => member.id), route), ["product_lead", "critical_thinking", "clownfish"]);
  }
});

test("顾问团按技术主题选择两位专家，保持专家在前、统筹在后", () => {
  const route = resolveGroupReplyRoute(advisoryGroupId, "检查一下系统架构和代码复杂度", members, advisoryGroupId);
  assert.deepEqual(selectGroupResponderIds(members.map((member) => member.id), route), ["system_architecture", "lean_engineering", "clownfish"]);
});

test("学习主题优先邀请林老师和思考教练", () => {
  const learningMembers = [...members, { id: "teacher_lin", name: "林老师" }];
  const route = resolveGroupReplyRoute(advisoryGroupId, "帮我理解这个概念并设计一道练习题", learningMembers, advisoryGroupId);
  assert.deepEqual(selectGroupResponderIds(learningMembers.map((member) => member.id), route), ["teacher_lin", "critical_thinking", "clownfish"]);
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
  assert.deepEqual(selectGroupResponderIds(members.map((member) => member.id), route), members.map((member) => member.id));
  assert.deepEqual(groupParticipationFor("clownfish", route), {
    directlyMentioned: false,
    coordinating: false,
  });
});

test("顾问团被用户移除小丑鱼后不再强制统筹", () => {
  const withoutCoordinator = members.filter((member) => member.id !== "clownfish");
  const route = resolveGroupReplyRoute(advisoryGroupId, "继续讨论", withoutCoordinator, advisoryGroupId);
  assert.deepEqual(selectGroupResponderIds(withoutCoordinator.map((member) => member.id), route), withoutCoordinator.map((member) => member.id));
});

test("路由会忽略不在群里的回复角色", () => {
  const ids = members.map((member) => member.id);
  assert.deepEqual(selectGroupResponderIds(ids, { responderPersonaIds: ["missing"] }), ids);
});
