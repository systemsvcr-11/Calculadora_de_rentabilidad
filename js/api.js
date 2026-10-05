(function () {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const API_URL = String(cfg.API_URL || '').trim();

  function ensureUrl() {
    if (!API_URL || API_URL.includes('PEGA_AQUI')) {
      throw new Error('Configura la URL de Apps Script en js/config.js');
    }
    return API_URL;
  }

  async function get(action, extra = {}) {
    const url = ensureUrl();
    const params = new URLSearchParams({ action, ...extra, _: Date.now().toString() });
    const response = await fetch(`${url}?${params.toString()}`, { method: 'GET', cache: 'no-store' });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { throw new Error('Respuesta inválida de Apps Script.'); }
    if (!data.success) throw new Error(data.error || 'Error de API.');
    return data;
  }

  function getJSONP(action) {
    return new Promise((resolve, reject) => {
      const url = ensureUrl();
      const callback = `rrcb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement('script');
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Tiempo de espera agotado con Apps Script.')); }, 15000);
      const cleanup = () => { clearTimeout(timeout); delete window[callback]; script.remove(); };
      window[callback] = data => { cleanup(); data?.success ? resolve(data) : reject(new Error(data?.error || 'Error de API.')); };
      script.onerror = () => { cleanup(); reject(new Error('No se pudo conectar con Apps Script.')); };
      script.src = `${url}?action=${encodeURIComponent(action)}&callback=${encodeURIComponent(callback)}&_=${Date.now()}`;
      document.body.appendChild(script);
    });
  }

  async function post(action, data = {}) {
    const url = ensureUrl();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...data })
    });
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch (_) { throw new Error('Respuesta inválida de Apps Script.'); }
    if (!result.success) throw new Error(result.error || 'Error de API.');
    return result;
  }

  window.API = {
    bootstrap: async () => {
      try { return await get('model_bootstrap'); }
      catch (error) { return await getJSONP('model_bootstrap'); }
    },
    health: async () => {
      try { return await get('health'); } catch (error) { return await getJSONP('health'); }
    },
    savePrice: data => post('save_item_price', data),
    saveConfig: entries => post('save_config', { entries }),
    saveSimulation: data => post('save_model_simulation', { data })
  };
})();
