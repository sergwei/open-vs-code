# OpenCode Station

[English](https://github.com/sergwei/open-vs-code/blob/main/README.md) | **Español**

Interfaz gráfica no oficial de opencode para Visual Studio Code.

Un chat para usar [opencode](https://github.com/anomalyco/opencode) con el ratón sin salir de VS
Code, al estilo de la extensión de Claude Code. Así no dependes de lo que dé de sí la terminal
(muchas terminales de Linux y macOS no admiten ratón). La extensión es un **cliente de
`opencode serve`**, no un envoltorio de la interfaz de terminal: arranca el servidor para tu espacio
de trabajo y habla con él por HTTP. No tiene relación con opencode ni con Microsoft.

![Pestaña de chat con una respuesta que lleva un bloque de código TypeScript y otro de bash (cada uno con botones para copiar, insertar y abrir en un archivo nuevo), una tabla, una lista y código en línea](https://raw.githubusercontent.com/sergwei/open-vs-code/main/docs/images/chat-markdown.png)

![Pestaña de chat en la que leer .env está pendiente de aprobación: sobre el cuadro del prompt hay una tarjeta de permiso con botones para permitir una vez, permitir siempre, rechazar y rechazar con comentarios](https://raw.githubusercontent.com/sergwei/open-vs-code/main/docs/images/permission-card.png)

> **Solo funciona con opencode v2** (versión mayor 2, probada con la 2.2.7). La rama 1.x
> (`opencode-ai`) no sirve para esta extensión.

## Requisitos

- VS Code 1.105 o posterior.
- opencode **v2** instalado en la misma máquina que VS Code:
  - npm: `npm i -g @opencode/cli`. Con npm 11 el script de instalación se bloquea y el binario no
    llega a crearse; en ese caso usa `npm i -g --allow-scripts=@opencode/cli @opencode/cli`.
  - Homebrew: `brew install anomalyco/tap/opencode-v2`.
- Un proveedor y un modelo configurados en opencode. ¿Todavía no tienes ninguno? Abre la pestaña
  **Configuración de OpenCode**, entra en **Proveedores**, pulsa **+ Agregar proveedor** y elige uno
  (con clave de API o iniciando sesión).

## Instalación

Busca **OpenCode Station** en la vista de Extensiones de VS Code o instálala desde el
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=sergwei.open-vs-code).
En los editores que tiran de [Open VSX](https://open-vsx.org/extension/sergwei/open-vs-code)
(VSCodium, Cursor y otros) está con el mismo nombre. Si prefieres compilar tú el `.vsix` a partir
del código fuente (hacen falta Node 24 y git), mira
[Building the .vsix](https://github.com/sergwei/open-vs-code/blob/main/docs/features.md#building-the-vsix-from-source)
(en inglés).

## Inicio rápido

1. Abre una carpeta y pulsa el icono **OpenCode** de la barra de actividad. La extensión arranca
   `opencode serve` para esa carpeta (en `127.0.0.1`, con puerto y contraseña aleatorios) y lo para
   cuando cierras la ventana.
2. Pulsa **Nueva sesión** arriba de la vista **Inicio rápido** (o en la vista **Sesiones** cuando
   está vacía) y se abre una pestaña de chat al lado de tu código. Escribe y pulsa Intro; para
   interrumpir un turno, Escape o **Detener**. Con `Ctrl+Alt+P` (`Cmd+Alt+P` en macOS) saltas al
   prompt y vuelves al editor.
3. Si quieres preguntar por un trozo de código sin abrir el chat, selecciónalo, haz clic derecho y
   elige **Explicar con OpenCode** o **Corregir con OpenCode** (o **Agregar al chat de OpenCode**).
   En el Explorador, el clic derecho sobre un archivo te deja explicarlo o adjuntarlo.

## Qué incluye

Todo lo de esta lista está explicado a fondo en
[Features and usage in detail](https://github.com/sergwei/open-vs-code/blob/main/docs/features.md)
(en inglés).

- **Chat** con Markdown en streaming, resaltado de sintaxis, acciones sobre el código, tarjetas de
  herramientas plegables con su diff y una línea con el contexto y el coste (con **Compactar** cuando
  pasas del 80 % de la ventana).
- **Chat en pestañas o en la barra lateral** (`openVsCode.chatLocation`): por defecto, una pestaña
  del editor por sesión; si lo prefieres, un único chat en la barra lateral. Las pestañas siguen ahí
  después de recargar la ventana.
- Árbol de **Sesiones**: agrupadas por fecha, con búsqueda, renombrar, eliminar, bifurcar desde
  cualquier mensaje, carpetas, anclados, archivados, filtros y una sección "Requiere atención". Las
  sesiones de los subagentes se abren desde la sesión que los lanzó.
- Caja **Inicio rápido** arriba del todo: abres una pestaña de chat nueva con el modelo que elijas,
  ves qué se está ejecutando y qué espera tu respuesta, y compruebas cómo están el servidor y los
  servidores MCP. Su barra, siempre a la vista, tiene **Nueva sesión** y un engranaje que abre la
  pestaña Configuración de OpenCode. Debajo del árbol, **Cambios de las sesiones** (un clic abre el
  diff de VS Code) y **Uso (todos los proyectos)** (coste y tokens, de hoy y de 7 días).
- **Permisos y preguntas** en tarjetas que contestas con un clic, con notificación e insignia si el
  chat no está a la vista. Si hay varias peticiones, comparten una caja y cada una tiene su pestaña.
- **Modo de trabajo** (Manual / Auto) por sesión: en Auto se contesta "permitir una vez" por ti,
  menos cuando hay secretos de por medio o se trata de salir del proyecto, borrar, publicar o lanzar
  comandos destructivos (es una heurística, no una garantía).
- **Chip de agente y modelo**, variantes de razonamiento, comandos `/` (los de opencode, los de tu
  proyecto y los de MCP), menciones con `@` y un menú "+" para adjuntar la selección, archivos e
  imágenes.
- **Adjuntar y soltar:** clic derecho en el Explorador, arrastrar con Mayús (en el chat de la barra
  lateral) o pegar imágenes (PNG, JPEG, GIF, WebP, hasta 10 MiB).
- **Escribe mientras el agente trabaja:** Intro deja el mensaje en cola y `Ctrl+Intro`
  (`Cmd+Intro`) redirige el turno. Un **monitor de subagentes** los lista con Abrir, Responder y
  Detener.
- **Pestaña Sesión:** instrucciones fijadas, medidor de contexto, totales, subagentes y **Exportar**
  (a Markdown o JSON).
- **Archivos modificados y vuelta atrás:** la pestaña **Cambios** abre el diff de VS Code; "Revertir
  desde aquí" deshace un turno, archivos incluidos, y luego puedes restaurarlo.
- Pestaña **Configuración de OpenCode**: proveedores (clave de API, OAuth), servidores MCP, mods,
  modo de trabajo y opciones avanzadas. Los **mods** son JavaScript tuyo, que solo se carga desde tu
  carpeta de usuario; tienes los detalles en
  [mods](https://github.com/sergwei/open-vs-code/blob/main/docs/mods.md) (en inglés).
- Temas claro, oscuro y de alto contraste, navegación con teclado y etiquetas para lectores de
  pantalla. La interfaz está en inglés y en español, según el idioma de VS Code (para verla en
  español necesitas el
  [Spanish Language Pack](https://marketplace.visualstudio.com/items?itemName=MS-CEINTL.vscode-language-pack-es)).
  En la barra de estado hay un indicador de cómo está el servidor.

## Configuración

Busca "OpenCode" en Configuración. Estas son las opciones que más se tocan:

| Opción | Por defecto | Qué hace |
| --- | --- | --- |
| `openVsCode.chatLocation` | `editor` | `editor`: una pestaña de chat por sesión. `sidebar`: un único chat en la barra lateral. |
| `openVsCode.defaultModel` | vacío | Modelo de las sesiones nuevas, con el formato `provider/model`. |
| `openVsCode.opencodePath` | vacío | Ruta del ejecutable de opencode v2, si no está en el `PATH`. |
| `openVsCode.serverUrl` | vacío | Usa un servidor de opencode v2 que ya esté en marcha en esta máquina. |
| `openVsCode.autoStart` | `true` | Arranca el servidor al abrir la ventana. |

`openVsCode.mods.enabled`, el resto de opciones, todos los comandos y los atajos de teclado están en
[Settings, commands and shortcuts](https://github.com/sergwei/open-vs-code/blob/main/docs/commands.md)
(en inglés).

## Limitaciones principales

- Solo opencode v2, y solo un servidor en la máquina local.
- Las carpetas, los anclados y los archivados del árbol de Sesiones se guardan en el almacenamiento
  del espacio de trabajo de VS Code, no en opencode: si mueves, renombras o vuelves a clonar la
  carpeta del proyecto, los pierdes.
- Hay avisos de que arrastrar archivos del Explorador al chat no funciona en VS Code 1.140 o
  posterior; **Agregar al chat de OpenCode**, Adjuntar y las menciones con `@` funcionan siempre.
- Los atajos por defecto usan Ctrl+Alt, que en Windows equivale a AltGr: cámbialos si chocan con tu
  distribución de teclado.
- Está probada sobre todo en Windows; la integración continua compila y pasa los tests en Windows,
  macOS y Linux.

La lista completa está en
[Known limitations](https://github.com/sergwei/open-vs-code/blob/main/docs/limitations.md) (en
inglés).

## Privacidad y seguridad

La extensión no funciona en espacios de trabajo que no sean de confianza, porque opencode puede
ejecutar lo que defina el proyecto. Como opencode también ejecuta los plugins que traiga un
proyecto, la extensión te pregunta antes de arrancarlo en una carpeta que los tenga. La vista del
chat nunca habla con el servidor: el puerto y las contraseñas no salen del extension host (las
contraseñas, en SecretStorage) y no se envía nada a ningún sitio que no sea el servidor de opencode
que uses. Más detalles en
[Privacy and security](https://github.com/sergwei/open-vs-code/blob/main/docs/privacy.md) (en
inglés).

## Licencia

[PolyForm Shield License 1.0.0](https://github.com/sergwei/open-vs-code/blob/main/LICENSE). Puedes
usar, modificar y compartir la extensión para lo que quieras, también en el trabajo. Lo único que no
puedes hacer es ofrecer un producto que compita con ella (o con un producto que su autor ofrezca
usándola): no vale publicar una copia o un fork con otro nombre como alternativa a esta extensión,
ni siquiera gratis, y eso no cambia aunque el autor deje de ofrecerla. Si le pasas una copia a
alguien, tiene que recibir también los términos de la licencia (o su URL) y la línea
`Required Notice:`. Por eso es una extensión de código disponible (source-available), no de código
abierto según la definición de la OSI. Los commits anteriores al cambio de licencia se publicaron
con licencia MIT.

opencode es un proyecto aparte, de [anomalyco](https://github.com/anomalyco/opencode), con su
propia licencia.
