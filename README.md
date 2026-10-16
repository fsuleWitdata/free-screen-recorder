# Free Screen Recorder

Extensión de Chrome para grabar pantalla, ventana o pestaña **sin límite de duración**, con el audio del sistema y el micrófono sincronizados. Guarda en MP4 (o WebM) en tu computadora y, si querés, lo sube a tu propio Google Drive.

- Sin cuentas, sin nube propia, sin límites de tiempo ni de cantidad de videos.
- Todo ocurre en tu navegador: no hay servidores intermedios ni telemetría.
- Grabaciones de 40, 60 minutos o más: el video se escribe en el disco mientras grabás, no se acumula en memoria.

## Funciones

- **Qué grabar:** pantalla completa, ventana o pestaña actual.
- **Resolución:** 720p, 1080p o 4K (hasta la resolución real de lo que compartís).
- **Formato:** MP4 (H.264 + AAC) por defecto, o WebM. Calidad baja, media o alta.
- **Audio:** sistema/pestaña y/o micrófono, mezclados en una sola pista sincronizada con el video. Medidor de nivel del micrófono antes de grabar.
- **Cuenta regresiva** 3-2-1 y **contador de tiempo** en el ícono de la extensión.
- **Barra flotante** en la página con pausa y detener (opcional).
- **Pausa y reanudar.**
- **Al terminar** se abre el panel para ponerle nombre y elegir destino: tu computadora (con "Guardar como", en la carpeta que quieras), Google Drive, o ambos. Podés liberar la copia temporal automáticamente.

## Instalación

Requiere Google Chrome (o Chromium) versión 126 o superior.

1. Descargá el código: botón verde **Code → Download ZIP** en esta página, y descomprimilo donde prefieras. O clonalo:
   ```bash
   git clone https://github.com/fsuleWitdata/free-screen-recorder.git
   ```
2. Abrí `chrome://extensions` en Chrome.
3. Activá **Modo de desarrollador** (arriba a la derecha).
4. Clic en **Cargar descomprimida** y elegí la carpeta del proyecto (la que contiene `manifest.json`).
5. Fijá la extensión con el ícono de puzzle de Chrome para tenerla a mano.

No muevas ni borres la carpeta después de instalar: Chrome la lee desde ahí. Para actualizar, reemplazá los archivos y apretá el botón de recargar en `chrome://extensions`.

Chrome mostrará una advertencia por el permiso de acceso a los sitios: se usa únicamente para mostrar la barra flotante en la página que grabás.

## Uso

1. Clic en el ícono de la extensión.
2. Elegí **Qué grabar** (pantalla/ventana o pestaña actual), resolución, formato y calidad.
3. Activá **Audio del sistema / pestaña** y/o **Micrófono**. La barra verde debe moverse cuando hablás. La primera vez, aceptá el permiso de micrófono.
4. **● Iniciar grabación**. En modo pantalla, elegí qué compartir y marcá **Compartir audio** en el diálogo de Chrome.
5. Pausá o detené desde la barra flotante o desde el ícono. En modo pantalla, no cierres la ventana minimizada de la grabación.
6. Al detener se abre el panel **Grabación lista**: poné un nombre, elegí dónde guardarla y tocá **Guardar**.

Notas:
- En Windows, el audio del sistema solo se captura al compartir una pestaña o la pantalla completa; con una ventana suelta Chrome no lo ofrece.
- No se puede grabar páginas internas de Chrome (`chrome://…`) en modo pestaña; usá modo pantalla.
- Mientras grabás, el archivo es temporal y vive en el almacenamiento de la extensión. Si cerrás Chrome antes de guardar, la grabación sigue ahí la próxima vez que abras el panel. **Descartar** la borra.

## Conectar Google Drive (opcional)

Cada persona usa su **propio Client ID** de Google Cloud (gratis). La extensión no trae ninguno incluido y solo pide el permiso `drive.file`: ve únicamente los archivos que ella misma sube, nunca el resto de tu Drive.

1. Entrá a <https://console.cloud.google.com> y creá un proyecto.
2. **APIs y servicios → Biblioteca** → habilitá **Google Drive API**.
3. **Pantalla de consentimiento de OAuth**: tipo *Externo* (o *Interno* si es una cuenta de Workspace que lo permite), completá nombre y correo, y agregá tu correo en **Usuarios de prueba**.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth** → tipo **Aplicación web**.
5. En **URI de redireccionamiento autorizados** agregá exactamente el que muestra la extensión en *Google Drive (configuración)*. Como el ID de la extensión es fijo, siempre es:
   ```
   https://gocagjfejgoceoblhjdnapedjmmdpapa.chromiumapp.org/
   ```
6. Copiá el **ID de cliente** (`xxxx.apps.googleusercontent.com`), pegalo en la extensión y tocá **Guardar y probar conexión**.

Si Google muestra "app no verificada", es normal en proyectos propios: *Avanzado → Ir a (nombre de la app)*.

## Problemas frecuentes

| Síntoma | Solución |
|---|---|
| No se escucha el sistema | Compartí pantalla completa o una pestaña y marcá "Compartir audio". |
| Micrófono sin nivel | Elegí otro micrófono en la lista y permití el acceso cuando Chrome lo pida. |
| Se guarda en WebM | Tu Chrome no soporta MP4 nativo: actualizalo (126 o superior). |
| `redirect_uri_mismatch` en Drive | El URI cargado en Google Cloud no coincide: copialo desde la extensión. |
| `access_denied` en Drive | Agregá tu correo como usuario de prueba. |
| 4K se ve a menor resolución | Tu pantalla o ventana no es 4K: es el máximo real. |

## Estructura del proyecto

| Archivo | Para qué sirve |
|---|---|
| `manifest.json` | Definición de la extensión (Manifest V3). |
| `popup.html` / `popup.js` / `ui.css` | Panel desplegable. |
| `background.js` | Service worker: coordina todo, ícono, barra flotante y entrega. |
| `capture.html` / `capture.js` | Ventana de captura de pantalla (se minimiza sola). |
| `offscreen.html` / `offscreen.js` | Documento oculto: graba la pestaña, guarda y sube a Drive. |
| `recorder-core.js` | Motor de grabación (audio mezclado y sincronizado, escritura a disco). |
| `mic.html` / `mic.js` | Ventanita auxiliar para pedir el permiso de micrófono si hace falta. |

No hay dependencias ni paso de compilación: son archivos JavaScript puros.

## Privacidad

Las grabaciones no salen de tu computadora salvo que vos elijas subirlas a tu Drive. No hay analítica ni envío de datos a terceros.

## Licencia

[MIT](LICENSE)
