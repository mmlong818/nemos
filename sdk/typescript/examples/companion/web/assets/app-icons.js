"use strict";

(() => {
  // "Reef" glyphs use solid anchors, offset secondary shapes and soft asymmetric geometry.
  const PATHS = Object.freeze({
    message: '<path fill="currentColor" stroke="none" d="M4 4.25A2.75 2.75 0 0 1 6.75 1.5h10.5A2.75 2.75 0 0 1 20 4.25v9.5a2.75 2.75 0 0 1-2.75 2.75H10l-5.25 4.1.7-4.1A2.74 2.74 0 0 1 4 14.08V4.25Z"/><path d="M8 7.7h8M8 11.5h5.2" stroke="#fff" stroke-width="1.6" opacity=".82"/>',
    "message-circle": '<path fill="currentColor" stroke="none" d="M4 4.25A2.75 2.75 0 0 1 6.75 1.5h10.5A2.75 2.75 0 0 1 20 4.25v9.5a2.75 2.75 0 0 1-2.75 2.75H10l-5.25 4.1.7-4.1A2.74 2.74 0 0 1 4 14.08V4.25Z"/><path d="M8 7.7h8M8 11.5h5.2" stroke="#fff" stroke-width="1.6" opacity=".82"/>',
    boxes: '<path d="M12 5.5v13M5.5 12h13" opacity=".34"/><rect x="2.5" y="7.7" width="6.3" height="8.6" rx="2.2" fill="currentColor" stroke="none"/><rect x="9.1" y="2.3" width="5.8" height="7.2" rx="2" fill="currentColor" stroke="none"/><rect x="15.2" y="8.4" width="6.3" height="8.6" rx="2.2" fill="currentColor" stroke="none"/><rect x="9.2" y="15.1" width="5.6" height="6.6" rx="2" fill="currentColor" stroke="none"/>',
    file: '<path d="M7.5 3.25h7.2l4.05 4.05v12.2c0 .7-.55 1.25-1.25 1.25h-10c-.7 0-1.25-.55-1.25-1.25v-15c0-.7.55-1.25 1.25-1.25Z"/><path d="M14.5 3.5v4h4"/><path d="M4 7.2v11.3A2.5 2.5 0 0 0 6.5 21" opacity=".38"/><path d="M9.5 12h5.5M9.5 15.5h4" stroke-width="1.6"/>',
    document: '<path d="M7.5 3.25h7.2l4.05 4.05v12.2c0 .7-.55 1.25-1.25 1.25h-10c-.7 0-1.25-.55-1.25-1.25v-15c0-.7.55-1.25 1.25-1.25Z"/><path d="M14.5 3.5v4h4"/><path d="M4 7.2v11.3A2.5 2.5 0 0 0 6.5 21" opacity=".38"/><path d="M9.5 12h5.5M9.5 15.5h4" stroke-width="1.6"/>',
    work: '<path d="M4 17.5c2.4-6.1 5.2-8.8 9-8.2 3.15.5 4.25-1 6.8-5"/><circle cx="4" cy="17.5" r="2.25" fill="currentColor" stroke="none"/><path fill="currentColor" stroke="none" d="m18.1 2.5 3.4.2-.7 3.3-2.7-3.5Z"/><rect x="10" y="6.8" width="6" height="5" rx="1.8" fill="currentColor" stroke="none" opacity=".28"/>',
    settings: '<path d="M4 6.2h16M4 12h16M4 17.8h16" opacity=".34"/><path fill="currentColor" stroke="none" d="m8 2.7 3.5 3.5L8 9.7 4.5 6.2 8 2.7Zm8 5.8 3.5 3.5-3.5 3.5-3.5-3.5L16 8.5Zm-6 5.8 3.5 3.5-3.5 3.5-3.5-3.5 3.5-3.5Z"/>',
    panel: '<rect x="3" y="3.5" width="18" height="17" rx="3"/><path d="M9 4v16" opacity=".45"/><path d="M5.7 8h.1M5.7 12h.1M12 8h6M12 12h4"/>',
    plus: '<path fill="currentColor" stroke="none" d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7V3Z"/>',
    "plus-circle": '<path fill="currentColor" stroke="none" d="M12 2.5a9.5 9.5 0 1 1-6.7 2.8A9.47 9.47 0 0 1 12 2.5Z"/><path d="M12 7.5v9M7.5 12h9" stroke="#fff" stroke-width="1.8"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.4 15.4 4.8 4.8" stroke-width="3"/><path fill="currentColor" stroke="none" d="m18.25 16.5 3.25 1-2.25 2.25-1-3.25Z"/>',
    upload: '<path fill="currentColor" stroke="none" d="m12 2.5 5.5 6H14v7h-4v-7H6.5l5.5-6Z"/><path d="M4 19.5h16"/>',
    download: '<path fill="currentColor" stroke="none" d="m12 17.5-5.5-6H10v-7h4v7h3.5l-5.5 6Z"/><path d="M4 20h16"/>',
    bookmark: '<path fill="currentColor" stroke="none" d="M6 3h12v18l-6-3.8L6 21V3Z"/><path d="M9.2 7.5h5.6" stroke="#fff" stroke-width="1.5" opacity=".8"/>',
    shield: '<path fill="currentColor" stroke="none" d="m12 2.5 8 3.4v5.7c0 4.6-3 8.2-8 10-5-1.8-8-5.4-8-10V5.9l8-3.4Z"/><path d="m8.5 12 2.2 2.2 4.8-5" stroke="#fff" stroke-width="1.7"/>',
    spark: '<path fill="currentColor" stroke="none" d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z"/><path fill="currentColor" stroke="none" d="m19 15 .75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15Z" opacity=".42"/>',
    phone: '<path fill="currentColor" stroke="none" d="m5.4 2.8 3.2 4.9-2.1 2a16 16 0 0 0 7.8 7.8l2-2.1 4.9 3.2c.5.35.65 1 .35 1.55l-.7 1.25c-.35.65-1.05 1-1.8.9C10.2 21.15 2.85 13.8 1.7 4.95c-.1-.75.25-1.45.9-1.8l1.25-.7c.55-.3 1.2-.15 1.55.35Z"/>',
    square: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none"/>',
    "more-horizontal": '<path fill="currentColor" stroke="none" d="m5 8.8 3.2 3.2L5 15.2 1.8 12 5 8.8Zm7 0 3.2 3.2-3.2 3.2L8.8 12 12 8.8Zm7 0 3.2 3.2-3.2 3.2-3.2-3.2L19 8.8Z"/>',
    "chevron-down": '<path fill="currentColor" stroke="none" d="m5 7.5 7 6 7-6v4.2l-7 6-7-6V7.5Z"/>',
    users: '<path fill="currentColor" stroke="none" d="M8.3 4.2a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Zm7.7 1.2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2ZM2.7 20v-2.3c0-3 2.45-5.45 5.45-5.45h.3c3 0 5.45 2.45 5.45 5.45V20H2.7Zm11.6 0v-2.1c0-1.8-.7-3.45-1.85-4.65.8-.55 1.8-.85 2.85-.85h.25A5.75 5.75 0 0 1 21.3 18.15V20h-7Z"/>',
    "user-plus": '<circle cx="8.5" cy="7.5" r="3.5" fill="currentColor" stroke="none"/><path fill="currentColor" stroke="none" d="M2 20a6.5 6.5 0 0 1 13 0H2Zm15-10h3v3h3v3h-3v3h-3v-3h-3v-3h3v-3Z"/>',
    "role-listen": '<path d="M7 12a5 5 0 0 1 10 0c0 3.6-2.2 6.4-5 8-2.8-1.6-5-4.4-5-8Z"/><path d="M9.3 11.5c.7-2.1 4.7-2.1 5.4 0"/><circle cx="12" cy="8" r="1.4" fill="currentColor" stroke="none"/>',
    "role-guide": '<path d="M4 18 8 6l4 5 4-7 4 14H4Z"/><circle cx="12" cy="11" r="2" fill="currentColor" stroke="none"/>',
    "role-play": '<path fill="currentColor" stroke="none" d="M5 6.5 9 3l3 4 3-4 4 3.5-2 4.5 2 4.5-4 3.5-3-4-3 4-4-3.5L7 11 5 6.5Z"/><circle cx="9.2" cy="10.5" r="1" fill="#fff" stroke="none"/><circle cx="14.8" cy="10.5" r="1" fill="#fff" stroke="none"/>',
    "role-companion": '<path d="M12 20c-4-2.5-7-5.1-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 3.9-3 6.5-7 9Z"/><path d="M12 5V2M5 6 3 4m16 2 2-2" opacity=".5"/>',
    "role-engineer": '<circle cx="12" cy="12" r="8"/><path d="m12 4 2.3 5.7L20 12l-5.7 2.3L12 20l-2.3-5.7L4 12l5.7-2.3L12 4Z" fill="currentColor" stroke="none"/>',
    "role-product": '<path d="M4 7h16v11H4z"/><path fill="currentColor" stroke="none" d="M7 4h10v6H7z"/><path d="M8 14h3m2 0h3"/>',
    "role-decision": '<path d="M12 4v4m0 0-6 4m6-4 6 4M6 12v5m12-5v5"/><path fill="currentColor" stroke="none" d="m6 15 3 3-3 3-3-3 3-3Zm12 0 3 3-3 3-3-3 3-3ZM12 2l3 3-3 3-3-3 3-3Z"/>',
    "role-think": '<path d="M7 9a5 5 0 1 1 7.8 4.1c-1.6 1.1-2.8 1.7-2.8 3.4"/><circle cx="12" cy="20" r="1.6" fill="currentColor" stroke="none"/><path d="M4 5 2.5 3.5M20 5l1.5-1.5" opacity=".45"/>',
    "role-strategy": '<path d="M4 18 9 6l4 6 3-5 4 11H4Z"/><path fill="currentColor" stroke="none" d="m15.5 3.5 5 .8-3.4 3.8-1.6-4.6Z"/>',
    "role-architecture": '<rect x="3" y="4" width="7" height="6" rx="1.5"/><rect x="14" y="14" width="7" height="6" rx="1.5"/><path d="M10 7h5a2 2 0 0 1 2 2v5M7 10v5a2 2 0 0 0 2 2h5"/>',
    "role-user": '<path d="M4 12c2.3-4 5-6 8-6s5.7 2 8 6c-2.3 4-5 6-8 6s-5.7-2-8-6Z"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
    "role-interface": '<rect x="3" y="4" width="18" height="16" rx="2"/><path fill="currentColor" stroke="none" d="M6 7h5v10H6zM13 7h5v4h-5zM13 13h5v4h-5z"/>',
    "role-interaction": '<path d="M4 8h13m0 0-4-4m4 4-4 4M20 16H7m0 0 4-4m-4 4 4 4"/>',
    "role-lean": '<path d="M3 7h7m0 0-3-3m3 3-3 3m14 7h-7m0 0 3-3m-3 3 3 3"/><rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" stroke="none"/>',
    "role-test": '<circle cx="10" cy="10" r="6"/><path d="m14.5 14.5 5 5M7.5 10l1.8 1.8 3.5-4"/>',
    "role-release": '<path fill="currentColor" stroke="none" d="M13 2.5c4.7 1.2 7.3 3.8 8.5 8.5l-6 6-5.7-5.7L13 2.5Z"/><path d="m9.8 11.3-4.3 1.2-3 3 6 1 1 5 3-3 1.2-4.3"/><circle cx="15.8" cy="8.2" r="1.5" fill="#fff" stroke="none"/>',
    "role-industry": '<path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/><path fill="currentColor" stroke="none" d="M2.5 7.5h3v3h-3zM8.5 3.5h3v3h-3zM14.5 10.5h3v3h-3z"/>',
    "role-pricing": '<path d="m3 12 9-9h7v7l-9 9-7-7Z"/><circle cx="16" cy="6" r="1.4" fill="currentColor" stroke="none"/><path d="M8 11.5h5M10.5 9v5"/>',
    "role-brand": '<path d="M5 20V4m0 1h9l3 3-3 3H5"/><path fill="currentColor" stroke="none" d="M8 7h5l1 1-1 1H8V7Z"/>',
    "role-sales": '<path d="M3 18 8 13l4 3 8-10"/><path fill="currentColor" stroke="none" d="m16 5 5-1-1 5-4-4Z"/><circle cx="8" cy="13" r="2" fill="currentColor" stroke="none"/>',
    "role-startup": '<path d="M12 21v-9M12 15c-5 0-8-3-8-8 5 0 8 3 8 8Zm0-3c0-5 3-8 8-8 0 5-3 8-8 8Z"/><circle cx="12" cy="20" r="2" fill="currentColor" stroke="none"/>',
    "role-team": '<path d="M4 18c0-3 2.3-5 5-5s5 2 5 5M10 18c.5-2.7 2.4-4.4 5-4.4s4.7 1.8 5 4.4"/><circle cx="9" cy="8" r="3" fill="currentColor" stroke="none"/><circle cx="16" cy="9" r="2.5" fill="currentColor" stroke="none"/>',
  });

  function render(name, options = {}) {
    const paths = options.paths || PATHS;
    const content = paths[name] || PATHS[name] || PATHS.boxes;
    const className = options.className ? ` class="${options.className}"` : ' class="app-icon"';
    return `<svg${className} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${content}</svg>`;
  }

  function hydrate(options = {}) {
    const root = options.root || document;
    const selector = options.selector || "[data-app-icon]";
    const attribute = options.attribute || "appIcon";
    root.querySelectorAll(selector).forEach((node) => {
      const holder = node.querySelector("span") || node;
      holder.innerHTML = render(node.dataset[attribute], options);
    });
  }

  window.ClownfishIcons = Object.freeze({ paths: PATHS, render, hydrate });
})();
