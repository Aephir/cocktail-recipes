/* ══════════════════════════════════════════════════════════════════════════
   Cocktail Book — app.js
══════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ── State ─────────────────────────────────────────────────────────────── */
const S = {
  user: null,
  recipes: [],
  ingredients: [],
  tools: [],
  customFields: [],     // CustomFieldDef list
  activeIngs: new Set(),
  activeTools: new Set(),
  activeCategories: new Set(),
  activeSubtypes: new Set(),
  activeTags: new Set(),
  filterModeIngs: 'all',
  filterModeTools: 'all',
  filterModeCategories: 'all',
  filterModeSubtypes: 'all',
  filterModeTags: 'all',
  search: '',
  currentId: null,
  editingId: null,
  scale: 1,
  pendingImage: null,
  sidebarCollapsed: false,
  sidebarMobileOpen: false,
};

const CATEGORY_OPTIONS = [
  'Cocktail', 'Highball', 'Collins', 'Fizz', 'Julep', 'Cobbler',
  'Flip', 'Nog', 'Punch', 'Toddy', 'Buck', 'Rickey', 'Smash',
  'Swizzle', 'Other'
];
const SUBTYPE_OPTIONS = ['Sour', 'Aromatic', 'Old-Fashioned', 'Improved', 'Daisy'];

