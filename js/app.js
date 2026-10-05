'use strict';

const state = {
  config: {},
  items: [],
  components: [],
  prices: [],
  simulations: [],
  currentView: 'dashboard',
  simulation: { itemId: '', price: 0, rows: [] }
};

const VIEW_INFO = {
  dashboard: ['Dashboard', 'Control general de costos y rentabilidad.'],
  dishes: ['Platos', 'Precios, costos y márgenes de tus recetas finales.'],
  ingredients: ['Ingredientes', 'Costos unitarios importados desde tus datos actuales.'],
  recipes: ['Recetas', 'Estructura de recetas finales y subrecetas.'],
  simulator: ['Simulador', 'Prueba cambios sin modificar la receta real.'],
  settings: ['Configuración', 'Define la regla económica del restaurante.']
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const num = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const money = value => `S/ ${num(value).toFixed(2)}`;
const pct = value => `${(num(value) * 100).toFixed(1)}%`;
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function configNumber(key, fallback = 0) {
  const n = Number(state.config[key]);
  return Number.isFinite(n) ? n : fallback;
}
function marginTarget() { return Math.min(99.99, Math.max(0, configNumber('rentabilidad_objetivo_pct', 40))) / 100; }
function taxRate() { return Math.max(0, configNumber('impuesto_venta_pct', 0)) / 100; }
function indirectCost() { return Math.max(0, configNumber('costo_indirecto_por_plato', 0)); }
function roundPrice(value) { const step = configNumber('redondeo_precio', 0.5); return step > 0 ? Math.ceil((value - 1e-9) / step) * step : value; }
function recommendedPrice(cost) { const m = marginTarget(); if (m >= 1) return Infinity; return roundPrice((cost / (1 - m)) * (1 + taxRate())); }
function marginFrom(finalPrice, cost) { const net = taxRate() > 0 ? finalPrice / (1 + taxRate()) : finalPrice; return net > 0 ? (net - cost) / net : 0; }
function normalize(v) { return String(v || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' '); }

function itemById(id) { return state.items.find(i => String(i.id) === String(id)); }
function itemTypeLabel(type) { return ({ INSUMO: 'Ingrediente', SUBRECETA: 'Subreceta', RECETA_BASE: 'Receta base', RECETA_FINAL: 'Receta final' })[type] || type; }
function priceEntry(itemId) { return state.prices.find(p => String(p.item_id) === String(itemId) && p.activo !== false); }
function priceFor(itemId) { return num(priceEntry(itemId)?.precio_venta); }
function componentsFor(recipeId) { return state.components.filter(c => String(c.receta_id) === String(recipeId)); }
function finalRecipes() { return state.items.filter(i => i.tipo === 'RECETA_FINAL' && i.activo !== false); }
function ingredients() { return state.items.filter(i => i.tipo === 'INSUMO' && i.activo !== false); }

function dimension(unit) {
  const u = normalize(unit);
  if (['KG','GR','G'].includes(u)) return 'weight';
  if (['L','ML'].includes(u)) return 'volume';
  if (['UND','PORCION','PLATO'].includes(u)) return 'count';
  return 'other';
}
function toBase(unit) {
  const u = normalize(unit);
  if (u === 'KG') return 1000;
  if (u === 'GR' || u === 'G') return 1;
  if (u === 'L') return 1000;
  if (u === 'ML') return 1;
  return 1;
}
function convertQty(qty, from, to) {
  if (normalize(from) === normalize(to)) return qty;
  if (dimension(from) !== dimension(to)) return null;
  return qty * toBase(from) / toBase(to);
}

function ingredientCostPerBase(item, overrideMap) {
  if (!item) return 0;
  const override = overrideMap?.get(String(item.id));
  if (override != null) return num(override);
  return num(item.costo_unitario);
}

function buildCostEngine(overrideMap = new Map()) {
  const memo = new Map();
  const visiting = new Set();
  function unitCost(id) {
    const key = String(id);
    if (memo.has(key)) return memo.get(key);
    const item = itemById(key);
    if (!item) return 0;
    if (item.tipo === 'INSUMO') { const c = ingredientCostPerBase(item, overrideMap); memo.set(key, c); return c; }
    if (visiting.has(key)) throw new Error(`Dependencia circular detectada: ${item.nombre}`);
    visiting.add(key);
    let total = 0;
    for (const row of componentsFor(key)) {
      const component = itemById(row.componente_id);
      if (!component) continue;
      const qty = num(row.cantidad_costeo);
      total += qty * unitCost(component.id);
    }
    const yieldQty = num(item.rendimiento);
    const result = yieldQty > 0 ? total / yieldQty : 0;
    visiting.delete(key); memo.set(key, result); return result;
  }
  return { unitCost };
}

function recipeCost(recipeId, rowsOverride = null, ingredientOverride = null) {
  const overrideMap = ingredientOverride ? new Map([[String(ingredientOverride.id), ingredientOverride.price]]) : new Map();
  const engine = buildCostEngine(overrideMap);
  let rows = rowsOverride || componentsFor(recipeId);
  let total = 0;
  for (const row of rows) {
    const component = itemById(row.componentId || row.componente_id);
    if (!component) continue;
    const sourceUnit = row.unit || row.unidad;
    const qty = num(row.quantity != null ? row.quantity : row.cantidad);
    const targetUnit = component.unidad_costeo;
    const converted = convertQty(qty, sourceUnit, targetUnit);
    if (converted == null) throw new Error(`Unidad incompatible: ${sourceUnit} → ${targetUnit} en ${component.nombre}`);
    total += converted * engine.unitCost(component.id);
  }
  return total + indirectCost();
}

function dishMetrics(dish, priceOverride = null, rowsOverride = null, ingredientOverride = null) {
  const cost = recipeCost(dish.id, rowsOverride, ingredientOverride);
  const price = priceOverride == null ? priceFor(dish.id) : num(priceOverride);
  return { cost, price, profit: (taxRate() ? price / (1 + taxRate()) : price) - cost, margin: marginFrom(price, cost), recommended: recommendedPrice(cost) };
}
function status(margin, hasPrice = true) {
  if (!hasPrice || margin <= 0 && priceFor('___never') === 0) return ['gray', 'SIN PRECIO'];
  const target = marginTarget();
  if (margin >= target) return ['green', 'OK'];
  if (margin >= Math.max(0, target - 0.05)) return ['yellow', 'REVISAR'];
  return ['red', 'BAJO'];
}

async function loadData() {
  setLoading(true);
  try { hydrate(await API.bootstrap()); renderAll(); setApiStatus('Conectado correctamente.', true); }
  catch (error) { showError(error); setApiStatus(error.message, false); }
  finally { setLoading(false); }
}
function hydrate(data) {
  state.config = {};
  (data.config || []).forEach(row => state.config[row.clave] = row.valor);
  state.items = data.items || [];
  state.components = data.components || [];
  state.prices = data.prices || [];
  state.simulations = data.simulations || [];
  $('#restaurantName').textContent = state.config.nombre_restaurante || 'Mi Restaurante';
}
function setLoading(active) { $('#loading').classList.toggle('hidden', !active); $('#refreshBtn').disabled = active; }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(window.__toastTimer); window.__toastTimer = setTimeout(() => el.classList.remove('show'), 3000); }
function showError(error) { toast(`❌ ${error.message || error}`); console.error(error); }
function setApiStatus(text, ok) { $('#apiStatus').textContent = text; $('#apiStatus').className = `status-box ${ok ? 'ok' : 'error'}`; }

