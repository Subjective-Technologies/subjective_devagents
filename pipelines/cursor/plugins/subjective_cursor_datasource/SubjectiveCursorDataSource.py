from __future__ import annotations

import json
import os
import glob
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from typing import Any

from brainboost_data_source_logger_package.BBLogger import BBLogger
from subjective_abstract_data_source_package import SubjectiveDataSource


class SubjectiveCursorDataSource(SubjectiveDataSource):
    """On-demand, resumable chat datasource backed by the local Cursor CLI.

    Wraps ``cursor-agent`` in headless mode (``-p --output-format json``).
    Authentication stays owned by the Cursor CLI (``cursor-agent login``);
    this datasource never sees or stores credentials.

    Session model: ``cursor-agent create-chat`` mints a chat id up front, so
    every turn - including the first - runs with ``--resume <chatId>`` and the
    session id returned to the caller is always authoritative.
    """

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        connection = self._connection or {}
        self.configured_cli_path = str(connection.get("cursor_agent_path") or "")
        self.model = str(connection.get("model") or "")
        self.working_directory = str(connection.get("working_directory") or os.getcwd())
        self.timeout = self._coerce_int(connection.get("timeout"), 600, minimum=10)
        self.force_commands = self._coerce_bool(connection.get("force_commands", False))
        self.resume_session = self._coerce_bool(connection.get("resume_session", True))
        self.session_id = str(connection.get("session_id") or "") or None
        self._cli_path: str | None = None
        self._lock = threading.RLock()

    @classmethod
    def connection_schema(cls) -> dict:
        return {
            "cursor_agent_path": {
                "type": "file_path",
                "label": "Cursor Agent CLI Path",
                "required": False,
                "placeholder": "/path/to/cursor-agent",
                "description": "Optional override. PATH and ~/.local/bin are searched when blank.",
            },
            "model": {
                "type": "text",
                "label": "Model",
                "required": False,
                "placeholder": "Leave blank to use Cursor CLI default",
            },
            "working_directory": {
                "type": "folder_path",
                "label": "Working Directory",
                "placeholder": "/path/to/project",
                "description": "Workspace presented to a new Cursor session.",
            },
            "session_id": {
                "type": "text",
                "label": "Initial Chat ID",
                "required": False,
                "description": "Optional Cursor chat id to resume.",
            },
            "resume_session": {
                "type": "checkbox",
                "label": "Resume Session Between Turns",
                "default": True,
            },
            "force_commands": {
                "type": "checkbox",
                "label": "Force-allow Shell Commands",
                "default": False,
            },
            "timeout": {
                "type": "number",
                "label": "Turn Timeout (seconds)",
                "default": 600,
            },
        }

    # ------------------------------------------------------------------ API

    def run(self, request: dict) -> dict:
        request = request or {}
        action = str(request.get("action") or "status")
        prompt = request.get("prompt") or request.get("message")

        if action == "reset_session":
            with self._lock:
                self.session_id = None
            return self._status_result("ready")
        if action == "send" or prompt:
            return self.handle_message(dict(request), files=request.get("files"))
        return self.get_status()

    def get_status(self) -> dict:
        cli = self._find_cli()
        if not cli:
            return self._status_result(
                "not_installed",
                error="cursor-agent was not found. Install the Cursor CLI or configure cursor_agent_path.",
            )
        version = self._command_text([cli, "--version"], timeout=15)
        try:
            completed = subprocess.run(
                [cli, "status"],
                capture_output=True,
                text=True,
                timeout=30,
                env=self._build_environment(),
            )
        except (OSError, subprocess.SubprocessError) as exc:
            return self._status_result("error", error=str(exc), version=version)
        output = f"{completed.stdout or ''}\n{completed.stderr or ''}".strip()
        # `status` often prints "Logged in (unable to fetch user details)" even
        # when the CLI session is valid - that suffix is a whoami lookup miss,
        # not a dead token. Treat any successful Login/Logged-in as ready and
        # let the actual turn report authentication_required if it really fails.
        logged_in = completed.returncode == 0 and (
            "Logged in" in output or "Login successful" in output
        )
        if logged_in:
            return self._status_result("ready", version=version)
        return self._status_result(
            "authentication_required",
            error=output or "Cursor CLI login is required.",
            version=version,
        )

    def authentication_instructions(self) -> dict:
        cli = self._find_cli() or "cursor-agent"
        return {
            "status": "authentication_required",
            "login_command": f"{cli} login",
            "message": (
                "Run the login command in a visible terminal. The Cursor CLI owns and "
                "stores credentials; this datasource does not receive them."
            ),
        }

    def handle_message(self, message: Any, files: list | None = None) -> dict:
        with self._lock:
            normalized = self._normalize_message(message)
            prompt = normalized["prompt"].strip()
            if not prompt:
                return self._error_result("invalid_request", "Message is empty.")

            status = self.get_status()
            if status["status"] == "not_installed":
                result = self._error_result(status["status"], status["error"])
                result["authentication"] = self.authentication_instructions()
                return result

            if normalized["new_session"]:
                self.session_id = None
            if normalized["session_id"]:
                self.session_id = normalized["session_id"]
            if normalized["working_directory"]:
                workspace = os.path.abspath(os.path.expanduser(normalized["working_directory"]))
                if os.path.isdir(workspace):
                    self.working_directory = workspace
            if normalized["timeout"]:
                self.timeout = min(normalized["timeout"], 3600)

            resume_id = self.session_id if self.resume_session else None
            original_session = resume_id
            result = self._run_turn(prompt, resume_id)

            # Do not silently mint a second chat. IDE composer ids and CLI chat
            # ids are the same UUID when resume works; a fallback new session is
            # what made "hello" from My Agents vanish inside Cursor.
            if (
                not result["success"]
                and resume_id
                and result.get("status") not in ("authentication_required", "timeout")
                and self._looks_like_unknown_session(result)
            ):
                BBLogger.log(
                    f"[SubjectiveCursorDataSource] Resume of {resume_id} failed "
                    f"(status={result.get('status')}); retrying once as new CLI chat, "
                    "then writing the turn back onto the original IDE transcript"
                )
                result = self._run_turn(prompt, None)
                if result.get("success"):
                    result["resumed_as_new"] = True

            if original_session:
                result["session_id"] = original_session
                self.session_id = original_session
            elif result["success"] and result.get("session_id"):
                self.session_id = result["session_id"]
            elif not result.get("session_id"):
                result["session_id"] = self.session_id or ""

            if result.get("success"):
                source_file = normalized.get("source_file") or ""
                ide_id = self._composer_id_from_source(source_file) or original_session or result.get("session_id") or ""
                self._append_ide_transcript(
                    ide_id,
                    prompt,
                    str(result.get("response") or ""),
                    result.get("events") or [],
                )
                self._append_composer_bubbles(
                    source_file,
                    ide_id,
                    prompt,
                    str(result.get("response") or ""),
                )
            return result

    # ------------------------------------------------------------ internals

    def _run_turn(self, prompt: str, resume_id: str | None) -> dict:
        cli = self._find_cli()
        # stream-json so My Agents can show the same tool/edit cards + live
        # status the IDE shows, instead of one blob after the process exits.
        command = [cli, "-p", "--output-format", "stream-json", "--stream-partial-output", "--trust"]
        if self.model:
            command.extend(["--model", self.model])
        if self.force_commands:
            command.append("--force")
        if resume_id:
            command.extend(["--resume", resume_id])
        if self.working_directory and os.path.isdir(self.working_directory):
            command.extend(["--workspace", self.working_directory])
        command.append(prompt)

        BBLogger.log(
            "[SubjectiveCursorDataSource] Starting Cursor turn "
            f"mode={'resume' if resume_id else 'new'} chat={resume_id or '-'} "
            f"workspace={self.working_directory} timeout={self.timeout}s "
            f"prompt_chars={len(prompt)}"
        )
        try:
            proc = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env=self._build_environment(),
                cwd=self.working_directory if os.path.isdir(self.working_directory) else None,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            return self._error_result("execution_error", str(exc))
        stdout_parts: list[str] = []
        stderr_parts: list[str] = []

        def _pump_stderr() -> None:
            if not proc.stderr:
                return
            for line in proc.stderr:
                stderr_parts.append(line)

        reader = threading.Thread(target=_pump_stderr, daemon=True)
        reader.start()
        killed = {"value": False}

        def _watchdog() -> None:
            killed["value"] = True
            try:
                proc.kill()
            except OSError:
                pass

        timer = threading.Timer(self.timeout, _watchdog)
        timer.daemon = True
        timer.start()
        try:
            if proc.stdout:
                for line in proc.stdout:
                    stdout_parts.append(line)
                    self._note_stream_line(line)
            proc.wait()
        finally:
            timer.cancel()
        reader.join(timeout=2)
        if killed["value"]:
            return self._error_result("timeout", f"Cursor turn exceeded {self.timeout}s.")
        stdout = "".join(stdout_parts)
        stderr = "".join(stderr_parts)
        completed_code = proc.returncode

        parsed = self._parse_output(stdout or "")
        session_id = parsed["session_id"] or resume_id or ""
        cards = parsed.get("cards") or []
        if cards and parsed.get("text"):
            parsed["text"] = str(parsed["text"]).rstrip() + "\n\n" + "\n\n".join(cards)
        elif cards and not parsed.get("text"):
            parsed["text"] = "\n\n".join(cards)
        BBLogger.log(
            "[SubjectiveCursorDataSource] Cursor turn finished "
            f"exit={completed_code} chat={session_id or '-'} "
            f"text_chars={len(parsed.get('text') or '')} "
            f"events={len(parsed.get('events') or [])} "
            f"stderr_chars={len(stderr or '')}"
        )

        # cursor-agent does not always signal failure through the exit code: a stale
        # login prints "Error: Authentication required..." on stdout and exits 0.
        # `-p --output-format json` emits JSON on every real turn, so "exit 0, nothing
        # parseable, and an error-shaped line" is a failed turn - without this it was
        # reported as success and the error text became the assistant's reply.
        silent_failure = (
            completed_code == 0
            and not parsed["text"]
            and self._looks_like_cli_error(stdout or "", stderr or "")
        )
        if (completed_code != 0 and not parsed["text"]) or silent_failure:
            blob = f"{stderr}\n{stdout}"
            auth_fail = "authentication required" in blob.lower() or "agent login" in blob.lower()
            result = {
                "success": False,
                "status": "authentication_required" if auth_fail else "execution_error",
                "response": "",
                "session_id": session_id,
                "model": self.model,
                "error": (
                    ((stderr or stdout) or "cursor-agent failed").strip()[:4000]
                    + ("  Run: cursor-agent login" if auth_fail else "")
                ),
                "events": parsed["events"],
                "exit_code": completed_code,
            }
            if auth_fail:
                result["authentication"] = self.authentication_instructions()
            return result

        return {
            "success": True,
            "status": "completed",
            "response": parsed["text"] or stdout.strip(),
            "session_id": session_id,
            "model": self.model,
            "error": "",
            "events": parsed["events"],
            "usage": {},
            "exit_code": completed_code,
            "cards": cards,
        }

    def _create_chat(self, cli: str) -> str | None:
        try:
            completed = subprocess.run(
                [cli, "create-chat"],
                capture_output=True,
                text=True,
                timeout=60,
                env=self._build_environment(),
                cwd=self.working_directory if os.path.isdir(self.working_directory) else None,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        text = (completed.stdout or "").strip()
        # Output is the chat id, possibly surrounded by log lines - take the
        # last token that looks like an id.
        for token in reversed(text.split()):
            cleaned = token.strip().strip('"')
            if len(cleaned) >= 8 and all(c.isalnum() or c == "-" for c in cleaned):
                return cleaned
        return None

    def _parse_output(self, stdout: str) -> dict:
        """Extract assistant text + chat id from cursor-agent JSON output.

        ``--output-format json`` emits a JSON object (or JSONL events). Parsed
        defensively: unknown shapes degrade to raw text, never to a crash.
        """
        events: list[dict] = []
        text = ""
        session_id = ""
        cards: list[str] = []

        candidates: list[Any] = []
        stripped = stdout.strip()
        if stripped:
            try:
                candidates.append(json.loads(stripped))
            except json.JSONDecodeError:
                for line in stripped.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        candidates.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue

        for obj in candidates:
            if not isinstance(obj, dict):
                continue
            events.append(obj)
            for key in ("chatId", "chat_id", "session_id", "sessionId", "threadId", "thread_id"):
                value = obj.get(key)
                if value and not session_id:
                    session_id = str(value)
            for key in ("result", "response", "text"):
                value = obj.get(key)
                if isinstance(value, str) and value.strip():
                    text = value.strip()
            content = obj.get("content")
            if isinstance(content, list):
                parts = []
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    if part.get("text"):
                        parts.append(str(part.get("text") or ""))
                    else:
                        ask = self._format_ask_tool(part)
                        if ask:
                            parts.append(ask)
                if parts:
                    text = "\n".join(parts).strip()
            ask = self._format_ask_tool(obj)
            if ask:
                text = ask if not text else f"{text}\n\n{ask}"
            card = self._card_from_event(obj)
            if card:
                cards.append(card)
        # unique cards, keep order
        seen: set[str] = set()
        unique_cards = []
        for card in cards:
            if card in seen:
                continue
            seen.add(card)
            unique_cards.append(card)
        return {"text": text, "session_id": session_id, "events": events, "cards": unique_cards}

    def _note_stream_line(self, line: str) -> None:
        stripped = str(line or "").strip()
        if not stripped:
            return
        try:
            obj = json.loads(stripped)
        except json.JSONDecodeError:
            return
        if not isinstance(obj, dict):
            return
        label = self._status_from_event(obj)
        if label:
            self._emit_progress(label)

    def _emit_progress(self, text: str) -> None:
        payload = json.dumps({"subjective_progress": True, "text": str(text)[:200]}, ensure_ascii=False)
        print(f"SUBJECTIVE_PROGRESS {payload}", file=sys.stderr, flush=True)

    def _status_from_event(self, obj: dict) -> str:
        card = self._card_from_event(obj)
        if card:
            first = card.split("\n", 1)[0].strip().lstrip("#").strip()
            return first[:160]
        subtype = str(obj.get("type") or obj.get("subtype") or "").lower()
        if subtype in {"thinking", "assistant"}:
            text = str(obj.get("text") or obj.get("message") or "")[:80]
            return text or "Writing a reply"
        return ""

    def _card_from_event(self, obj: dict) -> str:
        content = obj.get("message")
        parts = []
        if isinstance(content, dict) and isinstance(content.get("content"), list):
            parts = content["content"]
        elif isinstance(obj.get("content"), list):
            parts = obj["content"]
        elif obj.get("name") or obj.get("type") in {"tool_use", "tool_call"}:
            parts = [obj]
        cards = []
        for part in parts:
            if not isinstance(part, dict):
                continue
            if str(part.get("type") or "") not in {"tool_use", "tool_call", "tool"} and not part.get("name"):
                continue
            name = str(part.get("name") or part.get("toolName") or "").strip()
            payload = part.get("input") or part.get("arguments") or {}
            if not isinstance(payload, dict):
                payload = {}
            path = str(payload.get("path") or payload.get("file_path") or payload.get("file") or "").strip()
            short = path.split("/")[-1] if path else ""
            key = name.replace("-", "").replace("_", "").lower()
            if key in {"read", "readfile"}:
                cards.append(f"Read `{path or short or 'file'}`")
            elif key in {"grep", "search"}:
                pattern = str(payload.get("pattern") or payload.get("query") or "").strip()
                cards.append(f"Search `{pattern}`" + (f" in `{path}`" if path else ""))
            elif key in {"glob"}:
                cards.append(f"Find `{payload.get('glob_pattern') or payload.get('pattern') or 'files'}`")
            elif key in {"shell", "bash"}:
                cmd = str(payload.get("command") or payload.get("cmd") or "").strip()
                if cmd:
                    cards.append(f"```bash\n{cmd}\n```")
            elif key in {"strreplace", "searchreplace"}:
                old = str(payload.get("old_string") or payload.get("oldString") or "")
                new = str(payload.get("new_string") or payload.get("newString") or "")
                lines = [f"**{path or short or 'file'}**", "```diff"]
                lines.extend(f"- {line}" for line in old.splitlines()[:40])
                lines.extend(f"+ {line}" for line in new.splitlines()[:40])
                lines.append("```")
                cards.append("\n".join(lines))
            elif key in {"write", "writefile"}:
                body = str(payload.get("contents") or payload.get("content") or "")
                preview = "\n".join(body.splitlines()[:80])
                cards.append(f"**Wrote {path or short or 'file'}**\n```\n{preview}\n```")
            elif key == "task":
                cards.append(str(payload.get("description") or "Explored").strip())
            elif name:
                cards.append(name + (f" `{short}`" if short else ""))
        return "\n\n".join(cards)

    def _find_ide_transcript(self, session_id: str) -> str:
        sid = str(session_id or "").strip()
        if not sid:
            return ""
        homes = [os.path.expanduser("~")]
        extra = os.environ.get("HOME")
        if extra and extra not in homes:
            homes.append(extra)
        if os.path.isdir("/home"):
            try:
                homes.extend(os.path.join("/home", name) for name in os.listdir("/home"))
            except OSError:
                pass
        seen = set()
        matches = []
        for home in homes:
            if not home or home in seen:
                continue
            seen.add(home)
            matches.extend(
                glob.glob(
                    os.path.join(home, ".cursor", "projects", "*", "agent-transcripts", sid, f"{sid}.jsonl")
                )
            )
        if not matches:
            return ""
        matches.sort(key=os.path.getmtime, reverse=True)
        return matches[0]

    def _append_ide_transcript(self, session_id: str, user_text: str, assistant_text: str, events: list) -> None:
        path = self._find_ide_transcript(session_id)
        if not path or not os.path.isfile(path):
            BBLogger.log(f"[SubjectiveCursorDataSource] No IDE transcript for {session_id or '-'}; skip write-back")
            return
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as handle:
                tail = "".join(handle.readlines()[-12:])
            if user_text[:120] and user_text[:120] in tail:
                return
        except OSError:
            pass
        tool_parts = []
        for event in events or []:
            if not isinstance(event, dict):
                continue
            message = event.get("message") if isinstance(event.get("message"), dict) else event
            content = message.get("content") if isinstance(message, dict) else None
            if not isinstance(content, list):
                continue
            for part in content:
                if isinstance(part, dict) and part.get("type") in {"tool_use", "tool_call"}:
                    tool_parts.append(part)
        assistant_content = []
        if assistant_text:
            assistant_content.append({"type": "text", "text": assistant_text})
        assistant_content.extend(tool_parts)
        records = [
            {
                "role": "user",
                "message": {
                    "content": [{"type": "text", "text": f"<user_query>\n{user_text}\n</user_query>"}]
                },
            },
            {"role": "assistant", "message": {"content": assistant_content or [{"type": "text", "text": assistant_text}]}},
        ]
        try:
            with open(path, "a", encoding="utf-8") as handle:
                for record in records:
                    handle.write(json.dumps(record, ensure_ascii=False) + "\n")
            BBLogger.log(f"[SubjectiveCursorDataSource] Wrote turn back to {path}")
        except OSError as exc:
            BBLogger.log(f"[SubjectiveCursorDataSource] IDE write-back failed: {exc}")

    @staticmethod
    def _composer_id_from_source(source_file: str) -> str:
        text = str(source_file or "")
        if "#composer:" in text:
            return text.split("#composer:", 1)[1].strip()
        return ""

    @staticmethod
    def _lexical_rich_text(text: str) -> str:
        paragraphs = str(text or "").split("\n") or [""]
        children = []
        for paragraph in paragraphs:
            children.append(
                {
                    "children": [
                        {
                            "detail": 0,
                            "format": 0,
                            "mode": "normal",
                            "style": "",
                            "text": paragraph,
                            "type": "text",
                            "version": 1,
                        }
                    ],
                    "direction": "ltr",
                    "format": "",
                    "indent": 0,
                    "type": "paragraph",
                    "version": 1,
                }
            )
        return json.dumps(
            {
                "root": {
                    "children": children,
                    "direction": "ltr",
                    "format": "",
                    "indent": 0,
                    "type": "root",
                    "version": 1,
                }
            },
            ensure_ascii=False,
        )

    def _clone_bubble(self, template: dict, bubble_type: int, bubble_id: str, text: str, created_at: str) -> dict:
        bubble = dict(template) if isinstance(template, dict) else {}
        bubble.update(
            {
                "_v": 3,
                "type": bubble_type,
                "bubbleId": bubble_id,
                "text": text,
                "richText": self._lexical_rich_text(text),
                "createdAt": created_at,
                "subjectiveWeb": True,
                "approximateLintErrors": [],
                "lints": [],
                "images": [],
                "attachedFolders": [],
                "attachedFoldersNew": [],
            }
        )
        return bubble

    def _load_bubble_templates(self, conn: sqlite3.Connection, composer_id: str) -> dict:
        templates = {1: None, 2: None}
        try:
            rows = conn.execute(
                "SELECT value FROM cursorDiskKV WHERE key LIKE ? ORDER BY rowid DESC LIMIT 80",
                (f"bubbleId:{composer_id}:%",),
            ).fetchall()
        except sqlite3.Error:
            return templates
        for (raw,) in rows:
            try:
                obj = json.loads(raw if isinstance(raw, str) else raw.decode("utf-8", errors="ignore"))
            except (json.JSONDecodeError, TypeError, AttributeError):
                continue
            if not isinstance(obj, dict) or obj.get("_v") != 3:
                continue
            kind = obj.get("type")
            if kind in templates and templates[kind] is None:
                templates[kind] = obj
            if templates[1] and templates[2]:
                break
        return templates

    def _rebind_web_headers(
        self,
        conn: sqlite3.Connection,
        composer_id: str,
        meta: dict,
        headers: list,
    ) -> int:
        """Put web-injected bubbles back on the header list Cursor actually renders."""
        known = {
            str(item.get("bubbleId") or "")
            for item in headers
            if isinstance(item, dict)
        }
        added = 0
        try:
            rows = conn.execute(
                "SELECT key, value FROM cursorDiskKV WHERE key LIKE ?",
                (f"bubbleId:{composer_id}:%",),
            ).fetchall()
        except sqlite3.Error:
            return 0
        now = time.time()
        for key, raw in rows:
            try:
                bubble = json.loads(raw if isinstance(raw, str) else raw.decode("utf-8", errors="ignore"))
            except (json.JSONDecodeError, TypeError, AttributeError):
                continue
            if not isinstance(bubble, dict):
                continue
            bid = str(bubble.get("bubbleId") or "")
            text = str(bubble.get("text") or "").strip()
            if not bid or bid in known or not text:
                continue
            if bubble.get("type") not in (1, 2):
                continue
            if bubble.get("toolFormerData") or bubble.get("capabilityType"):
                continue
            if not bubble.get("subjectiveWeb") and not self._bubble_is_recent(bubble, now, hours=6):
                continue
            header = {
                "bubbleId": bid,
                "type": bubble.get("type"),
                "createdAt": bubble.get("createdAt") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            if bubble.get("type") == 2:
                header["grouping"] = {
                    "isRenderable": True,
                    "hasText": True,
                    "textPreview": text[:80],
                    "toolDisplayComputed": True,
                }
            headers.append(header)
            known.add(bid)
            added += 1
        if added:
            BBLogger.log(
                f"[SubjectiveCursorDataSource] Rebound {added} web bubbles onto composer {composer_id}"
            )
        return added

    @staticmethod
    def _bubble_is_recent(bubble: dict, now: float, hours: float = 6) -> bool:
        created = bubble.get("createdAt")
        if isinstance(created, (int, float)):
            ts = float(created) / (1000.0 if created > 1e12 else 1.0)
        elif isinstance(created, str):
            try:
                ts = time.mktime(time.strptime(created[:19], "%Y-%m-%dT%H:%M:%S"))
            except (ValueError, TypeError):
                return False
        else:
            return False
        return (now - ts) <= hours * 3600

    def _append_composer_bubbles(
        self,
        source_file: str,
        session_id: str,
        user_text: str,
        assistant_text: str,
    ) -> None:
        """Insert the web turn into Cursor's composer store so the IDE tab shows it."""
        composer_id = self._composer_id_from_source(source_file) or str(session_id or "").strip()
        db_path = ""
        if "#composer:" in str(source_file or ""):
            db_path = str(source_file).split("#composer:", 1)[0]
        if not composer_id:
            return
        if not db_path or not os.path.isfile(db_path):
            db_path = self._find_composer_db(composer_id, source_file)
        if not db_path or not os.path.isfile(db_path):
            BBLogger.log(f"[SubjectiveCursorDataSource] No composer DB for {composer_id}")
            return
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int((time.time() % 1) * 1000):03d}Z"
        now_ms = int(time.time() * 1000)
        turns = []
        if user_text:
            turns.append((1, user_text))
        if assistant_text:
            turns.append((2, assistant_text))
        if not turns:
            return
        try:
            conn = sqlite3.connect(db_path, timeout=8)
            conn.execute("PRAGMA busy_timeout=8000")
            try:
                row = conn.execute(
                    "SELECT value FROM cursorDiskKV WHERE key = ?",
                    (f"composerData:{composer_id}",),
                ).fetchone()
                meta = {}
                if row and row[0]:
                    raw = row[0].decode("utf-8", errors="ignore") if isinstance(row[0], bytes) else row[0]
                    parsed = json.loads(raw) if isinstance(raw, str) and raw[:1] in "{[" else {}
                    if isinstance(parsed, dict):
                        meta = parsed
                existing = "".join(
                    str(item[0] or "")
                    for item in conn.execute(
                        "SELECT value FROM cursorDiskKV WHERE key LIKE ?",
                        (f"bubbleId:{composer_id}:%",),
                    ).fetchall()
                )
                header_key = "fullConversationHeadersOnly"
                headers = meta.get(header_key)
                if not isinstance(headers, list):
                    for key in ("fullConversationHeaders", "conversationHeaders"):
                        if isinstance(meta.get(key), list):
                            header_key = key
                            headers = meta[key]
                            break
                    else:
                        headers = []
                        meta[header_key] = headers
                templates = self._load_bubble_templates(conn, composer_id)
                added = 0
                for bubble_type, text in turns:
                    if text[:120] and text[:120] in existing:
                        continue
                    bubble_id = str(uuid.uuid4())
                    bubble = self._clone_bubble(templates.get(bubble_type) or {}, bubble_type, bubble_id, text, now_iso)
                    conn.execute(
                        "INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)",
                        (f"bubbleId:{composer_id}:{bubble_id}", json.dumps(bubble, ensure_ascii=False)),
                    )
                    header = {"bubbleId": bubble_id, "type": bubble_type, "createdAt": now_iso}
                    if bubble_type == 2:
                        header["grouping"] = {
                            "isRenderable": True,
                            "hasText": True,
                            "textPreview": text[:80],
                            "toolDisplayComputed": True,
                        }
                    headers.append(header)
                    added += 1
                rebound = self._rebind_web_headers(conn, composer_id, meta, headers)
                added += rebound
                if added:
                    meta["composerId"] = meta.get("composerId") or composer_id
                    meta["lastUpdatedAt"] = now_ms
                    meta["hasUnreadMessages"] = True
                    meta[header_key] = headers
                    conn.execute(
                        "INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)",
                        (f"composerData:{composer_id}", json.dumps(meta, ensure_ascii=False)),
                    )
                    tables = {
                        str(name)
                        for (name,) in conn.execute(
                            "SELECT name FROM sqlite_master WHERE type='table'"
                        ).fetchall()
                    }
                    if "composerHeaders" in tables:
                        conn.execute(
                            "UPDATE composerHeaders SET lastUpdatedAt = ?, recency = ? WHERE composerId = ?",
                            (now_ms, now_ms, composer_id),
                        )
                    conn.commit()
                    BBLogger.log(
                        f"[SubjectiveCursorDataSource] Wrote {added} composer bubbles "
                        f"({composer_id}) headers={len(headers)} to {db_path}"
                    )
            finally:
                conn.close()
        except (OSError, sqlite3.Error, json.JSONDecodeError, TypeError) as exc:
            BBLogger.log(f"[SubjectiveCursorDataSource] Composer write-back failed: {exc}")

    def _find_composer_db(self, composer_id: str, source_file: str = "") -> str:
        sid = str(composer_id or "").strip()
        if not sid:
            return ""
        homes = []
        hint = str(source_file or "").replace("\\", "/")
        if hint.startswith("/home/"):
            homes.append("/" + "/".join(hint.split("/")[1:3]))
        homes.append(os.path.expanduser("~"))
        extra = os.environ.get("HOME")
        if extra and extra not in homes:
            homes.append(extra)
        if os.path.isdir("/home"):
            try:
                homes.extend(os.path.join("/home", name) for name in os.listdir("/home"))
            except OSError:
                pass
        seen = set()
        for home in homes:
            if not home or home in seen:
                continue
            seen.add(home)
            for relative in (
                os.path.join(".config", "Cursor", "User", "globalStorage", "state.vscdb"),
                os.path.join("AppData", "Roaming", "Cursor", "User", "globalStorage", "state.vscdb"),
                os.path.join("Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"),
            ):
                path = os.path.join(home, relative)
                if os.path.isfile(path):
                    return path
        return ""

    _ASK_TOOL_NAMES = {
        "askquestion",
        "ask_question",
        "askuserquestion",
        "ask_user_question",
        "askuser",
    }

    def _format_ask_tool(self, value) -> str:
        if not isinstance(value, dict):
            return ""
        name = str(value.get("name") or value.get("toolName") or value.get("tool_name") or "").replace("-", "").lower()
        value_type = str(value.get("type") or "").lower()
        if name not in self._ASK_TOOL_NAMES and value_type not in self._ASK_TOOL_NAMES:
            return ""
        payload = value.get("input") or value.get("arguments") or value
        if not isinstance(payload, dict):
            return ""
        title = str(payload.get("title") or payload.get("prompt") or "Question").strip()
        questions = payload.get("questions")
        if not isinstance(questions, list) or not questions:
            options = payload.get("options")
            questions = [{"prompt": title, "options": options}] if options else []
        letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        lines: list[str] = []
        if title:
            lines.append(title)
        for question in questions:
            if not isinstance(question, dict):
                continue
            prompt = str(question.get("prompt") or question.get("question") or "").strip()
            if prompt and prompt != title:
                lines.append(prompt)
            options = question.get("options") or []
            used: list[str] = []
            if isinstance(options, list):
                for index, option in enumerate(options):
                    if isinstance(option, dict):
                        label = str(option.get("label") or option.get("id") or "").strip()
                    else:
                        label = str(option).strip()
                    if not label:
                        continue
                    letter = letters[index] if index < len(letters) else str(index + 1)
                    lines.append(f"{letter}. {label}")
                    used.append(letter)
            if len(used) >= 2:
                listed = ", ".join(used[:-1]) + f", or {used[-1]}"
                lines.append(f"Which — {listed}?")
        return "\n".join(lines).strip()

    @staticmethod
    def _looks_like_cli_error(stdout: str, stderr: str) -> bool:
        for stream in (stderr, stdout):
            head = str(stream or "").strip()
            if not head:
                continue
            lowered = head.lower()
            if lowered.startswith("error:") or lowered.startswith("error "):
                return True
            if "authentication required" in lowered or "agent login" in lowered:
                return True
        return False

    @staticmethod
    def _looks_like_unknown_session(result: dict) -> bool:
        blob = f"{result.get('error') or ''} {result.get('response') or ''}".lower()
        return any(
            marker in blob
            for marker in ("not found", "no such chat", "unknown chat", "does not exist", "invalid chat")
        )

    def _find_cli(self) -> str | None:
        if self._cli_path and os.path.isfile(self._cli_path):
            return self._cli_path
        candidates = []
        if self.configured_cli_path:
            candidates.append(os.path.expanduser(self.configured_cli_path))
        which = shutil.which("cursor-agent")
        if which:
            candidates.append(which)
        home = os.path.expanduser("~")
        candidates.append(os.path.join(home, ".local", "bin", "cursor-agent"))
        candidates.append(os.path.join(home, ".cursor", "bin", "cursor-agent"))
        for candidate in candidates:
            if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                self._cli_path = candidate
                return candidate
        return None

    def _build_environment(self) -> dict:
        env = dict(os.environ)
        env.setdefault("NO_OPEN_BROWSER", "1")
        return env

    def _command_text(self, command: list[str], *, timeout: int) -> str:
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=self._build_environment(),
            )
        except (OSError, subprocess.SubprocessError):
            return ""
        return (completed.stdout or completed.stderr or "").strip()

    def _normalize_message(self, message: Any) -> dict:
        prompt = ""
        session_id = ""
        new_session = False
        working_directory = ""
        timeout = None
        if isinstance(message, dict):
            prompt = str(
                message.get("content")
                or message.get("prompt")
                or message.get("message")
                or ""
            )
            session_id = str(message.get("session_id") or "")
            new_session = self._coerce_bool(message.get("new_session", False))
            working_directory = str(
                message.get("working_directory") or message.get("workspace") or ""
            ).strip()
            timeout = self._coerce_optional_int(message.get("timeout"), minimum=10)
            source_file = str(message.get("source_file") or message.get("sourceFile") or "")
        else:
            prompt = str(message or "")
            source_file = ""
        return {
            "prompt": prompt,
            "session_id": session_id,
            "new_session": new_session,
            "working_directory": working_directory,
            "timeout": timeout,
            "source_file": source_file,
        }

    def _status_result(self, status: str, *, error: str = "", version: str = "") -> dict:
        return {
            "success": status == "ready",
            "status": status,
            "response": "",
            "session_id": self.session_id or "",
            "model": self.model,
            "error": error,
            "version": version,
        }

    def _error_result(self, status: str, error: str) -> dict:
        return {
            "success": False,
            "status": status,
            "response": "",
            "session_id": self.session_id or "",
            "model": self.model,
            "error": error,
        }

    @staticmethod
    def _coerce_bool(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    @staticmethod
    def _coerce_int(value: Any, default: int, *, minimum: int) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return default
        return max(parsed, minimum)

    @staticmethod
    def _coerce_optional_int(value: Any, *, minimum: int) -> int | None:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None
        return max(parsed, minimum)
