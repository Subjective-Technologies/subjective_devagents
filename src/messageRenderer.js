(function exposeMessageRenderer(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('markdown-it'), require('highlight.js'));
    return;
  }
  root.SubjectiveMessageRenderer = factory(root.markdownit, root.hljs);
}(typeof globalThis !== 'undefined' ? globalThis : window, function createMessageRenderer(MarkdownIt, hljs) {
  const SHELL_LANGUAGES = new Set([
    'bash', 'console', 'fish', 'powershell', 'ps1', 'shell', 'sh', 'terminal', 'zsh'
  ]);

  const LANGUAGE_ALIASES = Object.freeze({
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    shell: 'bash',
    sh: 'bash',
    ts: 'typescript',
    tsx: 'typescript',
    yml: 'yaml'
  });

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function isLocalPath(value) {
    return /^(?:file:\/\/\/|\/|[A-Za-z]:[\\/])/.test(String(value || ''));
  }

  function localPathMarkup(value, label = value) {
    return `<button type="button" class="local-path-link" data-local-path="${escapeHtml(value)}" title="Show in folder">${escapeHtml(label)}</button>`;
  }

  function insideLink(tokens, index) {
    let depth = 0;
    for (let cursor = 0; cursor < index; cursor += 1) {
      if (tokens[cursor].type === 'link_open') depth += 1;
      if (tokens[cursor].type === 'link_close') depth = Math.max(0, depth - 1);
    }
    return depth > 0;
  }

  function renderTextWithLocalPaths(tokens, index) {
    const value = String(tokens[index].content || '');
    if (insideLink(tokens, index)) return escapeHtml(value);
    const pattern = /(?:file:\/\/\/[^\s<>"'`()\[\]{}]+|[A-Za-z]:[\\/][^\s<>"'`()\[\]{}]+|\/(?:[^\s<>"'`()\[\]{}]+))/g;
    let markup = '';
    let cursor = 0;
    for (const match of value.matchAll(pattern)) {
      let candidate = match[0];
      const trimmed = candidate.replace(/[.,;!?]+$/, '');
      const suffix = candidate.slice(trimmed.length);
      candidate = trimmed;
      if (!candidate || candidate === '/') continue;
      markup += escapeHtml(value.slice(cursor, match.index));
      markup += localPathMarkup(candidate);
      markup += escapeHtml(suffix);
      cursor = match.index + match[0].length;
    }
    markup += escapeHtml(value.slice(cursor));
    return markup;
  }

  function languageName(info) {
    return String(info || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9_+.#-]/g, '');
  }

  function looksLikeCommand(code) {
    const lines = String(code || '').trim().split(/\r?\n/).filter(Boolean);
    if (!lines.length || lines.length > 20) return false;
    return lines.every((line) => /^\s*(?:\$\s+|>\s+)?(?:(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=|cd|chmod|curl|docker|git|gh|go|gradle|java|make|mkdir|npm|npx|pnpm|python\d*|pip\d*|pytest|ruby|rustc|sudo|yarn|\.\/|[A-Za-z]:\\|[\w./-]+\s+--?[\w-]+)/.test(line));
  }

  function isCommandBlock(language, code) {
    return SHELL_LANGUAGES.has(language) || (!language && looksLikeCommand(code));
  }

  function shellName(value) {
    const text = String(value || '').trim().toLowerCase();
    const match = text.match(/(?:^|[\\/])(bash|cmd(?:\.exe)?|fish|powershell(?:\.exe)?|pwsh(?:\.exe)?|sh|zsh)$/);
    return match ? match[1].replace('.exe', '') : '';
  }

  function shellFlag(value) {
    return /^-(?:c|lc|command)$/.test(String(value || '').trim().toLowerCase());
  }

  function structuredCommand(value) {
    const text = String(value || '').trim();
    if (!text || (!text.startsWith('{') && !text.startsWith('['))) return null;
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        if (parsed.length >= 3 && shellName(parsed[0]) && shellFlag(parsed[1])) {
          return { command: String(parsed.slice(2).join(' ')), shell: `${shellName(parsed[0])} ${parsed[1]}` };
        }
        return null;
      }
      const command = parsed.cmd || parsed.command || parsed.script;
      if (typeof command === 'string') return { command, shell: '' };
      if (Array.isArray(command) && command.length >= 3 && shellName(command[0]) && shellFlag(command[1])) {
        return { command: String(command.slice(2).join(' ')), shell: `${shellName(command[0])} ${command[1]}` };
      }
    } catch (_error) {
      return null;
    }
    return null;
  }

  function normalizeToolMessages(messages) {
    const source = Array.isArray(messages) ? messages : [];
    const normalized = [];
    const textAt = (index) => String(source[index]?.text || source[index]?.content || '').trim();
    for (let index = 0; index < source.length; index += 1) {
      const message = source[index] || {};
      const text = textAt(index);
      const role = String(message.role || '').toLowerCase();
      const kind = String(message.kind || '').toLowerCase();
      if (kind === 'command' && String(message.command || text).trim()) {
        normalized.push({
          type: 'command',
          command: String(message.command || text).trim(),
          shell: String(message.shell || 'bash'),
          message
        });
        continue;
      }
      if ((kind === 'output' || role === 'tool_output') && text) {
        normalized.push({ type: 'code', code: text, language: 'text', label: 'Output', message });
        continue;
      }
      if (kind === 'tool' && text) {
        normalized.push({ type: 'code', code: text, language: 'text', label: message.toolName || message.tool_name || 'Tool', message });
        continue;
      }
      if (kind === 'code' && text) {
        normalized.push({
          type: 'code',
          code: text,
          language: message.language || 'diff',
          label: message.toolName || message.tool_name || 'Change',
          message
        });
        continue;
      }
      const toolLikeRole = ['command', 'function', 'system', 'tool', 'unknown'].includes(role);
      const parsed = toolLikeRole ? structuredCommand(text) : null;
      if (parsed) {
        normalized.push({ type: 'command', ...parsed, message });
        continue;
      }
      const shell = shellName(text);
      if (toolLikeRole && shell && shellFlag(textAt(index + 1)) && looksLikeCommand(textAt(index + 2))) {
        normalized.push({
          type: 'command',
          command: textAt(index + 2),
          shell: `${shell} ${textAt(index + 1)}`,
          message: source[index + 2] || message
        });
        index += 2;
        continue;
      }
      if (toolLikeRole && looksLikeCommand(text)) {
        let commandShell = '';
        if (shellName(textAt(index + 1)) && shellFlag(textAt(index + 2))) {
          commandShell = `${shellName(textAt(index + 1))} ${textAt(index + 2)}`;
          index += 2;
        }
        normalized.push({ type: 'command', command: text, shell: commandShell, message });
        continue;
      }
      if (toolLikeRole && (shell || shellFlag(text))) continue;
      normalized.push({ type: 'message', message });
    }
    return normalized;
  }

  // Rendering a message is pure: same source in, same markup out. The transcript is
  // rebuilt from scratch whenever anything changes, so without this every redraw re-parses
  // every message with markdown-it and re-runs highlight.js over every fenced block —
  // measured at ~110ms for a 200-message chat, on the main thread, per new message.
  // A bounded map keeps that cost to the first render of each distinct message.
  function memoize(compute, capacity) {
    const cache = new Map();
    return (...args) => {
      const key = args.length === 1 ? String(args[0]) : args.map(String).join('\u0000');
      if (cache.has(key)) {
        const hit = cache.get(key);
        // Refresh recency so the working set survives eviction.
        cache.delete(key);
        cache.set(key, hit);
        return hit;
      }
      const value = compute(...args);
      cache.set(key, value);
      if (cache.size > capacity) cache.delete(cache.keys().next().value);
      return value;
    };
  }

  function highlightSource(code, language) {
    const requested = LANGUAGE_ALIASES[language] || language;
    if (hljs && requested && typeof hljs.getLanguage === 'function' && hljs.getLanguage(requested)) {
      try {
        return hljs.highlight(code, { language: requested, ignoreIllegals: true }).value;
      } catch (_error) {
        return escapeHtml(code);
      }
    }
    if (hljs && typeof hljs.highlightAuto === 'function' && code.length <= 50000) {
      try {
        return hljs.highlightAuto(code).value;
      } catch (_error) {
        return escapeHtml(code);
      }
    }
    return escapeHtml(code);
  }

  function fenceMarkup(tokens, index) {
    const token = tokens[index];
    const code = String(token.content || '').replace(/\n$/, '');
    const language = languageName(token.info);
    const command = isCommandBlock(language, code);
    const label = language || (command ? 'command' : 'code');
    const languageClass = language ? ` language-${escapeHtml(language)}` : '';
    const lineCount = code ? code.split('\n').length : 0;
    return [
      `<section class="code-card${command ? ' command-card' : ''}" data-language="${escapeHtml(label)}">`,
      '<header class="code-toolbar">',
      `<span class="code-lang"><i class="code-lang-dot" aria-hidden="true"></i>${escapeHtml(label)}</span>`,
      '<div class="code-actions">',
      lineCount > 1 ? `<span class="code-lines">${lineCount} lines</span>` : '',
      '<button type="button" data-code-action="wrap" title="Toggle soft wrap">Wrap</button>',
      '<button type="button" data-code-action="copy">Copy</button>',
      command ? '<button type="button" class="code-run" data-code-action="run">Run</button>' : '',
      command ? '<button type="button" class="code-run-direct" data-code-action="run-direct" title="Run this command directly on the server — no agent turn, no model involved">Run with no agent</button>' : '',
      '</div>',
      '</header>',
      `<pre><code class="hljs${languageClass}">${highlightedCode(code, language)}</code></pre>`,
      '</section>'
    ].join('');
  }

  const highlightCached = memoize(highlightSource, 400);

  function highlightedCode(code, language) {
    return highlightCached(String(code ?? ''), String(language ?? ''));
  }

  // Terminal output from an SSH chat. It goes through the same code card as a
  // fenced block — so it gets Copy, Wrap and the line count for free — but starts
  // wrapped, because a terminal line is often wider than a chat bubble and a
  // horizontal scrollbar inside every reply is worse than a wrapped line.
  function renderTerminalSource(text) {
    const body = String(text ?? '');
    const lineCount = body ? body.split('\n').length : 0;
    return [
      '<section class="code-card terminal-card wrapped" data-language="terminal">',
      '<header class="code-toolbar">',
      '<span class="code-lang"><i class="code-lang-dot" aria-hidden="true"></i>terminal</span>',
      '<div class="code-actions">',
      lineCount > 1 ? `<span class="code-lines">${lineCount} lines</span>` : '',
      '<button type="button" data-code-action="wrap" class="active" title="Toggle soft wrap">Wrap</button>',
      '<button type="button" data-code-action="copy">Copy</button>',
      '</div>',
      '</header>',
      // Not highlighted: terminal output is not a language, and guessing one
      // colours arbitrary words in a log for no reason.
      `<pre><code class="hljs">${escapeHtml(body)}</code></pre>`,
      '</section>'
    ].join('');
  }

  function renderCommandSource(command, shell = 'bash') {
    const language = /powershell|pwsh|ps1/i.test(shell) ? 'powershell' : /cmd/i.test(shell) ? 'dos' : 'bash';
    return fenceMarkup([{ content: String(command || ''), info: language }], 0);
  }

  function renderCodeSource(code, language = 'text') {
    return fenceMarkup([{ content: String(code || ''), info: String(language || 'text') }], 0);
  }

  const renderCommandCached = memoize(renderCommandSource, 300);
  const renderTerminalCached = memoize(renderTerminalSource, 300);

  function renderTerminal(value) {
    return renderTerminalCached(String(value ?? ''));
  }
  const renderCodeCached = memoize(renderCodeSource, 300);

  function renderCommand(command, shell = 'bash') {
    return renderCommandCached(String(command || ''), String(shell || 'bash'));
  }

  function renderCode(code, language = 'text') {
    return renderCodeCached(String(code || ''), String(language || 'text'));
  }

  function fallbackMarkup(value) {
    const linked = escapeHtml(value).replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    return `<p>${linked.replace(/\r?\n/g, '<br>')}</p>`;
  }

  function makeMarkdown() {
    if (typeof MarkdownIt !== 'function') return null;
    const markdown = new MarkdownIt({
      breaks: true,
      html: false,
      linkify: true,
      typographer: false
    });
    markdown.renderer.rules.fence = fenceMarkup;
    markdown.renderer.rules.text = renderTextWithLocalPaths;
    const defaultLinkOpen = markdown.renderer.rules.link_open
      || ((tokens, index, options, _environment, renderer) => renderer.renderToken(tokens, index, options));
    markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
      const href = tokens[index].attrGet('href') || '';
      if (isLocalPath(href)) {
        const currentClass = tokens[index].attrGet('class') || '';
        tokens[index].attrSet('class', `${currentClass} local-path-link`.trim());
        tokens[index].attrSet('data-local-path', href);
        tokens[index].attrSet('href', '#');
        tokens[index].attrSet('title', 'Show in folder');
      } else {
        tokens[index].attrSet('target', '_blank');
        tokens[index].attrSet('rel', 'noopener noreferrer');
      }
      return defaultLinkOpen(tokens, index, options, environment, renderer);
    };
    return markdown;
  }

  const markdown = makeMarkdown();

  function renderMessageSource(value) {
    const source = String(value ?? '');
    return markdown ? markdown.render(source) : fallbackMarkup(source);
  }

  const renderMessageCached = memoize(renderMessageSource, 600);

  // Normalize BEFORE the cache: keying on the raw argument would make
  // renderMessage(undefined) and renderMessage('undefined') share an entry.
  function renderMessage(value) {
    return renderMessageCached(String(value ?? ''));
  }

  function proseOnly(value) {
    return String(value || '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]*`/g, '')
      .trim();
  }

  // "Something else..." is appended to every button set: it doesn't send a canned reply
  // like the other actions, it just hands focus back to the composer so the user can type
  // whatever the canned options don't cover.
  const OTHER_ACTION = { id: 'other', label: 'Something else…', custom: true };

  // A message can end in a real multiple-choice question - "Which - A or B?",
  // "1, 2, 3, or 4?" - where the options were spelled out earlier as lettered/numbered
  // lines ("A. ...", "B. ..."). Only trust this when the closing question explicitly names
  // 2+ of those labels right before the final "?": a numbered list of unrelated findings
  // that happens to be followed by an unrelated yes/no question ("Want me to?") must NOT
  // be mistaken for a menu, so the labels have to appear in the question itself, not just
  // exist as list markers somewhere earlier in the message.
  function choiceFromLabel(prose, label, index) {
    const lineMatch = prose.match(new RegExp(`^[ \\t]*(?:[-*]\\s*)?${label}[.)]\\s+(.+)$`, 'mi'));
    const summary = lineMatch ? lineMatch[1].replace(/[:.,;]?\s*$/, '').trim().slice(0, 80) : '';
    return {
      id: `choice-${label.toLowerCase()}`,
      label: summary ? `${label} — ${summary}` : `Option ${label}`,
      reply: label,
      primary: index === 0
    };
  }

  function consecutiveLetteredOptions(prose) {
    const found = [...String(prose || '').matchAll(/^[ \t]*(?:[-*]\s*)?([A-Z])[.)]\s+\S/gm)].map((match) => match[1]);
    if (found.length < 2 || found[0] !== 'A') return [];
    const labels = [];
    for (let index = 0; index < found.length; index += 1) {
      const expected = String.fromCharCode(65 + index);
      if (found[index] !== expected) break;
      labels.push(expected);
    }
    return labels.length >= 2 ? labels : [];
  }

  function detectEnumeratedChoices(prose, tail) {
    // Collapse "X, Y, or Z" down to a plain "X, Y, Z" comma list first - matching a
    // separator that can be ",", "/", " or ", or ", or " all at once in a single regex
    // reliably is fiddly (the comma-then-"or" combo needs two separator tokens back to
    // back), so it's simpler to normalize the English "or" away before splitting.
    const normalizedTail = tail.replace(/,?\s+or\s+/gi, ', ');
    const named = normalizedTail.match(/\b([A-Z](?:\s*[,/]\s*[A-Z]){1,7})\s*\?\s*$/i)
      || normalizedTail.match(/\b([1-9](?:\s*[,/]\s*[1-9]){1,8})\s*\?\s*$/i);
    if (named) {
      const labels = [...new Set(named[1].toUpperCase().split(/\s*[,/]\s*/).filter(Boolean))];
      if (labels.length >= 2) return labels.map((label, index) => choiceFromLabel(prose, label, index));
    }
    const lettered = consecutiveLetteredOptions(prose);
    if (lettered.length >= 2 && /\b(?:which|choose|pick|select|option)\b/i.test(tail)) {
      return lettered.map((label, index) => choiceFromLabel(prose, label, index));
    }
    return [];
  }

  function detectPromptActions(value) {
    const prose = proseOnly(value);
    if (!prose) return [];
    const tail = prose.slice(-900);
    const asksQuestion = /\?\s*$/.test(tail)
      || /\b(?:choose|confirm|permission required|waiting for approval|would you like|do you want|shall i|should i|may i)\b/i.test(tail);
    if (!asksQuestion) return [];

    const enumerated = detectEnumeratedChoices(prose, tail);
    if (enumerated.length) return [...enumerated, OTHER_ACTION];

    if (/\b(?:keep|accept)\b[^\n]{0,50}\b(?:code|changes?|implementation|edits?)\b|\b(?:code|changes?|implementation|edits?)\b[^\n]{0,50}\b(?:keep|accept)\b/i.test(tail)) {
      return [
        { id: 'keep', label: 'Keep code', reply: 'Keep the code and continue.', primary: true },
        { id: 'revert', label: 'Revert', reply: 'Revert those changes.' },
        OTHER_ACTION
      ];
    }
    if (/\b(?:allow|approve|approval|authorize|authorization|permission|permit)\b/i.test(tail)) {
      return [
        { id: 'allow', label: 'Allow', reply: 'Allow it and continue.', primary: true },
        { id: 'deny', label: 'Deny', reply: 'Do not allow it.' },
        OTHER_ACTION
      ];
    }
    if (/\b(?:run|execute|launch|start)\b/i.test(tail)) {
      return [
        { id: 'run', label: 'Run', reply: 'Run it and report the result.', primary: true },
        { id: 'do-not-run', label: "Don't run", reply: 'Do not run it.' },
        OTHER_ACTION
      ];
    }
    return [
      { id: 'yes', label: 'Yes', reply: 'Yes, proceed.', primary: true },
      { id: 'no', label: 'No', reply: 'No, do not proceed.' },
      OTHER_ACTION
    ];
  }

  return {
    detectPromptActions,
    escapeHtml,
    isCommandBlock,
    isLocalPath,
    languageName,
    looksLikeCommand,
    normalizeToolMessages,
    renderCode,
    renderCommand,
    renderMessage,
    renderTerminal
  };
}));
