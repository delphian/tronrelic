var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/@swc/helpers/cjs/_interop_require_default.cjs
var require_interop_require_default = __commonJS({
  "node_modules/@swc/helpers/cjs/_interop_require_default.cjs"(exports) {
    "use strict";
    function _interop_require_default(obj) {
      return obj && obj.__esModule ? obj : { default: obj };
    }
    exports._ = _interop_require_default;
  }
});

// node_modules/next/dist/shared/lib/loadable-context.shared-runtime.js
var require_loadable_context_shared_runtime = __commonJS({
  "node_modules/next/dist/shared/lib/loadable-context.shared-runtime.js"(exports) {
    "use client";
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    Object.defineProperty(exports, "LoadableContext", {
      enumerable: true,
      get: function() {
        return LoadableContext;
      }
    });
    var _interop_require_default = require_interop_require_default();
    var _react = /* @__PURE__ */ _interop_require_default._(__require("react"));
    var LoadableContext = _react.default.createContext(null);
    if (true) {
      LoadableContext.displayName = "LoadableContext";
    }
  }
});

// node_modules/next/dist/shared/lib/loadable.shared-runtime.js
var require_loadable_shared_runtime = __commonJS({
  "node_modules/next/dist/shared/lib/loadable.shared-runtime.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    Object.defineProperty(exports, "default", {
      enumerable: true,
      get: function() {
        return _default;
      }
    });
    var _interop_require_default = require_interop_require_default();
    var _react = /* @__PURE__ */ _interop_require_default._(__require("react"));
    var _loadablecontextsharedruntime = require_loadable_context_shared_runtime();
    function resolve(obj) {
      return obj && obj.default ? obj.default : obj;
    }
    var ALL_INITIALIZERS = [];
    var READY_INITIALIZERS = [];
    var initialized = false;
    function load(loader) {
      let promise = loader();
      let state = {
        loading: true,
        loaded: null,
        error: null
      };
      state.promise = promise.then((loaded) => {
        state.loading = false;
        state.loaded = loaded;
        return loaded;
      }).catch((err) => {
        state.loading = false;
        state.error = err;
        throw err;
      });
      return state;
    }
    function createLoadableComponent(loadFn, options) {
      let opts = Object.assign({
        loader: null,
        loading: null,
        delay: 200,
        timeout: null,
        webpack: null,
        modules: null
      }, options);
      let subscription = null;
      function init() {
        if (!subscription) {
          const sub = new LoadableSubscription(loadFn, opts);
          subscription = {
            getCurrentValue: sub.getCurrentValue.bind(sub),
            subscribe: sub.subscribe.bind(sub),
            retry: sub.retry.bind(sub),
            promise: sub.promise.bind(sub)
          };
        }
        return subscription.promise();
      }
      if (typeof window === "undefined") {
        ALL_INITIALIZERS.push(init);
      }
      if (!initialized && typeof window !== "undefined") {
        const moduleIds = opts.webpack && typeof __require.resolveWeak === "function" ? opts.webpack() : opts.modules;
        if (moduleIds) {
          READY_INITIALIZERS.push((ids) => {
            for (const moduleId of moduleIds) {
              if (ids.includes(moduleId)) {
                return init();
              }
            }
          });
        }
      }
      function useLoadableModule() {
        init();
        const context = _react.default.useContext(_loadablecontextsharedruntime.LoadableContext);
        if (context && Array.isArray(opts.modules)) {
          opts.modules.forEach((moduleName) => {
            context(moduleName);
          });
        }
      }
      function LoadableComponent(props, ref) {
        useLoadableModule();
        const state = _react.default.useSyncExternalStore(subscription.subscribe, subscription.getCurrentValue, subscription.getCurrentValue);
        _react.default.useImperativeHandle(ref, () => ({
          retry: subscription.retry
        }), []);
        return _react.default.useMemo(() => {
          if (state.loading || state.error) {
            return /* @__PURE__ */ _react.default.createElement(opts.loading, {
              isLoading: state.loading,
              pastDelay: state.pastDelay,
              timedOut: state.timedOut,
              error: state.error,
              retry: subscription.retry
            });
          } else if (state.loaded) {
            return /* @__PURE__ */ _react.default.createElement(resolve(state.loaded), props);
          } else {
            return null;
          }
        }, [
          props,
          state
        ]);
      }
      LoadableComponent.preload = () => init();
      LoadableComponent.displayName = "LoadableComponent";
      return /* @__PURE__ */ _react.default.forwardRef(LoadableComponent);
    }
    var LoadableSubscription = class {
      promise() {
        return this._res.promise;
      }
      retry() {
        this._clearTimeouts();
        this._res = this._loadFn(this._opts.loader);
        this._state = {
          pastDelay: false,
          timedOut: false
        };
        const { _res: res, _opts: opts } = this;
        if (res.loading) {
          if (typeof opts.delay === "number") {
            if (opts.delay === 0) {
              this._state.pastDelay = true;
            } else {
              this._delay = setTimeout(() => {
                this._update({
                  pastDelay: true
                });
              }, opts.delay);
            }
          }
          if (typeof opts.timeout === "number") {
            this._timeout = setTimeout(() => {
              this._update({
                timedOut: true
              });
            }, opts.timeout);
          }
        }
        this._res.promise.then(() => {
          this._update({});
          this._clearTimeouts();
        }).catch((_err) => {
          this._update({});
          this._clearTimeouts();
        });
        this._update({});
      }
      _update(partial) {
        this._state = {
          ...this._state,
          error: this._res.error,
          loaded: this._res.loaded,
          loading: this._res.loading,
          ...partial
        };
        this._callbacks.forEach((callback) => callback());
      }
      _clearTimeouts() {
        clearTimeout(this._delay);
        clearTimeout(this._timeout);
      }
      getCurrentValue() {
        return this._state;
      }
      subscribe(callback) {
        this._callbacks.add(callback);
        return () => {
          this._callbacks.delete(callback);
        };
      }
      constructor(loadFn, opts) {
        this._loadFn = loadFn;
        this._opts = opts;
        this._callbacks = /* @__PURE__ */ new Set();
        this._delay = null;
        this._timeout = null;
        this.retry();
      }
    };
    function Loadable(opts) {
      return createLoadableComponent(load, opts);
    }
    function flushInitializers(initializers, ids) {
      let promises = [];
      while (initializers.length) {
        let init = initializers.pop();
        promises.push(init(ids));
      }
      return Promise.all(promises).then(() => {
        if (initializers.length) {
          return flushInitializers(initializers, ids);
        }
      });
    }
    Loadable.preloadAll = () => {
      return new Promise((resolveInitializers, reject) => {
        flushInitializers(ALL_INITIALIZERS).then(resolveInitializers, reject);
      });
    };
    Loadable.preloadReady = (ids) => {
      if (ids === void 0) ids = [];
      return new Promise((resolvePreload) => {
        const res = () => {
          initialized = true;
          return resolvePreload();
        };
        flushInitializers(READY_INITIALIZERS, ids).then(res, res);
      });
    };
    if (typeof window !== "undefined") {
      window.__NEXT_PRELOADREADY = Loadable.preloadReady;
    }
    var _default = Loadable;
  }
});

