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
const { tailConversationForClient } = require('./llmService');

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

  // Who may embed this app in an iframe. Needed because the dashboard's
  // ST_BACKEND -> My Agents page frames it from a different origin
  // (dashboard.subjectivetechnologies.com), while a zone-wide Cloudflare rule
  // stamps `X-Frame-Options: SAMEORIGIN` onto every HTML response in
  // subjectivetechnologies.com — which alone forbids that.
  //
  // CSP frame-ancestors takes precedence over X-Frame-Options in any browser
  // that supports it, so sending this header is what actually allows the
  // embed. Same approach taggy.subjectivetechnologies.com already uses to be
  // embedded by the same dashboard.
  //
  // It has to be an HTTP header: frame-ancestors is explicitly ignored when
  // delivered via <meta http-equiv>, so the CSP already in web/index.html
  // cannot express this.
  const FRAME_ANCESTORS =
    "frame-ancestors 'self' https://dashboard.subjectivetechnologies.com https://dashboard.worktwins.com";

  function pathIsAsset(filePath) {
    return filePath.startsWith(assetsDir + path.sep);
  }

  function sendFile(res, filePath) {
    fs.readFile(filePath, (error, data) => {
      if (error) return notFound(res);
      const ext = path.extname(filePath).toLowerCase();
      const headers = {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': data.length,
        // no-store everywhere: index.html, renderer.js and layout.css ship as a
        // matched set; a cached renderer.js against a newer index.html crashes
        // on missing DOM nodes and renders nothing. Files are tiny and local.
        'Cache-Control': pathIsAsset(filePath) ? 'public, max-age=300' : 'no-store'
      };
      if (ext === '.html') headers['Content-Security-Policy'] = FRAME_ANCESTORS;
      res.writeHead(200, headers);
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

  // Shared with the interval refresh and the manual refresh API so a button click
  // cannot stack a second LocalChats pipeline on top of an in-flight run.
  let historyRefreshing = false;
  async function refreshHistory(reason) {
    if (historyRefreshing) return { ok: true, deferred: true, status: 'busy' };
    historyRefreshing = true;
    try {
      const started = Date.now();
      const result = await core.llmService.refreshHistory();
      if (result.status === 'deferred') {
        log('info', 'Local chat history refresh deferred', { reason });
        return { ok: true, deferred: true, status: 'deferred' };
      }
      if (!result.success) {
        log('error', 'Local chat history pipeline failed', {
          reason,
          status: result.status,
          error: result.error,
          ms: Date.now() - started
        });
        return { ok: false, status: result.status, error: result.error || 'History refresh failed.' };
      }
      const count = core.llmService.countConversations();
      log('info', 'Local chat history refreshed', { reason, count, ms: Date.now() - started });
      core._broadcast('llm-history-refreshed', { count });
      return { ok: true, count };
    } catch (error) {
      log('error', 'Local chat history pipeline crashed', {
        reason,
        message: error.message,
        stack: error.stack
      });
      return { ok: false, error: error.message };
    } finally {
      historyRefreshing = false;
    }
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
    'GET /api/llm/conversations': async (query) => {
      try {
        const limit = Math.min(500, Math.max(1, Number(query.limit || 200) || 200));
        const conversations = core.llmService.listConversations({
          query: String(query.q || '').trim(),
          limit
        });
        return { ok: true, conversations, total: conversations.total ?? conversations.length };
      } catch (error) {
        return { ok: false, error: error.message, conversations: [] };
      }
    },
    'GET /api/llm/conversation': async (query) => {
      try {
        const target = String(query.target || '');
        const live = await core.llmService.reloadConversation(target);
        const conversation = tailConversationForClient(
          live || core.llmService.findConversation(target, { includeMessages: true })
        );
        log(conversation ? 'info' : 'error', 'LLM conversation hydrate', {
          target,
          ok: Boolean(conversation),
          provider: conversation?.provider || '',
          label: conversation?.label || '',
          sessionId: conversation?.sessionId || '',
          messageCount: conversation?.messages?.length || 0,
          totalMessages: conversation?.messageCount || 0,
          truncated: Boolean(conversation?.truncated),
          origin: conversation?.origin || ''
        });
        return conversation ? { ok: true, conversation } : { ok: false, error: 'Conversation was not found.' };
      } catch (error) {
        log('error', 'LLM conversation hydrate crashed', { target: query.target, message: error.message });
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
          log('info', 'LLM conversation renamed', { target: result.conversation.target, label: result.conversation.label });
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
    'POST /api/llm/refresh-history': async () => refreshHistory('manual'),
    'POST /api/llm/reload-conversation': async (_query, body) => {
      try {
        const target = String(body?.target || '');
        const conversation = tailConversationForClient(await core.llmService.reloadConversation(target));
        log(conversation ? 'info' : 'error', 'LLM conversation live reload', {
          target,
          ok: Boolean(conversation),
          messageCount: conversation?.messages?.length || 0
        });
        if (conversation) core._broadcast('llm-conversation', { conversation });
        return conversation ? { ok: true, conversation } : { ok: false, error: 'Conversation was not found.' };
      } catch (error) {
        log('error', 'LLM conversation live reload crashed', { target: body?.target, message: error.message });
        return { ok: false, error: error.message };
      }
    },
    'GET /api/llm/status': async (query) => {
      const result = await core.llmService.status(query.provider);
      return { ok: Boolean(result.success), ...result };
    },
    'GET /api/llm/sessions': async (query) => {
      const listed = await core.llmService.listProviderSessions(query.provider);
      return { ok: true, ...listed };
    },
    'POST /api/llm/send-message': async (_query, body) => {
      const target = String(body?.target || '');
      const text = String(body?.text || '').trim();
      const files = body?.files || [];
      if (!target || !text) return { ok: false, status: 'invalid_request', error: 'Missing target or text.' };
      const conversation = core.llmService.findConversation(target);
      if (!conversation) return { ok: false, status: 'not_found', error: 'Conversation was not found.' };
      // Cloudflare (and most reverse proxies) close idle HTTP at ~100s with 524.
      // Cursor/Claude/Codex turns are allowed 30 minutes. Accept here and deliver
      // the assistant reply on the WebSocket (llm-message / llm-busy / system).
      log('info', 'LLM send accepted (async)', {
        target,
        provider: conversation.provider,
        promptChars: text.length,
        files: files.length
      });
      core.sendLlmMessage(target, text, files).then((result) => {
        log(result?.ok ? 'info' : 'error', 'LLM send background finished', {
          target,
          ok: Boolean(result?.ok),
          status: result?.status || '',
          error: result?.error || ''
        });
      }).catch((error) => {
        log('error', 'LLM send background crash', { target, message: error.message, stack: error.stack });
      });
      return { ok: true, pending: true, target };
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
      const result = core.continueConversationAsUser(String(body?.target || ''), username, body?.provider ? String(body.provider) : undefined);
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
    log('info', 'WebSocket client connected', { clients: wss.clients.size });
    socket.send(JSON.stringify({ type: 'config', ...core.publicConfig() }));
    socket.send(JSON.stringify({ type: 'status', state: core.connected ? 'connected' : 'idle', text: core.connected ? `Connected to ${core.config.host}:${core.config.port}` : 'Ready' }));
    socket.on('close', () => log('info', 'WebSocket client disconnected', { clients: wss.clients.size }));
  });

  core.on('event', (event) => {
    const payload = JSON.stringify(event);
    for (const socket of wss.clients) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  });

  return { server, wss, routes, refreshHistory };
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
  const { server, refreshHistory } = createApp(core);

  server.listen(PORT, BIND_HOST, () => {
    defaultLog('info', 'Subjective Chat web server listening', { host: BIND_HOST, port: PORT, appHome: core.applicationHome });
    // My Agents is the LLM UI. IRC is optional and the default host is often
    // down; reconnect storms painted the status bar as errors on every send.
    // Opt in with SUBJECTIVE_CHAT_IRC=1.
    if (process.env.SUBJECTIVE_CHAT_IRC === '1') {
      core.connectIrc();
    } else {
      defaultLog('info', 'IRC skipped (set SUBJECTIVE_CHAT_IRC=1 to enable)');
    }
    // Serve whatever the manifest already has right away (no blank sidebar),
    // then run the history pipeline. The pipeline is incremental: it walks
    // candidates newest-first and skips manifest-fingerprinted unchanged files,
    // so a run with an up-to-date archive costs seconds — never the full 38k
    // re-import that used to OOM. It also re-runs on a timer so chats written
    // while the server is up (new Cursor/Codex/Claude sessions, any user home
    // readable to this uid) appear without a restart.
    setImmediate(() => {
      core._broadcast('llm-history-refreshed', { count: core.llmService.countConversations() });
    });
    refreshHistory('startup');
    const refreshEveryMs = Number(process.env.SUBJECTIVE_CHAT_HISTORY_REFRESH_MS || 10 * 60 * 1000);
    if (refreshEveryMs > 0) setInterval(() => refreshHistory('interval'), refreshEveryMs).unref();
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
