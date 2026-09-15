// The agent registry in workflow/agents — the desktop build's own reader/writer.
//
// An agent is two files that must stay in step: a row in registry.md and a role file in
// roles/. Drift between them is the failure this module exists to prevent, so a create
// writes both or neither.
//
// registry.md states that models/providers are runtime metadata and must not be part of
// agent identity, so the model lives in the role file's "## Runtime" section — never in
// the registry table or the agent id.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const AGENT_ID_RE = /^[a-z][a-z0-9_]{1,62}$/;
const MODEL_RE = /^\s*Model:\s*`?([A-Za-z0-9_.-]+)`?\s*$/m;
const ROW_RE = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*([^|]*?)\s*\|\s*$/;
const RUNTIME_SECTION_RE = /\n## Runtime\b[\s\S]*?(?=\n## |$)/;
const MODEL_VALUE_RE = /^[a-z0-9_.-]{1,40}$/;

function agentsDir() {
  if (process.env.SUBJECTIVE_AGENTS_DIR) return process.env.SUBJECTIVE_AGENTS_DIR;
  // The app's own root is the client bundle, not the monorepo, so walk up for it.
  let current = __dirname;
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(current, 'workflow', 'agents');
    if (fs.existsSync(path.join(candidate, 'registry.md'))) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.join(path.sep + 'subjective', 'workflow', 'agents');
}

const registryPath = () => path.join(agentsDir(), 'registry.md');
const rolePath = (id) => path.join(agentsDir(), 'roles', `${id}.md`);
const isValidAgentId = (id) => AGENT_ID_RE.test(String(id || ''));

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (_error) { return ''; }
}

function writeAtomic(file, text) {
  // Never leave a half-written registry: a truncated table orphans every agent below it.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, text, 'utf8');
  fs.renameSync(temporary, file);
}

function readModel(id) {
  const match = MODEL_RE.exec(read(rolePath(id)));
  return match ? match[1].trim().toLowerCase() : '';
}

function runtimeSection(model) {
  const chosen = String(model || '').trim().toLowerCase();
  if (!chosen) return '';
  return [
    '## Runtime',
    '',
    `Model: \`${chosen}\``,
    '',
    'Runtime metadata, not identity: which CLI answers for this role is a deployment',
    'choice. Changing it re-points the agent; it does not make it a different agent.',
    ''
  ].join(os.EOL === '\r\n' ? '\n' : '\n');
}

function listAgents() {
  const text = read(registryPath());
  if (!text) return { ok: false, error: `No agent registry at ${registryPath()}`, agents: [] };
  const agents = [];
  for (const line of text.split('\n')) {
    const match = ROW_RE.exec(line);
    if (!match) continue;
    const id = match[1].trim();
    if (id.toLowerCase() === 'agent id' || id === '---') continue;
    agents.push({
      id,
      roleFile: match[2].trim(),
      capability: match[3].trim(),
      model: readModel(id),
      // Flagged rather than hidden: dropping it would make a broken registry look healthy.
      exists: fs.existsSync(path.join(agentsDir(), match[2].trim()))
    });
  }
  return { ok: true, agents, dir: agentsDir() };
}

function roleTemplate(id, capability, mission, model) {
  return `# ${id}

## Mission

${mission || capability || 'Describe what this agent is for.'}

## Authority

Describe what this agent decides on its own.

## Responsibilities

- ${capability || 'Describe the work this agent owns.'}

## Inputs

Describe what this agent needs to do its work.

## Outputs

Describe what this agent produces.

## Forbidden

Describe what this agent must not do.

## Done

Describe the evidence that closes this agent's work.

${runtimeSection(model)}`;
}

function setAgentModel(id, model) {
  if (!isValidAgentId(id)) return { ok: false, error: 'Invalid agent id.' };
  const file = rolePath(id);
  if (!fs.existsSync(file)) return { ok: false, error: `No role file for ${id}.` };
  const chosen = String(model || '').trim().toLowerCase();
  if (chosen && !MODEL_VALUE_RE.test(chosen)) return { ok: false, error: 'Invalid model.' };
  const text = read(file);
  const section = runtimeSection(chosen);
  let updated;
  if (RUNTIME_SECTION_RE.test(text)) {
    // Replace in place so a model change never rewrites the role's own prose.
    updated = `${text.replace(RUNTIME_SECTION_RE, section ? `\n${section}` : '\n').trimEnd()}\n`;
  } else if (section) {
    updated = `${text.trimEnd()}\n\n${section}`;
  } else {
    updated = text;
  }
  writeAtomic(file, updated);
  return { ok: true, id, model: chosen };
}

function createAgent(input = {}) {
  const id = String(input.id || '').trim().toLowerCase();
  if (!isValidAgentId(id)) {
    return { ok: false, error: 'Agent id must be lowercase letters, digits and underscores.' };
  }
  const registry = read(registryPath());
  if (!registry) return { ok: false, error: `No agent registry at ${registryPath()}` };
  if (listAgents().agents.some((agent) => agent.id === id)) {
    return { ok: false, error: `${id} is already registered.` };
  }
  if (fs.existsSync(rolePath(id))) return { ok: false, error: `${id}.md already exists.` };

  const capability = String(input.capability || '').trim();
  const model = String(input.model || '').trim().toLowerCase();
  if (model && !MODEL_VALUE_RE.test(model)) return { ok: false, error: 'Invalid model.' };

  writeAtomic(rolePath(id), roleTemplate(id, capability, String(input.mission || '').trim(), model));

  const lines = registry.split('\n');
  let lastRow = -1;
  lines.forEach((line, index) => { if (ROW_RE.test(line)) lastRow = index; });
  if (lastRow < 0) {
    fs.rmSync(rolePath(id), { force: true });
    return { ok: false, error: 'Could not find the registry table.' };
  }
  lines.splice(lastRow + 1, 0, `| \`${id}\` | \`roles/${id}.md\` | ${capability || 'unspecified'} |`);
  writeAtomic(registryPath(), `${lines.join('\n').trimEnd()}\n`);
  return { ok: true, agent: { id, roleFile: `roles/${id}.md`, capability, model, exists: true } };
}

module.exports = { agentsDir, listAgents, createAgent, setAgentModel, readModel, isValidAgentId };