// node_modules/next/dist/shared/lib/dynamic.js
var require_dynamic = __commonJS({
  "node_modules/next/dist/shared/lib/dynamic.js"(exports, module) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports, {
      /**
      * This function lets you dynamically import a component.
      * It uses [React.lazy()](https://react.dev/reference/react/lazy) with [Suspense](https://react.dev/reference/react/Suspense) under the hood.
      *
      * Read more: [Next.js Docs: `next/dynamic`](https://nextjs.org/docs/app/building-your-application/optimizing/lazy-loading#nextdynamic)
      */
      default: function() {
        return dynamic2;
      },
      noSSR: function() {
        return noSSR;
      }
    });
    var _interop_require_default = require_interop_require_default();
    var _jsxruntime = __require("react/jsx-runtime");
    var _react = /* @__PURE__ */ _interop_require_default._(__require("react"));
    var _loadablesharedruntime = /* @__PURE__ */ _interop_require_default._(require_loadable_shared_runtime());
    var isServerSide = typeof window === "undefined";
    function convertModule(mod) {
      return {
        default: (mod == null ? void 0 : mod.default) || mod
      };
    }
    function noSSR(LoadableInitializer, loadableOptions) {
      delete loadableOptions.webpack;
      delete loadableOptions.modules;
      if (!isServerSide) {
        return LoadableInitializer(loadableOptions);
      }
      const Loading = loadableOptions.loading;
      return () => /* @__PURE__ */ (0, _jsxruntime.jsx)(Loading, {
        error: null,
        isLoading: true,
        pastDelay: false,
        timedOut: false
      });
    }
    function dynamic2(dynamicOptions, options) {
      let loadableFn = _loadablesharedruntime.default;
      let loadableOptions = {
        // A loading component is not required, so we default it
        loading: (param) => {
          let { error, isLoading, pastDelay } = param;
          if (!pastDelay) return null;
          if (true) {
            if (isLoading) {
              return null;
            }
            if (error) {
              return /* @__PURE__ */ (0, _jsxruntime.jsxs)("p", {
                children: [
                  error.message,
                  /* @__PURE__ */ (0, _jsxruntime.jsx)("br", {}),
                  error.stack
                ]
              });
            }
          }
          return null;
        }
      };
      if (dynamicOptions instanceof Promise) {
        loadableOptions.loader = () => dynamicOptions;
      } else if (typeof dynamicOptions === "function") {
        loadableOptions.loader = dynamicOptions;
      } else if (typeof dynamicOptions === "object") {
        loadableOptions = {
          ...loadableOptions,
          ...dynamicOptions
        };
      }
      loadableOptions = {
        ...loadableOptions,
        ...options
      };
      const loaderFn = loadableOptions.loader;
      const loader = () => loaderFn != null ? loaderFn().then(convertModule) : Promise.resolve(convertModule(() => null));
      if (loadableOptions.loadableGenerated) {
        loadableOptions = {
          ...loadableOptions,
          ...loadableOptions.loadableGenerated
        };
        delete loadableOptions.loadableGenerated;
      }
      if (typeof loadableOptions.ssr === "boolean" && !loadableOptions.ssr) {
        delete loadableOptions.webpack;
        delete loadableOptions.modules;
        return noSSR(loadableFn, loadableOptions);
      }
      return loadableFn({
        ...loadableOptions,
        loader
      });
    }
    if ((typeof exports.default === "function" || typeof exports.default === "object" && exports.default !== null) && typeof exports.default.__esModule === "undefined") {
      Object.defineProperty(exports.default, "__esModule", { value: true });
      Object.assign(exports.default, exports);
      module.exports = exports.default;
    }
  }
});

// node_modules/next/dynamic.js
var require_dynamic2 = __commonJS({
  "node_modules/next/dynamic.js"(exports, module) {
    module.exports = require_dynamic();
  }
});

// node_modules/lucide-react/dist/esm/shared/src/utils.js
var toKebabCase, toCamelCase, toPascalCase, mergeClasses, hasA11yProp;
var init_utils = __esm({
  "node_modules/lucide-react/dist/esm/shared/src/utils.js"() {
    toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    toCamelCase = (string) => string.replace(
      /^([A-Z])|[\s-_]+(\w)/g,
      (match, p1, p2) => p2 ? p2.toUpperCase() : p1.toLowerCase()
    );
    toPascalCase = (string) => {
      const camelCase = toCamelCase(string);
      return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
    };
    mergeClasses = (...classes) => classes.filter((className, index, array) => {
      return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
    }).join(" ").trim();
    hasA11yProp = (props) => {
      for (const prop in props) {
        if (prop.startsWith("aria-") || prop === "role" || prop === "title") {
          return true;
        }
      }
    };
  }
});

// node_modules/lucide-react/dist/esm/defaultAttributes.js
var defaultAttributes;
var init_defaultAttributes = __esm({
  "node_modules/lucide-react/dist/esm/defaultAttributes.js"() {
    defaultAttributes = {
      xmlns: "http://www.w3.org/2000/svg",
      width: 24,
      height: 24,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round"
    };
  }
});

// node_modules/lucide-react/dist/esm/Icon.js
import { forwardRef, createElement } from "react";
var Icon;
var init_Icon = __esm({
  "node_modules/lucide-react/dist/esm/Icon.js"() {
    init_defaultAttributes();
    init_utils();
    Icon = forwardRef(
      ({
        color = "currentColor",
        size = 24,
        strokeWidth = 2,
        absoluteStrokeWidth,
        className = "",
        children,
        iconNode,
        ...rest
      }, ref) => createElement(
        "svg",
        {
          ref,
          ...defaultAttributes,
          width: size,
          height: size,
          stroke: color,
          strokeWidth: absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth,
          className: mergeClasses("lucide", className),
          ...!children && !hasA11yProp(rest) && { "aria-hidden": "true" },
          ...rest
        },
        [
          ...iconNode.map(([tag, attrs]) => createElement(tag, attrs)),
          ...Array.isArray(children) ? children : [children]
        ]
      )
    );
  }
});

// node_modules/lucide-react/dist/esm/createLucideIcon.js
import { forwardRef as forwardRef2, createElement as createElement2 } from "react";
var createLucideIcon;
var init_createLucideIcon = __esm({
  "node_modules/lucide-react/dist/esm/createLucideIcon.js"() {
    init_utils();
    init_Icon();
    createLucideIcon = (iconName, iconNode) => {
      const Component = forwardRef2(
        ({ className, ...props }, ref) => createElement2(Icon, {
          ref,
          iconNode,
          className: mergeClasses(
            `lucide-${toKebabCase(toPascalCase(iconName))}`,
            `lucide-${iconName}`,
            className
          ),
          ...props
        })
      );
      Component.displayName = toPascalCase(iconName);
      return Component;
    };
  }
});

// node_modules/lucide-react/dist/esm/icons/check.js
var __iconNode, Check;
var init_check = __esm({
  "node_modules/lucide-react/dist/esm/icons/check.js"() {
    init_createLucideIcon();
    __iconNode = [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]];
    Check = createLucideIcon("check", __iconNode);
  }
});

// node_modules/lucide-react/dist/esm/icons/circle-alert.js
var __iconNode2, CircleAlert;
var init_circle_alert = __esm({
  "node_modules/lucide-react/dist/esm/icons/circle-alert.js"() {
    init_createLucideIcon();
    __iconNode2 = [
      ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
      ["line", { x1: "12", x2: "12", y1: "8", y2: "12", key: "1pkeuh" }],
      ["line", { x1: "12", x2: "12.01", y1: "16", y2: "16", key: "4dfq90" }]
    ];
    CircleAlert = createLucideIcon("circle-alert", __iconNode2);
  }
});

// node_modules/lucide-react/dist/esm/icons/circle-check-big.js
var __iconNode3, CircleCheckBig;
var init_circle_check_big = __esm({
  "node_modules/lucide-react/dist/esm/icons/circle-check-big.js"() {
    init_createLucideIcon();
    __iconNode3 = [
      ["path", { d: "M21.801 10A10 10 0 1 1 17 3.335", key: "yps3ct" }],
      ["path", { d: "m9 11 3 3L22 4", key: "1pflzl" }]
    ];
    CircleCheckBig = createLucideIcon("circle-check-big", __iconNode3);
  }
});

// node_modules/lucide-react/dist/esm/icons/copy.js
var __iconNode4, Copy;
var init_copy = __esm({
  "node_modules/lucide-react/dist/esm/icons/copy.js"() {
    init_createLucideIcon();
    __iconNode4 = [
      ["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2", key: "17jyea" }],
      ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2", key: "zix9uf" }]
    ];
    Copy = createLucideIcon("copy", __iconNode4);
  }
});

// node_modules/lucide-react/dist/esm/icons/eye-off.js
var __iconNode5, EyeOff;
var init_eye_off = __esm({
  "node_modules/lucide-react/dist/esm/icons/eye-off.js"() {
    init_createLucideIcon();
    __iconNode5 = [
      [
        "path",
        {
          d: "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
          key: "ct8e1f"
        }
      ],
      ["path", { d: "M14.084 14.158a3 3 0 0 1-4.242-4.242", key: "151rxh" }],
      [
        "path",
        {
          d: "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
          key: "13bj9a"
        }
      ],
      ["path", { d: "m2 2 20 20", key: "1ooewy" }]
    ];
    EyeOff = createLucideIcon("eye-off", __iconNode5);
  }
});

// node_modules/lucide-react/dist/esm/icons/eye.js
var __iconNode6, Eye;
var init_eye = __esm({
  "node_modules/lucide-react/dist/esm/icons/eye.js"() {
    init_createLucideIcon();
    __iconNode6 = [
      [
        "path",
        {
          d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",
          key: "1nclc0"
        }
      ],
      ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }]
    ];
    Eye = createLucideIcon("eye", __iconNode6);
  }
});

