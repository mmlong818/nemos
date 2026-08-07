import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_PERSONA_ID,
  migratePersonaIdentityValue,
  normalizePersonaId,
  personaIdentityAliases,
} from "../../examples/companion/identity.js";
import { PERSONAS } from "../../examples/companion/personas.js";

const legacyAppId = String.fromCharCode(122, 104, 105, 119, 101, 105);
const legacyExpertId = String.fromCharCode(98, 101, 122, 111, 115);

test("normalizes stored application and expert identities", () => {
  assert.equal(normalizePersonaId(legacyAppId), APP_PERSONA_ID);
  assert.equal(normalizePersonaId(legacyExpertId), "long_term_strategy");
  assert.deepEqual(personaIdentityAliases(APP_PERSONA_ID), [APP_PERSONA_ID, legacyAppId]);
});

test("migrates nested persona ids, object keys, and memory scopes without changing text", () => {
  const input = {
    [legacyAppId]: { personaId: legacyAppId, scope: "conv:1on1:me:" + legacyAppId },
    note: "keep the user's ordinary text unchanged",
  };
  const migrated = migratePersonaIdentityValue(input);
  assert.equal(migrated.changed, true);
  assert.deepEqual(migrated.value, {
    [APP_PERSONA_ID]: { personaId: APP_PERSONA_ID, scope: "conv:1on1:me:" + APP_PERSONA_ID },
    note: "keep the user's ordinary text unchanged",
  });
});

test("林老师使用原创的引导式教学策略并保护学习者身份", () => {
  const teacher = PERSONAS.find((persona) => persona.id === "teacher_lin");
  assert.equal(teacher?.name, "林老师");
  assert.equal(teacher?.tag, "学习辅导");
  assert.match(teacher?.persona || "", /理解概念、解决题目、复习整理/);
  assert.match(teacher?.persona || "", /不要把一次答错变成长期能力标签/);
  assert.match(teacher?.persona || "", /直接讲清答案或示范完整步骤/);
  assert.doesNotMatch(teacher?.persona || "", /Gemini|Google|学习辅导模式/);
});
