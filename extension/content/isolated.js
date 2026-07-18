(() => {
  "use strict";

  const ENGINE_KEY = Symbol.for("unrestrict.engine.v1.isolated");
  const requestedProfile = globalThis.__UNRESTRICT_REQUESTED_PROFILE__ || "normal";
  delete globalThis.__UNRESTRICT_REQUESTED_PROFILE__;
  const ranks = { normal: 1, strong: 2, "strong-antidebug": 3 };

  const existing = globalThis[ENGINE_KEY];
  if (existing) {
    existing.upgrade(requestedProfile);
    return;
  }

  const protectedTypes = ["contextmenu", "copy", "cut", "paste", "selectstart", "dragstart"];
  const quarantine = new Set();
  const changedStyles = new Map();
  let temporaryOverlays = [];
  let selectionGuardUntil = 0;
  const state = { profile: "normal", rank: 1 };

  function isDevtoolsShortcut(event) {
    if (event.key === "F12" || event.code === "F12") return true;
    const code = event.code || "";
    return (
      (event.ctrlKey && event.shiftKey && ["KeyI", "KeyJ", "KeyC"].includes(code)) ||
      (event.metaKey && event.altKey && ["KeyI", "KeyJ", "KeyC"].includes(code))
    );
  }

  function eventPath(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return path.filter((item) => item instanceof Element);
  }

  function hasInlineBlocker(event) {
    const property = `on${event.type}`;
    for (const element of eventPath(event)) {
      if (element.hasAttribute?.(property) || typeof element[property] === "function") return true;
    }
    return typeof document[property] === "function" || typeof window[property] === "function";
  }

  function observeCancellation(event) {
    queueMicrotask(() => {
      if (event.defaultPrevented) quarantine.add(event.type);
    });
  }

  function protectedGateway(event) {
    observeCancellation(event);
    if (state.rank >= 2 || quarantine.has(event.type) || hasInlineBlocker(event)) {
      event.stopImmediatePropagation();
    }
  }

  function rememberStyle(element, property) {
    let record = changedStyles.get(element);
    if (!record) {
      record = new Map();
      changedStyles.set(element, record);
    }
    if (!record.has(property)) {
      record.set(property, {
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property),
      });
    }
  }

  function isInteractive(element) {
    return Boolean(
      element?.closest?.("input, textarea, select, button, [contenteditable='true'], [draggable='true']")
    );
  }

  function unlockSelection(event) {
    if (event.button !== 0 || isInteractive(event.target)) return;
    selectionGuardUntil = performance.now() + 900;

    const candidates = new Set(eventPath(event));
    let current = event.target instanceof Element ? event.target : null;
    while (current) {
      candidates.add(current);
      current = current.parentElement;
    }

    for (const element of candidates) {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue;
      if (getComputedStyle(element).userSelect !== "none") continue;
      rememberStyle(element, "user-select");
      element.style.setProperty("user-select", "text", "important");
      if ("webkitUserSelect" in element.style) {
        rememberStyle(element, "-webkit-user-select");
        element.style.setProperty("-webkit-user-select", "text", "important");
      }
    }
  }

  function restoreTemporaryOverlays() {
    for (const { element, value, priority } of temporaryOverlays) {
      element.style.setProperty("pointer-events", value, priority);
      if (!value) element.style.removeProperty("pointer-events");
    }
    temporaryOverlays = [];
  }

  function exposeCoveredMedia(event) {
    if (event.button !== 2) return;
    restoreTemporaryOverlays();
    const stack = document.elementsFromPoint(event.clientX, event.clientY);
    const mediaIndex = stack.findIndex((element) => element.matches?.("img, video, canvas"));
    if (mediaIndex <= 0) return;
    const media = stack[mediaIndex];

    for (const element of stack.slice(0, mediaIndex)) {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue;
      if ([document.documentElement, document.body].includes(element)) continue;
      if (element.contains(media)) continue;
      temporaryOverlays.push({
        element,
        value: element.style.getPropertyValue("pointer-events"),
        priority: element.style.getPropertyPriority("pointer-events"),
      });
      element.style.setProperty("pointer-events", "none", "important");
    }
    setTimeout(restoreTemporaryOverlays, 500);
  }

  function nativeValueSetter(element) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    return Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  }

  function dispatchPasteInput(element, text) {
    let event;
    try {
      event = new InputEvent("input", {
        bubbles: true,
        cancelable: false,
        composed: true,
        data: text,
        inputType: "insertFromPaste",
      });
    } catch {
      event = new Event("input", { bubbles: true, composed: true });
    }
    element.dispatchEvent(event);
  }

  function insertPlainTextContentEditable(element, text) {
    element.focus();
    if (document.execCommand?.("insertText", false, text)) return;
    const selection = document.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    dispatchPasteInput(element, text);
  }

  function preparePasteFallback(event) {
    if (state.rank < 2) return;
    const target = event.target instanceof Element ? event.target : document.activeElement;
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!target || !text) return;

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const before = target.value;
      const start = target.selectionStart ?? before.length;
      const end = target.selectionEnd ?? start;
      const expected = before.slice(0, start) + text + before.slice(end);
      setTimeout(() => {
        if (target.value !== before) return;
        const setter = nativeValueSetter(target);
        if (setter) Reflect.apply(setter, target, [expected]);
        else target.value = expected;
        const caret = start + text.length;
        target.setSelectionRange?.(caret, caret);
        dispatchPasteInput(target, text);
      }, 0);
      return;
    }

    if (target instanceof HTMLElement && target.isContentEditable) {
      const before = target.innerHTML;
      setTimeout(() => {
        if (target.innerHTML === before) insertPlainTextContentEditable(target, text);
      }, 0);
    }
  }

  function selectionChangeGateway(event) {
    if (performance.now() < selectionGuardUntil) {
      event.stopImmediatePropagation();
    }
  }

  function keydownGateway(event) {
    if (isDevtoolsShortcut(event)) event.stopImmediatePropagation();
  }

  for (const type of protectedTypes) window.addEventListener(type, protectedGateway, true);
  window.addEventListener("pointerdown", unlockSelection, true);
  window.addEventListener("pointerdown", exposeCoveredMedia, true);
  window.addEventListener("contextmenu", restoreTemporaryOverlays, true);
  window.addEventListener("selectionchange", selectionChangeGateway, true);
  window.addEventListener("keydown", keydownGateway, true);
  window.addEventListener("paste", preparePasteFallback, true);

  function upgrade(profile) {
    const rank = ranks[profile] || 1;
    if (rank <= state.rank) return;
    state.rank = rank;
    state.profile = profile;
  }

  Object.defineProperty(globalThis, ENGINE_KEY, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({ upgrade }),
  });
  upgrade(requestedProfile);

  // Every frame requests the user-origin selection stylesheet. The service
  // worker only updates the toolbar badge for the top-level frame.
  chrome.runtime.sendMessage({ type: "CONTENT_READY", profile: state.profile }).catch(() => {});
})();
