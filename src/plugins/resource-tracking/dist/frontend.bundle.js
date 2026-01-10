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

// node_modules/lucide-react/dist/esm/icons/activity.js
var __iconNode, Activity;
var init_activity = __esm({
  "node_modules/lucide-react/dist/esm/icons/activity.js"() {
    init_createLucideIcon();
    __iconNode = [
      [
        "path",
        {
          d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
          key: "169zse"
        }
      ]
    ];
    Activity = createLucideIcon("activity", __iconNode);
  }
});

// node_modules/lucide-react/dist/esm/icons/chart-column.js
var __iconNode2, ChartColumn;
var init_chart_column = __esm({
  "node_modules/lucide-react/dist/esm/icons/chart-column.js"() {
    init_createLucideIcon();
    __iconNode2 = [
      ["path", { d: "M3 3v16a2 2 0 0 0 2 2h16", key: "c24i48" }],
      ["path", { d: "M18 17V9", key: "2bz60n" }],
      ["path", { d: "M13 17V5", key: "1frdt8" }],
      ["path", { d: "M8 17v-3", key: "17ska0" }]
    ];
    ChartColumn = createLucideIcon("chart-column", __iconNode2);
  }
});

// node_modules/lucide-react/dist/esm/icons/circle-alert.js
var __iconNode3, CircleAlert;
var init_circle_alert = __esm({
  "node_modules/lucide-react/dist/esm/icons/circle-alert.js"() {
    init_createLucideIcon();
    __iconNode3 = [
      ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
      ["line", { x1: "12", x2: "12", y1: "8", y2: "12", key: "1pkeuh" }],
      ["line", { x1: "12", x2: "12.01", y1: "16", y2: "16", key: "4dfq90" }]
    ];
    CircleAlert = createLucideIcon("circle-alert", __iconNode3);
  }
});

// node_modules/lucide-react/dist/esm/icons/circle-question-mark.js
var __iconNode4, CircleQuestionMark;
var init_circle_question_mark = __esm({
  "node_modules/lucide-react/dist/esm/icons/circle-question-mark.js"() {
    init_createLucideIcon();
    __iconNode4 = [
      ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
      ["path", { d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", key: "1u773s" }],
      ["path", { d: "M12 17h.01", key: "p32p05" }]
    ];
    CircleQuestionMark = createLucideIcon("circle-question-mark", __iconNode4);
  }
});

// node_modules/lucide-react/dist/esm/icons/gauge.js
var __iconNode5, Gauge;
var init_gauge = __esm({
  "node_modules/lucide-react/dist/esm/icons/gauge.js"() {
    init_createLucideIcon();
    __iconNode5 = [
      ["path", { d: "m12 14 4-4", key: "9kzdfg" }],
      ["path", { d: "M3.34 19a10 10 0 1 1 17.32 0", key: "19p75a" }]
    ];
    Gauge = createLucideIcon("gauge", __iconNode5);
  }
});

// node_modules/lucide-react/dist/esm/icons/maximize-2.js
var __iconNode6, Maximize2;
var init_maximize_2 = __esm({
  "node_modules/lucide-react/dist/esm/icons/maximize-2.js"() {
    init_createLucideIcon();
    __iconNode6 = [
      ["path", { d: "M15 3h6v6", key: "1q9fwt" }],
      ["path", { d: "m21 3-7 7", key: "1l2asr" }],
      ["path", { d: "m3 21 7-7", key: "tjx5ai" }],
      ["path", { d: "M9 21H3v-6", key: "wtvkvv" }]
    ];
    Maximize2 = createLucideIcon("maximize-2", __iconNode6);
  }
});

// node_modules/lucide-react/dist/esm/icons/minimize-2.js
var __iconNode7, Minimize2;
var init_minimize_2 = __esm({
  "node_modules/lucide-react/dist/esm/icons/minimize-2.js"() {
    init_createLucideIcon();
    __iconNode7 = [
      ["path", { d: "m14 10 7-7", key: "oa77jy" }],
      ["path", { d: "M20 10h-6V4", key: "mjg0md" }],
      ["path", { d: "m3 21 7-7", key: "tjx5ai" }],
      ["path", { d: "M4 14h6v6", key: "rmj7iw" }]
    ];
    Minimize2 = createLucideIcon("minimize-2", __iconNode7);
  }
});

// node_modules/lucide-react/dist/esm/icons/radio.js
var __iconNode8, Radio;
var init_radio = __esm({
  "node_modules/lucide-react/dist/esm/icons/radio.js"() {
    init_createLucideIcon();
    __iconNode8 = [
      ["path", { d: "M16.247 7.761a6 6 0 0 1 0 8.478", key: "1fwjs5" }],
      ["path", { d: "M19.075 4.933a10 10 0 0 1 0 14.134", key: "ehdyv1" }],
      ["path", { d: "M4.925 19.067a10 10 0 0 1 0-14.134", key: "1q22gi" }],
      ["path", { d: "M7.753 16.239a6 6 0 0 1 0-8.478", key: "r2q7qm" }],
      ["circle", { cx: "12", cy: "12", r: "2", key: "1c9p78" }]
    ];
    Radio = createLucideIcon("radio", __iconNode8);
  }
});

// node_modules/lucide-react/dist/esm/icons/settings.js
var __iconNode9, Settings;
var init_settings = __esm({
  "node_modules/lucide-react/dist/esm/icons/settings.js"() {
    init_createLucideIcon();
    __iconNode9 = [
      [
        "path",
        {
          d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
          key: "1i5ecw"
        }
      ],
      ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }]
    ];
    Settings = createLucideIcon("settings", __iconNode9);
  }
});

// node_modules/lucide-react/dist/esm/icons/zap.js
var __iconNode10, Zap;
var init_zap = __esm({
  "node_modules/lucide-react/dist/esm/icons/zap.js"() {
    init_createLucideIcon();
    __iconNode10 = [
      [
        "path",
        {
          d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
          key: "1xq2db"
        }
      ]
    ];
    Zap = createLucideIcon("zap", __iconNode10);
  }
});

// node_modules/lucide-react/dist/esm/lucide-react.js
var init_lucide_react = __esm({
  "node_modules/lucide-react/dist/esm/lucide-react.js"() {
    init_chart_column();
    init_circle_alert();
    init_circle_question_mark();
    init_activity();
    init_gauge();
    init_maximize_2();
    init_minimize_2();
    init_radio();
    init_settings();
    init_zap();
  }
});

// packages/plugins/resource-tracking/src/frontend/ResourceTrackingPage.module.css
var ResourceTrackingPage_default;
var init_ResourceTrackingPage = __esm({
  "packages/plugins/resource-tracking/src/frontend/ResourceTrackingPage.module.css"() {
    ResourceTrackingPage_default = {};
  }
});

