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

// packages/plugins/whale-alerts/src/frontend/whales/components/WhaleDashboard.tsx
import { useEffect as useEffect2, useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
function formatAmount(value) {
  const formatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0
  });
  return formatter.format(value);
}
function WhaleDashboard({ initialSeries, initialHighlights, context }) {
  const initialChartSeries = initialSeries.map((point) => ({
    ...point,
    value: point.volume
  }));
  const [series, setSeries] = useState(initialChartSeries);
  const [highlights, setHighlights] = useState(initialHighlights);
  const [selectedRange, setSelectedRange] = useState(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { ui, charts, api, websocket } = context;
  useEffect2(() => {
    void (async () => {
      try {
        const data = await api.get("/plugins/whale-alerts/highlights", { limit: 8 });
        setHighlights(data.highlights || []);
      } catch (highlightError) {
        console.error(highlightError);
      }
    })();
  }, [api]);
  useEffect2(() => {
    console.log("\u{1F50D} WebSocket Debug:", {
      socketConnected: websocket.isConnected(),
      socketId: websocket.socket.id
    });
    const handleNewWhaleTransaction = (payload) => {
      console.log("\u{1F40B} Real-time whale transaction received:", payload);
      const newHighlight = {
        txId: payload.txId,
        timestamp: new Date(payload.timestamp || Date.now()),
        amountTRX: payload.amountTRX || 0,
        fromAddress: payload.from?.address || payload.fromAddress || "Unknown",
        toAddress: payload.to?.address || payload.toAddress || "Unknown",
        memo: payload.memo
      };
      setHighlights((prev) => [newHighlight, ...prev].slice(0, 8));
    };
    const subscribeToWhaleTransactions = () => {
      websocket.subscribe("large-transfer");
      console.log("\u{1F4E1} Subscribed to large-transfer room");
    };
    websocket.on("large-transfer", handleNewWhaleTransaction);
    websocket.onConnect(subscribeToWhaleTransactions);
    console.log("\u{1F4E1} Listening for large-transfer events");
    subscribeToWhaleTransactions();
    return () => {
      websocket.off("large-transfer", handleNewWhaleTransaction);
      websocket.offConnect(subscribeToWhaleTransactions);
    };
  }, [websocket]);
  const refreshSeries = async (range) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get("/plugins/whale-alerts/timeseries", { days: range });
      const transformedSeries = (data.series || []).map((point) => ({
        ...point,
        value: point.volume || 0
      }));
      setSeries(transformedSeries);
    } catch (fetchError) {
      console.error(fetchError);
      setError(fetchError instanceof Error ? fetchError.message : "Unable to load timeseries");
    } finally {
      setLoading(false);
    }
  };
  const summary = useMemo(() => {
    if (!series.length) {
      return {
        total: 0,
        average: 0,
        peak: 0,
        activity: 0
      };
    }
    const total = series.reduce((acc, point) => acc + point.value, 0);
    const peak = Math.max(...series.map((point) => point.max ?? point.value));
    const activity = series.reduce((acc, point) => acc + (point.count ?? 0), 0);
    return {
      total,
      average: total / series.length,
      peak,
      activity
    };
  }, [series]);
  const onRangeChange = async (range) => {
    if (range === selectedRange) {
      return;
    }
    setSelectedRange(range);
    await refreshSeries(range);
  };
  return /* @__PURE__ */ jsxs("div", { className: "whale-dashboard", children: [
    /* @__PURE__ */ jsx(ui.Card, { children: /* @__PURE__ */ jsxs("div", { className: "stack", children: [
      /* @__PURE__ */ jsxs("header", { className: "whale-dashboard__header", children: [
        /* @__PURE__ */ jsxs("div", { className: "whale-dashboard__title-group", children: [
          /* @__PURE__ */ jsx("h2", { className: "whale-dashboard__title", children: "Whale capital flows" }),
          /* @__PURE__ */ jsx("p", { className: "whale-dashboard__subtitle", children: "Aggregated TRX volume from transfers above the whale threshold." })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "segmented-control whale-range-selector", children: RANGE_OPTIONS.map((range) => /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            className: range === selectedRange ? "is-active" : "",
            onClick: () => onRangeChange(range),
            disabled: loading,
            children: [
              range,
              "d"
            ]
          },
          range
        )) })
      ] }),
      /* @__PURE__ */ jsxs("section", { className: "whale-stats-grid", children: [
        /* @__PURE__ */ jsx(ui.Card, { tone: "muted", padding: "sm", children: /* @__PURE__ */ jsxs("div", { className: "whale-stat-card", children: [
          /* @__PURE__ */ jsx("div", { className: "whale-stat-card__label", children: "Total volume" }),
          /* @__PURE__ */ jsxs("div", { className: "whale-stat-card__value", children: [
            formatAmount(summary.total),
            " TRX"
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "whale-stat-card__delta", children: [
            "Across ",
            series.length,
            " days"
          ] })
        ] }) }),
        /* @__PURE__ */ jsx(ui.Card, { tone: "muted", padding: "sm", children: /* @__PURE__ */ jsxs("div", { className: "whale-stat-card", children: [
          /* @__PURE__ */ jsx("div", { className: "whale-stat-card__label", children: "Daily average" }),
          /* @__PURE__ */ jsxs("div", { className: "whale-stat-card__value", children: [
            formatAmount(summary.average),
            " TRX"
          ] }),
          /* @__PURE__ */ jsx("div", { className: "whale-stat-card__delta", children: "Whale inflow per day" })
        ] }) }),
        /* @__PURE__ */ jsx(ui.Card, { tone: "muted", padding: "sm", children: /* @__PURE__ */ jsxs("div", { className: "whale-stat-card", children: [
          /* @__PURE__ */ jsx("div", { className: "whale-stat-card__label", children: "Largest move" }),
          /* @__PURE__ */ jsxs("div", { className: "whale-stat-card__value", children: [
            formatAmount(summary.peak),
            " TRX"
          ] }),
          /* @__PURE__ */ jsx("div", { className: "whale-stat-card__delta", children: "Peak transaction amount" })
        ] }) }),
        /* @__PURE__ */ jsx(ui.Card, { tone: "muted", padding: "sm", children: /* @__PURE__ */ jsxs("div", { className: "whale-stat-card", children: [
          /* @__PURE__ */ jsx("div", { className: "whale-stat-card__label", children: "Transactions" }),
          /* @__PURE__ */ jsx("div", { className: "whale-stat-card__value", children: formatAmount(summary.activity) }),
          /* @__PURE__ */ jsx("div", { className: "whale-stat-card__delta", children: "High-value transfers processed" })
        ] }) })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "whale-chart-container", children: loading && !series.length ? /* @__PURE__ */ jsx(ui.Skeleton, { style: { height: "240px" } }) : /* @__PURE__ */ jsx(
        charts.LineChart,
        {
          series: [
            {
              id: "whales-volume",
              label: "TRX moved",
              data: series,
              color: "#7C9BFF"
            }
          ],
          yAxisFormatter: (value) => `${Math.round(value).toLocaleString()}`,
          emptyLabel: "No whale transactions recorded during this range."
        }
      ) }),
      error && /* @__PURE__ */ jsx("p", { className: "whale-error", children: error })
    ] }) }),
    /* @__PURE__ */ jsx(ui.Card, { children: /* @__PURE__ */ jsxs("div", { className: "whale-highlights", children: [
      /* @__PURE__ */ jsxs("header", { className: "whale-highlights__header", children: [
        /* @__PURE__ */ jsxs("div", { className: "whale-dashboard__title-group", children: [
          /* @__PURE__ */ jsx("h3", { className: "whale-highlights__title", children: "Latest whale transfers" }),
          /* @__PURE__ */ jsx("p", { className: "whale-dashboard__subtitle", children: "Sorted by most recent activity." })
        ] }),
        /* @__PURE__ */ jsxs(ui.Badge, { tone: "neutral", className: "whale-highlights__count", children: [
          highlights.length,
          " events"
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "whale-highlights__list", children: [
        highlights.map((item) => /* @__PURE__ */ jsxs("article", { className: "whale-highlight-item", children: [
          /* @__PURE__ */ jsxs("div", { className: "whale-highlight-item__header", children: [
            /* @__PURE__ */ jsxs("strong", { className: "whale-highlight-item__amount", children: [
              formatAmount(item.amountTRX),
              " TRX"
            ] }),
            /* @__PURE__ */ jsx("span", { className: "whale-highlight-item__timestamp", children: new Date(item.timestamp).toLocaleString() })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "whale-highlight-item__addresses", children: [
            item.fromAddress,
            " \u2192 ",
            item.toAddress
          ] }),
          item.memo && /* @__PURE__ */ jsx("p", { className: "whale-highlight-item__memo", children: item.memo })
        ] }, item.txId)),
        !highlights.length && /* @__PURE__ */ jsx("p", { className: "whale-highlights__empty", children: "No whale movements recorded yet." })
      ] })
    ] }) })
  ] });
}
var RANGE_OPTIONS;
var init_WhaleDashboard = __esm({
  "packages/plugins/whale-alerts/src/frontend/whales/components/WhaleDashboard.tsx"() {
    "use strict";
    "use client";
    RANGE_OPTIONS = [7, 14, 30, 60];
  }
});

// packages/plugins/whale-alerts/src/frontend/WhaleIntelligencePage.tsx
var WhaleIntelligencePage_exports = {};
__export(WhaleIntelligencePage_exports, {
  WhaleIntelligencePage: () => WhaleIntelligencePage
});
import { useEffect as useEffect3, useState as useState2 } from "react";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function WhaleIntelligencePage({ context }) {
  const [series, setSeries] = useState2([]);
  const [highlights, setHighlights] = useState2([]);
  const [loading, setLoading] = useState2(true);
  useEffect3(() => {
    async function loadData() {
      try {
        const timeseriesData = await context.api.get("/plugins/whale-alerts/timeseries", { days: 14 });
        const highlightsData = await context.api.get("/plugins/whale-alerts/highlights", { limit: 12 });
        const transformedSeries = (timeseriesData.series || []).map((point) => ({
          ...point,
          value: point.volume || 0
        }));
        setSeries(transformedSeries);
        setHighlights(highlightsData.highlights || []);
      } catch (error) {
        console.error("Failed to load whale data:", error);
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, [context.api]);
  if (loading) {
    return /* @__PURE__ */ jsx2("main", { children: /* @__PURE__ */ jsx2("div", { className: "whale-page", children: /* @__PURE__ */ jsxs2("section", { className: "whale-page__header", children: [
      /* @__PURE__ */ jsx2("h1", { className: "whale-page__title", children: "Whale intelligence" }),
      /* @__PURE__ */ jsx2("p", { className: "whale-page__subtitle", children: "Loading whale activity data..." })
    ] }) }) });
  }
  return /* @__PURE__ */ jsx2("main", { children: /* @__PURE__ */ jsxs2("div", { className: "whale-page", children: [
    /* @__PURE__ */ jsxs2("section", { className: "whale-page__header", children: [
      /* @__PURE__ */ jsx2("h1", { className: "whale-page__title", children: "Whale intelligence" }),
      /* @__PURE__ */ jsx2("p", { className: "whale-page__subtitle", children: "Monitor high-value transfers and spot accumulation or distribution trends instantly." })
    ] }),
    /* @__PURE__ */ jsx2(WhaleDashboard, { initialSeries: series, initialHighlights: highlights, context })
  ] }) });
}
var init_WhaleIntelligencePage = __esm({
  "packages/plugins/whale-alerts/src/frontend/WhaleIntelligencePage.tsx"() {
    "use strict";
    "use client";
    init_WhaleDashboard();
  }
});

// packages/plugins/whale-alerts/src/frontend/system/components/WhaleThresholdSettings.tsx
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function WhaleThresholdSettings({ config, onChange, context }) {
  const { ui } = context;
  const handleThresholdChange = (e) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value) && value >= 0) {
      onChange({ ...config, thresholdTRX: value });
    }
  };
  const formatNumber = (value) => {
    return new Intl.NumberFormat("en-US").format(value);
  };
  return /* @__PURE__ */ jsx3(ui.Card, { children: /* @__PURE__ */ jsxs3("div", { className: "whale-admin-section", children: [
    /* @__PURE__ */ jsxs3("div", { className: "whale-admin-section__header", children: [
      /* @__PURE__ */ jsx3("h3", { className: "whale-admin-section__title", children: "Detection Threshold" }),
      /* @__PURE__ */ jsx3("p", { className: "whale-admin-section__description", children: "Set the minimum TRX transfer amount required for a transaction to be classified as whale activity. Higher thresholds reduce noise from smaller transactions." })
    ] }),
    /* @__PURE__ */ jsxs3("div", { className: "whale-admin-section__content", children: [
      /* @__PURE__ */ jsxs3("div", { className: "form-group", children: [
        /* @__PURE__ */ jsx3("label", { htmlFor: "threshold-trx", className: "form-label", children: "Minimum TRX Amount" }),
        /* @__PURE__ */ jsx3(
          ui.Input,
          {
            id: "threshold-trx",
            type: "number",
            value: config.thresholdTRX.toString(),
            onChange: handleThresholdChange,
            min: 0,
            step: 1e4
          }
        ),
        /* @__PURE__ */ jsxs3("p", { className: "form-help", children: [
          "Current threshold: ",
          /* @__PURE__ */ jsxs3("strong", { children: [
            formatNumber(config.thresholdTRX),
            " TRX"
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs3("div", { className: "whale-threshold-examples", children: [
        /* @__PURE__ */ jsx3("h4", { className: "whale-threshold-examples__title", children: "Common Thresholds" }),
        /* @__PURE__ */ jsxs3("div", { className: "whale-threshold-examples__list", children: [
          /* @__PURE__ */ jsxs3(
            "button",
            {
              type: "button",
              onClick: () => onChange({ ...config, thresholdTRX: 25e4 }),
              className: "whale-threshold-example",
              children: [
                /* @__PURE__ */ jsx3("span", { className: "whale-threshold-example__value", children: "250,000 TRX" }),
                /* @__PURE__ */ jsx3("span", { className: "whale-threshold-example__label", children: "Small Whales" })
              ]
            }
          ),
          /* @__PURE__ */ jsxs3(
            "button",
            {
              type: "button",
              onClick: () => onChange({ ...config, thresholdTRX: 5e5 }),
              className: "whale-threshold-example",
              children: [
                /* @__PURE__ */ jsx3("span", { className: "whale-threshold-example__value", children: "500,000 TRX" }),
                /* @__PURE__ */ jsx3("span", { className: "whale-threshold-example__label", children: "Medium Whales" })
              ]
            }
          ),
          /* @__PURE__ */ jsxs3(
            "button",
            {
              type: "button",
              onClick: () => onChange({ ...config, thresholdTRX: 1e6 }),
              className: "whale-threshold-example",
              children: [
                /* @__PURE__ */ jsx3("span", { className: "whale-threshold-example__value", children: "1,000,000 TRX" }),
                /* @__PURE__ */ jsx3("span", { className: "whale-threshold-example__label", children: "Large Whales" })
              ]
            }
          ),
          /* @__PURE__ */ jsxs3(
            "button",
            {
              type: "button",
              onClick: () => onChange({ ...config, thresholdTRX: 5e6 }),
              className: "whale-threshold-example",
              children: [
                /* @__PURE__ */ jsx3("span", { className: "whale-threshold-example__value", children: "5,000,000 TRX" }),
                /* @__PURE__ */ jsx3("span", { className: "whale-threshold-example__label", children: "Mega Whales" })
              ]
            }
          )
        ] })
      ] })
    ] })
  ] }) });
}
var init_WhaleThresholdSettings = __esm({
  "packages/plugins/whale-alerts/src/frontend/system/components/WhaleThresholdSettings.tsx"() {
    "use strict";
    "use client";
  }
});

// packages/plugins/whale-alerts/src/frontend/system/components/WhaleTelegramSettings.tsx
import { Fragment, jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
function WhaleTelegramSettings({ config, onChange, context }) {
  const { ui } = context;
  const handleToggleTelegram = (e) => {
    onChange({ ...config, telegramEnabled: e.target.checked });
  };
  const handleChannelIdChange = (e) => {
    onChange({ ...config, telegramChannelId: e.target.value });
  };
  const handleThreadIdChange = (e) => {
    const value = e.target.value;
    onChange({
      ...config,
      telegramThreadId: value ? parseInt(value, 10) : void 0
    });
  };
  return /* @__PURE__ */ jsx4(ui.Card, { children: /* @__PURE__ */ jsxs4("div", { className: "whale-admin-section", children: [
    /* @__PURE__ */ jsxs4("div", { className: "whale-admin-section__header", children: [
      /* @__PURE__ */ jsx4("h3", { className: "whale-admin-section__title", children: "Telegram Notifications" }),
      /* @__PURE__ */ jsx4("p", { className: "whale-admin-section__description", children: "Send whale transaction alerts to a Telegram channel or group. Requires TELEGRAM_TOKEN to be configured in backend environment variables." })
    ] }),
    /* @__PURE__ */ jsxs4("div", { className: "whale-admin-section__content", children: [
      /* @__PURE__ */ jsxs4("div", { className: "form-group", children: [
        /* @__PURE__ */ jsxs4("label", { className: "form-checkbox", children: [
          /* @__PURE__ */ jsx4(
            "input",
            {
              type: "checkbox",
              checked: config.telegramEnabled,
              onChange: handleToggleTelegram
            }
          ),
          /* @__PURE__ */ jsx4("span", { children: "Enable Telegram Notifications" })
        ] }),
        /* @__PURE__ */ jsx4("p", { className: "form-help", children: "Whale transactions will be sent to the configured Telegram channel" })
      ] }),
      config.telegramEnabled && /* @__PURE__ */ jsxs4(Fragment, { children: [
        /* @__PURE__ */ jsxs4("div", { className: "form-group", children: [
          /* @__PURE__ */ jsx4("label", { htmlFor: "telegram-channel-id", className: "form-label", children: "Channel ID" }),
          /* @__PURE__ */ jsx4(
            ui.Input,
            {
              id: "telegram-channel-id",
              type: "text",
              value: config.telegramChannelId || "",
              onChange: handleChannelIdChange,
              placeholder: "@channel_name or -1001234567890"
            }
          ),
          /* @__PURE__ */ jsx4("p", { className: "form-help", children: "Telegram channel username (e.g., @mychannel) or numeric ID (e.g., -1001234567890)" })
        ] }),
        /* @__PURE__ */ jsxs4("div", { className: "form-group", children: [
          /* @__PURE__ */ jsx4("label", { htmlFor: "telegram-thread-id", className: "form-label", children: "Thread ID (Optional)" }),
          /* @__PURE__ */ jsx4(
            ui.Input,
            {
              id: "telegram-thread-id",
              type: "number",
              value: config.telegramThreadId?.toString() || "",
              onChange: handleThreadIdChange,
              placeholder: "Leave empty for main channel"
            }
          ),
          /* @__PURE__ */ jsx4("p", { className: "form-help", children: "Forum topic ID if posting to a specific thread in a forum-enabled group" })
        ] }),
        /* @__PURE__ */ jsx4(ui.Badge, { tone: "neutral", children: "Notifications sent every 30 seconds" })
      ] })
    ] })
  ] }) });
}
var init_WhaleTelegramSettings = __esm({
  "packages/plugins/whale-alerts/src/frontend/system/components/WhaleTelegramSettings.tsx"() {
    "use strict";
    "use client";
  }
});

// packages/plugins/whale-alerts/src/frontend/system/pages/WhaleAdminPage.tsx
var WhaleAdminPage_exports = {};
__export(WhaleAdminPage_exports, {
  WhaleAdminPage: () => WhaleAdminPage
});
import { useEffect as useEffect4, useState as useState3 } from "react";
import { jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
function WhaleAdminPage({ context }) {
  const { ui, api, websocket } = context;
  const [config, setConfig] = useState3(null);
  const [loading, setLoading] = useState3(true);
  const [saving, setSaving] = useState3(false);
  const [error, setError] = useState3(null);
  const [successMessage, setSuccessMessage] = useState3(null);
  const [liveThreshold, setLiveThreshold] = useState3(null);
  useEffect4(() => {
    async function loadConfig() {
      try {
        setLoading(true);
        setError(null);
        const data = await api.get("/plugins/whale-alerts/system/config");
        setConfig(data.config);
        setLiveThreshold(data.config.thresholdTRX);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load configuration");
      } finally {
        setLoading(false);
      }
    }
    void loadConfig();
  }, [api]);
  useEffect4(() => {
    const handleConfigUpdate = (payload) => {
      console.log("\u{1F4E1} Config update received:", payload);
      setLiveThreshold(payload.thresholdTRX);
      setSuccessMessage("Configuration applied - backend is now using new threshold");
      setTimeout(() => setSuccessMessage(null), 3e3);
    };
    websocket.subscribe("config-updates");
    websocket.on("config-updated", handleConfigUpdate);
    return () => {
      websocket.off("config-updated", handleConfigUpdate);
    };
  }, [websocket]);
  const handleSave = async () => {
    if (!config) return;
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);
      await api.put("/plugins/whale-alerts/system/config", config);
      setSuccessMessage("Configuration saved successfully");
      setTimeout(() => setSuccessMessage(null), 3e3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };
  if (loading) {
    return /* @__PURE__ */ jsx5("main", { children: /* @__PURE__ */ jsxs5("div", { className: "page", children: [
      /* @__PURE__ */ jsx5("section", { className: "page-header", children: /* @__PURE__ */ jsx5("h1", { className: "page-title", children: "Whale Alerts Settings" }) }),
      /* @__PURE__ */ jsx5(ui.Skeleton, { height: "400px" })
    ] }) });
  }
  if (!config) {
    return /* @__PURE__ */ jsx5("main", { children: /* @__PURE__ */ jsxs5("div", { className: "page", children: [
      /* @__PURE__ */ jsx5("section", { className: "page-header", children: /* @__PURE__ */ jsx5("h1", { className: "page-title", children: "Whale Alerts Settings" }) }),
      /* @__PURE__ */ jsxs5(ui.Card, { children: [
        /* @__PURE__ */ jsx5("p", { children: "Failed to load configuration. Please try refreshing the page." }),
        error && /* @__PURE__ */ jsxs5("p", { style: { marginTop: "0.5rem", fontSize: "0.9rem", opacity: 0.9 }, children: [
          "Error: ",
          error
        ] })
      ] })
    ] }) });
  }
  return /* @__PURE__ */ jsx5("main", { children: /* @__PURE__ */ jsxs5("div", { className: "page", children: [
    /* @__PURE__ */ jsxs5("section", { className: "page-header", children: [
      /* @__PURE__ */ jsx5("h1", { className: "page-title", children: "Whale Alerts Settings" }),
      /* @__PURE__ */ jsx5("p", { className: "page-subtitle", children: "Configure whale detection thresholds and notification preferences" })
    ] }),
    error && /* @__PURE__ */ jsxs5(ui.Card, { children: [
      /* @__PURE__ */ jsx5("strong", { children: "Error:" }),
      " ",
      error
    ] }),
    successMessage && /* @__PURE__ */ jsx5(ui.Badge, { tone: "success", children: successMessage }),
    liveThreshold !== null && /* @__PURE__ */ jsx5(ui.Card, { tone: "accent", children: /* @__PURE__ */ jsxs5("div", { style: { display: "flex", alignItems: "center", gap: "0.5rem" }, children: [
      /* @__PURE__ */ jsx5("span", { style: { fontSize: "1.5rem" }, children: "\u{1F534}" }),
      /* @__PURE__ */ jsxs5("div", { children: [
        /* @__PURE__ */ jsx5("strong", { children: "Live Backend Threshold:" }),
        " ",
        liveThreshold.toLocaleString(),
        " TRX",
        /* @__PURE__ */ jsx5("br", {}),
        /* @__PURE__ */ jsx5("small", { style: { opacity: 0.8 }, children: "The observer is currently detecting whale transactions above this amount" })
      ] })
    ] }) }),
    /* @__PURE__ */ jsxs5("div", { className: "whale-admin-grid", children: [
      /* @__PURE__ */ jsx5(
        WhaleThresholdSettings,
        {
          config,
          onChange: setConfig,
          context
        }
      ),
      /* @__PURE__ */ jsx5(
        WhaleTelegramSettings,
        {
          config,
          onChange: setConfig,
          context
        }
      )
    ] }),
    /* @__PURE__ */ jsx5(ui.Card, { children: /* @__PURE__ */ jsx5("div", { className: "whale-admin-actions", children: /* @__PURE__ */ jsx5(
      ui.Button,
      {
        onClick: handleSave,
        disabled: saving,
        variant: "primary",
        children: saving ? "Saving..." : "Save Configuration"
      }
    ) }) })
  ] }) });
}
var init_WhaleAdminPage = __esm({
  "packages/plugins/whale-alerts/src/frontend/system/pages/WhaleAdminPage.tsx"() {
    "use strict";
    "use client";
    init_WhaleThresholdSettings();
    init_WhaleTelegramSettings();
  }
});

// packages/plugins/whale-alerts/src/frontend/frontend.ts
var import_dynamic = __toESM(require_dynamic2(), 1);

// packages/types/dist/plugin/definePlugin.js
function definePlugin(plugin) {
  return plugin;
}

// packages/plugins/whale-alerts/src/manifest.ts
var whaleAlertsManifest = {
  id: "whale-alerts",
  title: "Whale Alerts",
  version: "1.0.0",
  description: "Monitor and notify on large TRX transfers",
  author: "TronRelic",
  license: "MIT",
  backend: true,
  frontend: true,
  adminUrl: "/system/plugins/whale-alerts/settings"
};

// packages/plugins/whale-alerts/src/frontend/WhaleAlertsToastHandler.tsx
import { useEffect, useRef } from "react";
import { useToast } from "@tronrelic/frontend/components/ui/ToastProvider";
function WhaleAlertsToastHandler({ context }) {
  const { push } = useToast();
  const toastedEventKeys = useRef(/* @__PURE__ */ new Set());
  const hydratedRef = useRef(false);
  const { websocket } = context;
  useEffect(() => {
    hydratedRef.current = true;
  }, []);
  useEffect(() => {
    const handleLargeTransfer = (payload) => {
      if (!hydratedRef.current) {
        return;
      }
      if (!payload || typeof payload !== "object") {
        console.error("WhaleAlertsToastHandler: Received malformed large-transfer event - payload is not an object", { payload });
        return;
      }
      const txId = payload?.txId;
      if (!txId || typeof txId !== "string") {
        console.error("WhaleAlertsToastHandler: Received large-transfer event with invalid or missing txId", { payload });
        return;
      }
      const toastKey = `large-transfer:${txId}`;
      if (toastedEventKeys.current.has(toastKey)) {
        return;
      }
      toastedEventKeys.current.add(toastKey);
      if (toastedEventKeys.current.size > 500) {
        const oldest = toastedEventKeys.current.values().next().value;
        if (oldest) {
          toastedEventKeys.current.delete(oldest);
        }
      }
      const amount = Number(payload.amountTRX ?? 0);
      const formattedAmount = Number.isFinite(amount) ? amount.toLocaleString() : "Unknown";
      const fromAddress = payload.from?.address ?? "Unknown";
      const toAddress = payload.to?.address ?? "Unknown";
      push({
        tone: "warning",
        title: "Whale transfer detected",
        description: `${formattedAmount} TRX \u2022 ${fromAddress} \u2192 ${toAddress}`,
        duration: 7e3
      });
    };
    websocket.on("large-transfer", handleLargeTransfer);
    return () => {
      websocket.off("large-transfer", handleLargeTransfer);
    };
  }, [push, websocket]);
  return null;
}

// packages/plugins/whale-alerts/src/frontend/frontend.ts
var WhaleIntelligencePage2 = (0, import_dynamic.default)(
  () => Promise.resolve().then(() => (init_WhaleIntelligencePage(), WhaleIntelligencePage_exports)).then((m) => m.WhaleIntelligencePage)
);
var WhaleAdminPage2 = (0, import_dynamic.default)(
  () => Promise.resolve().then(() => (init_WhaleAdminPage(), WhaleAdminPage_exports)).then((m) => m.WhaleAdminPage)
);
var whaleAlertsFrontendPlugin = definePlugin({
  manifest: whaleAlertsManifest,
  component: WhaleAlertsToastHandler,
  // Register navigation menu item
  menuItems: [
    {
      label: "Whales",
      href: "/whales",
      icon: "Fish",
      category: "intelligence",
      order: 30
    }
  ],
  // Register whale dashboard page
  pages: [
    {
      path: "/whales",
      component: WhaleIntelligencePage2,
      title: "Whale Intelligence - TronRelic",
      description: "Monitor high-value TRX transfers and whale activity"
    }
  ],
  // Register admin pages
  adminPages: [
    {
      path: "/system/plugins/whale-alerts/settings",
      component: WhaleAdminPage2,
      title: "Whale Alerts Settings - TronRelic",
      description: "Configure whale detection thresholds and notification preferences"
    }
  ]
});
export {
  whaleAlertsFrontendPlugin
};
