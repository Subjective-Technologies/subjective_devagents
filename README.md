# Subjective Chat

Dark Electron IRC client for the local Ergo server. It reads defaults from `.env`, connects as `Tomasso`, and joins `#subjective`.

## Local LLM channels

Subjective Chat runs three unmodified exported datasource pipelines:

- `pipelines/history`: bundled `SubjectiveLocalchatsDataSource`; discovers CLI histories and exports normalized chat contexts.
- `pipelines/codex`: bundled `SubjectiveCodexDataSource`; creates and resumes Codex CLI sessions.
- `pipelines/claude`: bundled `SubjectiveClaudeCliDataSource`; creates and resumes Claude CLI sessions.

Application and pipeline runtime data are isolated under application ID home:

```text
~/.subjective_chat/
├── .subjective_chat_claude/
│   ├── context/
│   ├── logs/
│   └── workspace/
├── .subjective_chat_codex/
│   ├── context/
│   ├── logs/
│   └── workspace/
├── .subjective_chat_history/
│   ├── context/       LocalChats JSON exports and manifest
│   ├── logs/
│   └── workspace/
├── logs/              Subjective Chat application logs
├── sent/              outbound IRC/DCC files
├── settings.json
└── llm-conversations.json
```

Exported launchers remain unchanged and retain their standard `$HOME/.<pipeline_name>` storage contract. Application runtime temporarily presents `~/.subjective_chat` as home while each launcher resolves paths, producing nested pipeline homes shown above. Real user home is restored before provider CLIs run, preserving existing Codex authentication and LocalChats discovery. Nothing writes into platform `~/.Subjective` runtime tree. Every transcript appears beside IRC conversations as a channel-like room. Full messages load only when room opens, keeping large histories responsive. History pipeline refreshes asynchronously at startup.

Codex and Claude histories are writable when they carry a native session identifier. Select one and send a message to resume it through the matching exported pipeline. Use `+` beside Conversations to create a new agent room and pick Codex or Claude; the first message creates the native session, later messages resume it. Authentication remains owned by each local CLI (`codex login status`, `claude auth status`). Codex runs with sandbox `workspace-write`; Claude runs with permission mode `acceptEdits`, both in the selected workspace.

LLM messages render CommonMark Markdown with syntax-highlighted fenced code, inline code, lists, tables, quotes, and safe external links. Absolute local paths and Markdown links targeting local paths become Show in folder controls; files are revealed, directories are opened, and missing targets open their existing parent directory when possible. Code cards include Copy. Flattened CLI tool-call sequences (`bash`, `-lc`, command in either order), JSON command payloads, and standalone shell commands are normalized into syntax-highlighted command cards without stray wrapper lines. Shell/terminal cards also include Run: it shows exact command and workspace in confirmation dialog, then asks writable agent session to execute it through existing datasource sandbox. Latest agent questions expose contextual Yes/No, Allow/Deny, Run/Don't run, or Keep code/Revert buttons. Historical read-only rooms show actions disabled.

Opening Codex room also joins stable IRC channel such as `#codex-feature-name-a1b2c3d4`. Phone or desktop IRC users can join that channel and talk to same Codex session while Subjective Chat desktop process remains connected. Only opened LLM rooms join IRC, avoiding thousands of history-channel joins. Codex icon comes from exported datasource plugin.

Conversation sidebar uses one global newest-activity-first order across IRC and every LLM provider. Per-chat timestamps come from exported transcript identity rather than shared Cursor database modification time. Search matches chat name, provider, workspace, IRC channel, description, and loaded message text; press `Ctrl/Cmd+K` to focus search, `Enter` to open first result, or `Escape` to clear it.

Security: IRC messages in active Codex channels can cause `workspace-write` Codex work. Use authenticated/private IRC server and trusted users only. Last 20 activated LLM channels persist across restarts so phone clients can reconnect without reopening each room on desktop.

Install bundle dependencies once, then run:

```bash
python3 -m venv .venv
.venv/bin/pip install -r pipelines/codex/runtime/requirements.lock
npm start
```

`pipelines/codex`, `pipelines/claude`, and `pipelines/history` are self-contained Python bundle exports produced by `subjective_control_lib` / `subcli pipeline export-bundle`. Plugin source and dependency locks are embedded in each bundle. Encrypted embedded connection export is supported by exporter, but these pipelines need no connection payload: Codex and Claude authentication remains in each provider's CLI secure login. Native binary generation is currently not implemented (`native_executable_generated: false` in bundle manifest).

Optional overrides:

```bash
SUBJECTIVE_CHAT_HOME=/path/to/.subjective_chat \
SUBJECTIVE_CHAT_PYTHON=/path/to/python \
npm start
```

The app includes a neon `Sirc` tray icon. Closing the main window hides it to the tray; use the tray menu to show, reconnect, disconnect, or quit.

Application logs use timestamped convention under `~/.subjective_chat/logs`. Exported pipeline logs retain their own convention under each pipeline's nested `logs/` directory.

The client now keeps a persistent IRC connection and automatically reconnects unless you explicitly disconnect. The right pane shows channel users from IRC `NAMES`; click a user or the `DM` button to open a private-message tab.

Use the gear button in the chat header to edit IRC connection settings and save connection bookmarks. The defaults are `192.168.0.250:6667`, `#subjective`, and nick `Tomasso`. Desktop builds read `.env` as the initial fallback, then persist changes in Electron's app data folder. Android builds persist the same settings in app storage.

Images can be sent with the `+` button or by pasting an image while the message box is focused. When the active tab is a channel, the app announces a DCC transfer to each current channel user. When the active tab is a DM, it sends the DCC transfer only to that user. Sent and received images are shown inline in the transcript.

The accent selector in the sidebar supports neon gold, purple, pink, and green themes.

## Run

```bash
npm start
```

## Check

```bash
npm run check
npm audit --omit=dev
```

## Android APK

The Android version is a Capacitor wrapper around the existing chat UI with a native Android IRC bridge for TCP/TLS sockets.

Prerequisites:

```bash
sudo apt-get install -y openjdk-21-jdk android-sdk google-android-cmdline-tools-13.0-installer
```

Build a debug APK:

```bash
npm run mobile:apk
```

The generated APK will be written to:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

This project pins Gradle to OpenJDK 21 in `android/gradle.properties`, and uses the SDK path from `android/local.properties`.

The Android bridge uses the in-app connection settings and no longer needs a rebuild just to change IRC host, port, TLS, channel, or nickname.

Android keeps a CPU/Wi-Fi wake lock while connected and posts local notifications for incoming messages and received images. On Android 13 and newer, allow the notification permission when prompted.

## DCC Images

Use the `+` button in the top-right corner to send an image via DCC to the configured channel. Incoming DCC image transfers are saved under `received/` and rendered inline in the transcript.

If other clients are on a different machine, leave `DCC_PUBLIC_HOST` empty so the app picks a LAN IPv4 address automatically, or set it explicitly in `.env`.