function normalizeTag(tag) {
  return String(tag || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function parseTags(value) {
  if (Array.isArray(value)) {
    return value.map(t => normalizeTag(t)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map(t => normalizeTag(t)).filter(Boolean);
  }
  return [];
}

function formatTags(tags) {
  return tags.map(normalizeTag).filter(Boolean);
}

function updateSubtypeState() {
  const category = document.getElementById('f-category')?.value;
  const subtype = document.getElementById('f-subtype');
  if (!subtype) return;
  if (category === 'Cocktail') {
    subtype.disabled = false;
  } else {
    subtype.disabled = true;
    subtype.value = '';
  }
}

function populateClassificationSelectors() {
  const categorySelect = document.getElementById('f-category');
  const subtypeSelect = document.getElementById('f-subtype');
  if (categorySelect) {
    categorySelect.innerHTML = CATEGORY_OPTIONS.map(cat => `<option value="${esc(cat)}">${esc(cat)}</option>`).join('');
  }
  if (subtypeSelect) {
    subtypeSelect.innerHTML = [''].concat(SUBTYPE_OPTIONS).map(sub => `<option value="${esc(sub)}">${esc(sub)}</option>`).join('');
    subtypeSelect.disabled = true;
  }
  categorySelect?.addEventListener('change', updateSubtypeState);
}

/* ── API ────────────────────────────────────────────────────────────────── */
async function api(method, path, body = null) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  let data = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch (err) {
      throw new Error(`Invalid JSON response (${res.status})`);
    }
  } else {
    const text = await res.text();
    if (text) {
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  if (res.status === 401) {
    showLogin();
    // Distinguish between login failure (AUTH_FAILED) and session expiry
    const message = data.code === 'AUTH_FAILED' ? data.error : 'Session expired';
    throw new Error(message);
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ── Formatting ─────────────────────────────────────────────────────────── */
function fmtAmount(amount, unit, scale) {
  if (amount == null) return '';
  const v = amount * scale;
  if (unit === 'ml') {
    const r = Math.round(v * 10) / 10;
    return r % 1 === 0 ? String(Math.round(r)) : r.toFixed(1);
  }
  const r = Math.round(v * 100) / 100;
  if (r % 1 === 0) return String(Math.round(r));
  return parseFloat(r.toFixed(2)).toString();
}

function totalMl(recipe, scale) {
  let sum = 0, hasOther = false;
  for (const i of recipe.ingredients) {
    if (i.unit === 'ml' && i.amount != null) sum += i.amount * scale;
    else if (i.amount != null) hasOther = true;
  }
  if (sum === 0) return '';
  const r = Math.round(sum * 10) / 10;
  const s = r % 1 === 0 ? String(Math.round(r)) : r.toFixed(1);
  return `${s} ml${hasOther ? '*' : ''}`;
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── Auth ───────────────────────────────────────────────────────────────── */
async function init() {
  try {
    const user = await api('GET', '/api/auth/me');
    setUser(user);
  } catch {
    showLogin();
  }
}

function setUser(user) {
  S.user = user;
  document.getElementById('user-pill').textContent = user.username;
  const isAdmin = user.role === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin));
  showApp();
  loadData();
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('l-pass').value = '';
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

/* ── Data ───────────────────────────────────────────────────────────────── */
async function loadData() {
  const [recipes, fields] = await Promise.all([
    api('GET', '/api/recipes'),
    api('GET', '/api/fields'),
  ]);
  S.recipes = recipes;
  S.customFields = fields;
  buildSidebar();
  updateFilterModeButtons();
  applyFilters();
}

/* ── Filtering (client-side) ────────────────────────────────────────────── */
function applyFilters() {
  const q = S.search.toLowerCase().trim();
  let list = S.recipes;

  if (q) {
    list = list.filter(r => {
      const text = [
        r.name,
        r.category,
        r.subtype,
        ...(r.tags || []),
      ].filter(Boolean).join(' ').toLowerCase();
      return text.includes(q);
    });
  }

  if (S.activeCategories.size) {
    if (S.filterModeCategories === 'all') {
      list = list.filter(r => [...S.activeCategories].every(cat => r.category === cat));
    } else {
      list = list.filter(r => S.activeCategories.has(r.category));
    }
  }

  if (S.activeSubtypes.size) {
    if (S.filterModeSubtypes === 'all') {
      list = list.filter(r => [...S.activeSubtypes].every(sub => r.subtype === sub));
    } else {
      list = list.filter(r => r.subtype && S.activeSubtypes.has(r.subtype));
    }
  }

  if (S.activeTags.size) {
    if (S.filterModeTags === 'all') {
      list = list.filter(r => (r.tags || []).every(tag => S.activeTags.has(tag)));
    } else {
      list = list.filter(r => (r.tags || []).some(tag => S.activeTags.has(tag)));
    }
  }

  if (S.activeIngs.size) {
    list = list.filter(r => {
      const names = new Set(r.ingredients.map(i => i.ingredient_name));
      if (S.filterModeIngs === 'all') {
        return [...S.activeIngs].every(n => names.has(n));
      } else {
        return [...S.activeIngs].some(n => names.has(n));
      }
    });
  }

  if (S.activeTools.size) {
    list = list.filter(r => {
      const names = new Set(r.tools.map(t => t.tool_name));
      if (S.filterModeTools === 'all') {
        return [...S.activeTools].every(n => names.has(n));
      } else {
        return [...S.activeTools].some(n => names.has(n));
      }
    });
  }

  list = sortRecipes(list);
  renderCards(list);
  renderActivePills();
  updateSidebarCounts(list);
}

function sortRecipes(list) {
  const sortKey = document.getElementById('sort-by')?.value || 'rating';
  return [...list].sort((a, b) => {
    if (sortKey === 'alphabetic') {
      return a.name.localeCompare(b.name);
    }
    if (sortKey === 'newest') {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    }
    return (b.score || 0) - (a.score || 0);
  });
}

function toggleIng(name) {
  S.activeIngs.has(name) ? S.activeIngs.delete(name) : S.activeIngs.add(name);
  refreshChipStates();
  applyFilters();
}

function toggleTool(name) {
  S.activeTools.has(name) ? S.activeTools.delete(name) : S.activeTools.add(name);
  refreshChipStates();
  applyFilters();
}

function toggleCategory(name) {
  S.activeCategories.has(name) ? S.activeCategories.delete(name) : S.activeCategories.add(name);
  refreshChipStates();
  applyFilters();
}

function toggleSubtype(name) {
  S.activeSubtypes.has(name) ? S.activeSubtypes.delete(name) : S.activeSubtypes.add(name);
  refreshChipStates();
  applyFilters();
}

function toggleTag(name) {
  S.activeTags.has(name) ? S.activeTags.delete(name) : S.activeTags.add(name);
  refreshChipStates();
  applyFilters();
}

function updateFilterModeButtons() {
  const groups = ['ings', 'tools', 'categories', 'subtypes', 'tags'];
  groups.forEach(group => {
    const toggle = document.querySelector(`.filter-mode-toggle[data-group="${group}"]`);
    if (!toggle) return;
    const mode = S[`filterMode${group.charAt(0).toUpperCase() + group.slice(1)}`];
    toggle.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  });
}

/* ── Sidebar ────────────────────────────────────────────────────────────── */
function buildSidebar() {
  const ingCounts = new Map();
  const toolCounts = new Map();
  const categoryCounts = new Map();
  const subtypeCounts = new Map();
  const tagCounts = new Map();

  for (const r of S.recipes) {
    r.ingredients.forEach(i => ingCounts.set(i.ingredient_name, (ingCounts.get(i.ingredient_name) || 0) + 1));
    r.tools.forEach(t => toolCounts.set(t.tool_name, (toolCounts.get(t.tool_name) || 0) + 1));
    const category = r.category || 'Other';
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    if (r.subtype) subtypeCounts.set(r.subtype, (subtypeCounts.get(r.subtype) || 0) + 1);
    (r.tags || []).forEach(tag => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
  }

  const sortedIngs = [...ingCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const sortedTools = [...toolCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const sortedCategories = [...categoryCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const sortedSubtypes = [...subtypeCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const sortedTags = [...tagCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  document.getElementById('ing-total').textContent = sortedIngs.length;
  document.getElementById('tool-total').textContent = sortedTools.length;
  document.getElementById('cat-total').textContent = sortedCategories.length;
  document.getElementById('subtype-total').textContent = sortedSubtypes.length;
  document.getElementById('tag-total').textContent = sortedTags.length;

  renderChips('cat-list', sortedCategories, S.activeCategories, 'category');
  renderChips('subtype-list', sortedSubtypes, S.activeSubtypes, 'subtype');
  renderChips('tag-list', sortedTags, S.activeTags, 'tag');
  renderChips('ing-list', sortedIngs, S.activeIngs, 'ing');
  renderChips('tool-list', sortedTools, S.activeTools, 'tool');
}

function renderChips(containerId, entries, activeSet, type) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  for (const [name, count] of entries) {
    const btn = document.createElement('button');
    btn.className = `fchip${activeSet.has(name) ? ' active' : ''}`;
    btn.dataset.name = name;
    btn.dataset.type = type;
    btn.innerHTML = `<span>${esc(name)}</span><span class="chip-ct">${count}</span>`;
    el.appendChild(btn);
  }
}

function refreshChipStates() {
  document.querySelectorAll('#ing-list .fchip').forEach(btn => {
    btn.classList.toggle('active', S.activeIngs.has(btn.dataset.name));
  });
  document.querySelectorAll('#tool-list .fchip').forEach(btn => {
    btn.classList.toggle('active', S.activeTools.has(btn.dataset.name));
  });
  document.querySelectorAll('#cat-list .fchip').forEach(btn => {
    btn.classList.toggle('active', S.activeCategories.has(btn.dataset.name));
  });
  document.querySelectorAll('#subtype-list .fchip').forEach(btn => {
    btn.classList.toggle('active', S.activeSubtypes.has(btn.dataset.name));
  });
  document.querySelectorAll('#tag-list .fchip').forEach(btn => {
    btn.classList.toggle('active', S.activeTags.has(btn.dataset.name));
  });
}

function updateSidebarCounts(filtered) {
  const ingCounts = new Map();
  const toolCounts = new Map();
  const categoryCounts = new Map();
  const subtypeCounts = new Map();
  const tagCounts = new Map();
  for (const r of filtered) {
    r.ingredients.forEach(i => ingCounts.set(i.ingredient_name, (ingCounts.get(i.ingredient_name) || 0) + 1));
    r.tools.forEach(t => toolCounts.set(t.tool_name, (toolCounts.get(t.tool_name) || 0) + 1));
    categoryCounts.set(r.category || 'Other', (categoryCounts.get(r.category || 'Other') || 0) + 1);
    if (r.subtype) subtypeCounts.set(r.subtype, (subtypeCounts.get(r.subtype) || 0) + 1);
    (r.tags || []).forEach(tag => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
  }
  document.querySelectorAll('#ing-list .fchip').forEach(btn => {
    btn.querySelector('.chip-ct').textContent = ingCounts.get(btn.dataset.name) || 0;
  });
  document.querySelectorAll('#tool-list .fchip').forEach(btn => {
    btn.querySelector('.chip-ct').textContent = toolCounts.get(btn.dataset.name) || 0;
  });
  document.querySelectorAll('#cat-list .fchip').forEach(btn => {
    btn.querySelector('.chip-ct').textContent = categoryCounts.get(btn.dataset.name) || 0;
  });
  document.querySelectorAll('#subtype-list .fchip').forEach(btn => {
    btn.querySelector('.chip-ct').textContent = subtypeCounts.get(btn.dataset.name) || 0;
  });
  document.querySelectorAll('#tag-list .fchip').forEach(btn => {
    btn.querySelector('.chip-ct').textContent = tagCounts.get(btn.dataset.name) || 0;
  });
}

function renderActivePills() {
  const c = document.getElementById('active-pills');
  const pills = [];
  for (const name of S.activeCategories) {
    pills.push(`<span class="apill" data-type="category" data-name="${name}">
      🧭 ${esc(name)}
      <button data-type="category" data-name="${name}" title="Remove filter">×</button>
    </span>`);
  }
  for (const name of S.activeSubtypes) {
    pills.push(`<span class="apill" data-type="subtype" data-name="${name}">
      ✦ ${esc(name)}
      <button data-type="subtype" data-name="${name}" title="Remove filter">×</button>
    </span>`);
  }
  for (const name of S.activeTags) {
    pills.push(`<span class="apill" data-type="tag" data-name="${name}">
      #${esc(name)}
      <button data-type="tag" data-name="${name}" title="Remove filter">×</button>
    </span>`);
  }
  for (const name of S.activeIngs) {
    pills.push(`<span class="apill" data-type="ing" data-name="${name}">
      ${esc(name)}
      <button data-type="ing" data-name="${name}" title="Remove filter">×</button>
    </span>`);
  }
  for (const name of S.activeTools) {
    pills.push(`<span class="apill" data-type="tool" data-name="${name}">
      ⚙ ${esc(name)}
      <button data-type="tool" data-name="${name}" title="Remove filter">×</button>
    </span>`);
  }
  c.innerHTML = pills.join('');
}

/* ── Cards ──────────────────────────────────────────────────────────────── */
function renderCards(list) {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const cnt = document.getElementById('recipe-count');

  if (!list.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    cnt.textContent = '';
    return;
  }
  empty.classList.add('hidden');
  cnt.textContent = list.length === 1 ? '1 recipe' : `${list.length} recipes`;

  grid.innerHTML = list.map(r => {
    const thumbHtml = r.image_url
      ? `<img src="${esc(r.image_url)}" alt="${esc(r.name)}" loading="lazy">`
      : `<div class="card-thumb-placeholder">◈</div>`;

    const tags = r.ingredients.slice(0, 3)
      .map(i => `<span class="ctag${S.activeIngs.has(i.ingredient_name) ? ' active' : ''}">${esc(i.ingredient_name)}</span>`)
      .join('');
    const more = r.ingredients.length > 3
      ? `<span class="ctag">+${r.ingredients.length - 3}</span>` : '';

    const scoreLabel = r.score != null ? `<div class="card-score">${esc(r.score)}/10</div>` : '';
    const classification = r.category ? esc(r.category) + (r.subtype ? ` · ${esc(r.subtype)}` : '') : '';

    return `
      <div class="recipe-card" data-id="${r.id}">
        <div class="card-thumb">${thumbHtml}</div>
        <div class="card-body">
          <div class="card-head">
            <div class="card-name">${esc(r.name)}</div>
            ${scoreLabel}
          </div>
          <div class="card-tags">${tags}${more}</div>
          <div class="card-meta">
            ${r.ingredients.length} ingredient${r.ingredients.length !== 1 ? 's' : ''}${classification ? ` · ${classification}` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ── Detail Panel ───────────────────────────────────────────────────────── */
function openRecipe(id) {
  const recipe = S.recipes.find(r => r.id === id);
  if (!recipe) return;
  S.currentId = id;
  S.scale = 1;
  renderDetail(recipe);
  document.getElementById('detail-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  document.getElementById('detail-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

function renderDetail(recipe) {
  const imgHtml = recipe.image_url
    ? `<img class="detail-image" src="${esc(recipe.image_url)}" alt="${esc(recipe.name)}">`
    : '';

  const ingRows = recipe.ingredients.map((i, idx) => {
    const dispName = i.subrecipe_name || i.ingredient_name;
    const nameHtml = i.subrecipe_id
      ? `<a href="#" class="recipe-link" data-rid="${i.subrecipe_id}">${esc(dispName)}</a>`
      : esc(dispName);
    return `
    <tr>
      <td class="itd-amt" data-ing-idx="${idx}" data-unit="${esc(i.unit)}" data-base="${i.amount ?? ''}">${
        i.amount != null ? fmtAmount(i.amount, i.unit, S.scale) : ''
      }</td>
      <td class="itd-unit">${i.amount != null ? esc(i.unit) : ''}</td>
      <td class="itd-name">${nameHtml}</td>
    </tr>`;
  }).join('');

  const toolsHtml = recipe.tools.length
    ? recipe.tools.map(t => `<span class="tool-chip">${esc(t.tool_name)}</span>`).join('')
    : '<span style="color:var(--text-muted)">—</span>';

  const garnishHtml = recipe.garnishes?.length
    ? `<div class="dsec">
        <div class="dsec-title">Garnish</div>
        <ul class="garnish-list">${recipe.garnishes.map(g => `<li>${esc(g.garnish_text || g.ingredient_name || '')}</li>`).join('')}</ul>
      </div>`
    : '';

  const vol = totalMl(recipe, S.scale);

  document.getElementById('detail-body').innerHTML = `
    ${imgHtml}
    <div class="detail-inner">
      <h1 class="detail-name">${esc(recipe.name)}</h1>
      ${recipe.score != null ? `<div class="detail-score">Rating ${esc(recipe.score)}/10</div>` : ''}

      <div class="servings-row">
        <span class="servings-lbl">Servings</span>
        <button class="srv-btn" id="srv-dn" data-dir="-1" ${S.scale <= 1 ? 'disabled' : ''}>−</button>
        <span class="srv-val" id="srv-val">${S.scale}</span>
        <button class="srv-btn" id="srv-up" data-dir="1">+</button>
        ${vol ? `<span class="srv-vol" id="srv-vol">${esc(vol)}</span>` : `<span class="srv-vol" id="srv-vol"></span>`}
      </div>

      ${recipe.ingredients.length ? `
      <div class="dsec">
        <div class="dsec-title">Ingredients</div>
        <table class="ing-table"><tbody>${ingRows}</tbody></table>
      </div>` : ''}

      ${recipe.procedure ? `
      <div class="dsec">
        <div class="dsec-title">Procedure</div>
        <div class="detail-prose"><ol>${recipe.procedure
          .replace(/\r/g, '')
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
          .map(line => `<li>${esc(line)}</li>`)
          .join('')}</ol></div>
      </div>` : ''}

      ${garnishHtml}

      ${recipe.notes ? `
      <div class="dsec">
        <div class="dsec-title">Notes</div>
        <div class="detail-prose">${esc(recipe.notes)}</div>
      </div>` : ''}

      <div class="dsec">
        <div class="dsec-title">Tools</div>
        <div class="detail-tools">${toolsHtml}</div>
      </div>

      <div class="detail-footer">
        Recipe #${recipe.id}
        ${recipe.created_at ? ' · Added ' + new Date(recipe.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : ''}
      </div>
    </div>`;

  document.querySelectorAll('.recipe-link').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const rid = Number(el.dataset.rid);
      if (rid) openRecipe(rid);
    });
  });

  // Inject custom fields into appropriate section if any have values
  const customSection = buildDetailCustomFields(recipe);
  if (customSection) {
    const footer = document.querySelector('.detail-footer');
    if (footer) footer.insertAdjacentHTML('beforebegin', customSection);
  }
}

function buildDetailCustomFields(recipe) {
  const cf = recipe.custom_fields || {};
  const rows = S.customFields
    .map(f => {
      const val = (cf[String(f.id)] || '').trim();
      if (!val) return '';
      let valHtml;
      if (f.field_type === 'url') {
        valHtml = `<a href="${esc(val)}" target="_blank" rel="noopener noreferrer">${esc(val)}</a>`;
      } else {
        valHtml = `<div class="dcf-val">${esc(val)}</div>`;
      }
      return `<div class="detail-custom-field"><div class="dcf-label">${esc(f.name)}</div>${valHtml}</div>`;
    })
    .filter(Boolean);

  if (!rows.length) return '';
  return `<div class="dsec"><div class="dsec-title">Details</div>${rows.join('')}</div>`;
}

function updateDetailScale() {
  const recipe = S.recipes.find(r => r.id === S.currentId);
  if (!recipe) return;

  document.getElementById('srv-val').textContent = S.scale;
  const dn = document.getElementById('srv-dn');
  if (dn) dn.disabled = S.scale <= 1;

  // Update amounts only
  document.querySelectorAll('.itd-amt[data-ing-idx]').forEach(cell => {
    const base = cell.dataset.base !== '' ? parseFloat(cell.dataset.base) : null;
    const unit = cell.dataset.unit;
    cell.textContent = base != null ? fmtAmount(base, unit, S.scale) : '';
  });

  const volEl = document.getElementById('srv-vol');
  if (volEl) volEl.textContent = totalMl(recipe, S.scale);
}

/* ── Recipe Form ────────────────────────────────────────────────────────── */
async function openAddForm() {
  S.editingId = null;
  S.pendingImage = null;
  resetForm();
  document.getElementById('form-title').textContent = 'New Recipe';
  await populateAutocomplete();
  renderFormCustomFields(S.editingId ? S.recipes.find(r => r.id === S.editingId) : null);
  document.getElementById('form-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('f-name').focus();
}

async function openEditForm() {
  const recipe = S.recipes.find(r => r.id === S.currentId);
  if (!recipe) return;
  S.editingId = recipe.id;
  S.pendingImage = recipe.image_filename
    ? { filename: recipe.image_filename, url: recipe.image_url }
    : null;

  resetForm();
  document.getElementById('form-title').textContent = 'Edit Recipe';
  document.getElementById('f-name').value = recipe.name;
  document.getElementById('f-proc').value = recipe.procedure || '';
  document.getElementById('f-notes').value = recipe.notes || '';
  document.getElementById('f-category').value = recipe.category || 'Other';
  document.getElementById('f-subtype').value = recipe.subtype || '';
  document.getElementById('f-tags').value = (recipe.tags || []).join(', ');
  updateSubtypeState();

  if (recipe.image_url) {
    document.getElementById('img-preview').src = recipe.image_url;
    document.getElementById('img-preview').classList.remove('hidden');
    document.getElementById('drop-placeholder').classList.add('hidden');
    document.getElementById('remove-img').classList.remove('hidden');
  }

  recipe.ingredients.forEach(i => addIngRow(i.amount ?? '', i.unit, i.ingredient_name, i.subrecipe_name || '', i.subrecipe_id ?? '', i.ingredient_id ?? ''));
  recipe.garnishes?.forEach(g => addGarnishRow(g.garnish_text || g.ingredient_name || '', g.ingredient_id ?? ''));
  recipe.tools.forEach(t => addToolRow(t.tool_name, t.tool_id ?? ''));
  document.getElementById('f-score').value = recipe.score != null ? String(recipe.score) : '5';

  await populateAutocomplete();
  renderFormCustomFields(recipe);
  document.getElementById('form-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function renderFormCustomFields(recipe) {
  // Remove existing custom section if any
  const existing = document.getElementById('f-custom-section');
  if (existing) existing.remove();
  if (!S.customFields.length) return;

  const existingValues = recipe?.custom_fields || {};
  const section = document.createElement('div');
  section.id = 'f-custom-section';
  section.className = 'custom-fields-section';

  S.customFields.forEach(f => {
    const div = document.createElement('div');
    div.className = 'field';
    const val = existingValues[String(f.id)] || '';
    let inputHtml;
    if (f.field_type === 'textarea') {
      inputHtml = `<textarea id="cf-${f.id}" rows="3" placeholder="${esc(f.name)}…">${esc(val)}</textarea>`;
    } else {
      const inputType = f.field_type === 'url' ? 'url' : 'text';
      inputHtml = `<input type="${inputType}" id="cf-${f.id}" value="${esc(val)}" placeholder="${esc(f.name)}">`;
    }
    div.innerHTML = `<label>${esc(f.name)}</label>${inputHtml}`;
    section.appendChild(div);
  });

  // Insert before the procedure field
  const procField = document.getElementById('f-proc').closest('.field');
  procField.parentNode.insertBefore(section, procField);
}

function resetForm() {
  document.getElementById('f-name').value = '';
  document.getElementById('f-score').value = '5';
  document.getElementById('f-category').value = 'Other';
  document.getElementById('f-subtype').value = '';
  document.getElementById('f-tags').value = '';
  updateSubtypeState();
  document.getElementById('f-proc').value = '';
  document.getElementById('f-notes').value = '';
  document.getElementById('f-ings').innerHTML = '';
  document.getElementById('f-garns').innerHTML = '';
  document.getElementById('f-tools').innerHTML = '';
  document.getElementById('f-image').value = '';
  document.getElementById('img-preview').src = '';
  document.getElementById('img-preview').classList.add('hidden');
  document.getElementById('drop-placeholder').classList.remove('hidden');
  document.getElementById('remove-img').classList.add('hidden');
  const cs = document.getElementById('f-custom-section');
  if (cs) cs.remove();
}

function closeForm() {
  document.getElementById('form-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

async function populateAutocomplete() {
  try {
    const [ings, tools] = await Promise.all([
      api('GET', '/api/ingredients'),
      api('GET', '/api/tools'),
    ]);
    document.getElementById('ing-opts').innerHTML = ings.map(i => `<option value="${esc(i.name)}">`).join('');
    document.getElementById('tool-opts').innerHTML = tools.map(t => `<option value="${esc(t.name)}">`).join('');
    document.getElementById('recipe-opts').innerHTML = S.recipes.map(r => `<option value="${esc(r.name)}">`).join('');
    S.ingredients = ings;
    S.tools = tools;
  } catch { /* non-critical */ }
}

function addIngRow(amount = '', unit = 'ml', name = '', subrecipeName = '', subrecipeId = '', ingredientId = '') {
  const row = document.createElement('div');
  row.className = 'ing-row';
  row.innerHTML = `
    <input type="number" class="f-ing-amt" value="${esc(String(amount))}" placeholder="Amt" step="any" min="0">
    <input type="text"   class="f-ing-unit" value="${esc(unit)}" placeholder="Unit" list="unit-opts">
    <input type="text"   class="f-ing-name" value="${esc(name)}" placeholder="Name" list="ing-opts">
    <input type="hidden" class="f-ing-ingredient-id" value="${esc(String(ingredientId))}">
    <input type="text"   class="f-ing-recipe" value="${esc(subrecipeName)}" placeholder="Recipe" list="recipe-opts">
    <input type="hidden" class="f-ing-subrecipe-id" value="${esc(String(subrecipeId))}">
    <button class="rm-btn" type="button" title="Remove">×</button>`;
  row.querySelector('.rm-btn').addEventListener('click', () => row.remove());
  const recipeInput = row.querySelector('.f-ing-recipe');
  const subrecipeIdInput = row.querySelector('.f-ing-subrecipe-id');
  const nameInput = row.querySelector('.f-ing-name');
  const ingredientIdInput = row.querySelector('.f-ing-ingredient-id');
  recipeInput.addEventListener('input', () => {
    const match = S.recipes.find(r => r.name.toLowerCase() === recipeInput.value.trim().toLowerCase());
    subrecipeIdInput.value = match ? String(match.id) : '';
  });
  nameInput.addEventListener('input', () => {
    const match = S.ingredients.find(i => i.name.toLowerCase() === nameInput.value.trim().toLowerCase());
    ingredientIdInput.value = match ? String(match.id) : '';
  });
  document.getElementById('f-ings').appendChild(row);
}

function addToolRow(name = '', toolId = '') {
  const row = document.createElement('div');
  row.className = 'tool-row';
  row.innerHTML = `
    <input type="text" class="f-tool-name" value="${esc(name)}" placeholder="Tool name" list="tool-opts">
    <input type="hidden" class="f-tool-id" value="${esc(String(toolId))}">
    <button class="rm-btn" type="button" title="Remove">×</button>`;
  row.querySelector('.rm-btn').addEventListener('click', () => row.remove());
  const nameInput = row.querySelector('.f-tool-name');
  const toolIdInput = row.querySelector('.f-tool-id');
  nameInput.addEventListener('input', () => {
    const match = S.tools.find(t => t.name.toLowerCase() === nameInput.value.trim().toLowerCase());
    toolIdInput.value = match ? String(match.id) : '';
  });
  document.getElementById('f-tools').appendChild(row);
}

function addGarnishRow(text = '', ingredientId = '') {
  const row = document.createElement('div');
  row.className = 'garn-row';
  row.innerHTML = `
    <input type="text" class="f-garn-text" value="${esc(text)}" placeholder="Garnish text or ingredient" list="ing-opts">
    <input type="hidden" class="f-garn-ingredient-id" value="${esc(String(ingredientId))}">
    <button class="rm-btn" type="button" title="Remove">×</button>`;
  row.querySelector('.rm-btn').addEventListener('click', () => row.remove());
  const textInput = row.querySelector('.f-garn-text');
  const ingredientIdInput = row.querySelector('.f-garn-ingredient-id');
  textInput.addEventListener('input', () => {
    const match = S.ingredients.find(i => i.name.toLowerCase() === textInput.value.trim().toLowerCase());
    ingredientIdInput.value = match ? String(match.id) : '';
  });
  document.getElementById('f-garns').appendChild(row);
}

async function saveRecipe() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { alert('Please enter a recipe name.'); return; }

  const ingredients = [];
  document.querySelectorAll('.ing-row').forEach(row => {
    const amtStr = row.querySelector('.f-ing-amt').value.trim();
    const unit   = row.querySelector('.f-ing-unit').value.trim() || 'ml';
    const iName  = row.querySelector('.f-ing-name').value.trim();
    const recipeName = row.querySelector('.f-ing-recipe').value.trim();
    const subrecipeId = row.querySelector('.f-ing-subrecipe-id').value.trim();
    const ingredientId = row.querySelector('.f-ing-ingredient-id').value.trim();
    if (iName || recipeName) {
      ingredients.push({
        amount: amtStr !== '' ? parseFloat(amtStr) : null,
        unit,
        ingredient_id: ingredientId || null,
        ingredient_name: iName || recipeName,
        subrecipe_id: subrecipeId || null,
      });
    }
  });

  const tools = [];
  document.querySelectorAll('.tool-row').forEach(row => {
    const t = row.querySelector('.f-tool-name').value.trim();
    const toolId = row.querySelector('.f-tool-id').value.trim();
    if (t) tools.push({
      tool_id: toolId || null,
      tool_name: t,
    });
  });

  const garnishes = [];
  document.querySelectorAll('.garn-row').forEach(row => {
    const text = row.querySelector('.f-garn-text').value.trim();
    const ingredientId = row.querySelector('.f-garn-ingredient-id').value.trim();
    if (text) garnishes.push({
      garnish_text: text,
      ingredient_id: ingredientId || null,
    });
  });

  const custom_fields = {};
  S.customFields.forEach(f => {
    const el = document.getElementById(`cf-${f.id}`);
    if (el) custom_fields[String(f.id)] = el.value.trim();
  });

  const category = document.getElementById('f-category').value;
  let subtype = document.getElementById('f-subtype').value.trim() || null;
  if (category !== 'Cocktail') subtype = null;
  const payload = {
    name,
    score: parseInt(document.getElementById('f-score').value, 10) || null,
    category,
    subtype,
    tags: parseTags(document.getElementById('f-tags').value),
    procedure: document.getElementById('f-proc').value.trim(),
    notes: document.getElementById('f-notes').value.trim(),
    ingredients,
    tools,
    garnishes,
    custom_fields,
    image_filename: S.pendingImage?.filename ?? null,
  };

  const btn = document.getElementById('form-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const editId = S.editingId;
    if (editId) {
      await api('PUT', `/api/recipes/${editId}`, payload);
    } else {
      await api('POST', '/api/recipes', payload);
    }
    closeForm();
    await loadData();
    if (editId) openRecipe(editId);
  } catch (e) {
    alert(`Save failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Recipe';
  }
}

/* ── Image Upload ───────────────────────────────────────────────────────── */
function setupImageUpload() {
  const dropArea = document.getElementById('drop-area');
  const fileInput = document.getElementById('f-image');
  const placeholder = document.getElementById('drop-placeholder');
  const preview = document.getElementById('img-preview');
  const removeBtn = document.getElementById('remove-img');

  placeholder.addEventListener('click', () => fileInput.click());
  preview.addEventListener('click', () => fileInput.click());

  dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.classList.add('drag-over'); });
  dropArea.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));
  dropArea.addEventListener('drop', e => {
    e.preventDefault();
    dropArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) uploadFile(fileInput.files[0]);
  });

  removeBtn.addEventListener('click', e => {
    e.stopPropagation();
    S.pendingImage = null;
    preview.src = '';
    preview.classList.add('hidden');
    placeholder.classList.remove('hidden');
    removeBtn.classList.add('hidden');
    fileInput.value = '';
  });
}

async function uploadFile(file) {
  const placeholder = document.getElementById('drop-placeholder');
  const preview = document.getElementById('img-preview');
  const removeBtn = document.getElementById('remove-img');

  placeholder.querySelector('span:last-child').textContent = 'Uploading…';

  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    S.pendingImage = { filename: data.filename, url: data.url };
    preview.src = data.url;
    preview.classList.remove('hidden');
    placeholder.classList.add('hidden');
    removeBtn.classList.remove('hidden');
  } catch (e) {
    placeholder.querySelector('span:last-child').textContent = 'Click or drag an image here';
    alert(`Upload failed: ${e.message}`);
  }
}

/* ── Manage Fields Modal ────────────────────────────────────────────────── */
function openFieldsModal() {
  renderFieldsList();
  document.getElementById('fields-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('new-field-name').focus();
}

function closeFieldsModal() {
  document.getElementById('fields-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  // Reload so any new fields appear in open forms
  loadData();
}

function renderFieldsList() {
  const list = document.getElementById('fields-list');
  if (!S.customFields.length) {
    list.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:4px 2px">No custom fields yet.</p>';
    return;
  }
  list.innerHTML = S.customFields.map(f => `
    <div class="field-def-row" data-fid="${f.id}">
      <div class="fdr-info">
        <div class="fdr-name">${esc(f.name)}</div>
        <div class="fdr-type">${f.field_type}</div>
      </div>
      <button class="rm-btn" data-del-field="${f.id}" title="Delete field">×</button>
    </div>`).join('');
}

/* ── Bulk Import Modal ─────────────────────────────────────────────────── */
function openBulkImportModal() {
  document.getElementById('bulk-import-json').value = '';
  document.getElementById('bulk-import-result').classList.add('hidden');
  document.getElementById('bulk-import-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('bulk-import-json').focus();
}

function closeBulkImportModal() {
  document.getElementById('bulk-import-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

async function submitBulkImport() {
  const jsonText = document.getElementById('bulk-import-json').value.trim();
  if (!jsonText) {
    alert('Please enter JSON data.');
    return;
  }

  function normalizeJsonText(text) {
    return text
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u00a0/g, ' ')
      .replace(/,\s*(?=[}\]])/g, '');
  }

  let data;
  const normalizedText = normalizeJsonText(jsonText);
  try {
    data = JSON.parse(normalizedText);
  } catch (e) {
    alert('Invalid JSON: ' + e.message);
    return;
  }

  if (!Array.isArray(data)) {
    alert('Data must be a JSON array of recipes.');
    return;
  }

  const btn = document.getElementById('bulk-import-submit');
  btn.disabled = true;
  btn.textContent = 'Importing…';

  try {
    const result = await api('POST', '/api/bulk-import', data);
    const resultEl = document.getElementById('bulk-import-result');
    resultEl.classList.remove('hidden');
    resultEl.className = result.imported > 0 ? 'alert-success' : 'alert-error';
    resultEl.innerHTML = `
      <strong>Imported: ${result.imported}</strong><br>
      ${result.errors.length ? 'Errors:<br>' + result.errors.map(e => `• ${e}`).join('<br>') : ''}
    `;
    if (result.imported > 0) {
      await loadData();
      document.getElementById('bulk-import-json').value = '';
    }
  } catch (e) {
    alert(`Import failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import';
  }
}

/* ── Delete ─────────────────────────────────────────────────────────────── */
function deleteCurrentRecipe() {
  const recipe = S.recipes.find(r => r.id === S.currentId);
  if (!recipe) return;
  showConfirm(`Delete "${recipe.name}"? This cannot be undone.`, async () => {
    try {
      await api('DELETE', `/api/recipes/${S.currentId}`);
      closeDetail();
      await loadData();
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    }
  });
}

/* ── Confirm dialog ─────────────────────────────────────────────────────── */
function showConfirm(msg, onOk) {
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-overlay').classList.remove('hidden');

  const ok = document.getElementById('confirm-ok');
  const cancel = document.getElementById('confirm-cancel');

  function done(run) {
    document.getElementById('confirm-overlay').classList.add('hidden');
    ok.removeEventListener('click', handleOk);
    cancel.removeEventListener('click', handleCancel);
    if (run) onOk();
  }
  const handleOk = () => done(true);
  const handleCancel = () => done(false);

  ok.addEventListener('click', handleOk);
  cancel.addEventListener('click', handleCancel);
}

/* ── Event Wiring ───────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  /* ─ Login ─ */
  const loginBtn = document.getElementById('l-submit');
  const loginErr = document.getElementById('login-error');

  async function doLogin() {
    loginBtn.disabled = true;
    loginErr.classList.add('hidden');
    try {
      const user = await api('POST', '/api/auth/login', {
        username: document.getElementById('l-user').value,
        password: document.getElementById('l-pass').value,
      });
      setUser(user);
    } catch (e) {
      loginErr.textContent = e.message;
      loginErr.classList.remove('hidden');
    } finally {
      loginBtn.disabled = false;
    }
  }
  loginBtn.addEventListener('click', doLogin);
  document.getElementById('l-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('l-user').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('l-pass').focus(); });

  /* ─ Logout ─ */
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('POST', '/api/auth/logout').catch(() => {});
    S.user = null;
    S.recipes = [];
    S.activeIngs.clear();
    S.activeTools.clear();
    showLogin();
  });

  /* ─ Sidebar toggle ─ */
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sb-overlay');
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
      S.sidebarMobileOpen = !S.sidebarMobileOpen;
      sidebar.classList.toggle('mobile-open', S.sidebarMobileOpen);
      overlay.classList.toggle('hidden', !S.sidebarMobileOpen);
    } else {
      S.sidebarCollapsed = !S.sidebarCollapsed;
      sidebar.classList.toggle('collapsed', S.sidebarCollapsed);
    }
  });

  document.getElementById('sb-overlay').addEventListener('click', () => {
    S.sidebarMobileOpen = false;
    document.getElementById('sidebar').classList.remove('mobile-open');
    document.getElementById('sb-overlay').classList.add('hidden');
  });

  /* ─ Sidebar filter clicks (event delegation) ─ */
  document.getElementById('ing-list').addEventListener('click', e => {
    const chip = e.target.closest('.fchip');
    if (chip) toggleIng(chip.dataset.name);
  });
  document.getElementById('tool-list').addEventListener('click', e => {
    const chip = e.target.closest('.fchip');
    if (chip) toggleTool(chip.dataset.name);
  });
  document.getElementById('cat-list').addEventListener('click', e => {
    const chip = e.target.closest('.fchip');
    if (chip) toggleCategory(chip.dataset.name);
  });
  document.getElementById('subtype-list').addEventListener('click', e => {
    const chip = e.target.closest('.fchip');
    if (chip) toggleSubtype(chip.dataset.name);
  });
  document.getElementById('tag-list').addEventListener('click', e => {
    const chip = e.target.closest('.fchip');
    if (chip) toggleTag(chip.dataset.name);
  });
  document.getElementById('clear-btn').addEventListener('click', clearAllFilters);

  /* ─ Filter mode toggles ─ */
  document.addEventListener('click', e => {
    const btn = e.target.closest('.mode-btn');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const toggle = btn.closest('.filter-mode-toggle');
      const group = toggle.dataset.group;
      const mode = btn.dataset.mode;
      S[`filterMode${group.charAt(0).toUpperCase() + group.slice(1)}`] = mode;
      updateFilterModeButtons();
      applyFilters();
    }
  });

  /* ─ Active pills removal ─ */
  document.getElementById('active-pills').addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.target.closest('button[data-name]');
    if (!btn) return;
    if (btn.dataset.type === 'ing') toggleIng(btn.dataset.name);
    else if (btn.dataset.type === 'tool') toggleTool(btn.dataset.name);
    else if (btn.dataset.type === 'category') toggleCategory(btn.dataset.name);
    else if (btn.dataset.type === 'subtype') toggleSubtype(btn.dataset.name);
    else if (btn.dataset.type === 'tag') toggleTag(btn.dataset.name);
  });

  /* ─ Empty state clear ─ */
  document.getElementById('empty-clear').addEventListener('click', clearAllFilters);

  /* ─ Search ─ */
  let searchTimer;
  document.getElementById('search-input').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { S.search = e.target.value; applyFilters(); }, 180);
  });

  document.getElementById('sort-by').addEventListener('change', () => applyFilters());

  /* ─ Recipe grid clicks ─ */
  document.getElementById('grid').addEventListener('click', e => {
    const card = e.target.closest('.recipe-card');
    if (card) openRecipe(parseInt(card.dataset.id, 10));
  });

  /* ─ New recipe ─ */
  document.getElementById('new-btn').addEventListener('click', openAddForm);
  document.getElementById('new-btn-mobile').addEventListener('click', () => {
    closeMobileMenu();
    openAddForm();
  });

  /* ─ Mobile menu ─ */
  function closeMobileMenu() {
    const dropdown = document.getElementById('hdr-menu-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
  }
  
  const menuToggle = document.getElementById('hdr-menu-toggle');
  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      const dropdown = document.getElementById('hdr-menu-dropdown');
      dropdown.classList.toggle('hidden');
    });
  }

  document.getElementById('fields-btn-mobile').addEventListener('click', () => {
    closeMobileMenu();
    openFieldsModal();
  });
  document.getElementById('bulk-import-btn-mobile').addEventListener('click', () => {
    closeMobileMenu();
    openBulkImportModal();
  });
  document.getElementById('logout-btn-mobile').addEventListener('click', async () => {
    closeMobileMenu();
    await api('POST', '/api/auth/logout').catch(() => {});
    S.user = null;
    S.recipes = [];
    S.activeIngs.clear();
    S.activeTools.clear();
    S.activeCategories.clear();
    S.activeSubtypes.clear();
    S.activeTags.clear();
    showLogin();
  });

  // Close mobile menu when clicking outside
  document.addEventListener('click', e => {
    const menuWrapper = document.querySelector('.hdr-menu-wrapper');
    if (menuWrapper && !menuWrapper.contains(e.target)) {
      closeMobileMenu();
    }
  });

  /* ─ Detail panel ─ */
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('detail-overlay')) closeDetail();
  });
  document.getElementById('edit-btn').addEventListener('click', openEditForm);
  document.getElementById('delete-btn').addEventListener('click', deleteCurrentRecipe);

  /* ─ Servings (detail body — event delegation) ─ */
  document.getElementById('detail-body').addEventListener('click', e => {
    const btn = e.target.closest('.srv-btn');
    if (!btn) return;
    const dir = parseInt(btn.dataset.dir, 10);
    const newScale = S.scale + dir;
    if (newScale < 1) return;
    S.scale = newScale;
    updateDetailScale();
  });

  /* ─ Form ─ */
  document.getElementById('form-close').addEventListener('click', closeForm);
  document.getElementById('form-cancel').addEventListener('click', closeForm);
  document.getElementById('form-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('form-overlay')) closeForm();
  });
  document.getElementById('form-save').addEventListener('click', saveRecipe);
  document.getElementById('add-ing').addEventListener('click', () => addIngRow());
  document.getElementById('add-garnish').addEventListener('click', () => addGarnishRow());
  document.getElementById('add-tool').addEventListener('click', () => addToolRow());

  /* ─ Image upload ─ */
  setupImageUpload();

  /* ─ Keyboard ─ */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('confirm-overlay').classList.contains('hidden')) {
      document.getElementById('confirm-overlay').classList.add('hidden');
    } else if (!document.getElementById('form-overlay').classList.contains('hidden')) {
      closeForm();
    } else if (!document.getElementById('detail-overlay').classList.contains('hidden')) {
      closeDetail();
    }
  });

  /* ─ Manage Fields modal ─ */
  document.getElementById('fields-btn').addEventListener('click', openFieldsModal);
  document.getElementById('fields-close').addEventListener('click', closeFieldsModal);
  document.getElementById('fields-done').addEventListener('click', closeFieldsModal);
  document.getElementById('fields-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('fields-overlay')) closeFieldsModal();
  });

  document.getElementById('add-field-btn').addEventListener('click', async () => {
    const nameEl = document.getElementById('new-field-name');
    const typeEl = document.getElementById('new-field-type');
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }
    const btn = document.getElementById('add-field-btn');
    btn.disabled = true;
    try {
      const f = await api('POST', '/api/fields', { name, field_type: typeEl.value });
      S.customFields.push(f);
      nameEl.value = '';
      typeEl.value = 'text';
      renderFieldsList();
    } catch (e) {
      alert(`Failed: ${e.message}`);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('new-field-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('add-field-btn').click();
  });

  document.getElementById('fields-list').addEventListener('click', async e => {
    const btn = e.target.closest('[data-del-field]');
    if (!btn) return;
    const fid = parseInt(btn.dataset.delField, 10);
    const f = S.customFields.find(x => x.id === fid);
    if (!f) return;
    showConfirm(
      `Delete field "${f.name}"? All saved values for this field will be removed from every recipe.`,
      async () => {
        try {
          await api('DELETE', `/api/fields/${fid}`);
          S.customFields = S.customFields.filter(x => x.id !== fid);
          // Strip from loaded recipes so detail panel reflects immediately
          S.recipes.forEach(r => { if (r.custom_fields) delete r.custom_fields[String(fid)]; });
          renderFieldsList();
        } catch (err) {
          alert(`Failed: ${err.message}`);
        }
      }
    );
  });

  /* ─ Bulk Import modal ─ */
  document.getElementById('bulk-import-btn').addEventListener('click', openBulkImportModal);
  document.getElementById('bulk-import-close').addEventListener('click', closeBulkImportModal);
  document.getElementById('bulk-import-cancel').addEventListener('click', closeBulkImportModal);
  document.getElementById('bulk-import-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('bulk-import-overlay')) closeBulkImportModal();
  });
  document.getElementById('bulk-import-submit').addEventListener('click', submitBulkImport);
  populateClassificationSelectors();

  /* ─ Boot ─ */
  init();
});