function showView(view) {
  state.currentView = view;
  $$('.view').forEach(s => s.classList.toggle('active', s.id === `view-${view}`));
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#viewTitle').textContent = VIEW_INFO[view][0];
  $('#viewSubtitle').textContent = VIEW_INFO[view][1];
}
function renderAll() {
  renderDashboard(); renderDishes(); renderIngredients(); renderRecipes(); fillImpactIngredient(); fillDishSelector(); fillSettings(); resetSimulation();
}

function renderDashboard() {
  const dishes = finalRecipes();
  const metrics = dishes.map(d => ({ dish: d, ...dishMetrics(d) }));
  const priced = metrics.filter(x => x.price > 0);
  const risky = priced.filter(x => x.margin < marginTarget()).sort((a,b) => a.margin - b.margin);
  const avg = priced.length ? priced.reduce((s,x) => s+x.margin,0)/priced.length : 0;
  const unpriced = dishes.filter(d => priceFor(d.id) <= 0).length;
  const cards = [
    card('Recetas finales', dishes.length, `${state.items.filter(x=>x.tipo==='SUBRECETA').length} subrecetas`),
    card('Margen promedio', priced.length ? pct(avg) : '—', `Objetivo: ${pct(marginTarget())}`),
    card('Bajo objetivo', risky.length, risky.length ? 'Requieren revisión' : 'Sin alertas'),
    card('Sin precio', unpriced, unpriced ? 'Asigna precio en Platos' : 'Todos tienen precio')
  ];
  $('#dashboardCards').innerHTML = cards.join('');
  $('#riskTable').innerHTML = risky.length ? metricsTable(risky.slice(0,8), false) : empty(unpriced ? 'Primero asigna precios a tus platos.' : 'Todos los platos con precio cumplen el margen objetivo.');
  $('#topTable').innerHTML = priced.length ? metricsTable([...priced].sort((a,b)=>b.margin-a.margin).slice(0,8), true) : empty('No hay precios de venta configurados.');
}
function card(label,value,extra) { return `<div class="card"><div class="card-label">${esc(label)}</div><div class="card-value">${esc(value)}</div><div class="card-extra">${esc(extra)}</div></div>`; }
function metricsTable(items) { return `<div class="table-wrap"><table class="table"><thead><tr><th>Plato</th><th>Costo</th><th>Precio</th><th>Margen</th><th>Estado</th><th>Recomendado</th></tr></thead><tbody>${items.map(x=>{const s=status(x.margin,x.price>0);return `<tr><td><strong>${esc(x.dish.nombre)}</strong></td><td>${money(x.cost)}</td><td>${x.price?money(x.price):'—'}</td><td>${x.price?pct(x.margin):'—'}</td><td><span class="status ${s[0]}">${s[1]}</span></td><td>${money(x.recommended)}</td></tr>`;}).join('')}</tbody></table></div>`; }
function empty(text) { return `<div class="empty">${esc(text)}</div>`; }

