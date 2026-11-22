// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail dialog with the model's own
// equation and the protocol's farm plan, and a sandbox that re-ranks the board live. No network:
// every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var rows = DATA.rows || [];
  var live = DATA.live || [];
  var published = DATA.model || {};
  var params = {
    base_multiple: published.base_multiple ?? 0.25,
    growth_weight: published.growth_weight ?? 0.6,
    growth_floor: published.growth_floor ?? -80,
    growth_cap: published.growth_cap ?? 150,
    maturity_floor: published.maturity_floor ?? 0.65,
    maturity_range: published.maturity_range ?? 0.35,
    maturity_days: published.maturity_days ?? 1095,
    unknown_age_days: published.unknown_age_days ?? 365,
    youth_days: published.youth_days ?? 90,
    youth_factor: published.youth_factor ?? 0.85,
    chain_bonus: published.chain_bonus ?? 0.02,
    chain_max: published.chain_max ?? 4,
  };
  var sandboxOn = false;
  var maxImplied = rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre', sort: 'implied', dir: -1, selected: null };
  var WATCH = {};
  rows.forEach(function (r) { if (r.on_watchlist) WATCH[r.slug] = true; });

  function $(id) { return document.getElementById(id); }
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function usdFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageFmt(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // The radar-2 model in one function: the page recomputes a row from the snapshot figures and
  // checks the number board.json carries, so the page's arithmetic and the board's data are
  // visibly the same. The sandbox calls it with changed constants.
  function impliedOf(row, p) {
    var growth = Math.min(p.growth_cap, Math.max(p.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * p.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? p.unknown_age_days : row.age_days;
    var maturity = p.maturity_floor + (Math.min(Math.max(age, 0), p.maturity_days) / p.maturity_days) * p.maturity_range;
    var youth = row.age_days !== null && row.age_days !== undefined && row.age_days < p.youth_days ? p.youth_factor : 1;
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), p.chain_max);
    var chainMult = 1 + extra * p.chain_bonus;
    var cat = (row.category || '').toLowerCase();
    var sector = 1;
    if (cat.indexOf('rwa') >= 0) sector = 1.15;
    else if (cat.indexOf('risk curator') >= 0 || cat.indexOf('capital allocator') >= 0 || cat.indexOf('onchain capital') >= 0) sector = 1.1;
    else if (cat.indexOf('yield') >= 0 || cat.indexOf('basis') >= 0) sector = 1.05;
    else if (cat.indexOf('derivative') >= 0 || cat.indexOf('perpetual') >= 0) sector = 0.95;
    var computed = Math.max(1, Math.round(row.tvl_usd * p.base_multiple * growthMult * maturity * youth * chainMult * sector));
    return { computed: computed, growth: growth, growthMult: growthMult, maturity: maturity, youth: youth, chainMult: chainMult, sector: sector, age: age };
  }

  // Re-rank the board under the sandbox constants, with the same one-dollar tie-break.
  function reranked() {
    var scored = rows.map(function (r) {
      var v = impliedOf(r, params);
      return { row: r, value: v.computed, detail: v };
    });
    scored.sort(function (a, b) { return b.value - a.value || (a.row.slug < b.row.slug ? -1 : 1); });
    var prev = Infinity;
    return scored.map(function (s, i) {
      var value = s.value;
      var tie = 0;
      if (value >= prev) { tie = value - (prev - 1); value = prev - 1; }
      prev = value;
      return { row: s.row, value: value, computed: s.value, tie: tie, detail: s.detail, rank: i + 1 };
    });
  }

  function visible(list) {
    var q = state.q.trim().toLowerCase();
    return list.filter(function (item) {
      var r = item.row || item;
      if (state.watchOnly && !WATCH[r.slug]) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  var SORTS = {
    rank: function (a, b) { return (a.rank || a.row.rank) - (b.rank || b.row.rank); },
    implied: function (a, b) { return (b.value ?? b.row.implied_value_usd) - (a.value ?? a.row.implied_value_usd); },
    tvl: function (a, b) { return (b.row.tvl_usd) - (a.row.tvl_usd); },
    growth: function (a, b) { return (b.row.change_7d ?? -999) - (a.row.change_7d ?? -999); },
    age: function (a, b) { return (b.row.age_days ?? -1) - (a.row.age_days ?? -1); },
    name: function (a, b) { return a.row.name.localeCompare(b.row.name); },
    category: function (a, b) { return String(a.row.category || '').localeCompare(String(b.row.category || '')); },
  };

  function sortList(list) {
    var fn = SORTS[state.sort] || SORTS.implied;
    var out = list.slice().sort(fn);
    if (state.dir === 1) out.reverse();
    return out;
  }

  function rowHtml(item) {
    var r = item.row;
    var value = item.value ?? r.implied_value_usd;
    var rank = item.rank ?? r.rank;
    var width = Math.max(2, Math.round((value / maxImplied) * 100));
    var g = r.change_7d;
    var gCls = g === null ? '' : g >= 0 ? 'pos' : 'neg';
    return '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="rank">' + rank + '</td>' +
      '<td class="name">' + esc(r.name) + (WATCH[r.slug] ? '<span class="tag">WATCHLIST</span>' : '') + '<small>' + esc(r.slug) + '</small></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td>' + esc((r.chains || []).slice(0, 3).join(', ')) + ((r.chains || []).length > 3 ? ' +' + ((r.chains || []).length - 3) : '') + '</td>' +
      '<td class="num">' + usd(r.tvl_usd) + '</td>' +
      '<td class="num ' + gCls + '">' + pct(g) + '</td>' +
      '<td class="num">' + ageFmt(r.age_days) + '</td>' +
      '<td class="num"><strong>' + usd(value) + '</strong></td>' +
      '<td><div class="bar"><i style="width:' + width + '%"></i></div></td>' +
      '</tr>';
  }

  function renderBoard() {
    var list = sandboxOn ? reranked() : rows.map(function (r) { return { row: r, value: r.implied_value_usd, computed: r.computed_value_usd, tie: r.tie_break_usd, rank: r.rank }; });
    var shown = sortList(visible(list));
    var body = $('rows');
    body.innerHTML = shown.map(rowHtml).join('');
    $('empty').hidden = shown.length !== 0;
    $('count').textContent = shown.length + ' of ' + rows.length + ' pre-token protocols' + (sandboxOn ? ' · sandbox model active' : '');
    $('livewrap').hidden = state.tab !== 'live';
    $('board').closest('.tablewrap').hidden = state.tab === 'live';
    $('tab-pre').setAttribute('aria-selected', state.tab === 'pre' ? 'true' : 'false');
    $('tab-live').setAttribute('aria-selected', state.tab === 'live' ? 'true' : 'false');
  }

  function renderLive() {
    $('liverows').innerHTML = live.map(function (p, i) {
      return '<tr><td class="rank">' + (i + 1) + '</td><td class="name">' + esc(p.name) + '<small>' + esc(p.slug) + '</small></td>' +
        '<td>' + esc(p.category || '—') + '</td><td>' + esc((p.chains || []).slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + usd(p.mcap_usd) + '</td>' +
        '<td class="num ' + (p.change_7d !== null && p.change_7d < 0 ? 'neg' : 'pos') + '">' + pct(p.change_7d) + '</td></tr>';
    }).join('');
  }

  function fillSelects() {
    var cats = {};
    var chains = {};
    rows.concat(live).forEach(function (r) {
      cats[r.category || 'Uncategorised'] = true;
      (r.chains || []).forEach(function (c) { chains[c] = true; });
    });
    var catSel = $('cat');
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c; catSel.appendChild(o);
    });
    var chainSel = $('chain');
    Object.keys(chains).sort().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c; chainSel.appendChild(o);
    });
  }

  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    if (!r) return;
    state.selected = slug;
    var v = sandboxOn ? impliedOf(r, params) : null;
    var computed = sandboxOn ? v.computed : r.computed_value_usd;
    var shown = sandboxOn ? v.computed : r.implied_value_usd;
    var tie = sandboxOn ? 0 : r.tie_break_usd;
    var growth = sandboxOn ? v.growth : (r.change_7d === null ? 0 : Math.min(150, Math.max(-80, r.change_7d)));
    var body = $('detailbody');
    var sectorLabel = r.sector || 'Other';
    var html = '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' · ' + esc(r.slug) + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc((r.chains || []).join(', ')) + (WATCH[r.slug] ? ' · Watchlist' : '') + '</p>' +
      '<dl class="kv">' +
      '<div><dt>Implied value</dt><dd>' + usdFull(shown) + '</dd></div>' +
      '<div><dt>TVL</dt><dd>' + usdFull(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7d change</dt><dd>' + pct(r.change_7d) + '</dd></div>' +
      '<div><dt>Age</dt><dd>' + ageFmt(r.age_days) + '</dd></div>' +
      '<div><dt>Listed</dt><dd>' + esc(r.listed_at || 'unknown') + '</dd></div>' +
      '<div><dt>Token</dt><dd>records none</dd></div>' +
      '</dl>' +
      '<div class="eq"><h3>How the value is built (radar-2)</h3><table>' +
      '<tr><td>Base — TVL × ' + (sandboxOn ? params.base_multiple : published.base_multiple) + '</td><td>' + usdFull(r.tvl_usd * (sandboxOn ? params.base_multiple : published.base_multiple)) + '</td></tr>' +
      '<tr><td>Growth — 7d ' + pct(r.change_7d) + ' clamped to ' + growth + '% → ×' + (sandboxOn ? v.growthMult.toFixed(4) : r.growth_multiplier.toFixed(4)) + '</td><td>×' + (sandboxOn ? v.growthMult.toFixed(4) : r.growth_multiplier.toFixed(4)) + '</td></tr>' +
      '<tr><td>Maturity — ' + ageFmt(r.age_days) + ' → ×' + (sandboxOn ? v.maturity.toFixed(4) : r.maturity_multiplier.toFixed(4)) + '</td><td>×' + (sandboxOn ? v.maturity.toFixed(4) : r.maturity_multiplier.toFixed(4)) + '</td></tr>' +
      '<tr><td>Youth — ' + (r.age_days !== null && r.age_days < 90 ? 'listed under 90 days' : 'established') + ' → ×' + (sandboxOn ? v.youth.toFixed(2) : r.youth_multiplier.toFixed(2)) + '</td><td>×' + (sandboxOn ? v.youth.toFixed(2) : r.youth_multiplier.toFixed(2)) + '</td></tr>' +
      '<tr><td>Chains — ' + (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's') + ' → ×' + (sandboxOn ? v.chainMult.toFixed(2) : r.chain_multiplier.toFixed(2)) + '</td><td>×' + (sandboxOn ? v.chainMult.toFixed(2) : r.chain_multiplier.toFixed(2)) + '</td></tr>' +
      '<tr><td>Sector — ' + esc(sectorLabel) + ' → ×' + (sandboxOn ? v.sector.toFixed(2) : r.sector_multiplier.toFixed(2)) + '</td><td>×' + (sandboxOn ? v.sector.toFixed(2) : r.sector_multiplier.toFixed(2)) + '</td></tr>' +
      '<tr class="total"><td>Computed value</td><td>' + usdFull(computed) + '</td></tr>' +
      '</table>' +
      (tie > 0 ? '<p class="tiebreak">Tie-break: this row computed the same value as the row above, so it steps down $' + tie + ' to keep the ranking strict.</p>' : '') +
      (sandboxOn ? '<p class="checkline">Sandbox model active: the value above is recomputed with your sliders.</p>'
        : '<p class="checkline">The page recomputes ' + usdFull(computed) + ' from the same figures — it matches the board.</p>') +
      '</div>' +
      '<div class="farm"><h3>Farm plan — six steps</h3><ol>' +
      (r.farm_steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol></div>';
    body.innerHTML = html;
    var dlg = $('detail');
    if (!dlg.open) dlg.showModal();
    writeHash();
  }

  function closeDetail() {
    var dlg = $('detail');
    if (dlg.open) dlg.close();
    state.selected = null;
    writeHash();
  }

  function writeHash() {
    var h = state.selected ? '#' + state.selected : '';
    try {
      history.replaceState(null, '', h || window.location.pathname + window.location.search);
    } catch (e) { /* file:// or sandboxed: ignore */ }
  }

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (h) openDetail(h);
  }

  function applySandbox() {
    sandboxOn = true;
    $('sandboxnote').textContent = 'Showing your model: base ' + params.base_multiple.toFixed(2) + ', growth weight ' + params.growth_weight.toFixed(2) + ', maturity floor ' + params.maturity_floor.toFixed(2) + '.';
    renderBoard();
  }

  function resetSandbox() {
    params.base_multiple = published.base_multiple ?? 0.25;
    params.growth_weight = published.growth_weight ?? 0.6;
    params.maturity_floor = published.maturity_floor ?? 0.65;
    $('in-base').value = params.base_multiple;
    $('in-growth').value = params.growth_weight;
    $('in-mat').value = params.maturity_floor;
    $('out-base').textContent = params.base_multiple.toFixed(2);
    $('out-growth').textContent = params.growth_weight.toFixed(2);
    $('out-mat').textContent = params.maturity_floor.toFixed(2);
    sandboxOn = false;
    $('sandboxnote').textContent = 'Showing the published model.';
    renderBoard();
  }

  // Wire up the controls.
  $('q').addEventListener('input', function () { state.q = $('q').value; renderBoard(); });
  $('cat').addEventListener('change', function () { state.category = $('cat').value; renderBoard(); });
  $('chain').addEventListener('change', function () { state.chain = $('chain').value; renderBoard(); });
  $('watchonly').addEventListener('change', function () { state.watchOnly = $('watchonly').checked; renderBoard(); });
  $('sort').addEventListener('change', function () { state.sort = $('sort').value; state.dir = -1; renderBoard(); });
  $('tab-pre').addEventListener('click', function () { state.tab = 'pre'; renderBoard(); });
  $('tab-live').addEventListener('click', function () { state.tab = 'live'; renderBoard(); });
  $('clear').addEventListener('click', function () {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false;
    $('q').value = ''; $('cat').value = 'all'; $('chain').value = 'all'; $('watchonly').checked = false;
    renderBoard();
  });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  document.querySelectorAll('#board thead th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = -1; }
      $('sort').value = state.sort;
      renderBoard();
    });
  });
  $('detail').addEventListener('close', function () { state.selected = null; writeHash(); });
  $('in-base').addEventListener('input', function () {
    params.base_multiple = parseFloat($('in-base').value);
    $('out-base').textContent = params.base_multiple.toFixed(2);
    applySandbox();
  });
  $('in-growth').addEventListener('input', function () {
    params.growth_weight = parseFloat($('in-growth').value);
    $('out-growth').textContent = params.growth_weight.toFixed(2);
    applySandbox();
  });
  $('in-mat').addEventListener('input', function () {
    params.maturity_floor = parseFloat($('in-mat').value);
    $('out-mat').textContent = params.maturity_floor.toFixed(2);
    applySandbox();
  });
  $('sandbox-reset').addEventListener('click', resetSandbox);
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

  // First paint.
  $('asof').textContent = 'snapshot ' + (DATA.as_of || '—');
  $('src').textContent = DATA.source || '—';
  $('meta').textContent = DATA.board_size + ' ranked protocols · watchlist ' + DATA.watchlist_size + ' · ' +
    DATA.early_size + ' early finds below the floor · ' + DATA.live_size + ' live-token protocols set aside · model ' + DATA.model_version;
  fillSelects();
  renderLive();
  renderBoard();
  readHash();
})();
