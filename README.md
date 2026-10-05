# Restaurante · Costos y Rentabilidad

Aplicación web para administrar insumos, recetas, costos, margen objetivo y simulaciones de precio/cantidad.

## Arquitectura final

```text
GitHub Pages
  HTML + CSS + JavaScript
          |
          | HTTPS / API
          v
Google Apps Script (Web App)
          |
          v
Google Sheets
```

El frontend está completamente separado de Apps Script. GitHub Pages solo contiene la interfaz. Apps Script funciona como API y Google Sheets como base de datos.

## 1. Crear la base de datos

1. Crea un Google Sheet nuevo.
2. Entra a **Extensiones > Apps Script**.
3. Borra el código existente.
4. Crea/pega el archivo `Code.gs` incluido en esta carpeta.
5. Guarda.

## 2. Inicializar Sheets

En Apps Script, ejecuta una vez:

```text
instalarSistema()
```

Acepta los permisos.

Se crearán:

- CONFIG
- INSUMOS
- PLATOS
- RECETAS
- SIMULACIONES

Para probar con información de ejemplo, ejecuta después:

```text
cargarDatosEjemplo()
```

Hazlo solamente en una hoja vacía.

## 3. Publicar Apps Script como API

En Apps Script:

**Implementar > Nueva implementación > Aplicación web**

Usa:

- Ejecutar como: **tu cuenta**
- Quién tiene acceso: el nivel adecuado para tu equipo

Copia la URL que termina en `/exec`.

## 4. Configurar GitHub Pages

Abre `js/config.js` y cambia:

```javascript
const APP_CONFIG = {
  API_URL: 'PEGA_AQUI_TU_URL_DE_APPS_SCRIPT'
};
```

por tu URL real:

```javascript
const APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/XXXXXXXXXXXX/exec'
};
```

No agregues `/dev`; en producción usa `/exec`.

## 5. Subir a GitHub

Sube toda esta estructura al repositorio:

```text
restaurante-rentabilidad/
├── index.html
├── css/
│   └── styles.css
└── js/
    ├── config.js
    ├── api.js
    └── app.js
```

Después entra a:

**Settings > Pages**

Selecciona el branch que contiene el proyecto y la carpeta `/ (root)`.

GitHub te dará una URL como:

```text
https://TU-USUARIO.github.io/TU-REPOSITORIO/
```

## 6. Regla económica

El sistema usa margen sobre el precio neto:

```text
Precio neto = Costo / (1 - margen objetivo)
```

Con 40%:

```text
Precio neto = Costo / 0.60
```

Si hay impuesto configurado:

```text
Precio final = Precio neto × (1 + impuesto)
```

El redondeo se hace hacia arriba al múltiplo configurado.

## 7. Cómo registrar un insumo

Ejemplo: 50 kg de papa por S/150, recetas expresadas en gramos y 10% de merma.

```text
Unidad compra: kg
Cantidad compra: 50
Unidad base: g
Factor a base: 1000
Precio compra: 150
Merma: 10
```

Cantidad útil:

```text
50 × 1000 × (1 - 0.10) = 45 000 g
```

Costo por gramo:

```text
150 / 45 000 = S/0.003333...
```

## 8. Qué puede hacer la versión

- Dashboard de rentabilidad.
- Alta y edición de insumos.
- Cálculo de costo unitario considerando merma.
- Alta y edición de platos.
- Recetas con cantidades base.
- Cálculo automático de costo y margen.
- Simulador sin modificar la receta real.
- Cambio de cantidades.
- Reemplazo/agregado de insumos.
- Precio recomendado para conservar el margen objetivo.
- Análisis de impacto cuando cambia el precio de un insumo.
- Historial de simulaciones.
- Configuración de margen, impuesto, costo indirecto y redondeo.

## 9. Sobre CORS

El frontend está fuera de Google Apps Script, por lo que la comunicación es cross-origin. `api.js` usa POST con `Content-Type: text/plain` para evitar el preflight de una petición JSON estándar y además tiene un fallback JSONP para las lecturas. Si el navegador sigue bloqueando la escritura, revisa primero que el Web App esté desplegado como `/exec` y con permisos de acceso compatibles con los usuarios del sistema.

## 10. Seguridad

Esta es una primera versión/MVP. Si el sistema va a manejar información sensible o tendrá varios usuarios con roles, el siguiente paso recomendado es añadir autenticación, control de acceso y auditoría. No pongas secretos reales en `js/config.js` porque GitHub Pages es frontend público.
