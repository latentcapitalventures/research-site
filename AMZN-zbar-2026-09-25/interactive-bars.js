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
 */
(function () {
  "use strict";

  var MODE_LABELS = {
    stacked: "Stacked",
    stacked100: "100%",
    grouped: "Grouped",
  };

  function log() {
    if (typeof console !== "undefined" && console.info) {
      console.info.apply(console, ["[pack-charts]"].concat([].slice.call(arguments)));
    }
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
    if (!any) return ds.color;
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
      if (!isLine && statuses.some(function (s) { return s === "DERIVED"; })) {
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
          if (isDerivedIndex(payload, items[0].dataIndex)) return lab + " · DERIVED";
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
            (ctx.dataset.statuses || [])[idx] === "DERIVED" ? " · DERIVED" : "";
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
    if (payload.hasDerived) {
      plugins.push({
        id: "packDerivedWatermark",
        afterDraw: function (chart) {
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
    return chart;
  }

  function wireToolbar(figure, chart) {
    if (!chart) return;
    var payload = chart._packPayload;
    if (!payload.composition) return;
    var toolbar = figure.querySelector(".chart-toolbar");
    if (!toolbar) return;
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
      chart._packMode = next;
      toolbar.querySelectorAll("button[data-mode]").forEach(function (btn) {
        btn.setAttribute("aria-pressed", btn.getAttribute("data-mode") === next ? "true" : "false");
      });
      chart.data.datasets = asChartDatasets(payload, next);
      chart.options.scales = scalesFor(payload, next);
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
    if (payload.panels && payload.panels.length) {
      var mounted = 0;
      payload.panels.forEach(function (panel, i) {
        panel.id = panel.id || payload.id + "-" + i;
        panel.composition = false;
        panel.modes = [];
        if (!panel.gapLabels && payload.gapLabels) panel.gapLabels = payload.gapLabels;
        if (mountChart(canvases[i], panel)) mounted += 1;
      });
      if (!mounted) return;
      figure.classList.add("js-ready");
      log("mounted panels", payload.id, "n=" + mounted);
      return;
    }
    var chart = mountChart(canvases[0], payload);
    if (!chart) return;
    wireToolbar(figure, chart);
    figure.classList.add("js-ready");
  }

  function boot() {
    var figs = document.querySelectorAll("figure.chart-interactive");
    log("boot interactive figures=", figs.length);
    figs.forEach(mount);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
