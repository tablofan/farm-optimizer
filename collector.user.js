// ==UserScript==
// @name         PvE Optimizer — Collector
// @namespace    https://github.com/ren/pve-optimizer
// @version      0.4.0
// @description  Scan all free oases (map API) on a Travian T4.6 gameworld and send them — plus the current page's HTML — to the PvE Optimizer calculator, which does the parsing.
// @match        *://*.travian.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
//
// Runs IN PAGE CONTEXT (no @grant) so same-origin fetch carries your session cookie.
// Read-only: never writes to the game. Two jobs only:
//   • Scan oases  — sweep POST /api/v1/map/position (the only way to get the whole map).
//   • Send page   — postMessage the current rendered HTML to the calculator, which parses
//                   villages / farm-lists / troops from it. (Parsers live in the calculator so
//                   they can be fixed by redeploying the page — no userscript reinstall.)
// Open the relevant page (village sidebar, EXPANDED farm lists, troops overview), then Send page.

(function () {
  'use strict';
  if (window.top !== window.self) return;

  var CFG = Object.assign({ radius: 200, zoom: 3, step: 30, throttleMin: 500, throttleMax: 1500, calcUrl: '' },
    JSON.parse(localStorage.getItem('pveCollectorCfg') || '{}'));
  function saveCfg() { localStorage.setItem('pveCollectorCfg', JSON.stringify(CFG)); }

  // oasis scan result, cached so it survives page navigation
  var oases = []; try { oases = JSON.parse(localStorage.getItem('pveOasesCache') || '[]'); } catch (e) { oases = []; }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function jitter() { return CFG.throttleMin + Math.floor(Math.random() * (CFG.throttleMax - CFG.throttleMin)); }
  function api(method, endpoint, body) {
    return fetch(endpoint, { method: method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(endpoint + ' ' + r.status)); });
  }

  // ── scan free oases ──
  // POST /api/v1/map/position -> { tiles:[{position:{x,y}, title, text}] }; free oasis title has {k.fo};
  // bonus % in text via {a.r1}..{a.r4}.
  var RES_TOKEN = { r1: 'wood', r2: 'clay', r3: 'iron', r4: 'crop' };
  function parseBonuses(text) {
    var out = [];
    ['r1', 'r2', 'r3', 'r4'].forEach(function (rk) {
      var m = text && text.match(new RegExp('\\{a\\.' + rk + '\\}[^{}]*?(\\d+)\\s*%'));
      if (m) out.push({ res: RES_TOKEN[rk], pct: parseInt(m[1], 10) });
    });
    return out;
  }
  async function scanOases(log) {
    var R = CFG.radius, span = 30;
    try {
      var probe = await api('POST', '/api/v1/map/position', { data: { x: 0, y: 0, zoomLevel: CFG.zoom, ignorePositions: [] } });
      var xs = (probe.tiles || []).map(function (t) { return t.position.x; });
      if (xs.length) span = Math.max.apply(null, xs) - Math.min.apply(null, xs) + 1;
    } catch (e) { log('probe failed (' + e.message + '); using step ' + CFG.step); }
    var step = Math.max(1, Math.min(CFG.step, span - 1));
    var centers = [];
    for (var cx = -R; cx <= R; cx += step) for (var cy = -R; cy <= R; cy += step) centers.push([cx, cy]);
    log('Viewport span ' + span + ' → step ' + step + '; ' + centers.length + ' windows.');
    var seen = {}, found = [], noBonus = 0;
    for (var i = 0; i < centers.length; i++) {
      var c = centers[i];
      try {
        var res = await api('POST', '/api/v1/map/position', { data: { x: c[0], y: c[1], zoomLevel: CFG.zoom, ignorePositions: [] } });
        (res.tiles || []).forEach(function (t) {
          if ((t.title || '').indexOf('{k.fo}') === -1) return;
          var p = t.position || {}; if (p.x == null || p.y == null) return;
          var key = p.x + '|' + p.y; if (seen[key]) return; seen[key] = 1;
          var b = parseBonuses(t.text || ''); if (!b.length) noBonus++;
          found.push({ x: p.x, y: p.y, bonuses: b });
        });
      } catch (e) { log('  window ' + c + ' failed: ' + e.message); }
      if (i % 10 === 0) log('  …' + (i + 1) + '/' + centers.length + ' (' + found.length + ' oases)');
      await sleep(jitter());
    }
    oases = found;
    try { localStorage.setItem('pveOasesCache', JSON.stringify(oases)); } catch (e) { /* quota — still in memory */ }
    log('Done: ' + oases.length + ' free oases' + (noBonus ? ' (' + noBonus + ' with unreadable bonus)' : '') + '. Now click "Send oases".');
  }

  // ── send a payload to the calculator (open/reuse window, handshake, retry) ──
  function send(payload, log) {
    if (!CFG.calcUrl) { log('Set the Calculator URL first.'); return; }
    var w = window.open(CFG.calcUrl, 'pveCalc');
    if (!w) { log('Popup blocked — allow popups for this site.'); return; }
    var done = false, tries = 0;
    function fin(m) { done = true; clearInterval(iv); window.removeEventListener('message', onMsg); log(m); }
    function onMsg(ev) { if (ev.source === w && ev.data === 'pve-ready' && !done) { w.postMessage(payload, '*'); fin('Sent ✓'); } }
    window.addEventListener('message', onMsg);
    var iv = setInterval(function () {
      if (done) return;
      if (tries++ > 15) { fin('No ack — check the Calculator URL / that the tab opened.'); return; }
      try { w.postMessage(payload, '*'); } catch (e) { /* not ready */ }
    }, 700);
  }
  function sendPage(log) { send({ pve: 'page', html: document.documentElement.outerHTML, server: location.origin }, log); }
  function sendOases(log) {
    if (!oases.length) { log('Scan oases first.'); return; }
    send({ pve: 'oases', oases: oases, server: location.origin, mapRadius: CFG.radius }, log);
  }

  // ── panel ──
  function buildPanel() {
    var p = document.createElement('div');
    p.style.cssText = 'position:fixed;right:10px;top:80px;z-index:99999;width:300px;background:#1c1917;color:#e0e0e0;border:1px solid #57534e;border-radius:8px;font:12px/1.4 Segoe UI,sans-serif;padding:10px;box-shadow:0 4px 16px rgba(0,0,0,.5)';
    p.innerHTML =
      '<div style="font-weight:600;color:#f5f0e8;margin-bottom:6px">PvE Optimizer — Collector</div>' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">Radius <input id="pveRad" type="number" style="width:54px" value="' + CFG.radius + '"> Step <input id="pveStep" type="number" style="width:44px" value="' + CFG.step + '"></div>' +
      '<input id="pveCalc" placeholder="Calculator URL (required)" style="width:100%;margin-bottom:6px" value="' + (CFG.calcUrl || '') + '">' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap"><button id="pveScan">Scan oases</button><button id="pveSendO">Send oases</button><button id="pveSendP">Send this page</button></div>' +
      '<div id="pveLog" style="margin-top:8px;max-height:170px;overflow:auto;font-family:monospace;font-size:11px;color:#a8a29e"></div>';
    document.body.appendChild(p);
    Array.prototype.forEach.call(p.querySelectorAll('button'), function (b) { b.style.cssText = 'background:#44403c;color:#f5f0e8;border:1px solid #57534e;border-radius:5px;padding:5px 8px;cursor:pointer;font-size:11px'; });

    var logEl = p.querySelector('#pveLog');
    function log(m) { var d = document.createElement('div'); d.textContent = m; logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight; }
    function readCfg() { CFG.radius = Number(p.querySelector('#pveRad').value) || 200; CFG.step = Number(p.querySelector('#pveStep').value) || 30; CFG.calcUrl = p.querySelector('#pveCalc').value.trim(); saveCfg(); }
    p.querySelector('#pveScan').onclick = function () { readCfg(); scanOases(log); };
    p.querySelector('#pveSendO').onclick = function () { readCfg(); sendOases(log); };
    p.querySelector('#pveSendP').onclick = function () { readCfg(); sendPage(log); };
    log('Ready. Flow: Scan oases → Send oases. Then open each page (village list, EXPANDED farm lists, troops overview) and Send this page.');
    if (oases.length) log('(' + oases.length + ' oases cached from a previous scan — Send oases to reuse.)');
  }

  if (document.body) buildPanel(); else window.addEventListener('DOMContentLoaded', buildPanel);
})();
