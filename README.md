# Subjective Chat

Dark Electron IRC client for the local Ergo server. It reads defaults from `.env`, connects as `Tomasso`, and joins `#subjective`.

The app includes a neon `Sirc` tray icon. Closing the main window hides it to the tray; use the tray menu to show, reconnect, disconnect, or quit.

Runtime logs are written to `logs/main.log` in JSON-lines format. Renderer crashes, uncaught errors, IRC connection state, and message-send attempts are recorded there.

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
