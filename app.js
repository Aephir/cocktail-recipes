/* ══════════════════════════════════════════════════════════════════════════
   Cocktail Book — app.js
══════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ── State ─────────────────────────────────────────────────────────────── */
const S = {
  user: null,
  recipes: [],
  customFields: [],     // CustomFieldDef list
  activeIngs: new Set(),
  activeTools: new Set(),
  search: '',
  currentId: null,
  editingId: null,
  scale: 1,
  pendingImage: null,
  sidebarCollapsed: false,
  sidebarMobileOpen: false,
};

/* ── API ────────────────────────────────────────────────────────────────── */
async function api(method, path, body = null) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (res.status === 401) { showLogin(); throw new Error('Session expired'); }
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
  applyFilters();
}

/* ── Filtering (client-side) ────────────────────────────────────────────── */
function applyFilters() {
  const q = S.search.toLowerCase().trim();
  let list = S.recipes;

  if (q) list = list.filter(r => r.name.toLowerCase().includes(q));

  if (S.activeIngs.size) {
    list = list.filter(r => {
      const names = new Set(r.ingredients.map(i => i.name));
      return [...S.activeIngs].every(n => names.has(n));
    });
  }

  if (S.activeTools.size) {
    list = list.filter(r => {
      const names = new Set(r.tools);
      return [...S.activeTools].every(n => names.has(n));
    });
  }

  renderCards(list);
  renderActivePills();
  updateSidebarCounts(list);
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

function clearAllFilters() {
  S.activeIngs.clear();
  S.activeTools.clear();
  S.search = '';
  document.getElementById('search-input').value = '';
  refreshChipStates();
  applyFilters();
}

/* ── Sidebar ────────────────────────────────────────────────────────────── */
function buildSidebar() {
  const ingCounts = new Map();
  const toolCounts = new Map();
  for (const r of S.recipes) {
    r.ingredients.forEach(i => ingCounts.set(i.name, (ingCounts.get(i.name) || 0) + 1));
    r.tools.forEach(t => toolCounts.set(t, (toolCounts.get(t) || 0) + 1));
  }

  const sortedIngs = [...ingCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const sortedTools = [...toolCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  document.getElementById('ing-total').textContent = sortedIngs.length;
  document.getElementById('tool-total').textContent = sortedTools.length;

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
}

function updateSidebarCounts(filtered) {
  const ingCounts = new Map();
  const toolCounts = new Map();
  for (const r of filtered) {
    r.ingredients.forEach(i => ingCounts.set(i.name, (ingCounts.get(i.name) || 0) + 1));
    r.tools.forEach(t => toolCounts.set(t, (toolCounts.get(t) || 0) + 1));
  }
  document.querySelectorAll('#ing-list .fchip').forEach(btn => {
    btn.querySelector('.chip-ct').textContent = ingCounts.get(btn.dataset.name) || 0;
  });
  document.querySelectorAll('#tool-list .fchip').forEach(btn => {
    btn.querySelector('.chip-ct').textContent = toolCounts.get(btn.dataset.name) || 0;
  });
}

function renderActivePills() {
  const c = document.getElementById('active-pills');
  const pills = [];
  for (const name of S.activeIngs) {
    pills.push(`<span class="apill" data-type="ing" data-name="${esc(name)}">
      ${esc(name)}
      <button data-type="ing" data-name="${esc(name)}" title="Remove filter">×</button>
    </span>`);
  }
  for (const name of S.activeTools) {
    pills.push(`<span class="apill" data-type="tool" data-name="${esc(name)}">
      ⚙ ${esc(name)}
      <button data-type="tool" data-name="${esc(name)}" title="Remove filter">×</button>
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
      .map(i => `<span class="ctag${S.activeIngs.has(i.name) ? ' active' : ''}">${esc(i.name)}</span>`)
      .join('');
    const more = r.ingredients.length > 3
      ? `<span class="ctag">+${r.ingredients.length - 3}</span>` : '';

    return `
      <div class="recipe-card" data-id="${r.id}">
        <div class="card-thumb">${thumbHtml}</div>
        <div class="card-body">
          <div class="card-name">${esc(r.name)}</div>
          <div class="card-tags">${tags}${more}</div>
          <div class="card-meta">${r.ingredients.length} ingredient${r.ingredients.length !== 1 ? 's' : ''}</div>
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

  const ingRows = recipe.ingredients.map((i, idx) => `
    <tr>
      <td class="itd-amt" data-ing-idx="${idx}" data-unit="${esc(i.unit)}" data-base="${i.amount ?? ''}">${
        i.amount != null ? fmtAmount(i.amount, i.unit, S.scale) : ''
      }</td>
      <td class="itd-unit">${i.amount != null ? esc(i.unit) : ''}</td>
      <td class="itd-name">${esc(i.name)}</td>
    </tr>`).join('');

  const toolsHtml = recipe.tools.length
    ? recipe.tools.map(t => `<span class="tool-chip">${esc(t)}</span>`).join('')
    : '<span style="color:var(--text-muted)">—</span>';

  const vol = totalMl(recipe, S.scale);

  document.getElementById('detail-body').innerHTML = `
    ${imgHtml}
    <div class="detail-inner">
      <h1 class="detail-name">${esc(recipe.name)}</h1>

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
        <div class="detail-prose">${esc(recipe.procedure)}</div>
      </div>` : ''}

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

  if (recipe.image_url) {
    document.getElementById('img-preview').src = recipe.image_url;
    document.getElementById('img-preview').classList.remove('hidden');
    document.getElementById('drop-placeholder').classList.add('hidden');
    document.getElementById('remove-img').classList.remove('hidden');
  }

  recipe.ingredients.forEach(i => addIngRow(i.amount ?? '', i.unit, i.name));
  recipe.tools.forEach(t => addToolRow(t));

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
  document.getElementById('f-proc').value = '';
  document.getElementById('f-notes').value = '';
  document.getElementById('f-ings').innerHTML = '';
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
    document.getElementById('ing-opts').innerHTML = ings.map(n => `<option value="${esc(n)}">`).join('');
    document.getElementById('tool-opts').innerHTML = tools.map(n => `<option value="${esc(n)}">`).join('');
  } catch { /* non-critical */ }
}

function addIngRow(amount = '', unit = 'ml', name = '') {
  const row = document.createElement('div');
  row.className = 'ing-row';
  row.innerHTML = `
    <input type="number" class="f-ing-amt" value="${esc(String(amount))}" placeholder="Amt" step="any" min="0">
    <input type="text"   class="f-ing-unit" value="${esc(unit)}" placeholder="Unit" list="unit-opts">
    <input type="text"   class="f-ing-name" value="${esc(name)}" placeholder="Name" list="ing-opts">
    <button class="rm-btn" type="button" title="Remove">×</button>`;
  row.querySelector('.rm-btn').addEventListener('click', () => row.remove());
  document.getElementById('f-ings').appendChild(row);
}

function addToolRow(name = '') {
  const row = document.createElement('div');
  row.className = 'tool-row';
  row.innerHTML = `
    <input type="text" class="f-tool-name" value="${esc(name)}" placeholder="Tool name" list="tool-opts">
    <button class="rm-btn" type="button" title="Remove">×</button>`;
  row.querySelector('.rm-btn').addEventListener('click', () => row.remove());
  document.getElementById('f-tools').appendChild(row);
}

async function saveRecipe() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { alert('Please enter a recipe name.'); return; }

  const ingredients = [];
  document.querySelectorAll('.ing-row').forEach(row => {
    const amtStr = row.querySelector('.f-ing-amt').value.trim();
    const unit   = row.querySelector('.f-ing-unit').value.trim() || 'ml';
    const iName  = row.querySelector('.f-ing-name').value.trim();
    if (iName) {
      ingredients.push({
        amount: amtStr !== '' ? parseFloat(amtStr) : null,
        unit,
        name: iName,
      });
    }
  });

  const tools = [];
  document.querySelectorAll('.f-tool-name').forEach(input => {
    const t = input.value.trim();
    if (t) tools.push(t);
  });

  const custom_fields = {};
  S.customFields.forEach(f => {
    const el = document.getElementById(`cf-${f.id}`);
    if (el) custom_fields[String(f.id)] = el.value.trim();
  });

  const payload = {
    name,
    procedure: document.getElementById('f-proc').value.trim(),
    notes: document.getElementById('f-notes').value.trim(),
    ingredients,
    tools,
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
  document.getElementById('clear-btn').addEventListener('click', clearAllFilters);

  /* ─ Active pills removal ─ */
  document.getElementById('active-pills').addEventListener('click', e => {
    const btn = e.target.closest('button[data-name]');
    if (!btn) return;
    if (btn.dataset.type === 'ing') toggleIng(btn.dataset.name);
    else toggleTool(btn.dataset.name);
  });

  /* ─ Empty state clear ─ */
  document.getElementById('empty-clear').addEventListener('click', clearAllFilters);

  /* ─ Search ─ */
  let searchTimer;
  document.getElementById('search-input').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { S.search = e.target.value; applyFilters(); }, 180);
  });

  /* ─ Recipe grid clicks ─ */
  document.getElementById('grid').addEventListener('click', e => {
    const card = e.target.closest('.recipe-card');
    if (card) openRecipe(parseInt(card.dataset.id, 10));
  });

  /* ─ New recipe ─ */
  document.getElementById('new-btn').addEventListener('click', openAddForm);

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

  /* ─ Boot ─ */
  init();
});
