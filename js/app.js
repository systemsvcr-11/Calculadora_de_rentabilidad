const state = {
  config: {},
  insumos: [],
  platos: [],
  recetas: [],
  simulations: [],
  currentView: 'dashboard',
  simulationBaseRecipe: []
};

const VIEW_INFO = {
  dashboard: ['Dashboard', 'Control general de costos y rentabilidad.'],
  dishes: ['Platos', 'Gestiona precios y recetas.'],
  ingredients: ['Insumos', 'Gestiona compras, conversiones y mermas.'],
  simulator: ['Simulador', 'Prueba cambios antes de modificar la receta real.'],
  settings: ['Configuración', 'Define la regla económica del restaurante.']
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const num = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const money = value => `S/ ${num(value).toFixed(2)}`;
const pct = value => `${(num(value) * 100).toFixed(1)}%`;
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

function configNumber(key, fallback = 0) {
  const raw = state.config[key];
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function marginTarget() {
  return Math.min(99.99, Math.max(0, configNumber('rentabilidad_objetivo_pct', 40))) / 100;
}

function taxRate() {
  return Math.max(0, configNumber('impuesto_venta_pct', 0)) / 100;
}

function indirectCost() {
  return Math.max(0, configNumber('costo_indirecto_por_plato', 0));
}

function roundPrice(value) {
  const step = configNumber('redondeo_precio', 0.5);
  if (step <= 0) return value;
  return Math.ceil((value - 1e-9) / step) * step;
}

function recommendedPrice(cost, includeTax = true) {
  const margin = marginTarget();
  if (margin >= 1) return Infinity;
  const netPrice = cost / (1 - margin);
  const finalPrice = includeTax ? netPrice * (1 + taxRate()) : netPrice;
  return roundPrice(finalPrice);
}

function marginFrom(priceFinal, cost) {
  const netPrice = taxRate() > 0 ? priceFinal / (1 + taxRate()) : priceFinal;
  if (netPrice <= 0) return 0;
  return (netPrice - cost) / netPrice;
}

function ingredientUnitCost(ingredient, overridePrice = null) {
  const purchaseQty = num(ingredient.cantidad_compra);
  const factor = num(ingredient.factor_a_base);
  const price = overridePrice == null ? num(ingredient.precio_compra) : num(overridePrice);
  const waste = Math.min(99.99, Math.max(0, num(ingredient.merma_pct))) / 100;
  const usable = purchaseQty * factor * (1 - waste);
  return usable > 0 ? price / usable : 0;
}

function ingredientById(id) {
  return state.insumos.find(i => String(i.id) === String(id));
}

function recipesForDish(dishId) {
  return state.recetas.filter(r => String(r.plato_id) === String(dishId));
}

function recipeCost(recipeRows, override = null) {
  return recipeRows.reduce((sum, row) => {
    const ingredient = ingredientById(row.insumo_id);
    if (!ingredient) return sum;
    const overridePrice = override && String(override.id) === String(ingredient.id) ? override.price : null;
    return sum + num(row.cantidad_base) * ingredientUnitCost(ingredient, overridePrice);
  }, 0);
}

function dishMetrics(dish, override = null, customRecipe = null, customPrice = null) {
  const baseRecipe = customRecipe || recipesForDish(dish.id);
  const cost = recipeCost(baseRecipe, override) + indirectCost();
  const price = customPrice == null ? num(dish.precio_venta) : num(customPrice);
  return {
    cost,
    price,
    profit: (taxRate() > 0 ? price / (1 + taxRate()) : price) - cost,
    margin: marginFrom(price, cost),
    recommended: recommendedPrice(cost, true)
  };
}

function status(margin) {
  const target = marginTarget();
  if (margin >= target) return ['green', 'OK'];
  if (margin >= Math.max(0, target - 0.05)) return ['yellow', 'REVISAR'];
  return ['red', 'BAJO'];
}

async function loadData() {
  showLoading(true);
  try {
    const data = await API.bootstrap();
    if (data.success === false) throw new Error(data.error || 'Error de API.');
    hydrate(data);
    toast('Datos actualizados.');
  } catch (error) {
    showError(error);
  } finally {
    showLoading(false);
  }
}

function hydrate(data) {
  const configRows = data.config || [];
  state.config = {};
  configRows.forEach(row => state.config[row.clave] = row.valor);
  state.insumos = data.insumos || [];
  state.platos = data.platos || [];
  state.recetas = data.recetas || [];
  state.simulations = data.simulations || [];

  $('#restaurantName').textContent = state.config.nombre_restaurante || 'Mi Restaurante';
  renderAll();
}

function renderAll() {
  fillImpactIngredient();
  renderDashboard();
  renderDishes();
  renderIngredients();
  fillDishSelectors();
  renderSimulationSummary();
  fillSettings();
  updateIngredientPreview();
}

function showLoading(active) {
  $('#refreshBtn').disabled = active;
  $('#refreshBtn').textContent = active ? '⏳ Cargando...' : '↻ Actualizar';
}

function showView(view) {
  state.currentView = view;
  $$('.view').forEach(section => section.classList.toggle('active', section.id === `view-${view}`));
  $$('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  $('#viewTitle').textContent = VIEW_INFO[view][0];
  $('#viewSubtitle').textContent = VIEW_INFO[view][1];
}

function renderDashboard() {
  const activeDishes = state.platos.filter(d => d.activo !== false);
  const metrics = activeDishes.map(d => ({ dish: d, ...dishMetrics(d) }));
  const avgMargin = metrics.length ? metrics.reduce((a, x) => a + x.margin, 0) / metrics.length : 0;
  const risky = metrics.filter(x => x.margin < marginTarget()).sort((a, b) => a.margin - b.margin);
  const top = [...metrics].sort((a, b) => b.margin - a.margin).slice(0, 6);
  const totalCost = metrics.length ? metrics.reduce((a, x) => a + x.cost, 0) / metrics.length : 0;

  $('#dashboardCards').innerHTML = [
    card('Platos activos', activeDishes.length, 'Recetas habilitadas'),
    card('Margen promedio', pct(avgMargin), `Objetivo: ${pct(marginTarget())}`),
    card('Bajo objetivo', risky.length, risky.length ? 'Necesitan revisión' : 'Todos cumplen'),
    card('Costo promedio', money(totalCost), 'Por plato')
  ].join('');

  $('#riskTable').innerHTML = risky.length ? simpleMetricsTable(risky.slice(0, 8), false) : empty('Todos los platos activos cumplen el margen objetivo.');
  $('#topTable').innerHTML = top.length ? simpleMetricsTable(top, true) : empty('Registra platos para comenzar.');
}

function card(label, value, extra) {
  return `<div class="card"><div class="card-label">${esc(label)}</div><div class="card-value">${esc(value)}</div><div class="card-extra">${esc(extra)}</div></div>`;
}

function simpleMetricsTable(items, top) {
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Plato</th><th>Costo</th><th>Precio</th><th>Margen</th><th>Estado</th>${top ? '' : '<th>Recomendado</th>'}</tr></thead><tbody>${items.map(x => {
    const s = status(x.margin);
    return `<tr><td><strong>${esc(x.dish.nombre)}</strong></td><td>${money(x.cost)}</td><td>${money(x.price)}</td><td class="${s[0] === 'red' ? 'text-red' : 'text-green'}">${pct(x.margin)}</td><td><span class="status ${s[0]}">${s[1]}</span></td>${top ? '' : `<td>${money(x.recommended)}</td>`}</tr>`;
  }).join('')}</tbody></table></div>`;
}

function fillImpactIngredient() {
  const select = $('#impactIngredient');
  const current = select.value;
  const items = state.insumos.filter(i => i.activo !== false).sort((a,b) => String(a.nombre).localeCompare(String(b.nombre)));
  select.innerHTML = `<option value="">Seleccionar...</option>${items.map(i => `<option value="${esc(i.id)}">${esc(i.nombre)}</option>`).join('')}`;
  if (items.some(i => String(i.id) === current)) select.value = current;
}

function calculateImpact() {
  const id = $('#impactIngredient').value;
  const newPrice = num($('#impactPrice').value);
  if (!id || newPrice < 0) return toast('Selecciona un insumo y coloca un precio válido.');
  const ingredient = ingredientById(id);
  const affected = state.platos.filter(d => d.activo !== false && recipesForDish(d.id).some(r => String(r.insumo_id) === String(id)))
    .map(d => ({ dish: d, before: dishMetrics(d), after: dishMetrics(d, { id, price: newPrice }) }))
    .sort((a, b) => a.after.margin - b.after.margin);

  if (!affected.length) {
    $('#impactResult').innerHTML = empty(`Ningún plato activo usa ${ingredient?.nombre || 'este insumo'}.`);
    return;
  }

  $('#impactResult').innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Plato</th><th>Costo actual</th><th>Costo nuevo</th><th>Margen actual</th><th>Margen nuevo</th><th>Precio recomendado</th></tr></thead><tbody>${affected.map(x => {
    const s = status(x.after.margin);
    return `<tr><td><strong>${esc(x.dish.nombre)}</strong></td><td>${money(x.before.cost)}</td><td>${money(x.after.cost)}</td><td>${pct(x.before.margin)}</td><td class="${s[0] === 'red' ? 'text-red' : ''}">${pct(x.after.margin)} <span class="status ${s[0]}">${s[1]}</span></td><td>${money(x.after.recommended)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderDishes() {
  const query = String($('#dishSearch')?.value || '').toLowerCase().trim();
  const rows = state.platos.filter(d => `${d.nombre} ${d.categoria}`.toLowerCase().includes(query));
  $('#dishesTable').innerHTML = rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Plato</th><th>Categoría</th><th>Precio</th><th>Costo</th><th>Margen</th><th>Estado</th><th></th></tr></thead><tbody>${rows.map(d => {
    const m = dishMetrics(d); const s = status(m.margin);
    return `<tr><td><strong>${esc(d.nombre)}</strong></td><td>${esc(d.categoria || '—')}</td><td>${money(m.price)}</td><td>${money(m.cost)}</td><td>${pct(m.margin)}</td><td><span class="status ${d.activo === false ? 'yellow' : s[0]}">${d.activo === false ? 'INACTIVO' : s[1]}</span></td><td><button class="action-link" data-edit-dish="${esc(d.id)}">Editar</button><button class="action-link" data-toggle-dish="${esc(d.id)}">${d.activo === false ? 'Activar' : 'Desactivar'}</button></td></tr>`;
  }).join('')}</tbody></table></div>` : empty('No hay platos que coincidan.');
}

function renderIngredients() {
  const query = String($('#ingredientSearch')?.value || '').toLowerCase().trim();
  const rows = state.insumos.filter(i => String(i.nombre).toLowerCase().includes(query));
  $('#ingredientsTable').innerHTML = rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Insumo</th><th>Compra</th><th>Base</th><th>Precio compra</th><th>Merma</th><th>Costo/base</th><th>Estado</th><th></th></tr></thead><tbody>${rows.map(i => {
    const unitCost = ingredientUnitCost(i);
    const usable = num(i.cantidad_compra) * num(i.factor_a_base) * (1 - num(i.merma_pct) / 100);
    return `<tr><td><strong>${esc(i.nombre)}</strong></td><td>${num(i.cantidad_compra)} ${esc(i.unidad_compra)}</td><td>${esc(i.unidad_base)}</td><td>${money(i.precio_compra)}</td><td>${num(i.merma_pct).toFixed(2)}%</td><td>${money(unitCost)} / ${esc(i.unidad_base)}</td><td><span class="status ${i.activo === false ? 'yellow' : 'green'}">${i.activo === false ? 'INACTIVO' : 'ACTIVO'}</span></td><td><button class="action-link" data-edit-ingredient="${esc(i.id)}">Editar</button><button class="action-link" data-toggle-ingredient="${esc(i.id)}">${i.activo === false ? 'Activar' : 'Desactivar'}</button><div class="small-muted">Utilizable: ${usable.toFixed(2)} ${esc(i.unidad_base)}</div></td></tr>`;
  }).join('')}</tbody></table></div>` : empty('No hay insumos que coincidan.');
}

function fillDishSelectors() {
  const simSelect = $('#simDish');
  const selected = simSelect.value;
  const dishes = state.platos.filter(d => d.activo !== false);
  simSelect.innerHTML = dishes.length ? dishes.map(d => `<option value="${esc(d.id)}">${esc(d.nombre)}</option>`).join('') : '<option value="">No hay platos activos</option>';
  if (dishes.some(d => String(d.id) === selected)) simSelect.value = selected;
  loadSimulationFromDish();
}

function addRecipeRow(row = { insumo_id: '', cantidad_base: '' }) {
  $('#recipeRows').insertAdjacentHTML('beforeend', recipeRowHtml(row, 'dish'));
  refreshLineCosts('#recipeRows');
}

function addSimulationRow(row = { insumo_id: '', cantidad_base: '' }) {
  $('#simRows').insertAdjacentHTML('beforeend', recipeRowHtml(row, 'sim'));
  refreshLineCosts('#simRows');
  recalculateSimulation();
}

function recipeRowHtml(row, mode) {
  const options = `<option value="">Seleccionar...</option>${state.insumos.filter(i => i.activo !== false).sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre))).map(i => `<option value="${esc(i.id)}" ${String(i.id) === String(row.insumo_id) ? 'selected' : ''}>${esc(i.nombre)} (${esc(i.unidad_base)})</option>`).join('')}`;
  const prefix = mode === 'sim' ? 'sim' : 'line';
  return `<div class="recipe-row" data-mode="${mode}">
    <select class="${prefix}-ing" aria-label="Insumo">${options}</select>
    <input class="${prefix}-qty" type="number" min="0" step="0.001" value="${esc(row.cantidad_base ?? '')}" placeholder="Cantidad">
    <input class="${prefix}-cost" type="text" value="--" readonly aria-label="Costo">
    <button type="button" class="icon-btn remove-row" title="Eliminar">×</button>
  </div>`;
}

function refreshLineCosts(container) {
  $$(container + ' .recipe-row').forEach(row => {
    const prefix = row.dataset.mode === 'sim' ? 'sim' : 'line';
    const ingredient = ingredientById(row.querySelector(`.${prefix}-ing`).value);
    const qty = num(row.querySelector(`.${prefix}-qty`).value);
    row.querySelector(`.${prefix}-cost`).value = ingredient ? money(qty * ingredientUnitCost(ingredient)) : '--';
  });
}

function collectRecipe(container) {
  const rows = $$(container + ' .recipe-row');
  return rows.map(row => {
    const prefix = row.dataset.mode === 'sim' ? 'sim' : 'line';
    return { insumo_id: row.querySelector(`.${prefix}-ing`).value, cantidad_base: num(row.querySelector(`.${prefix}-qty`).value) };
  }).filter(r => r.insumo_id && r.cantidad_base > 0);
}

async function saveDishForm(event) {
  event.preventDefault();
  const data = {
    dish: {
      id: $('#dishId').value || '',
      nombre: $('#dishName').value,
      categoria: $('#dishCategory').value,
      precio_venta: num($('#dishPrice').value),
      activo: true
    },
    recipe: collectRecipe('#recipeRows')
  };
  if (!data.recipe.length) return toast('Agrega al menos un insumo a la receta.');

  try {
    await API.post('save_dish', { data });
    await loadData();
    resetDishForm();
    toast('Plato guardado correctamente.');
  } catch (error) { showError(error); }
}

function editDish(id) {
  const dish = state.platos.find(d => String(d.id) === String(id));
  if (!dish) return;
  $('#dishId').value = dish.id;
  $('#dishName').value = dish.nombre;
  $('#dishCategory').value = dish.categoria || '';
  $('#dishPrice').value = dish.precio_venta;
  $('#recipeRows').innerHTML = '';
  recipesForDish(id).forEach(r => addRecipeRow(r));
  showView('dishes');
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function resetDishForm() {
  $('#dishForm').reset();
  $('#dishId').value = '';
  $('#recipeRows').innerHTML = '';
  addRecipeRow();
}

async function toggleDish(id) {
  const dish = state.platos.find(d => String(d.id) === String(id));
  if (!dish) return;
  try { await API.post('toggle_dish', { id, active: dish.activo === false }); await loadData(); }
  catch (error) { showError(error); }
}

async function saveIngredientForm(event) {
  event.preventDefault();
  const data = {
    id: $('#ingredientId').value || '',
    nombre: $('#ingredientName').value,
    unidad_compra: $('#purchaseUnit').value,
    cantidad_compra: num($('#purchaseQty').value),
    unidad_base: $('#baseUnit').value,
    factor_a_base: num($('#baseFactor').value),
    precio_compra: num($('#purchasePrice').value),
    merma_pct: num($('#wastePct').value),
    activo: true
  };
  try { await API.post('save_ingredient', { data }); await loadData(); resetIngredientForm(); toast('Insumo guardado correctamente.'); }
  catch (error) { showError(error); }
}

function editIngredient(id) {
  const i = ingredientById(id);
  if (!i) return;
  $('#ingredientId').value = i.id;
  $('#ingredientName').value = i.nombre;
  $('#purchaseUnit').value = i.unidad_compra;
  $('#purchaseQty').value = i.cantidad_compra;
  $('#baseUnit').value = i.unidad_base;
  $('#baseFactor').value = i.factor_a_base;
  $('#purchasePrice').value = i.precio_compra;
  $('#wastePct').value = i.merma_pct;
  updateIngredientPreview();
  showView('ingredients');
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function resetIngredientForm() {
  $('#ingredientForm').reset();
  $('#ingredientId').value = '';
  $('#wastePct').value = 0;
  updateIngredientPreview();
}

async function toggleIngredient(id) {
  const ingredient = ingredientById(id);
  if (!ingredient) return;
  try { await API.post('toggle_ingredient', { id, active: ingredient.activo === false }); await loadData(); }
  catch (error) { showError(error); }
}

function updateIngredientPreview() {
  const qty = num($('#purchaseQty')?.value);
  const factor = num($('#baseFactor')?.value);
  const price = num($('#purchasePrice')?.value);
  const waste = num($('#wastePct')?.value) / 100;
  const usable = qty * factor * (1 - waste);
  const unit = usable > 0 ? price / usable : 0;
  $('#ingredientPreview').innerHTML = usable > 0
    ? `<strong>Costo calculado:</strong> ${money(unit)} por ${esc($('#baseUnit').value || 'unidad base')} · usable después de merma: ${usable.toFixed(2)}`
    : '<span>Completa cantidades, factor y precio para ver el costo unitario.</span>';
}

function fillSettings() {
  $('#cfgRestaurant').value = state.config.nombre_restaurante || '';
  $('#cfgMargin').value = configNumber('rentabilidad_objetivo_pct', 40);
  $('#cfgTax').value = configNumber('impuesto_venta_pct', 0);
  $('#cfgIndirect').value = configNumber('costo_indirecto_por_plato', 0);
  $('#cfgRound').value = configNumber('redondeo_precio', 0.5);
}

async function saveConfigForm(event) {
  event.preventDefault();
  const entries = [
    { clave: 'nombre_restaurante', valor: $('#cfgRestaurant').value },
    { clave: 'rentabilidad_objetivo_pct', valor: num($('#cfgMargin').value) },
    { clave: 'impuesto_venta_pct', valor: num($('#cfgTax').value) },
    { clave: 'costo_indirecto_por_plato', valor: num($('#cfgIndirect').value) },
    { clave: 'redondeo_precio', valor: num($('#cfgRound').value) }
  ];
  try { await API.post('save_config', { entries }); await loadData(); toast('Configuración guardada.'); }
  catch (error) { showError(error); }
}

function getSimulationRecipe() {
  return collectRecipe('#simRows');
}

function loadSimulationFromDish() {
  const id = $('#simDish').value;
  const dish = state.platos.find(d => String(d.id) === String(id));
  if (!dish) {
    $('#simRows').innerHTML = '';
    $('#simSummary').innerHTML = empty('Registra un plato activo para usar el simulador.');
    return;
  }
  state.simulationBaseRecipe = recipesForDish(dish.id).map(r => ({ ...r }));
  $('#simPrice').value = dish.precio_venta;
  $('#simRows').innerHTML = '';
  state.simulationBaseRecipe.forEach(r => addSimulationRow(r));
  renderSimulationSummary();
}

function recalculateSimulation() {
  const id = $('#simDish').value;
  const dish = state.platos.find(d => String(d.id) === String(id));
  if (!dish) return;
  const recipe = getSimulationRecipe();
  const cost = recipeCost(recipe) + indirectCost();
  const price = num($('#simPrice').value);
  const margin = marginFrom(price, cost);
  const recommended = recommendedPrice(cost, true);
  const delta = cost - (recipeCost(state.simulationBaseRecipe) + indirectCost());
  const s = status(margin);

  $('#simSummary').innerHTML = `
    <h3>Resultado</h3>
    <div class="metric"><span>Costo actual</span><strong>${money(recipeCost(state.simulationBaseRecipe) + indirectCost())}</strong></div>
    <div class="metric"><span>Costo simulado</span><strong>${money(cost)}</strong></div>
    <div class="metric"><span>Variación de costo</span><strong>${delta >= 0 ? '+' : ''}${money(delta)}</strong></div>
    <div class="metric"><span>Precio actual</span><strong>${money(price)}</strong></div>
    <div class="metric"><span>Margen simulado</span><strong class="${s[0] === 'red' ? 'text-red' : 'text-green'}">${pct(margin)}</strong></div>
    <div class="metric"><span>Objetivo</span><strong>${pct(marginTarget())}</strong></div>
    <div class="recommend"><span>Precio recomendado</span><strong>${Number.isFinite(recommended) ? money(recommended) : '—'}</strong><small>${taxRate() ? `Incluye ${pct(taxRate())} de impuesto configurado.` : 'Sin impuesto configurado.'}</small></div>
    <div class="status ${s[0]} summary-status">${s[1]}</div>`;
}

function resetSimulation() { loadSimulationFromDish(); }

async function saveCurrentSimulation() {
  const id = $('#simDish').value;
  const dish = state.platos.find(d => String(d.id) === String(id));
  if (!dish) return toast('Selecciona un plato.');
  const recipe = getSimulationRecipe();
  if (!recipe.length) return toast('La simulación debe tener al menos un insumo.');
  const cost = recipeCost(recipe) + indirectCost();
  const price = num($('#simPrice').value);

  const data = {
    plato_id: dish.id,
    plato_nombre: dish.nombre,
    precio_venta: price,
    costo_total: cost,
    margen: marginFrom(price, cost),
    precio_recomendado: recommendedPrice(cost, true),
    detalle: { recipe, generated_at: new Date().toISOString() }
  };

  try { await API.post('save_simulation', { data }); await loadData(); toast('Simulación guardada en historial.'); }
  catch (error) { showError(error); }
}

function empty(text) { return `<div class="empty">${esc(text)}</div>`; }
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => element.classList.remove('show'), 2800);
}
function showError(error) { toast(`Error: ${error?.message || error}`); console.error(error); }

function bindEvents() {
  $$('.nav-btn').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
  $('#refreshBtn').addEventListener('click', loadData);
  $('#impactBtn').addEventListener('click', calculateImpact);
  $('#dishForm').addEventListener('submit', saveDishForm);
  $('#ingredientForm').addEventListener('submit', saveIngredientForm);
  $('#settingsForm').addEventListener('submit', saveConfigForm);
  $('#addRecipeBtn').addEventListener('click', () => addRecipeRow());
  $('#addSimRowBtn').addEventListener('click', () => addSimulationRow());
  $('#resetDishBtn').addEventListener('click', resetDishForm);
  $('#resetIngredientBtn').addEventListener('click', resetIngredientForm);
  $('#resetSimulationBtn').addEventListener('click', resetSimulation);
  $('#saveSimulationBtn').addEventListener('click', saveCurrentSimulation);
  $('#simDish').addEventListener('change', loadSimulationFromDish);
  $('#simPrice').addEventListener('input', recalculateSimulation);
  $('#dishSearch').addEventListener('input', renderDishes);
  $('#ingredientSearch').addEventListener('input', renderIngredients);

  ['#purchaseQty', '#baseFactor', '#purchasePrice', '#wastePct', '#baseUnit'].forEach(selector => $(selector).addEventListener('input', updateIngredientPreview));

  document.addEventListener('input', event => {
    if (event.target.matches('.line-qty, .sim-qty, .line-ing, .sim-ing')) {
      refreshLineCosts('#recipeRows');
      refreshLineCosts('#simRows');
      recalculateSimulation();
    }
  });

  document.addEventListener('click', event => {
    const target = event.target;
    if (target.matches('.remove-row')) {
      target.closest('.recipe-row')?.remove();
      refreshLineCosts('#recipeRows');
      refreshLineCosts('#simRows');
      recalculateSimulation();
    }
    if (target.dataset.editDish) editDish(target.dataset.editDish);
    if (target.dataset.toggleDish) toggleDish(target.dataset.toggleDish);
    if (target.dataset.editIngredient) editIngredient(target.dataset.editIngredient);
    if (target.dataset.toggleIngredient) toggleIngredient(target.dataset.toggleIngredient);
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  resetDishForm();
  resetIngredientForm();
  try { await loadData(); }
  catch (_) {}
});
