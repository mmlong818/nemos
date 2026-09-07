import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function setup(saved: string | null, visible = true, blocked = false) {
  const listeners: Record<string, () => void> = {};
  const scroll = { clientHeight: visible ? 500 : 0, scrollTop: 0,
    addEventListener(name: string, fn: () => void) { listeners['scroll:' + name] = fn; } };
  const tools = { open: false,
    addEventListener(name: string, fn: () => void) { listeners['tools:' + name] = fn; } };
  const nav = { querySelector: (selector: string) => selector === 'nav' ? scroll : tools,
    addEventListener() {} };
  const source = readFileSync('examples/companion/web/assets/workbench-ui.js', 'utf8');
  const controller = source.slice(source.indexOf('  const navScroll='), source.indexOf('  const routes='));
  runInNewContext(controller, { nav, window: {
    addEventListener(name: string, fn: () => void) { listeners[name] = fn; } },
    sessionStorage: {
      getItem() { if (blocked) throw new Error('blocked'); return saved; },
      setItem(_: string, value: string) { if (blocked) throw new Error('blocked'); saved = value; }
    }
  });
  return { scroll, tools, listeners, saved: () => saved };
}

test('workbench rail restores expansion and scroll across page loads', () => {
  const first = setup(null);
  first.tools.open = true; first.scroll.scrollTop = 90;
  first.listeners.pagehide();
  const next = setup(first.saved());
  assert.equal(next.tools.open, true);
  assert.equal(next.scroll.scrollTop, 90);
});
test('workbench rail persists explicit collapse and handles pageshow restoration', () => {
  const ui = setup('{"open":true,"scroll":90}');
  ui.tools.open = false; ui.scroll.scrollTop = 12;
  ui.listeners['tools:toggle']();
  ui.scroll.scrollTop = 0;
  ui.listeners.pageshow();
  assert.equal(ui.tools.open, false);
  assert.equal(ui.scroll.scrollTop, 12);
});
test('hidden mobile rail does not overwrite the last visible scroll position', () => {
  const saved = '{"open":true,"scroll":90}';
  const ui = setup(saved, false);
  ui.listeners.pagehide(); ui.listeners['tools:toggle']();
  assert.equal(ui.saved(), saved);
  ui.scroll.clientHeight = 500; ui.listeners.pageshow();
  assert.equal(ui.scroll.scrollTop, 90);
});
test('blocked or malformed storage cannot break navigation initialization', () => {
  for (const saved of ['{', '{"open":true,"scroll":-5}', '{"open":"yes","scroll":20}', 'null']) {
    const ui = setup(saved);
    assert.equal(ui.scroll.scrollTop, 0);
    assert.equal(ui.tools.open, false);
  }
  const blocked = setup(null, true, true);
  assert.doesNotThrow(() => blocked.listeners.pagehide());
});