function renderDishes() {
  const q = normalize($('#dishSearch').value);
  const dishes = finalRecipes().filter(d => !q || normalize(d.nombre).includes(q));
  $('#dishesTable').innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Plato</th><th>Categoría</th><th>Costo</th><th>Precio venta</th><th>Margen</th><th>Recomendado</th><th></th></tr></thead><tbody>${dishes.map(d=>{const m=dishMetrics(d);const p=priceFor(d.id);const s=status(m.margin,p>0);return `<tr><td><strong>${esc(d.nombre)}</strong></td><td>${esc(d.categoria||'—')}</td><td>${money(m.cost)}</td><td><div class="inline-edit"><input class="price-input" data-price-id="${esc(d.id)}" type="number" min="0" step="0.01" value="${p?esc(p):''}" placeholder="0.00"><button class="btn btn-small btn-primary" data-save-price="${esc(d.id)}">Guardar</button></div></td><td>${p?pct(m.margin):'—'}</td><td>${money(m.recommended)}</td><td><span class="status ${s[0]}">${s[1]}</span></td></tr>`;}).join('')}</tbody></table></div>`;
}

function renderIngredients() {
  const q = normalize($('#ingredientSearch').value);
  const list = ingredients().filter(i=>!q || normalize(i.nombre).includes(q));
  $('#ingredientsTable').innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Ingrediente</th><th>Proveedor</th><th>Categoría</th><th>Unidad</th><th>Costo unitario</th></tr></thead><tbody>${list.map(i=>`<tr><td><strong>${esc(i.nombre)}</strong></td><td>${esc(i.proveedor||'—')}</td><td>${esc(i.categoria||'—')}</td><td>${esc(i.unidad_costeo||'—')}</td><td>${money(i.costo_unitario)}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderRecipes() {
  const q = normalize($('#recipeSearch').value);
  const list = state.items.filter(i => i.tipo !== 'INSUMO' && i.activo !== false).filter(i=>!q || normalize(i.nombre).includes(q));
  $('#recipesTable').innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Receta</th><th>Tipo</th><th>Rendimiento</th><th>Unidad</th><th>Costo unitario</th><th>Componentes</th></tr></thead><tbody>${list.map(i=>`<tr><td><strong>${esc(i.nombre)}</strong></td><td><span class="tag">${esc(itemTypeLabel(i.tipo))}</span></td><td>${num(i.rendimiento).toFixed(3)}</td><td>${esc(i.unidad_rendimiento||i.unidad_costeo||'—')}</td><td>${money(i.costo_unitario)}</td><td>${componentsFor(i.id).length}</td></tr>`).join('')}</tbody></table></div>`;
}

function fillImpactIngredient() {
  const select = $('#impactIngredient'); const current = select.value;
  const list = ingredients().sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),'es'));
  select.innerHTML = `<option value="">Seleccionar...</option>${list.map(i=>`<option value="${esc(i.id)}">${esc(i.nombre)}</option>`).join('')}`;
  if (list.some(i=>String(i.id)===current)) select.value=current;
}
function calculateImpact() {
  const id=$('#impactIngredient').value, newPrice=num($('#impactPrice').value);
  if(!id || newPrice<0) return toast('Selecciona un ingrediente y coloca un precio válido.');
  const affected = finalRecipes().map(d=>({dish:d,before:dishMetrics(d),after:dishMetrics(d,null,null,{id,price:newPrice})})).filter(x=>componentsReachItem(x.dish.id,id)).sort((a,b)=>a.after.margin-b.after.margin);
  $('#impactResult').innerHTML = affected.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Plato</th><th>Costo actual</th><th>Costo nuevo</th><th>Margen nuevo</th><th>Precio recomendado</th></tr></thead><tbody>${affected.map(x=>{const s=status(x.after.margin,x.after.price>0);return `<tr><td><strong>${esc(x.dish.nombre)}</strong></td><td>${money(x.before.cost)}</td><td>${money(x.after.cost)}</td><td>${pct(x.after.margin)} <span class="status ${s[0]}">${s[1]}</span></td><td>${money(x.after.recommended)}</td></tr>`;}).join('')}</tbody></table></div>` : empty('Ningún plato activo depende de ese ingrediente.');
}
function componentsReachItem(rootId,targetId){const seen=new Set(); function visit(id){const k=String(id);if(k===String(targetId))return true;if(seen.has(k))return false;seen.add(k);for(const c of componentsFor(k)){if(visit(c.componente_id))return true;}return false;}return visit(rootId);}

function fillDishSelector(){const s=$('#simDish'),current=s.value;const list=finalRecipes().sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),'es'));s.innerHTML=`<option value="">Seleccionar...</option>${list.map(d=>`<option value="${esc(d.id)}">${esc(d.nombre)}</option>`).join('')}`;if(list.some(d=>String(d.id)===current))s.value=current;}
function resetSimulation(){const id=$('#simDish').value;if(!id){state.simulation={itemId:'',price:0,rows:[]};$('#simRows').innerHTML=empty('Selecciona un plato para cargar su receta.');$('#simSummary').innerHTML=empty('Aquí aparecerán costo, margen y precio recomendado.');return;}const dish=itemById(id);const rows=componentsFor(id).map(r=>({componentId:r.componente_id,quantity:num(r.cantidad),unit:r.unidad}));state.simulation={itemId:id,price:priceFor(id),rows};$('#simPrice').value=state.simulation.price||'';renderSimRows();renderSimulationSummary();}
function renderSimRows(){const rows=state.simulation.rows;if(!rows.length){$('#simRows').innerHTML=empty('Esta receta no tiene componentes migrados.');return;}$('#simRows').innerHTML=rows.map((r,idx)=>{const item=itemById(r.componentId);return `<div class="recipe-row"><select data-sim-component="${idx}">${componentOptions(r.componentId)}</select><input data-sim-qty="${idx}" type="number" min="0" step="0.001" value="${esc(r.quantity)}"><input data-sim-unit="${idx}" value="${esc(r.unit)}" readonly><div class="row-meta">${item?esc(itemTypeLabel(item.tipo)):''} · ${item?money(item.costo_unitario):'—'}</div><button class="icon-btn" data-remove-sim="${idx}" title="Quitar">×</button></div>`;}).join('');}
function componentOptions(selected){return `<option value="">Seleccionar...</option>${state.items.filter(i=>i.activo!==false).sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),'es')).map(i=>`<option value="${esc(i.id)}" ${String(i.id)===String(selected)?'selected':''}>${esc(i.nombre)} · ${esc(itemTypeLabel(i.tipo))}</option>`).join('')}`;}
function addSimRow(){state.simulation.rows.push({componentId:ingredients()[0]?.id||'',quantity:1,unit:itemById(ingredients()[0]?.id||'')?.unidad_costeo||'UND'});renderSimRows();renderSimulationSummary();}
function renderSimulationSummary(){const s=state.simulation;if(!s.itemId){$('#simSummary').innerHTML=empty('Selecciona un plato.');return;}const dish=itemById(s.itemId);try{const cost=recipeCost(dish.id,s.rows.map(r=>({componentId:r.componentId,quantity:r.quantity,unit:r.unit})));const price=num($('#simPrice').value);const margin=marginFrom(price,cost);const rec=recommendedPrice(cost);const stat=status(margin,price>0);$('#simSummary').innerHTML=`<div class="summary-main"><div><span>Costo simulado</span><strong>${money(cost)}</strong></div><div><span>Precio de venta</span><strong>${price?money(price):'—'}</strong></div><div><span>Ganancia</span><strong>${price?money((taxRate()?price/(1+taxRate()):price)-cost):'—'}</strong></div><div><span>Margen</span><strong>${price?pct(margin):'—'}</strong></div></div><div class="recommended-box"><span>Precio recomendado para ${pct(marginTarget())}</span><strong>${money(rec)}</strong><span class="status ${stat[0]}">${price?stat[1]:'SIN PRECIO'}</span></div>`;}catch(error){$('#simSummary').innerHTML=`<div class="empty text-red">${esc(error.message)}</div>`;}}

