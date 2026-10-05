const API = (() => {
  const url = () => {
    const value = String(APP_CONFIG.API_URL || '').trim();
    if (!value || value.includes('PEGA_AQUI')) {
      throw new Error('Configura API_URL en js/config.js con la URL /exec de Apps Script.');
    }
    return value;
  };

  async function get(action) {
    const response = await fetch(`${url()}?action=${encodeURIComponent(action)}&t=${Date.now()}`, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.success && data.error) throw new Error(data.error);
    return data;
  }

  async function post(action, data = {}) {
    // text/plain evita un preflight OPTIONS en navegadores que traten la petición como CORS simple.
    const body = JSON.stringify({ action, ...data });
    const response = await fetch(url(), {
      method: 'POST',
      redirect: 'follow',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (!result.success && result.error) throw new Error(result.error);
    return result;
  }

  // Fallback de lectura JSONP para entornos donde fetch hacia Apps Script sea bloqueado por CORS.
  function getJSONP(action) {
    return new Promise((resolve, reject) => {
      const callbackName = `__restaurant_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement('script');
      const cleanup = () => {
        delete window[callbackName];
        script.remove();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Tiempo de espera agotado con Apps Script.'));
      }, 15000);

      window[callbackName] = data => {
        clearTimeout(timer);
        cleanup();
        if (!data?.success && data?.error) reject(new Error(data.error));
        else resolve(data);
      };
      script.onerror = () => {
        clearTimeout(timer);
        cleanup();
        reject(new Error('No se pudo conectar con Apps Script.'));
      };
      script.src = `${url()}?action=${encodeURIComponent(action)}&callback=${encodeURIComponent(callbackName)}&t=${Date.now()}`;
      document.body.appendChild(script);
    });
  }

  return {
    bootstrap: async () => {
      try { return await get('bootstrap'); }
      catch (error) { return await getJSONP('bootstrap'); }
    },
    post
  };
})();