// packages/plugins/resource-tracking/src/frontend/ResourceDelegationsCard.tsx
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
var ResourceDelegationsCardComponent, ResourceDelegationsCard;
var init_ResourceDelegationsCard = __esm({
  "packages/plugins/resource-tracking/src/frontend/ResourceDelegationsCard.tsx"() {
    "use strict";
    "use client";
    init_lucide_react();
    init_ResourceTrackingPage();
    ResourceDelegationsCardComponent = ({
      context,
      period,
      setPeriod,
      chartSeries,
      timeRange,
      yAxisMin,
      yAxisMax,
      showEnergyDelegated,
      setShowEnergyDelegated,
      showEnergyReclaimed,
      setShowEnergyReclaimed,
      showNetEnergy,
      setShowNetEnergy,
      showBandwidthDelegated,
      setShowBandwidthDelegated,
      showBandwidthReclaimed,
      setShowBandwidthReclaimed,
      showNetBandwidth,
      setShowNetBandwidth,
      loading,
      error,
      onRetry
    }) => {
      const { charts, ui } = context;
      const Card = ui.Card;
      return /* @__PURE__ */ jsxs(Card, { elevated: true, className: ResourceTrackingPage_default.container, children: [
        /* @__PURE__ */ jsxs("div", { className: ResourceTrackingPage_default.cardHeader, children: [
          /* @__PURE__ */ jsxs("h2", { className: ResourceTrackingPage_default.cardTitle, children: [
            /* @__PURE__ */ jsx(Zap, { size: 24, style: { display: "inline-block", marginRight: "0.5rem", verticalAlign: "middle" } }),
            "Resource Delegations"
          ] }),
          /* @__PURE__ */ jsxs("p", { className: ResourceTrackingPage_default.cardSubtitle, children: [
            "Monitor TRON resource delegation and reclaim patterns (millions of TRX equivalence)",
            /* @__PURE__ */ jsx(
              "span",
              {
                className: ResourceTrackingPage_default.helpIcon,
                role: "img",
                "aria-label": "Information",
                title: "Values shown are not raw energy values but the equivalent TRX staked to obtain such energy",
                children: /* @__PURE__ */ jsx(
                  CircleQuestionMark,
                  {
                    size: 16,
                    style: {
                      display: "inline-block",
                      marginLeft: "0.35rem",
                      verticalAlign: "middle",
                      cursor: "help",
                      opacity: 0.7
                    }
                  }
                )
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: ResourceTrackingPage_default.controls, children: [
          /* @__PURE__ */ jsx("div", { className: ResourceTrackingPage_default.controlRow, children: /* @__PURE__ */ jsxs("div", { className: ResourceTrackingPage_default.buttonGroup, children: [
            /* @__PURE__ */ jsx(
              "button",
              {
                className: `${ResourceTrackingPage_default.periodButton} ${period === "1d" ? ResourceTrackingPage_default["periodButton--active"] : ""}`,
                onClick: () => setPeriod("1d"),
                "aria-label": "Show data for 1 day",
                "aria-pressed": period === "1d",
                children: "1 Day"
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                className: `${ResourceTrackingPage_default.periodButton} ${period === "7d" ? ResourceTrackingPage_default["periodButton--active"] : ""}`,
                onClick: () => setPeriod("7d"),
                "aria-label": "Show data for 7 days",
                "aria-pressed": period === "7d",
                children: "7 Days"
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                className: `${ResourceTrackingPage_default.periodButton} ${period === "30d" ? ResourceTrackingPage_default["periodButton--active"] : ""}`,
                onClick: () => setPeriod("30d"),
                "aria-label": "Show data for 30 days",
                "aria-pressed": period === "30d",
                children: "30 Days"
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                className: `${ResourceTrackingPage_default.periodButton} ${period === "6m" ? ResourceTrackingPage_default["periodButton--active"] : ""}`,
                onClick: () => setPeriod("6m"),
                "aria-label": "Show data for 6 months",
                "aria-pressed": period === "6m",
                children: "6 Months"
              }
            )
          ] }) }),
          /* @__PURE__ */ jsx("div", { className: ResourceTrackingPage_default.controlRow, children: /* @__PURE__ */ jsxs("div", { className: ResourceTrackingPage_default.toggleGroup, children: [
            /* @__PURE__ */ jsxs("label", { className: ResourceTrackingPage_default.toggle, children: [
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "checkbox",
                  checked: showEnergyDelegated,
                  onChange: (e) => setShowEnergyDelegated(e.target.checked),
                  "aria-label": "Toggle Energy Delegated line visibility"
                }
              ),
              /* @__PURE__ */ jsxs("span", { className: `${ResourceTrackingPage_default.toggleLabel} ${ResourceTrackingPage_default.toggleLabelEnergyDelegated}`, children: [
                /* @__PURE__ */ jsx(Zap, { size: 14, style: { display: "inline-block", marginRight: "0.25rem", verticalAlign: "middle" } }),
                "Delegated"
              ] })
            ] }),
            /* @__PURE__ */ jsxs("label", { className: ResourceTrackingPage_default.toggle, children: [
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "checkbox",
                  checked: showEnergyReclaimed,
                  onChange: (e) => setShowEnergyReclaimed(e.target.checked),
                  "aria-label": "Toggle Energy Reclaimed line visibility"
                }
              ),
              /* @__PURE__ */ jsxs("span", { className: `${ResourceTrackingPage_default.toggleLabel} ${ResourceTrackingPage_default.toggleLabelEnergyReclaimed}`, children: [
                /* @__PURE__ */ jsx(Zap, { size: 14, style: { display: "inline-block", marginRight: "0.25rem", verticalAlign: "middle" } }),
                "Reclaimed"
              ] })
            ] }),
            /* @__PURE__ */ jsxs("label", { className: ResourceTrackingPage_default.toggle, children: [
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "checkbox",
                  checked: showNetEnergy,
                  onChange: (e) => setShowNetEnergy(e.target.checked),
                  "aria-label": "Toggle Net Energy line visibility"
                }
              ),
              /* @__PURE__ */ jsxs("span", { className: `${ResourceTrackingPage_default.toggleLabel} ${ResourceTrackingPage_default.toggleLabelNetEnergy}`, children: [
                /* @__PURE__ */ jsx(Zap, { size: 14, style: { display: "inline-block", marginRight: "0.25rem", verticalAlign: "middle" } }),
                "Net"
              ] })
            ] }),
            /* @__PURE__ */ jsxs("label", { className: ResourceTrackingPage_default.toggle, children: [
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "checkbox",
                  checked: showBandwidthDelegated,
                  onChange: (e) => setShowBandwidthDelegated(e.target.checked),
                  "aria-label": "Toggle Bandwidth Delegated line visibility"
                }
              ),
              /* @__PURE__ */ jsxs("span", { className: `${ResourceTrackingPage_default.toggleLabel} ${ResourceTrackingPage_default.toggleLabelBandwidthDelegated}`, children: [
                /* @__PURE__ */ jsx(Gauge, { size: 14, style: { display: "inline-block", marginRight: "0.25rem", verticalAlign: "middle" } }),
                "Delegated"
              ] })
            ] }),
            /* @__PURE__ */ jsxs("label", { className: ResourceTrackingPage_default.toggle, children: [
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "checkbox",
                  checked: showBandwidthReclaimed,
                  onChange: (e) => setShowBandwidthReclaimed(e.target.checked),
                  "aria-label": "Toggle Bandwidth Reclaimed line visibility"
                }
              ),
              /* @__PURE__ */ jsxs("span", { className: `${ResourceTrackingPage_default.toggleLabel} ${ResourceTrackingPage_default.toggleLabelBandwidthReclaimed}`, children: [
                /* @__PURE__ */ jsx(Gauge, { size: 14, style: { display: "inline-block", marginRight: "0.25rem", verticalAlign: "middle" } }),
                "Reclaimed"
              ] })
            ] }),
            /* @__PURE__ */ jsxs("label", { className: ResourceTrackingPage_default.toggle, children: [
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "checkbox",
                  checked: showNetBandwidth,
                  onChange: (e) => setShowNetBandwidth(e.target.checked),
                  "aria-label": "Toggle Net Bandwidth line visibility"
                }
              ),
              /* @__PURE__ */ jsxs("span", { className: `${ResourceTrackingPage_default.toggleLabel} ${ResourceTrackingPage_default.toggleLabelNetBandwidth}`, children: [
                /* @__PURE__ */ jsx(Gauge, { size: 14, style: { display: "inline-block", marginRight: "0.25rem", verticalAlign: "middle" } }),
                "Net"
              ] })
            ] })
          ] }) })
        ] }),
        /* @__PURE__ */ jsx("div", { className: ResourceTrackingPage_default.chartContainer, children: loading ? /* @__PURE__ */ jsx("div", { className: ResourceTrackingPage_default.skeletonLoader, style: { height: "400px" } }) : error ? /* @__PURE__ */ jsxs("div", { className: ResourceTrackingPage_default.errorContainer, children: [
          /* @__PURE__ */ jsx(CircleAlert, { size: 48, color: "var(--color-danger, #ef4444)" }),
          /* @__PURE__ */ jsx("p", { className: ResourceTrackingPage_default.errorText, children: error }),
          /* @__PURE__ */ jsx("button", { className: "btn btn--secondary", onClick: onRetry, children: "Retry" })
        ] }) : chartSeries.length > 0 ? /* @__PURE__ */ jsx(
          charts.LineChart,
          {
            series: chartSeries,
            height: 400,
            yAxisFormatter: (value) => `${Math.round(value).toLocaleString()}`,
            xAxisFormatter: (date) => {
              const dateStr = date.toLocaleDateString();
              const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
              return `${dateStr} ${timeStr}`;
            },
            minDate: timeRange.minDate,
            maxDate: timeRange.maxDate,
            yAxisMin,
            yAxisMax
          }
        ) : /* @__PURE__ */ jsxs("div", { className: ResourceTrackingPage_default.noData, children: [
          /* @__PURE__ */ jsx(ChartColumn, { size: 64, style: { opacity: 0.3, marginBottom: "var(--spacing-md)" } }),
          /* @__PURE__ */ jsx("p", { children: "No data available or all lines are hidden" }),
          /* @__PURE__ */ jsx("p", { className: ResourceTrackingPage_default.noDataHint, children: "Select at least one line to display the chart" })
        ] }) })
      ] });
    };
    ResourceDelegationsCard = memo(ResourceDelegationsCardComponent);
  }
});