function fillSettings(){$('#cfgRestaurant').value=state.config.nombre_restaurante||'';$('#cfgMargin').value=configNumber('rentabilidad_objetivo_pct',40);$('#cfgTax').value=configNumber('impuesto_venta_pct',0);$('#cfgIndirect').value=configNumber('costo_indirecto_por_plato',0);$('#cfgRound').value=configNumber('redondeo_precio',0.5);}
async function savePrice(id){const input=document.querySelector(`[data-price-id="${CSS.escape(id)}"]`);const price=num(input.value);try{await API.savePrice({item_id:id,precio_venta:price,activo:true});toast('Precio guardado.');await loadData();showView('dishes');}catch(error){showError(error);}}

async function saveSettings(event){event.preventDefault();const entries=[
  {clave:'nombre_restaurante',valor:$('#cfgRestaurant').value,descripcion:'Nombre mostrado en el sistema.'},
  {clave:'rentabilidad_objetivo_pct',valor:num($('#cfgMargin').value),descripcion:'Margen objetivo del plato.'},
  {clave:'impuesto_venta_pct',valor:num($('#cfgTax').value),descripcion:'Impuesto de venta aplicado al precio final.'},
  {clave:'costo_indirecto_por_plato',valor:num($('#cfgIndirect').value),descripcion:'Costo indirecto fijo por plato.'},
  {clave:'redondeo_precio',valor:num($('#cfgRound').value),descripcion:'Múltiplo de redondeo hacia arriba.'}
];try{await API.saveConfig(entries);toast('Configuración guardada.');await loadData();}catch(error){showError(error);}}

