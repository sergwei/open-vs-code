# Changelog

All notable changes to this project are documented in this file, in English and in Spanish.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Under each version heading
there is an `### English` block followed by an `### Español` block, each with its own Added,
Changed or Fixed lists (the Spanish ones are named Añadido, Cambiado and Corregido). Older entries
were condensed when the Spanish version was added: every user-visible change is still listed.

Todos los cambios relevantes de este proyecto se documentan en este archivo, en inglés y en español.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y este proyecto
sigue el [Versionado Semántico](https://semver.org/lang/es/). Bajo el encabezado de cada versión hay
un bloque `### English` seguido de un bloque `### Español`, cada uno con sus propias listas de
Added, Changed o Fixed (en español: Añadido, Cambiado y Corregido). Las entradas antiguas se
condensaron al añadir la versión en español: todos los cambios visibles para el usuario siguen
listados.

## [Unreleased]

### English

#### Fixed

- Clicking a `~/…` file path in the chat now opens the file when it is inside the workspace folder
  (outside it, the path stays refused). Before, the path was not expanded and failed with "does not
  exist" (seen on macOS). When a file cannot be found, the **OpenCode** output channel now logs the
  path that was tried, truncated (issue #228, PR #229).

### Español

#### Corregido

- Al hacer clic en una ruta de archivo `~/…` del chat, ahora se abre el archivo si está dentro de la
  carpeta del espacio de trabajo (fuera de ella, la ruta sigue rechazada). Antes la ruta no se
  expandía y fallaba con "does not exist" (visto en macOS). Cuando no se encuentra un archivo, el
  canal de salida **OpenCode** registra ahora la ruta que se intentó, truncada (issue #228, PR
  #229).

## [1.1.0] - 2026-11-13

### English

A sidebar home, tabs in the chat panel, a redesigned Settings tab, a subagent monitor and a
Manual/Auto work mode.

#### Added

- **A sidebar home** (with `chatLocation` set to `editor`). **Quick start**, above the Sessions
  tree, is a small box: type and press Enter to open a new chat tab that starts the conversation.
  Its model pill opens a picker (grouped by provider, searchable) for the model of the next
  conversation; it lasts until you pick another or reload the window and does not touch
  `openVsCode.defaultModel`. A status strip shows the model, the mode of the next conversation, any
  MCP server in error and, only while it is not ready, the server. **Running** lists the root
  sessions that run now with their activity, a clock and **Stop**, which also stops their
  subagents; **Waiting for you** lists permissions and questions, and Reply opens the conversation
  with the card focused. Under the Sessions tree, **Changes of the sessions** lists the files each
  session changed (click one for VS Code's diff), and **Usage (all projects)** shows cost and
  tokens for today and the last 7 days by model, for every project in your opencode database. New
  title-bar buttons **OpenCode: Refresh Changes** and **OpenCode: Refresh Usage**. The usage route
  is experimental in opencode, so a newer opencode may change it.
- **A redesigned Settings tab.** A header with search and four clickable status cards (server,
  providers, default model, MCP servers), and side sections: General (chat location, automatic
  start), Providers (compact rows and an Add provider picker), Models (the default model), MCP
  servers, Mods (a switch per mod, Reload and Open folder), Work mode and Advanced (the server
  password, the saved permissions, the plugin decision of the folder). Below 600 px the sections
  fold into a strip.
- **Connect, disconnect and sign in to MCP servers** from Settings (they were read only). The
  change lasts until opencode restarts.
- **Subagent monitor.** While a subagent works or waits, a strip above the prompt box reads
  "Subagents · N"; open it for one row per subagent (agent, task, current tool, elapsed time) with
  Open, Answer, Stop and a **Stop all** that never stops the main turn. In the conversation, each
  subagent call becomes a live card that folds into "Finished", "Stopped" or "Failed" when it ends.
- **Chat, Changes and Session tabs in the chat panel.** A row of tabs under the header switches the
  central area; the request cards, the subagent strip, the activity line and the prompt box stay in
  all three. **Changes** holds the files the session changed (moved out of the header). **Session**
  holds pinned instructions, a context meter with Compact, token and cost totals, the session's
  subagents with Open, and **Export** to Markdown or JSON (the JSON holds the full text and file
  paths). The context line under the title gains a **Compact** button from 80 % of the window.
- **Write while the agent works.** During a turn Enter queues the message (a "Queued: …" chip with
  Steer now, Edit and remove) and Ctrl+Enter (Cmd+Enter on macOS) steers the turn with it right
  away. Stop moved to the activity line at the bottom, which now says what the agent is doing, the
  step, the elapsed time and how many subagents run.
- **Pinned instructions per session** ("Always answer in Galician"), sent by opencode with every
  step. They and Export use opencode's experimental API, so a newer opencode may change them.
- **The shell of opencode in Settings › Advanced.** A drop-down with Automatic and the shells the
  server offers (the ones opencode only accepts for the terminal are marked). It is saved in your
  global opencode config, so it also applies to the terminal UI and every folder; a hint says when
  another config (the folder's or your organization's) sets its own shell and hides the choice.
- **A switch per mod.** A puzzle-piece button after **+** and **/** in the prompt bar (with the
  number of active mods) opens a popover listing the mods with one switch each. A switch starts or
  stops only that mod: the others keep their state, bands and open panels. The choice is saved for
  the workspace (the list of mods you turned off), survives Reload Mods and reloading the window,
  and a new mod starts on. With no folder open it lasts until the window closes. With
  `openVsCode.mods.enabled` off the popover still lists the mods, with the switches disabled and an
  **Open Settings** button. **Manage Mods** shows the mods that are off.
- **Work mode (Manual / Auto)**: a pill left of Send in the prompt bar (person icon and
  **Manual**, bolt and **Auto**; only the icon under 200 px) chooses, per session, who answers
  opencode's permission requests. **Manual** changes nothing: the card appears whenever opencode's
  rules ask. In **Auto** the extension answers "once" for you (never "always"), also for the
  session's subagents and for the requests already on screen, and the history says **Allowed
  automatically**. Auto does not approve for you what it **recognises** as reading a secret (`.env`
  files, SSH keys, certificates, `credentials*.json`, `.npmrc`, `.kube/config`…, also when a shell
  command names one), going outside the project (`external_directory`), deleting or moving files
  (a patch that deletes or moves, an `edit` of an unknown shape) or publishing or pushing. Those
  keep the usual card. For shell commands the check is a **heuristic blacklist by family, not a
  guarantee**: it asks for deleters and overwriters (`rm`, `mv`, `cp`, `>`, `tee`), every `git
  push` and the git options that run a command, publishing (`npm publish`, `docker push`, `gh pr
  merge`…), infrastructure and cloud destructives (`kubectl delete`, `terraform destroy`,
  `docker run|exec`…), shells and interpreters fed by stdin or inline code, launchers (`npx`,
  `pnpm exec`, `uv run`, `dnx`, `asdf env`, `wsl`, `ssh`…) classified by what they run (they also
  ask for the options that change where the package comes from, such as `uvx --index` and `npx
  --registry`, and for `uvx --env-file`), `mise env` (it prints secrets), SQL clients, copies to
  another machine (`scp`, `rsync host:`, `sftp`) and publishing through `gh` (`repo create
  --push`, `workflow run`…), an unquoted glob or `$` in a word, a backslash in a command name or one
  that is a POSIX escape (`git pu\sh`; Windows paths such as `src\app.ts` are fine), environment
  variables that configure what runs (`GIT_*`, `PAGER`, `LD_*`, also through `export`;
  `GIT_EDITOR=true` and a few like it pass), uploads to the cloud (`aws s3 sync . s3://b`, `gcloud
  storage cp … gs://`, `az storage blob upload`, `azcopy`; downloads pass), framework database
  resets (`rails db:drop`, `php artisan migrate:fresh`, `manage.py flush`, `dotnet ef database
  drop`…) and, because in Windows a leading dot hides nothing, a recursive listing (`Get-ChildItem
  -Recurse`, `dir /s`, `ls -R`) unless it lists only names (`-Name`, `-Directory`, `dir /b`), and
  deployments (`vercel --prod`, `firebase deploy`,
  `fly deploy`, `wrangler deploy`, `cdk deploy`, `sam deploy`, `kubectl apply`…). Known limits: it
  classifies one simple command by its text, so it does not know the value-taking options of every
  launcher (`bunx --cwd src tool`), reads `%VAR%` only in capitals, does not look at `--import`
  after `node --test`, and `ls -R` also asks in bash. What it does **not** see is approved: tools
  it does not name (`fd -X rm`, `trash`, `rclone`, `gsutil rm` through an alias…), an alias you
  configured (`git p` for `git push`), what a script does (`bash build.sh`, `npm run clean`) and
  any tool that is not named in its list; reviews keep finding more of those. The agent's own
  questions still reach you. The mode lives in the extension host's memory: a new
  session and a reload start in Manual. New command **OpenCode: Toggle Work Mode** (no default
  shortcut). Auto only answers what opencode asks: what its configuration allows without asking
  runs the same in both modes.

#### Changed

- **Built and tested against opencode 2.2.7** (was 2.0.32): the `@opencode/client` pin and the
  recommended CLI move together. Calls to the experimental routes (usage stats, MCP connect and
  disconnect) now use the `client.experimental.*` methods.
- **Several pending requests share one box.** Instead of stacking one card on top of another, the
  permissions and questions the agent is waiting on sit in a single box with a tab per request
  (icon and name, the active one underlined, "1 of 3" on the right) and only the active request
  below. The tab names always show whole; if they do not fit, the row scrolls sideways. With a
  single request nothing changes.

### Español

Un inicio en la barra lateral, pestañas en el panel del chat, una pestaña de configuración rediseñada, un
monitor de subagentes y un modo de trabajo Manual/Auto.

#### Añadido

- **Un inicio en la barra lateral** (con `chatLocation` en `editor`). **Inicio rápido**, sobre el
  árbol de Sesiones, es una caja pequeña: escribe y pulsa Intro para abrir una pestaña de chat
  nueva que inicia la conversación. Su píldora de modelo abre un selector (agrupado por proveedor y
  con búsqueda) para el modelo de la siguiente conversación; dura hasta que elijas otro o recargues
  la ventana y no toca `openVsCode.defaultModel`. Una franja de estado muestra el modelo, el modo
  de la siguiente conversación, cualquier servidor MCP con error y, solo mientras no está listo, el
  servidor. **En ejecución** lista las sesiones raíz que se ejecutan ahora con su actividad, un
  reloj y **Detener**, que también para sus subagentes; **Esperándote** lista permisos y
  preguntas, y Responder abre la conversación con la tarjeta enfocada. Bajo el árbol de Sesiones,
  **Cambios de las sesiones** lista los archivos que cambió cada sesión (clic para el diff de VS
  Code) y **Uso (todos los proyectos)** muestra coste y tokens de hoy y de los últimos 7 días por
  modelo, de todos los proyectos de tu base de datos de opencode. Nuevos botones de la barra de
  título **OpenCode: Actualizar cambios** y **OpenCode: Actualizar uso**. La ruta de uso es
  experimental en opencode, así que una versión más nueva puede cambiarla.
- **Una pestaña de configuración rediseñada.** Una cabecera con búsqueda y cuatro tarjetas de
  estado pulsables (servidor, proveedores, modelo por defecto, servidores MCP), y secciones
  laterales: General (ubicación del chat, arranque automático), Proveedores (filas compactas y un
  selector + Agregar proveedor), Modelos (el modelo por defecto), Servidores MCP, Mods (un
  interruptor por mod, Recargar mods y Abrir carpeta), Modo de trabajo y Avanzado (la contraseña del
  servidor, los permisos guardados, la decisión sobre los plugins de la carpeta). Por debajo de
  600 px las secciones se pliegan en una franja.
- **Conectar, desconectar e iniciar sesión en servidores MCP** desde la configuración (antes eran
  de solo lectura). El cambio dura hasta que opencode se reinicie.
- **Monitor de subagentes.** Mientras un subagente trabaja o espera, una franja sobre el cuadro del
  prompt dice "Subagentes · N"; ábrela para ver una fila por subagente (agente, tarea, herramienta
  actual, tiempo transcurrido) con Abrir, Responder, Detener y un **Detener todos** que nunca para
  el turno principal. En la conversación, cada llamada a un subagente se convierte en una tarjeta
  viva que se pliega en "Terminado", "Detenido" o "Con error" al terminar.
- **Pestañas Chat, Cambios y Sesión en el panel del chat.** Una fila de pestañas bajo la cabecera
  cambia el área central; las tarjetas de peticiones, la franja de subagentes, la línea de
  actividad y el cuadro del prompt se mantienen en las tres. **Cambios** contiene los archivos que
  cambió la sesión (antes en la cabecera). **Sesión** contiene las instrucciones fijadas, un
  medidor de contexto con Compactar, los totales de tokens y coste, los subagentes de la sesión con
  Abrir y **Exportar** a Markdown o JSON (el JSON contiene el texto completo y las rutas de
  archivos). La línea de contexto bajo el título incorpora un botón **Compactar** a partir del 80 %
  de la ventana.
- **Escribe mientras el agente trabaja.** Durante un turno, Intro encola el mensaje (una etiqueta
  "En cola: …" con Dirigir ahora, Editar y quitar) y Ctrl+Intro (Cmd+Intro en macOS) dirige el
  turno con él al instante. Detener pasó a la línea de actividad de abajo, que ahora dice qué hace
  el agente, el paso, el tiempo transcurrido y cuántos subagentes se ejecutan.
- **Instrucciones fijadas por sesión** ("Responde siempre en gallego"), que opencode envía en cada
  paso. Estas y Exportar usan la API experimental de opencode, así que una versión más nueva puede
  cambiarlas.
- **El shell de opencode en Configuración de OpenCode › Avanzado.** Una lista desplegable con
  Automático y los shells
  que ofrece el servidor (los que opencode solo acepta para el terminal van marcados). Se guarda en
  tu configuración global de opencode, así que también se aplica a la interfaz de terminal y a
  todas las carpetas; un aviso indica cuándo otra configuración (la de la carpeta o la de tu
  organización) fija su propio shell y oculta la elección.
- **Un interruptor por mod.** Un botón con forma de pieza de puzle tras **+** y **/** en la barra
  del prompt (con el número de mods activos) abre un panel con los mods y un interruptor para cada
  uno. Un interruptor arranca o para solo ese mod: los demás mantienen su estado, bandas y paneles
  abiertos. La elección se guarda para el espacio de trabajo (la lista de mods que desactivaste),
  sobrevive a Recargar mods y a recargar la ventana, y un mod nuevo arranca activado. Sin carpeta
  abierta dura hasta que se cierra la ventana. Con `openVsCode.mods.enabled` desactivado el panel
  sigue listando los mods, con los interruptores deshabilitados y un botón **Abrir configuración**.
  **Administrar mods…** muestra los mods desactivados.
- **Modo de trabajo (Manual / Auto)**: una píldora a la izquierda de Enviar en la barra del prompt
  (icono de persona y **Manual**, rayo y **Auto**; solo el icono por debajo de 200 px) elige, por
  sesión, quién responde a las peticiones de permiso de opencode. **Manual** no cambia nada: la
  tarjeta aparece siempre que las reglas de opencode lo piden. En **Auto** la extensión responde
  "una vez" por ti (nunca "siempre"), también por los subagentes de la sesión y por las peticiones
  que ya están en pantalla, y el historial dice **Permitido automáticamente**. Auto no aprueba por ti
  lo que **reconoce** como leer un secreto (archivos `.env`, claves SSH, certificados,
  `credentials*.json`, `.npmrc`, `.kube/config`…, también cuando un comando de shell nombra uno),
  salir del proyecto (`external_directory`), borrar o mover archivos (un parche que borra o mueve,
  un `edit` de forma desconocida) o publicar o hacer push. Esos mantienen la tarjeta habitual. En
  los comandos de shell la comprobación es una **lista negra heurística por familias, no una
  garantía**: pide confirmación para borradores y sobrescritores (`rm`, `mv`, `cp`, `>`, `tee`),
  todo `git push` y las opciones de git que ejecutan un comando, publicar (`npm publish`, `docker
  push`, `gh pr merge`…), destructivos de infraestructura y nube (`kubectl delete`, `terraform
  destroy`, `docker run|exec`…), shells e intérpretes alimentados por stdin o código en línea,
  lanzadores (`npx`, `pnpm exec`, `uv run`, `dnx`, `asdf env`, `wsl`, `ssh`…) clasificados por lo
  que ejecutan (también piden confirmación para las opciones que cambian de dónde viene el paquete,
  como `uvx --index` y `npx --registry`, y para `uvx --env-file`), `mise env` (imprime secretos),
  clientes SQL, copias a otra máquina (`scp`, `rsync host:`, `sftp`) y publicar mediante `gh`
  (`repo create --push`, `workflow run`…), un comodín sin comillas o un `$` en una palabra, una
  barra invertida en el nombre de un comando o que sea un escape POSIX (`git pu\sh`; las rutas de
  Windows como `src\app.ts` están bien), variables de entorno que configuran lo que se ejecuta
  (`GIT_*`, `PAGER`, `LD_*`, también mediante `export`; `GIT_EDITOR=true` y alguna más pasan),
  subidas a la nube (`aws s3 sync . s3://b`, `gcloud storage cp … gs://`, `az storage blob
  upload`, `azcopy`; las descargas pasan), reinicios de bases de datos de frameworks (`rails
  db:drop`, `php artisan migrate:fresh`, `manage.py flush`, `dotnet ef database drop`…) y, porque en
  Windows un punto inicial no oculta nada, un listado recursivo (`Get-ChildItem -Recurse`, `dir /s`,
  `ls -R`) salvo que liste solo nombres (`-Name`, `-Directory`, `dir /b`), y despliegues (`vercel --prod`, `firebase deploy`, `fly deploy`,
  `wrangler deploy`, `cdk deploy`, `sam deploy`, `kubectl apply`…). Límites conocidos: clasifica un
  comando simple por su texto, así que no conoce las opciones con valor de todos los lanzadores
  (`bunx --cwd src tool`), lee `%VAR%` solo en mayúsculas, no mira `--import` tras `node --test`, y
  `ls -R` también pide confirmación en bash. Lo que **no** ve se aprueba: herramientas que no
  nombra (`fd -X rm`, `trash`, `rclone`, `gsutil rm` mediante un alias…), un alias que hayas
  configurado (`git p` por `git push`), lo que hace un script (`bash build.sh`, `npm run clean`) y
  cualquier herramienta que no esté nombrada en su lista; las revisiones siguen encontrando más de
  esas. Las preguntas propias del agente siguen llegándote. El modo vive en la memoria del
  extension host: una sesión nueva y una recarga empiezan en Manual. Nuevo comando **OpenCode:
  Alternar modo de trabajo** (sin atajo por defecto). Auto solo responde a lo que opencode pregunta: lo que su
  configuración permite sin preguntar se ejecuta igual en ambos modos.

#### Cambiado

- **Compilado y probado con opencode 2.2.7** (antes 2.0.32): la versión fijada de `@opencode/client`
  y el CLI recomendado se mueven juntos. Las llamadas a las rutas experimentales (estadísticas de
  uso, conectar y desconectar MCP) usan ahora los métodos `client.experimental.*`.
- **Varias peticiones pendientes comparten una caja.** En lugar de apilar una tarjeta sobre otra,
  los permisos y preguntas que el agente espera van en una única caja con una pestaña por petición
  (icono y nombre, la activa subrayada, "1 de 3" a la derecha) y solo la petición activa debajo.
  Los nombres de las pestañas se ven siempre enteros; si no caben, la fila se desplaza
  lateralmente. Con una sola petición no cambia nada.

## [1.0.0] - 2026-11-04

### English

First release on the Visual Studio Marketplace and Open VSX.

#### Added

- **Spanish and a way to add languages**: the manifest (commands, settings, views), the notices and
  dialogs of the extension host, the chat and the Settings tab follow the display language of VS
  Code; Spanish ships with the extension. VS Code needs the matching language pack installed,
  otherwise it reports English. A new language is two files named after the pack's language id
  (`package.nls.<id>.json`, `l10n/bundle.l10n.<id>.json`) checked by `npm run l10n:check`; see
  `docs/i18n.md`. Visible changes: dates in the chat's session list follow the language of VS Code
  (before, the system's), and the prompt that **Explain** and **Fix with OpenCode** write is in the
  language of VS Code, so the model answers in it. Logs and channel names stay in English.
- **Plugin consent**: before the extension starts opencode in a folder whose opencode config brings
  plugins (files in `.opencode/plugin(s)/`, or `plugins` / `plugin` entries in `opencode.json(c)`,
  npm names included, in the folder or any folder above it) it shows a warning with **Start
  anyway** and **Don't start**. The answer is remembered per folder and asked again if the plugin
  list changes; Start, **OpenCode: Restart Server** and the first prompt ask in a modal. New
  command **OpenCode: Forget Plugin Decision for This Folder**. A plugin that arrives while
  opencode runs (a `git pull`, a branch switch) stops the server and asks again (see Changed). Not
  covered: a server set in `openVsCode.serverUrl`, which the extension does not start. The chat
  card and the status bar say "not started" because of the plugins.
- **Mods**: JavaScript you write yourself, loaded only from `~/.config/opencode-station/mods`
  (never from a project), each in its own Worker. A mod can show a status band in the chat, add
  commands to the `/` menu and to **OpenCode: Run Mod Command…**, show a toast, write text into the
  prompt box (only you send it), open its own panel beside the chat and observe the turns, tools
  and permissions of a session. A mod that throws or hangs is stopped without affecting the chat.
  Mods are not a sandbox: they run with your permissions. Turn them off with
  `openVsCode.mods.enabled`. See `docs/mods.md`.
- OpenCode Settings tab, follow-up: in a remote window every OAuth method says its sign-in may not
  work if it sends you back from the browser; a sign-in link whose query VS Code would rewrite
  (`%26`, `%2B`, `%3D`) is not opened and the notification offers **Copy link**; after you enter
  or dismiss the API key in the native box, the provider card gets the focus back; an OAuth login
  whose status cannot be read three times, or whose local deadline passes while the server still
  says it is pending, is cancelled on the server too (not when the server itself answers expired).
- **OpenCode Settings** tab (**OpenCode: Open Settings…**, also the gear of the Chat and Sessions
  views): the providers of the opencode server with **Connect** (API key in a masked native box
  that only the extension host sees, OAuth `auto` or with a code, external methods) and
  **Remove**, and the MCP servers of the folder with their status, resources and templates, live
  and read only. The previous **Open Settings** command is now **Open Extension Settings** (same
  id) and is a link at the foot of the tab. Credentials are saved by opencode for all your
  projects; the extension does not store, send to the webview or log a key.
- Organize the Sessions tree (`chatLocation: editor`): **folders** and subfolders (**New
  Folder…**, **New Subfolder…**, **Rename Folder…**, **Delete Folder**; **Move to Folder…** or
  drag the rows, several at once), **Pin** and **Unpin** (a **Pinned** section at the top) and
  **Archive** and **Unarchive** (a collapsed **Archived** section at the end; the folder is
  remembered). A **Needs attention** section above them repeats the sessions that are running or
  waiting for input. **Filter Sessions…** keeps the running, the waiting-for-input or the
  open-in-a-tab sessions (**Clear Filters** turns it off; the filter is also written above the
  rows). The tooltip of a row shows the cost and tokens, the folder and, for a session with a tab,
  the number of changed files. **Search Sessions…** also finds archived sessions and says so.
  Folders, pins and the archive are stored per workspace folder in VS Code and are lost if the
  project folder is moved, renamed or cloned again (see Known limitations); no session is ever
  deleted by them. In `sidebar` mode nothing changes and no new command is offered.
- Requests per chat tab: with `chatLocation: editor`, a permission or question shows only in the
  tab of its session or of an ancestor of the subagent that asked (the side bar chat still shows
  all of them). The native notification is titled `OpenCode · <session title>: …` and appears when
  no chat tab that shows the request is the active editor; **Open chat** reveals that tab, or the
  tab of the root session for a subagent with none, and focuses the card. **Needs input** marks
  the root row of the Sessions tree for a request at any depth of its subagents. A new request
  card no longer takes the focus when its chat does not have it (a tab side by side with the one
  you are in), so the notification stays and your focus is not moved. With the side bar chat
  visible, a new request shows its card and the badge, but neither moves the focus nor raises a
  notification (issue #77).
- Native **Sessions** tree in `editor` mode: the OpenCode view lists the root sessions of the
  folder, grouped by Today, Yesterday, Previous 7 days and Older. Each row shows its state with an
  icon (Running, Needs input, Failed) and, when the side bar is wide enough, in words (also Fork
  and Tab) before its time; a long title can hide the words, and the tooltip and the screen reader
  label always carry them. The chat in a tab has no **Sessions** button: the tree is the place to
  browse, search, rename and delete sessions (the side bar chat keeps its button). It follows the
  server without refreshing (created, renamed, deleted, running, waiting for input), opens a
  session in a tab or reveals the one it has, renames and deletes from the row (inline buttons,
  context menu, `F2` and `Delete`), searches the titles on the server with **Search Sessions…**,
  loads 50 more with **Show more sessions**, follows the active tab, and shows a welcome with
  buttons when the folder has no sessions, when opencode is not running or when no folder is open.
  The badge is the number of pending requests. Known limits: deleting a session also deletes its
  subagent sessions, and a tab that showed one of them gets the "deleted outside this view" notice
  (issue #77).
- Setting `openVsCode.chatLocation` (`editor` by default, or `sidebar`; any other value counts as
  `editor`): with `editor` every session opens in its own editor tab beside the code and the
  OpenCode view is the Sessions tree (above); `sidebar` keeps one chat in the OpenCode view.
  Opening a session that already has a tab reveals it, New Session opens a new tab, and Insert at
  cursor and Add selection write into the last text editor, while file links and diffs open
  outside the chat's group. Opening a row of the tree adopts an empty tab instead of leaving one
  behind. Changing the setting applies at once: the side bar session opens in a tab, and going
  back to `sidebar` leaves the tabs open. The tabs are restored after Reload Window, each with its
  session, draft and title (the ones in the background when you open them); a restored tab whose
  session is already open elsewhere closes and reveals the other one, and one whose session was
  deleted comes back empty with a notice. With tabs open the extension now activates when the
  window opens. Known limits: the draft in the prompt box does not move when the setting changes,
  and changing the served folder with tabs open leaves them empty (issue #77).
- Editor and Explorer context menus: **Add to OpenCode Chat**, **Explain with OpenCode** and **Fix
  with OpenCode** (Fix includes the errors and warnings VS Code reports for the selection) in the
  editor, and **Explain with OpenCode** on one or more files in the Explorer. The prompt is sent
  at once in the open session, or left in the prompt box with a notice when the chat is busy, not
  connected, or the buffer has unsaved changes, or when the chat took more than 10 s to open
  (issue #36).
- Settings editor: the settings are listed in a fixed order (executable, server address, default
  model, chat location) and link to each other (issue #38).
- opencode v2 detection: finds `opencode2` or `opencode` (or the `openVsCode.opencodePath`
  executable), accepts only major version 2, and resolves npm `.cmd` shims to the real executable
  on Windows (issue #7).
- One `opencode serve` per workspace folder, started on a loopback port with a random password and
  stopped with its whole process tree when the window closes. Restart Server, Select Workspace
  Folder for multi-root workspaces, and an OpenCode output channel (issues #8, #10).
- Connect to an opencode v2 server that is already running on this machine with
  `openVsCode.serverUrl`, with its password kept in VS Code's SecretStorage (issue #11).
- Chat view in the Activity Bar with a prompt box, streaming replies and a status line inside the
  chat that shows the connection state (issues #12, #13, #14).
- Command Palette commands Open Chat, Focus Prompt, New Session and Stop Response, with default
  shortcuts Ctrl+Alt+P / Cmd+Alt+P (Focus Prompt, toggles back to the editor) and Ctrl+Alt+N /
  Cmd+Alt+N (New Session, only with the chat focused); both can be rebound (issue #35).
- Attach files by right-clicking them in the Explorer (**Add to OpenCode Chat**) or by dragging
  them onto the prompt box **while holding Shift**, and paste images (PNG, JPEG, GIF, WebP, up to
  10 MiB) with Ctrl/Cmd+V (issue #30). An image dropped from the system's file manager is attached
  like a pasted one; any other file from there is refused with a notice. Retry, "Fork from here"
  and "Revert from here" do not re-attach pasted images. In VS Code 1.140 or later the Explorer
  drop is reported not to reach extension views at all
  ([microsoft/vscode#339036](https://github.com/microsoft/vscode/issues/339036), not reproduced
  here); the menu command, Attach and `@` mentions keep working.
- Markdown rendering while streaming, syntax highlighting, and code actions (copy, insert at the
  cursor, open in a new file, open `path:line` references) (issue #15).
- Stop button and Escape to interrupt a turn, a neutral "Stopped" note, and readable error messages
  (issue #16).
- Light, dark and high-contrast themes, keyboard navigation and screen-reader labels (issue #17).
- Permission cards, a notification and a badge when the chat is hidden, and a list of saved
  permissions that can be revoked (issues #18, #19).
- Question cards, and a line in the history for every permission or question already answered
  (issues #44, #56).
- Session list with groups, search, rename and delete; the open session is remembered per
  workspace (issues #20, #22).
- Fork a session from any of your messages, and open subagent sessions from their tool call
  (issue #21).
- Model and agent (Build/Plan) selectors, the `openVsCode.defaultModel` setting and the reasoning
  variant control (issues #23, #24, #61).
- Collapsible tool cards for shell, read, grep and edit, with diffs for edits (issue #26).
- `@` file mentions in the prompt and an "Add selection" button that attaches the editor selection
  (issues #28, #29).
- A line under the session title with the context used by the last step and, for paid models, the
  session cost including direct subagents (issue #25).
- Continuous integration on Windows, macOS and Linux, with a check of the packaged file list
  (issue #5).
- Marketplace packaging: icon, README, changelog and license (issue #42).
- Release workflow that publishes the same package to the VS Code Marketplace and Open VSX from a
  version tag (issue #43).

#### Changed

- opencode now starts with its file watcher off (`OPENCODE_FILEWATCHER_DISABLE=1`), so it no longer
  imports a project plugin that lands while it runs (opencode 2.0.32 did so in under half a second,
  with no prompt). Instead the extension watches the served folder: a plugin you have not allowed
  stops the server (cutting a running turn) and asks again, before it runs. The cost: changes to
  opencode's config, `AGENTS.md`, skills and commands now apply after **OpenCode: Restart
  Server**. Not covered: plugin folders above the served one, events lost to
  `files.watcherExclude` or symlinks, and a plugin written while the server is still starting,
  which can run once (issue #158).
- Mods have flood limits: at most 50 lines a second in the **OpenCode Mods** channel (including the
  extension's warnings about what the mod sends) and 30 messages a second to its panels; the rest
  is dropped with one warning per second. Command arguments are capped at 4000 characters on every
  path, **OpenCode: Run Mod Command…** included (issue #155).
- Mod commands show in the `/` menu and run even when opencode is not running (autoStart off,
  starting, reconnecting): a typed mod command runs in its mod instead of going out as a prompt,
  which used to start the server. opencode's own commands appear once the server sends them (issue
  #155).
- Mods are sturdier around shutdown: a load or a message that ends after the extension stops no
  longer writes to a closed output channel. A panel page's warning for a dropped message is limited
  to one a second per panel. `docs/mods.md` now says that a link inside a mod folder that points
  outside it can be read by that mod's panel page (issue #155).
- The license is now the [PolyForm Shield License 1.0.0](LICENSE) instead of MIT: you may use,
  change and share the extension for any purpose except providing a product that competes with it.
  It is source-available, not an OSI open source license.
- Choosing an agent, a model or a reasoning level in the chip panel no longer closes it, so all
  three can be changed in one opening. The chip, Escape, a click outside and moving the focus away
  still close it.
- Chat view in the side bar: **Open Settings** is a title button and **Restart Server** moved to
  the "…" menu, as in the Sessions view (issue #133).

### Español

Primera versión en el Visual Studio Marketplace y en Open VSX.

#### Añadido

- **Español y una forma de añadir idiomas**: el manifiesto (comandos, configuración, vistas), los avisos
  y diálogos del extension host, el chat y la pestaña de configuración siguen el idioma de visualización
  de VS Code; el español se incluye con la extensión. VS Code necesita el paquete de idioma
  correspondiente instalado; si no, informa en inglés. Un idioma nuevo son dos archivos con el
  identificador de idioma del paquete (`package.nls.<id>.json`, `l10n/bundle.l10n.<id>.json`)
  comprobados con `npm run l10n:check`; consulta `docs/i18n.md`. Cambios visibles: las fechas de la
  lista de sesiones del chat siguen el idioma de VS Code (antes, el del sistema), y el prompt que
  escriben **Explicar con OpenCode** y **Corregir con OpenCode** está en el idioma de VS Code, así
  que el modelo responde en él. Los registros y los nombres de los canales siguen en inglés.
- **Consentimiento de plugins**: antes de que la extensión arranque opencode en una carpeta cuya
  configuración de opencode trae plugins (archivos en `.opencode/plugin(s)/`, o entradas `plugins` /
  `plugin` en `opencode.json(c)`, incluidos nombres de npm, en la carpeta o en cualquiera de sus
  carpetas superiores) muestra un aviso con **Iniciar de todos modos** y **No iniciar**. La
  respuesta se recuerda por carpeta y se vuelve a preguntar si cambia la lista de plugins; Iniciar,
  **OpenCode: Reiniciar servidor** y el primer prompt preguntan en un modal. Nuevo comando
  **OpenCode: Olvidar decisión sobre el plugin para esta carpeta**. Un plugin que llega mientras
  opencode se ejecuta (un `git pull`, un cambio de rama) para el servidor y vuelve a preguntar (ver
  Cambiado). No cubierto: un servidor indicado en `openVsCode.serverUrl`, que la extensión no
  arranca. La tarjeta del chat y la barra de estado dicen "No iniciado" a causa de los plugins.
- **Mods**: JavaScript que escribes tú, cargado solo desde `~/.config/opencode-station/mods`
  (nunca desde un proyecto), cada uno en su propio Worker. Un mod puede mostrar una banda de estado
  en el chat, añadir comandos al menú `/` y a **OpenCode: Ejecutar comando de mod…**, mostrar un aviso
  emergente, escribir texto en el cuadro del prompt (solo tú lo envías), abrir su propio panel
  junto al chat y observar los turnos, herramientas y permisos de una sesión. Un mod que lanza un
  error o se cuelga se detiene sin afectar al chat. Los mods no son un entorno aislado: se ejecutan
  con tus permisos. Desactívalos con `openVsCode.mods.enabled`. Consulta `docs/mods.md`.
- Pestaña Configuración de OpenCode, seguimiento: en una ventana remota cada método OAuth avisa de
  que el inicio de sesión puede no funcionar si te devuelve desde el navegador; un enlace de inicio
  de sesión cuya consulta VS Code reescribiría (`%26`, `%2B`, `%3D`) no se abre y la notificación
  ofrece **Copiar enlace**; tras introducir o descartar la clave de API en el cuadro nativo, la tarjeta
  del proveedor recupera el foco; un inicio de sesión OAuth cuyo estado no se puede leer tres veces,
  o cuyo plazo local vence mientras el servidor aún dice que está pendiente, se cancela también en
  el servidor (no cuando el propio servidor responde que expiró).
- Pestaña **Configuración de OpenCode** (**OpenCode: Abrir configuración…**, también el engranaje
  de las vistas Chat y Sesiones): los proveedores del servidor opencode con **Conectar** (clave de
  API en un cuadro nativo enmascarado que solo ve el extension host, OAuth `auto` o con código,
  métodos externos) y **Quitar**, y los servidores MCP de la carpeta con su estado, recursos y
  plantillas, en vivo y de solo lectura. El anterior comando **Abrir configuración** es ahora
  **Abrir configuración de la extensión** (mismo id) y es un enlace al pie de la pestaña. opencode guarda las credenciales para
  todos tus proyectos; la extensión no guarda, envía al webview ni registra ninguna clave.
- Organiza el árbol de Sesiones (`chatLocation: editor`): **carpetas** y subcarpetas (**Nueva
  carpeta…**, **Nueva subcarpeta…**, **Cambiar nombre de la carpeta…**, **Eliminar carpeta**;
  **Mover a carpeta…** o arrastrar las filas, varias a la vez), **Anclar** y **Desanclar** (una
  sección **Anclados** arriba) y **Archivar** y **Desarchivar** (una sección **Archivados**
  plegada al final; se recuerda la carpeta). Una sección **Requiere atención** sobre ellas repite
  las sesiones que se ejecutan o esperan respuesta. **Filtrar sesiones…** deja las sesiones en
  ejecución, las que esperan una respuesta o las abiertas en una pestaña (**Borrar filtros** lo
  desactiva; el filtro también se escribe sobre las filas). El tooltip de una fila muestra el coste
  y los tokens, la carpeta y, para una sesión con pestaña, el número de archivos modificados.
  **Buscar sesiones…** también encuentra sesiones archivadas y lo indica. Las carpetas, los
  anclados y los archivados se guardan por carpeta de espacio de trabajo en VS Code y se pierden si
  la carpeta del proyecto se mueve, se renombra o se vuelve a clonar (consulta Known limitations);
  nunca borran ninguna sesión. En modo `sidebar` no cambia
  nada y no se ofrece ningún comando nuevo.
- Peticiones por pestaña de chat: con `chatLocation: editor`, un permiso o una pregunta solo se
  muestra en la pestaña de su sesión o en la de un ancestro del subagente que lo pidió (el chat de
  la barra lateral sigue mostrándolas todas). La notificación nativa se titula `OpenCode · <título
  de la sesión>: …` y aparece cuando ninguna pestaña de chat que muestre la petición es el editor
  activo; **Abrir chat** revela esa pestaña, o la de la sesión raíz para un subagente que no tiene
  la suya, y enfoca la tarjeta. **Requiere respuesta** marca la fila raíz del árbol de Sesiones para una
  petición a cualquier profundidad de sus subagentes. Una tarjeta de petición nueva ya no toma el
  foco cuando su chat no lo tiene (una pestaña en paralelo a aquella en la que estás), así que la
  notificación se mantiene y tu foco no se mueve. Con el chat de la barra lateral visible, una
  petición nueva muestra su tarjeta y la insignia, pero ni mueve el foco ni lanza una notificación
  (issue #77).
- Árbol nativo de **Sesiones** en modo `editor`: la vista OpenCode lista las sesiones raíz de la
  carpeta, agrupadas por Hoy, Ayer, Últimos 7 días y Anteriores. Cada fila muestra su estado con
  un icono (En ejecución, Requiere respuesta, Con error) y, cuando la barra lateral es lo bastante
  ancha, con palabras (también Bifurcación y Pestaña) antes de su hora; un título largo puede ocultar las
  palabras, y el tooltip y la etiqueta del lector de pantalla siempre las llevan. El chat en una
  pestaña no tiene botón **Sesiones**: el árbol es el lugar para explorar, buscar, renombrar y
  eliminar sesiones (el
  chat de la barra lateral conserva su botón). Sigue al servidor sin refrescar (creadas,
  renombradas, eliminadas, en ejecución, esperando respuesta), abre una sesión en una pestaña o
  revela la que ya tiene, renombra y elimina desde la fila (botones en línea, menú contextual, `F2`
  y `Delete`), busca los títulos en el servidor con **Buscar sesiones…**, carga 50 más con
  **Mostrar más sesiones**, sigue a la pestaña activa y muestra una bienvenida con botones cuando la
  carpeta no tiene sesiones, cuando opencode no se está ejecutando o cuando no hay carpeta abierta.
  La insignia es el número de peticiones pendientes. Límites conocidos: eliminar una sesión elimina
  también sus sesiones de subagentes, y una pestaña que mostraba una de ellas recibe el aviso "La
  sesión abierta se eliminó fuera de esta vista" (issue #77).
- Ajuste `openVsCode.chatLocation` (`editor` por defecto, o `sidebar`; cualquier otro valor cuenta
  como `editor`): con `editor` cada sesión se abre en su propia pestaña de editor junto al código y
  la vista OpenCode es el árbol de Sesiones (arriba); `sidebar` mantiene un chat en la vista
  OpenCode. Abrir una sesión que ya tiene pestaña la revela, Nueva sesión abre una pestaña nueva, e
  Insertar código en el cursor y Agregar selección escriben en el último editor de texto, mientras que los enlaces
  de archivos y los diffs se abren fuera del grupo del chat. Abrir una fila del árbol adopta una
  pestaña vacía en lugar de dejar una atrás. Cambiar el ajuste se aplica al instante: la sesión de
  la barra lateral se abre en una pestaña, y al volver a `sidebar` las pestañas siguen abiertas.
  Las pestañas se restauran tras Recargar ventana, cada una con su sesión, borrador y título (las de
  segundo plano cuando las abres); una pestaña restaurada cuya sesión ya está abierta en otro sitio
  se cierra y revela la otra, y una cuya sesión se eliminó vuelve vacía con un aviso. Con pestañas
  abiertas la extensión se activa ahora al abrir la ventana. Límites conocidos: el borrador del
  cuadro del prompt no se mueve al cambiar el ajuste, y cambiar la carpeta servida con pestañas
  abiertas las deja vacías (issue #77).
- Menús contextuales del editor y del Explorador: **Agregar al chat de OpenCode**, **Explicar con
  OpenCode** y **Corregir con OpenCode** (Corregir incluye los errores y avisos que VS Code informa
  para la selección) en el editor, y **Explicar con OpenCode** sobre uno o más archivos en el
  Explorador.
  El prompt se envía al instante en la sesión abierta, o se deja en el cuadro del prompt con un
  aviso cuando el chat está ocupado, sin conexión, o el búfer tiene cambios sin guardar, o cuando
  el chat tardó más de 10 s en abrirse (issue #36).
- Editor de configuración: las opciones se listan en un orden fijo (ejecutable, dirección del servidor,
  modelo por defecto, ubicación del chat) y se enlazan entre sí (issue #38).
- Detección de opencode v2: encuentra `opencode2` o `opencode` (o el ejecutable de
  `openVsCode.opencodePath`), solo acepta la versión mayor 2, y en Windows resuelve los shims
  `.cmd` de npm al ejecutable real (issue #7).
- Un `opencode serve` por carpeta de espacio de trabajo, arrancado en un puerto de loopback con una
  contraseña aleatoria y detenido con todo su árbol de procesos al cerrar la ventana. Reiniciar
  servidor, Seleccionar carpeta del área de trabajo para espacios multi-raíz, y un canal de salida
  OpenCode (issues #8, #10).
- Conexión a un servidor opencode v2 que ya se ejecuta en esta máquina con `openVsCode.serverUrl`,
  con su contraseña guardada en el SecretStorage de VS Code (issue #11).
- Vista de chat en la barra de actividad con un cuadro de prompt, respuestas en streaming y una
  línea de estado dentro del chat que muestra el estado de la conexión (issues #12, #13, #14).
- Comandos de la paleta Abrir chat, Poner el foco en el prompt, Nueva sesión y Detener respuesta,
  con atajos por defecto Ctrl+Alt+P / Cmd+Alt+P (Poner el foco en el prompt, vuelve al editor) y
  Ctrl+Alt+N / Cmd+Alt+N (Nueva sesión, solo con el chat enfocado); ambos se pueden reasignar
  (issue #35).
- Adjuntar archivos con clic derecho en el Explorador (**Agregar al chat de OpenCode**) o arrastrándolos
  al cuadro del prompt **con Mayús pulsada**, y pegar imágenes (PNG, JPEG, GIF, WebP, hasta 10 MiB)
  con Ctrl/Cmd+V (issue #30). Una imagen soltada desde el gestor de archivos del sistema se adjunta
  como una pegada; cualquier otro archivo de ahí se rechaza con un aviso. Reintentar, "Bifurcar
  desde aquí" y "Revertir desde aquí" no vuelven a adjuntar las imágenes pegadas. En VS Code 1.140 o
  posterior se informa de que soltar desde el Explorador no llega a las vistas de extensiones
  ([microsoft/vscode#339036](https://github.com/microsoft/vscode/issues/339036), no reproducido
  aquí); el comando del menú, Adjuntar y las menciones `@` siguen funcionando.
- Renderizado de Markdown durante el streaming, resaltado de sintaxis y acciones sobre el código
  (copiar, insertar en el cursor, abrir en un archivo nuevo, abrir referencias `path:line`) (issue
  #15).
- Botón Detener y Escape para interrumpir un turno, una nota neutra "Detenido" y mensajes de error
  legibles (issue #16).
- Temas claro, oscuro y de alto contraste, navegación con teclado y etiquetas para lectores de
  pantalla (issue #17).
- Tarjetas de permisos, una notificación y una insignia cuando el chat está oculto, y una lista de
  permisos guardados que se pueden revocar (issues #18, #19).
- Tarjetas de preguntas, y una línea en el historial por cada permiso o pregunta ya respondidos
  (issues #44, #56).
- Lista de sesiones con grupos, búsqueda, renombrar y eliminar; la sesión abierta se recuerda por
  espacio de trabajo (issues #20, #22).
- Bifurcar una sesión desde cualquiera de tus mensajes, y abrir sesiones de subagentes desde su
  llamada a la herramienta (issue #21).
- Selectores de modelo y agente (Build/Plan), el ajuste `openVsCode.defaultModel` y el control de
  la variante de razonamiento (issues #23, #24, #61).
- Tarjetas de herramientas plegables para shell, read, grep y edit, con diffs para las
  ediciones (issue #26).
- Menciones de archivos con `@` en el prompt y un botón "Agregar selección" que adjunta la
  selección del editor (issues #28, #29).
- Una línea bajo el título de la sesión con el contexto usado por el último paso y, para modelos de
  pago, el coste de la sesión incluidos los subagentes directos (issue #25).
- Integración continua en Windows, macOS y Linux, con una comprobación de la lista de archivos
  empaquetados (issue #5).
- Empaquetado para el Marketplace: icono, README, registro de cambios y licencia (issue #42).
- Flujo de publicación que publica el mismo paquete en el VS Code Marketplace y en Open VSX a
  partir de una etiqueta de versión (issue #43).

#### Cambiado

- opencode se arranca ahora con su vigilante de archivos desactivado
  (`OPENCODE_FILEWATCHER_DISABLE=1`), de modo que ya no importa un plugin de proyecto que llega
  mientras se ejecuta (opencode 2.0.32 lo hacía en menos de medio segundo, sin preguntar). En su
  lugar la extensión vigila la carpeta servida: un plugin que no has permitido para el servidor
  (cortando un turno en curso) y vuelve a preguntar, antes de que se ejecute. El coste: los cambios
  en la configuración de opencode, `AGENTS.md`, las skills y los comandos se aplican ahora tras
  **OpenCode: Reiniciar servidor**. No cubierto: carpetas de plugins por encima de la servida, eventos
  perdidos por `files.watcherExclude` o por enlaces simbólicos, y un plugin escrito mientras el
  servidor aún arranca, que puede ejecutarse una vez (issue #158).
- Los mods tienen límites contra desbordamiento: como máximo 50 líneas por segundo en el canal
  **OpenCode Mods** (incluidos los avisos de la extensión sobre lo que envía el mod) y 30 mensajes
  por segundo a sus paneles; el resto se descarta con un aviso por segundo. Los argumentos de los
  comandos se limitan a 4000 caracteres en todas las vías, **OpenCode: Ejecutar comando de mod…**
  incluido (issue #155).
- Los comandos de los mods aparecen en el menú `/` y se ejecutan aunque opencode no esté en
  ejecución (autoStart desactivado, arrancando, reconectando): un comando de mod escrito se
  ejecuta en su mod en lugar de salir como prompt, lo que antes arrancaba el servidor. Los
  comandos propios de opencode aparecen cuando el servidor los envía (issue #155).
- Los mods son más robustos al apagarse: una carga o un mensaje que termina después de que la
  extensión se detenga ya no escribe en un canal de salida cerrado. El aviso de la página de un
  panel por un mensaje descartado se limita a uno por segundo y panel. `docs/mods.md` indica ahora
  que un enlace dentro de la carpeta de un mod que apunta fuera de ella puede ser leído por la
  página del panel de ese mod (issue #155).
- La licencia es ahora la [PolyForm Shield License 1.0.0](LICENSE) en lugar de MIT: puedes usar,
  modificar y compartir la extensión para cualquier fin salvo ofrecer un producto que compita con
  ella. Es de código disponible (source-available), no una licencia de código abierto de la OSI.
- Elegir un agente, un modelo o un nivel de razonamiento en el panel del chip ya no lo cierra, así
  que los tres se pueden cambiar en una sola apertura. El chip, Escape, un clic fuera y mover el
  foco a otro sitio siguen cerrándolo.
- Vista de chat en la barra lateral: **Abrir configuración** es un botón de la barra de título y
  **Reiniciar servidor** pasó al menú "…", como en la vista Sesiones (issue #133).
