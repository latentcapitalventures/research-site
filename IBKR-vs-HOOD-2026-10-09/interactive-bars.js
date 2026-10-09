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
 * Zoom: wheel / pinch zooms both X (time) and Y around the cursor; scroll on
 * an axis to zoom that axis only; drag pans both; Shift-drag a box to set
 * X and Y together (crop an outlier without dropping it from the series).
 * Double-click or Reset zoom restores the house X window and full auto Y.
 * DERIVED warning chrome (hatch, red tint, watermark, tooltip suffix) can
 * be hidden from a page toggle without changing series statuses.
 *
 * House 2026-09-30: Labels chip (default OFF, persisted like DERIVED chrome);
 * CORE level charts may switch Levels / YoY (YoY is DERIVED from printed FACT
 * levels); optional quiet trendline when payload.trendline is true.
 *
 * Lattice craft (Designer lock): paper canvas, copper hero, indigo+sage
 * support, latest-only direct labels, one copper callout, faint y-grid,
 * no chart box. Tokens match pack/palette.py. No teal / navy / white card.
 * Latest-value bar labels measure with canvas measureText (same discipline
 * as category ticks), then stagger vertically on overlap; drop is last
 * resort (stack total > hero > leftmost dataset index > higher |value|).
 * Labels may sit in the canvas right padding (layout 52/72px); do not drop
 * solely for crossing chartArea.right. Dual primary lines stay indigo unless
 * the pack set key_colors / preserveSeriesColors.
 */
