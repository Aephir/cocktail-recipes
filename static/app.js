/* ══════════════════════════════════════════════════════════════════════════
   Walden's Cocktail Book — app.js
══════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ── State ─────────────────────────────────────────────────────────────── */
const S = {
  user: null,
  recipes: [],
  ingredients: [],
  tools: [],
  tagCatalog: [],
  tagDisplayMap: new Map(),
  formTags: [],
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
  overviewMode: 'drinks',
  detailHistory: [],
  activeAutocomplete: null,
  createdPlaceholdersLastSave: [],
  resolveDialogCancel: null,
};

const CATEGORY_OPTIONS = [
  'Cocktail', 'Highball', 'Collins', 'Rickey', 'Buck', 'Fizz',
  'Julep', 'Smash', 'Cobbler', 'Swizzle', 'Sling', 'Toddy',
  'Punch', 'Cup', 'Flip', 'Nog', 'Fix', 'Crusta',
  'Frappé', 'Shrub', 'Wassail Bowl', 'Champerelle', 'Other',
  'Ingredient',
];
const SUBTYPE_OPTIONS = ['Sour', 'Aromatic', 'Old-Fashioned', 'Improved', 'Daisy'];
const INGREDIENT_SUBTYPE_OPTIONS = ['Base', 'Modifier', 'Special Flavoring', 'Garnish', 'Other'];

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

function setSearchValue(nextValue) {
  S.search = String(nextValue || '');
  const desktop = document.getElementById('search-input');
  const mobile = document.getElementById('search-input-mobile');
  if (desktop && desktop.value !== S.search) desktop.value = S.search;
  if (mobile && mobile.value !== S.search) mobile.value = S.search;
}

function buildTagCatalog(recipes) {
  const displayMap = new Map();
  for (const recipe of recipes) {
    for (const rawTag of (recipe.tags || [])) {
      const normalized = normalizeTag(rawTag);
      if (!normalized) continue;
      if (!displayMap.has(normalized)) {
        displayMap.set(normalized, String(rawTag || '').trim() || normalized.replace(/_/g, ' '));
      }
    }
  }
  S.tagDisplayMap = displayMap;
  S.tagCatalog = [...displayMap.keys()];
}

function displayTag(tag) {
  const normalized = normalizeTag(tag);
  const source = S.tagDisplayMap.get(normalized) || normalized.replace(/_/g, ' ');
  return displayLabel(source);
}

function closeAutocomplete() {
  const menu = document.getElementById('autocomplete-menu');
  if (!menu) return;
  menu.classList.add('hidden');
  menu.innerHTML = '';
  S.activeAutocomplete = null;
}

