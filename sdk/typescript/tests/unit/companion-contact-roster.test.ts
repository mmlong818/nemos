import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTACTABLE_PERSONA_IDS,
  DEFAULT_CONTACT_IDS,
  normalizeAddedContactIds,
  visibleContactIds,
} from "../../examples/companion/contact-roster.js";

const personas = [
  "feifei",
  "azhe",
  "clownfish",
  "tuanzi",
  "teacher_lin",
  "lingling",
  "first_principles",
  "product_lead",
  "decision_analysis",
  "critical_thinking",
  "long_term_strategy",
  "system_architecture",
];

test("默认通讯录只显示核心角色，并把小丑鱼放在首位", () => {
  assert.deepEqual(visibleContactIds(personas, []), [...DEFAULT_CONTACT_IDS]);
});

test("林老师作为学习入口默认出现在通讯录", () => {
  assert.equal(visibleContactIds(personas, []).includes("teacher_lin"), true);
});

test("团子和功能型专家不占用一对一联系人入口", () => {
  const visible = new Set(visibleContactIds(personas, []));
  assert.equal(visible.has("tuanzi"), false);
  assert.equal(visible.has("azhe"), false);
  assert.equal(visible.has("lingling"), false);
  assert.equal(visible.has("first_principles"), false);
  assert.equal(visible.has("long_term_strategy"), false);
  assert.equal(visible.has("system_architecture"), false);
});

test("只有生活角色可加入一对一联系人，专家只留在专家群", () => {
  assert.deepEqual(CONTACTABLE_PERSONA_IDS, ["clownfish", "feifei", "teacher_lin", "azhe", "lingling"]);
  assert.deepEqual(
    normalizeAddedContactIds(personas, ["azhe", "lingling", "tuanzi", "first_principles", "long_term_strategy"]),
    ["azhe", "lingling"],
  );
});

test("添加角色时过滤默认角色、未知角色和重复项", () => {
  assert.deepEqual(
    normalizeAddedContactIds(personas, ["azhe", "lingling", "azhe", "clownfish", "missing", 42]),
    ["azhe", "lingling"],
  );
});

test("已添加角色按角色库顺序出现在默认联系人之后", () => {
  assert.deepEqual(
    visibleContactIds(personas, ["long_term_strategy", "azhe", "lingling"]),
    [...DEFAULT_CONTACT_IDS, "azhe", "lingling"],
  );
});
