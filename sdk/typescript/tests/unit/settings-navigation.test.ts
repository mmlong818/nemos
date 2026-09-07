import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Execute the real navigation controller without starting network-backed settings forms.
function setup(hash = '#models') {
  const ids = ['models', 'connections', 'storage', 'privacy', 'appearance', 'advanced'];
  let focused = '';
  function element(id: string, panel = false) {
    return { dataset: panel ? { panel: id } : { section: id }, textContent: id,
      attrs: {} as Record<string, string>, hidden: false, tabIndex: -1,
      classList: { toggle() {} },
      setAttribute(key: string, value: string) { this.attrs[key] = value; },
      closest() { return this; }, focus() { focused = id; } };
  }
  const tabs = ids.map(id => element(id));
  const panels = ids.map(id => element(id, true));
  const nav: any = element('nav');
  const listeners: Record<string, () => void> = {};
  const writes: string[] = [];
  const location = { hash, search: '?source=test' };
  const document = { title: '', querySelector: () => nav,
    querySelectorAll: (selector: string) => selector === '[data-panel]' ? panels : tabs };
  const source = readFileSync('examples/companion/web/assets/settings-center.js', 'utf8');
  const controller = source.slice(source.indexOf('  const sections ='), source.indexOf('  function preset('));
  runInNewContext(controller + '\nactivate(location.hash.slice(1));', {
    document, location, Event: class {}, window: {
      addEventListener(name: string, fn: () => void) { listeners[name] = fn; }, dispatchEvent() {} },
    history: { pushState(_: unknown, __: string, hash: string) { writes.push('push'); location.hash = hash; },
      replaceState(_: unknown, __: string, hash: string) { writes.push('replace'); location.hash = hash; } }
  });
  return { tabs, panels, nav, location, listeners, writes, focused: () => focused };
}

test('settings navigation has one selected tab and associated visible panel', () => {
  const ui = setup('#storage');
  assert.equal(ui.tabs.filter(tab => tab.attrs['aria-selected'] === 'true').length, 1);
  assert.equal(ui.tabs[2].tabIndex, 0);
  assert.equal(ui.tabs[2].attrs['aria-controls'], 'settings-panel-storage');
  assert.deepEqual(ui.panels.filter(panel => !panel.hidden).map(panel => panel.dataset.panel), ['storage']);
  assert.equal(ui.panels[2].attrs['aria-labelledby'], 'settings-tab-storage');
});
test('settings clicks push once; history navigation does not rewrite history or panels', () => {
  const ui = setup();
  const originalPanel = ui.panels[0];
  ui.nav.onclick({ target: ui.tabs[2] });
  assert.equal(ui.location.hash, '#storage');
  ui.nav.onclick({ target: ui.tabs[2] });
  assert.deepEqual(ui.writes, ['push']);
  ui.location.hash = '#models'; ui.listeners.popstate();
  assert.equal(ui.panels[0], originalPanel);
  assert.equal(originalPanel.hidden, false);
  assert.deepEqual(ui.writes, ['push']);
  assert.equal(ui.location.search, '?source=test');
});
test('settings keyboard supports wraparound, Home and End with roving focus', () => {
  const ui = setup();
  function key(index: number, key: string) {
    let prevented = false;
    ui.nav.onkeydown({ target: ui.tabs[index], key, preventDefault() { prevented = true; } });
    assert.ok(prevented);
  }
  key(0, 'ArrowLeft'); assert.equal(ui.focused(), 'advanced');
  key(5, 'ArrowRight'); assert.equal(ui.focused(), 'models');
  key(0, 'End'); assert.equal(ui.focused(), 'advanced');
  key(5, 'Home'); assert.equal(ui.focused(), 'models');
});
test('unknown settings section falls back and external hash changes select a panel', () => {
  const ui = setup('#unknown');
  assert.equal(ui.location.hash, '#models');
  assert.deepEqual(ui.writes, ['replace']);
  ui.location.hash = '#privacy'; ui.listeners.hashchange();
  assert.equal(ui.panels[3].hidden, false);
  assert.deepEqual(ui.writes, ['replace']);
});