// packages/plugins/resource-tracking/src/frontend/components/RecentWhaleDelegations.module.css
var RecentWhaleDelegations_default;
var init_RecentWhaleDelegations = __esm({
  "packages/plugins/resource-tracking/src/frontend/components/RecentWhaleDelegations.module.css"() {
    RecentWhaleDelegations_default = {};
  }
});

// packages/plugins/resource-tracking/src/frontend/components/RecentWhaleDelegations.tsx
import { useEffect, useState } from "react";
import { Fragment, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function getRuntimeConfig() {
  if (typeof window === "undefined") {
    throw new Error("getRuntimeConfig can only be called client-side");
  }
  return window.__RUNTIME_CONFIG__ || {
    chainParameters: {
      energyPerTrx: 5625,
      energyFee: 100,
      bandwidthPerTrx: 1e3
    }
  };
}
function RecentWhaleDelegations({
  context,
  limit = 10,
  whaleDetectionEnabled = true,
  onRefresh,
  defaultCompact = false
}) {
  const { ui, api } = context;
  const [whales, setWhales] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [compactMode, setCompactMode] = useState(defaultCompact);
  async function loadWhales() {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get("/plugins/resource-tracking/whales/recent", { limit });
      setWhales(response.whales || []);
      if (onRefresh) {
        onRefresh();
      }
    } catch (err) {
      console.error("Failed to load whale delegations:", err);
      setError("Failed to load whale delegations");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadWhales();
  }, [api, limit]);
  useEffect(() => {
    const intervalId = setInterval(() => {
      void loadWhales();
    }, 6e4);
    return () => clearInterval(intervalId);
  }, [api, limit]);
  function formatTimestampFull(isoString) {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}/${month}/${day} ${hours}:${minutes}`;
  }
  function formatTimestampShort(isoString) {
    const date = new Date(isoString);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${month}/${day} ${hours}:${minutes}`;
  }
  function formatTrx(amount) {
    return amount.toLocaleString();
  }
  function getResourceTypeName(resourceType) {
    return resourceType === 1 ? "Energy" : "Bandwidth";
  }
  function truncateAddress(address) {
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
  function formatNumberAbbreviated(num) {
    if (num >= 1e9) {
      return (num / 1e9).toFixed(1) + "B";
    }
    if (num >= 1e6) {
      return (num / 1e6).toFixed(1) + "M";
    }
    if (num >= 1e3) {
      return (num / 1e3).toFixed(1) + "K";
    }
    return num.toString();
  }
  return /* @__PURE__ */ jsxs2(ui.Card, { padding: compactMode ? "md" : "lg", className: `${RecentWhaleDelegations_default.container} ${compactMode ? RecentWhaleDelegations_default.compact : ""}`, children: [
    /* @__PURE__ */ jsxs2("div", { className: RecentWhaleDelegations_default.header, children: [
      /* @__PURE__ */ jsxs2("div", { className: RecentWhaleDelegations_default.header_top, children: [
        /* @__PURE__ */ jsx2("h3", { className: RecentWhaleDelegations_default.title, children: "Recent Whale Delegations" }),
        /* @__PURE__ */ jsx2(
          ui.Button,
          {
            variant: "ghost",
            size: "sm",
            onClick: () => setCompactMode(!compactMode),
            icon: compactMode ? /* @__PURE__ */ jsx2(Maximize2, { size: 16 }) : /* @__PURE__ */ jsx2(Minimize2, { size: 16 }),
            "aria-label": compactMode ? "Expand view" : "Compact view",
            children: compactMode ? "Expand" : "Compact"
          }
        )
      ] }),
      /* @__PURE__ */ jsx2("p", { className: RecentWhaleDelegations_default.description, children: "High-value resource delegations that exceeded the configured threshold. Reveals institutional activity and large-scale energy rental operations." })
    ] }),
    loading && /* @__PURE__ */ jsx2("div", { className: RecentWhaleDelegations_default.loading, children: /* @__PURE__ */ jsx2("p", { children: "Loading whale delegations..." }) }),
    error && /* @__PURE__ */ jsxs2("div", { className: RecentWhaleDelegations_default.error, children: [
      /* @__PURE__ */ jsx2(CircleAlert, { size: 20, className: RecentWhaleDelegations_default.error_icon }),
      /* @__PURE__ */ jsx2("p", { className: RecentWhaleDelegations_default.error_text, children: error }),
      /* @__PURE__ */ jsx2(ui.Button, { onClick: () => void loadWhales(), children: "Retry" })
    ] }),
    !loading && !error && whales.length === 0 && /* @__PURE__ */ jsxs2("div", { className: RecentWhaleDelegations_default.empty, children: [
      /* @__PURE__ */ jsx2("p", { className: RecentWhaleDelegations_default.empty_text, children: "No whale delegations detected yet." }),
      /* @__PURE__ */ jsx2("p", { className: RecentWhaleDelegations_default.empty_hint, children: whaleDetectionEnabled ? "Whale delegations will appear here when transactions exceed the threshold." : "Enable whale detection to start tracking high-value delegations." })
    ] }),
    !loading && !error && whales.length > 0 && /* @__PURE__ */ jsx2("div", { className: RecentWhaleDelegations_default.table_wrapper, children: /* @__PURE__ */ jsxs2("table", { className: RecentWhaleDelegations_default.table, children: [
      /* @__PURE__ */ jsx2("thead", { children: /* @__PURE__ */ jsxs2("tr", { children: [
        /* @__PURE__ */ jsx2("th", { children: "Time" }),
        /* @__PURE__ */ jsx2("th", { children: "From" }),
        /* @__PURE__ */ jsx2("th", { children: "To" }),
        /* @__PURE__ */ jsx2("th", { children: "Type" }),
        /* @__PURE__ */ jsx2("th", { children: "Amount" }),
        /* @__PURE__ */ jsx2("th", { className: RecentWhaleDelegations_default.block_column, children: "Block" })
      ] }) }),
      /* @__PURE__ */ jsx2("tbody", { children: whales.map((whale) => /* @__PURE__ */ jsxs2("tr", { children: [
        /* @__PURE__ */ jsxs2("td", { children: [
          /* @__PURE__ */ jsx2("span", { className: RecentWhaleDelegations_default.time_full, children: formatTimestampFull(whale.timestamp) }),
          /* @__PURE__ */ jsx2("span", { className: RecentWhaleDelegations_default.time_mobile, children: formatTimestampShort(whale.timestamp) })
        ] }),
        /* @__PURE__ */ jsx2("td", { title: whale.fromAddress, children: truncateAddress(whale.fromAddress) }),
        /* @__PURE__ */ jsx2("td", { title: whale.toAddress, children: truncateAddress(whale.toAddress) }),
        /* @__PURE__ */ jsx2("td", { children: /* @__PURE__ */ jsxs2(
          "span",
          {
            className: whale.resourceType === 1 ? RecentWhaleDelegations_default.badge_energy : RecentWhaleDelegations_default.badge_bandwidth,
            title: getResourceTypeName(whale.resourceType),
            children: [
              /* @__PURE__ */ jsx2("span", { className: RecentWhaleDelegations_default.type_icon, "aria-label": getResourceTypeName(whale.resourceType), children: whale.resourceType === 1 ? /* @__PURE__ */ jsx2(Zap, { size: 16 }) : /* @__PURE__ */ jsx2(Radio, { size: 16 }) }),
              /* @__PURE__ */ jsx2("span", { className: RecentWhaleDelegations_default.type_text, children: getResourceTypeName(whale.resourceType) })
            ]
          }
        ) }),
        /* @__PURE__ */ jsxs2("td", { className: RecentWhaleDelegations_default.amount_cell, children: [
          /* @__PURE__ */ jsxs2("div", { className: RecentWhaleDelegations_default.amount_full, children: [
            /* @__PURE__ */ jsxs2("div", { className: RecentWhaleDelegations_default.amount_primary, children: [
              formatTrx(whale.amountTrx),
              " TRX"
            ] }),
            /* @__PURE__ */ jsx2("div", { className: RecentWhaleDelegations_default.amount_secondary, children: (() => {
              try {
                const config = getRuntimeConfig();
                const energyPerTrx = config.chainParameters?.energyPerTrx || 5625;
                const bandwidthPerTrx = config.chainParameters?.bandwidthPerTrx || 1e3;
                const ratio = whale.resourceType === 1 ? energyPerTrx : bandwidthPerTrx;
                const nominalAmount = Math.floor(whale.amountTrx * ratio);
                const resourceName = getResourceTypeName(whale.resourceType);
                return `~${formatNumberAbbreviated(nominalAmount)} ${resourceName}`;
              } catch {
                return "";
              }
            })() })
          ] }),
          /* @__PURE__ */ jsxs2("div", { className: RecentWhaleDelegations_default.amount_mobile, children: [
            /* @__PURE__ */ jsxs2("div", { className: RecentWhaleDelegations_default.amount_primary, children: [
              formatNumberAbbreviated(whale.amountTrx),
              " TRX"
            ] }),
            /* @__PURE__ */ jsx2("div", { className: RecentWhaleDelegations_default.amount_secondary, children: (() => {
              try {
                const config = getRuntimeConfig();
                const energyPerTrx = config.chainParameters?.energyPerTrx || 5625;
                const bandwidthPerTrx = config.chainParameters?.bandwidthPerTrx || 1e3;
                const ratio = whale.resourceType === 1 ? energyPerTrx : bandwidthPerTrx;
                const nominalAmount = Math.floor(whale.amountTrx * ratio);
                return /* @__PURE__ */ jsxs2(Fragment, { children: [
                  "~",
                  formatNumberAbbreviated(nominalAmount),
                  " ",
                  whale.resourceType === 1 ? /* @__PURE__ */ jsx2(Zap, { size: 12 }) : /* @__PURE__ */ jsx2(Radio, { size: 12 })
                ] });
              } catch {
                return "";
              }
            })() })
          ] })
        ] }),
        /* @__PURE__ */ jsx2("td", { className: RecentWhaleDelegations_default.block_column, children: whale.blockNumber.toLocaleString() })
      ] }, whale.txId)) })
    ] }) })
  ] });
}
var init_RecentWhaleDelegations2 = __esm({
  "packages/plugins/resource-tracking/src/frontend/components/RecentWhaleDelegations.tsx"() {
    "use strict";
    "use client";
    init_lucide_react();
    init_RecentWhaleDelegations();
  }
});

