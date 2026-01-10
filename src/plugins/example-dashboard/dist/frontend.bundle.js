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

// packages/plugins/example-dashboard/src/frontend/ExampleDashboardPage.tsx
var ExampleDashboardPage_exports = {};
__export(ExampleDashboardPage_exports, {
  ExampleDashboardPage: () => ExampleDashboardPage
});
import { jsx, jsxs } from "react/jsx-runtime";
function ExampleDashboardPage({ context: _context }) {
  return /* @__PURE__ */ jsx("div", { className: "container mx-auto px-4 py-8", children: /* @__PURE__ */ jsxs("div", { className: "max-w-4xl mx-auto", children: [
    /* @__PURE__ */ jsx("h1", { className: "text-4xl font-bold mb-4", children: "Example Dashboard" }),
    /* @__PURE__ */ jsx("p", { className: "text-lg text-muted-foreground mb-8", children: "This is a demonstration page provided by the Example Dashboard plugin. It shows how plugins can register their own pages and menu items." }),
    /* @__PURE__ */ jsxs("div", { className: "grid gap-6 md:grid-cols-2", children: [
      /* @__PURE__ */ jsxs("div", { className: "border rounded-lg p-6", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-2xl font-semibold mb-3", children: "Plugin Page Registration" }),
        /* @__PURE__ */ jsx("p", { className: "text-muted-foreground", children: "Plugins can register menu items that appear in the main navigation. Each menu item can have an icon, category, order, and access controls." })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "border rounded-lg p-6", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-2xl font-semibold mb-3", children: "Plugin Pages" }),
        /* @__PURE__ */ jsx("p", { className: "text-muted-foreground", children: "Plugins define pages with routes and React components. The system automatically handles routing without modifying core infrastructure." })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "border rounded-lg p-6", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-2xl font-semibold mb-3", children: "Dynamic Registration" }),
        /* @__PURE__ */ jsx("p", { className: "text-muted-foreground", children: "Pages and menu items are registered at runtime through the plugin manifest, keeping features self-contained and easy to enable/disable." })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "border rounded-lg p-6", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-2xl font-semibold mb-3", children: "Zero Core Changes" }),
        /* @__PURE__ */ jsx("p", { className: "text-muted-foreground", children: "Adding new features requires no changes to the core application. Everything lives in the plugin directory." })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "mt-8 p-6 bg-primary/10 rounded-lg", children: [
      /* @__PURE__ */ jsx("h3", { className: "text-xl font-semibold mb-2", children: "Try It Yourself" }),
      /* @__PURE__ */ jsxs("p", { className: "text-muted-foreground", children: [
        "Look at this plugin's source code in",
        " ",
        /* @__PURE__ */ jsx("code", { className: "bg-background px-2 py-1 rounded", children: "packages/plugins/example-dashboard" }),
        " ",
        "to see how it's implemented. Then create your own!"
      ] })
    ] })
  ] }) });
}
var init_ExampleDashboardPage = __esm({
  "packages/plugins/example-dashboard/src/frontend/ExampleDashboardPage.tsx"() {
    "use strict";
    "use client";
  }
});

// packages/plugins/example-dashboard/src/frontend/frontend.ts
var import_dynamic = __toESM(require_dynamic2(), 1);

// packages/types/dist/plugin/definePlugin.js
function definePlugin(plugin) {
  return plugin;
}

// packages/plugins/example-dashboard/src/manifest.ts
var exampleDashboardManifest = {
  id: "example-dashboard",
  title: "Example Dashboard",
  version: "0.1.0",
  description: "Demonstrates the plugin menu and page system with a sample dashboard.",
  author: "TronRelic Team",
  backend: false,
  frontend: true
};

// packages/plugins/example-dashboard/src/frontend/frontend.ts
var ExampleDashboardPage2 = (0, import_dynamic.default)(
  () => Promise.resolve().then(() => (init_ExampleDashboardPage(), ExampleDashboardPage_exports)).then((m) => m.ExampleDashboardPage)
);
var exampleDashboardFrontendPlugin = definePlugin({
  manifest: exampleDashboardManifest,
  menuItems: [
    {
      label: "Example",
      href: "/example-dashboard",
      icon: "Sparkles",
      order: 50,
      category: "plugins"
    }
  ],
  pages: [
    {
      path: "/example-dashboard",
      component: ExampleDashboardPage2,
      title: "Example Dashboard",
      description: "Demonstration of the plugin menu and page system"
    }
  ]
});
export {
  exampleDashboardFrontendPlugin
};