function positionAutocompleteMenu(inputEl, menu) {
  const rect = inputEl.getBoundingClientRect();
  const width = Math.max(rect.width, 220);
  menu.style.left = `${Math.max(8, rect.left)}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.width = `${Math.min(width, window.innerWidth - 16)}px`;
}

function ensureAutocompleteMenu() {
  let menu = document.getElementById('autocomplete-menu');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'autocomplete-menu';
  menu.className = 'autocomplete-menu hidden';
  menu.setAttribute('role', 'listbox');
  document.body.appendChild(menu);

  menu.addEventListener('mousedown', e => {
    e.preventDefault();
    const option = e.target.closest('.suggestion-item[data-idx]');
    if (!option || !S.activeAutocomplete) return;
    const idx = Number(option.dataset.idx);
    const item = S.activeAutocomplete.items[idx];
    if (!item) return;
    try {
      const result = S.activeAutocomplete.onSelect(item);
      if (result && typeof result.catch === 'function') {
        result.catch(err => console.error('Autocomplete selection failed:', err));
      }
    } catch (err) {
      console.error('Autocomplete selection failed:', err);
    }
    closeAutocomplete();
  });
  return menu;
}

function openAutocomplete(inputEl, items, onSelect) {
  const menu = ensureAutocompleteMenu();
  if (!items.length) {
    closeAutocomplete();
    return;
  }
  S.activeAutocomplete = {
    inputEl,
    items,
    onSelect,
    activeIndex: 0,
  };

  menu.innerHTML = items.map((item, idx) => {
    const note = item.note
      ? `<span class="suggestion-note${item.noteType ? ` suggestion-note-${esc(item.noteType)}` : ''}">${esc(item.note)}</span>`
      : '';
    return `<button type="button" class="suggestion-item${idx === 0 ? ' active' : ''}" data-idx="${idx}" role="option">${esc(item.label)}${note}</button>`;
  }).join('');

  positionAutocompleteMenu(inputEl, menu);
  menu.classList.remove('hidden');
}

function setAutocompleteActiveIndex(nextIndex) {
  if (!S.activeAutocomplete) return;
  const { items } = S.activeAutocomplete;
  const clamped = Math.max(0, Math.min(items.length - 1, nextIndex));
  S.activeAutocomplete.activeIndex = clamped;
  const menu = document.getElementById('autocomplete-menu');
  if (!menu) return;
  menu.querySelectorAll('.suggestion-item').forEach((el, idx) => {
    el.classList.toggle('active', idx === clamped);
  });
}

function attachAutocomplete(inputEl, options) {
  if (!inputEl || inputEl.dataset.autocompleteBound === '1') return;
  inputEl.dataset.autocompleteBound = '1';

  const refresh = () => {
    if (document.activeElement !== inputEl) return;
    const query = inputEl.value.trim();
    const items = options.getItems(query, inputEl);
    if (!items.length) {
      closeAutocomplete();
      return;
    }
    openAutocomplete(inputEl, items, item => options.onSelect(item, inputEl));
  };

  inputEl.addEventListener('focus', refresh);
  inputEl.addEventListener('input', refresh);
  inputEl.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement !== inputEl) closeAutocomplete();
    }, 120);
  });

  inputEl.addEventListener('keydown', e => {
    if (!S.activeAutocomplete || S.activeAutocomplete.inputEl !== inputEl) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAutocompleteActiveIndex(S.activeAutocomplete.activeIndex + 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAutocompleteActiveIndex(S.activeAutocomplete.activeIndex - 1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = S.activeAutocomplete.items[S.activeAutocomplete.activeIndex];
      if (!item) return;
      try {
        const result = options.onSelect(item, inputEl);
        if (result && typeof result.catch === 'function') {
          result.catch(err => console.error('Autocomplete selection failed:', err));
        }
      } catch (err) {
        console.error('Autocomplete selection failed:', err);
      }
      closeAutocomplete();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeAutocomplete();
    }
  });
}

function isBuiltInIconUrl(url) {
  return typeof url === 'string' && url.startsWith('/static/glass-icons/');
}

function renderRecipeImage(url, label, variant = 'card') {
  if (!url) return '';
  if (isBuiltInIconUrl(url)) {
    const variantClass = variant === 'detail' ? 'detail-image' : 'card-image';
    return `<div class="${variantClass} icon-placeholder" style="--icon-url: url('${esc(url)}');" aria-label="${esc(label)}" role="img"></div>`;
  }
  const variantClass = variant === 'detail' ? 'detail-image' : 'card-image';
  const loading = variant === 'detail' ? '' : ' loading="lazy"';
  return `<img class="${variantClass}" src="${esc(url)}" alt="${esc(label)}"${loading}>`;
}

function updateSubtypeState() {
  const category = document.getElementById('f-category')?.value;
  const subtype = document.getElementById('f-subtype');
  const scoreField = document.getElementById('f-score')?.closest('.field');
  if (!subtype) return;
  if (category === 'Cocktail' || category === 'Other') {
    subtype.innerHTML = [''].concat(SUBTYPE_OPTIONS).map(sub => `<option value="${esc(sub)}">${esc(sub)}</option>`).join('');
    subtype.disabled = false;
    if (scoreField) scoreField.style.display = '';
  } else if (category === 'Ingredient') {
    subtype.innerHTML = [''].concat(INGREDIENT_SUBTYPE_OPTIONS).map(sub => `<option value="${esc(sub)}">${esc(sub)}</option>`).join('');
    subtype.disabled = false;
    if (scoreField) scoreField.style.display = 'none';
  } else {
    subtype.innerHTML = '<option value=""></option>';
    subtype.disabled = true;
    subtype.value = '';
    if (scoreField) scoreField.style.display = '';
  }
}

function populateClassificationSelectors() {
  const categorySelect = document.getElementById('f-category');
  if (categorySelect) {
    categorySelect.innerHTML = CATEGORY_OPTIONS.map(cat => `<option value="${esc(cat)}">${esc(cat)}</option>`).join('');
  }
  updateSubtypeState();
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

function displayLabel(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  return s.replace(/^([a-z])/, (_, c) => c.toUpperCase());
}

/* ── Auth ───────────────────────────────────────────────────────────────── */
async function init() {
  try {
    const user = await api('GET', '/api/auth/me');
    await setUser(user);
  } catch {
    showLogin();
  }
}

function setViewport(content) {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.setAttribute('content', content);
}

function applyViewportForScreen(isLoginScreen) {
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isIOS) {
    setViewport('width=device-width, initial-scale=1.0');
    return;
  }

  // All iOS browsers use WebKit; lock scale to avoid sticky focus zoom state.
  const base = 'width=device-width, initial-scale=1.0, maximum-scale=1.0';
  setViewport(base);
  if (!isLoginScreen) {
    window.scrollTo(0, 0);
  }
}

async function setUser(user) {
  S.user = user;
  document.getElementById('user-pill').textContent = user.username;
  const isAdmin = user.role === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin));
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  showApp();
  await loadData();
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('l-pass').value = '';
  applyViewportForScreen(true);
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  applyViewportForScreen(false);
}

/* ── Data ───────────────────────────────────────────────────────────────── */
async function loadData() {
  const [recipes, fields] = await Promise.all([
    api('GET', '/api/recipes'),
    api('GET', '/api/fields'),
  ]);
  S.recipes = recipes;
  S.customFields = fields;
  buildTagCatalog(recipes);
  buildSidebar();
  updateFilterModeButtons();
  applyFilters();
}

function recipesForOverviewMode() {
  if (S.overviewMode === 'ingredients') {
    return S.recipes.filter(r => r.category === 'Ingredient');
  }
  return S.recipes.filter(r => r.category !== 'Ingredient');
}

function ingredientDisplayName(ingredient) {
  return String(ingredient?.ingredient_name || ingredient?.subrecipe_name || '').trim();
}

function collectSidebarCounts(recipes) {
  const ingCounts = new Map();
  const toolCounts = new Map();
  const categoryCounts = new Map();
  const subtypeCounts = new Map();
  const tagCounts = new Map();

  for (const r of recipes) {
    r.ingredients.forEach(i => {
      const ingName = ingredientDisplayName(i);
      if (!ingName) return;
      ingCounts.set(ingName, (ingCounts.get(ingName) || 0) + 1);
    });
    r.tools.forEach(t => {
      const toolName = (t.tool_name || '').trim();
      if (!toolName) return;
      toolCounts.set(toolName, (toolCounts.get(toolName) || 0) + 1);
    });
    const category = r.category || 'Other';
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    if (r.subtype) subtypeCounts.set(r.subtype, (subtypeCounts.get(r.subtype) || 0) + 1);
    (r.tags || []).forEach(tag => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
  }

  return { ingCounts, toolCounts, categoryCounts, subtypeCounts, tagCounts };
}

/* ── Filtering (client-side) ────────────────────────────────────────────── */
function applyFilters() {
  const q = S.search.toLowerCase().trim();
  let list = recipesForOverviewMode();

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
      const names = new Set(r.ingredients.map(ingredientDisplayName).filter(Boolean));
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

function setOverviewMode(mode) {
  S.overviewMode = mode === 'ingredients' ? 'ingredients' : 'drinks';
  const drinksBtn = document.getElementById('overview-drinks');
  const ingredientsBtn = document.getElementById('overview-ingredients');
  drinksBtn?.classList.toggle('active', S.overviewMode === 'drinks');
  ingredientsBtn?.classList.toggle('active', S.overviewMode === 'ingredients');
  drinksBtn?.setAttribute('aria-selected', S.overviewMode === 'drinks' ? 'true' : 'false');
  ingredientsBtn?.setAttribute('aria-selected', S.overviewMode === 'ingredients' ? 'true' : 'false');
  buildSidebar();
  applyFilters();
}

function clearAllFilters() {
  S.activeIngs.clear();
  S.activeTools.clear();
  S.activeCategories.clear();
  S.activeSubtypes.clear();
  S.activeTags.clear();
  S.filterModeIngs = 'all';
  S.filterModeTools = 'all';
  S.filterModeCategories = 'all';
  S.filterModeSubtypes = 'all';
  S.filterModeTags = 'all';
  setSearchValue('');

  refreshChipStates();
  updateFilterModeButtons();
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
  const recipesForSidebar = recipesForOverviewMode();
  const { ingCounts, toolCounts, categoryCounts, subtypeCounts, tagCounts } = collectSidebarCounts(recipesForSidebar);

  const compareEntryNames = (a, b) => String(a?.[0] || '').localeCompare(String(b?.[0] || ''));
  const sortedIngs = [...ingCounts.entries()].sort(compareEntryNames);
  const sortedTools = [...toolCounts.entries()].sort(compareEntryNames);
  const sortedCategories = [...categoryCounts.entries()].sort(compareEntryNames);
  const sortedSubtypes = [...subtypeCounts.entries()].sort(compareEntryNames);
  const sortedTags = [...tagCounts.entries()].sort(compareEntryNames);

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
    btn.innerHTML = `<span>${esc(displayLabel(name))}</span><span class="chip-ct">${count}</span>`;
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
  const { ingCounts, toolCounts, categoryCounts, subtypeCounts, tagCounts } = collectSidebarCounts(filtered);
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
      🧭 ${esc(displayLabel(name))}
      <button data-type="category" data-name="${name}" title="Remove filter">×</button>
    </span>`);
  }
  for (const name of S.activeSubtypes) {
    pills.push(`<span class="apill" data-type="subtype" data-name="${name}">
      ✦ ${esc(displayLabel(name))}
      <button data-type="subtype" data-name="${name}" title="Remove filter">×</button>
    </span>`);
  }
  for (const name of S.activeTags) {
    pills.push(`<span class="apill" data-type="tag" data-name="${name}">
      #${esc(displayLabel(name))}
      <button data-type="tag" data-name="${name}" title="Remove filter">×</button>
    </span>`);
  }
  for (const name of S.activeIngs) {
    pills.push(`<span class="apill" data-type="ing" data-name="${name}">
      ${esc(displayLabel(name))}
      <button data-type="ing" data-name="${name}" title="Remove filter">×</button>
    </span>`);
  }
  for (const name of S.activeTools) {
    pills.push(`<span class="apill" data-type="tool" data-name="${name}">
      ⚙ ${esc(displayLabel(name))}
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
    const cardImageUrl = r.image_thumb_url || r.image_url;
    const thumbHtml = cardImageUrl
      ? renderRecipeImage(cardImageUrl, displayLabel(r.name), 'card')
      : `<div class="card-thumb-placeholder">◈</div>`;

    const ingredientLabels = r.ingredients.map(ingredientDisplayName).filter(Boolean);
    const tags = ingredientLabels.slice(0, 3)
      .map(name => `<span class="ctag${S.activeIngs.has(name) ? ' active' : ''}">${esc(displayLabel(name))}</span>`)
      .join('');
    const more = ingredientLabels.length > 3
      ? `<span class="ctag">+${ingredientLabels.length - 3}</span>` : '';

    const scoreLabel = r.category !== 'Ingredient'
      ? (r.score != null
          ? `<div class="card-score">${esc(r.score)}/10</div>`
          : '<div class="card-score unrated">Unrated</div>')
      : '';
    const classification = r.category ? esc(displayLabel(r.category)) + (r.subtype ? ` · ${esc(displayLabel(r.subtype))}` : '') : '';

    return `
      <div class="recipe-card" data-id="${r.id}">
        <div class="card-thumb">${thumbHtml}</div>
        <div class="card-body">
          <div class="card-head">
            <div class="card-name">${esc(displayLabel(r.name))}</div>
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
function updateDetailBackButton() {
  const backBtn = document.getElementById('detail-back');
  if (!backBtn) return;
  backBtn.classList.toggle('hidden', S.detailHistory.length === 0);
}

function openRecipe(id, options = {}) {
  const { pushHistory = false, resetHistory = false } = options;
  const recipe = S.recipes.find(r => r.id === id);
  if (!recipe) return;
  if (resetHistory) {
    S.detailHistory = [];
  }
  if (pushHistory && S.currentId && S.currentId !== id) {
    S.detailHistory.push(S.currentId);
  }
  S.currentId = id;
  S.scale = 1;
  renderDetail(recipe);
  updateDetailBackButton();
  document.getElementById('detail-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  document.getElementById('detail-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  S.currentId = null;
  S.detailHistory = [];
  updateDetailBackButton();
}

function openPreviousRecipe() {
  const previousId = S.detailHistory.pop();
  if (!previousId) {
    updateDetailBackButton();
    return;
  }
  openRecipe(previousId);
}

function renderDetail(recipe) {
  const imgHtml = recipe.image_url
    ? renderRecipeImage(recipe.image_url, displayLabel(recipe.name), 'detail')
    : '';

  const ingRows = recipe.ingredients.map((i, idx) => {
    const dispName = i.subrecipe_name || i.ingredient_name;
    const nameHtml = i.subrecipe_id
      ? `<a href="#" class="recipe-link" data-rid="${i.subrecipe_id}">${esc(displayLabel(dispName))}</a>`
      : esc(displayLabel(dispName));
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
    ? recipe.tools.map(t => `<span class="tool-chip">${esc(displayLabel(t.tool_name))}</span>`).join('')
    : '<span style="color:var(--text-muted)">—</span>';

  const garnishHtml = recipe.garnishes?.length
    ? `<div class="dsec">
        <div class="dsec-title">Garnish</div>
        <ul class="garnish-list">${recipe.garnishes.map(g => `<li>${esc(displayLabel(g.garnish_text || g.ingredient_name || ''))}</li>`).join('')}</ul>
      </div>`
    : '';

  const vol = totalMl(recipe, S.scale);

  document.getElementById('detail-body').innerHTML = `
    ${imgHtml}
    <div class="detail-inner">
      <h1 class="detail-name">${esc(displayLabel(recipe.name))}</h1>
      ${recipe.category !== 'Ingredient'
        ? (recipe.score != null
            ? `<div class="detail-score">Rating ${esc(recipe.score)}/10</div>`
            : '<div class="detail-score unrated">Unrated</div>')
        : ''}

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
      if (rid) openRecipe(rid, { pushHistory: true });
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
function findIngredientByName(name) {
  const needle = String(name || '').trim().toLowerCase();
  if (!needle) return null;
  return S.ingredients.find(i => i.name.toLowerCase() === needle) || null;
}

function findRecipeByName(name) {
  const needle = String(name || '').trim().toLowerCase();
  if (!needle) return null;
  return S.recipes.find(r => r.name.toLowerCase() === needle) || null;
}

function rankSuggestions(items, query, getLabel, limit = 8) {
  const q = query.toLowerCase();
  const starts = [];
  const contains = [];
  for (const item of items) {
    const label = getLabel(item).toLowerCase();
    if (!q || label.startsWith(q)) starts.push(item);
    else if (label.includes(q)) contains.push(item);
  }
  return starts.concat(contains).slice(0, limit);
}

function levenshteinDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const rows = left.length + 1;
  const cols = right.length + 1;
  const dp = Array.from({ length: rows }, (_, i) => {
    const row = new Array(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[rows - 1][cols - 1];
}

function rankDidYouMean(items, query, getLabel, limit = 3) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];

  const scored = items.map(item => {
    const label = String(getLabel(item) || '').trim();
    const ll = label.toLowerCase();
    let score;
    if (ll === q) {
      score = 0;
    } else if (ll.startsWith(q)) {
      score = 0.4 + Math.abs(ll.length - q.length) / 100;
    } else if (ll.includes(q)) {
      score = 0.9 + ll.indexOf(q) / 50 + Math.abs(ll.length - q.length) / 100;
    } else {
      const dist = levenshteinDistance(q, ll);
      score = 1.5 + dist / Math.max(ll.length, q.length, 1);
    }
    return { item, label, score };
  });

  scored.sort((a, b) => (a.score - b.score) || a.label.localeCompare(b.label));
  return scored.slice(0, limit).map(s => s.item);
}

function getIngredientSuggestions(query) {
  return rankSuggestions(S.ingredients, query, i => i.name).map(i => ({
    label: i.name,
    value: i.id,
  }));
}

function getRecipeSuggestions(query) {
  return rankSuggestions(S.recipes, query, r => r.name).map(r => ({
    label: r.name,
    value: r.id,
  }));
}

function getTagSuggestions(query) {
  const selected = new Set(S.formTags.map(normalizeTag));
  const normalizedQuery = normalizeTag(query);
  const tagItems = S.tagCatalog
    .filter(tag => !selected.has(tag))
    .map(tag => ({
      normalized: tag,
      label: displayTag(tag),
    }));
  const matches = rankSuggestions(tagItems, query, t => t.label).map(t => ({
    label: t.label,
    value: t.normalized,
    note: 'Existing',
    noteType: 'existing',
  }));

  const hasExact = !!normalizedQuery && tagItems.some(t => t.normalized === normalizedQuery);
  if (normalizedQuery && !selected.has(normalizedQuery) && !hasExact) {
    matches.unshift({
      label: `Create "${String(query || '').trim()}"`,
      value: normalizedQuery,
      raw: String(query || '').trim(),
      create: true,
      note: 'New',
      noteType: 'new',
    });
  }

  return matches.slice(0, 8);
}

function getTagDidYouMeanSuggestions(query) {
  const selected = new Set(S.formTags.map(normalizeTag));
  const tagItems = S.tagCatalog
    .filter(tag => !selected.has(tag))
    .map(tag => ({
      normalized: tag,
      label: displayTag(tag),
      value: tag,
    }));

  return rankDidYouMean(tagItems, query, t => t.label, 3).map(t => ({
    label: t.label,
    value: t.value,
  }));
}

function getRecipeDidYouMeanSuggestions(query) {
  return rankDidYouMean(S.recipes, query, r => r.name, 3).map(r => ({
    label: r.name,
    value: r.id,
  }));
}

function renderFormTags() {
  const chips = document.getElementById('f-tags-chips');
  if (!chips) return;
  chips.innerHTML = S.formTags.map(tag => `
    <span class="tag-chip" data-tag="${esc(tag)}">
      <span>${esc(displayTag(tag))}</span>
      <button type="button" data-remove-tag="${esc(tag)}" aria-label="Remove tag">×</button>
    </span>
  `).join('');
}

function addFormTag(tag, addToCatalog = false) {
  const normalized = normalizeTag(tag);
  if (!normalized) return;
  if (S.formTags.includes(normalized)) return;
  S.formTags.push(normalized);
  if (addToCatalog && !S.tagDisplayMap.has(normalized)) {
    S.tagDisplayMap.set(normalized, String(tag || '').trim());
    S.tagCatalog = [...new Set([...S.tagCatalog, normalized])];
  }
  renderFormTags();
}

function removeFormTag(tag) {
  const normalized = normalizeTag(tag);
  S.formTags = S.formTags.filter(t => t !== normalized);
  renderFormTags();
}

function showResolveDialog({ message, suggestions, createLabel = 'Create' }) {
  return new Promise(resolve => {
    const overlay = document.getElementById('resolve-overlay');
    const msg = document.getElementById('resolve-msg');
    const list = document.getElementById('resolve-suggestions');
    const createBtn = document.getElementById('resolve-create');
    const cancelBtn = document.getElementById('resolve-cancel');
    if (!overlay || !msg || !list || !createBtn || !cancelBtn) {
      resolve({ action: 'cancel' });
      return;
    }

    msg.textContent = message;
    createBtn.textContent = createLabel;
    list.innerHTML = (suggestions || []).slice(0, 3).map((item, idx) => (
      `<button type="button" class="resolve-suggestion-btn" data-resolve-idx="${idx}">Did you mean ${esc(item.label)}?</button>`
    )).join('');

    let done = false;
    const cleanup = (result) => {
      if (done) return;
      done = true;
      overlay.classList.add('hidden');
      overlay.removeEventListener('click', onOverlayClick);
      list.removeEventListener('click', onListClick);
      createBtn.removeEventListener('click', onCreate);
      cancelBtn.removeEventListener('click', onCancel);
      S.resolveDialogCancel = null;
      resolve(result);
    };

    const onOverlayClick = (e) => {
      if (e.target === overlay) cleanup({ action: 'cancel' });
    };
    const onListClick = (e) => {
      const btn = e.target.closest('button[data-resolve-idx]');
      if (!btn) return;
      const picked = suggestions[Number(btn.dataset.resolveIdx)];
      if (!picked) return;
      cleanup({ action: 'use', suggestion: picked });
    };
    const onCreate = () => cleanup({ action: 'create' });
    const onCancel = () => cleanup({ action: 'cancel' });

    overlay.addEventListener('click', onOverlayClick);
    list.addEventListener('click', onListClick);
    createBtn.addEventListener('click', onCreate);
    cancelBtn.addEventListener('click', onCancel);
    S.resolveDialogCancel = () => cleanup({ action: 'cancel' });
    overlay.classList.remove('hidden');
  });
}

async function resolveUnknownTag(rawTag) {
  const raw = String(rawTag || '').trim();
  if (!raw) return false;

  const normalized = normalizeTag(raw);
  if (S.tagCatalog.includes(normalized)) {
    addFormTag(normalized);
    return true;
  }

  const didYouMean = getTagDidYouMeanSuggestions(raw);
  const decision = await showResolveDialog({
    message: `Tag "${raw}" does not exist yet.`,
    suggestions: didYouMean,
    createLabel: `Create "${raw}"`,
  });

  if (decision.action === 'use' && decision.suggestion) {
    addFormTag(decision.suggestion.value);
    return true;
  }
  if (decision.action === 'create') {
    addFormTag(raw, true);
    return true;
  }
  return false;
}

async function ensurePendingTagCommitted() {
  const input = document.getElementById('f-tags-input');
  if (!input) return true;
  const raw = input.value.trim();
  if (!raw) return true;

  const committed = await resolveUnknownTag(raw);
  if (!committed) return false;
  input.value = '';
  closeAutocomplete();
  return true;
}

function bindTagComposerEvents() {
  const tagsInput = document.getElementById('f-tags-input');
  const chips = document.getElementById('f-tags-chips');
  if (!tagsInput || tagsInput.dataset.bound === '1') return;
  tagsInput.dataset.bound = '1';

  attachAutocomplete(tagsInput, {
    getItems: query => getTagSuggestions(query),
    onSelect: async item => {
      if (item.create) {
        const committed = await resolveUnknownTag(item.raw);
        if (!committed) return;
      } else {
        addFormTag(item.value);
      }
      tagsInput.value = '';
      closeAutocomplete();
    },
  });

  tagsInput.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    if (S.activeAutocomplete && S.activeAutocomplete.inputEl === tagsInput) return;
    e.preventDefault();
    await ensurePendingTagCommitted();
  });

  chips.addEventListener('click', e => {
    const btn = e.target.closest('button[data-remove-tag]');
    if (!btn) return;
    removeFormTag(btn.dataset.removeTag);
  });
}

async function openAddForm() {
  S.editingId = null;
  S.pendingImage = null;
  S.createdPlaceholdersLastSave = [];
  resetForm();
  document.getElementById('form-title').textContent = 'New Recipe';
  await populateAutocomplete();
  renderFormCustomFields(S.editingId ? S.recipes.find(r => r.id === S.editingId) : null);
  bindTagComposerEvents();
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
  S.formTags = (recipe.tags || []).map(normalizeTag).filter(Boolean);
  renderFormTags();
  updateSubtypeState();
  document.getElementById('f-subtype').value = recipe.subtype || '';

  if (recipe.image_url) {
    document.getElementById('img-preview').src = recipe.image_url;
    document.getElementById('img-preview').classList.remove('hidden');
    document.getElementById('drop-placeholder').classList.add('hidden');
    document.getElementById('remove-img').classList.remove('hidden');
  }

  recipe.ingredients.forEach(i => addIngRow(i.amount ?? '', i.unit, i.ingredient_name, i.subrecipe_name || '', i.subrecipe_id ?? '', i.ingredient_id ?? ''));
  recipe.garnishes?.forEach(g => addGarnishRow(g.garnish_text || g.ingredient_name || '', g.ingredient_id ?? ''));
  recipe.tools.forEach(t => addToolRow(t.tool_name, t.tool_id ?? ''));
  document.getElementById('f-score').value = recipe.score != null ? String(recipe.score) : '';

  await populateAutocomplete();
  renderFormCustomFields(recipe);
  bindTagComposerEvents();
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
  document.getElementById('f-score').value = '';
  document.getElementById('f-category').value = 'Other';
  document.getElementById('f-subtype').value = '';
  S.formTags = [];
  renderFormTags();
  const tagsInput = document.getElementById('f-tags-input');
  if (tagsInput) tagsInput.value = '';
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

async function createPlaceholderRecipe(name) {
  return api('POST', '/api/recipes', {
    name: String(name || '').trim(),
    score: null,
    category: 'Other',
    subtype: null,
    tags: ['placeholder'],
    procedure: '',
    notes: 'Placeholder recipe created while linking an ingredient sub-recipe.',
    ingredients: [],
    tools: [],
    garnishes: [],
    custom_fields: {},
    image_filename: null,
  });
}

async function ensureSubrecipesResolved() {
  const pending = new Map();

  document.querySelectorAll('.ing-row').forEach(row => {
    const recipeInput = row.querySelector('.f-ing-recipe');
    const subrecipeIdInput = row.querySelector('.f-ing-subrecipe-id');
    const value = recipeInput.value.trim();
    if (!value) return;

    const existing = findRecipeByName(value);
    if (existing) {
      recipeInput.value = existing.name;
      subrecipeIdInput.value = String(existing.id);
      return;
    }

    subrecipeIdInput.value = '';
    const key = value.toLowerCase();
    if (!pending.has(key)) pending.set(key, { name: value, rows: [] });
    pending.get(key).rows.push(row);
  });

  const created = [];
  for (const pendingRecipe of pending.values()) {
    const suggestions = getRecipeDidYouMeanSuggestions(pendingRecipe.name);
    const decision = await showResolveDialog({
      message: `Recipe "${pendingRecipe.name}" does not exist yet.`,
      suggestions,
      createLabel: `Create placeholder "${pendingRecipe.name}"`,
    });

    if (decision.action === 'cancel') {
      const firstInput = pendingRecipe.rows[0]?.querySelector('.f-ing-recipe');
      firstInput?.focus();
      return { ok: false, created: [] };
    }

    if (decision.action === 'use' && decision.suggestion) {
      pendingRecipe.rows.forEach(row => {
        row.querySelector('.f-ing-recipe').value = decision.suggestion.label;
        row.querySelector('.f-ing-subrecipe-id').value = String(decision.suggestion.value);
      });
      continue;
    }

    const createdRecipe = await createPlaceholderRecipe(pendingRecipe.name);
    created.push({ id: createdRecipe.id, name: createdRecipe.name });
    S.recipes.push(createdRecipe);
    pendingRecipe.rows.forEach(row => {
      row.querySelector('.f-ing-recipe').value = createdRecipe.name;
      row.querySelector('.f-ing-subrecipe-id').value = String(createdRecipe.id);
    });
  }

  return { ok: true, created };
}

function hidePlaceholderReminder() {
  document.getElementById('placeholder-overlay')?.classList.add('hidden');
}

function showPlaceholderReminder(placeholders) {
  if (!placeholders.length) return;
  const overlay = document.getElementById('placeholder-overlay');
  const msg = document.getElementById('placeholder-msg');
  const links = document.getElementById('placeholder-links');
  if (!overlay || !msg || !links) return;

  msg.textContent = placeholders.length === 1
    ? 'A placeholder recipe was created. Open it now to finish setup:'
    : 'Placeholder recipes were created. Open any of these now to finish setup:';

  links.innerHTML = placeholders
    .map(item => `<button type="button" class="placeholder-link-btn" data-placeholder-id="${item.id}">Edit ${esc(displayLabel(item.name))}</button>`)
    .join('');

  links.querySelectorAll('button[data-placeholder-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const recipeId = Number(btn.dataset.placeholderId);
      hidePlaceholderReminder();
      await loadData();
      openRecipe(recipeId, { resetHistory: true });
      await openEditForm();
    });
  });

  overlay.classList.remove('hidden');
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
  row.draggable = true;
  row.innerHTML = `
    <div class="drag-group">
      <button class="drag-handle" type="button" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</button>
      <button class="row-up-btn" type="button" title="Move up" aria-label="Move up">↑</button>
      <button class="row-down-btn" type="button" title="Move down" aria-label="Move down">↓</button>
    </div>
    <input type="number" class="f-ing-amt" value="${esc(String(amount))}" placeholder="Amt" step="any" min="0">
    <input type="text"   class="f-ing-unit" value="${esc(unit)}" placeholder="Unit" list="unit-opts">
    <input type="text"   class="f-ing-name" value="${esc(name)}" placeholder="Name" list="ing-opts">
    <input type="hidden" class="f-ing-ingredient-id" value="${esc(String(ingredientId))}">
    <input type="text"   class="f-ing-recipe" value="${esc(subrecipeName)}" placeholder="Recipe" list="recipe-opts">
    <input type="hidden" class="f-ing-subrecipe-id" value="${esc(String(subrecipeId))}">
    <button class="rm-btn" type="button" title="Remove">×</button>`;
  row.querySelector('.rm-btn').addEventListener('click', () => row.remove());
  row.querySelector('.row-up-btn').addEventListener('click', e => {
    e.preventDefault();
    const prev = row.previousElementSibling;
    if (prev && prev.classList.contains('ing-row')) {
      row.parentNode.insertBefore(row, prev);
    }
  });
  row.querySelector('.row-down-btn').addEventListener('click', e => {
    e.preventDefault();
    const next = row.nextElementSibling;
    if (next && next.classList.contains('ing-row')) {
      row.parentNode.insertBefore(next, row);
    }
  });
  const recipeInput = row.querySelector('.f-ing-recipe');
  const subrecipeIdInput = row.querySelector('.f-ing-subrecipe-id');
  const nameInput = row.querySelector('.f-ing-name');
  const ingredientIdInput = row.querySelector('.f-ing-ingredient-id');

  recipeInput.addEventListener('input', () => {
    const match = findRecipeByName(recipeInput.value);
    subrecipeIdInput.value = match ? String(match.id) : '';
  });

  nameInput.addEventListener('input', () => {
    const match = findIngredientByName(nameInput.value);
    ingredientIdInput.value = match ? String(match.id) : '';
  });

  attachAutocomplete(nameInput, {
    getItems: query => getIngredientSuggestions(query),
    onSelect: item => {
      nameInput.value = item.label;
      ingredientIdInput.value = String(item.value);
    },
  });

  attachAutocomplete(recipeInput, {
    getItems: query => getRecipeSuggestions(query),
    onSelect: item => {
      recipeInput.value = item.label;
      subrecipeIdInput.value = String(item.value);
    },
  });

  row.addEventListener('dragstart', e => {
    if (!e.target.closest('.drag-handle')) {
      e.preventDefault();
      return;
    }
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dataset.dragId || 'ingredient-row');
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    document.querySelectorAll('.ing-row.drag-over-top, .ing-row.drag-over-bottom')
      .forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
  });

  document.getElementById('f-ings').appendChild(row);
}

function setupIngredientReorder() {
  const list = document.getElementById('f-ings');
  if (!list || list.dataset.reorderBound === '1') return;
  list.dataset.reorderBound = '1';

  list.addEventListener('dragover', e => {
    const dragging = list.querySelector('.ing-row.dragging');
    if (!dragging) return;
    e.preventDefault();

    const target = e.target.closest('.ing-row');
    document.querySelectorAll('.ing-row.drag-over-top, .ing-row.drag-over-bottom')
      .forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));

    if (!target || target === dragging) return;

    const rect = target.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    target.classList.add(before ? 'drag-over-top' : 'drag-over-bottom');
    if (before) {
      list.insertBefore(dragging, target);
    } else {
      list.insertBefore(dragging, target.nextSibling);
    }
  });

  list.addEventListener('drop', e => {
    if (list.querySelector('.ing-row.dragging')) {
      e.preventDefault();
    }
    document.querySelectorAll('.ing-row.drag-over-top, .ing-row.drag-over-bottom')
      .forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
  });
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
    <div class="drag-group">
      <button class="row-up-btn" type="button" title="Move up" aria-label="Move up">↑</button>
      <button class="row-down-btn" type="button" title="Move down" aria-label="Move down">↓</button>
    </div>
    <input type="text" class="f-garn-text" value="${esc(text)}" placeholder="Garnish text or ingredient" list="ing-opts">
    <input type="hidden" class="f-garn-ingredient-id" value="${esc(String(ingredientId))}">
    <button class="rm-btn" type="button" title="Remove">×</button>`;
  row.querySelector('.rm-btn').addEventListener('click', () => row.remove());
  row.querySelector('.row-up-btn').addEventListener('click', e => {
    e.preventDefault();
    const prev = row.previousElementSibling;
    if (prev && prev.classList.contains('garn-row')) {
      row.parentNode.insertBefore(row, prev);
    }
  });
  row.querySelector('.row-down-btn').addEventListener('click', e => {
    e.preventDefault();
    const next = row.nextElementSibling;
    if (next && next.classList.contains('garn-row')) {
      row.parentNode.insertBefore(next, row);
    }
  });
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

  if (!(await ensurePendingTagCommitted())) return;
  const placeholderResult = await ensureSubrecipesResolved();
  if (!placeholderResult.ok) return;
  S.createdPlaceholdersLastSave = placeholderResult.created;

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
  if (category !== 'Cocktail' && category !== 'Other' && category !== 'Ingredient') subtype = null;
  const payload = {
    name,
    score: parseInt(document.getElementById('f-score').value, 10) || null,
    category,
    subtype,
    tags: S.formTags,
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
    if (editId) openRecipe(editId, { resetHistory: true });
    showPlaceholderReminder(S.createdPlaceholdersLastSave);
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

  const btn = document.getElementById('bulk-import-submit');
  btn.disabled = true;
  btn.textContent = 'Importing…';

  try {
    const res = await fetch('/api/bulk-import', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: jsonText,
    });
    const result = await res.json();
    if (res.status === 401) {
      showLogin();
      throw new Error(result.code === 'AUTH_FAILED' ? result.error : 'Session expired');
    }
    if (!res.ok) {
      throw new Error(result.error || `HTTP ${res.status}`);
    }
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
  const loginForm = document.getElementById('login-form');
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
      await setUser(user);
    } catch (e) {
      loginErr.textContent = e.message;
      loginErr.classList.remove('hidden');
    } finally {
      loginBtn.disabled = false;
    }
  }
  loginForm?.addEventListener('submit', e => {
    e.preventDefault();
    doLogin();
  });
  loginBtn.addEventListener('click', e => {
    e.preventDefault();
    doLogin();
  });
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
  document.getElementById('overview-drinks').addEventListener('click', () => setOverviewMode('drinks'));
  document.getElementById('overview-ingredients').addEventListener('click', () => setOverviewMode('ingredients'));

  /* ─ Filter mode toggles ─ */
  document.getElementById('sidebar').addEventListener('click', e => {
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
    const btn = e.target.closest('button[data-name]');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.type === 'ing') toggleIng(btn.dataset.name);
      else if (btn.dataset.type === 'tool') toggleTool(btn.dataset.name);
      else if (btn.dataset.type === 'category') toggleCategory(btn.dataset.name);
      else if (btn.dataset.type === 'subtype') toggleSubtype(btn.dataset.name);
      else if (btn.dataset.type === 'tag') toggleTag(btn.dataset.name);
    }
  });

  /* ─ Empty state clear ─ */
  document.getElementById('empty-clear').addEventListener('click', clearAllFilters);

  /* ─ Search ─ */
  let searchTimer;
  const bindSearchInput = (el) => {
    if (!el) return;
    el.addEventListener('input', e => {
      clearTimeout(searchTimer);
      const value = e.target.value;
      searchTimer = setTimeout(() => {
        setSearchValue(value);
        applyFilters();
      }, 180);
    });
  };
  bindSearchInput(document.getElementById('search-input'));
  bindSearchInput(document.getElementById('search-input-mobile'));

  document.getElementById('sort-by').addEventListener('change', () => applyFilters());

  /* ─ Recipe grid clicks ─ */
  document.getElementById('grid').addEventListener('click', e => {
    const card = e.target.closest('.recipe-card');
    if (card) openRecipe(parseInt(card.dataset.id, 10), { resetHistory: true });
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
    if (!e.target.closest('.autocomplete-menu')) {
      const activeInput = S.activeAutocomplete?.inputEl;
      if (!activeInput || !activeInput.contains(e.target)) closeAutocomplete();
    }
  });

  window.addEventListener('resize', () => {
    const menu = document.getElementById('autocomplete-menu');
    if (!menu || menu.classList.contains('hidden') || !S.activeAutocomplete) return;
    positionAutocompleteMenu(S.activeAutocomplete.inputEl, menu);
  });

  /* ─ Detail panel ─ */
  document.getElementById('detail-back').addEventListener('click', openPreviousRecipe);
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
  setupIngredientReorder();

  document.getElementById('placeholder-dismiss').addEventListener('click', hidePlaceholderReminder);
  document.getElementById('placeholder-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('placeholder-overlay')) hidePlaceholderReminder();
  });

  /* ─ Image upload ─ */
  setupImageUpload();

  /* ─ Keyboard ─ */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('resolve-overlay').classList.contains('hidden')) {
      if (typeof S.resolveDialogCancel === 'function') S.resolveDialogCancel();
      else document.getElementById('resolve-overlay').classList.add('hidden');
    } else if (!document.getElementById('placeholder-overlay').classList.contains('hidden')) {
      hidePlaceholderReminder();
    } else if (!document.getElementById('confirm-overlay').classList.contains('hidden')) {
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
