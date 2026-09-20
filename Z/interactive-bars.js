/**
 * House interactive bar charts (Chart.js).
 * Modes: stacked | stacked100 | grouped.
 * Tooltips: period label, each series $ value + % share of period total.
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

  function asChartValues(datasets, mode, totals) {
    return datasets.map(function (ds) {
      var data = ds.values.map(function (v, i) {
        if (v === null || v === undefined || Number.isNaN(v)) return null;
        if (mode === "stacked100") {
          var tot = totals[i];
          if (tot === null || tot === 0) return null;
          return (Number(v) / tot) * 100;
        }
        return Number(v);
      });
      return {
        label: ds.label,
        backgroundColor: ds.color,
        borderWidth: 0,
        data: data,
        rawValues: ds.values.slice(),
        stack: mode === "grouped" ? undefined : "pack",
      };
    });
  }

  function yScaleFor(mode, ylabel) {
    if (mode === "stacked100") {
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
    return {
      stacked: mode !== "grouped",
      beginAtZero: true,
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
    var unit = payload.unit || "";
    return {
      backgroundColor: "#fffcf7",
      titleColor: "#1c1915",
      bodyColor: "#1c1915",
      borderColor: "#d4cbb8",
      borderWidth: 1,
      displayColors: true,
      callbacks: {
        title: function (items) {
          return items.length ? items[0].label : "";
        },
        label: function (ctx) {
          var idx = ctx.dataIndex;
          var raw = ctx.dataset.rawValues ? ctx.dataset.rawValues[idx] : ctx.raw;
          var totals = payload._totals;
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
            " (" +
            fmtPct(share) +
            ")"
          );
        },
        footer: function (items) {
          if (!items.length) return "";
          var idx = items[0].dataIndex;
          var tot = payload._totals[idx];
          return "Total: " + fmtMoney(tot, unit);
        },
      },
    };
  }

  function mount(figure) {
    var raw = figure.querySelector("script.chart-data");
    var canvas = figure.querySelector("canvas");
    if (!raw || !canvas) {
      log("skip figure — missing data or canvas", figure.getAttribute("data-chart-id"));
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

    var modes = payload.modes && payload.modes.length ? payload.modes : ["stacked", "stacked100", "grouped"];
    var mode = payload.defaultMode && modes.indexOf(payload.defaultMode) >= 0 ? payload.defaultMode : modes[0];
    payload._totals = periodTotals(payload.datasets, payload.labels.length);

    var toolbar = figure.querySelector(".chart-toolbar");
    if (toolbar) {
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
    }

    var chart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: payload.labels,
        datasets: asChartValues(payload.datasets, mode, payload._totals),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "bottom",
            labels: { boxWidth: 12, color: "#1c1915", font: { size: 11 } },
          },
          tooltip: buildTooltip(payload),
        },
        scales: {
          x: {
            stacked: mode !== "grouped",
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
          y: yScaleFor(mode, payload.ylabel),
        },
      },
    });

    figure.classList.add("js-ready");
    log("mounted", payload.id, "mode=" + mode, "labels=" + payload.labels.length);

    function setMode(next) {
      if (modes.indexOf(next) < 0 || next === mode) return;
      mode = next;
      if (toolbar) {
        toolbar.querySelectorAll("button[data-mode]").forEach(function (btn) {
          btn.setAttribute("aria-pressed", btn.getAttribute("data-mode") === mode ? "true" : "false");
        });
      }
      chart.data.datasets = asChartValues(payload.datasets, mode, payload._totals);
      chart.options.scales.x.stacked = mode !== "grouped";
      chart.options.scales.y = yScaleFor(mode, payload.ylabel);
      chart.update();
      log("mode change", payload.id, mode);
    }
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