// packages/plugins/resource-tracking/src/frontend/ResourceTrackingPage.tsx
var ResourceTrackingPage_exports = {};
__export(ResourceTrackingPage_exports, {
  ResourceTrackingPage: () => ResourceTrackingPage
});
import { useEffect as useEffect2, useState as useState2, useMemo } from "react";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function ResourceTrackingPage({ context }) {
  const { api, ui } = context;
  const [data, setData] = useState2([]);
  const [loading, setLoading] = useState2(true);
  const [error, setError] = useState2(null);
  const [period, setPeriod] = useState2("1d");
  const [showEnergyDelegated, setShowEnergyDelegated] = useState2(true);
  const [showEnergyReclaimed, setShowEnergyReclaimed] = useState2(false);
  const [showNetEnergy, setShowNetEnergy] = useState2(false);
  const [showBandwidthDelegated, setShowBandwidthDelegated] = useState2(false);
  const [showBandwidthReclaimed, setShowBandwidthReclaimed] = useState2(false);
  const [showNetBandwidth, setShowNetBandwidth] = useState2(false);
  const timeRange = useMemo(() => {
    const now = /* @__PURE__ */ new Date();
    const periodMap = {
      "1d": 1,
      "7d": 7,
      "30d": 30,
      "6m": 180
    };
    const days = periodMap[period];
    const minDate = /* @__PURE__ */ new Date();
    minDate.setDate(minDate.getDate() - days);
    return { minDate, maxDate: now };
  }, [period]);
  async function loadData(showLoading = true) {
    if (showLoading) {
      setLoading(true);
    }
    setError(null);
    try {
      const response = await api.get("/plugins/resource-tracking/summations", {
        period,
        points: 288
        // Request fixed 288-point sampling from backend
      });
      setData(response.data || []);
    } catch (err) {
      console.error("Failed to load resource tracking data:", err);
      setError("Failed to load resource tracking data");
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }
  function mergeData(freshData) {
    setData((prevData) => {
      if (prevData.length === 0) {
        return freshData;
      }
      const nonNullPrevData = prevData.filter((p) => p !== null);
      if (nonNullPrevData.length === 0) {
        return freshData;
      }
      const latestTimestamp = new Date(nonNullPrevData[nonNullPrevData.length - 1].timestamp).getTime();
      const newPoints = freshData.filter((point) => {
        if (point === null) {
          return true;
        }
        const pointTimestamp = new Date(point.timestamp).getTime();
        return pointTimestamp > latestTimestamp;
      });
      if (newPoints.length === 0) {
        return prevData;
      }
      console.log(`Merging ${newPoints.length} new points into chart (${prevData.length} existing)`);
      return [...prevData, ...newPoints];
    });
  }
  useEffect2(() => {
    setData([]);
    void loadData();
  }, [api, period]);
  useEffect2(() => {
    const { websocket } = context;
    const handleSummationCreated = async (payload) => {
      console.log("New summation created:", payload);
      try {
        const response = await api.get("/plugins/resource-tracking/summations", {
          period,
          points: 288
        });
        if (response.data) {
          mergeData(response.data);
        }
      } catch (err) {
        console.error("Failed to fetch fresh data after summation event:", err);
      }
    };
    const handleSubscribed = (data2) => {
      console.log("Subscribed to resource tracking updates:", data2);
    };
    const handleSubscriptionError = (error2) => {
      console.error("Failed to subscribe to resource tracking updates:", error2);
    };
    const handleReconnect = () => {
      console.log("WebSocket reconnected, resubscribing to summation updates");
      websocket.subscribe("summation-updates");
    };
    websocket.on("summation-created", handleSummationCreated);
    websocket.onConnect(handleReconnect);
    console.log("\u{1F4E1} Listening for summation-created events");
    websocket.subscribe("summation-updates");
    return () => {
      websocket.off("summation-created", handleSummationCreated);
      websocket.offConnect(handleReconnect);
    };
  }, [context.websocket]);
  const hasZeroCrossingMetrics = showNetEnergy || showNetBandwidth || showEnergyReclaimed || showBandwidthReclaimed;
  let yAxisMin;
  let yAxisMax;
  if (data.length > 0) {
    if (!hasZeroCrossingMetrics) {
      yAxisMin = 0;
      yAxisMax = void 0;
    } else {
      const allValues = [];
      const nonNullData = data.filter((p) => p !== null);
      if (showEnergyDelegated) allValues.push(...nonNullData.map((p) => p.energyDelegated));
      if (showEnergyReclaimed) allValues.push(...nonNullData.map((p) => -p.energyReclaimed));
      if (showNetEnergy) allValues.push(...nonNullData.map((p) => p.netEnergy));
      if (showBandwidthDelegated) allValues.push(...nonNullData.map((p) => p.bandwidthDelegated));
      if (showBandwidthReclaimed) allValues.push(...nonNullData.map((p) => -p.bandwidthReclaimed));
      if (showNetBandwidth) allValues.push(...nonNullData.map((p) => p.netBandwidth));
      if (allValues.length > 0) {
        const dataMin = Math.min(...allValues);
        const dataMax = Math.max(...allValues);
        const maxAbsValue = Math.max(Math.abs(dataMin), Math.abs(dataMax));
        const paddedMax = maxAbsValue * 1.1;
        yAxisMin = -paddedMax;
        yAxisMax = paddedMax;
      }
    }
  }
  const chartSeries = [];
  if (showEnergyDelegated && data.length > 0) {
    chartSeries.push({
      id: "energy-delegated",
      label: "Energy Delegated",
      data: data.filter((point) => point !== null).map((point) => ({
        date: point.timestamp,
        value: point.energyDelegated,
        // Already in millions of TRX from API
        metadata: {
          transactions: point.transactionCount,
          blockRange: `${point.startBlock.toLocaleString()} - ${point.endBlock.toLocaleString()}`
        }
      })),
      color: CHART_COLORS.energyDelegated,
      fill: true
    });
  }
  if (showEnergyReclaimed && data.length > 0) {
    chartSeries.push({
      id: "energy-reclaimed",
      label: "Energy Reclaimed",
      data: data.filter((point) => point !== null).map((point) => ({
        date: point.timestamp,
        value: -point.energyReclaimed,
        // Negated to display below zero line
        metadata: {
          transactions: point.transactionCount,
          blockRange: `${point.startBlock.toLocaleString()} - ${point.endBlock.toLocaleString()}`
        }
      })),
      color: CHART_COLORS.energyReclaimed,
      fill: true
    });
  }
  if (showNetEnergy && data.length > 0) {
    chartSeries.push({
      id: "net-energy",
      label: "Net Energy",
      data: data.filter((point) => point !== null).map((point) => ({
        date: point.timestamp,
        value: point.netEnergy,
        // Already in millions of TRX from API
        metadata: {
          transactions: point.transactionCount,
          blockRange: `${point.startBlock.toLocaleString()} - ${point.endBlock.toLocaleString()}`
        }
      })),
      color: CHART_COLORS.netEnergy,
      fill: true
    });
  }
  if (showBandwidthDelegated && data.length > 0) {
    chartSeries.push({
      id: "bandwidth-delegated",
      label: "Bandwidth Delegated",
      data: data.filter((point) => point !== null).map((point) => ({
        date: point.timestamp,
        value: point.bandwidthDelegated,
        // Already in millions of TRX from API
        metadata: {
          transactions: point.transactionCount,
          blockRange: `${point.startBlock.toLocaleString()} - ${point.endBlock.toLocaleString()}`
        }
      })),
      color: CHART_COLORS.bandwidthDelegated,
      fill: true
    });
  }
  if (showBandwidthReclaimed && data.length > 0) {
    chartSeries.push({
      id: "bandwidth-reclaimed",
      label: "Bandwidth Reclaimed",
      data: data.filter((point) => point !== null).map((point) => ({
        date: point.timestamp,
        value: -point.bandwidthReclaimed,
        // Negated to display below zero line
        metadata: {
          transactions: point.transactionCount,
          blockRange: `${point.startBlock.toLocaleString()} - ${point.endBlock.toLocaleString()}`
        }
      })),
      color: CHART_COLORS.bandwidthReclaimed,
      fill: true
    });
  }
  if (showNetBandwidth && data.length > 0) {
    chartSeries.push({
      id: "net-bandwidth",
      label: "Net Bandwidth",
      data: data.filter((point) => point !== null).map((point) => ({
        date: point.timestamp,
        value: point.netBandwidth,
        // Already in millions of TRX from API
        metadata: {
          transactions: point.transactionCount,
          blockRange: `${point.startBlock.toLocaleString()} - ${point.endBlock.toLocaleString()}`
        }
      })),
      color: CHART_COLORS.netBandwidth,
      fill: true
    });
  }
  return /* @__PURE__ */ jsxs3("main", { className: ResourceTrackingPage_default.page, children: [
    /* @__PURE__ */ jsxs3("header", { className: ResourceTrackingPage_default.header, children: [
      /* @__PURE__ */ jsxs3("h1", { className: ResourceTrackingPage_default.title, children: [
        /* @__PURE__ */ jsx3(Activity, { size: 28, style: { display: "inline-block", marginRight: "0.5rem", verticalAlign: "middle" } }),
        "TRON Resource Explorer"
      ] }),
      /* @__PURE__ */ jsxs3("div", { className: ResourceTrackingPage_default.subtitle, children: [
        /* @__PURE__ */ jsx3("p", { className: ResourceTrackingPage_default.subtitleShort, children: "Visualize TRON network energy and bandwidth delegation patterns with real-time trend analysis." }),
        /* @__PURE__ */ jsx3("p", { className: ResourceTrackingPage_default.subtitleFull, children: "Monitor TRON energy and bandwidth delegation activity across the network. This dashboard tracks how users stake TRX to generate resources, delegate them to other addresses, and reclaim them over time. View network-wide patterns showing resource flows, net changes, and transaction volume trends. All values displayed in TRX equivalence based on staking amounts." })
      ] })
    ] }),
    /* @__PURE__ */ jsxs3("div", { className: ResourceTrackingPage_default.content_layout, children: [
      /* @__PURE__ */ jsx3("div", { className: ResourceTrackingPage_default.content_main, children: /* @__PURE__ */ jsx3(
        ResourceDelegationsCard,
        {
          context,
          period,
          setPeriod,
          chartSeries,
          timeRange,
          yAxisMin,
          yAxisMax,
          showEnergyDelegated,
          setShowEnergyDelegated,
          showEnergyReclaimed,
          setShowEnergyReclaimed,
          showNetEnergy,
          setShowNetEnergy,
          showBandwidthDelegated,
          setShowBandwidthDelegated,
          showBandwidthReclaimed,
          setShowBandwidthReclaimed,
          showNetBandwidth,
          setShowNetBandwidth,
          loading,
          error,
          onRetry: () => void loadData()
        }
      ) }),
      /* @__PURE__ */ jsx3("div", { className: ResourceTrackingPage_default.content_sidebar, children: /* @__PURE__ */ jsx3(
        RecentWhaleDelegations,
        {
          context,
          limit: 10,
          whaleDetectionEnabled: true,
          defaultCompact: true
        }
      ) })
    ] })
  ] });
}
var CHART_COLORS;
var init_ResourceTrackingPage2 = __esm({
  "packages/plugins/resource-tracking/src/frontend/ResourceTrackingPage.tsx"() {
    "use strict";
    "use client";
    init_lucide_react();
    init_ResourceTrackingPage();
    init_ResourceDelegationsCard();
    init_RecentWhaleDelegations2();
    CHART_COLORS = {
      energyDelegated: "#22c55e",
      energyReclaimed: "#ef4444",
      netEnergy: "#3b82f6",
      bandwidthDelegated: "#a855f7",
      bandwidthReclaimed: "#f97316",
      netBandwidth: "#06b6d4"
    };
  }
});

// packages/plugins/resource-tracking/src/frontend/ResourceTrackingSettingsPage.module.css
var ResourceTrackingSettingsPage_default;
var init_ResourceTrackingSettingsPage = __esm({
  "packages/plugins/resource-tracking/src/frontend/ResourceTrackingSettingsPage.module.css"() {
    ResourceTrackingSettingsPage_default = {};
  }
});

// packages/plugins/resource-tracking/src/frontend/tabs/SettingsTab.tsx
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
function SettingsTab({ context, settings, setSettings, onSave, saving }) {
  const { ui } = context;
  return /* @__PURE__ */ jsx4("div", { className: ResourceTrackingSettingsPage_default.formContainer, children: /* @__PURE__ */ jsxs4(
    "form",
    {
      className: ResourceTrackingSettingsPage_default.form,
      onSubmit: (e) => {
        e.preventDefault();
        onSave();
      },
      children: [
        /* @__PURE__ */ jsxs4("div", { className: ResourceTrackingSettingsPage_default.field, children: [
          /* @__PURE__ */ jsx4("label", { htmlFor: "detailsRetention", className: ResourceTrackingSettingsPage_default.label, children: "Details Retention (days)" }),
          /* @__PURE__ */ jsx4("p", { className: ResourceTrackingSettingsPage_default.description, children: "How long to keep individual delegation transaction details. Older records are automatically purged." }),
          /* @__PURE__ */ jsx4(
            ui.Input,
            {
              id: "detailsRetention",
              type: "number",
              min: 1,
              max: 365,
              value: settings.detailsRetentionDays.toString(),
              onChange: (e) => setSettings({ ...settings, detailsRetentionDays: parseInt(e.target.value, 10) }),
              required: true
            }
          )
        ] }),
        /* @__PURE__ */ jsxs4("div", { className: ResourceTrackingSettingsPage_default.field, children: [
          /* @__PURE__ */ jsx4("label", { htmlFor: "summationRetention", className: ResourceTrackingSettingsPage_default.label, children: "Summation Retention (months)" }),
          /* @__PURE__ */ jsx4("p", { className: ResourceTrackingSettingsPage_default.description, children: "How long to keep aggregated summation data for trend analysis. This affects the maximum time range available in charts." }),
          /* @__PURE__ */ jsx4(
            ui.Input,
            {
              id: "summationRetention",
              type: "number",
              min: 1,
              max: 24,
              value: settings.summationRetentionMonths.toString(),
              onChange: (e) => setSettings({ ...settings, summationRetentionMonths: parseInt(e.target.value, 10) }),
              required: true
            }
          )
        ] }),
        /* @__PURE__ */ jsxs4("div", { className: ResourceTrackingSettingsPage_default.field, children: [
          /* @__PURE__ */ jsx4("label", { htmlFor: "purgeFrequency", className: ResourceTrackingSettingsPage_default.label, children: "Purge Frequency (hours)" }),
          /* @__PURE__ */ jsx4("p", { className: ResourceTrackingSettingsPage_default.description, children: "How often the cleanup job runs to remove expired data. Changes take effect immediately upon saving." }),
          /* @__PURE__ */ jsx4(
            ui.Input,
            {
              id: "purgeFrequency",
              type: "number",
              min: 1,
              max: 24,
              value: settings.purgeFrequencyHours.toString(),
              onChange: (e) => setSettings({ ...settings, purgeFrequencyHours: parseInt(e.target.value, 10) }),
              required: true
            }
          )
        ] }),
        /* @__PURE__ */ jsxs4("div", { className: ResourceTrackingSettingsPage_default.field, children: [
          /* @__PURE__ */ jsx4("label", { htmlFor: "blocksPerInterval", className: ResourceTrackingSettingsPage_default.label, children: "Blocks Per Aggregation Interval" }),
          /* @__PURE__ */ jsx4("p", { className: ResourceTrackingSettingsPage_default.description, children: "Number of blocks to aggregate per summation period. Default is 100 blocks, which equals approximately 5 minutes at 20 blocks per minute. Changes take effect immediately for the next summation job run." }),
          /* @__PURE__ */ jsx4(
            ui.Input,
            {
              id: "blocksPerInterval",
              type: "number",
              min: 100,
              max: 1e3,
              value: settings.blocksPerInterval.toString(),
              onChange: (e) => setSettings({ ...settings, blocksPerInterval: parseInt(e.target.value, 10) }),
              required: true
            }
          )
        ] }),
        /* @__PURE__ */ jsx4("div", { className: ResourceTrackingSettingsPage_default.actions, children: /* @__PURE__ */ jsx4(
          ui.Button,
          {
            type: "submit",
            variant: "primary",
            disabled: saving,
            children: saving ? "Saving..." : "Save Settings"
          }
        ) })
      ]
    }
  ) });
}
var init_SettingsTab = __esm({
  "packages/plugins/resource-tracking/src/frontend/tabs/SettingsTab.tsx"() {
    "use strict";
    "use client";
    init_ResourceTrackingSettingsPage();
  }
});

// packages/plugins/resource-tracking/src/frontend/tabs/WhalesTab.tsx
import { Fragment as Fragment2, jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
function getRuntimeConfig2() {
  if (typeof window === "undefined") {
    throw new Error("getRuntimeConfig can only be called client-side");
  }
  return window.__RUNTIME_CONFIG__ || {
    chainParameters: {
      energyPerTrx: 5625,
      energyFee: 100,
      bandwidthPerTrx: 1e3
    }
  };
}
function WhalesTab({ context, settings, setSettings, onSave, saving }) {
  const { ui } = context;
  return /* @__PURE__ */ jsxs5(Fragment2, { children: [
    /* @__PURE__ */ jsx5("div", { className: ResourceTrackingSettingsPage_default.container, children: /* @__PURE__ */ jsxs5(
      "form",
      {
        className: ResourceTrackingSettingsPage_default.form,
        onSubmit: (e) => {
          e.preventDefault();
          onSave();
        },
        children: [
          /* @__PURE__ */ jsxs5("div", { className: ResourceTrackingSettingsPage_default.field, children: [
            /* @__PURE__ */ jsxs5("label", { htmlFor: "whaleDetectionEnabled", className: ResourceTrackingSettingsPage_default.label, children: [
              /* @__PURE__ */ jsx5(
                "input",
                {
                  id: "whaleDetectionEnabled",
                  type: "checkbox",
                  checked: settings.whaleDetectionEnabled ?? false,
                  onChange: (e) => setSettings({ ...settings, whaleDetectionEnabled: e.target.checked }),
                  style: { marginRight: "0.5rem" }
                }
              ),
              "Enable Whale Detection"
            ] }),
            /* @__PURE__ */ jsx5("p", { className: ResourceTrackingSettingsPage_default.description, children: "When enabled, high-value resource delegations that exceed the threshold will be tracked separately for market intelligence and pattern analysis." })
          ] }),
          /* @__PURE__ */ jsxs5("div", { className: ResourceTrackingSettingsPage_default.field, children: [
            /* @__PURE__ */ jsx5("label", { htmlFor: "whaleThreshold", className: ResourceTrackingSettingsPage_default.label, children: "Whale Threshold (TRX)" }),
            /* @__PURE__ */ jsx5("p", { className: ResourceTrackingSettingsPage_default.description, children: "Minimum delegation amount in TRX to qualify as a whale transaction. Applies to both energy and bandwidth delegations." }),
            /* @__PURE__ */ jsx5(
              ui.Input,
              {
                id: "whaleThreshold",
                type: "number",
                min: 1e5,
                max: 1e8,
                step: 1e5,
                value: settings.whaleThresholdTrx.toString(),
                onChange: (e) => setSettings({ ...settings, whaleThresholdTrx: parseInt(e.target.value, 10) }),
                required: true
              }
            ),
            /* @__PURE__ */ jsx5("div", { style: {
              marginTop: "0.5rem",
              fontSize: "0.875rem",
              color: "var(--color-text-secondary)",
              fontFamily: "var(--font-mono)"
            }, children: (() => {
              try {
                const config = getRuntimeConfig2();
                const energyPerTrx = config.chainParameters?.energyPerTrx || 5625;
                const bandwidthPerTrx = config.chainParameters?.bandwidthPerTrx || 1e3;
                const energyAmount = Math.floor(settings.whaleThresholdTrx * energyPerTrx);
                const bandwidthAmount = Math.floor(settings.whaleThresholdTrx * bandwidthPerTrx);
                return /* @__PURE__ */ jsxs5(Fragment2, { children: [
                  "\u2248 ",
                  energyAmount.toLocaleString(),
                  " Energy, \u2248 ",
                  bandwidthAmount.toLocaleString(),
                  " Bandwidth ",
                  /* @__PURE__ */ jsx5("span", { style: { fontSize: "0.75rem", fontStyle: "italic" }, children: "(Conversions based on current network parameters)" })
                ] });
              } catch {
                return /* @__PURE__ */ jsx5("span", { children: "..." });
              }
            })() })
          ] }),
          /* @__PURE__ */ jsx5("div", { className: ResourceTrackingSettingsPage_default.actions, children: /* @__PURE__ */ jsx5(
            ui.Button,
            {
              type: "submit",
              variant: "primary",
              disabled: saving,
              children: saving ? "Saving..." : "Save Whale Settings"
            }
          ) })
        ]
      }
    ) }),
    /* @__PURE__ */ jsx5("div", { className: ResourceTrackingSettingsPage_default.whaleSection, children: /* @__PURE__ */ jsx5(
      RecentWhaleDelegations,
      {
        context,
        limit: 10,
        whaleDetectionEnabled: settings.whaleDetectionEnabled
      }
    ) })
  ] });
}
var init_WhalesTab = __esm({
  "packages/plugins/resource-tracking/src/frontend/tabs/WhalesTab.tsx"() {
    "use strict";
    "use client";
    init_ResourceTrackingSettingsPage();
    init_RecentWhaleDelegations2();
  }
});

// packages/plugins/resource-tracking/src/frontend/tabs/index.ts
var init_tabs = __esm({
  "packages/plugins/resource-tracking/src/frontend/tabs/index.ts"() {
    "use strict";
    init_SettingsTab();
    init_WhalesTab();
  }
});

// packages/plugins/resource-tracking/src/frontend/ResourceTrackingSettingsPage.tsx
var ResourceTrackingSettingsPage_exports = {};
__export(ResourceTrackingSettingsPage_exports, {
  ResourceTrackingSettingsPage: () => ResourceTrackingSettingsPage
});
import { useEffect as useEffect3, useState as useState3 } from "react";
import { Fragment as Fragment3, jsx as jsx6, jsxs as jsxs6 } from "react/jsx-runtime";
function ResourceTrackingSettingsPage({ context }) {
  const { ui, api } = context;
  const [activeTab, setActiveTab] = useState3("settings");
  const [settings, setSettings] = useState3({
    detailsRetentionDays: 2,
    summationRetentionMonths: 6,
    purgeFrequencyHours: 1,
    blocksPerInterval: 100,
    whaleDetectionEnabled: false,
    whaleThresholdTrx: 1e6
  });
  const [loading, setLoading] = useState3(true);
  const [saving, setSaving] = useState3(false);
  const [clearingCache, setClearingCache] = useState3(false);
  const [message, setMessage] = useState3(null);
  useEffect3(() => {
    async function loadSettings() {
      try {
        const response = await api.get("/plugins/resource-tracking/settings");
        if (response.settings) {
          setSettings((currentSettings) => ({
            ...currentSettings,
            ...response.settings
          }));
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
        setMessage({ type: "error", text: "Failed to load settings" });
      } finally {
        setLoading(false);
      }
    }
    void loadSettings();
  }, [api]);
  useEffect3(() => {
    if (message?.type === "success") {
      const timer = setTimeout(() => {
        setMessage(null);
      }, 3e3);
      return () => clearTimeout(timer);
    }
    return void 0;
  }, [message]);
  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await api.post("/plugins/resource-tracking/settings", settings);
      if (response.success) {
        setMessage({ type: "success", text: "Settings saved successfully" });
        if (response.settings) {
          setSettings(response.settings);
        }
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      setMessage({ type: "error", text: "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  };
  const handleClearCache = async () => {
    setClearingCache(true);
    setMessage(null);
    try {
      const response = await api.post("/plugins/resource-tracking/system/cache/clear");
      if (response.success) {
        setMessage({
          type: "success",
          text: `Cache cleared successfully. ${response.keysCleared || 0} entries removed.`
        });
      }
    } catch (error) {
      console.error("Failed to clear cache:", error);
      setMessage({ type: "error", text: "Failed to clear cache" });
    } finally {
      setClearingCache(false);
    }
  };
  if (loading) {
    return /* @__PURE__ */ jsxs6("main", { className: ResourceTrackingSettingsPage_default.page, children: [
      /* @__PURE__ */ jsxs6("header", { className: ResourceTrackingSettingsPage_default.header, children: [
        /* @__PURE__ */ jsxs6("h1", { className: ResourceTrackingSettingsPage_default.title, children: [
          /* @__PURE__ */ jsx6(Settings, { size: 28, style: { display: "inline-block", marginRight: "0.5rem", verticalAlign: "middle" } }),
          "Resource Explorer Settings"
        ] }),
        /* @__PURE__ */ jsx6("p", { className: ResourceTrackingSettingsPage_default.subtitle, children: "Loading settings..." })
      ] }),
      /* @__PURE__ */ jsxs6("div", { className: `surface ${ResourceTrackingSettingsPage_default.container}`, children: [
        /* @__PURE__ */ jsx6("div", { className: ResourceTrackingSettingsPage_default.skeletonLoader, style: { height: "60px", marginBottom: "var(--spacing-md)" } }),
        /* @__PURE__ */ jsx6("div", { className: ResourceTrackingSettingsPage_default.skeletonLoader, style: { height: "60px", marginBottom: "var(--spacing-md)" } }),
        /* @__PURE__ */ jsx6("div", { className: ResourceTrackingSettingsPage_default.skeletonLoader, style: { height: "60px" } })
      ] })
    ] });
  }
  return /* @__PURE__ */ jsxs6("main", { className: ResourceTrackingSettingsPage_default.page, children: [
    /* @__PURE__ */ jsxs6("header", { className: ResourceTrackingSettingsPage_default.header, children: [
      /* @__PURE__ */ jsxs6("h1", { className: ResourceTrackingSettingsPage_default.title, children: [
        /* @__PURE__ */ jsx6(Settings, { size: 28, style: { display: "inline-block", marginRight: "0.5rem", verticalAlign: "middle" } }),
        "Resource Explorer Settings"
      ] }),
      /* @__PURE__ */ jsx6("p", { className: ResourceTrackingSettingsPage_default.subtitle, children: "Configure data retention policies, cleanup frequency, and whale detection" })
    ] }),
    /* @__PURE__ */ jsxs6("div", { className: ResourceTrackingSettingsPage_default.tabs, children: [
      /* @__PURE__ */ jsx6(
        "button",
        {
          className: `${ResourceTrackingSettingsPage_default.tab} ${activeTab === "settings" ? ResourceTrackingSettingsPage_default.tabActive : ""}`,
          onClick: () => setActiveTab("settings"),
          type: "button",
          children: "Settings"
        }
      ),
      /* @__PURE__ */ jsx6(
        "button",
        {
          className: `${ResourceTrackingSettingsPage_default.tab} ${activeTab === "whales" ? ResourceTrackingSettingsPage_default.tabActive : ""}`,
          onClick: () => setActiveTab("whales"),
          type: "button",
          children: "Whales"
        }
      )
    ] }),
    /* @__PURE__ */ jsxs6("div", { className: `surface ${ResourceTrackingSettingsPage_default.container}`, children: [
      message && /* @__PURE__ */ jsx6("div", { className: `${ResourceTrackingSettingsPage_default.message} ${message.type === "success" ? ResourceTrackingSettingsPage_default.messageSuccess : ResourceTrackingSettingsPage_default.messageError}`, children: message.text }),
      activeTab === "settings" && /* @__PURE__ */ jsxs6(Fragment3, { children: [
        /* @__PURE__ */ jsx6(
          SettingsTab,
          {
            context,
            settings,
            setSettings,
            onSave: handleSave,
            saving
          }
        ),
        /* @__PURE__ */ jsxs6("div", { className: ResourceTrackingSettingsPage_default.infoPanel, children: [
          /* @__PURE__ */ jsx6("h3", { className: ResourceTrackingSettingsPage_default.infoPanelTitle, children: "Cache Management" }),
          /* @__PURE__ */ jsx6("p", { className: ResourceTrackingSettingsPage_default.infoPanelText, children: 'Summation data is cached for 5 minutes to improve performance. Use the "Clear Summation Cache" button to force immediate data refresh after changing aggregation settings or when testing new data processing logic.' }),
          /* @__PURE__ */ jsx6("p", { className: ResourceTrackingSettingsPage_default.infoPanelText, children: /* @__PURE__ */ jsx6("strong", { children: "When to clear cache:" }) }),
          /* @__PURE__ */ jsxs6("ul", { className: ResourceTrackingSettingsPage_default.infoPanelList, children: [
            /* @__PURE__ */ jsx6("li", { children: 'After changing "Blocks Per Aggregation Interval"' }),
            /* @__PURE__ */ jsx6("li", { children: "When troubleshooting stale data issues" }),
            /* @__PURE__ */ jsx6("li", { children: "After manual database modifications" })
          ] }),
          /* @__PURE__ */ jsx6("div", { className: ResourceTrackingSettingsPage_default.infoPanelActions, children: /* @__PURE__ */ jsx6(
            ui.Button,
            {
              type: "button",
              variant: "secondary",
              onClick: handleClearCache,
              disabled: saving || clearingCache,
              children: clearingCache ? "Clearing Cache..." : "Clear Summation Cache"
            }
          ) })
        ] })
      ] }),
      activeTab === "whales" && /* @__PURE__ */ jsx6(
        WhalesTab,
        {
          context,
          settings,
          setSettings,
          onSave: handleSave,
          saving
        }
      )
    ] })
  ] });
}
var init_ResourceTrackingSettingsPage2 = __esm({
  "packages/plugins/resource-tracking/src/frontend/ResourceTrackingSettingsPage.tsx"() {
    "use strict";
    "use client";
    init_lucide_react();
    init_ResourceTrackingSettingsPage();
    init_tabs();
  }
});

// packages/plugins/resource-tracking/src/frontend/frontend.ts
var import_dynamic = __toESM(require_dynamic2(), 1);

// packages/types/dist/plugin/definePlugin.js
function definePlugin(plugin) {
  return plugin;
}

// packages/plugins/resource-tracking/src/manifest.ts
var resourceTrackingManifest = {
  id: "resource-tracking",
  title: "Resource Explorer",
  version: "1.0.0",
  description: "Track TRON resource delegation and reclaim patterns over time",
  author: "TronRelic",
  license: "MIT",
  backend: true,
  frontend: true,
  adminUrl: "/system/plugins/resource-tracking/settings"
};

// packages/plugins/resource-tracking/src/frontend/frontend.ts
var ResourceTrackingPage2 = (0, import_dynamic.default)(
  () => Promise.resolve().then(() => (init_ResourceTrackingPage2(), ResourceTrackingPage_exports)).then((m) => m.ResourceTrackingPage)
);
var ResourceTrackingSettingsPage2 = (0, import_dynamic.default)(
  () => Promise.resolve().then(() => (init_ResourceTrackingSettingsPage2(), ResourceTrackingSettingsPage_exports)).then((m) => m.ResourceTrackingSettingsPage)
);
var resourceTrackingFrontendPlugin = definePlugin({
  manifest: resourceTrackingManifest,
  // No background component needed (no real-time WebSocket features yet)
  component: void 0,
  // Register navigation menu items
  menuItems: [
    {
      label: "Resources",
      href: "/tron-resource-explorer",
      icon: "Activity",
      category: "analytics",
      order: 40
    }
  ],
  // Register main resource tracking pages
  pages: [
    {
      path: "/tron-resource-explorer",
      component: ResourceTrackingPage2,
      title: "Resource Explorer - TronRelic",
      description: "Monitor TRON energy and bandwidth delegation trends"
    }
  ],
  // Register admin settings page
  adminPages: [
    {
      path: "/system/plugins/resource-tracking/settings",
      component: ResourceTrackingSettingsPage2,
      title: "Resource Explorer Settings - TronRelic",
      description: "Configure data retention and purge frequency for resource tracking"
    }
  ]
});
export {
  resourceTrackingFrontendPlugin
};
/*! Bundled license information:

lucide-react/dist/esm/shared/src/utils.js:
lucide-react/dist/esm/defaultAttributes.js:
lucide-react/dist/esm/Icon.js:
lucide-react/dist/esm/createLucideIcon.js:
lucide-react/dist/esm/icons/activity.js:
lucide-react/dist/esm/icons/chart-column.js:
lucide-react/dist/esm/icons/circle-alert.js:
lucide-react/dist/esm/icons/circle-question-mark.js:
lucide-react/dist/esm/icons/gauge.js:
lucide-react/dist/esm/icons/maximize-2.js:
lucide-react/dist/esm/icons/minimize-2.js:
lucide-react/dist/esm/icons/radio.js:
lucide-react/dist/esm/icons/settings.js:
lucide-react/dist/esm/icons/zap.js:
lucide-react/dist/esm/lucide-react.js:
  (**
   * @license lucide-react v0.545.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
