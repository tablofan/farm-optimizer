// ==UserScript==
// @name         Farm Optimizer — Collector
// @namespace    https://github.com/tablofan/farm-optimizer
// @version      0.7.3
// @description  Scan all free oases (map API) on a Travian T4.6 gameworld and send them (or download them as a file) — plus the current page's HTML — to the Farm Optimizer calculator, which does the parsing.
// @match        *://*.travian.com/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://tablofan.github.io/farm-optimizer/collector.user.js
// @updateURL    https://tablofan.github.io/farm-optimizer/collector.user.js
// ==/UserScript==
//
// Runs IN PAGE CONTEXT (no @grant) so same-origin fetch carries your session cookie.
// Read-only: never writes to the game. Two jobs only:
//   • Scan oases  — sweep POST /api/v1/map/position (the only way to get the whole map).
//   • Send page   — postMessage the current rendered HTML to the calculator, which parses
//                   villages / farm-lists / troops from it (parsers live in the calculator).
// Open the relevant page (village sidebar, EXPANDED farm lists, troops overview), then Send page.

(function () {
  'use strict';
  if (window.top !== window.self) return;

  var ZOOM = 3, THROTTLE_MIN = 500, THROTTLE_MAX = 1500; // not user-tunable
  var saved = {}; try { saved = JSON.parse(localStorage.getItem('pveCollectorCfg') || '{}') || {}; } catch (e) { saved = {}; }
  var DEFAULT_CALC = 'https://tablofan.github.io/farm-optimizer/'; // the GitHub Pages calculator
  // `radius` is the world's half-size (−R..+R): both the scan extent AND the torus modulus sent as mapRadius.
  var CFG = Object.assign({ radius: 200, step: 30, calcUrl: '' }, saved);
  // default; a saved (non-empty) URL wins — EXCEPT dev leftovers (localhost / loopback / file:),
  // which migrate to the published calculator: they were typed before DEFAULT_CALC existed and
  // would otherwise win forever. A custom non-local URL is still respected.
  if (!CFG.calcUrl || /^(file:|https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])([:/]|$))/i.test(CFG.calcUrl)) CFG.calcUrl = DEFAULT_CALC;
  // integer in [lo, hi]; blank / non-numeric falls back to `def`
  function clampInt(v, lo, hi, def) { var n = Math.round(Number(v)); return (v === '' || v == null || !Number.isFinite(n)) ? def : Math.min(hi, Math.max(lo, n)); }
  CFG.radius = clampInt(CFG.radius, 1, 1000, 200); CFG.step = clampInt(CFG.step, 10, 200, 30); // a bad saved value too
  function saveCfg() { try { localStorage.setItem('pveCollectorCfg', JSON.stringify(CFG)); } catch (e) { /* ignore */ } }

  var oases = []; try { oases = JSON.parse(localStorage.getItem('pveOasesCache') || '[]') || []; } catch (e) { oases = []; }
  var oasesScannedAt = ''; try { oasesScannedAt = localStorage.getItem('pveOasesScannedAt') || ''; } catch (e) { oasesScannedAt = ''; }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function jitter() { return THROTTLE_MIN + Math.floor(Math.random() * (THROTTLE_MAX - THROTTLE_MIN)); }
  function api(method, endpoint, body) {
    return fetch(endpoint, { method: method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(endpoint + ' ' + r.status)); });
  }

  // ── scan free oases ──
  var RES_TOKEN = { r1: 'wood', r2: 'clay', r3: 'iron', r4: 'crop' };
  function parseBonuses(text) {
    var out = [];
    ['r1', 'r2', 'r3', 'r4'].forEach(function (rk) {
      var m = text && text.match(new RegExp('\\{a\\.' + rk + '\\}[^{}]*?(\\d+)\\s*%'));
      if (m) out.push({ res: RES_TOKEN[rk], pct: parseInt(m[1], 10) });
    });
    return out;
  }
  var SCANNING = false; // single-flight: a second click while a sweep runs would double the load
  var RETRY_PASSES = 2;  // failed windows get this many more tries after the main sweep
  async function scanOases(log) {
    if (SCANNING) { log('A scan is already running.'); return; }
    SCANNING = true;
    try { await sweep(log); } finally { SCANNING = false; }
  }
  async function sweep(log) {
    var R = CFG.radius, span = 30;
    try {
      var probe = await api('POST', '/api/v1/map/position', { data: { x: 0, y: 0, zoomLevel: ZOOM, ignorePositions: [] } });
      var xs = (probe.tiles || []).map(function (t) { return t && t.position ? t.position.x : undefined; }).filter(function (v) { return Number.isFinite(v); });
      if (xs.length) span = Math.max.apply(null, xs) - Math.min.apply(null, xs) + 1;
    } catch (e) { log('probe failed (' + e.message + '); using step ' + CFG.step); }
    if (!Number.isFinite(span) || span < 2) span = CFG.step + 1;
    var step = Math.max(1, Math.min(CFG.step, span - 1));
    var axis = []; for (var v = -R; v < R; v += step) axis.push(v); axis.push(R); // always include +R so the far edge is covered
    var centers = []; axis.forEach(function (cx) { axis.forEach(function (cy) { centers.push([cx, cy]); }); });
    log('Viewport span ' + span + ' → step ' + step + '; ' + centers.length + ' windows.');
    if (centers.length > 1000) {
      var mins = Math.ceil(centers.length * ((THROTTLE_MIN + THROTTLE_MAX) / 2 + 200) / 60000);
      if (!window.confirm(centers.length + ' map windows — about ' + mins + ' min of requests. Scan anyway?')) { log('Scan cancelled.'); return; }
    }
    var seen = {}, found = [], noBonus = 0, fails = 0, aborted = false;
    function scan(c) {
      return api('POST', '/api/v1/map/position', { data: { x: c[0], y: c[1], zoomLevel: ZOOM, ignorePositions: [] } }).then(function (res) {
        (res.tiles || []).forEach(function (t) {
          if ((t.title || '').indexOf('{k.fo}') === -1) return;
          var p = t.position || {}; if (p.x == null || p.y == null) return;
          var key = p.x + '|' + p.y; if (seen[key]) return; seen[key] = 1;
          var b = parseBonuses(t.text || ''); if (!b.length) noBonus++;
          found.push({ x: p.x, y: p.y, bonuses: b });
        });
      });
    }
    var todo = centers;
    for (var pass = 0; pass <= RETRY_PASSES && todo.length && !aborted; pass++) {
      if (pass) log('Retrying ' + todo.length + ' failed window' + (todo.length === 1 ? '' : 's') + ' (pass ' + pass + '/' + RETRY_PASSES + ')…');
      var failed = []; fails = 0;
      for (var i = 0; i < todo.length; i++) {
        var c = todo[i];
        try { await scan(c); fails = 0; } catch (e) {
          failed.push(c);
          if (++fails >= 5) { log('Aborted after 5 consecutive failures (' + e.message + '). Logged in / not rate-limited?'); aborted = true; break; }
          log('  window ' + c + ' failed: ' + e.message);
        }
        if (!pass && (i % 10 === 0 || i === todo.length - 1)) log('  …' + (i + 1) + '/' + todo.length + ' (' + found.length + ' oases)');
        await sleep(jitter());
      }
      todo = aborted ? failed.concat(todo.slice(i + 1)) : failed;
    }
    // An incomplete sweep would silently shrink the oasis list (and the calculator would plan
    // against the gap) — keep the previous complete scan instead, unless there is none to keep.
    if (todo.length && oases.length) {
      log('Scan incomplete — ' + todo.length + ' window' + (todo.length === 1 ? '' : 's') + ' not read. Kept the previous ' + oases.length + ' oases; scan again later.');
      return;
    }
    oases = found;
    oasesScannedAt = new Date().toISOString();
    try { localStorage.setItem('pveOasesCache', JSON.stringify(oases)); } catch (e) { log('(too large to cache — kept in memory; Send/Download oases before navigating away)'); }
    try { localStorage.setItem('pveOasesScannedAt', oasesScannedAt); } catch (e) { /* tiny — ignore */ }
    if (todo.length) log('Scan PARTIAL — ' + todo.length + ' window' + (todo.length === 1 ? '' : 's') + ' not read, so some oases are missing. Scan again to complete it.');
    log('Done: ' + oases.length + ' free oases' + (noBonus ? ' (' + noBonus + ' with unreadable bonus)' : '') + '. Now "Send oases" (to the calculator) or "Download oases" (save a file).');
  }

  // ── send a payload to the calculator (single-flight; deliver on ready/retry; stop on ack) ──
  var CURRENT = null, MSG_ID = 0;
  function send(payload, log) {
    if (!CFG.calcUrl) { log('Set the Calculator URL first.'); return; }
    var origin; try { origin = new URL(CFG.calcUrl).origin; } catch (e) { log('Invalid Calculator URL.'); return; }
    var w = window.open(CFG.calcUrl, 'pveCalc');
    if (!w) { log('Popup blocked — allow popups for this site.'); return; }
    if (CURRENT) { clearInterval(CURRENT.iv); window.removeEventListener('message', CURRENT.onMsg); } // one in-flight send at a time
    var id = ++MSG_ID; payload.id = id;
    var done = false, tries = 0;
    function fin(m) { done = true; clearInterval(iv); window.removeEventListener('message', onMsg); if (CURRENT && CURRENT.id === id) CURRENT = null; log(m); }
    function onMsg(ev) {
      if (ev.source !== w) return;
      if (ev.data === 'pve-ready' && !done) { try { w.postMessage(payload, origin); } catch (e) {} }
      else if (ev.data === 'pve-got:' + id) { fin('Sent ✓'); }
    }
    window.addEventListener('message', onMsg);
    var iv = setInterval(function () {
      if (done) return;
      if (tries++ > 15) { fin('No ack from calculator — check the URL / that the tab opened.'); return; }
      try { w.postMessage(payload, origin); } catch (e) { /* not ready yet */ }
    }, 700);
    CURRENT = { id: id, iv: iv, onMsg: onMsg };
  }
  function sendPage(log) { send({ pve: 'page', html: document.documentElement.outerHTML, server: location.origin }, log); }
  function sendOases(log) {
    if (!oases.length) { log('Scan oases first.'); return; }
    send({ pve: 'oases', oases: oases, server: location.origin, mapRadius: CFG.radius, scannedAt: oasesScannedAt }, log); // radius = world half-size
  }

  // ── download oases as a portable file (oases are permanent for the world's life; this survives a
  //    localStorage clear / new machine, and re-imports into the calculator as a merge). ──
  function downloadOases(log) {
    if (!oases.length) { log('Scan oases first.'); return; }
    var when = oasesScannedAt || new Date().toISOString();
    var payload = { pve: 'oases', oases: oases, server: location.origin, mapRadius: CFG.radius, scannedAt: when };
    try {
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var host = (location.hostname || 'world').replace(/[^a-z0-9.\-]/gi, '');
      var a = document.createElement('a');
      a.href = url; a.download = 'pve-oases-' + host + '-' + when.slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
      log('Downloaded ' + oases.length + ' oases (' + a.download + '). Import it in the calculator.');
    } catch (e) { log('Download failed: ' + e.message); }
  }

  // ── panel ──
  function buildPanel() {
    var p = document.createElement('div');
    p.style.cssText = 'position:fixed;right:10px;top:80px;z-index:99999;width:300px;background:#1c1917;color:#e0e0e0;border:1px solid #57534e;border-radius:8px;font:12px/1.4 Segoe UI,sans-serif;padding:10px;box-shadow:0 4px 16px rgba(0,0,0,.5)';
    p.innerHTML =
      '<div style="font-weight:600;color:#f5f0e8;margin-bottom:6px">Farm Optimizer — Collector</div>' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">Map ± <input id="pveRad" type="number" min="1" max="1000" step="1" title="world half-size, e.g. 200 for a −200..200 map" style="width:54px"> Step <input id="pveStep" type="number" min="10" max="200" step="1" title="scan step in fields (capped by the map viewport)" style="width:44px"></div>' +
      '<input id="pveCalc" title="Calculator URL — clear the field to reset to the default" style="width:100%;margin-bottom:6px">' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap"><button id="pveScan">Scan oases</button><button id="pveSendO">Send oases</button><button id="pveDlO">Download oases</button><button id="pveSendP">Send this page</button></div>' +
      '<div id="pveLog" style="margin-top:8px;max-height:170px;overflow:auto;font-family:monospace;font-size:11px;color:#a8a29e"></div>';
    // values set as DOM properties, never spliced into the markup (a saved URL could hold a quote)
    var radEl = p.querySelector('#pveRad'), stepEl = p.querySelector('#pveStep'), calcEl = p.querySelector('#pveCalc');
    radEl.value = CFG.radius; stepEl.value = CFG.step; calcEl.value = CFG.calcUrl || ''; calcEl.placeholder = DEFAULT_CALC;
    document.body.appendChild(p);
    Array.prototype.forEach.call(p.querySelectorAll('button'), function (b) { b.style.cssText = 'background:#44403c;color:#f5f0e8;border:1px solid #57534e;border-radius:5px;padding:5px 8px;cursor:pointer;font-size:11px'; });

    var logEl = p.querySelector('#pveLog');
    function log(m) { var d = document.createElement('div'); d.textContent = m; logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight; }
    function readCfg() {
      CFG.radius = clampInt(radEl.value, 1, 1000, 200); CFG.step = clampInt(stepEl.value, 10, 200, 30);
      CFG.calcUrl = calcEl.value.trim() || DEFAULT_CALC;
      radEl.value = CFG.radius; stepEl.value = CFG.step; calcEl.value = CFG.calcUrl; // show what will be used
      saveCfg();
    }
    p.querySelector('#pveScan').onclick = function () { readCfg(); scanOases(log); };
    p.querySelector('#pveSendO').onclick = function () { readCfg(); sendOases(log); };
    p.querySelector('#pveDlO').onclick = function () { readCfg(); downloadOases(log); };
    p.querySelector('#pveSendP').onclick = function () { readCfg(); sendPage(log); };
    log('Ready. Flow: Scan oases → Send oases (or Download oases to save a file). Then open each page (village list, EXPANDED farm lists, troops overview) and Send this page.');
    if (oases.length) log('(' + oases.length + ' oases cached' + (oasesScannedAt ? ' from ' + oasesScannedAt.slice(0, 10) : '') + ' — Send or Download oases to reuse.)');
  }

  if (document.body) buildPanel(); else window.addEventListener('DOMContentLoaded', buildPanel);
})();
