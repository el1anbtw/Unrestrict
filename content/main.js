(() => {
  "use strict";

  const ENGINE_KEY = Symbol.for("unrestrict.engine.v1.main");
  const requestedProfile = globalThis.__UNRESTRICT_REQUESTED_PROFILE__ || "normal";
  delete globalThis.__UNRESTRICT_REQUESTED_PROFILE__;

  const ranks = { normal: 1, strong: 2, "strong-antidebug": 3 };
  const existing = globalThis[ENGINE_KEY];
  if (existing) {
    existing.upgrade(requestedProfile);
    return;
  }

  const protectedTypes = new Set([
    "contextmenu",
    "copy",
    "cut",
    "paste",
    "selectstart",
    "dragstart",
  ]);
  const state = {
    profile: "normal",
    rank: 1,
    selectionGuardUntil: 0,
    strongInstalled: false,
    antiDebugInstalled: false,
  };

  const originalPreventDefault = Event.prototype.preventDefault;
  const originalReturnValue = Object.getOwnPropertyDescriptor(Event.prototype, "returnValue");
  const originalRemoveAllRanges = Selection.prototype.removeAllRanges;
  const originalConsoleClear = console.clear;
  const originalSetTimeout = globalThis.setTimeout;
  const originalSetInterval = globalThis.setInterval;

  function isDevtoolsShortcut(event) {
    if (event.type !== "keydown") return false;
    if (event.key === "F12" || event.code === "F12") return true;
    const code = event.code || "";
    const windowsLinux = event.ctrlKey && event.shiftKey && ["KeyI", "KeyJ", "KeyC"].includes(code);
    const mac = event.metaKey && event.altKey && ["KeyI", "KeyJ", "KeyC"].includes(code);
    return windowsLinux || mac;
  }

  function isProtected(event) {
    return protectedTypes.has(event?.type) || isDevtoolsShortcut(event);
  }

  Object.defineProperty(Event.prototype, "preventDefault", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: function preventDefault() {
      if (isProtected(this)) return undefined;
      return Reflect.apply(originalPreventDefault, this, []);
    },
  });

  if (originalReturnValue?.get && originalReturnValue?.set) {
    Object.defineProperty(Event.prototype, "returnValue", {
      configurable: true,
      enumerable: originalReturnValue.enumerable,
      get() {
        return Reflect.apply(originalReturnValue.get, this, []);
      },
      set(value) {
        if (value === false && isProtected(this)) return;
        return Reflect.apply(originalReturnValue.set, this, [value]);
      },
    });
  }

  function installStrong() {
    if (state.strongInstalled) return;
    state.strongInstalled = true;

    const extendGuard = (event) => {
      if (
        (event.type === "pointerdown" && event.button === 0) ||
        event.type === "selectstart" ||
        event.type === "copy"
      ) {
        state.selectionGuardUntil = performance.now() + 900;
      }
    };
    window.addEventListener("pointerdown", extendGuard, true);
    window.addEventListener("selectstart", extendGuard, true);
    window.addEventListener("copy", extendGuard, true);

    Object.defineProperty(Selection.prototype, "removeAllRanges", {
      configurable: true,
      enumerable: false,
      writable: false,
      value: function removeAllRanges() {
        if (performance.now() < state.selectionGuardUntil) return undefined;
        return Reflect.apply(originalRemoveAllRanges, this, []);
      },
    });
  }

  function containsDebugger(callback) {
    try {
      const source = typeof callback === "function" ? Function.prototype.toString.call(callback) : String(callback);
      return /\bdebugger\s*;?/.test(source);
    } catch {
      return false;
    }
  }

  function installAntiDebug() {
    if (state.antiDebugInstalled) return;
    state.antiDebugInstalled = true;

    Object.defineProperty(console, "clear", {
      configurable: true,
      enumerable: false,
      writable: false,
      value: () => undefined,
    });

    const guardTimer = (original) => function timer(callback, delay, ...args) {
      const milliseconds = Number(delay) || 0;
      if (milliseconds <= 1500 && containsDebugger(callback)) return 0;
      return Reflect.apply(original, this, [callback, delay, ...args]);
    };
    Object.defineProperty(globalThis, "setTimeout", {
      configurable: true,
      writable: false,
      value: guardTimer(originalSetTimeout),
    });
    Object.defineProperty(globalThis, "setInterval", {
      configurable: true,
      writable: false,
      value: guardTimer(originalSetInterval),
    });
  }

  function upgrade(profile) {
    const rank = ranks[profile] || 1;
    if (rank <= state.rank) return;
    state.rank = rank;
    state.profile = profile;
    if (rank >= 2) installStrong();
    if (rank >= 3) installAntiDebug();
  }

  Object.defineProperty(globalThis, ENGINE_KEY, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({ upgrade }),
  });

  upgrade(requestedProfile);

  // Preserve references for browser debugging without exposing a public API.
  void originalConsoleClear;
})();
