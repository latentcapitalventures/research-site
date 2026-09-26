/**
 * House interactive charts (Chart.js).
 * Modes: stacked | stacked100 | grouped — composition charts only.
 * Tooltips: period (or point) label and each series value.
 * Composition tooltips also show % share of the period total.
 *
 * HOUSE RULE (composition only): offer Stacked / 100% / Grouped only when the
 * series are additive parts of one disclosed whole (true composition) — e.g.
 * Residential + Mortgages + Rentals = company revenue. For parallel metrics
 * that do not sum (revenue vs Adj. EBITDA, visits vs AMUU), lines, and single
 * series, draw Chart.js with tooltips (grouped or line) and do not expose
 * stacked or stacked100.
 *
 * Pre-normalized %-share series (payload.percentShare / stackMode=percent,
 * e.g. geo already in %): Stacked and 100% stacked draw identically, so
 * Stacked is hidden. 100% uses the printed shares (no re-normalization).
 * Grouped remains available.
 *
 * Zoom: wheel / pinch zooms the x (time) domain; drag pans; double-click or
 * the Reset zoom button restores the house window. DERIVED warning chrome
 * (hatch, red tint, watermark, tooltip suffix) can be hidden from a page
 * toggle without changing series statuses.
 */
(function () {
  "use strict";

  var MODE_LABELS = {
    stacked: "Stacked",
    stacked100: "100%",
    grouped: "Grouped",
  };

  var DERIVED_CHROME_KEY = "latent-pack-derived-chrome";
  var ZOOM_MIN_CATEGORIES = 4;
  var mountedCharts = [];

  function log() {
    if (typeof console !== "undefined" && console.info) {
      console.info.apply(console, ["[pack-charts]"].concat([].slice.call(arguments)));
    }
  }

  function derivedChromeOn() {
    return !document.documentElement.classList.contains("derived-chrome-off");
  }

  function readDerivedChromePref() {
    try {
      var stored = localStorage.getItem(DERIVED_CHROME_KEY);
      if (stored === "off") return false;
      if (stored === "on") return true;
    } catch (err) {
      log("DERIVED chrome preference unread", err);
    }
    return true;
  }

  function registerChart(chart) {
    if (chart && mountedCharts.indexOf(chart) < 0) mountedCharts.push(chart);
  }

  function setDerivedChrome(on, persist) {
    document.documentElement.classList.toggle("derived-chrome-off", !on);
    document.documentElement.setAttribute("data-derived-chrome", on ? "on" : "off");
    var box = document.getElementById("pack-derived-chrome");
    if (box && box.checked !== !!on) box.checked = !!on;
    if (persist !== false) {
      try {
        localStorage.setItem(DERIVED_CHROME_KEY, on ? "on" : "off");
        log("DERIVED chrome preference saved", on ? "on" : "off");
      } catch (err) {
        log("DERIVED chrome preference not stored", err);
      }
    }
    mountedCharts.forEach(function (chart) {
      restyleChart(chart);
    });
    log("DERIVED chrome", on ? "shown" : "hidden", "charts=", mountedCharts.length);
  }

  function restyleChart(chart) {
    if (!chart || !chart._packPayload) return;
    var zoom = snapshotZoom(chart);
    chart.data.datasets = asChartDatasets(chart._packPayload, chart._packMode || "grouped");
    restoreZoom(chart, zoom);
    chart.update();
  }

  function snapshotZoom(chart) {
    var x = chart.options && chart.options.scales && chart.options.scales.x;
    if (!x) return null;
    return { min: x.min, max: x.max };
  }

  function restoreZoom(chart, zoom) {
    if (!zoom || !chart.options || !chart.options.scales || !chart.options.scales.x) return;
    if (zoom.min === undefined) delete chart.options.scales.x.min;
    else chart.options.scales.x.min = zoom.min;
    if (zoom.max === undefined) delete chart.options.scales.x.max;
    else chart.options.scales.x.max = zoom.max;
  }

  function fmtMoney(v, unit) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
    var n = Number(v);
    var abs = Math.abs(n);
    // Dollars stay whole. Multiples and rates (PE 16.86, TAC 19.8) keep two decimals.
    var digits = abs >= 1000 ? 0 : 2;
    var body = n.toLocaleString(undefined, { maximumFractionDigits: digits });
    if (!unit) return body;
    if (unit.charAt(0) === "$") return unit.charAt(0) + body + unit.slice(1);
    return body + " " + unit;
  }

  function fmtPct(share) {
    if (share === null || share === undefined || Number.isNaN(share)) return "—";
    return (share * 100).toFixed(1) + "%";
  }

  function fmtTick(v, scale) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return "";
    var n = Number(v) / (scale || 1);
    if (!isFinite(n)) return "";
    if (Math.abs(n) < 1e-12) return "0";
    var av = Math.abs(n);
    var s;
    if (av >= 100) s = String(Math.round(n));
    else if (av >= 1) s = n.toFixed(1);
    else s = n.toFixed(2);
    if (s.indexOf(".") >= 0) {
      s = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    }
    if (s === "-0") return "0";
    return s;
  }

  function maxAbsOnAxis(payload, axisId) {
    var m = 0;
    (payload.datasets || []).forEach(function (ds) {
      var axis = ds.yAxisID || "y";
      if (axisId === "y" && axis === "y1") return;
      if (axisId === "y1" && axis !== "y1") return;
      (ds.values || []).forEach(function (v) {
        if (v === null || v === undefined || Number.isNaN(Number(v))) return;
        m = Math.max(m, Math.abs(Number(v)));
      });
      (ds.points || []).forEach(function (p) {
        var n = Number(p && p.y);
        if (!Number.isNaN(n)) m = Math.max(m, Math.abs(n));
      });
    });
    return m;
  }

  function isRatioAxis(ylabel, unit, payload) {
    if (payload && (payload.percentShare || payload.stackMode === "percent")) return true;
    var blob = ((ylabel || "") + " " + (unit || "")).toLowerCase();
    var raw = (ylabel || "") + (unit || "");
    if (blob.indexOf("%") >= 0 || blob.indexOf("percent") >= 0 || blob.indexOf("bps") >= 0) {
      return true;
    }
    if (raw.indexOf("×") >= 0 || raw.indexOf("÷") >= 0) return true;
    var u = String(unit || "").trim().toLowerCase();
    if (u === "x" || u === "multiple" || u === "ratio" || u === "×") return true;
    if (/\btake[ -]?rate\b/.test(blob)) return true;
    if (/\bpe\b/.test(blob) && /(trail|forward|earnings|multiple|\(x\))/.test(blob)) return true;
    return false;
  }

  function alreadyScaled(ylabel, unit) {
    var blob = ((ylabel || "") + " " + (unit || "")).toLowerCase();
    if (/\b(thousands?|millions?|billions?|trillions?)\b/.test(blob)) return true;
    if (/[$€£][mbtk]\b/.test(blob)) return true;
    var u = String(unit || "").trim().toLowerCase();
    return u === "$m" || u === "$b" || u === "$k" || u === "€m" || u === "millions" || u === "billions";
  }

  function isUnitRate(ylabel, unit) {
    var blob = (ylabel || "") + " " + (unit || "");
    if (/\bper\b/i.test(blob) || /\barpu\b/i.test(blob)) return true;
    return /\/ *(order|account|night|user|room|share|day|cleared)/i.test(blob);
  }

  function currencySymbol(ylabel, unit) {
    var blob = (ylabel || "") + " " + (unit || "");
    if (blob.indexOf("€") >= 0 || /\beur\b/i.test(blob)) return "€";
    if (blob.indexOf("£") >= 0 || /\bgbp\b/i.test(blob)) return "£";
    if (blob.indexOf("$") >= 0 || /\busd\b/i.test(blob)) return "$";
    return "";
  }

  function annotateYlabel(ylabel, unitName, symbol) {
    var base = (ylabel || "").trim();
    if (!unitName) return base;
    if (base.toLowerCase().indexOf(unitName) >= 0) return base;
    var suffix = symbol ? "(" + symbol + " " + unitName + ")" : "(" + unitName + ")";
    if (!base) return suffix;
    return base + " " + suffix;
  }

  function displayAxis(payload, axisId, ylabel) {
    // House: USD ($ millions) ticks when yDisplayScale is set.
    var title = ylabel || "";
    var scaleKey = axisId === "y1" ? "y1DisplayScale" : "yDisplayScale";
    var titleKey = axisId === "y1" ? "y1Label" : "ylabel";
    if (payload && payload[scaleKey]) {
      var scaledTitle = payload[titleKey] || title;
      log("y-axis display scale", payload.id, axisId, payload[scaleKey], scaledTitle);
      return { scale: payload[scaleKey], title: scaledTitle };
    }
    title = title || (payload && payload[titleKey]) || "";
    var unit = (payload && payload.unit) || "";
    if (isRatioAxis(title, unit, payload) || alreadyScaled(title, unit) || isUnitRate(title, unit)) {
      return { scale: 1, title: title };
    }
    var peak = maxAbsOnAxis(payload || {}, axisId);
    if (peak < 1e6) return { scale: 1, title: title };
    var scale = peak >= 1e12 ? 1e9 : 1e6;
    var name = scale === 1e9 ? "billions" : "millions";
    var inferred = annotateYlabel(title, name, currencySymbol(title, unit));
    log("inferred y-axis display scale", payload && payload.id, axisId, scale, inferred, "maxAbs=", peak);
    return { scale: scale, title: inferred };
  }

  function isPercentShare(payload) {
    return !!(
      payload &&
      (payload.percentShare || payload.stackMode === "percent")
    );
  }

  function filterModes(payload, modes) {
    var out = (modes || []).slice();
    if (isPercentShare(payload)) {
      out = out.filter(function (m) {
        return m !== "stacked";
      });
      log("percent_share — hiding redundant Stacked", payload.id, "modes=", out);
    }
    if (payload.stackMode === "none" || payload.stackMode === "grouped") {
      out = [];
    }
    return out;
  }

  function periodTotals(datasets, labelCount) {
    var totals = [];
    for (var i = 0; i < labelCount; i++) {
      var t = 0;
      var any = false;
      for (var d = 0; d < datasets.length; d++) {
        var v = datasets[d].values[i];
        if (v !== null && v !== undefined && !Number.isNaN(v)) {
          t += Number(v);
          any = true;
        }
      }
      totals.push(any ? t : null);
    }
    return totals;
  }

  function isDerivedIndex(payload, idx) {
    var labs = payload.derivedLabels || [];
    if (!labs.length) return false;
    var lab = (payload.labels || [])[idx];
    return labs.indexOf(lab) >= 0;
  }

  function hatchPattern(color) {
    var canvas = document.createElement("canvas");
    canvas.width = 10;
    canvas.height = 10;
    var g = canvas.getContext("2d");
    g.fillStyle = color;
    g.fillRect(0, 0, 10, 10);
    g.strokeStyle = "rgba(27,26,23,0.78)";
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-2, 8);
    g.lineTo(8, -2);
    g.moveTo(2, 12);
    g.lineTo(12, 2);
    g.stroke();
    return g.createPattern(canvas, "repeat");
  }

  function barFill(ds, payload) {
    var labels = payload.labels || [];
    var any = false;
    for (var i = 0; i < labels.length; i++) {
      if (isDerivedIndex(payload, i)) {
        any = true;
        break;
      }
    }
    if (!any || !derivedChromeOn()) return ds.color;
    log("hatching DERIVED bars", payload.id, payload.derivedLabels);
    return labels.map(function (_lab, i) {
      return isDerivedIndex(payload, i) ? hatchPattern(ds.color) : ds.color;
    });
  }

  function asChartDatasets(payload, mode) {
    var totals = payload._totals || [];
    return (payload.datasets || []).map(function (ds) {
      var kind = ds.type || (payload.chartType === "line" ? "line" : "bar");
      if (payload.chartType === "scatter" || kind === "scatter") {
        return {
          type: "scatter",
          label: ds.label,
          backgroundColor: ds.color,
          borderColor: ds.color,
          pointRadius: 4,
          data: (ds.points || []).map(function (p) {
            return { x: p.x, y: p.y, label: p.label };
          }),
        };
      }
      var values = ds.values || [];
      var data = values.map(function (v, i) {
        if (v === null || v === undefined || Number.isNaN(v)) return null;
        if (mode === "stacked100" && !isPercentShare(payload)) {
          var tot = totals[i];
          if (tot === null || tot === 0) return null;
          return (Number(v) / tot) * 100;
        }
        return Number(v);
      });
      var isLine = kind === "line";
      var radius =
        ds.pointRadius !== undefined && ds.pointRadius !== null
          ? ds.pointRadius
          : isLine
            ? ds.showLine === false
              ? 4
              : data.length > 48
                ? 0
                : 3
            : 0;
      var spec = {
        type: isLine ? "line" : "bar",
        label: ds.label,
        backgroundColor: isLine ? ds.color : barFill(ds, payload),
        borderColor: ds.color,
        borderWidth: isLine ? 2 : 0,
        pointRadius: radius,
        pointHoverRadius: 5,
        spanGaps: !!ds.spanGaps,
        showLine: ds.showLine !== false,
        fill: false,
        tension: 0,
        data: data,
        rawValues: values.slice(),
        statuses: (ds.statuses || []).slice(),
        unit: ds.unit || payload.unit || "",
        yAxisID: ds.yAxisID || "y",
      };
      if (ds.borderDash && ds.borderDash.length) {
        spec.borderDash = ds.borderDash.slice();
      } else if (ds.dashed) {
        spec.borderDash = [5, 4];
      }
      if (spec.borderDash) {
        spec.borderWidth = isLine ? 2 : spec.borderWidth;
        spec.pointRadius = isLine ? 4 : spec.pointRadius;
        log("dashed dataset", payload.id, ds.key || ds.label);
      }
      var statuses = spec.statuses;
      if (
        derivedChromeOn() &&
        !isLine &&
        statuses.some(function (s) {
          return s === "DERIVED";
        })
      ) {
        if (payload.preserveSeriesTint) {
          spec.backgroundColor = values.map(function (_v, i) {
            return statuses[i] === "DERIVED" ? hatchPattern(ds.color) : ds.color;
          });
          spec.borderColor = ds.color;
          spec.borderWidth = 0;
          log("DERIVED tint kept (series color + hatch)", payload.id, ds.key || ds.label);
        } else {
          spec.backgroundColor = values.map(function (_v, i) {
            return statuses[i] === "DERIVED" ? "rgba(168,72,60,0.42)" : ds.color;
          });
          spec.borderColor = values.map(function (_v, i) {
            return statuses[i] === "DERIVED" ? "#A8483C" : ds.color;
          });
          spec.borderWidth = values.map(function (_v, i) {
            return statuses[i] === "DERIVED" ? 1.5 : (isLine ? 2 : 0);
          });
          log("DERIVED bar styling", payload.id, ds.key || ds.label);
        }
      }
      if (!isLine && payload.composition && mode !== "grouped") {
        spec.stack = "pack";
      }
      return spec;
    });
  }

  function yScaleFor(mode, ylabel, composition, chartType, payload) {
    if (mode === "stacked100" && composition) {
      var percentShare = isPercentShare(payload);
      var scale = {
        stacked: true,
        beginAtZero: true,
        ticks: {
          callback: function (v) {
            return v + "%";
          },
        },
        title: {
          display: true,
          text: percentShare ? ylabel || "% share" : "% of period total",
          color: "#5c574f",
        },
        grid: { color: "rgba(212,203,184,0.55)" },
      };
      if (!percentShare) scale.max = 100;
      return scale;
    }
    var isLine = chartType === "line";
    var axis = displayAxis(payload || {}, "y", ylabel);
    return {
      stacked: !!(composition && mode !== "grouped"),
      beginAtZero: !isLine,
      ticks: {
        callback: function (v) {
          return fmtTick(v, axis.scale);
        },
      },
      title: { display: !!axis.title, text: axis.title || "", color: "#5c574f" },
      grid: { color: "rgba(212,203,184,0.55)" },
    };
  }

  function buildTooltip(payload) {
    var composition = !!payload.composition;
    return {
      backgroundColor: "#fffcf7",
      titleColor: "#1c1915",
      bodyColor: "#1c1915",
      borderColor: "#d4cbb8",
      borderWidth: 1,
      displayColors: true,
      filter: function (item) {
        var sets = payload.datasets || [];
        var ds = sets[item.datasetIndex] || {};
        var values = ds.values || [];
        var idx = item.dataIndex;
        // Dotted-forward anchors share the last trailing week so the segment
        // can be drawn. Hover on that week should show the trailing print only.
        if (ds.overlay === "forward" && idx !== values.length - 1) return false;
        var raw = values[idx];
        if (
          (raw === null || raw === undefined) &&
          (payload.labels || [])[idx] === "Forward"
        ) {
          return false;
        }
        return true;
      },
      callbacks: {
        title: function (items) {
          if (!items.length) return "";
          var raw = items[0].raw;
          var lab = raw && raw.label ? String(raw.label) : items[0].label || "";
          if (derivedChromeOn() && isDerivedIndex(payload, items[0].dataIndex)) {
            return lab + " · DERIVED";
          }
          return lab;
        },
        label: function (ctx) {
          if (payload.chartType === "scatter") {
            var pt = ctx.raw || {};
            return (
              " " +
              (ctx.dataset.label || "point") +
              ": " +
              fmtMoney(pt.x, "") +
              " , " +
              fmtMoney(pt.y, payload.unit || "")
            );
          }
          var idx = ctx.dataIndex;
          var raw = ctx.dataset.rawValues ? ctx.dataset.rawValues[idx] : ctx.raw;
          var unit = ctx.dataset.unit || payload.unit || "";
          var derived =
            derivedChromeOn() && (ctx.dataset.statuses || [])[idx] === "DERIVED"
              ? " · DERIVED"
              : "";
          if (!composition || isPercentShare(payload)) {
            return " " + ctx.dataset.label + ": " + fmtMoney(raw, unit) + derived;
          }
          var totals = payload._totals || [];
          var tot = totals[idx];
          var share =
            raw === null || raw === undefined || tot === null || tot === 0
              ? null
              : Number(raw) / tot;
          return (
            " " +
            ctx.dataset.label +
            ": " +
            fmtMoney(raw, unit) +
            derived +
            " (" +
            fmtPct(share) +
            ")"
          );
        },
        footer: function (items) {
          if (!items.length) return "";
          var label = items[0].label || "";
          var gaps = payload.gapLabels || [];
          if (gaps.indexOf(label) >= 0) {
            return "Labeled gap — this quarter is not printed";
          }
          if (!composition) return "";
          var idx = items[0].dataIndex;
          var tot = (payload._totals || [])[idx];
          return "Total: " + fmtMoney(tot, payload.unit || "");
        },
      },
    };
  }

  function scalesFor(payload, mode) {
    if (payload.chartType === "scatter") {
      return {
        x: {
          type: "linear",
          ticks: { color: "#5c574f", font: { size: 10 } },
          grid: { color: "rgba(212,203,184,0.35)" },
          title: { display: !!payload.xlabel, text: payload.xlabel || "", color: "#5c574f" },
        },
        y: yScaleFor("grouped", payload.ylabel, false, "line", payload),
      };
    }
    var hasY1 = (payload.datasets || []).some(function (ds) {
      return ds.yAxisID === "y1";
    });
    var scales = {
      x: {
        stacked: !!(payload.composition && mode !== "grouped"),
        ticks: {
          maxRotation: 60,
          minRotation: 0,
          autoSkip: true,
          maxTicksLimit: 16,
          color: "#5c574f",
          font: { size: 10 },
        },
        grid: { display: false },
      },
      y: yScaleFor(mode, payload.ylabel, payload.composition, payload.chartType, payload),
    };
    if (hasY1) {
      var y1 = displayAxis(payload, "y1", payload.y1Label);
      scales.y1 = {
        position: "right",
        stacked: false,
        beginAtZero: payload.chartType !== "line",
        grid: { drawOnChartArea: false },
        ticks: {
          color: "#5c574f",
          callback: function (v) {
            return fmtTick(v, y1.scale);
          },
        },
        title: {
          display: !!y1.title,
          text: y1.title || "",
          color: "#5c574f",
        },
      };
    }
    return scales;
  }

  function categoryCount(chart) {
    return ((chart.data && chart.data.labels) || []).length;
  }

  function xBounds(chart) {
    var scale = chart.scales && chart.scales.x;
    if (!scale) return null;
    var kind = scale.type === "linear" || scale.type === "time" ? "linear" : "category";
    if (kind === "category") {
      var n = categoryCount(chart);
      if (!n) return null;
      var opts = chart.options && chart.options.scales && chart.options.scales.x;
      var min = (opts && opts.min !== undefined) ? opts.min : (scale.options && scale.options.min);
      var max = (opts && opts.max !== undefined) ? opts.max : (scale.options && scale.options.max);
      if (min === undefined || min === null) min = 0;
      if (max === undefined || max === null) max = n - 1;
      if (typeof min === "string") min = Math.max(0, (chart.data.labels || []).indexOf(min));
      if (typeof max === "string") {
        var idx = (chart.data.labels || []).indexOf(max);
        max = idx >= 0 ? idx : n - 1;
      }
      return { kind: kind, min: Number(min), max: Number(max), n: n };
    }
    var full = chart._packXFull;
    return {
      kind: kind,
      min: scale.min,
      max: scale.max,
      lo: full ? full.min : scale.min,
      hi: full ? full.max : scale.max,
    };
  }

  function applyXRange(chart, min, max) {
    var scales = chart.options && chart.options.scales;
    if (!scales || !scales.x) return;
    var full = chart._packXFull || xBounds(chart);
    if (!full) return;
    if (full.kind === "category") {
      var n = full.n || categoryCount(chart);
      min = Math.max(0, min);
      max = Math.min(n - 1, max);
      if (max < min) {
        var swap = min;
        min = max;
        max = swap;
      }
      if (max - min + 1 < ZOOM_MIN_CATEGORIES && n >= ZOOM_MIN_CATEGORIES) {
        var extra = ZOOM_MIN_CATEGORIES - (max - min + 1);
        min = Math.max(0, min - Math.ceil(extra / 2));
        max = Math.min(n - 1, min + ZOOM_MIN_CATEGORIES - 1);
        min = Math.max(0, max - ZOOM_MIN_CATEGORIES + 1);
      }
      if (min <= 0 && max >= n - 1) {
        delete scales.x.min;
        delete scales.x.max;
        log("zoom full range", chart._packPayload && chart._packPayload.id);
      } else {
        scales.x.min = Math.round(min);
        scales.x.max = Math.round(max);
        log(
          "zoom range",
          chart._packPayload && chart._packPayload.id,
          scales.x.min + ".." + scales.x.max
        );
      }
    } else {
      var lo = full.min;
      var hi = full.max;
      var span = hi - lo;
      if (!(span > 0)) return;
      var minSpan = span * 0.05;
      if (max < min) {
        var swapped = min;
        min = max;
        max = swapped;
      }
      if (max - min < minSpan) {
        var center = (min + max) / 2;
        min = center - minSpan / 2;
        max = center + minSpan / 2;
      }
      min = Math.max(lo, min);
      max = Math.min(hi, max);
      if (min <= lo && max >= hi) {
        delete scales.x.min;
        delete scales.x.max;
      } else {
        scales.x.min = min;
        scales.x.max = max;
      }
    }
    chart.update("none");
  }

  function resetZoom(chart) {
    var scales = chart.options && chart.options.scales;
    if (!scales || !scales.x) return;
    delete scales.x.min;
    delete scales.x.max;
    chart.update();
    chart._packXFull = xBounds(chart);
    log("zoom reset", chart._packPayload && chart._packPayload.id);
  }

  function panByPixels(chart, dx) {
    var area = chart.chartArea;
    var bounds = xBounds(chart);
    if (!bounds || !area) return;
    var width = area.right - area.left;
    if (width <= 0) return;
    var span = bounds.max - bounds.min;
    if (!(span > 0)) return;
    var delta = (-dx / width) * span;
    applyXRange(chart, bounds.min + delta, bounds.max + delta);
  }

  function zoomAtClientX(chart, clientX, factor) {
    var area = chart.chartArea;
    var bounds = xBounds(chart);
    if (!bounds || !area) return;
    var rect = chart.canvas.getBoundingClientRect();
    var x = clientX - rect.left;
    var frac = (x - area.left) / Math.max(1, area.right - area.left);
    frac = Math.max(0, Math.min(1, frac));
    var span = bounds.max - bounds.min;
    if (!(span > 0)) return;
    var newSpan = span * factor;
    var center = bounds.min + span * frac;
    applyXRange(chart, center - newSpan * frac, center + newSpan * (1 - frac));
  }

  function rememberFullX(chart) {
    if (chart._packXFull) return;
    var bounds = xBounds(chart);
    if (!bounds) return;
    if (bounds.kind === "category") {
      chart._packXFull = { kind: "category", min: 0, max: bounds.n - 1, n: bounds.n };
    } else {
      chart._packXFull = { kind: "linear", min: bounds.min, max: bounds.max };
    }
  }

  function attachZoom(chart) {
    var canvas = chart.canvas;
    if (!canvas || canvas._packZoomBound) return;
    canvas._packZoomBound = true;
    rememberFullX(chart);
    var drag = { on: false, x: 0, id: null };
    var pointers = {};
    var pinch0 = 0;

    canvas.addEventListener(
      "wheel",
      function (ev) {
        rememberFullX(chart);
        var area = chart.chartArea;
        if (!area) return;
        var rect = canvas.getBoundingClientRect();
        var x = ev.clientX - rect.left;
        if (x < area.left || x > area.right) return;
        ev.preventDefault();
        var factor = ev.deltaY < 0 ? 0.82 : 1.22;
        zoomAtClientX(chart, ev.clientX, factor);
      },
      { passive: false }
    );

    canvas.addEventListener("pointerdown", function (ev) {
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(pointers);
      if (ids.length >= 2) {
        var a = pointers[ids[0]];
        var b = pointers[ids[1]];
        var dx = a.x - b.x;
        var dy = a.y - b.y;
        pinch0 = Math.sqrt(dx * dx + dy * dy) || 1;
        drag.on = false;
        return;
      }
      if (ev.button !== undefined && ev.button !== 0) return;
      drag.on = true;
      drag.x = ev.clientX;
      drag.id = ev.pointerId;
      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch (err) {
        /* older browsers */
      }
    });

    canvas.addEventListener("pointermove", function (ev) {
      if (pointers[ev.pointerId]) {
        pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      }
      var ids = Object.keys(pointers);
      if (ids.length >= 2 && pinch0) {
        ev.preventDefault();
        var a = pointers[ids[0]];
        var b = pointers[ids[1]];
        var dx = a.x - b.x;
        var dy = a.y - b.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        var factor = pinch0 / dist;
        if (factor > 1.04 || factor < 0.96) {
          var cx = (a.x + b.x) / 2;
          zoomAtClientX(chart, cx, factor);
          pinch0 = dist;
        }
        return;
      }
      if (!drag.on || (drag.id != null && ev.pointerId !== drag.id)) return;
      var move = ev.clientX - drag.x;
      if (Math.abs(move) < 2) return;
      ev.preventDefault();
      drag.x = ev.clientX;
      canvas.style.cursor = "grabbing";
      panByPixels(chart, move);
    });

    function endPointer(ev) {
      delete pointers[ev.pointerId];
      if (Object.keys(pointers).length < 2) pinch0 = 0;
      if (!drag.on || (drag.id != null && ev.pointerId !== drag.id)) return;
      drag.on = false;
      canvas.style.cursor = "";
      try {
        canvas.releasePointerCapture(drag.id);
      } catch (err) {
        /* ignore */
      }
    }
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("dblclick", function (ev) {
      ev.preventDefault();
      resetZoom(chart);
    });
    log("zoom attached", chart._packPayload && chart._packPayload.id, "labels=", categoryCount(chart));
  }

  function drawEventMarkers(chart, payload) {
    var marks = (payload && payload.vlines) || [];
    if (!marks.length) return;
    var xScale = chart.scales && chart.scales.x;
    var area = chart.chartArea;
    var labels = (chart.data && chart.data.labels) || payload.labels || [];
    if (!xScale || !area || !labels.length) return;
    var ctx = chart.ctx;
    ctx.save();
    marks.forEach(function (mark) {
      var lab = mark && mark.label;
      if (!lab) return;
      var idx = labels.indexOf(lab);
      if (idx < 0) {
        log("event marker outside axis", payload.id, lab);
        return;
      }
      var x =
        typeof xScale.getPixelForValue === "function"
          ? xScale.getPixelForValue(idx)
          : xScale.getPixelForTick(idx);
      if (!(x >= area.left && x <= area.right)) return;
      ctx.beginPath();
      ctx.strokeStyle = "#C4A04A";
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1.2;
      ctx.moveTo(x, area.top);
      ctx.lineTo(x, area.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      if (mark.text) {
        ctx.save();
        ctx.fillStyle = "#5C564C";
        ctx.font = "10px sans-serif";
        ctx.translate(x + 3, area.top + 2);
        ctx.rotate(Math.PI / 2);
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(String(mark.text), 0, 0);
        ctx.restore();
      }
    });
    ctx.restore();
    log("drew event markers", payload.id, "n=" + marks.length);
  }

  function mountChart(canvas, payload) {
    if (!canvas) {
      log("skip — missing canvas", payload && payload.id);
      return null;
    }
    if (typeof Chart === "undefined") {
      log("Chart.js missing — keeping PNG fallback for", payload.id);
      return null;
    }
    var composition = !!payload.composition;
    var modes = filterModes(
      payload,
      composition && payload.modes && payload.modes.length ? payload.modes : []
    );
    payload.modes = modes;
    var mode = "grouped";
    if (composition) {
      mode =
        payload.defaultMode && modes.indexOf(payload.defaultMode) >= 0
          ? payload.defaultMode
          : modes[0] || "stacked100";
      if (isPercentShare(payload) && mode === "stacked") {
        mode = modes.indexOf("stacked100") >= 0 ? "stacked100" : modes[0] || "grouped";
        log("percent_share defaulted off Stacked", payload.id, "mode=", mode);
      }
    }
    if (!payload.chartType) payload.chartType = "bar";
    var labelCount = (payload.labels || []).length;
    payload._totals = composition
      ? periodTotals(payload.datasets || [], labelCount)
      : [];

    var plugins = [];
    if (payload.vlines && payload.vlines.length) {
      plugins.push({
        id: "packEventMarkers",
        afterDraw: function (chart) {
          drawEventMarkers(chart, payload);
        },
      });
      log("event markers on", payload.id, "n=" + payload.vlines.length);
    }
    if (payload.hasDerived) {
      plugins.push({
        id: "packDerivedWatermark",
        afterDraw: function (chart) {
          if (!derivedChromeOn()) return;
          var area = chart.chartArea;
          if (!area) return;
          var ctx = chart.ctx;
          ctx.save();
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = "#A8483C";
          ctx.font = "600 22px sans-serif";
          ctx.translate(
            area.left + (area.right - area.left) * 0.18,
            area.top + (area.bottom - area.top) * 0.62
          );
          ctx.rotate(-0.28);
          ctx.fillText("DERIVED", 0, 0);
          ctx.restore();
        },
      });
      log("DERIVED watermark on", payload.id);
    }
    var chart = new Chart(canvas.getContext("2d"), {
      type: payload.chartType === "scatter" ? "scatter" : payload.chartType === "line" ? "line" : "bar",
      plugins: plugins,
      data: {
        labels: payload.labels || [],
        datasets: asChartDatasets(payload, mode),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction:
          payload.chartType === "scatter"
            ? { mode: "nearest", intersect: false }
            : { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "bottom",
            labels: { boxWidth: 12, color: "#1c1915", font: { size: 11 } },
          },
          tooltip: buildTooltip(payload),
        },
        scales: scalesFor(payload, mode),
      },
    });
    log(
      "mounted",
      payload.id,
      "type=" + payload.chartType,
      "composition=" + composition,
      "mode=" + (composition ? mode : "hover"),
      "labels=" + labelCount
    );
    chart._packMode = mode;
    chart._packModes = modes;
    chart._packPayload = payload;
    registerChart(chart);
    attachZoom(chart);
    return chart;
  }

  function wireToolbar(figure, charts) {
    if (!charts || !charts.length) return;
    var chart = charts[0];
    var payload = chart._packPayload;
    var toolbar = figure.querySelector(".chart-toolbar");
    if (!toolbar) return;
    toolbar.querySelectorAll("[data-zoom-reset]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        charts.forEach(resetZoom);
        log("zoom reset click", payload && payload.id);
      });
    });
    if (!payload || !payload.composition) return;
    var mode = chart._packMode;
    toolbar.querySelectorAll("button[data-mode]").forEach(function (btn) {
      var m = btn.getAttribute("data-mode");
      if (isPercentShare(payload) && m === "stacked") {
        btn.hidden = true;
        btn.setAttribute("aria-hidden", "true");
        log("hiding Stacked button on percent_share", payload.id);
      }
      btn.setAttribute("aria-pressed", m === mode ? "true" : "false");
      btn.addEventListener("click", function () {
        setMode(m);
      });
      btn.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          setMode(m);
        }
      });
    });

    function setMode(next) {
      if (chart._packModes.indexOf(next) < 0 || next === chart._packMode) return;
      if (next === "stacked" && isPercentShare(payload)) {
        log("refusing redundant Stacked on percent_share", payload.id);
        return;
      }
      if (next === "stacked" || next === "stacked100") {
        if (!payload.composition) {
          log("refusing non-composition mode", payload.id, next);
          return;
        }
      }
      var zoom = snapshotZoom(chart);
      chart._packMode = next;
      toolbar.querySelectorAll("button[data-mode]").forEach(function (btn) {
        btn.setAttribute("aria-pressed", btn.getAttribute("data-mode") === next ? "true" : "false");
      });
      chart.data.datasets = asChartDatasets(payload, next);
      chart.options.scales = scalesFor(payload, next);
      restoreZoom(chart, zoom);
      chart.update();
      log("mode change", payload.id, next, MODE_LABELS[next] || next);
    }
  }

  function mount(figure) {
    var raw = figure.querySelector("script.chart-data");
    if (!raw) {
      log("skip figure — missing data", figure.getAttribute("data-chart-id"));
      return;
    }
    var payload;
    try {
      payload = JSON.parse(raw.textContent);
    } catch (err) {
      log("bad chart JSON", err);
      return;
    }
    if (typeof Chart === "undefined") {
      log("Chart.js missing — keeping PNG fallback for", payload.id);
      return;
    }
    var canvases = figure.querySelectorAll("canvas");
    if (payload.hasDerived) {
      figure.setAttribute("data-has-derived", "true");
    }
    if (payload.panels && payload.panels.length) {
      var mounted = [];
      payload.panels.forEach(function (panel, i) {
        panel.id = panel.id || payload.id + "-" + i;
        panel.composition = false;
        panel.modes = [];
        if (!panel.gapLabels && payload.gapLabels) panel.gapLabels = payload.gapLabels;
        var panelChart = mountChart(canvases[i], panel);
        if (panelChart) mounted.push(panelChart);
      });
      if (!mounted.length) return;
      wireToolbar(figure, mounted);
      figure.classList.add("js-ready");
      log("mounted panels", payload.id, "n=" + mounted.length);
      return;
    }
    var chart = mountChart(canvases[0], payload);
    if (!chart) return;
    wireToolbar(figure, [chart]);
    figure.classList.add("js-ready");
  }

  function wireDerivedToggle() {
    var box = document.getElementById("pack-derived-chrome");
    if (!box) {
      log("no DERIVED chrome toggle on page");
      return;
    }
    box.checked = derivedChromeOn();
    box.addEventListener("change", function () {
      setDerivedChrome(!!box.checked, true);
    });
    log("wired DERIVED chrome toggle", box.checked ? "on" : "off");
  }

  function boot() {
    setDerivedChrome(readDerivedChromePref(), false);
    wireDerivedToggle();
    var figs = document.querySelectorAll("figure.chart-interactive");
    log("boot interactive figures=", figs.length, "derivedChrome=", derivedChromeOn());
    figs.forEach(mount);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
