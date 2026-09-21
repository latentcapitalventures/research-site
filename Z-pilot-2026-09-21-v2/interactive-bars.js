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
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    var n = Number(v);
    var abs = Math.abs(n);
    var body =
      abs >= 100
        ? n.toLocaleString(undefined, { maximumFractionDigits: 0 })
        : abs >= 10
          ? n.toLocaleString(undefined, { maximumFractionDigits: 1 })
          : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (!unit) return body;
    if (unit.charAt(0) === "$") return unit.charAt(0) + body + unit.slice(1);
    return body + " " + unit;
  }

  function fmtPct(share) {
    if (share === null || share === undefined || Number.isNaN(share)) return "—";
    return (share * 100).toFixed(1) + "%";
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
        if (mode === "stacked100") {
          var tot = totals[i];
          if (tot === null || tot === 0) return null;
          return (Number(v) / tot) * 100;
        }
        return Number(v);
      });
      var isLine = kind === "line";
      var spec = {
        type: isLine ? "line" : "bar",
        label: ds.label,
        backgroundColor: ds.color,
        borderColor: ds.color,
        borderWidth: isLine ? 2 : 0,
        pointRadius: isLine ? (ds.showLine === false ? 4 : data.length > 48 ? 0 : 3) : 0,
        pointHoverRadius: 4,
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

  function yScaleFor(mode, ylabel, composition, chartType) {
    if (mode === "stacked100" && composition) {
      return {
        stacked: true,
        beginAtZero: true,
        max: 100,
        ticks: {
          callback: function (v) {
            return v + "%";
          },
        },
        title: { display: true, text: "% of period total", color: "#5c574f" },
        grid: { color: "rgba(212,203,184,0.55)" },
      };
    }
    var isLine = chartType === "line";
    return {
      stacked: !!(composition && mode !== "grouped"),
      beginAtZero: !isLine,
      ticks: {
        callback: function (v) {
          return v;
        },
      },
      title: { display: !!ylabel, text: ylabel || "", color: "#5c574f" },
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
      callbacks: {
        title: function (items) {
          if (!items.length) return "";
          var raw = items[0].raw;
          if (raw && raw.label) return String(raw.label);
          return items[0].label || "";
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
          if (!composition) {
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
          if (!composition || !items.length) return "";
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
        y: yScaleFor("grouped", payload.ylabel, false, "line"),
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
      y: yScaleFor(mode, payload.ylabel, payload.composition, payload.chartType),
    };
    if (hasY1) {
      scales.y1 = {
        position: "right",
        stacked: false,
        beginAtZero: payload.chartType !== "line",
        grid: { drawOnChartArea: false },
        ticks: { color: "#5c574f" },
        title: {
          display: !!payload.y1Label,
          text: payload.y1Label || "",
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
    var modes =
      composition && payload.modes && payload.modes.length
        ? payload.modes
        : [];
    var mode = "grouped";
    if (composition) {
      mode =
        payload.defaultMode && modes.indexOf(payload.defaultMode) >= 0
          ? payload.defaultMode
          : modes[0] || "stacked";
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