// node_modules/lucide-react/dist/esm/icons/settings.js
var __iconNode7, Settings;
var init_settings = __esm({
  "node_modules/lucide-react/dist/esm/icons/settings.js"() {
    init_createLucideIcon();
    __iconNode7 = [
      [
        "path",
        {
          d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
          key: "1i5ecw"
        }
      ],
      ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }]
    ];
    Settings = createLucideIcon("settings", __iconNode7);
  }
});

// node_modules/lucide-react/dist/esm/icons/x.js
var __iconNode8, X;
var init_x = __esm({
  "node_modules/lucide-react/dist/esm/icons/x.js"() {
    init_createLucideIcon();
    __iconNode8 = [
      ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
      ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
    ];
    X = createLucideIcon("x", __iconNode8);
  }
});

// node_modules/lucide-react/dist/esm/lucide-react.js
var init_lucide_react = __esm({
  "node_modules/lucide-react/dist/esm/lucide-react.js"() {
    init_circle_alert();
    init_circle_check_big();
    init_check();
    init_copy();
    init_eye_off();
    init_eye();
    init_settings();
    init_x();
  }
});

// packages/plugins/telegram-bot/src/frontend/components/BotSettingsCard.module.css
var BotSettingsCard_default;
var init_BotSettingsCard = __esm({
  "packages/plugins/telegram-bot/src/frontend/components/BotSettingsCard.module.css"() {
    BotSettingsCard_default = {};
  }
});

