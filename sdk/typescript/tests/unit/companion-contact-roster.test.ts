import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONTACT_IDS,
  normalizeAddedContactIds,
  visibleContactIds,
} from "../../examples/companion/contact-roster.js";

const personas = [
  "feifei",
  "azhe",
  "clownfish",
  "tuanzi",
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

test("阿哲、灵灵和长期战略顾问以下专家默认作为可添加角色", () => {
  const visible = new Set(visibleContactIds(personas, []));
  assert.equal(visible.has("azhe"), false);
  assert.equal(visible.has("lingling"), false);
  assert.equal(visible.has("long_term_strategy"), false);
  assert.equal(visible.has("system_architecture"), false);
});

test("添加角色时过滤默认角色、未知角色和重复项", () => {
  assert.deepEqual(
    normalizeAddedContactIds(personas, ["azhe", "long_term_strategy", "azhe", "clownfish", "missing", 42]),
    ["azhe", "long_term_strategy"],
  );
});

test("已添加角色按角色库顺序出现在默认联系人之后", () => {
  assert.deepEqual(
    visibleContactIds(personas, ["long_term_strategy", "azhe", "lingling"]),
    [...DEFAULT_CONTACT_IDS, "azhe", "lingling", "long_term_strategy"],
  );
});
