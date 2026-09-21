"use strict";
(() => {
  const instances = new WeakMap();
  const efforts = { auto: "自动", none: "关闭", low: "低", medium: "中等", high: "高", xhigh: "更高", max: "最高" };
  function effortState(instance) {
    const id = instance.select.value === "default" ? instance.state.model : instance.select.value;
    const supported = instance.state.reasoningEfforts?.[id] || [];
    const value = supported.includes(instance.options?.effort) ? instance.options.effort : "auto";
    return { supported, value };
  }
  let active = null;
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function close(restoreFocus = false) {
    if (!active) return;
    const { panel, button } = active;
    panel.remove();
    button.setAttribute("aria-expanded", "false");
    active = null;
    if (restoreFocus && button.isConnected) button.focus();
  }
  function open(instance, last = false) {
    close();
    const { select, button, state } = instance;
    if (select.hidden || select.disabled || !button.isConnected) return;
    const panel = element("div", "cf-model-panel");
    panel.append(element("div", "cf-model-heading", "选择模型"));
    const menu = element("div", "cf-model-menu");
    menu.id = select.id + "-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "选择当前任务模型");
    const modelGroup = element("div", "cf-model-group");
    modelGroup.setAttribute("role", "group");
    modelGroup.setAttribute("aria-label", "模型");
    for (const option of select.options) {
      const id = option.value === "default" ? state.model : option.value;
      const row = element("button", "cf-model-option");
      row.type = "button";
      row.tabIndex = -1;
      row.setAttribute("role", "menuitemradio");
      row.setAttribute("aria-checked", String(option.value === select.value));
      row.disabled = option.disabled;
      const copy = element("span", "cf-model-copy");
      const title = element("span", "cf-model-title", id);
      if (option.value === "default") title.append(element("span", "cf-model-tag", "跟随默认"));
      copy.append(title, element("span", "cf-model-purpose", "当前会话固定的型号"));
      copy.append(element("span", "cf-model-check", option.disabled ? window.ClownfishModelShortlist.checkLabel(state.modelChecks?.[id], state) + " · 请到设置中检查" : window.ClownfishModelShortlist.checkLabel(state.modelChecks?.[id], state)));
      const mark = element("span", "cf-model-selected", option.value === select.value ? "✓" : "");
      mark.setAttribute("aria-hidden", "true");
      row.append(copy, mark);
      row.onclick = async () => {
        const unchanged = option.value === select.value;
        close(true);
        if (unchanged || select.disabled || !select.isConnected) return;
        select.value = option.value;
        // Keep the original guarded check/save/rollback flow as the sole writer.
        const pending = select.onchange?.();
        sync(select, instance.state);
        try { await pending; }
        finally { if (select.isConnected) sync(select, instance.state); }
      };
      modelGroup.append(row);
    }
    menu.append(modelGroup);
    const effort = effortState(instance);
    const effortGroup = element("div", "cf-effort-group");
    effortGroup.setAttribute("role", "group");
    effortGroup.setAttribute("aria-label", "思考强度");
    effortGroup.append(element("div", "cf-effort-heading", "思考强度"));
    const choices = element("div", "cf-effort-choices");
    for (const value of ["auto", ...effort.supported]) {
      const choice = element("button", "cf-effort-option", efforts[value] || value);
      choice.type = "button";
      choice.tabIndex = -1;
      choice.dataset.effort = value;
      choice.setAttribute("role", "menuitemradio");
      choice.setAttribute("aria-checked", String(effort.value === value));
      choice.setAttribute("aria-label", "思考强度：" + (efforts[value] || value));
      choice.disabled = !effort.supported.length || !instance.options?.onEffortChange;
      choice.onclick = () => { close(true); instance.options.onEffortChange(value); };
      choices.append(choice);
    }
    effortGroup.append(choices, element("p", "cf-model-note", effort.supported.length ? "从下一条消息生效；强度越高，可能越慢、费用越高。" : state.reasoningEfforts ? "此连接尚未适配思考强度，使用模型默认设置。" : "重启服务后可设置思考强度。"));
    menu.append(effortGroup);
    // 工具开关：型号只过了文字检查、没过工具检查时，关闭工具是唯一不换型号就能继续对话的办法。
    const toolMode = instance.options?.toolMode === "off" ? "off" : "auto";
    const toolGroup = element("div", "cf-effort-group");
    toolGroup.setAttribute("role", "group");
    toolGroup.setAttribute("aria-label", "工具");
    toolGroup.append(element("div", "cf-effort-heading", "工具"));
    const toolChoices = element("div", "cf-effort-choices");
    for (const [value, label] of [["auto", "自动"], ["off", "关闭"]]) {
      const choice = element("button", "cf-effort-option", label);
      choice.type = "button";
      choice.tabIndex = -1;
      choice.dataset.toolMode = value;
      choice.setAttribute("role", "menuitemradio");
      choice.setAttribute("aria-checked", String(toolMode === value));
      choice.setAttribute("aria-label", "工具：" + label);
      choice.disabled = !instance.options?.onToolModeChange;
      choice.onclick = () => { close(true); instance.options.onToolModeChange(value); };
      toolChoices.append(choice);
    }
    toolGroup.append(toolChoices, element("p", "cf-model-note", "关闭后只做文字对话，不检索、不读写文件；工具检查未通过的型号也能继续用。"));
    menu.append(toolGroup);
    const settings = element("a", "cf-model-settings", "管理模型与连接 ↗");
    settings.href = "/settings#models";
    settings.setAttribute("role", "menuitem");
    settings.tabIndex = -1;
    menu.append(settings);
    panel.append(menu, element("p", "cf-model-note", "切换会检查连接，可能产生少量费用。"));
    document.body.append(panel);
    const rect = button.getBoundingClientRect();
    const viewportWidth = Math.min(document.documentElement.clientWidth, document.documentElement.getBoundingClientRect().width);
    const width = Math.min(328, viewportWidth - 24);
    panel.style.width = width + "px";
    panel.style.maxHeight = Math.max(100, window.innerHeight - 24) + "px";
    const height = panel.getBoundingClientRect().height;
    const below = rect.bottom + 8;
    panel.style.left = Math.max(12, Math.min(rect.left, viewportWidth - width - 12)) + "px";
    panel.style.top = Math.max(12, rect.top - height - 8 >= 12 ? rect.top - height - 8 : Math.min(below, window.innerHeight - height - 12)) + "px";
    button.setAttribute("aria-expanded", "true");
    active = { panel, button };
    const items = [...menu.querySelectorAll('[role^="menuitem"]')].filter(item => !item.disabled);
    (last ? items.at(-1) : items.find(item => item.getAttribute("aria-checked") === "true") || items[0])?.focus({ preventScroll: true });
    panel.onkeydown = event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
      if (event.key === "Tab") { close(true); return; }
      const index = items.indexOf(document.activeElement);
      const next = { ArrowDown: (index + 1) % items.length, ArrowUp: (index - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[event.key];
      if (next !== undefined) { event.preventDefault(); items[next].focus({ preventScroll: true }); }
    };
  }
  function sync(select, state, options) {
    let instance = instances.get(select);
    if (!instance) {
      if (select.hidden) return;
      const button = element("button", "cf-model-trigger");
      button.type = "button";
      button.id = select.id + "-trigger";
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", select.id + "-menu");
      select.classList.add("cf-model-native");
      select.insertAdjacentElement("afterend", button);
      instance = { select, button, state };
      instances.set(select, instance);
      button.onclick = () => active?.button === button ? close() : open(instance);
      button.onkeydown = event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); open(instance, event.key === "ArrowUp"); }
      };
    }
    instance.state = state;
    if (options) instance.options = options;
    const { button } = instance;
    if (active?.button === button) close();
    button.hidden = select.hidden;
    button.disabled = select.disabled;
    const id = select.value === "default" ? state?.model : select.value;
    const name = id || "选择模型";
    const effort = effortState(instance);
    const effortLabel = efforts[effort.value];
    const toolsOff = instance.options?.toolMode === "off";
    button.replaceChildren(element("span", "cf-model-name", name), element("span", "cf-model-trigger-tag", select.disabled ? "检查中…" : effort.supported.length ? effortLabel : "默认"), element("span", "cf-model-chevron", "⌄"));
    if (toolsOff && !select.disabled) button.insertBefore(element("span", "cf-model-trigger-tag", "工具关"), button.lastChild);
    button.setAttribute("aria-label", "切换模型与思考强度，当前 " + name + (select.disabled ? "，正在检查" : "，思考强度" + effortLabel + (toolsOff ? "，工具已关闭" : "")));
    button.setAttribute("aria-busy", String(select.disabled));
    button.title = name + " · " + window.ClownfishModelShortlist.checkLabel(state?.modelChecks?.[id], state);
  }
  document.addEventListener("pointerdown", event => { if (active && !active.panel.contains(event.target) && !active.button.contains(event.target)) close(); });
  document.addEventListener("focusin", event => { if (active && !active.panel.contains(event.target) && !active.button.contains(event.target)) close(); });
  document.addEventListener("scroll", event => { if (active && !active.panel.contains(event.target)) close(); }, true);
  window.addEventListener("resize", () => close());
  window.ClownfishModelPicker = Object.freeze({ sync });
})();
