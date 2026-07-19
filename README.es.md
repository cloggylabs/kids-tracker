# Crece 🌱

[English](README.md) · **Español**

App para seguir el crecimiento de tus hijos: peso, talla y fotos del avance.
Es una **PWA** (aplicación web instalable): se agrega a la pantalla de inicio del
iPhone y se ve como app nativa, **sin pasar por el App Store**.

**Todos los datos viven únicamente en el dispositivo** (IndexedDB). Nada se
envía a ningún servidor.

## Funciones

- Varios perfiles (un chip por cada peque, con emoji).
- Registros de peso y talla con fecha, nota y foto opcional; muestra la edad en
  cada registro y el cambio respecto al registro anterior.
- Gráficas de peso y talla a lo largo del tiempo, con tooltip al tocar y tabla
  de datos. Modo claro y oscuro automático.
- Galería de fotos ordenada por edad.
- Respaldo: exporta/importa todo (perfiles, registros y fotos) en un archivo
  JSON que puedes guardar en iCloud o Archivos.
- Funciona sin conexión (service worker) cuando se sirve por HTTPS.

## Probarla en la Mac

```sh
cd kids-tracker
python3 -m http.server 8000
```

Abre <http://localhost:8000>. Para ver datos de ejemplo sin crear un perfil,
abre <http://localhost:8000/#demo> (o `#demo/graficas`, `#demo/fotos`).

## Usarla en el iPhone

### Opción A — Servida desde tu Mac (misma red WiFi)

1. En la Mac: `python3 -m http.server 8000 --bind 0.0.0.0`
2. Averigua la IP de tu Mac: `ipconfig getifaddr en0`
3. En Safari del iPhone abre `http://<ip-de-tu-mac>:8000`
4. Botón **Compartir → Agregar a pantalla de inicio**.

Los datos se guardan en el iPhone, pero como es `http` (no HTTPS) el modo sin
conexión no funciona: la app necesita que la Mac esté sirviendo para *abrirse*
(los datos no se pierden, solo la carga inicial la sirve la Mac).

### Opción B — GitHub Pages (recomendada para el día a día)

Sube este repo a GitHub y activa Pages. Al servirse por HTTPS el service worker
sí se registra: la app **funciona 100 % sin conexión** después de la primera
carga, y tus datos siguen guardándose solo en el teléfono (la página es
estática, no hay servidor que reciba nada). Luego en Safari:
**Compartir → Agregar a pantalla de inicio**.

## Consejos

- Haz un **respaldo** (Ajustes → Exportar) de vez en cuando: iOS puede borrar
  datos de sitios web que no se visitan en mucho tiempo. La app pide
  almacenamiento persistente, pero el respaldo es la red de seguridad.
- Las fotos se reducen a máx. 1280 px y se comprimen a JPEG para no llenar el
  teléfono.

## ☕ Apoya el proyecto

Esta app es gratuita y sin anuncios. Si te sirve, puedes dejar una propina
voluntaria escaneando este QR con tu app de pagos (Bre-B / Nequi), o usando la
llave `@NEQUIJOS86891`:

<img src="donate-qr.jpg" alt="QR Bre-B / Nequi — @NEQUIJOS86891" width="260">

## Estructura

| Archivo | Qué es |
|---|---|
| `index.html` | Estructura de la app (vistas, diálogos) |
| `styles.css` | Estilos, tokens de color claro/oscuro |
| `app.js` | Lógica: IndexedDB, registros, gráficas SVG, respaldo |
| `sw.js` | Service worker (caché para funcionar offline) |
| `manifest.webmanifest` | Manifiesto PWA (nombre, íconos, standalone) |
| `icons/` | Íconos de la app |