(function () {
  "use strict";

  var MODE_LABELS = {
    stacked: "Stacked",
    stacked100: "100%",
    grouped: "Grouped",
  };

  // Lattice identity tokens (locked — not a16z). Keep in sync with pack/palette.py.
  var LATTICE = {
    paper: "#F5F0E8",
    ink: "#1B1A17",
    line: "#9C958A",
    soft: "#5C564C",
    copper: "#B86B3C",
    alert: "#A8483C",
    indigo: "#3D4F6F",
    sage: "#5F7358",
    ochre: "#C4A04A",
    plum: "#6E4F62",
    slate: "#5E6670",
    clay: "#9A6B55",
    sea: "#3F6A68",
  };
  var STACK_SUPPORT = [
    LATTICE.indigo,
    LATTICE.sage,
    LATTICE.slate,
    LATTICE.ochre,
    LATTICE.plum,
    LATTICE.clay,
    LATTICE.sea,
  ];
  var FONT_SANS = "IBM Plex Sans, Inter, ui-sans-serif, system-ui, sans-serif";
  var FONT_SERIF = "Libre Baskerville, Georgia, Times New Roman, serif";
  var COPPER_MUTE = 0.78;
  var GRID_Y = "rgba(156,149,138,0.28)";
  var GRID_ZERO = "rgba(156,149,138,0.55)";

  var DERIVED_CHROME_KEY = "latent-pack-derived-chrome";
  var DATA_LABELS_KEY = "latent-pack-data-labels";
  var ZOOM_MIN_CATEGORIES = 4;
  var mountedCharts = [];

  function log() {
    if (typeof console !== "undefined" && console.info) {
      console.info.apply(console, ["[pack-charts]"].concat([].slice.call(arguments)));
    }
  }

  function hexToRgba(hex, a) {
    var h = String(hex || "").replace("#", "");
    if (h.length === 3) {
      h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    }
    var n = parseInt(h, 16);
    if (!isFinite(n)) return hex;
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  function isCopper(color) {
    var s = String(color || "").toUpperCase().replace(/\s/g, "");
    return s.indexOf("B86B3C") >= 0 || s.indexOf("184,107,60") >= 0;
  }

  function lastFiniteIndex(values) {
    if (!values || !values.length) return -1;
    for (var i = values.length - 1; i >= 0; i--) {
      var v = values[i];
      if (v !== null && v !== undefined && !Number.isNaN(Number(v))) return i;
    }
    return -1;
  }

  function firstFiniteIndex(values) {
    if (!values || !values.length) return -1;
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (v !== null && v !== undefined && !Number.isNaN(Number(v))) return i;
    }
    return -1;
  }

  function houseStackColor(index, n, fallback) {
    if (n <= 1) return LATTICE.copper;
    if (index >= n - 1) return LATTICE.copper;
    return STACK_SUPPORT[index % STACK_SUPPORT.length] || fallback || LATTICE.indigo;
  }

  function datasetHouseColor(ds, payload, index, n) {
    if (payload && payload.preserveSeriesColors) return ds.color;
    if (payload && payload.composition && n >= 2) return houseStackColor(index, n, ds.color);
    return ds.color;
  }

  function compactCategoryLabel(lab) {
    var s = String(lab || "");
    var m = s.match(/^FY(?:20)?(\d{2})Q([1-4])$/i);
    if (m) return "Q" + m[2] + "'" + m[1];
    m = s.match(/^FY(?:20)?(\d{2})$/i);
    if (m) return "FY" + m[1];
    return s;
  }

  /** Monday of an ISO week, as a real date ("31 Mar 2025"). Null for other labels. */
  function isoWeekDateLabel(lab) {
    var m = String(lab || "").match(/^(\d{4})-W(\d{2})$/);
    if (!m) return null;
    var year = Number(m[1]);
    var week = Number(m[2]);
    if (!isFinite(year) || !isFinite(week) || week < 1 || week > 53) return null;
    var jan4 = new Date(Date.UTC(year, 0, 4));
    var dow = jan4.getUTCDay() || 7;
    var monday = new Date(jan4.getTime());
    monday.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7);
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return monday.getUTCDate() + " " + months[monday.getUTCMonth()] + " " + monday.getUTCFullYear();
  }


  function showLineXTick(labels, index) {
    var n = labels.length;
    if (index === 0 || index === n - 1) return true;
    var lab = String(labels[index] || "");
    if (/Q4/i.test(lab)) return true;
    if (/W0?1\b/.test(lab) || /W5[0-3]\b/.test(lab)) return true;
    if (/^FY\d{4}$/i.test(lab) || /^FY\d{2}$/i.test(lab)) return true;
    return false;
  }

  function visibleCategorySpan(axis) {
    var labels = (axis.chart && axis.chart.data && axis.chart.data.labels) || [];
    var n = labels.length;
    if (!n) return { min: 0, max: 0, n: 0 };
    var min = axis.min;
    var max = axis.max;
    if (min == null || !isFinite(Number(min))) min = 0;
    if (max == null || !isFinite(Number(max))) max = n - 1;
    min = Math.max(0, Math.floor(Number(min)));
    max = Math.min(n - 1, Math.ceil(Number(max)));
    if (max < min) max = min;
    return { min: min, max: max, n: n };
  }

  function visibleWindowIsWeekly(labels, min, max) {
    var hi = Math.min(max, min + 7);
    for (var p = min; p <= hi; p++) {
      if (/^\d{4}-W\d{2}$/.test(String(labels[p] || ""))) return true;
    }
    return false;
  }

  function displayCategoryLabel(lab) {
    var dated = isoWeekDateLabel(lab);
    if (dated) return dated;
    return compactCategoryLabel(lab);
  }

  function plotAreaWidth(chart) {
    var area = chart && chart.chartArea;
    if (area && isFinite(area.left) && isFinite(area.right) && area.right > area.left) {
      return area.right - area.left;
    }
    return 0;
  }

  function measureTickText(chart, text) {
    var ctx = chart && chart.ctx;
    var s = String(text || "");
    if (!ctx || !s) return 0;
    ctx.save();
    ctx.font = "11px " + FONT_SANS;
    var w = ctx.measureText(s).width;
    ctx.restore();
    return w;
  }

  /**
   * Same canvas measureText discipline as ticks, plus height.
   * Prefer actualBoundingBoxAscent+Descent; 13px fallback for an 11px face.
   */
  function measureCraftLabel(chart, text, fontSpec) {
    var ctx = chart && chart.ctx;
    var s = String(text || "");
    if (!ctx || !s) return { w: 0, h: 0 };
    ctx.save();
    ctx.font = fontSpec || ("600 11px " + FONT_SANS);
    var m = ctx.measureText(s);
    var w = m.width;
    var ascent = m.actualBoundingBoxAscent;
    var descent = m.actualBoundingBoxDescent;
    var h =
      typeof ascent === "number" &&
      isFinite(ascent) &&
      typeof descent === "number" &&
      isFinite(descent)
        ? ascent + descent
        : 13;
    ctx.restore();
    if (!(w > 0)) w = 0;
    if (!(h > 0)) h = 13;
    return { w: w, h: h };
  }

  // ~4px: 18 FY labels (~24px) fit on ~32px pitch at ~575px plot width.
  // 8px left ~6–7px leftover and budgeted 17/18 (blank FY16).
  var TICK_LABEL_GAP = 4;
  var WEEKLY_TICK_CAP = 8;
  // Latest-value bar labels: same 4px gap as ticks. Drop only after stagger.
  var CRAFT_LABEL_GAP = 4;
  var CRAFT_LABEL_MAX_STAGGER = 4;

  function craftLabelBox(x, y, w, h, align, baseline) {
    var left = x;
    if (align === "center") left = x - w / 2;
    else if (align === "right") left = x - w;
    var top = y;
    if (baseline === "middle") top = y - h / 2;
    else if (baseline === "bottom") top = y - h;
    return { left: left, right: left + w, top: top, bottom: top + h, w: w, h: h };
  }

  function craftBoxesOverlap(a, b, gap) {
    var g = gap == null ? CRAFT_LABEL_GAP : gap;
    return !(
      a.right + g <= b.left ||
      b.right + g <= a.left ||
      a.bottom + g <= b.top ||
      b.bottom + g <= a.top
    );
  }

  /**
   * Keep order (lower rank number wins — drop is last resort after stagger):
   *   0. kind === "total" (composition stack sum above the last category)
   *   1. hero series
   *   2. lower dataset index (leftmost; pack ticker is typically keys[0])
   *   3. higher |value|
   *   4. original collect order
   */
  function craftLabelRank(item) {
    var kindRank = item && item.kind === "total" ? 0 : 1;
    var heroRank = item && item.hero ? 0 : 1;
    var di = item && typeof item.di === "number" ? item.di : 99;
    var abs =
      item && isFinite(Number(item.value)) ? -Math.abs(Number(item.value)) : 0;
    var orig = item && typeof item._i === "number" ? item._i : 0;
    return [kindRank, heroRank, di, abs, orig];
  }

  function compareCraftLabelRank(a, b) {
    var pa = craftLabelRank(a);
    var pb = craftLabelRank(b);
    var k;
    for (k = 0; k < pa.length; k++) {
      if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
    }
    return 0;
  }

  function craftLabelRightLimit(area) {
    if (!area) return null;
    if (typeof area.canvasRight === "number" && isFinite(area.canvasRight)) {
      return area.canvasRight;
    }
    // No canvas bound: do not treat chartArea.right as a clip. Latest bars
    // sit on the plot edge; labels belong in the layout right padding.
    return null;
  }

  function craftLabelInArea(box, area) {
    if (!area) return true;
    if (box.top < area.top - 2 || box.bottom > area.bottom + 2) return false;
    if (box.left < area.left - 4) return false;
    var rightLimit = craftLabelRightLimit(area);
    if (rightLimit != null && box.right > rightLimit) return false;
    return true;
  }

  function craftLabelHitsOccupied(box, placed, occupied) {
    var i;
    for (i = 0; i < (placed || []).length; i++) {
      if (craftBoxesOverlap(box, placed[i].box)) return true;
    }
    for (i = 0; i < (occupied || []).length; i++) {
      if (craftBoxesOverlap(box, occupied[i])) return true;
    }
    return false;
  }

  /**
   * Place latest-value labels without overlap. High-priority labels keep their
   * anchor; others stagger vertically (up, then down) by height+gap. Labels
   * may use the canvas right padding (area.canvasRight, typically
   * chart.width-4). A small left nudge keeps a box on-canvas when it would
   * otherwise clip. Drop only on a real overlap after stagger — never solely
   * because the box crossed chartArea.right. Rank-0 stack totals that still
   * miss a slot (right-edge overrun, callout graze) stay put.
   */
  function resolveCraftLabelCollisions(items, area, occupied) {
    var ranked = (items || []).map(function (it, i) {
      var copy = {};
      var key;
      for (key in it) {
        if (Object.prototype.hasOwnProperty.call(it, key)) copy[key] = it[key];
      }
      copy._i = i;
      return copy;
    });
    ranked.sort(compareCraftLabelRank);
    var placed = [];
    var dropped = [];
    var obstacles = occupied || [];
    ranked.forEach(function (it) {
      var step = (it.h || 13) + CRAFT_LABEL_GAP;
      var offsets = [0];
      var n;
      for (n = 1; n <= CRAFT_LABEL_MAX_STAGGER; n++) {
        offsets.push(-n * step);
        offsets.push(n * step);
      }
      var found = null;
      var o;
      var align = it.align || "center";
      var baseline = it.baseline || "middle";
      var rightLimit = craftLabelRightLimit(area);
      for (o = 0; o < offsets.length; o++) {
        var y = it.y + offsets[o];
        var x = it.x;
        var box = craftLabelBox(x, y, it.w, it.h, align, baseline);
        if (rightLimit != null && box.right > rightLimit) {
          x = x - (box.right - rightLimit);
          box = craftLabelBox(x, y, it.w, it.h, align, baseline);
        }
        if (!craftLabelInArea(box, area)) continue;
        if (craftLabelHitsOccupied(box, placed, obstacles)) continue;
        found = {
          item: it,
          x: x,
          y: y,
          box: box,
          staggered: offsets[o] !== 0,
          nudged: x !== it.x,
        };
        if (area && box.right > area.right + 4) {
          log(
            "craft keep in right padding",
            it.key || it.text,
            it.text,
            "over=" + Math.round(box.right - area.right)
          );
        }
        if (found.nudged) {
          log("craft nudge left into padding", it.key || it.text, it.text, "dx=" + Math.round(x - it.x));
        }
        break;
      }
      if (found) {
        placed.push(found);
      } else if (it.kind === "total") {
        var tx = it.x;
        var ty = it.y;
        var tbox = craftLabelBox(tx, ty, it.w, it.h, align, baseline);
        if (rightLimit != null && tbox.right > rightLimit) {
          tx = tx - (tbox.right - rightLimit);
          tbox = craftLabelBox(tx, ty, it.w, it.h, align, baseline);
        }
        placed.push({
          item: it,
          x: tx,
          y: ty,
          box: tbox,
          staggered: false,
          nudged: tx !== it.x,
          keptOverflow: true,
        });
        log("craft keep rank-0 total", it.text, "right-edge/callout did not drop it");
      } else {
        dropped.push(it);
        log("craft drop after stagger", it.key || it.text, it.text);
      }
    });
    return { placed: placed, dropped: dropped };
  }

  function measureMaxTickWidth(axis) {
    var chart = axis && axis.chart;
    var labels = (chart && chart.data && chart.data.labels) || [];
    var span = visibleCategorySpan(axis);
    var firstText = displayCategoryLabel(labels[span.min]);
    var lastText = displayCategoryLabel(labels[span.max]);
    var firstW = measureTickText(chart, firstText);
    var lastW = measureTickText(chart, lastText);
    var maxW = Math.max(firstW, lastW);
    for (var p = span.min; p <= span.max; p++) {
      var dated = isoWeekDateLabel(labels[p]);
      if (dated) {
        maxW = Math.max(maxW, measureTickText(chart, dated));
        break;
      }
    }
    if (!(maxW > 0)) maxW = 28;
    if (!(firstW > 0)) firstW = maxW;
    if (!(lastW > 0)) lastW = maxW;
    return { firstW: firstW, lastW: lastW, maxW: maxW };
  }

  /**
   * Keep min, min+step, min+2*step, … and always the last index.
   * If the second-to-last falls within one step of last, drop it.
   * Never drop min — first and last stay pinned.
   */
  function keepStepped(min, max, step) {
    var k = Math.floor(Number(step));
    if (!(k >= 1)) k = 1;
    var out = [];
    var i;
    for (i = min; i < max; i += k) out.push(i);
    if (!out.length) out.push(min);
    if (out[out.length - 1] !== max) {
      if (out.length >= 2 && max - out[out.length - 1] < k) out.pop();
      out.push(max);
    }
    return out;
  }

  function keptTicksFit(axis, kept, pitch) {
    var chart = axis && axis.chart;
    var labels = (chart && chart.data && chart.data.labels) || [];
    var measured = measureMaxTickWidth(axis);
    var a;
    for (a = 1; a < kept.length; a++) {
      var prevW = measureTickText(chart, displayCategoryLabel(labels[kept[a - 1]]));
      var nextW = measureTickText(chart, displayCategoryLabel(labels[kept[a]]));
      if (!(prevW > 0)) prevW = measured.maxW;
      if (!(nextW > 0)) nextW = measured.maxW;
      var dx = (kept[a] - kept[a - 1]) * pitch;
      if (dx < prevW / 2 + nextW / 2 + TICK_LABEL_GAP) return false;
    }
    return true;
  }

  /**
   * Smallest whole-category step k ≥ 1 whose keepStepped labels fit.
   * pitch = plotWidth / visN (half-category inset at each end is the
   * center-align end reserve). Weekly windows also require keep-count
   * ≤ WEEKLY_TICK_CAP. Do not guess 640px — return 0 until chartArea exists.
   */
  function categoryTickStep(axis) {
    var chart = axis && axis.chart;
    var width = plotAreaWidth(chart);
    if (!(width > 0)) return 0;
    var span = visibleCategorySpan(axis);
    var visN = span.max - span.min + 1;
    if (visN <= 1) return 1;
    var pitch = width / visN;
    if (!(pitch > 0)) return 0;
    var labels = (chart.data && chart.data.labels) || [];
    var weekly = visibleWindowIsWeekly(labels, span.min, span.max);
    var measured = measureMaxTickWidth(axis);
    var kMin = Math.ceil((measured.maxW + TICK_LABEL_GAP) / pitch);
    if (!(kMin >= 1)) kMin = 1;
    var k;
    for (k = 1; k < visN; k++) {
      var kept = keepStepped(span.min, span.max, k);
      if (weekly && kept.length > WEEKLY_TICK_CAP) continue;
      if (k < kMin && !weekly) continue;
      if (keptTicksFit(axis, kept, pitch)) return k;
    }
    log(
      "category tick step fallback first+last",
      (chart._packPayload && chart._packPayload.id) || "",
      "visN=" + visN,
      "pitch=" + Math.round(pitch * 10) / 10
    );
    return visN - 1;
  }

  /** How many displayed category labels fit in the current plot width. */
  function categoryTickBudget(axis) {
    var step = categoryTickStep(axis);
    if (!(step > 0)) return 0;
    var span = visibleCategorySpan(axis);
    var visN = span.max - span.min + 1;
    if (visN <= 1) return visN;
    return keepStepped(span.min, span.max, step).length;
  }

  /**
   * Thin visible category ticks in whole-category steps (keepStepped).
   * Even Math.round spacing can land kept ticks one category apart;
   * a whole-category k never places neighbours side-by-side when they
   * don't fit. afterBuildTicks often runs before chartArea exists;
   * afterLayout recounts once the width is real.
   */
  function pinCategoryEndTicks(axis) {
    var labels = (axis.chart && axis.chart.data && axis.chart.data.labels) || [];
    var n = labels.length;
    if (!n || !axis.ticks) return;
    var span = visibleCategorySpan(axis);
    var visN = span.max - span.min + 1;
    var weekly = visibleWindowIsWeekly(labels, span.min, span.max);
    var step = categoryTickStep(axis);
    if (!(step > 0)) {
      log(
        "category ticks wait for layout",
        (axis.chart && axis.chart._packPayload && axis.chart._packPayload.id) || "",
        "visN=" + visN
      );
      return;
    }
    var kept = keepStepped(span.min, span.max, step);
    var next = [];
    var t;
    for (t = 0; t < kept.length; t++) next.push({ value: kept[t] });
    axis.ticks = next;
    log(
      "category ticks",
      (axis.chart && axis.chart._packPayload && axis.chart._packPayload.id) || "",
      span.min + ".." + span.max,
      "of",
      n,
      "kept=" + next.length,
      "step=" + step,
      weekly ? "weekly-dates" : "labels",
      "width=" + Math.round(plotAreaWidth(axis.chart))
    );
  }

  function recountCategoryTicksIfNeeded(chart) {
    if (!chart || chart._packTickRecounting) return;
    var x = chart.scales && chart.scales.x;
    if (!x || x.type === "linear" || x.type === "time") return;
    var w = plotAreaWidth(chart);
    if (!(w > 0)) return;
    var step = categoryTickStep(x);
    if (!(step > 0)) return;
    var span = visibleCategorySpan(x);
    var visN = span.max - span.min + 1;
    var rounded = Math.round(w);
    if (
      chart._packTickStep === step &&
      chart._packTickAreaW === rounded &&
      chart._packTickVisN === visN
    ) {
      return;
    }
    if ((chart._packTickRecounts || 0) >= 3) {
      log(
        "category tick recount capped",
        chart._packPayload && chart._packPayload.id,
        "width=" + rounded,
        "step=" + step,
        "visN=" + visN
      );
      return;
    }
    chart._packTickRecounts = (chart._packTickRecounts || 0) + 1;
    chart._packTickStep = step;
    chart._packTickBudget = keepStepped(span.min, span.max, step).length;
    chart._packTickAreaW = rounded;
    chart._packTickVisN = visN;
    chart._packTickRecounting = true;
    log(
      "category tick recount",
      chart._packPayload && chart._packPayload.id,
      "width=" + rounded,
      "step=" + step,
      "kept=" + chart._packTickBudget,
      "visN=" + visN
    );
    try {
      chart.update("none");
    } finally {
      chart._packTickRecounting = false;
    }
  }

  function resetTickBudget(chart) {
    if (!chart) return;
    chart._packTickBudget = null;
    chart._packTickStep = null;
    chart._packTickAreaW = null;
    chart._packTickVisN = null;
    chart._packTickRecounts = 0;
  }

  function pinHouseDefaults() {
    if (typeof Chart === "undefined" || Chart._packLatticePinned) return;
    Chart.defaults.font.family = FONT_SANS;
    Chart.defaults.font.size = 11;
    Chart.defaults.color = LATTICE.soft;
    Chart.defaults.borderColor = "transparent";
    Chart.defaults.backgroundColor = LATTICE.paper;
    Chart.defaults.elements.line.borderWidth = 2;
    Chart.defaults.elements.line.tension = 0;
    Chart.defaults.elements.bar.borderWidth = 0;
    Chart.defaults.plugins.legend.position = "bottom";
    Chart.defaults.plugins.legend.align = "start";
    Chart.defaults.plugins.legend.labels.color = LATTICE.soft;
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.plugins.legend.labels.font = { family: FONT_SANS, size: 11 };
    Chart.defaults.plugins.title.color = LATTICE.ink;
    Chart.defaults.plugins.title.font = { family: FONT_SERIF, size: 18, weight: "normal" };
    Chart.defaults.plugins.title.display = false;
    Chart._packLatticePinned = true;
    log("pinned Lattice Chart.js defaults", LATTICE.paper, LATTICE.copper, LATTICE.indigo);
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

  function dataLabelsOn() {
    return document.documentElement.classList.contains("data-labels-on");
  }

  function readDataLabelsPref() {
    try {
      var stored = localStorage.getItem(DATA_LABELS_KEY);
      if (stored === "on") return true;
      if (stored === "off") return false;
    } catch (err) {
      log("data labels preference unread", err);
    }
    return false;
  }

  function setDataLabels(on, persist) {
    document.documentElement.classList.toggle("data-labels-on", !!on);
    document.documentElement.setAttribute("data-data-labels", on ? "on" : "off");
    var box = document.getElementById("pack-data-labels");
    if (box && box.checked !== !!on) box.checked = !!on;
    document.querySelectorAll("button[data-data-labels]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (persist !== false) {
      try {
        localStorage.setItem(DATA_LABELS_KEY, on ? "on" : "off");
        log("data labels preference saved", on ? "on" : "off");
      } catch (err) {
        log("data labels preference not stored", err);
      }
    }
    mountedCharts.forEach(function (chart) {
      if (chart && typeof chart.update === "function") chart.update("none");
    });
    log("data labels", on ? "on" : "off", "charts=", mountedCharts.length);
  }

  function seriesModeOf(chart) {
    return (chart && chart._packSeriesMode) || "levels";
  }

  function payloadView(payload, seriesMode) {
    if (!payload) return payload;
    if (seriesMode === "yoy" && payload.yoyDatasets && payload.yoyDatasets.length) {
      var view = Object.assign({}, payload, {
        datasets: payload.yoyDatasets,
        ylabel: "YoY %",
        unit: "%",
        hasDerived: true,
        composition: false,
        trendline: false,
      });
      delete view.yDisplayScale;
      delete view.yDisplayUnit;
      delete view.y1DisplayScale;
      delete view.yCap;
      log("series mode yoy", payload.id, "datasets=", payload.yoyDatasets.length);
      return view;
    }
    return payload;
  }

  function restyleChart(chart) {
    if (!chart || !chart._packPayload) return;
    var zoom = snapshotZoom(chart);
    var seriesMode = seriesModeOf(chart);
    var view = payloadView(chart._packPayload, seriesMode);
    var mode = chart._packMode || "grouped";
    chart.data.datasets = asChartDatasets(view, mode);
    chart.options.scales = scalesFor(view, mode);
    if (chart.options.plugins) {
      chart.options.plugins.tooltip = buildTooltip(view);
      chart.options.plugins.legend = houseLegend(view);
    }
    restoreZoom(chart, zoom);
    chart._packYFull = null;
    resetTickBudget(chart);
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

  function fmtFixed(n, digits) {
    var s = Number(n).toFixed(digits);
    if (s.indexOf(".") >= 0) {
      s = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    }
    if (s === "-0") return "0";
    return s;
  }

  function fmtMoney(v, unit, digits) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
    var n = Number(v);
    var abs = Math.abs(n);
    // Dollars stay whole. Multiples and rates (PE 16.86, TAC 19.8) keep two decimals.
    // A chart may ask for more places (DPS 0.025 + 0.25 = 0.275, not 0.28).
    var places = digits != null && digits !== "" ? Number(digits) : abs >= 1000 ? 0 : 2;
    var body =
      digits != null && digits !== ""
        ? fmtFixed(n, places)
        : n.toLocaleString(undefined, { maximumFractionDigits: places });
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

  /** Sum every finite segment at one category — unlabeled / thin / collision-dropped still count. */
  function stackCategoryTotal(datasets, index) {
    var t = 0;
    var any = false;
    if (!datasets || !(index >= 0)) return 0;
    var d;
    for (d = 0; d < datasets.length; d++) {
      var ds = datasets[d];
      if (!ds) continue;
      var vals = ds.values || ds.data || [];
      var v = vals[index];
      if (v !== null && v !== undefined && !Number.isNaN(Number(v))) {
        t += Number(v);
        any = true;
      }
    }
    return any ? t : 0;
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

  function muteCopperFill(fill, values, color) {
    if (!isCopper(color)) return fill;
    var last = lastFiniteIndex(values);
    if (last < 0) return fill;
    function mutedAt(i, current) {
      if (i === last) return current || color;
      if (current && typeof current !== "string") return current;
      return hexToRgba(color, COPPER_MUTE);
    }
    if (typeof fill !== "object" || !fill || !fill.length) {
      return values.map(function (_v, i) {
        return mutedAt(i, fill);
      });
    }
    return values.map(function (_v, i) {
      return mutedAt(i, fill[i]);
    });
  }

  function isPrimaryLine(payload, ds) {
    if (ds.dashed || ds.overlay === "forward") return false;
    var list = payload.datasets || [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      var kind = d.type || (payload.chartType === "line" ? "line" : "bar");
      if (kind !== "line") continue;
      if (d.dashed || d.overlay === "forward") continue;
      return d.key === ds.key || d === ds;
    }
    return false;
  }

  function asChartDatasets(payload, mode) {
    var totals = payload._totals || [];
    var nSeries = (payload.datasets || []).length;
    return (payload.datasets || []).map(function (ds, di) {
      var kind = ds.type || (payload.chartType === "line" ? "line" : "bar");
      var color = datasetHouseColor(ds, payload, di, nSeries);
      var houseDs = Object.assign({}, ds, { color: color });
      if (payload.chartType === "scatter" || kind === "scatter") {
        return {
          type: "scatter",
          label: ds.label,
          backgroundColor: color,
          borderColor: color,
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
      var last = lastFiniteIndex(values);
      var primary = isLine && isPrimaryLine(payload, ds);
      // key_colors / preserveSeriesColors keeps ds.color (weekly yield copper).
      // Dual payloads default the line to P.ALERT (#A8483C); without the indigo
      // override those charts paint DERIVED-warning red. House default for an
      // ordinary primary line is Lattice indigo, matching main.
      var stroke =
        primary && !ds.dashed && !(payload && payload.preserveSeriesColors)
          ? LATTICE.indigo
          : color || LATTICE.indigo;
      if (isLine) {
        log(
          "line stroke",
          payload.id,
          ds.key || ds.label,
          stroke,
          primary ? "primary" : "support",
          payload && payload.preserveSeriesColors ? "preserve" : "house",
          color
        );
      }
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
        backgroundColor: isLine ? stroke : barFill(houseDs, payload),
        borderColor: isLine ? stroke : color,
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
        packHero: !!ds.hero,
        packColor: color,
      };
      if (ds.borderDash && ds.borderDash.length) {
        spec.borderDash = ds.borderDash.slice();
      } else if (ds.dashed) {
        spec.borderDash = [5, 4];
      }
      if (spec.borderDash) {
        spec.borderWidth = isLine ? 2 : spec.borderWidth;
        spec.pointRadius = isLine ? 4 : spec.pointRadius;
        log("dashed dataset", payload.id, ds.key || ds.label, stroke);
      }
      if (ds.hollow) {
        spec.pointBackgroundColor = "transparent";
        spec.pointBorderColor = stroke;
        spec.pointBorderWidth = 1.6;
        spec.backgroundColor = "transparent";
        log("hollow marker", payload.id, ds.key || ds.label, stroke);
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
            return statuses[i] === "DERIVED" ? hatchPattern(color) : color;
          });
          spec.borderColor = color;
          spec.borderWidth = 0;
          log("DERIVED tint kept (series color + hatch)", payload.id, ds.key || ds.label);
        } else {
          spec.backgroundColor = values.map(function (_v, i) {
            return statuses[i] === "DERIVED" ? "rgba(168,72,60,0.42)" : color;
          });
          spec.borderColor = values.map(function (_v, i) {
            return statuses[i] === "DERIVED" ? LATTICE.alert : color;
          });
          spec.borderWidth = values.map(function (_v, i) {
            return statuses[i] === "DERIVED" ? 1.5 : (isLine ? 2 : 0);
          });
          log("DERIVED bar styling", payload.id, ds.key || ds.label);
        }
      }
      if (!isLine) {
        spec.backgroundColor = muteCopperFill(spec.backgroundColor, values, color);
      }
      if (isLine) {
        spec.pointRadius = values.map(function (_v, i) {
          if (Array.isArray(radius)) return radius[i] || 0;
          if (i === last) return primary ? 5 : radius || 3;
          if (data.length > 48) return 0;
          return primary ? 2.25 : radius || 3;
        });
        spec.pointBackgroundColor = values.map(function (_v, i) {
          if (i === last && primary) return LATTICE.copper;
          return hexToRgba(stroke, 0.55);
        });
        spec.pointBorderColor = values.map(function (_v, i) {
          if (i === last && primary) return LATTICE.paper;
          return stroke;
        });
        spec.pointBorderWidth = values.map(function (_v, i) {
          return i === last && primary ? 2 : 0;
        });
        spec.pointHoverRadius = values.map(function (_v, i) {
          return i === last && primary ? 6 : 5;
        });
        log(
          "line craft",
          payload.id,
          ds.key || ds.label,
          "primary=",
          primary,
          "stroke=",
          stroke,
          "last=",
          last
        );
      }
      if (!isLine && payload.composition && mode !== "grouped") {
        spec.stack = "pack";
      }
      return spec;
    });
  }

  function yGridColor(ctx) {
    var v = ctx && ctx.tick ? ctx.tick.value : null;
    return v === 0 ? GRID_ZERO : GRID_Y;
  }

  function yGridWidth(ctx) {
    var v = ctx && ctx.tick ? ctx.tick.value : null;
    return v === 0 ? 1.15 : 1;
  }

  function latticeAxisChrome(extra) {
    var out = {
      ticks: { color: LATTICE.soft, font: { size: 11, family: FONT_SANS } },
      title: { color: LATTICE.soft, font: { size: 11, family: FONT_SANS } },
      border: { display: false },
      grid: {
        color: yGridColor,
        lineWidth: yGridWidth,
        drawBorder: false,
      },
    };
    if (extra) {
      Object.keys(extra).forEach(function (k) {
        if (extra[k] && typeof extra[k] === "object" && !Array.isArray(extra[k]) && out[k]) {
          out[k] = Object.assign({}, out[k], extra[k]);
        } else {
          out[k] = extra[k];
        }
      });
    }
    return out;
  }

  function yScaleFor(mode, ylabel, composition, chartType, payload) {
    if (mode === "stacked100" && composition) {
      var percentShare = isPercentShare(payload);
      var scale = latticeAxisChrome({
        stacked: true,
        beginAtZero: true,
        ticks: {
          color: LATTICE.soft,
          font: { size: 11, family: FONT_SANS },
          autoSkip: false,
          includeBounds: true,
          maxTicksLimit: 11,
          callback: function (v) {
            return v + "%";
          },
        },
        title: {
          display: true,
          text: percentShare ? ylabel || "% share" : "% of period total",
          color: LATTICE.soft,
          font: { size: 11, family: FONT_SANS },
        },
      });
      if (!percentShare) scale.max = 100;
      return scale;
    }
    var isLine = chartType === "line";
    var axis = displayAxis(payload || {}, "y", ylabel);
    var scale = latticeAxisChrome({
      stacked: !!(composition && mode !== "grouped"),
      beginAtZero: !isLine,
      ticks: {
        color: LATTICE.soft,
        font: { size: 11, family: FONT_SANS },
        autoSkip: false,
        includeBounds: true,
        maxTicksLimit: 11,
        callback: function (v) {
          return fmtTick(v, axis.scale);
        },
      },
      title: {
        display: !!axis.title,
        text: axis.title || "",
        color: LATTICE.soft,
        font: { size: 11, family: FONT_SANS },
      },
    });
    if (composition && mode !== "stacked100") scale.grace = "12%";
    if (!composition) applyYCapToScale(scale, payload);
    return scale;
  }

  // Opt-in y-axis cap (payload.yCap, set only when a chart_plan entry has
  // y_cap). Bars beyond the cap are drawn to the edge with a break marker and
  // a true-value label; the data values are not changed.
  function yCapOf(payload) {
    var cap = payload && payload.yCap;
    if (!cap || typeof cap !== "object") return null;
    var hasMax = typeof cap.max === "number" && isFinite(cap.max);
    var hasMin = typeof cap.min === "number" && isFinite(cap.min);
    if (!hasMax && !hasMin) return null;
    return { max: hasMax ? cap.max : null, min: hasMin ? cap.min : null };
  }

  function applyYCapToScale(scale, payload) {
    var cap = yCapOf(payload);
    if (!cap || !scale) return;
    if (cap.max !== null) scale.max = cap.max;
    if (cap.min !== null) scale.min = cap.min;
  }

  function restoreYCap(chart, yScale) {
    if (!chart || !yScale || seriesModeOf(chart) === "yoy") return;
    if (chart._packMode === "stacked100") return;
    applyYCapToScale(yScale, chart._packPayload);
  }

  function yCapLabel(v, unit) {
    var num = Number(v);
    var sign = num > 0 ? "+" : num < 0 ? "\u2212" : "";
    var mag = Math.abs(num);
    var body = mag >= 100
      ? Math.round(mag).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
      : mag.toFixed(1);
    return sign + body + (unit === "%" ? "%" : "");
  }

  function yCapClipped(chart, fn) {
    var payload = chart && chart._packPayload;
    if (seriesModeOf(chart) === "yoy") return;
    var cap = yCapOf(payload);
    if (!cap) return;
    var yScale = chart.scales && chart.scales.y;
    var area = chart.chartArea;
    if (!yScale || !area) return;
    (chart.data.datasets || []).forEach(function (ds, di) {
      var meta = chart.getDatasetMeta(di);
      if (!meta || meta.hidden) return;
      (ds.data || []).forEach(function (v, i) {
        if (v === null || v === undefined) return;
        var num = Number(v);
        if (!isFinite(num)) return;
        var side = null;
        if (cap.max !== null && num > cap.max) side = "max";
        else if (cap.min !== null && num < cap.min) side = "min";
        if (!side) return;
        var el = meta.data && meta.data[i];
        if (!el) return;
        var x = el.x;
        if (!(x >= area.left && x <= area.right)) return;
        var edge = yScale.getPixelForValue(side === "max" ? cap.max : cap.min);
        fn({ el: el, x: x, edge: edge, side: side, value: num, ds: ds, area: area });
      });
    });
  }

  function drawYCapBreaks(chart) {
    var ctx = chart.ctx;
    ctx.save();
    yCapClipped(chart, function (c) {
      var w = Math.max(4, (c.el.width || 8) + 2);
      var off = c.side === "max" ? 9 : -9;
      var y0 = c.edge + off;
      ctx.strokeStyle = LATTICE.paper;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(c.x - w / 2, y0 + 2);
      ctx.lineTo(c.x + w / 2, y0 - 2);
      ctx.moveTo(c.x - w / 2, y0 + 6);
      ctx.lineTo(c.x + w / 2, y0 + 2);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawYCapLabels(chart) {
    var ctx = chart.ctx;
    var view = chart._packPayload || {};
    var items = [];
    ctx.save();
    ctx.font = "700 10px " + FONT_SANS;
    yCapClipped(chart, function (c) {
      var text = yCapLabel(c.value, c.ds.unit || view.unit || "");
      var tw = ctx.measureText(text).width;
      var x = Math.min(Math.max(c.x, c.area.left + tw / 2), c.area.right - tw / 2);
      items.push({ text: text, x: x, w: tw, side: c.side, edge: c.edge });
    });
    // Stagger labels that would collide: a second row sits one line further out.
    items.sort(function (a, b) { return a.x - b.x; });
    var lastRight = { max: [-Infinity, -Infinity], min: [-Infinity, -Infinity] };
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    items.forEach(function (it) {
      var rows = lastRight[it.side];
      var left = it.x - it.w / 2;
      var row = left > rows[0] + 3 ? 0 : left > rows[1] + 3 ? 1 : 0;
      rows[row] = it.x + it.w / 2;
      var y = it.side === "max" ? it.edge - 2 - row * 12 : it.edge - 4 - row * 12;
      ctx.lineWidth = 3;
      ctx.strokeStyle = LATTICE.paper;
      ctx.strokeText(it.text, it.x, y);
      ctx.fillStyle = LATTICE.ink;
      ctx.fillText(it.text, it.x, y);
    });
    ctx.restore();
  }

  function buildTooltip(payload) {
    var composition = !!payload.composition;
    return {
      backgroundColor: LATTICE.paper,
      titleColor: LATTICE.ink,
      bodyColor: LATTICE.ink,
      borderColor: LATTICE.line,
      borderWidth: 1,
      titleFont: { family: FONT_SANS, size: 12 },
      bodyFont: { family: FONT_SANS, size: 11 },
      footerFont: { family: FONT_SANS, size: 11 },
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
          var sets = payload.datasets || [];
          var ds0 = sets[items[0].datasetIndex] || {};
          if (
            (ds0.statuses || [])[items[0].dataIndex] === "CALCULATED" &&
            String(ds0.label || "").toLowerCase().indexOf("calculated") < 0
          ) {
            return lab + " · calculated";
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
          var st = (ctx.dataset.statuses || [])[idx];
          var labelAlreadyCalculated =
            String(ctx.dataset.label || "").toLowerCase().indexOf("calculated") >= 0;
          var derived =
            derivedChromeOn() && st === "DERIVED"
              ? " · DERIVED"
              : st === "CALCULATED" && !labelAlreadyCalculated
                ? " · calculated"
                : "";
          var moneyDigits = payload.valueDecimals;
          if (!composition || isPercentShare(payload)) {
            return " " + ctx.dataset.label + ": " + fmtMoney(raw, unit, moneyDigits) + derived;
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
            fmtMoney(raw, unit, payload.valueDecimals) +
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
            var gapIdx = items[0].dataIndex;
            var allBlank = (payload.datasets || []).every(function (ds) {
              var raw = ds.rawValues ? ds.rawValues[gapIdx] : (ds.data || [])[gapIdx];
              return raw === null || raw === undefined;
            });
            if (allBlank) return "Labeled gap — this quarter is not printed";
          }
          if (!composition) return "";
          var idx = items[0].dataIndex;
          var tot = (payload._totals || [])[idx];
          return "Total: " + fmtMoney(tot, payload.unit || "", payload.valueDecimals);
        },
      },
    };
  }

  function scalesFor(payload, mode) {
    var isLine = payload.chartType === "line";
    var labels = payload.labels || [];
    if (payload.chartType === "scatter") {
      return {
        x: latticeAxisChrome({
          type: "linear",
          title: {
            display: !!payload.xlabel,
            text: payload.xlabel || "",
            color: LATTICE.soft,
            font: { size: 11, family: FONT_SANS },
          },
        }),
        y: yScaleFor("grouped", payload.ylabel, false, "line", payload),
      };
    }
    var hasY1 = (payload.datasets || []).some(function (ds) {
      return ds.yAxisID === "y1";
    });
    var scales = {
      x: {
        stacked: !!(payload.composition && mode !== "grouped"),
        afterBuildTicks: function (axis) {
          // Whole-category step thinning on the visible window. k=1 keeps
          // every label; otherwise pin ends. Weekly ISO weeks cap at 8.
          pinCategoryEndTicks(axis);
        },
        ticks: {
          maxRotation: 0,
          minRotation: 0,
          align: "center",
          // House autoSkip can drop the final category (FY2025 / FY2026Q2). Off —
          // pinCategoryEndTicks keeps first+last of the visible window.
          autoSkip: false,
          color: LATTICE.soft,
          font: { size: 11, family: FONT_SANS },
          callback: function (val) {
            var lab = this.getLabelForValue(val);
            var dated = isoWeekDateLabel(lab);
            if (dated) return dated;
            var labels = payload.labels || [];
            var idx = typeof val === "number" ? val : labels.indexOf(lab);
            var weekly = labels.some(function (item) {
              return /^\d{4}-W\d{2}$/.test(String(item || ""));
            });
            // Week axes label every kept tick (FY1/FY2 included). Other lines
            // still drop the crowded middle.
            if (isLine && !weekly && !showLineXTick(labels, idx)) return "";
            return compactCategoryLabel(lab);
          },
        },
        grid: { display: false, drawOnChartArea: false },
        border: { display: false },
      },
      y: yScaleFor(mode, payload.ylabel, payload.composition, payload.chartType, payload),
    };
    if (hasY1) {
      var y1 = displayAxis(payload, "y1", payload.y1Label);
      scales.y1 = latticeAxisChrome({
        position: "right",
        stacked: false,
        beginAtZero: payload.chartType !== "line",
        grid: { drawOnChartArea: false, color: "transparent" },
        ticks: {
          color: LATTICE.soft,
          font: { size: 11, family: FONT_SANS },
          autoSkip: false,
          includeBounds: true,
          maxTicksLimit: 11,
          callback: function (v) {
            return fmtTick(v, y1.scale);
          },
        },
        title: {
          display: !!y1.title,
          text: y1.title || "",
          color: LATTICE.soft,
          font: { size: 11, family: FONT_SANS },
        },
      });
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

  function applyXRange(chart, min, max, opts) {
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
    if (!(opts && opts.silent)) chart.update("none");
  }

  function yBounds(chart) {
    var scale = chart.scales && chart.scales.y;
    if (!scale) return null;
    var opts = chart.options && chart.options.scales && chart.options.scales.y;
    var full = chart._packYFull;
    var min = opts && opts.min !== undefined ? opts.min : scale.min;
    var max = opts && opts.max !== undefined ? opts.max : scale.max;
    return {
      min: Number(min),
      max: Number(max),
      lo: full ? full.min : scale.min,
      hi: full ? full.max : scale.max,
    };
  }

  function rememberFullY(chart) {
    if (chart._packYFull) return;
    var scale = chart.scales && chart.scales.y;
    if (!scale || !isFinite(scale.min) || !isFinite(scale.max)) return;
    if (!(scale.max > scale.min)) return;
    chart._packYFull = { min: scale.min, max: scale.max };
    log(
      "y full range",
      chart._packPayload && chart._packPayload.id,
      scale.min + ".." + scale.max
    );
  }

  function applyYRange(chart, min, max, opts) {
    var scales = chart.options && chart.options.scales;
    if (!scales || !scales.y) return;
    rememberFullY(chart);
    var full = chart._packYFull;
    if (!full) return;
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
      delete scales.y.min;
      delete scales.y.max;
      restoreYCap(chart, scales.y);
      log("y zoom full range", chart._packPayload && chart._packPayload.id);
    } else {
      scales.y.min = min;
      scales.y.max = max;
      log(
        "y zoom range",
        chart._packPayload && chart._packPayload.id,
        Number(min).toFixed(2) + ".." + Number(max).toFixed(2)
      );
    }
    if (!(opts && opts.silent)) chart.update("none");
  }

  function flushZoom(chart) {
    chart.update("none");
  }

  function houseWindow(chart) {
    var hw = chart._packPayload && chart._packPayload.houseWindow;
    if (!hw || typeof hw.min !== "number" || typeof hw.max !== "number") return null;
    return hw;
  }

  function clearYZoom(chart) {
    var scales = chart.options && chart.options.scales;
    if (scales && scales.y) {
      delete scales.y.min;
      delete scales.y.max;
      restoreYCap(chart, scales.y);
    }
    chart._packYFull = null;
  }

  function resetZoom(chart) {
    var scales = chart.options && chart.options.scales;
    if (!scales || !scales.x) return;
    clearYZoom(chart);
    var hw = houseWindow(chart);
    if (hw) {
      rememberFullX(chart);
      applyXRange(chart, hw.min, hw.max, { silent: true });
      chart.update();
      rememberFullY(chart);
      log(
        "zoom reset to house window",
        chart._packPayload && chart._packPayload.id,
        hw.min + ".." + hw.max,
        "y auto"
      );
      return;
    }
    delete scales.x.min;
    delete scales.x.max;
    chart.update();
    chart._packXFull = xBounds(chart);
    rememberFullY(chart);
    log("zoom reset", chart._packPayload && chart._packPayload.id, "xy auto");
  }

  function panByPixels(chart, dx, dy) {
    var area = chart.chartArea;
    if (!area) return;
    var width = area.right - area.left;
    var height = area.bottom - area.top;
    var silent = { silent: true };
    var moved = false;
    if (dx && width > 0) {
      var xBoundsNow = xBounds(chart);
      if (xBoundsNow) {
        var xSpan = xBoundsNow.max - xBoundsNow.min;
        if (xSpan > 0) {
          var xDelta = (-dx / width) * xSpan;
          applyXRange(chart, xBoundsNow.min + xDelta, xBoundsNow.max + xDelta, silent);
          moved = true;
        }
      }
    }
    if (dy && height > 0) {
      rememberFullY(chart);
      var yb = yBounds(chart);
      if (yb) {
        var ySpan = yb.max - yb.min;
        if (ySpan > 0) {
          var yDelta = (dy / height) * ySpan;
          applyYRange(chart, yb.min + yDelta, yb.max + yDelta, silent);
          moved = true;
        }
      }
    }
    if (moved) flushZoom(chart);
  }

  function zoomAtClient(chart, clientX, clientY, factor, mode) {
    var area = chart.chartArea;
    if (!area) return;
    mode = mode || "xy";
    var rect = chart.canvas.getBoundingClientRect();
    var silent = { silent: true };
    var changed = false;
    if (mode.indexOf("x") >= 0) {
      var bounds = xBounds(chart);
      if (bounds) {
        var x = clientX - rect.left;
        var fracX = (x - area.left) / Math.max(1, area.right - area.left);
        fracX = Math.max(0, Math.min(1, fracX));
        var spanX = bounds.max - bounds.min;
        if (spanX > 0) {
          var newSpanX = spanX * factor;
          var centerX = bounds.min + spanX * fracX;
          applyXRange(chart, centerX - newSpanX * fracX, centerX + newSpanX * (1 - fracX), silent);
          changed = true;
        }
      }
    }
    if (mode.indexOf("y") >= 0) {
      rememberFullY(chart);
      var yb = yBounds(chart);
      if (yb) {
        var y = clientY - rect.top;
        var fracY = (area.bottom - y) / Math.max(1, area.bottom - area.top);
        fracY = Math.max(0, Math.min(1, fracY));
        var spanY = yb.max - yb.min;
        if (spanY > 0) {
          var newSpanY = spanY * factor;
          var centerY = yb.min + spanY * fracY;
          applyYRange(chart, centerY - newSpanY * fracY, centerY + newSpanY * (1 - fracY), silent);
          changed = true;
        }
      }
    }
    if (changed) flushZoom(chart);
  }

  function zoomAtClientX(chart, clientX, factor) {
    zoomAtClient(chart, clientX, 0, factor, "x");
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

  function wheelZoomMode(area, x, y) {
    if (!area) return "";
    var inX = x >= area.left && x <= area.right;
    var inY = y >= area.top && y <= area.bottom;
    if (inX && inY) return "xy";
    if (!inX && inY) return "y";
    if (inX && !inY) return "x";
    return "";
  }

  function ensureZoomRect(canvas) {
    var wrap = canvas.parentNode;
    if (!wrap) return null;
    var el = wrap.querySelector(".chart-zoom-rect");
    if (!el) {
      el = document.createElement("div");
      el.className = "chart-zoom-rect";
      el.setAttribute("aria-hidden", "true");
      wrap.appendChild(el);
    }
    return el;
  }

  function hideZoomRect(el) {
    if (!el) return;
    el.style.display = "none";
  }

  function placeZoomRect(el, wrap, x0, y0, x1, y1) {
    if (!el || !wrap) return;
    var rect = wrap.getBoundingClientRect();
    var left = Math.min(x0, x1) - rect.left;
    var top = Math.min(y0, y1) - rect.top;
    var w = Math.abs(x1 - x0);
    var h = Math.abs(y1 - y0);
    el.style.display = "block";
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.style.width = w + "px";
    el.style.height = h + "px";
  }

  function applyBoxZoom(chart, x0, y0, x1, y1) {
    var area = chart.chartArea;
    var xScale = chart.scales && chart.scales.x;
    var yScale = chart.scales && chart.scales.y;
    if (!area || !xScale || !yScale) return;
    var rect = chart.canvas.getBoundingClientRect();
    var px0 = Math.min(x0, x1) - rect.left;
    var px1 = Math.max(x0, x1) - rect.left;
    var py0 = Math.min(y0, y1) - rect.top;
    var py1 = Math.max(y0, y1) - rect.top;
    if (px1 - px0 < 8 && py1 - py0 < 8) return;
    px0 = Math.max(area.left, Math.min(area.right, px0));
    px1 = Math.max(area.left, Math.min(area.right, px1));
    py0 = Math.max(area.top, Math.min(area.bottom, py0));
    py1 = Math.max(area.top, Math.min(area.bottom, py1));
    if (!(px1 > px0) || !(py1 > py0)) return;
    var xv0 = xScale.getValueForPixel(px0);
    var xv1 = xScale.getValueForPixel(px1);
    var yv0 = yScale.getValueForPixel(py1);
    var yv1 = yScale.getValueForPixel(py0);
    rememberFullX(chart);
    rememberFullY(chart);
    applyXRange(chart, xv0, xv1, { silent: true });
    applyYRange(chart, yv0, yv1, { silent: true });
    flushZoom(chart);
    log(
      "box zoom",
      chart._packPayload && chart._packPayload.id,
      xv0 + ".." + xv1,
      yv0 + ".." + yv1
    );
  }

  function attachZoom(chart) {
    var canvas = chart.canvas;
    if (!canvas || canvas._packZoomBound) return;
    canvas._packZoomBound = true;
    rememberFullX(chart);
    rememberFullY(chart);
    var drag = { on: false, x: 0, y: 0, id: null, box: false };
    var pointers = {};
    var pinch0 = 0;
    var zoomRect = ensureZoomRect(canvas);

    canvas.addEventListener(
      "wheel",
      function (ev) {
        rememberFullX(chart);
        rememberFullY(chart);
        var area = chart.chartArea;
        if (!area) return;
        var rect = canvas.getBoundingClientRect();
        var x = ev.clientX - rect.left;
        var y = ev.clientY - rect.top;
        var mode = wheelZoomMode(area, x, y);
        if (!mode) return;
        ev.preventDefault();
        var factor = ev.deltaY < 0 ? 0.82 : 1.22;
        log("wheel zoom", chart._packPayload && chart._packPayload.id, mode, factor);
        zoomAtClient(chart, ev.clientX, ev.clientY, factor, mode);
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
        hideZoomRect(zoomRect);
        return;
      }
      if (ev.button !== undefined && ev.button !== 0) return;
      drag.on = true;
      drag.x = ev.clientX;
      drag.y = ev.clientY;
      drag.id = ev.pointerId;
      drag.box = !!(ev.shiftKey || ev.metaKey);
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
          var cy = (a.y + b.y) / 2;
          zoomAtClient(chart, cx, cy, factor, "xy");
          pinch0 = dist;
        }
        return;
      }
      if (!drag.on || (drag.id != null && ev.pointerId !== drag.id)) return;
      if (drag.box) {
        ev.preventDefault();
        placeZoomRect(zoomRect, canvas.parentNode, drag.x, drag.y, ev.clientX, ev.clientY);
        return;
      }
      var moveX = ev.clientX - drag.x;
      var moveY = ev.clientY - drag.y;
      if (Math.abs(moveX) < 2 && Math.abs(moveY) < 2) return;
      ev.preventDefault();
      drag.x = ev.clientX;
      drag.y = ev.clientY;
      canvas.style.cursor = "grabbing";
      panByPixels(chart, moveX, moveY);
    });

    function endPointer(ev) {
      delete pointers[ev.pointerId];
      if (Object.keys(pointers).length < 2) pinch0 = 0;
      if (!drag.on || (drag.id != null && ev.pointerId !== drag.id)) return;
      if (drag.box) {
        applyBoxZoom(chart, drag.x, drag.y, ev.clientX, ev.clientY);
        hideZoomRect(zoomRect);
      }
      drag.on = false;
      drag.box = false;
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
    log("zoom attached", chart._packPayload && chart._packPayload.id, "labels=", categoryCount(chart), "xy");
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

  function drawTrendline(chart) {
    var payload = chart._packPayload;
    if (!payload || !payload.trendline) return;
    if (seriesModeOf(chart) === "yoy") return;
    var area = chart.chartArea;
    var xScale = chart.scales && chart.scales.x;
    var yScale = chart.scales && chart.scales.y;
    if (!area || !xScale || !yScale) return;
    var ds = (payload.datasets || [])[0];
    if (!ds) return;
    var values = ds.values || [];
    var statuses = ds.statuses || [];
    var pts = [];
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (v === null || v === undefined || Number.isNaN(Number(v))) continue;
      if (statuses[i] === "DERIVED") continue;
      pts.push({ x: i, y: Number(v) });
    }
    if (pts.length < 2) {
      log("trendline skip — need ≥2 FACT points", payload.id, "n=" + pts.length);
      return;
    }
    var n = pts.length;
    var sumX = 0;
    var sumY = 0;
    var sumXY = 0;
    var sumXX = 0;
    pts.forEach(function (p) {
      sumX += p.x;
      sumY += p.y;
      sumXY += p.x * p.y;
      sumXX += p.x * p.x;
    });
    var denom = n * sumXX - sumX * sumX;
    if (!denom) return;
    var slope = (n * sumXY - sumX * sumY) / denom;
    var intercept = (sumY - slope * sumX) / n;
    var x0 = pts[0].x;
    var x1 = pts[pts.length - 1].x;
    var y0 = intercept + slope * x0;
    var y1 = intercept + slope * x1;
    var ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = "#5C564C";
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.15;
    ctx.setLineDash([3, 4]);
    ctx.moveTo(xScale.getPixelForValue(x0), yScale.getPixelForValue(y0));
    ctx.lineTo(xScale.getPixelForValue(x1), yScale.getPixelForValue(y1));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    log("trendline", payload.id, "n=" + n, "slope=" + slope);
  }

  function formatCraftValue(view, v, axis, seriesMode) {
    if (view.unit === "%" || seriesMode === "yoy") {
      var num = Number(v);
      return (Math.abs(num) >= 10 ? num.toFixed(0) : num.toFixed(1)) + "%";
    }
    if (view.unit === "bps" || /bps/i.test(view.ylabel || "")) {
      return Number(v).toFixed(1);
    }
    if (view.valueDecimals != null && view.valueDecimals !== "") {
      return fmtFixed(v, Number(view.valueDecimals));
    }
    return fmtTick(v, axis.scale);
  }

  function elementPos(el) {
    if (!el) return null;
    return typeof el.tooltipPosition === "function" ? el.tooltipPosition() : el;
  }

  function drawCraftLabels(chart) {
    var payload = chart._packPayload;
    if (!payload || payload.craftLabels === false) return;
    if (dataLabelsOn()) return;
    var view = payloadView(payload, seriesModeOf(chart));
    var area = chart.chartArea;
    if (!area) return;
    var labels = (chart.data && chart.data.labels) || payload.labels || [];
    var last = lastFiniteIndex(labels.map(function (_l, i) {
      var any = null;
      (payload.datasets || []).forEach(function (ds) {
        var v = (ds.values || [])[i];
        if (v !== null && v !== undefined && !Number.isNaN(Number(v))) any = v;
      });
      return any;
    }));
    if (last < 0) last = labels.length - 1;
    var ctx = chart.ctx;
    ctx.save();
    ctx.font = "500 11px " + FONT_SANS;
    var isLine = view.chartType === "line" || payload.chartType === "line";
    if (isLine) {
      (chart.data.datasets || []).forEach(function (ds, di) {
        var src = (payload.datasets || [])[di] || {};
        if (src.dashed || src.overlay === "forward") return;
        if (!isPrimaryLine(payload, src) && di !== 0) return;
        var meta = chart.getDatasetMeta(di);
        if (!meta || meta.hidden) return;
        var axis = displayAxis(view, ds.yAxisID || "y", view.ylabel);
        var values = ds.data || [];
        var first = firstFiniteIndex(values);
        var end = lastFiniteIndex(values);
        function paint(i, color, weight, align) {
          var v = values[i];
          if (v === null || v === undefined || Number.isNaN(Number(v))) return;
          var el = meta.data && meta.data[i];
          var pos = elementPos(el);
          if (!pos) return;
          if (!(pos.x >= area.left && pos.x <= area.right)) return;
          ctx.fillStyle = color;
          ctx.font = weight + " 11px " + FONT_SANS;
          ctx.textAlign = align;
          ctx.textBaseline = "bottom";
          var text = formatCraftValue(view, v, axis, seriesModeOf(chart));
          if (align === "left") {
            if (/bps/i.test(view.unit || view.ylabel || "")) text = text + " bps";
            // Week axes already show the date. Appending "2026-W40" clips as "34.6 · 20…".
            if (!isoWeekDateLabel(labels[i])) {
              var lab = compactCategoryLabel(labels[i]);
              if (lab) text = text + " · " + lab;
            }
          }
          var textW = ctx.measureText(text).width;
          var x = pos.x + (align === "left" ? 8 : 0);
          var drawAlign = align;
          if (align === "left" && x + textW > chart.width - 6) {
            drawAlign = "right";
            x = Math.max(area.left + 4, pos.x - 10);
            log("craft tip inside", payload.id, text);
          }
          ctx.textAlign = drawAlign;
          var y = pos.y - 6;
          if (y < area.top + 12) y = area.top + 12;
          ctx.fillText(text, x, y);
        }
        if (first >= 0) paint(first, LATTICE.soft, "500", "center");
        if (end >= 0 && end !== first) paint(end, LATTICE.copper, "700", "left");
        log("craft line labels", payload.id, "first=", first, "end=", end);
      });
      ctx.restore();
      return;
    }
    var stacked = !!(payload.composition && chart._packMode !== "grouped");
    var total = 0;
    var topY = area.bottom;
    var lastX = null;
    var candidates = [];
    var visibleStack = [];
    (chart.data.datasets || []).forEach(function (ds, di) {
      var meta = chart.getDatasetMeta(di);
      if (!meta || meta.hidden) return;
      var src = (payload.datasets || [])[di] || {};
      var axis = displayAxis(view, ds.yAxisID || "y", view.ylabel);
      var v = (ds.data || [])[last];
      if (v === null || v === undefined || Number.isNaN(Number(v))) return;
      if (stacked) visibleStack.push(ds);
      var el = meta.data && meta.data[last];
      var pos = elementPos(el);
      if (!pos) return;
      if (!(pos.x >= area.left && pos.x <= area.right)) return;
      lastX = pos.x;
      if (stacked && pos.y < topY) topY = pos.y;
      var barH = el && typeof el.height === "number" ? Math.abs(el.height) : 18;
      if (barH < 12 && stacked) {
        log(
          "craft skip thin segment label",
          payload.id,
          src.key || ds.label,
          "h=" + Math.round(barH),
          "value=" + v
        );
        return;
      }
      var font = "600 11px " + FONT_SANS;
      var text = formatCraftValue(view, v, axis, seriesModeOf(chart));
      var meas = measureCraftLabel(chart, text, font);
      if (!(meas.w > 0)) return;
      candidates.push({
        x: pos.x,
        y: pos.y,
        w: meas.w,
        h: meas.h,
        align: "center",
        baseline: "middle",
        text: text,
        font: font,
        fill: LATTICE.ink,
        di: di,
        key: src.key || ds.label,
        hero: !!(src.hero || ds.packHero),
        value: Number(v),
        kind: "series",
      });
    });
    if (stacked) {
      total = stackCategoryTotal(visibleStack, last);
      log(
        "craft stack total",
        payload.id,
        "last=" + last,
        "total=" + total,
        "labeled=" + candidates.length,
        "segments=" + visibleStack.length
      );
    }
    if (stacked && lastX != null && total && chart._packMode !== "stacked100" && !view.percentShare) {
      var axis0 = displayAxis(view, "y", view.ylabel);
      var totalText = formatCraftValue(view, total, axis0, seriesModeOf(chart));
      var totalFont = "700 12px " + FONT_SANS;
      var totalMeas = measureCraftLabel(chart, totalText, totalFont);
      candidates.push({
        x: lastX,
        y: topY - 6,
        w: totalMeas.w,
        h: totalMeas.h,
        align: "center",
        baseline: "bottom",
        text: totalText,
        font: totalFont,
        fill: LATTICE.ink,
        di: -1,
        key: "_total",
        hero: true,
        value: total,
        kind: "total",
      });
    }
    var clip = {
      left: area.left,
      right: area.right,
      top: area.top,
      bottom: area.bottom,
      canvasRight: (typeof chart.width === "number" ? chart.width : area.right) - 4,
    };
    var occupied = [];
    var callLayout = calloutLayout(chart);
    if (callLayout && callLayout.boxes && callLayout.boxes.length) {
      occupied = callLayout.boxes;
    }
    log(
      "craft clip",
      payload.id,
      "area.right=" + Math.round(area.right),
      "canvasRight=" + Math.round(clip.canvasRight),
      "occupied=" + occupied.length
    );
    var resolved = resolveCraftLabelCollisions(candidates, clip, occupied);
    resolved.placed.forEach(function (p) {
      var it = p.item;
      ctx.fillStyle = it.fill;
      ctx.font = it.font;
      ctx.textAlign = it.align;
      ctx.textBaseline = it.baseline;
      ctx.fillText(it.text, p.x, p.y);
    });
    log(
      "craft bar labels",
      payload.id,
      "last=" + last,
      "kept=" + resolved.placed.length,
      "staggered=" +
        resolved.placed.filter(function (p) {
          return p.staggered;
        }).length,
      "nudged=" +
        resolved.placed.filter(function (p) {
          return p.nudged;
        }).length,
      "dropped=" +
        resolved.dropped
          .map(function (d) {
            return d.key;
          })
          .join(",")
    );
    ctx.restore();
  }

  function drawLatestRing(chart) {
    var payload = chart._packPayload;
    if (!payload || payload.chartType !== "line") return;
    var area = chart.chartArea;
    if (!area) return;
    var ctx = chart.ctx;
    (chart.data.datasets || []).forEach(function (ds, di) {
      var src = (payload.datasets || [])[di] || {};
      if (!isPrimaryLine(payload, src)) return;
      var meta = chart.getDatasetMeta(di);
      if (!meta || meta.hidden) return;
      var end = lastFiniteIndex(ds.data || []);
      var el = meta.data && meta.data[end];
      var pos = elementPos(el);
      if (!pos) return;
      if (!(pos.x >= area.left && pos.x <= area.right)) return;
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = hexToRgba(LATTICE.copper, 0.38);
      ctx.lineWidth = 2;
      ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });
  }

  function calloutLayout(chart) {
    var payload = chart._packPayload;
    if (!payload) return null;
    var call = payload.callout;
    if (!call || !call.text) return null;
    var area = chart.chartArea;
    if (!area) return null;
    var labels = (chart.data && chart.data.labels) || payload.labels || [];
    var idx = call.index;
    if (idx == null && call.label) idx = labels.indexOf(call.label);
    if (idx == null || idx < 0) idx = lastFiniteIndex(payload.datasets && payload.datasets[0] && payload.datasets[0].values);
    var place = call.place || "";
    // "pad" parks the tip in the right padding, off the series. "prior" stays one point left.
    if (place !== "pad" && place !== "end" && place === "prior" && idx > 0) idx = idx - 1;
    var heroDi = 0;
    (payload.datasets || []).forEach(function (ds, i) {
      if (ds.hero) heroDi = i;
    });
    var meta = chart.getDatasetMeta(heroDi);
    var el = meta && meta.data && meta.data[idx];
    var pos = elementPos(el);
    if (!pos) return null;
    var font = "600 11px " + FONT_SANS;
    var ctx = chart.ctx;
    ctx.save();
    ctx.font = font;
    var lines = String(call.text).split(/\n+/);
    if (lines.length === 1 && lines[0].length > 22) {
      var bits = lines[0].split(" ");
      if (bits.length >= 2) lines = [bits.slice(0, 2).join(" "), bits.slice(2).join(" ")];
    }
    var textW = 0;
    lines.forEach(function (line) {
      textW = Math.max(textW, ctx.measureText(line).width);
    });
    var x = pos.x;
    var align = "center";
    var baseline = "bottom";
    var y = Math.max(area.top + 14 + (lines.length - 1) * 13, pos.y - 18);
    if (place === "pad" || place === "end") {
      // Right of the tip, in the line-chart padding, so the stroke cannot cut the glyphs.
      align = "left";
      baseline = "middle";
      x = area.right + 10;
      y = pos.y;
      var canvasRight = (typeof chart.width === "number" ? chart.width : area.right + 72) - 6;
      if (x + textW > canvasRight) x = Math.max(pos.x + 14, canvasRight - textW);
      log("callout pad", payload.id, call.text, "x=" + Math.round(x), "y=" + Math.round(y));
    } else {
      if (x - textW / 2 < area.left + 4) {
        x = Math.min(pos.x + 8, area.right - 4);
        align = "left";
      }
      if (x + textW / 2 > area.right - 4 && align === "center") {
        align = "right";
      }
    }
    var boxes = [];
    lines.forEach(function (line, i) {
      var ly = baseline === "middle" ? y : y - 2 - (lines.length - 1 - i) * 13;
      var meas = measureCraftLabel(chart, line, font);
      boxes.push(craftLabelBox(x, ly, meas.w, meas.h || 13, align, baseline));
    });
    ctx.restore();
    return {
      lines: lines,
      x: x,
      y: y,
      align: align,
      baseline: baseline,
      pos: pos,
      idx: idx,
      boxes: boxes,
      text: call.text,
      place: place,
      color: call.color || "",
    };
  }

  function drawCallout(chart) {
    var layout = calloutLayout(chart);
    if (!layout) return;
    var payload = chart._packPayload;
    var ctx = chart.ctx;
    var ink = layout.color === "ink";
    var padded = layout.place === "pad" || layout.place === "end";
    ctx.save();
    ctx.strokeStyle = ink ? LATTICE.ink : hexToRgba(LATTICE.copper, 0.85);
    ctx.fillStyle = ink ? LATTICE.ink : LATTICE.copper;
    ctx.lineWidth = 1;
    ctx.font = "600 11px " + FONT_SANS;
    ctx.textAlign = layout.align;
    ctx.textBaseline = layout.baseline || "bottom";
    if (!padded) {
      ctx.beginPath();
      ctx.moveTo(layout.pos.x, layout.pos.y - 4);
      ctx.lineTo(layout.pos.x, layout.y);
      if (layout.align !== "center") ctx.lineTo(layout.x, layout.y);
      ctx.stroke();
    }
    layout.lines.forEach(function (line, i) {
      var ly =
        layout.baseline === "middle"
          ? layout.y
          : layout.y - 2 - (layout.lines.length - 1 - i) * 13;
      ctx.fillText(line, layout.x, ly);
    });
    ctx.restore();
    log(
      ink ? "ink callout" : "copper callout",
      payload && payload.id,
      layout.text,
      "place=" + (layout.place || "point"),
      "idx=",
      layout.idx
    );
  }

  function calloutUnclipped(chart) {
    var call = chart && chart._packPayload && chart._packPayload.callout;
    if (!call) return false;
    return call.place === "pad" || call.place === "end" || call.color === "ink";
  }

  function drawDataLabels(chart) {
    if (!dataLabelsOn()) return;
    var payload = chart._packPayload;
    if (!payload) return;
    var view = payloadView(payload, seriesModeOf(chart));
    var capView = yCapOf(view);
    var area = chart.chartArea;
    if (!area) return;
    var ctx = chart.ctx;
    ctx.save();
    ctx.fillStyle = LATTICE.ink;
    ctx.font = "600 9px " + FONT_SANS;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    (chart.data.datasets || []).forEach(function (ds, di) {
      var meta = chart.getDatasetMeta(di);
      if (!meta || meta.hidden) return;
      var axis = displayAxis(view, ds.yAxisID || "y", view.ylabel);
      (ds.data || []).forEach(function (v, i) {
        if (v === null || v === undefined || Number.isNaN(Number(v))) return;
        var el = meta.data && meta.data[i];
        if (!el) return;
        if (capView && ((capView.max !== null && Number(v) > capView.max) ||
            (capView.min !== null && Number(v) < capView.min))) return;
        var pos = elementPos(el);
        var x = pos.x;
        var y = pos.y;
        if (!(x >= area.left && x <= area.right)) return;
        var text;
        if (view.unit === "%" || seriesModeOf(chart) === "yoy") {
          var num = Number(v);
          text = (Math.abs(num) >= 10 ? num.toFixed(0) : num.toFixed(1)) + "%";
        } else {
          text = fmtTick(v, axis.scale);
        }
        ctx.fillText(text, x, y - 2);
      });
    });
    ctx.restore();
  }

  function houseLegend(payload) {
    var hasHollow = ((payload && payload.datasets) || []).some(function (ds) {
      return ds && ds.hollow;
    });
    return {
      position: "bottom",
      align: "start",
      labels: {
        boxWidth: 10,
        boxHeight: 10,
        padding: 12,
        color: LATTICE.soft,
        font: { family: FONT_SANS, size: 11 },
        usePointStyle: hasHollow,
        generateLabels: function (chart) {
          var gen = Chart.defaults.plugins.legend.labels.generateLabels;
          var items = gen ? gen(chart) : [];
          var sets = (payload && payload.datasets) || [];
          items.forEach(function (item, i) {
            var ds = sets[i] || {};
            if (ds.hero && String(item.text).indexOf("(hero)") < 0) {
              item.text = item.text + " (hero)";
            }
            if (
              payload &&
              (payload.preserveSeriesTint || payload.preserveSeriesColors) &&
              ds.color
            ) {
              item.strokeStyle = ds.color;
              item.fillStyle = ds.hollow ? "transparent" : ds.color;
              if (ds.hollow) {
                item.pointStyle = "circle";
                item.lineWidth = 1.6;
                log("hollow legend swatch", payload.id, ds.key || ds.label);
              }
            }
          });
          return items;
        },
      },
    };
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
    pinHouseDefaults();
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
          : modes[0] || "stacked";
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
    if (payload.hasDerived || (payload.yoyDatasets && payload.yoyDatasets.length)) {
      plugins.push({
        id: "packDerivedWatermark",
        afterDraw: function (chart) {
          var view = payloadView(chart._packPayload || payload, seriesModeOf(chart));
          if (!view.hasDerived || !derivedChromeOn()) return;
          var area = chart.chartArea;
          if (!area) return;
          var ctx = chart.ctx;
          ctx.save();
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = LATTICE.alert;
          ctx.font = "600 22px " + FONT_SANS;
          ctx.translate(
            area.left + (area.right - area.left) * 0.18,
            area.top + (area.bottom - area.top) * 0.62
          );
          ctx.rotate(-0.28);
          ctx.fillText("DERIVED", 0, 0);
          ctx.restore();
        },
      });
      log("DERIVED watermark plugin on", payload.id, "hasDerived=", !!payload.hasDerived);
    }
    plugins.push({
      id: "packCategoryTicks",
      afterLayout: function (chart) {
        recountCategoryTicksIfNeeded(chart);
      },
      resize: function (chart) {
        resetTickBudget(chart);
        log("category tick resize", chart._packPayload && chart._packPayload.id);
      },
    });
    plugins.push({
      id: "packHouseChrome",
      afterDatasetsDraw: function (chart) {
        drawTrendline(chart);
        if (!(chart._packPayload && chart._packPayload.tipInset)) drawLatestRing(chart);
        drawCraftLabels(chart);
        if (!calloutUnclipped(chart)) drawCallout(chart);
        drawDataLabels(chart);
        drawYCapBreaks(chart);
      },
    });
    plugins.push({
      id: "packUnclippedChrome",
      afterDraw: function (chart) {
        // afterDraw is outside the chart-area clip, so a tip ring and a
        // right-padding callout are not cut by the plot edge.
        if (chart._packPayload && chart._packPayload.tipInset) {
          drawLatestRing(chart);
          log("tip inset ring", chart._packPayload.id);
        }
        if (calloutUnclipped(chart)) drawCallout(chart);
        drawYCapLabels(chart);
      },
    });
    var seriesMode = payload.defaultSeriesMode || "levels";
    var view = payloadView(payload, seriesMode);
    var scales = scalesFor(view, mode);
    var hw0 = payload.houseWindow;
    if (hw0 && typeof hw0.min === "number" && typeof hw0.max === "number") {
      scales.x.min = hw0.min;
      scales.x.max = hw0.max;
      log("category axis default", payload.id, hw0.min + ".." + hw0.max, "of", labelCount);
    }
    var chart = new Chart(canvas.getContext("2d"), {
      type: payload.chartType === "scatter" ? "scatter" : payload.chartType === "line" ? "line" : "bar",
      plugins: plugins,
      data: {
        labels: payload.labels || [],
        datasets: asChartDatasets(view, mode),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: {
            top: payload.yCap && payload.yCap.clipped && payload.yCap.clipped.length ? 30 : 16,
            right: payload.chartType === "line" ? 72 : 52,
            bottom: 2,
            left: 2,
          },
        },
        interaction:
          payload.chartType === "scatter"
            ? { mode: "nearest", intersect: false }
            : { mode: "index", intersect: false },
        plugins: {
          legend: houseLegend(payload),
          tooltip: buildTooltip(view),
        },
        scales: scales,
      },
    });
    log(
      "mounted",
      payload.id,
      "type=" + payload.chartType,
      "composition=" + composition,
      "mode=" + (composition ? mode : "hover"),
      "labels=" + labelCount,
      "craftLabels=" + (payload.craftLabels !== false),
      "hero=" + (((payload.datasets || []).filter(function (d) { return d.hero; })[0] || {}).key || "none")
    );
    chart._packMode = mode;
    chart._packModes = modes;
    chart._packPayload = payload;
    chart._packSeriesMode = seriesMode;
    canvas._packChart = chart;
    registerChart(chart);
    attachZoom(chart);
    var hw = houseWindow(chart);
    if (hw) {
      rememberFullX(chart);
      applyXRange(chart, hw.min, hw.max);
      log(
        "opened on house window",
        payload.id,
        hw.min + ".." + hw.max,
        "of",
        labelCount,
        "— zoom out for the rest of the series"
      );
    }
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
    toolbar.querySelectorAll("button[data-data-labels]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", dataLabelsOn() ? "true" : "false");
      btn.addEventListener("click", function () {
        setDataLabels(!dataLabelsOn(), true);
      });
    });
    toolbar.querySelectorAll("button[data-series-mode]").forEach(function (btn) {
      var current = seriesModeOf(chart);
      btn.setAttribute(
        "aria-pressed",
        btn.getAttribute("data-series-mode") === current ? "true" : "false"
      );
      btn.addEventListener("click", function () {
        var next = btn.getAttribute("data-series-mode") || "levels";
        setSeriesMode(next);
      });
    });
    function setSeriesMode(next) {
      if (!payload) return;
      if (next === "yoy" && !(payload.yoyDatasets && payload.yoyDatasets.length)) {
        log("refusing YoY mode — no house sidecar", payload.id);
        return;
      }
      charts.forEach(function (c) {
        if (c._packSeriesMode === next) return;
        c._packSeriesMode = next;
        restyleChart(c);
      });
      toolbar.querySelectorAll("button[data-series-mode]").forEach(function (peer) {
        peer.setAttribute(
          "aria-pressed",
          peer.getAttribute("data-series-mode") === next ? "true" : "false"
        );
      });
      log("series mode", payload.id, next);
    }
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
      var view = payloadView(payload, seriesModeOf(chart));
      chart.data.datasets = asChartDatasets(view, next);
      chart.options.scales = scalesFor(view, next);
      restoreZoom(chart, zoom);
      chart._packYFull = null;
      resetTickBudget(chart);
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

  function wireDataLabelsToggle() {
    var box = document.getElementById("pack-data-labels");
    if (!box) {
      log("no data labels toggle on page");
      return;
    }
    box.checked = dataLabelsOn();
    box.addEventListener("change", function () {
      setDataLabels(!!box.checked, true);
    });
    log("wired data labels toggle", box.checked ? "on" : "off");
  }

  function wireWindowToggles() {
    var node = document.getElementById("win-toggle-data");
    if (!node) {
      log("no CAGR window toggles on this page");
      return;
    }
    var spec;
    try {
      spec = JSON.parse(node.textContent);
    } catch (err) {
      log("window toggle JSON failed", err);
      return;
    }
    var root = document.querySelector("[data-win-toggles]");
    if (!root) {
      log("window toggle JSON without controls");
      return;
    }
    var state = {
      pre: spec.defaults.pre,
      post: spec.defaults.post,
      ttm: spec.defaults.ttm,
    };
    log(
      "window toggles ready",
      "pre=" + state.pre,
      "post=" + state.post,
      "ttm=" + state.ttm
    );

    function cellCopy(metric, windowId, field) {
      var row = (spec.cells && spec.cells[metric]) || {};
      var cell = row[windowId];
      if (!cell || !cell[field]) return "—";
      return cell[field];
    }

    function applyCagrChart() {
      var fig = document.querySelector('figure.chart-interactive[data-chart-id="chart_cagr"]');
      if (!fig) {
        log("CAGR chart figure missing");
        return;
      }
      var canvas = fig.querySelector("canvas");
      var chart = canvas && canvas._packChart;
      if (!chart || !chart._packPayload) {
        log("CAGR chart not mounted — bars stay on the default image");
        return;
      }
      var payload = chart._packPayload;
      var ids = [state.pre, state.post, state.ttm];
      payload.labels = ids.map(function (id) {
        return spec.chartLabels[id];
      });
      (payload.datasets || []).forEach(function (ds) {
        var series = spec.bars && spec.bars[ds.key];
        if (!series) return;
        ds.values = ids.map(function (id) {
          return series[id] === undefined ? null : series[id];
        });
        log("CAGR series rebound", ds.key, ds.values.join(","));
      });
      chart.data.labels = payload.labels.slice();
      chart.data.datasets = asChartDatasets(payload, chart._packMode || "grouped");
      chart.update();
      log("CAGR bars rebound", payload.labels.join(" | "));
    }

    function applyBoard() {
      document.querySelectorAll("td[data-win-metric]").forEach(function (td) {
        var metric = td.getAttribute("data-win-metric");
        var role = td.getAttribute("data-win-role");
        var windowId = state[role];
        if (windowId === spec.defaults[role]) {
          td.textContent = td.getAttribute("data-win-default");
          return;
        }
        td.textContent = cellCopy(metric, windowId, "text");
      });
      document.querySelectorAll("th[data-win-header]").forEach(function (th) {
        var role = th.getAttribute("data-win-header");
        var label = spec.headers && spec.headers[state[role]];
        if (label) th.textContent = label;
      });
      document.querySelectorAll("td[data-win-liner]").forEach(function (td) {
        var metric = td.getAttribute("data-win-liner");
        if (state.pre === spec.defaults.pre && state.post === spec.defaults.post) {
          td.textContent = td.getAttribute("data-win-default");
          return;
        }
        var tmpl = (spec.liners && spec.liners[metric]) || "";
        td.textContent = tmpl
          .replace("{pre}", cellCopy(metric, state.pre, "pct"))
          .replace("{post}", cellCopy(metric, state.post, "pct"));
      });
      var hint = document.querySelector("[data-win-hint]");
      if (hint) {
        if (state.pre === "pre_2017_2019" && spec.hint) {
          hint.hidden = false;
          hint.textContent = spec.hint;
          log("late-pre hint shown");
        } else {
          hint.hidden = true;
          hint.textContent = "";
        }
      }
      applyCagrChart();
      log(
        "window board applied",
        "pre=" + state.pre,
        "post=" + state.post,
        "ttm=" + state.ttm
      );
    }

    root.querySelectorAll("button[data-win-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var role = btn.getAttribute("data-win-role");
        var id = btn.getAttribute("data-win-id");
        if (!role || !id || state[role] === id) {
          log("window toggle unchanged", role, id);
          return;
        }
        state[role] = id;
        root.querySelectorAll('button[data-win-role="' + role + '"]').forEach(function (peer) {
          peer.setAttribute(
            "aria-pressed",
            peer.getAttribute("data-win-id") === id ? "true" : "false"
          );
        });
        log("window toggle", role, id);
        applyBoard();
      });
    });
  }

  function boot() {
    pinHouseDefaults();
    setDerivedChrome(readDerivedChromePref(), false);
    setDataLabels(readDataLabelsPref(), false);
    wireDerivedToggle();
    wireDataLabelsToggle();
    var figs = document.querySelectorAll("figure.chart-interactive");
    log(
      "boot interactive figures=",
      figs.length,
      "derivedChrome=",
      derivedChromeOn(),
      "dataLabels=",
      dataLabelsOn()
    );
    figs.forEach(mount);
    wireWindowToggles();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
