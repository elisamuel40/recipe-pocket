# Publicar Recipe Pocket en la Chrome Web Store

**Siguiente paso:** abre la [consola de desarrollador](https://chrome.google.com/webstore/devconsole) y crea tu cuenta (paso 1).

Todo lo demás está listo: el texto para copiar está en [`listing.md`](listing.md) y las imágenes, en [`assets/`](assets/).

**Dónde me quedé:** marca aquí el último paso terminado: ________

**Estacionamiento de ideas:** anótalas aquí y sigue con el paso: ________

## Hoy (45 minutos o menos cada uno)

- [ ] **1. Crear la cuenta de desarrollador.** Energía: baja.
  - Abre la consola y elige el correo con cuidado: no se puede cambiar después.
  - Acepta el acuerdo y paga la cuota única. La consola muestra el monto.
  - **Terminado cuando:** ves el panel de la consola, sin la pantalla de registro.
- [ ] **2. Probar en tu Chrome.** Energía: alta.
  - Carga la extensión y ábrela en Smitten Kitchen, Joshua Weissman y los 6 sitios que bloquean las pruebas automáticas (lista en [`qa/REPORT.md`](../qa/REPORT.md)).
  - Compara cada ingrediente y paso con la página. Prueba imprimir en A4 y Letter.
  - **Terminado cuando:** anotaste cada sitio como bien, mal o bloqueado.
- [ ] **3. Subir y enviar a revisión.** Energía: baja.
  - Baja el [ZIP](https://github.com/elisamuel40/recipe-pocket/releases/latest/download/recipe-pocket.zip) y súbelo en **Add new item**.
  - Copia cada campo de [`listing.md`](listing.md) y sube las imágenes.
  - Haz clic en **Submit for review**.
  - **Terminado cuando:** el estado dice que está en revisión.

<details>
<summary>Después de la aprobación</summary>

- [ ] **4. Activar el botón "Add to Chrome".** Energía: baja.
  - Pega el enlace de la tienda en `chrome_store_url`, en `docs/_config.yml`, y publica en `main`.
  - **Terminado cuando:** el sitio muestra **Add to Chrome** y ya no muestra los pasos de developer mode.
- [ ] **5. Actualizar `README.md`.** Energía: baja.
  - Pon el enlace de la tienda como primera opción de instalación.
  - **Terminado cuando:** el enlace abre la ficha de la tienda.

</details>

<details>
<summary>Antes de enviar, decide esto tú</summary>

- **Nombre:** "Recipe Pocket" sigue siendo provisional. Una búsqueda rápida no encontró otro producto con ese nombre exacto, pero eso no es una revisión de marca. Busca el nombre en [USPTO](https://tmsearch.uspto.gov/) antes de enviar.
- **Revisión legal:** nadie ha revisado legalmente `docs/privacy.md` ni `docs/terms.md`.
- **Correo público:** la consola puede mostrar tu correo en la ficha de la tienda.

</details>

<details>
<summary>Publicar una actualización más adelante</summary>

1. Publica la versión nueva con una etiqueta, como indica [`RELEASE.md`](../RELEASE.md).
2. En la consola, abre **Package**, sube el ZIP nuevo y envíalo a revisión.

Si cambias la interfaz, ejecuta `npm run store:assets` para regenerar las imágenes.

</details>
