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
  "zhiwei",
  "tuanzi",
  "lingling",
  "musk",
  "jobs",
  "munger",
  "socrates",
  "bezos",
  "vogels",
];

test("默认通讯录只显示核心角色，并把知微放在首位", () => {
  assert.deepEqual(visibleContactIds(personas, []), [...DEFAULT_CONTACT_IDS]);
});

test("阿哲、灵灵和贝索斯以下专家默认作为可添加角色", () => {
  const visible = new Set(visibleContactIds(personas, []));
  assert.equal(visible.has("azhe"), false);
  assert.equal(visible.has("lingling"), false);
  assert.equal(visible.has("bezos"), false);
  assert.equal(visible.has("vogels"), false);
});

test("添加角色时过滤默认角色、未知角色和重复项", () => {
  assert.deepEqual(
    normalizeAddedContactIds(personas, ["azhe", "bezos", "azhe", "zhiwei", "missing", 42]),
    ["azhe", "bezos"],
  );
});

test("已添加角色按角色库顺序出现在默认联系人之后", () => {
  assert.deepEqual(
    visibleContactIds(personas, ["bezos", "azhe", "lingling"]),
    [...DEFAULT_CONTACT_IDS, "azhe", "lingling", "bezos"],
  );
});
