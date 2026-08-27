from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
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
            result = self._run_turn(prompt, resume_id)

            # History-imported conversations carry chat ids cursor-agent may not
            # know (IDE composer sessions, wiped CLI state). Fall back to a fresh
            # chat instead of a dead end - context is lost but the user can talk.
            if not result["success"] and resume_id and self._looks_like_unknown_session(result):
                BBLogger.log(
                    f"[SubjectiveCursorDataSource] Resume of {resume_id} failed; starting new chat"
                )
                self.session_id = None
                result = self._run_turn(prompt, None)

            if result["success"] and result.get("session_id"):
                self.session_id = result["session_id"]
            elif not result.get("session_id"):
                result["session_id"] = self.session_id or ""
            return result

    # ------------------------------------------------------------ internals

    def _run_turn(self, prompt: str, resume_id: str | None) -> dict:
        cli = self._find_cli()
        # Do not call `create-chat` first: it hangs ~60s when CLI auth is stale,
        # then the real `-p` turn never runs. `-p` creates a session on its own;
        # `--resume` is used only when we already have a chat id.
        command = [cli, "-p", "--output-format", "json", "--trust"]
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
            f"workspace={self.working_directory}"
        )
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                env=self._build_environment(),
                cwd=self.working_directory if os.path.isdir(self.working_directory) else None,
            )
        except subprocess.TimeoutExpired:
            return self._error_result("timeout", f"Cursor turn exceeded {self.timeout}s.")
        except (OSError, subprocess.SubprocessError) as exc:
            return self._error_result("execution_error", str(exc))

        stdout = completed.stdout or ""
        stderr = completed.stderr or ""
        parsed = self._parse_output(stdout)
        session_id = parsed["session_id"] or resume_id or ""

        if completed.returncode != 0 and not parsed["text"]:
            blob = f"{stderr}\n{stdout}"
            auth_fail = "authentication required" in blob.lower() or "agent login" in blob.lower()
            result = {
                "success": False,
                "status": "authentication_required" if auth_fail else "execution_error",
                "response": "",
                "session_id": session_id,
                "model": self.model,
                "error": (
                    (stderr or stdout or "cursor-agent failed").strip()[:4000]
                    + ("  Run: cursor-agent login" if auth_fail else "")
                ),
                "events": parsed["events"],
                "exit_code": completed.returncode,
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
            "exit_code": completed.returncode,
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
                parts = [
                    str(part.get("text") or "")
                    for part in content
                    if isinstance(part, dict) and part.get("text")
                ]
                if parts:
                    text = "\n".join(parts).strip()
        return {"text": text, "session_id": session_id, "events": events}

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
        else:
            prompt = str(message or "")
        return {
            "prompt": prompt,
            "session_id": session_id,
            "new_session": new_session,
            "working_directory": working_directory,
            "timeout": timeout,
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