async function saveCurrentSimulation(){if(!state.simulation.itemId)return toast('Selecciona un plato.');const dish=itemById(state.simulation.itemId);const price=num($('#simPrice').value);try{const cost=recipeCost(dish.id,state.simulation.rows.map(r=>({componentId:r.componentId,quantity:r.quantity,unit:r.unit})));await API.saveSimulation({item_id:dish.id,item_nombre:dish.nombre,precio_venta:price,costo_total:cost,margen:marginFrom(price,cost),precio_recomendado:recommendedPrice(cost),detalle:{rows:state.simulation.rows}});toast('Simulación guardada.');}catch(error){showError(error);}}

function initEvents(){
  $$('.nav-btn').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
  $('#refreshBtn').addEventListener('click',loadData);
  $('#impactBtn').addEventListener('click',calculateImpact);
  $('#dishSearch').addEventListener('input',renderDishes);
  $('#ingredientSearch').addEventListener('input',renderIngredients);
  $('#recipeSearch').addEventListener('input',renderRecipes);
  $('#settingsForm').addEventListener('submit',saveSettings);
  $('#simDish').addEventListener('change',resetSimulation);
  $('#simPrice').addEventListener('input',renderSimulationSummary);
  $('#addSimRowBtn').addEventListener('click',addSimRow);
  $('#resetSimulationBtn').addEventListener('click',resetSimulation);
  $('#saveSimulationBtn').addEventListener('click',saveCurrentSimulation);
  document.addEventListener('click',e=>{const save=e.target.closest('[data-save-price]');if(save)savePrice(save.dataset.savePrice);const remove=e.target.closest('[data-remove-sim]');if(remove){state.simulation.rows.splice(Number(remove.dataset.removeSim),1);renderSimRows();renderSimulationSummary();}});
  document.addEventListener('input',e=>{if(e.target.matches('[data-sim-qty]')){state.simulation.rows[Number(e.target.dataset.simQty)].quantity=num(e.target.value);renderSimulationSummary();}});
  document.addEventListener('change',e=>{if(e.target.matches('[data-sim-component]')){const idx=Number(e.target.dataset.simComponent);const item=itemById(e.target.value);state.simulation.rows[idx].componentId=e.target.value;state.simulation.rows[idx].unit=item?.unidad_costeo||'UND';renderSimRows();renderSimulationSummary();}});
}

initEvents();
loadData();
