# Changelog

All notable changes to this project are documented in this file, in English and in Spanish.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Under each version heading
there is an `### English` block followed by an `### Español` block, each with its own Added,
Changed or Fixed lists (the Spanish ones are named Añadido, Cambiado and Corregido). Older entries
were condensed when the Spanish version was added: every user-visible change is still listed.

Aquí se recogen todos los cambios relevantes del proyecto, en inglés y en español.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones, el
[Versionado Semántico](https://semver.org/lang/es/). Cada versión tiene un bloque `### English` y,
a continuación, un bloque `### Español`, cada uno con sus listas de Added, Changed o Fixed (en
español: Añadido, Cambiado y Corregido). Las entradas antiguas se resumieron al añadir la versión en
español, pero no falta ningún cambio de los que nota el usuario.

## [Unreleased]

### English

#### Fixed

- Clicking a `~/…` file path in the chat now opens the file when it is inside the workspace folder
  (outside it, the path stays refused). Before, the path was not expanded and failed with "does not
  exist" (seen on macOS). When a file cannot be found, the **OpenCode** output channel now logs the
  path that was tried, truncated (issue #228, PR #229).

### Español

#### Corregido

- Al hacer clic en una ruta `~/…` del chat ya se abre el archivo, siempre que esté dentro de la
  carpeta del espacio de trabajo (si está fuera, se sigue rechazando). Antes la ruta no se expandía
  y el clic fallaba con "does not exist" (visto en macOS). Además, cuando no se encuentra un
  archivo, el canal de salida **OpenCode** deja escrita la ruta que se probó, truncada (issue #228,
  PR #229).

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

Una pantalla de inicio en la barra lateral, pestañas en el panel del chat, la pestaña de
configuración rehecha, un monitor de subagentes y un modo de trabajo Manual/Auto.

#### Añadido

- **Una pantalla de inicio en la barra lateral** (con `chatLocation` en `editor`). **Inicio
  rápido**, encima del árbol de Sesiones, es una caja pequeña: escribes, pulsas Intro y se abre una
  pestaña de chat nueva con la conversación ya en marcha. La píldora del modelo abre un selector
  (agrupado por proveedor y con buscador) para elegir el modelo de la próxima conversación; la
  elección vale hasta que escojas otro o recargues la ventana, y no toca `openVsCode.defaultModel`.
  Una franja de estado enseña el modelo, el modo de la próxima conversación, los servidores MCP que
  hayan fallado y, solo mientras no esté listo, el servidor. **En ejecución** lista las sesiones
  raíz que están trabajando ahora mismo, con su actividad, un reloj y **Detener**, que para también
  a sus subagentes; **Esperándote** lista los permisos y las preguntas pendientes, y Responder abre
  la conversación con el foco en la tarjeta. Debajo del árbol de Sesiones, **Cambios de las
  sesiones** lista los archivos que ha cambiado cada sesión (un clic abre el diff de VS Code) y
  **Uso (todos los proyectos)** muestra el coste y los tokens de hoy y de los últimos 7 días por
  modelo, sumando todos los proyectos de tu base de datos de opencode. Hay dos botones nuevos en la
  barra de título: **OpenCode: Actualizar cambios** y **OpenCode: Actualizar uso**. La ruta de uso
  es experimental en opencode, así que una versión posterior puede cambiarla.
- **Pestaña de configuración rehecha.** Arriba, una cabecera con buscador y cuatro tarjetas de
  estado en las que se puede hacer clic (servidor, proveedores, modelo por defecto, servidores
  MCP); a un lado, las secciones: General (dónde va el chat, arranque automático), Proveedores
  (filas compactas y un selector + Agregar proveedor), Modelos (el modelo por defecto), Servidores
  MCP, Mods (un interruptor por mod, Recargar mods y Abrir carpeta), Modo de trabajo y Avanzado (la
  contraseña del servidor, los permisos guardados, lo que decidiste sobre los plugins de la
  carpeta). Con menos de 600 px de ancho, las secciones se recogen en una franja.
- **Conectar, desconectar e iniciar sesión en servidores MCP** desde la configuración (antes solo
  se podían consultar). El cambio se mantiene hasta que opencode se reinicia.
- **Monitor de subagentes.** Mientras haya un subagente trabajando o esperando, encima del cuadro
  del prompt aparece una franja con "Subagentes · N"; al abrirla ves una fila por subagente
  (agente, tarea, herramienta en uso, tiempo que lleva) con Abrir, Responder, Detener y un
  **Detener todos** que nunca para el turno principal. En la conversación, cada llamada a un
  subagente es ahora una tarjeta que se va actualizando y que, al acabar, se pliega en "Terminado",
  "Detenido" o "Con error".
- **Pestañas Chat, Cambios y Sesión en el panel del chat.** Debajo de la cabecera hay una fila de
  pestañas que cambia la zona central; las tarjetas de peticiones, la franja de subagentes, la
  línea de actividad y el cuadro del prompt se ven en las tres. En **Cambios** están los archivos
  que ha cambiado la sesión (antes estaban en la cabecera). En **Sesión** tienes las instrucciones
  fijadas, un medidor de contexto con Compactar, los totales de tokens y de coste, los subagentes
  de la sesión con Abrir y **Exportar** a Markdown o JSON (el JSON lleva el texto completo y las
  rutas de los archivos). En la línea de contexto que hay bajo el título aparece un botón
  **Compactar** cuando pasas del 80 % de la ventana.
- **Escribe mientras el agente trabaja.** En mitad de un turno, Intro deja el mensaje en cola (una
  etiqueta "En cola: …" con Dirigir ahora, Editar y quitar) y Ctrl+Intro (Cmd+Intro en macOS)
  redirige el turno con ese mensaje en el momento. Detener se ha ido a la línea de actividad de
  abajo, que ahora cuenta qué está haciendo el agente, por qué paso va, cuánto tiempo lleva y
  cuántos subagentes hay en marcha.
- **Instrucciones fijadas por sesión** ("Responde siempre en gallego"), que opencode manda en cada
  paso. Tanto esto como Exportar usan la API experimental de opencode, así que una versión
  posterior puede cambiarlos.
- **El shell de opencode, en Configuración de OpenCode › Avanzado.** Un desplegable con Automático
  y los shells que ofrece el servidor (van marcados los que opencode solo admite para el terminal).
  Se guarda en tu configuración global de opencode, de modo que vale también para la interfaz de
  terminal y para todas las carpetas; si otra configuración (la de la carpeta o la de tu
  organización) fija su propio shell y deja sin efecto el que elijas, un aviso te lo dice.
- **Un interruptor por mod.** En la barra del prompt, después de **+** y **/**, hay un botón con
  forma de pieza de puzle (con el número de mods activos) que abre un panel con la lista de mods y
  un interruptor para cada uno. Cada interruptor arranca o para solo su mod: los demás siguen como
  estaban, con sus bandas y sus paneles abiertos. Lo que elijas se guarda en el espacio de trabajo
  (la lista de mods que has desactivado), aguanta un Recargar mods y una recarga de la ventana, y
  los mods nuevos arrancan activados. Si no hay ninguna carpeta abierta, dura hasta que cierras la
  ventana. Con `openVsCode.mods.enabled` desactivado, el panel sigue listando los mods, pero con
  los interruptores deshabilitados y un botón **Abrir configuración**. **Administrar mods…**
  muestra los que están desactivados.
- **Modo de trabajo (Manual / Auto)**: en la barra del prompt, a la izquierda de Enviar, hay una
  píldora (icono de persona y **Manual**, rayo y **Auto**; solo el icono con menos de 200 px) con
  la que decides, sesión a sesión, quién contesta a las peticiones de permiso de opencode. En
  **Manual** todo sigue igual: la tarjeta aparece cada vez que las reglas de opencode lo piden. En
  **Auto** la extensión contesta "una vez" por ti (nunca "siempre"), también a los subagentes de la
  sesión y a las peticiones que ya estuvieran en pantalla, y en el historial queda **Permitido
  automáticamente**. Lo que Auto no aprueba por ti es lo que **reconoce** como leer un secreto
  (archivos `.env`, claves SSH, certificados, `credentials*.json`, `.npmrc`, `.kube/config`…,
  también si lo nombra un comando de shell), salir del proyecto (`external_directory`), borrar o
  mover archivos (un parche que borra o mueve, un `edit` con una forma que no conoce) o publicar o
  hacer push. En esos casos sale la tarjeta de siempre. Con los comandos de shell, la comprobación
  es una **lista negra heurística por familias, no una garantía**. Te pregunta con los comandos que
  borran o sobrescriben (`rm`, `mv`, `cp`, `>`, `tee`), con cualquier `git push` y con las opciones
  de git que ejecutan un comando, al publicar (`npm publish`, `docker push`, `gh pr merge`…), con
  los comandos destructivos de infraestructura y nube (`kubectl delete`, `terraform destroy`,
  `docker run|exec`…), con los shells e intérpretes que reciben el código por stdin o en la propia
  línea, con los lanzadores (`npx`, `pnpm exec`, `uv run`, `dnx`, `asdf env`, `wsl`, `ssh`…), que
  se clasifican por lo que ejecutan (y también preguntan por las opciones que cambian de dónde sale
  el paquete, como `uvx --index` y `npx --registry`, y por `uvx --env-file`), con `mise env`
  (imprime secretos), con los clientes SQL, con las copias a otra máquina (`scp`, `rsync host:`,
  `sftp`) y al publicar con `gh` (`repo create --push`, `workflow run`…), con un comodín sin
  comillas o un `$` dentro de una palabra, con una barra invertida en el nombre de un comando o que
  sea un escape POSIX (`git pu\sh`; las rutas de Windows como `src\app.ts` no dan problema), con
  las variables de entorno que configuran lo que se ejecuta (`GIT_*`, `PAGER`, `LD_*`, también con
  `export`; `GIT_EDITOR=true` y alguna más sí pasan), con las subidas a la nube
  (`aws s3 sync . s3://b`, `gcloud storage cp … gs://`, `az storage blob upload`, `azcopy`; las
  descargas pasan), con los comandos de los frameworks que vacían la base de datos
  (`rails db:drop`, `php artisan migrate:fresh`, `manage.py flush`, `dotnet ef database drop`…) y,
  como en Windows un punto al principio del nombre no oculta nada, con los listados recursivos
  (`Get-ChildItem -Recurse`, `dir /s`, `ls -R`), salvo que solo listen nombres (`-Name`,
  `-Directory`, `dir /b`), y con los despliegues (`vercel --prod`, `firebase deploy`, `fly deploy`,
  `wrangler deploy`, `cdk deploy`, `sam deploy`, `kubectl apply`…). Límites conocidos: clasifica un
  comando simple por su texto, así que no se sabe las opciones con valor de todos los lanzadores
  (`bunx --cwd src tool`), solo lee `%VAR%` en mayúsculas, no mira `--import` después de
  `node --test` y con `ls -R` pregunta también en bash. Lo que **no** ve, lo aprueba: herramientas
  que no nombra (`fd -X rm`, `trash`, `rclone`, `gsutil rm` detrás de un alias…), un alias que
  hayas configurado tú (`git p` para `git push`), lo que haga un script (`bash build.sh`,
  `npm run clean`) y cualquier herramienta que no figure en su lista; en cada revisión siguen
  saliendo más. Las preguntas que hace el propio agente te siguen llegando. El modo se guarda en la
  memoria del extension host: una sesión nueva y una recarga empiezan en Manual. Comando nuevo:
  **OpenCode: Alternar modo de trabajo** (sin atajo por defecto). Auto solo contesta a lo que
  opencode pregunta: lo que su configuración permite sin preguntar se ejecuta igual en los dos
  modos.

#### Cambiado

- **Compilada y probada con opencode 2.2.7** (antes, 2.0.32): la versión fijada de
  `@opencode/client` y el CLI recomendado suben a la vez. Las llamadas a las rutas experimentales
  (estadísticas de uso, conectar y desconectar MCP) pasan a usar los métodos
  `client.experimental.*`.
- **Las peticiones pendientes comparten una caja.** Los permisos y las preguntas por los que espera
  el agente ya no se apilan en tarjetas, una encima de otra: van en una sola caja con una pestaña
  por petición (icono y nombre, la activa subrayada, "1 de 3" a la derecha) y debajo solo se ve la
  petición activa. Los nombres de las pestañas se ven siempre enteros; si no caben, la fila se
  desplaza hacia los lados. Si solo hay una petición, no cambia nada.

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

- **Español, y cómo añadir más idiomas**: el manifiesto (comandos, configuración, vistas), los
  avisos y diálogos del extension host, el chat y la pestaña de configuración salen en el idioma en
  el que tengas VS Code; el español viene con la extensión. Tienes que tener instalado el paquete
  de idioma correspondiente; si no, VS Code dice que está en inglés. Para añadir un idioma bastan
  dos archivos con el identificador de idioma del paquete (`package.nls.<id>.json`,
  `l10n/bundle.l10n.<id>.json`), que `npm run l10n:check` comprueba; está explicado en
  `docs/i18n.md`. Lo que se nota: las fechas de la lista de sesiones del chat van en el idioma de
  VS Code (antes, en el del sistema), y el prompt que escriben **Explicar con OpenCode** y
  **Corregir con OpenCode** también, así que el modelo contesta en ese idioma. Los registros y los
  nombres de los canales siguen en inglés.
- **Permiso para los plugins**: si la configuración de opencode de una carpeta trae plugins
  (archivos en `.opencode/plugin(s)/`, o entradas `plugins` / `plugin` en `opencode.json(c)`,
  nombres de npm incluidos, en esa carpeta o en cualquiera de las que tiene por encima), la
  extensión no arranca opencode sin enseñarte antes un aviso con **Iniciar de todos modos** y **No
  iniciar**. La respuesta se recuerda para cada carpeta y se te vuelve a preguntar si cambia la
  lista de plugins; Iniciar, **OpenCode: Reiniciar servidor** y el primer prompt lo preguntan en un
  diálogo modal. Comando nuevo: **OpenCode: Olvidar decisión sobre el plugin para esta carpeta**.
  Si llega un plugin con opencode ya en marcha (un `git pull`, un cambio de rama), el servidor se
  para y se te pregunta otra vez (ver Cambiado). Queda fuera un servidor puesto en
  `openVsCode.serverUrl`, porque no lo arranca la extensión. La tarjeta del chat y la barra de
  estado dicen "No iniciado" cuando el motivo son los plugins.
- **Mods**: JavaScript que escribes tú y que solo se carga desde `~/.config/opencode-station/mods`
  (nunca desde un proyecto), cada mod en su propio Worker. Un mod puede poner una banda de estado
  en el chat, añadir comandos al menú `/` y a **OpenCode: Ejecutar comando de mod…**, sacar un
  aviso emergente, escribir en el cuadro del prompt (enviarlo es cosa tuya), abrir un panel propio
  al lado del chat y seguir los turnos, las herramientas y los permisos de una sesión. Si un mod
  lanza un error o se queda colgado, se para sin que el chat lo note. Los mods no van en un entorno
  aislado: se ejecutan con tus permisos. Se desactivan con `openVsCode.mods.enabled`. Más
  información en `docs/mods.md`.
- Retoques en la pestaña Configuración de OpenCode: en una ventana remota, cada método OAuth avisa
  de que el inicio de sesión puede fallar si el navegador tiene que devolverte a VS Code; un enlace
  de inicio de sesión con una consulta que VS Code reescribiría (`%26`, `%2B`, `%3D`) no se abre, y
  la notificación te ofrece **Copiar enlace**; después de escribir o descartar la clave de API en
  el cuadro nativo, el foco vuelve a la tarjeta del proveedor; un inicio de sesión OAuth cuyo
  estado no se consigue leer tres veces, o al que se le acaba el plazo local mientras el servidor
  sigue diciendo que está pendiente, se cancela también en el servidor (no así cuando es el propio
  servidor el que contesta que ha caducado).
- Pestaña **Configuración de OpenCode** (**OpenCode: Abrir configuración…**, o el engranaje de las
  vistas Chat y Sesiones): los proveedores del servidor de opencode, con **Conectar** (clave de API
  en un cuadro nativo enmascarado que solo ve el extension host, OAuth `auto` o con código, métodos
  externos) y **Quitar**, y los servidores MCP de la carpeta con su estado, sus recursos y sus
  plantillas, actualizados en directo y solo para consultar. El comando que antes se llamaba
  **Abrir configuración** ahora es **Abrir configuración de la extensión** (con el mismo id) y está
  como enlace al pie de la pestaña. Las credenciales las guarda opencode y valen para todos tus
  proyectos; la extensión no guarda ninguna clave, ni la manda al webview, ni la escribe en los
  registros.
- Organiza el árbol de Sesiones (`chatLocation: editor`): **carpetas** y subcarpetas (**Nueva
  carpeta…**, **Nueva subcarpeta…**, **Cambiar nombre de la carpeta…**, **Eliminar carpeta**;
  **Mover a carpeta…** o arrastrando las filas, varias de golpe si quieres), **Anclar** y
  **Desanclar** (con una sección **Anclados** arriba) y **Archivar** y **Desarchivar** (con una
  sección **Archivados** plegada al final; la sesión archivada recuerda su carpeta). Por encima,
  una sección
  **Requiere atención** repite las sesiones que están en ejecución o esperando respuesta.
  **Filtrar sesiones…** deja solo las que están en ejecución, las que esperan respuesta o las que
  tienen pestaña abierta (**Borrar filtros** lo quita; el filtro activo sale también escrito encima
  de las filas). El tooltip de cada fila dice el coste y los tokens, la carpeta y, si la sesión
  tiene pestaña, cuántos archivos ha modificado. **Buscar sesiones…** encuentra también las
  archivadas, y lo indica. Las carpetas, los anclados y los archivados se guardan en VS Code, por
  carpeta del espacio de trabajo, y se pierden si mueves, renombras o vuelves a clonar la carpeta
  del proyecto (mira Known limitations); en ningún caso se borra una sesión por ello. En modo
  `sidebar` no cambia nada ni aparece ningún comando nuevo.
- Las peticiones, en la pestaña que toca: con `chatLocation: editor`, un permiso o una pregunta
  solo aparece en la pestaña de su sesión o en la de un ancestro del subagente que lo pidió (el
  chat de la barra lateral las sigue enseñando todas). La notificación nativa lleva el título
  `OpenCode · <título de la sesión>: …` y sale cuando el editor activo no es ninguna pestaña de
  chat que muestre la petición; **Abrir chat** te lleva a esa pestaña, o a la de la sesión raíz si
  el subagente no tiene pestaña, y pone el foco en la tarjeta. **Requiere respuesta** marca la fila
  raíz del árbol de Sesiones aunque la petición venga de un subagente de cualquier nivel. Una
  tarjeta de petición nueva ya no se queda con el foco si su chat no lo tenía (por ejemplo, una
  pestaña al lado de la que estás usando): la notificación sigue ahí y tu foco no se mueve. Con el
  chat de la barra lateral a la vista, una petición nueva muestra la tarjeta y la insignia, pero ni
  mueve el foco ni saca una notificación (issue #77).
- Árbol nativo de **Sesiones** en modo `editor`: la vista OpenCode lista las sesiones raíz de la
  carpeta, agrupadas en Hoy, Ayer, Últimos 7 días y Anteriores. Cada fila indica su estado con un
  icono (En ejecución, Requiere respuesta, Con error) y, si la barra lateral es lo bastante ancha,
  también con texto (además de Bifurcación y Pestaña) delante de la hora; un título largo puede
  tapar ese texto, pero el tooltip y la etiqueta para el lector de pantalla lo llevan siempre. El
  chat en pestaña no tiene botón **Sesiones**: para explorar, buscar, renombrar y eliminar sesiones
  está el árbol (el chat de la barra lateral conserva el botón). El árbol va al día con el servidor
  sin que tengas que refrescar (sesiones creadas, renombradas, eliminadas, en ejecución, esperando
  respuesta), abre una sesión en una pestaña o te lleva a la que ya tiene, renombra y elimina desde
  la propia fila (botones en línea, menú contextual, `F2` y `Delete`), busca por título en el
  servidor con **Buscar sesiones…**, carga 50 más con **Mostrar más sesiones**, sigue a la pestaña
  activa y muestra una bienvenida con botones cuando la carpeta no tiene sesiones, cuando opencode
  no está en marcha o cuando no hay ninguna carpeta abierta. La insignia es el número de peticiones
  pendientes. Límites conocidos: al eliminar una sesión se eliminan también las de sus subagentes,
  y una pestaña que estuviera mostrando una de ellas recibe el aviso "La sesión abierta se eliminó
  fuera de esta vista" (issue #77).
- Opción `openVsCode.chatLocation` (`editor` por defecto, o `sidebar`; cualquier otro valor cuenta
  como `editor`): con `editor`, cada sesión se abre en su propia pestaña del editor, al lado del
  código, y la vista OpenCode es el árbol de Sesiones (el punto anterior); con `sidebar` hay un
  único chat en la vista OpenCode. Si abres una sesión que ya tiene pestaña, te lleva a ella; Nueva
  sesión abre una pestaña nueva; Insertar código en el cursor y Agregar selección escriben en el
  último editor de texto, y los enlaces a archivos y los diffs se abren fuera del grupo del chat.
  Al abrir una fila del árbol se aprovecha la pestaña vacía que haya, en vez de dejarla ahí
  olvidada. El cambio de opción se aplica en el momento: la sesión de la barra lateral se abre en
  una pestaña y, si vuelves a `sidebar`, las pestañas siguen abiertas. Después de Recargar ventana
  las pestañas vuelven, cada una con su sesión, su borrador y su título (las que estaban en segundo
  plano, cuando las abres); si la sesión de una pestaña restaurada ya está abierta en otro sitio,
  la pestaña se cierra y te lleva a la otra, y si la sesión se ha eliminado, vuelve vacía y con un
  aviso. Con pestañas abiertas, la extensión se activa ahora al abrir la ventana. Límites
  conocidos: el borrador del cuadro del prompt no viaja contigo al cambiar la opción, y si cambias
  la carpeta que se sirve con pestañas abiertas, se quedan vacías (issue #77).
- Menús contextuales del editor y del Explorador: en el editor, **Agregar al chat de OpenCode**,
  **Explicar con OpenCode** y **Corregir con OpenCode** (Corregir añade los errores y avisos que VS
  Code tenga para la selección); en el Explorador, **Explicar con OpenCode** sobre uno o varios
  archivos. El prompt se envía en el momento a la sesión abierta. Si el chat está ocupado o sin
  conexión, si el archivo tiene cambios sin guardar o si el chat tardó más de 10 s en abrirse, se
  queda escrito en el cuadro del prompt, con un aviso (issue #36).
- Editor de configuración: las opciones salen en un orden fijo (ejecutable, dirección del servidor,
  modelo por defecto, ubicación del chat) y enlazan unas con otras (issue #38).
- Detección de opencode v2: busca `opencode2` u `opencode` (o el ejecutable de
  `openVsCode.opencodePath`), solo da por buena la versión mayor 2 y, en Windows, llega al
  ejecutable real que hay detrás de los shims `.cmd` de npm (issue #7).
- Un `opencode serve` por carpeta del espacio de trabajo: arranca en un puerto de loopback con una
  contraseña aleatoria y, al cerrar la ventana, se para con todo su árbol de procesos. Reiniciar
  servidor, Seleccionar carpeta del área de trabajo para los espacios de trabajo con varias
  carpetas raíz y un canal de salida OpenCode (issues #8, #10).
- Con `openVsCode.serverUrl` te conectas a un servidor de opencode v2 que ya esté en marcha en esta
  máquina; su contraseña se guarda en el SecretStorage de VS Code (issue #11).
- Vista de chat en la barra de actividad, con un cuadro para el prompt, respuestas en streaming y,
  dentro del chat, una línea que indica el estado de la conexión (issues #12, #13, #14).
- Comandos en la paleta: Abrir chat, Poner el foco en el prompt, Nueva sesión y Detener respuesta.
  Los atajos por defecto son Ctrl+Alt+P / Cmd+Alt+P (Poner el foco en el prompt; si lo repites,
  vuelves al editor) y Ctrl+Alt+N / Cmd+Alt+N (Nueva sesión, solo con el foco en el chat); puedes
  cambiar los dos (issue #35).
- Adjunta archivos con clic derecho en el Explorador (**Agregar al chat de OpenCode**) o
  arrastrándolos al cuadro del prompt **con Mayús pulsada**, y pega imágenes (PNG, JPEG, GIF, WebP,
  hasta 10 MiB) con Ctrl/Cmd+V (issue #30). Una imagen que sueltes desde el gestor de archivos del
  sistema se adjunta igual que una pegada; cualquier otro archivo que venga de ahí se rechaza con
  un aviso. Reintentar, "Bifurcar desde aquí" y "Revertir desde aquí" no vuelven a adjuntar las
  imágenes pegadas. Hay avisos de que, en VS Code 1.140 o posterior, lo que sueltas desde el
  Explorador ni siquiera llega a las vistas de las extensiones
  ([microsoft/vscode#339036](https://github.com/microsoft/vscode/issues/339036); aquí no se ha
  reproducido); el comando del menú, Adjuntar y las menciones con `@` siguen funcionando.
- Markdown que se va pintando durante el streaming, resaltado de sintaxis y acciones sobre el
  código (copiar, insertar en el cursor, abrir en un archivo nuevo, abrir referencias `path:line`)
  (issue #15).
- Botón Detener y tecla Escape para interrumpir un turno, una nota neutra "Detenido" y mensajes de
  error que se entienden (issue #16).
- Temas claro, oscuro y de alto contraste, navegación con teclado y etiquetas para lectores de
  pantalla (issue #17).
- Tarjetas de permiso, notificación e insignia cuando el chat no está a la vista y una lista de
  permisos guardados que puedes revocar (issues #18, #19).
- Tarjetas de pregunta, y una línea en el historial por cada permiso o pregunta que ya se ha
  contestado (issues #44, #56).
- Lista de sesiones con grupos, búsqueda, renombrar y eliminar; se recuerda qué sesión estaba
  abierta en cada espacio de trabajo (issues #20, #22).
- Bifurca una sesión desde cualquiera de tus mensajes y abre las sesiones de los subagentes desde
  la llamada a la herramienta que los lanzó (issue #21).
- Selectores de modelo y de agente (Build/Plan), la opción `openVsCode.defaultModel` y el control
  de la variante de razonamiento (issues #23, #24, #61).
- Tarjetas de herramientas plegables para shell, read, grep y edit, con el diff en las ediciones
  (issue #26).
- Menciones de archivos con `@` en el prompt y un botón "Agregar selección" que adjunta lo que
  tengas seleccionado en el editor (issues #28, #29).
- Una línea bajo el título de la sesión con el contexto que gastó el último paso y, en los modelos
  de pago, el coste de la sesión, subagentes directos incluidos (issue #25).
- Integración continua en Windows, macOS y Linux, que además comprueba la lista de archivos que
  van en el paquete (issue #5).
- Empaquetado para el Marketplace: icono, README, registro de cambios y licencia (issue #42).
- Flujo de publicación que, a partir de una etiqueta de versión, sube el mismo paquete al VS Code
  Marketplace y a Open VSX (issue #43).

#### Cambiado

- opencode arranca ahora con su vigilante de archivos desactivado
  (`OPENCODE_FILEWATCHER_DISABLE=1`), así que ya no importa un plugin de proyecto que aparezca
  mientras está en marcha (opencode 2.0.32 lo hacía en menos de medio segundo y sin preguntar).
  Quien vigila la carpeta servida es la extensión: si aparece un plugin que no has permitido, para
  el servidor (y corta el turno que hubiera en curso) y te vuelve a preguntar antes de que llegue a
  ejecutarse. A cambio, lo que toques en la configuración de opencode, en `AGENTS.md`, en las
  skills y en los comandos no se aplica hasta que lances **OpenCode: Reiniciar servidor**. Quedan
  fuera las carpetas de plugins que estén por encima de la servida, los eventos que se pierdan por
  `files.watcherExclude` o por enlaces simbólicos, y un plugin que se escriba mientras el servidor
  todavía está arrancando, que puede ejecutarse una vez (issue #158).
- Los mods tienen límites para que no lo inunden todo: 50 líneas por segundo como mucho en el canal
  **OpenCode Mods** (contando los avisos de la extensión sobre lo que manda el mod) y 30 mensajes
  por segundo a sus paneles; lo que pase de ahí se descarta, con un aviso por segundo. Los
  argumentos de los comandos se recortan a 4000 caracteres vengan por donde vengan, también desde
  **OpenCode: Ejecutar comando de mod…** (issue #155).
- Los comandos de los mods salen en el menú `/` y se ejecutan aunque opencode no esté en marcha
  (autoStart desactivado, arrancando, reconectando): si escribes un comando de mod, lo ejecuta su
  mod en vez de mandarse como prompt, que era lo que antes arrancaba el servidor. Los comandos de
  opencode aparecen cuando el servidor los envía (issue #155).
- Los mods aguantan mejor el apagado: una carga o un mensaje que termine cuando la extensión ya se
  ha parado no escribe en un canal de salida cerrado. El aviso que da la página de un panel cuando
  se descarta un mensaje se limita a uno por segundo y por panel. `docs/mods.md` explica ahora que,
  si dentro de la carpeta de un mod hay un enlace que apunta fuera, la página del panel de ese mod
  puede leer lo que haya al otro lado (issue #155).
- La licencia pasa de MIT a la [PolyForm Shield License 1.0.0](LICENSE): puedes usar, modificar y
  compartir la extensión para lo que quieras, menos para ofrecer un producto que compita con ella.
  Es de código disponible (source-available), no una licencia de código abierto de la OSI.
- El panel del chip ya no se cierra al elegir un agente, un modelo o un nivel de razonamiento, así
  que puedes cambiar los tres sin tener que abrirlo otra vez. Se sigue cerrando con el chip, con
  Escape, con un clic fuera o al llevar el foco a otro sitio.
- Vista de chat en la barra lateral: **Abrir configuración** es un botón de la barra de título y
  **Reiniciar servidor** se ha ido al menú "…", igual que en la vista Sesiones (issue #133).
