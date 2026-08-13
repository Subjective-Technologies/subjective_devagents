#!/usr/bin/env node
// Standalone web adapter for ChatCore - "share the same backend" as the desktop Electron
// app means: same LlmService/SuSessionManager modules (spawns the same local codex/claude
// CLI subprocesses and su/pty sessions on this machine), and - by pointing at the same
// SUBJECTIVE_CHAT_HOME - the same conversation history/state file on disk. This process
// itself is a second, independent Node process (not literally the same OS process as the
// Electron app), so if both are actively sending messages in the same conversation at the
// exact same moment there's a small last-write-wins race on the shared state file; for a
// single-owner tool that's an acceptable trade for "my chats look the same everywhere"
// over building real file locking, which is why we're documenting it here instead.
//
// No Electron: HTTP mirrors every preload.js/ipcMain channel as a plain JSON request, and
// one WebSocket broadcasts ChatCore's event stream (config/status/message/llm-*/
// switchuser-*/dcc-*) to every connected browser tab - the same shape main.js sends over
// `app:event` and `switchuser:event`, just unified onto one channel since there is no
// native-window-per-terminal concept here (see chatCore.js's attachSuViewerBroadcast).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { isValidUsername } = require('./systemUsers');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const ASSETS_DIR = path.join(ROOT, 'assets');
const WEB_DIR = path.join(ROOT, 'web');
const MAX_BODY_BYTES = 32 * 1024 * 1024; // room for a small handful of base64 image/file attachments

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function defaultLog(level, message, details = {}) {
  const line = `${new Date().toISOString()} [${level}] ${message} ${Object.keys(details).length ? JSON.stringify(details) : ''}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

// Builds the http.Server + WebSocketServer wired to the given ChatCore instance, without
// starting to listen or touching the network/filesystem beyond what ChatCore itself does -
// callers (the __main__ block below, or a test) decide when/where to listen.
function createApp(core, options = {}) {
  const log = options.log || defaultLog;
  const srcDir = options.srcDir || SRC_DIR;
  const assetsDir = options.assetsDir || ASSETS_DIR;
  const webDir = options.webDir || WEB_DIR;

  // Every "Continue as..." session's pty output is broadcast to whichever browser tab
  // opened its terminal panel, the moment a login is actually needed - see chatCore.js.
  core.on('event', (event) => {
    if (event.type === 'switchuser-terminal-needed') core.attachSuViewerBroadcast(event.username);
  });

  // Path -> absolute file, restricted to an explicit allowlist rather than a generic
  // "serve anything under these directories" rule, so a request can never walk outside the
  // handful of files this app actually ships to the browser.
  const staticFiles = {
    '/': path.join(webDir, 'index.html'),
    '/index.html': path.join(webDir, 'index.html'),
    '/webBridge.js': path.join(webDir, 'webBridge.js'),
    '/contextMenu.css': path.join(webDir, 'contextMenu.css'),
    '/layout.css': path.join(webDir, 'layout.css'),
    '/terminal.html': path.join(webDir, 'terminal.html'),
    '/terminalWebBridge.js': path.join(webDir, 'terminalWebBridge.js'),
    '/styles.css': path.join(srcDir, 'styles.css'),
    '/terminal.css': path.join(srcDir, 'terminal.css'),
    '/messageRenderer.js': path.join(srcDir, 'messageRenderer.js'),
    '/renderer.js': path.join(srcDir, 'renderer.js'),
    '/terminal-renderer.js': path.join(srcDir, 'terminal-renderer.js')
  };

  function sendFile(res, filePath) {
    fs.readFile(filePath, (error, data) => {
      if (error) return notFound(res);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
      });
      res.end(data);
    });
  }

  function notFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }

  function serveStatic(res, pathname) {
    const target = staticFiles[pathname];
    if (target) return sendFile(res, target);

    // /assets/** mirrors the repo's assets/ directory (vendored libs, icons) - the only
    // directory tree served generically, and still fenced to assetsDir via a resolved-path
    // containment check so `/assets/../../etc/passwd`-style traversal can't escape it.
    if (pathname.startsWith('/assets/')) {
      const relative = pathname.slice('/assets/'.length);
      const resolved = path.resolve(assetsDir, relative);
      if (resolved === assetsDir || resolved.startsWith(assetsDir + path.sep)) {
        return sendFile(res, resolved);
      }
    }
    notFound(res);
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new Error('Request body too large.'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (_error) {
          reject(new Error('Invalid JSON body.'));
        }
      });
      req.on('error', reject);
    });
  }

  function sendJson(res, status, payload) {
    const body = Buffer.from(JSON.stringify(payload));
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
    res.end(body);
  }

  // Every handler receives (query, body) and returns a plain object to be sent as JSON -
  // deliberately the same request/response shape as an ipcMain.handle() callback so each
  // one reads as a direct translation of main.js's handlers.
  const routes = {
    'GET /api/config': async () => core.publicConfig(),
    'POST /api/save-config': async (_query, body) => {
      core.applyConnectionAndReconnect(body?.active || body || {}, body?.saveBookmark !== false);
      return { ok: true, config: core.publicConfig() };
    },
    'POST /api/connect': async () => { core.reconnectNow(); return { ok: true }; },
    'POST /api/disconnect': async () => { core.disconnectIrc(true); return { ok: true }; },
    'POST /api/send-message': async (_query, body) => {
      const target = body?.target || core.config.channel;
      const clean = String(body?.text || '').replace(/[\r\n]+/g, ' ').trim();
      if (!clean) return { ok: false };
      if (core.writeIrc(`PRIVMSG ${target} :${clean}`)) {
        core._broadcast('message', { target, from: core.currentNick, text: clean, mine: true, time: Date.now(), private: !target.startsWith('#') });
        return { ok: true };
      }
      return { ok: false };
    },
    'POST /api/execute-command': async (_query, body) => {
      const target = body?.target || core.config.channel;
      const result = core.executeSlashCommand(body?.command || '', target);
      return { ok: Boolean(result?.ok), focusTarget: result?.focusTarget || '' };
    },
    'GET /api/llm/conversations': async () => {
      try {
        return { ok: true, conversations: core.llmService.listConversations() };
      } catch (error) {
        return { ok: false, error: error.message, conversations: [] };
      }
    },
    'GET /api/llm/conversation': async (query) => {
      try {
        const conversation = core.llmService.findConversation(String(query.target || ''), { includeMessages: true });
        return conversation ? { ok: true, conversation } : { ok: false, error: 'Conversation was not found.' };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    'POST /api/llm/create-conversation': async (_query, body) => {
      try {
        const conversation = core.llmService.createConversation(body || {});
        core.activateLlmIrcChannel(conversation);
        core._broadcast('llm-conversation', { conversation });
        return { ok: true, conversation };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    'POST /api/llm/rename-conversation': async (_query, body) => {
      try {
        const result = core.llmService.renameConversation(String(body?.target || ''), String(body?.name || ''));
        if (result.ok && result.conversation) {
          core._broadcast('llm-conversation-renamed', { target: result.conversation.target, label: result.conversation.label });
        }
        return result;
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    'POST /api/llm/activate-conversation': async (_query, body) => {
      const conversation = core.llmService.findConversation(String(body?.target || ''));
      if (!conversation) return { ok: false, error: 'Conversation was not found.' };
      core.llmService.markActive(conversation.target);
      return core.activateLlmIrcChannel(conversation);
    },
    'GET /api/llm/status': async (query) => {
      const result = await core.llmService.status(query.provider);
      return { ok: Boolean(result.success), ...result };
    },
    'POST /api/llm/send-message': async (_query, body) => {
      const target = String(body?.target || '');
      const text = String(body?.text || '').trim();
      return core.sendLlmMessage(target, text, body?.files || []);
    },
    'GET /api/system/users': async () => {
      const { listSystemUsers } = require('./systemUsers');
      try {
        return await listSystemUsers();
      } catch (error) {
        return { ok: false, users: [], error: error.message };
      }
    },
    'GET /api/switchuser/status': async (query) => {
      const username = query.username ? String(query.username) : '';
      if (username) return { ok: true, status: core.suSessionManager.getStatus(username) };
      return { ok: true, statuses: core.suSessionManager.listStatuses() };
    },
    'GET /api/context-menu': async (query) => {
      const model = await core.buildContextMenuModel(String(query.target || ''));
      return { ok: true, ...model };
    },
    'POST /api/switchuser/continue-as': async (_query, body) => {
      const username = String(body?.username || '');
      const result = core.continueConversationAsUser(String(body?.target || ''), username);
      // Attach the broadcast viewer eagerly too: continueConversationAsUser only does this
      // via the switchuser-terminal-needed event when a login is actually needed, but
      // attaching is a cheap deduped no-op, and this way a browser tab that opens the
      // terminal panel right after this call never misses a race on the first chunk.
      if (isValidUsername(username)) core.attachSuViewerBroadcast(username);
      return result;
    },
    'POST /api/switchuser/disconnect': async (_query, body) => {
      const username = String(body?.username || '');
      core.suSessionManager.disconnect(username);
      core.detachSuViewerBroadcast(username);
      return { ok: true };
    },
    'POST /api/switchuser/pty-input': async (_query, body) => {
      core.suSessionManager.writeInput(String(body?.username || ''), String(body?.data || ''));
      return { ok: true };
    },
    'POST /api/switchuser/pty-resize': async (_query, body) => {
      core.suSessionManager.resize(String(body?.username || ''), Number(body?.cols) || 0, Number(body?.rows) || 0);
      return { ok: true };
    },
    'POST /api/dcc/send-image-data': async (_query, body) => {
      const buffer = Buffer.from(body.bytes);
      return core.sendDccBuffer({
        target: body.target || core.config.channel,
        buffer,
        fileName: body.fileName || `pasted-${Date.now()}.png`,
        mimeType: body.mimeType
      });
    },
    'POST /api/file/open': async () => ({ ok: false, error: 'Opening local files is only available in the Subjective Chat desktop app.' }),
    'POST /api/file/reveal': async () => ({ ok: false, error: 'Show in folder is only available in the Subjective Chat desktop app.' }),
    'POST /api/log': async (_query, body) => {
      log(body.level || 'info', body.message || 'Browser log', body.details || {});
      return { ok: true };
    }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const routeKey = `${req.method} ${url.pathname}`;
    const handler = routes[routeKey];
    if (!handler) {
      if (req.method === 'GET') return serveStatic(res, url.pathname);
      return notFound(res);
    }
    try {
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const query = Object.fromEntries(url.searchParams.entries());
      const result = await handler(query, body);
      sendJson(res, 200, result);
    } catch (error) {
      log('error', 'API handler failed', { route: routeKey, message: error.message, stack: error.stack });
      sendJson(res, 400, { ok: false, error: error.message });
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'config', ...core.publicConfig() }));
    socket.send(JSON.stringify({ type: 'status', state: core.connected ? 'connected' : 'idle', text: core.connected ? `Connected to ${core.config.host}:${core.config.port}` : 'Ready' }));
  });

  core.on('event', (event) => {
    const payload = JSON.stringify(event);
    for (const socket of wss.clients) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  });

  return { server, wss, routes };
}

module.exports = { createApp };

if (require.main === module) {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(ROOT, '.env') });
  const { ChatCore } = require('./chatCore');

  const PORT = Number(process.env.SUBJECTIVE_CHAT_WEB_PORT || 8787);
  const BIND_HOST = process.env.SUBJECTIVE_CHAT_WEB_HOST || '0.0.0.0';

  const core = new ChatCore({ root: ROOT, log: defaultLog });
  core.loadSettings();
  const { server } = createApp(core);

  server.listen(PORT, BIND_HOST, () => {
    defaultLog('info', 'Subjective Chat web server listening', { host: BIND_HOST, port: PORT, appHome: core.applicationHome });
    core.connectIrc();
    core.llmService.refreshHistory().then((result) => {
      if (!result.success) {
        defaultLog('error', 'Local chat history pipeline failed', { status: result.status, error: result.error });
        return;
      }
      core._broadcast('llm-history-refreshed', { count: core.llmService.listConversations().length });
    }).catch((error) => {
      defaultLog('error', 'Local chat history pipeline crashed', { message: error.message, stack: error.stack });
    });
  });

  function shutdown() {
    defaultLog('info', 'Shutting down');
    core.shutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (error) => defaultLog('error', 'Uncaught exception', { message: error.message, stack: error.stack }));
  process.on('unhandledRejection', (reason) => defaultLog('error', 'Unhandled rejection', { reason: String(reason) }));
}