// packages/plugins/telegram-bot/src/frontend/components/BotSettingsCard.tsx
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
function BotSettingsCard({ context, onSettingsSaved }) {
  const { ui, api } = context;
  const [loading, setLoading] = React.useState(true);
  const [showToken, setShowToken] = React.useState(false);
  const [showSecret, setShowSecret] = React.useState(false);
  const [settings, setSettings] = React.useState(null);
  const [tokenInput, setTokenInput] = React.useState("");
  const [secretInput, setSecretInput] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [feedback, setFeedback] = React.useState(null);
  React.useEffect(() => {
    async function fetchSettings() {
      try {
        setLoading(true);
        const response = await api.get("/plugins/telegram-bot/system/settings");
        setSettings(response.settings);
      } catch (err) {
        console.error("Error fetching bot settings:", err);
        setFeedback({
          type: "error",
          message: "Failed to load settings. Please refresh the page."
        });
      } finally {
        setLoading(false);
      }
    }
    void fetchSettings();
  }, [api]);
  const validateTokenFormat = (token) => {
    const tokenRegex = /^\d+:[A-Za-z0-9_-]{35}$/;
    return tokenRegex.test(token);
  };
  const handleGenerateSecret = () => {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    const hexString = Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
    setSecretInput(hexString);
    setShowSecret(true);
  };
  const handleSaveClick = async () => {
    if (tokenInput && !validateTokenFormat(tokenInput)) {
      setFeedback({
        type: "error",
        message: "Invalid token format. Expected format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
      });
      return;
    }
    if (secretInput && secretInput.length < 16) {
      setFeedback({
        type: "error",
        message: "Webhook secret must be at least 16 characters long"
      });
      return;
    }
    if (!tokenInput && !secretInput) {
      setFeedback({
        type: "error",
        message: "Please provide at least one value to save"
      });
      return;
    }
    try {
      setIsSaving(true);
      setFeedback(null);
      const updates = {};
      if (tokenInput) updates.botToken = tokenInput;
      if (secretInput) updates.webhookSecret = secretInput;
      await api.put("/plugins/telegram-bot/system/settings", updates);
      const response = await api.get("/plugins/telegram-bot/system/settings");
      setSettings(response.settings);
      if (onSettingsSaved) {
        onSettingsSaved(response.settings);
      }
      setFeedback({
        type: "success",
        message: "Settings updated successfully!"
      });
      setTokenInput("");
      setSecretInput("");
      setShowToken(false);
      setShowSecret(false);
      setTimeout(() => setFeedback(null), 5e3);
    } catch (err) {
      console.error("Error saving settings:", err);
      setFeedback({
        type: "error",
        message: err.response?.data?.error || err.message || "Failed to save settings"
      });
    } finally {
      setIsSaving(false);
    }
  };
  const handleToggleTokenVisibility = () => {
    setShowToken(!showToken);
  };
  const handleToggleSecretVisibility = () => {
    setShowSecret(!showSecret);
  };
  if (loading) {
    return /* @__PURE__ */ jsxs(ui.Card, { children: [
      /* @__PURE__ */ jsxs("h2", { className: BotSettingsCard_default.card_title, children: [
        /* @__PURE__ */ jsx(Settings, { size: 18 }),
        "Bot Authorization"
      ] }),
      /* @__PURE__ */ jsx("div", { className: BotSettingsCard_default.loading, children: "Loading..." })
    ] });
  }
  return /* @__PURE__ */ jsxs(ui.Card, { children: [
    /* @__PURE__ */ jsxs("h2", { className: BotSettingsCard_default.card_title, children: [
      /* @__PURE__ */ jsx(Settings, { size: 18 }),
      "Bot Authorization"
    ] }),
    /* @__PURE__ */ jsxs("div", { className: BotSettingsCard_default.content, children: [
      !settings?.botTokenConfigured && /* @__PURE__ */ jsx("div", { className: BotSettingsCard_default.status_indicator, children: /* @__PURE__ */ jsxs("div", { className: BotSettingsCard_default.status_warning, children: [
        /* @__PURE__ */ jsx(CircleAlert, { size: 16 }),
        /* @__PURE__ */ jsx("span", { children: "Bot token not configured" })
      ] }) }),
      /* @__PURE__ */ jsxs("div", { className: BotSettingsCard_default.field, children: [
        /* @__PURE__ */ jsx("label", { className: BotSettingsCard_default.label, children: "Bot Token" }),
        /* @__PURE__ */ jsxs("div", { className: BotSettingsCard_default.input_group, children: [
          /* @__PURE__ */ jsx(
            ui.Input,
            {
              type: "text",
              value: tokenInput || (showToken && settings?.botToken ? settings.botToken : ""),
              onChange: (e) => setTokenInput(e.target.value),
              placeholder: showToken ? settings?.botToken || "123456789:ABCdefGHIjklMNOpqrsTUVwxyz" : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
              disabled: isSaving || showToken && settings?.botToken !== void 0 && !tokenInput,
              "aria-label": "Bot token"
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              onClick: handleToggleTokenVisibility,
              className: BotSettingsCard_default.visibility_toggle,
              disabled: isSaving,
              "aria-label": showToken ? "Hide token" : "Show token",
              children: showToken ? /* @__PURE__ */ jsx(EyeOff, { size: 18 }) : /* @__PURE__ */ jsx(Eye, { size: 18 })
            }
          )
        ] }),
        !settings?.botTokenConfigured && /* @__PURE__ */ jsxs("details", { className: BotSettingsCard_default.instructions, children: [
          /* @__PURE__ */ jsx("summary", { className: BotSettingsCard_default.instructions_header, children: "How to get a bot token" }),
          /* @__PURE__ */ jsxs("div", { className: BotSettingsCard_default.instructions_content, children: [
            /* @__PURE__ */ jsxs("ol", { className: BotSettingsCard_default.instructions_list, children: [
              /* @__PURE__ */ jsxs("li", { children: [
                "Open Telegram and message ",
                /* @__PURE__ */ jsx("code", { children: "@BotFather" })
              ] }),
              /* @__PURE__ */ jsxs("li", { children: [
                "Send the ",
                /* @__PURE__ */ jsx("code", { children: "/newbot" }),
                " command and follow the instructions"
              ] }),
              /* @__PURE__ */ jsxs("li", { children: [
                "Copy the bot token provided (format: ",
                /* @__PURE__ */ jsx("code", { children: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz" }),
                ")"
              ] }),
              /* @__PURE__ */ jsx("li", { children: "Paste it in the field above and click Save Settings" })
            ] }),
            /* @__PURE__ */ jsx("p", { className: BotSettingsCard_default.instructions_note, children: "After configuring the token, don't forget to set up the webhook in the Webhook Configuration card below." })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: BotSettingsCard_default.field, children: [
        /* @__PURE__ */ jsx("label", { className: BotSettingsCard_default.label, children: "Webhook Secret" }),
        /* @__PURE__ */ jsxs("div", { className: BotSettingsCard_default.input_group, children: [
          /* @__PURE__ */ jsx(
            ui.Input,
            {
              type: "text",
              value: secretInput || (showSecret && settings?.webhookSecret ? settings.webhookSecret : ""),
              onChange: (e) => setSecretInput(e.target.value),
              placeholder: showSecret ? settings?.webhookSecret || "abc123def456..." : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
              disabled: isSaving || showSecret && settings?.webhookSecret !== void 0 && !secretInput,
              "aria-label": "Webhook secret"
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              onClick: handleToggleSecretVisibility,
              className: BotSettingsCard_default.visibility_toggle,
              disabled: isSaving,
              "aria-label": showSecret ? "Hide secret" : "Show secret",
              children: showSecret ? /* @__PURE__ */ jsx(EyeOff, { size: 18 }) : /* @__PURE__ */ jsx(Eye, { size: 18 })
            }
          )
        ] }),
        /* @__PURE__ */ jsx("div", { className: "stack stack--sm", children: /* @__PURE__ */ jsx(
          ui.Button,
          {
            onClick: handleGenerateSecret,
            variant: "secondary",
            size: "sm",
            disabled: isSaving,
            children: "Generate New Secret"
          }
        ) }),
        !settings?.webhookSecretConfigured && /* @__PURE__ */ jsxs("details", { className: BotSettingsCard_default.instructions, children: [
          /* @__PURE__ */ jsx("summary", { className: BotSettingsCard_default.instructions_header, children: "What is a webhook secret?" }),
          /* @__PURE__ */ jsxs("div", { className: BotSettingsCard_default.instructions_content, children: [
            /* @__PURE__ */ jsx("p", { className: BotSettingsCard_default.instructions_note, children: "The webhook secret is a security token that Telegram sends with every webhook request. It ensures that incoming requests are actually from Telegram's servers and not malicious actors." }),
            /* @__PURE__ */ jsx("p", { className: BotSettingsCard_default.instructions_note, children: 'Click "Generate New Secret" to create a secure random string, then save it below. You must configure this secret before the webhook can be deployed.' })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsx("div", { className: BotSettingsCard_default.save_button_container, children: /* @__PURE__ */ jsx(
        ui.Button,
        {
          onClick: handleSaveClick,
          variant: "primary",
          size: "md",
          disabled: isSaving || !tokenInput.trim() && !secretInput.trim(),
          loading: isSaving,
          children: "Save Settings"
        }
      ) }),
      feedback && /* @__PURE__ */ jsxs("div", { className: feedback.type === "success" ? BotSettingsCard_default.feedback_success : BotSettingsCard_default.feedback_error, children: [
        feedback.type === "success" ? /* @__PURE__ */ jsx(CircleCheckBig, { size: 16 }) : /* @__PURE__ */ jsx(CircleAlert, { size: 16 }),
        /* @__PURE__ */ jsx("span", { children: feedback.message })
      ] })
    ] })
  ] });
}
var init_BotSettingsCard2 = __esm({
  "packages/plugins/telegram-bot/src/frontend/components/BotSettingsCard.tsx"() {
    "use strict";
    init_lucide_react();
    init_BotSettingsCard();
  }
});

// packages/plugins/telegram-bot/src/frontend/components/UserStatsCard.tsx
import React2 from "react";
import { Fragment, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function UserStatsCard({ context }) {
  const { ui, api } = context;
  const [stats, setStats] = React2.useState(null);
  const [loading, setLoading] = React2.useState(true);
  const [error, setError] = React2.useState(null);
  React2.useEffect(() => {
    async function fetchStats() {
      try {
        setLoading(true);
        setError(null);
        const response = await api.get(
          "/plugins/telegram-bot/system/stats"
        );
        if (response.success) {
          setStats(response.stats);
        } else {
          setError("Failed to load statistics");
        }
      } catch (err) {
        setError("Failed to fetch statistics");
        console.error("Error fetching Telegram stats:", err);
      } finally {
        setLoading(false);
      }
    }
    void fetchStats();
  }, [api]);
  if (loading) {
    return /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsxs2(ui.Card, { children: [
        /* @__PURE__ */ jsx2("div", { style: { fontSize: "0.875rem", color: "var(--color-text-muted)", marginBottom: "0.5rem" }, children: "Total Users" }),
        /* @__PURE__ */ jsx2("div", { style: { fontSize: "1.75rem", fontWeight: 600 }, children: "--" })
      ] }),
      /* @__PURE__ */ jsxs2(ui.Card, { children: [
        /* @__PURE__ */ jsx2("div", { style: { fontSize: "0.875rem", color: "var(--color-text-muted)", marginBottom: "0.5rem" }, children: "Active (24h)" }),
        /* @__PURE__ */ jsx2("div", { style: { fontSize: "1.75rem", fontWeight: 600 }, children: "--" })
      ] }),
      /* @__PURE__ */ jsxs2(ui.Card, { children: [
        /* @__PURE__ */ jsx2("div", { style: { fontSize: "0.875rem", color: "var(--color-text-muted)", marginBottom: "0.5rem" }, children: "Total Commands" }),
        /* @__PURE__ */ jsx2("div", { style: { fontSize: "1.75rem", fontWeight: 600 }, children: "--" })
      ] })
    ] });
  }
  if (error || !stats) {
    return /* @__PURE__ */ jsx2(ui.Card, { style: { gridColumn: "1 / -1" }, children: /* @__PURE__ */ jsx2("p", { style: { color: "var(--color-danger)", margin: 0 }, children: error || "No statistics available" }) });
  }
  return /* @__PURE__ */ jsxs2(Fragment, { children: [
    /* @__PURE__ */ jsxs2(ui.Card, { children: [
      /* @__PURE__ */ jsx2("div", { style: { fontSize: "0.875rem", color: "var(--color-text-muted)", marginBottom: "0.5rem" }, children: "Total Users" }),
      /* @__PURE__ */ jsx2("div", { style: { fontSize: "1.75rem", fontWeight: 600 }, children: stats.totalUsers.toLocaleString() })
    ] }),
    /* @__PURE__ */ jsxs2(ui.Card, { children: [
      /* @__PURE__ */ jsx2("div", { style: { fontSize: "0.875rem", color: "var(--color-text-muted)", marginBottom: "0.5rem" }, children: "Active (24h)" }),
      /* @__PURE__ */ jsx2("div", { style: { fontSize: "1.75rem", fontWeight: 600 }, children: stats.activeUsers24h.toLocaleString() })
    ] }),
    /* @__PURE__ */ jsxs2(ui.Card, { children: [
      /* @__PURE__ */ jsx2("div", { style: { fontSize: "0.875rem", color: "var(--color-text-muted)", marginBottom: "0.5rem" }, children: "Total Commands" }),
      /* @__PURE__ */ jsx2("div", { style: { fontSize: "1.75rem", fontWeight: 600 }, children: stats.totalCommands.toLocaleString() })
    ] })
  ] });
}
var init_UserStatsCard = __esm({
  "packages/plugins/telegram-bot/src/frontend/components/UserStatsCard.tsx"() {
    "use strict";
  }
});

// packages/plugins/telegram-bot/src/frontend/components/WebhookConfigCard.module.css
var WebhookConfigCard_default;
var init_WebhookConfigCard = __esm({
  "packages/plugins/telegram-bot/src/frontend/components/WebhookConfigCard.module.css"() {
    WebhookConfigCard_default = {};
  }
});

// packages/plugins/telegram-bot/src/frontend/components/WebhookConfigCard.tsx
import React3 from "react";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function WebhookConfigCard({
  context,
  botTokenConfigured: externalBotTokenConfigured,
  webhookSecretConfigured: externalWebhookSecretConfigured,
  onWebhookSecretConfiguredChange
}) {
  const { ui, api } = context;
  const [webhookUrl, setWebhookUrl] = React3.useState("");
  const [loading, setLoading] = React3.useState(true);
  const [copied, setCopied] = React3.useState(false);
  const [internalBotTokenConfigured, setInternalBotTokenConfigured] = React3.useState(true);
  const [internalWebhookSecretConfigured, setInternalWebhookSecretConfigured] = React3.useState(true);
  const [configuring, setConfiguring] = React3.useState(false);
  const [configureResult, setConfigureResult] = React3.useState(null);
  const [verifying, setVerifying] = React3.useState(false);
  const [verifyResult, setVerifyResult] = React3.useState(null);
  const botTokenConfigured = externalBotTokenConfigured ?? internalBotTokenConfigured;
  const webhookSecretConfigured = externalWebhookSecretConfigured ?? internalWebhookSecretConfigured;
  React3.useEffect(() => {
    async function fetchConfig() {
      try {
        setLoading(true);
        const configResponse = await api.get(
          "/plugins/telegram-bot/config"
        );
        if (configResponse.success && configResponse.config.webhookUrl) {
          setWebhookUrl(configResponse.config.webhookUrl);
          if (externalBotTokenConfigured === void 0) {
            setInternalBotTokenConfigured(configResponse.config.botTokenConfigured ?? true);
          }
        }
        if (externalWebhookSecretConfigured === void 0) {
          const settingsResponse = await api.get(
            "/plugins/telegram-bot/system/settings"
          );
          if (settingsResponse.success) {
            const configured = settingsResponse.settings.webhookSecretConfigured ?? false;
            setInternalWebhookSecretConfigured(configured);
            if (onWebhookSecretConfiguredChange) {
              onWebhookSecretConfiguredChange(configured);
            }
          }
        }
      } catch (err) {
        console.error("Error fetching webhook config:", err);
      } finally {
        setLoading(false);
      }
    }
    void fetchConfig();
  }, [api]);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2e3);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };
  const handleConfigureWebhook = async () => {
    try {
      setConfiguring(true);
      setConfigureResult(null);
      const response = await api.post(
        "/plugins/telegram-bot/system/configure-webhook",
        {}
      );
      if (response.success) {
        setConfigureResult({ success: true, message: response.message || "Webhook configured successfully!" });
      } else {
        setConfigureResult({ success: false, message: response.error || "Failed to configure webhook" });
      }
    } catch (err) {
      console.error("Error configuring webhook:", err);
      setConfigureResult({
        success: false,
        message: err.response?.data?.error || err.message || "Failed to configure webhook"
      });
    } finally {
      setConfiguring(false);
      setTimeout(() => setConfigureResult(null), 5e3);
    }
  };
  const handleVerifyWebhook = async () => {
    try {
      setVerifying(true);
      setVerifyResult(null);
      const response = await api.get("/plugins/telegram-bot/system/verify-webhook");
      if (response.success) {
        if (response.isConfigured) {
          setVerifyResult({
            success: true,
            message: "\u2713 Webhook is correctly configured!",
            details: response.webhookInfo
          });
        } else {
          setVerifyResult({
            success: false,
            message: response.webhookInfo.url ? `\u2717 Webhook URL mismatch. Expected: ${response.expectedUrl}, Got: ${response.webhookInfo.url}` : '\u2717 Webhook is not configured in Telegram. Click "Register Webhook" to set it up.',
            details: response.webhookInfo
          });
        }
      } else {
        setVerifyResult({
          success: false,
          message: response.error || "Failed to verify webhook"
        });
      }
    } catch (err) {
      console.error("Error verifying webhook:", err);
      setVerifyResult({
        success: false,
        message: err.response?.data?.error || err.message || "Failed to verify webhook"
      });
    } finally {
      setVerifying(false);
    }
  };
  if (loading) {
    return /* @__PURE__ */ jsxs3(ui.Card, { children: [
      /* @__PURE__ */ jsx3("h2", { className: WebhookConfigCard_default.card_title, children: "Webhook Configuration" }),
      /* @__PURE__ */ jsx3("div", { className: WebhookConfigCard_default.loading, children: "Loading..." })
    ] });
  }
  return /* @__PURE__ */ jsxs3(ui.Card, { children: [
    /* @__PURE__ */ jsx3("h2", { className: WebhookConfigCard_default.card_title, children: "Webhook Configuration" }),
    /* @__PURE__ */ jsxs3("div", { className: WebhookConfigCard_default.content, children: [
      !botTokenConfigured && /* @__PURE__ */ jsxs3("div", { className: WebhookConfigCard_default.warning_card, children: [
        /* @__PURE__ */ jsxs3("h3", { className: WebhookConfigCard_default.warning_title, children: [
          /* @__PURE__ */ jsx3(CircleAlert, { size: 16 }),
          "Bot Token Not Configured"
        ] }),
        /* @__PURE__ */ jsx3("p", { className: WebhookConfigCard_default.warning_text, children: "To enable the Telegram bot, you need to obtain a bot token from BotFather and configure it via the admin interface." }),
        /* @__PURE__ */ jsxs3("ol", { className: WebhookConfigCard_default.warning_list, children: [
          /* @__PURE__ */ jsxs3("li", { children: [
            "Open Telegram and message ",
            /* @__PURE__ */ jsx3("code", { children: "@BotFather" })
          ] }),
          /* @__PURE__ */ jsxs3("li", { children: [
            "Send ",
            /* @__PURE__ */ jsx3("code", { children: "/newbot" }),
            " command and follow the prompts"
          ] }),
          /* @__PURE__ */ jsxs3("li", { children: [
            "Copy the bot token (format: ",
            /* @__PURE__ */ jsx3("code", { children: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz" }),
            ")"
          ] }),
          /* @__PURE__ */ jsx3("li", { children: 'Navigate to the "Bot Authorization" card below' }),
          /* @__PURE__ */ jsx3("li", { children: 'Paste the token and click "Save Settings"' })
        ] })
      ] }),
      /* @__PURE__ */ jsxs3("div", { className: WebhookConfigCard_default.field, children: [
        /* @__PURE__ */ jsx3("label", { className: WebhookConfigCard_default.label, children: "Webhook URL" }),
        /* @__PURE__ */ jsxs3("div", { className: WebhookConfigCard_default.url_input_group, children: [
          /* @__PURE__ */ jsx3(
            "input",
            {
              type: "text",
              value: webhookUrl,
              readOnly: true,
              className: WebhookConfigCard_default.url_input,
              "aria-label": "Webhook URL"
            }
          ),
          /* @__PURE__ */ jsx3(
            ui.Button,
            {
              onClick: handleCopy,
              variant: "secondary",
              size: "sm",
              "aria-label": copied ? "Copied to clipboard" : "Copy to clipboard",
              children: copied ? /* @__PURE__ */ jsx3(Check, { size: 16 }) : /* @__PURE__ */ jsx3(Copy, { size: 16 })
            }
          )
        ] })
      ] }),
      botTokenConfigured && /* @__PURE__ */ jsxs3("div", { className: WebhookConfigCard_default.config_section, children: [
        /* @__PURE__ */ jsx3("h3", { className: WebhookConfigCard_default.section_title, children: "Register Webhook with Telegram" }),
        !webhookSecretConfigured && /* @__PURE__ */ jsxs3("div", { className: WebhookConfigCard_default.warning_card, style: { marginBottom: "1rem" }, children: [
          /* @__PURE__ */ jsxs3("h3", { className: WebhookConfigCard_default.warning_title, children: [
            /* @__PURE__ */ jsx3(CircleAlert, { size: 16 }),
            "Webhook Secret Not Configured"
          ] }),
          /* @__PURE__ */ jsx3("p", { className: WebhookConfigCard_default.warning_text, children: "You must configure a webhook secret before registering the webhook. The secret ensures that incoming webhook requests are actually from Telegram's servers." }),
          /* @__PURE__ */ jsx3("p", { className: WebhookConfigCard_default.warning_text, children: 'See the "Bot Authorization" card above and generate/save a webhook secret, then return here to register the webhook.' })
        ] }),
        /* @__PURE__ */ jsxs3("div", { className: WebhookConfigCard_default.button_row, children: [
          /* @__PURE__ */ jsx3(
            ui.Button,
            {
              onClick: handleConfigureWebhook,
              variant: "secondary",
              size: "md",
              disabled: configuring || !webhookSecretConfigured,
              children: configuring ? "Registering..." : "Register Webhook"
            }
          ),
          /* @__PURE__ */ jsx3(
            ui.Button,
            {
              onClick: handleVerifyWebhook,
              variant: "secondary",
              size: "md",
              disabled: verifying,
              children: verifying ? "Verifying..." : "Verify"
            }
          )
        ] }),
        configureResult && /* @__PURE__ */ jsx3("div", { className: `${WebhookConfigCard_default.feedback_message} ${configureResult.success ? WebhookConfigCard_default["feedback_message--success"] : WebhookConfigCard_default["feedback_message--error"]}`, children: /* @__PURE__ */ jsxs3("span", { className: WebhookConfigCard_default.feedback_text, children: [
          configureResult.success ? "\u2713 " : "\u2717 ",
          configureResult.message
        ] }) }),
        verifyResult && /* @__PURE__ */ jsxs3("div", { className: `${WebhookConfigCard_default.feedback_message} ${verifyResult.success ? WebhookConfigCard_default["feedback_message--success"] : WebhookConfigCard_default["feedback_message--error"]}`, children: [
          /* @__PURE__ */ jsx3("span", { className: WebhookConfigCard_default.feedback_text, children: verifyResult.message }),
          /* @__PURE__ */ jsx3(
            "button",
            {
              type: "button",
              onClick: () => setVerifyResult(null),
              className: WebhookConfigCard_default.close_button,
              "aria-label": "Close message",
              children: /* @__PURE__ */ jsx3(X, { size: 16 })
            }
          ),
          verifyResult.details && /* @__PURE__ */ jsxs3("details", { className: WebhookConfigCard_default.feedback_details, children: [
            /* @__PURE__ */ jsx3("summary", { className: WebhookConfigCard_default.details_summary, children: "View Details" }),
            /* @__PURE__ */ jsxs3("div", { className: WebhookConfigCard_default.details_content, children: [
              verifyResult.details.url && /* @__PURE__ */ jsxs3("div", { children: [
                "URL: ",
                verifyResult.details.url
              ] }),
              verifyResult.details.pendingUpdateCount !== void 0 && /* @__PURE__ */ jsxs3("div", { children: [
                "Pending Updates: ",
                verifyResult.details.pendingUpdateCount
              ] }),
              verifyResult.details.maxConnections && /* @__PURE__ */ jsxs3("div", { children: [
                "Max Connections: ",
                verifyResult.details.maxConnections
              ] }),
              verifyResult.details.ipAddress && /* @__PURE__ */ jsxs3("div", { children: [
                "IP Address: ",
                verifyResult.details.ipAddress
              ] }),
              verifyResult.details.lastErrorMessage && /* @__PURE__ */ jsxs3("div", { className: WebhookConfigCard_default.error_text, children: [
                "Last Error: ",
                verifyResult.details.lastErrorMessage
              ] })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs3("details", { className: WebhookConfigCard_default.advanced_instructions, children: [
          /* @__PURE__ */ jsx3("summary", { className: WebhookConfigCard_default.instructions_summary, children: "Advanced: Manual Registration" }),
          /* @__PURE__ */ jsxs3("div", { className: WebhookConfigCard_default.instructions_content, children: [
            /* @__PURE__ */ jsx3("p", { className: WebhookConfigCard_default.instructions_text, children: "Alternatively, run this command in your terminal:" }),
            /* @__PURE__ */ jsx3("pre", { className: WebhookConfigCard_default.code_block, children: `curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "${webhookUrl}",
    "secret_token": "<YOUR_WEBHOOK_SECRET>"
  }'` }),
            /* @__PURE__ */ jsxs3("p", { className: WebhookConfigCard_default.code_note, children: [
              "Replace ",
              /* @__PURE__ */ jsx3("code", { children: "<YOUR_BOT_TOKEN>" }),
              " with your bot token and ",
              /* @__PURE__ */ jsx3("code", { children: "<YOUR_WEBHOOK_SECRET>" }),
              " with the webhook secret configured in the settings above."
            ] })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs3("div", { className: WebhookConfigCard_default.security_note, children: [
        /* @__PURE__ */ jsx3("strong", { children: "Security Note:" }),
        " This webhook is protected by IP allowlist and webhook secret. Only Telegram's servers can send updates to this endpoint."
      ] })
    ] })
  ] });
}
var init_WebhookConfigCard2 = __esm({
  "packages/plugins/telegram-bot/src/frontend/components/WebhookConfigCard.tsx"() {
    "use strict";
    init_lucide_react();
    init_WebhookConfigCard();
  }
});

// packages/plugins/telegram-bot/src/frontend/components/SettingsCard.module.css
var SettingsCard_default;
var init_SettingsCard = __esm({
  "packages/plugins/telegram-bot/src/frontend/components/SettingsCard.module.css"() {
    SettingsCard_default = {};
  }
});

// packages/plugins/telegram-bot/src/frontend/components/SettingsCard.tsx
import React4 from "react";
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
function SettingsCard({ context }) {
  const { ui, api } = context;
  const [loading, setLoading] = React4.useState(true);
  const [settings, setSettings] = React4.useState(null);
  const [rateLimitPerUser, setRateLimitPerUser] = React4.useState(10);
  const [rateLimitWindowMs, setRateLimitWindowMs] = React4.useState(6e4);
  const [isSaving, setIsSaving] = React4.useState(false);
  const [feedback, setFeedback] = React4.useState(null);
  const [hasChanges, setHasChanges] = React4.useState(false);
  React4.useEffect(() => {
    async function fetchSettings() {
      try {
        setLoading(true);
        const response = await api.get("/plugins/telegram-bot/system/settings");
        setSettings(response.settings);
        setRateLimitPerUser(response.settings.rateLimitPerUser);
        setRateLimitWindowMs(response.settings.rateLimitWindowMs);
      } catch (err) {
        console.error("Error fetching settings:", err);
        setFeedback({
          type: "error",
          message: "Failed to load settings. Please refresh the page."
        });
      } finally {
        setLoading(false);
      }
    }
    void fetchSettings();
  }, [api]);
  React4.useEffect(() => {
    if (!settings) return;
    const changed = rateLimitPerUser !== settings.rateLimitPerUser || rateLimitWindowMs !== settings.rateLimitWindowMs;
    setHasChanges(changed);
  }, [rateLimitPerUser, rateLimitWindowMs, settings]);
  const validateInputs = () => {
    if (rateLimitPerUser < 1 || rateLimitPerUser > 100) {
      setFeedback({
        type: "error",
        message: "Rate limit per user must be between 1 and 100 commands"
      });
      return false;
    }
    if (rateLimitWindowMs < 1e4 || rateLimitWindowMs > 3e5) {
      setFeedback({
        type: "error",
        message: "Rate limit window must be between 10 and 300 seconds"
      });
      return false;
    }
    return true;
  };
  const handleSaveClick = async () => {
    if (!validateInputs()) {
      return;
    }
    try {
      setIsSaving(true);
      setFeedback(null);
      await api.put("/plugins/telegram-bot/system/settings", {
        rateLimitPerUser,
        rateLimitWindowMs
      });
      const response = await api.get("/plugins/telegram-bot/system/settings");
      setSettings(response.settings);
      setRateLimitPerUser(response.settings.rateLimitPerUser);
      setRateLimitWindowMs(response.settings.rateLimitWindowMs);
      setFeedback({
        type: "success",
        message: "Settings updated successfully!"
      });
      setHasChanges(false);
      setTimeout(() => setFeedback(null), 5e3);
    } catch (err) {
      console.error("Error saving settings:", err);
      setFeedback({
        type: "error",
        message: err.response?.data?.error || err.message || "Failed to save settings"
      });
    } finally {
      setIsSaving(false);
    }
  };
  const handleResetClick = () => {
    if (!settings) return;
    setRateLimitPerUser(settings.rateLimitPerUser);
    setRateLimitWindowMs(settings.rateLimitWindowMs);
    setFeedback(null);
  };
  if (loading) {
    return /* @__PURE__ */ jsxs4(ui.Card, { children: [
      /* @__PURE__ */ jsxs4("h2", { className: SettingsCard_default.card_title, children: [
        /* @__PURE__ */ jsx4(Settings, { size: 18 }),
        "Settings"
      ] }),
      /* @__PURE__ */ jsx4("div", { className: SettingsCard_default.loading, children: "Loading..." })
    ] });
  }
  return /* @__PURE__ */ jsxs4(ui.Card, { children: [
    /* @__PURE__ */ jsxs4("h2", { className: SettingsCard_default.card_title, children: [
      /* @__PURE__ */ jsx4(Settings, { size: 18 }),
      "Settings"
    ] }),
    /* @__PURE__ */ jsxs4("div", { className: SettingsCard_default.content, children: [
      /* @__PURE__ */ jsxs4("div", { className: SettingsCard_default.section, children: [
        /* @__PURE__ */ jsx4("h3", { className: SettingsCard_default.section_title, children: "Rate Limiting" }),
        /* @__PURE__ */ jsx4("p", { className: SettingsCard_default.section_description, children: "Control how many commands users can execute within a time window to prevent spam and abuse." }),
        /* @__PURE__ */ jsxs4("div", { className: SettingsCard_default.field, children: [
          /* @__PURE__ */ jsx4("label", { className: SettingsCard_default.label, htmlFor: "rateLimitPerUser", children: "Commands per User" }),
          /* @__PURE__ */ jsxs4("div", { className: SettingsCard_default.input_with_unit, children: [
            /* @__PURE__ */ jsx4(
              ui.Input,
              {
                id: "rateLimitPerUser",
                type: "number",
                value: rateLimitPerUser.toString(),
                onChange: (e) => setRateLimitPerUser(parseInt(e.target.value, 10)),
                min: 1,
                max: 100,
                step: 1,
                disabled: isSaving,
                "aria-label": "Commands per user"
              }
            ),
            /* @__PURE__ */ jsx4("span", { className: SettingsCard_default.unit, children: "commands" })
          ] }),
          /* @__PURE__ */ jsx4("p", { className: SettingsCard_default.help_text, children: "Maximum number of commands a single user can execute within the time window (1-100)." })
        ] }),
        /* @__PURE__ */ jsxs4("div", { className: SettingsCard_default.field, children: [
          /* @__PURE__ */ jsx4("label", { className: SettingsCard_default.label, htmlFor: "rateLimitWindow", children: "Time Window" }),
          /* @__PURE__ */ jsxs4("div", { className: SettingsCard_default.input_with_unit, children: [
            /* @__PURE__ */ jsx4(
              ui.Input,
              {
                id: "rateLimitWindow",
                type: "number",
                value: (rateLimitWindowMs / 1e3).toString(),
                onChange: (e) => setRateLimitWindowMs(parseInt(e.target.value, 10) * 1e3),
                min: 10,
                max: 300,
                step: 10,
                disabled: isSaving,
                "aria-label": "Rate limit window in seconds"
              }
            ),
            /* @__PURE__ */ jsx4("span", { className: SettingsCard_default.unit, children: "seconds" })
          ] }),
          /* @__PURE__ */ jsx4("p", { className: SettingsCard_default.help_text, children: "Time window for rate limiting (10-300 seconds). Users can execute up to the command limit within this window." })
        ] }),
        /* @__PURE__ */ jsxs4("div", { className: SettingsCard_default.example, children: [
          /* @__PURE__ */ jsx4("strong", { children: "Current configuration:" }),
          " Users can execute up to",
          " ",
          /* @__PURE__ */ jsxs4("strong", { children: [
            rateLimitPerUser,
            " commands"
          ] }),
          " every",
          " ",
          /* @__PURE__ */ jsxs4("strong", { children: [
            rateLimitWindowMs / 1e3,
            " seconds"
          ] }),
          "."
        ] })
      ] }),
      /* @__PURE__ */ jsxs4("div", { className: SettingsCard_default.button_row, children: [
        /* @__PURE__ */ jsx4(
          ui.Button,
          {
            onClick: handleResetClick,
            variant: "secondary",
            size: "md",
            disabled: isSaving || !hasChanges,
            children: "Reset"
          }
        ),
        /* @__PURE__ */ jsx4(
          ui.Button,
          {
            onClick: handleSaveClick,
            variant: "primary",
            size: "md",
            disabled: isSaving || !hasChanges,
            loading: isSaving,
            children: "Save Settings"
          }
        )
      ] }),
      feedback && /* @__PURE__ */ jsxs4("div", { className: feedback.type === "success" ? SettingsCard_default.feedback_success : SettingsCard_default.feedback_error, children: [
        feedback.type === "success" ? /* @__PURE__ */ jsx4(CircleCheckBig, { size: 16 }) : /* @__PURE__ */ jsx4(CircleAlert, { size: 16 }),
        /* @__PURE__ */ jsx4("span", { children: feedback.message })
      ] })
    ] })
  ] });
}
var init_SettingsCard2 = __esm({
  "packages/plugins/telegram-bot/src/frontend/components/SettingsCard.tsx"() {
    "use strict";
    init_lucide_react();
    init_SettingsCard();
  }
});

// packages/plugins/telegram-bot/src/frontend/TelegramBotSettingsPage.tsx
var TelegramBotSettingsPage_exports = {};
__export(TelegramBotSettingsPage_exports, {
  TelegramBotSettingsPage: () => TelegramBotSettingsPage
});
import React5 from "react";
import { jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
function TelegramBotSettingsPage({ context }) {
  const { ui } = context;
  const [testChatId, setTestChatId] = React5.useState("");
  const [selectedChannelId, setSelectedChannelId] = React5.useState("");
  const [testThreadId, setTestThreadId] = React5.useState("");
  const [testMessage, setTestMessage] = React5.useState("");
  const [testStatus, setTestStatus] = React5.useState(null);
  const [isSending, setIsSending] = React5.useState(false);
  const [botTokenConfigured, setBotTokenConfigured] = React5.useState(void 0);
  const [webhookSecretConfigured, setWebhookSecretConfigured] = React5.useState(void 0);
  const [channels, setChannels] = React5.useState([]);
  const [isLoadingChannels, setIsLoadingChannels] = React5.useState(false);
  React5.useEffect(() => {
    async function fetchChannels() {
      try {
        setIsLoadingChannels(true);
        const response = await context.api.get(
          "/plugins/telegram-bot/system/channels"
        );
        if (response.success && response.channels) {
          setChannels(response.channels);
        }
      } catch (error) {
        console.error("Failed to fetch channels:", error);
      } finally {
        setIsLoadingChannels(false);
      }
    }
    void fetchChannels();
  }, [context.api]);
  const handleChannelSelect = (e) => {
    const channelId = e.target.value;
    setSelectedChannelId(channelId);
    if (channelId) {
      setTestChatId(channelId);
    }
  };
  const handleTestNotification = async (e) => {
    e.preventDefault();
    const chatId = testChatId;
    if (!chatId || !testMessage) {
      setTestStatus({ type: "error", message: "Chat ID and message are required" });
      return;
    }
    try {
      setIsSending(true);
      setTestStatus(null);
      const response = await context.api.post(
        "/plugins/telegram-bot/system/test",
        {
          chatId,
          message: testMessage,
          threadId: testThreadId || void 0
        }
      );
      if (response.success) {
        setTestStatus({ type: "success", message: response.message || "Test notification sent successfully!" });
        setTestMessage("");
      } else {
        setTestStatus({ type: "error", message: response.error || "Failed to send test notification" });
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.message || "Failed to send test notification";
      setTestStatus({ type: "error", message: errorMessage });
    } finally {
      setIsSending(false);
    }
  };
  return /* @__PURE__ */ jsxs5("div", { children: [
    /* @__PURE__ */ jsxs5("div", { style: { marginBottom: "3rem" }, children: [
      /* @__PURE__ */ jsx5("h1", { style: { fontSize: "1.875rem", fontWeight: 700, marginBottom: "0.5rem" }, children: "Telegram Bot Settings" }),
      /* @__PURE__ */ jsx5("p", { style: { color: "var(--color-text-muted)", fontSize: "1rem" }, children: "Configure and monitor your Telegram bot integration" })
    ] }),
    /* @__PURE__ */ jsx5("div", { style: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
      gap: "1.5rem",
      marginBottom: "3rem"
    }, children: /* @__PURE__ */ jsx5(UserStatsCard, { context }) }),
    /* @__PURE__ */ jsxs5("div", { style: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
      gap: "2rem",
      marginBottom: "3rem"
    }, children: [
      /* @__PURE__ */ jsx5(
        BotSettingsCard,
        {
          context,
          onSettingsSaved: (settings) => {
            if (settings.botTokenConfigured !== void 0) {
              setBotTokenConfigured(settings.botTokenConfigured);
            }
            if (settings.webhookSecretConfigured !== void 0) {
              setWebhookSecretConfigured(settings.webhookSecretConfigured);
            }
          }
        }
      ),
      /* @__PURE__ */ jsx5(
        WebhookConfigCard,
        {
          context,
          botTokenConfigured,
          webhookSecretConfigured,
          onWebhookSecretConfiguredChange: setWebhookSecretConfigured
        }
      )
    ] }),
    /* @__PURE__ */ jsx5("div", { style: { marginBottom: "3rem" }, children: /* @__PURE__ */ jsx5(SettingsCard, { context }) }),
    /* @__PURE__ */ jsxs5(ui.Card, { style: { marginBottom: "3rem" }, children: [
      /* @__PURE__ */ jsx5("h3", { style: { fontSize: "1.25rem", fontWeight: 600, marginBottom: "1.5rem" }, children: "Test Notification" }),
      /* @__PURE__ */ jsxs5("form", { onSubmit: handleTestNotification, style: { display: "flex", flexDirection: "column", gap: "1.5rem" }, children: [
        /* @__PURE__ */ jsxs5("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }, children: [
          /* @__PURE__ */ jsxs5("div", { children: [
            /* @__PURE__ */ jsxs5("label", { style: { display: "block", fontSize: "0.875rem", fontWeight: 500, marginBottom: "0.5rem" }, children: [
              "Chat ID ",
              /* @__PURE__ */ jsx5("span", { style: { color: "var(--color-danger)" }, children: "*" })
            ] }),
            /* @__PURE__ */ jsx5(
              ui.Input,
              {
                type: "text",
                value: testChatId,
                onChange: (e) => setTestChatId(e.target.value),
                placeholder: "-1001234567890",
                disabled: isSending
              }
            ),
            /* @__PURE__ */ jsx5("div", { style: { fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.5rem" }, children: "Enter manually or select from dropdown" })
          ] }),
          /* @__PURE__ */ jsxs5("div", { children: [
            /* @__PURE__ */ jsx5("label", { style: { display: "block", fontSize: "0.875rem", fontWeight: 500, marginBottom: "0.5rem" }, children: "Or Select Channel/Group" }),
            /* @__PURE__ */ jsxs5(
              "select",
              {
                value: selectedChannelId,
                onChange: handleChannelSelect,
                disabled: isSending || isLoadingChannels,
                style: {
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--color-border)",
                  backgroundColor: isSending || isLoadingChannels ? "var(--color-surface-secondary)" : "var(--color-surface)",
                  color: "var(--color-text)",
                  fontFamily: "inherit",
                  fontSize: "0.875rem",
                  opacity: isSending || isLoadingChannels ? 0.6 : 1,
                  cursor: isSending || isLoadingChannels ? "not-allowed" : "pointer"
                },
                children: [
                  /* @__PURE__ */ jsx5("option", { value: "", children: isLoadingChannels ? "Loading channels..." : "-- Select a channel --" }),
                  channels.filter((channel) => channel.isActive).map((channel) => /* @__PURE__ */ jsxs5("option", { value: channel.chatId, children: [
                    channel.title || `Chat ${channel.chatId}`,
                    " (",
                    channel.type,
                    ")"
                  ] }, channel.chatId))
                ]
              }
            ),
            /* @__PURE__ */ jsx5("div", { style: { fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.5rem" }, children: channels.filter((c) => c.isActive).length > 0 ? `${channels.filter((c) => c.isActive).length} active channel${channels.filter((c) => c.isActive).length !== 1 ? "s" : ""}` : "No channels found" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs5("div", { children: [
          /* @__PURE__ */ jsx5("label", { style: { display: "block", fontSize: "0.875rem", fontWeight: 500, marginBottom: "0.5rem" }, children: "Thread ID (Optional)" }),
          /* @__PURE__ */ jsx5(
            ui.Input,
            {
              type: "text",
              value: testThreadId,
              onChange: (e) => setTestThreadId(e.target.value),
              placeholder: "51",
              disabled: isSending
            }
          ),
          /* @__PURE__ */ jsx5("div", { style: { fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.5rem" }, children: "Leave empty to post to main channel, or enter a topic/thread ID for organized channels" })
        ] }),
        /* @__PURE__ */ jsxs5("div", { children: [
          /* @__PURE__ */ jsxs5("label", { style: { display: "block", fontSize: "0.875rem", fontWeight: 500, marginBottom: "0.5rem" }, children: [
            "Message ",
            /* @__PURE__ */ jsx5("span", { style: { color: "var(--color-danger)" }, children: "*" })
          ] }),
          /* @__PURE__ */ jsx5(
            "textarea",
            {
              value: testMessage,
              onChange: (e) => setTestMessage(e.target.value),
              placeholder: "Enter test message",
              rows: 4,
              disabled: isSending,
              style: {
                width: "100%",
                padding: "0.75rem",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--color-border)",
                backgroundColor: isSending ? "var(--color-surface-secondary)" : "var(--color-surface)",
                color: "var(--color-text)",
                fontFamily: "inherit",
                fontSize: "0.875rem",
                resize: "vertical",
                opacity: isSending ? 0.6 : 1
              }
            }
          )
        ] }),
        testStatus && /* @__PURE__ */ jsx5("div", { style: {
          padding: "0.75rem",
          borderRadius: "var(--radius-md)",
          backgroundColor: testStatus.type === "success" ? "rgba(87, 212, 140, 0.1)" : "rgba(255, 111, 125, 0.1)",
          border: testStatus.type === "success" ? "1px solid var(--color-success)" : "1px solid var(--color-danger)",
          color: testStatus.type === "success" ? "var(--color-success)" : "var(--color-danger)",
          fontSize: "0.875rem",
          lineHeight: 1.5
        }, children: testStatus.message }),
        /* @__PURE__ */ jsx5("div", { children: /* @__PURE__ */ jsx5(ui.Button, { type: "submit", variant: "primary", disabled: isSending, children: isSending ? "Sending..." : "Send Test Notification" }) })
      ] })
    ] }),
    /* @__PURE__ */ jsxs5(ui.Card, { children: [
      /* @__PURE__ */ jsx5("h3", { style: { fontSize: "1.25rem", fontWeight: 600, marginBottom: "1.5rem" }, children: "Subscription Types" }),
      /* @__PURE__ */ jsxs5("div", { style: { color: "var(--color-text-muted)", fontSize: "0.875rem" }, children: [
        /* @__PURE__ */ jsx5("p", { style: { marginBottom: "1rem" }, children: "Subscription management coming soon. Users will be able to subscribe to:" }),
        /* @__PURE__ */ jsxs5("ul", { style: { paddingLeft: "2rem", margin: 0 }, children: [
          /* @__PURE__ */ jsx5("li", { style: { marginBottom: "0.5rem" }, children: "Whale Alerts - Large TRX transfers" }),
          /* @__PURE__ */ jsx5("li", { style: { marginBottom: "0.5rem" }, children: "Market Updates - Significant price changes" }),
          /* @__PURE__ */ jsx5("li", { style: { marginBottom: "0.5rem" }, children: "Price Alerts - Custom threshold notifications" })
        ] })
      ] })
    ] })
  ] });
}
var init_TelegramBotSettingsPage = __esm({
  "packages/plugins/telegram-bot/src/frontend/TelegramBotSettingsPage.tsx"() {
    "use strict";
    init_BotSettingsCard2();
    init_UserStatsCard();
    init_WebhookConfigCard2();
    init_SettingsCard2();
  }
});

// packages/plugins/telegram-bot/src/frontend/frontend.ts
var import_dynamic = __toESM(require_dynamic2(), 1);

// packages/types/dist/plugin/definePlugin.js
function definePlugin(plugin) {
  return plugin;
}

// packages/plugins/telegram-bot/src/manifest.ts
var telegramBotManifest = {
  id: "telegram-bot",
  title: "Telegram Bot",
  version: "1.0.0",
  description: "Telegram bot interface for market queries and notifications",
  author: "TronRelic",
  license: "MIT",
  backend: true,
  frontend: true,
  adminUrl: "/system/plugins/telegram-bot/settings"
};

// packages/plugins/telegram-bot/src/frontend/frontend.ts
var TelegramBotSettingsPage2 = (0, import_dynamic.default)(
  () => Promise.resolve().then(() => (init_TelegramBotSettingsPage(), TelegramBotSettingsPage_exports)).then((m) => m.TelegramBotSettingsPage)
);
var telegramBotFrontendPlugin = definePlugin({
  manifest: telegramBotManifest,
  /**
   * Admin pages.
   * Registered under /system/plugins/ namespace with admin authentication.
   *
   * The settings page is accessible at /system/plugins/telegram-bot/settings
   * but is not exposed in the navigation menu. This is intentional - the plugin
   * provides backend infrastructure (webhook handling, command processing) and
   * admin settings should be managed through the plugin system interface.
   */
  adminPages: [
    {
      path: "/system/plugins/telegram-bot/settings",
      component: TelegramBotSettingsPage2,
      title: "Telegram Bot Settings",
      requiresAdmin: true
    }
  ]
});
var frontend_default = telegramBotFrontendPlugin;
export {
  frontend_default as default,
  telegramBotFrontendPlugin
};
/*! Bundled license information:

lucide-react/dist/esm/shared/src/utils.js:
lucide-react/dist/esm/defaultAttributes.js:
lucide-react/dist/esm/Icon.js:
lucide-react/dist/esm/createLucideIcon.js:
lucide-react/dist/esm/icons/check.js:
lucide-react/dist/esm/icons/circle-alert.js:
lucide-react/dist/esm/icons/circle-check-big.js:
lucide-react/dist/esm/icons/copy.js:
lucide-react/dist/esm/icons/eye-off.js:
lucide-react/dist/esm/icons/eye.js:
lucide-react/dist/esm/icons/settings.js:
lucide-react/dist/esm/icons/x.js:
lucide-react/dist/esm/lucide-react.js:
  (**
   * @license lucide-react v0.545.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
