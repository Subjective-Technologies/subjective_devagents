from __future__ import annotations

import base64
import binascii
import json
import mimetypes
import os
import shutil
import subprocess
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from brainboost_data_source_logger_package.BBLogger import BBLogger
from subjective_abstract_data_source_package import SubjectiveDataSource


class SubjectiveCodexDataSource(SubjectiveDataSource):
    """On-demand, resumable chat datasource backed by the local Codex CLI.

    Authentication stays owned by Codex CLI. By default this datasource reuses
    an existing ``codex login`` session. An API key can be supplied explicitly,
    but it is never copied into global process state or returned to callers.
    """

    AUTH_EXISTING_SESSION = "existing_session"
    AUTH_API_KEY = "api_key"
    MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        connection = self._connection or {}

        auth_method = str(connection.get("auth_method") or self.AUTH_EXISTING_SESSION)
        # Older saved connections called CLI OAuth mode simply "oauth".
        self.auth_method = (
            self.AUTH_EXISTING_SESSION if auth_method == "oauth" else auth_method
        )
        self.api_key = str(connection.get("api_key") or "")
        self.configured_codex_path = str(connection.get("codex_path") or "")
        self.model = str(connection.get("model") or "")
        self.sandbox_mode = str(connection.get("sandbox_mode") or "read-only")
        self.working_directory = str(
            connection.get("working_directory") or os.getcwd()
        )
        self.timeout = self._coerce_int(connection.get("timeout"), 600, minimum=10)
        self.approve_for_me = self._coerce_bool(
            connection.get("approve_for_me", connection.get("full_auto", False))
        )
        self.enable_search = self._coerce_bool(connection.get("enable_search", False))
        self.skip_git_repo_check = self._coerce_bool(
            connection.get("skip_git_repo_check", False)
        )
        self.resume_session = self._coerce_bool(
            connection.get("resume_session", True)
        )
        self.session_id = str(connection.get("session_id") or "") or None

        self._codex_path: str | None = None
        self._lock = threading.RLock()

    @classmethod
    def connection_schema(cls) -> dict:
        return {
            "auth_method": {
                "type": "select",
                "label": "Authentication",
                "required": True,
                "default": cls.AUTH_EXISTING_SESSION,
                "options": [cls.AUTH_EXISTING_SESSION, cls.AUTH_API_KEY],
                "description": (
                    "Reuse existing Codex CLI login, or provide an API key. "
                    "Run 'codex login --device-auth' separately when login is required."
                ),
            },
            "api_key": {
                "type": "password",
                "label": "OpenAI API Key",
                "required": False,
                "placeholder": "sk-...",
                "description": "Used only when Authentication is api_key.",
            },
            "codex_path": {
                "type": "file_path",
                "label": "Codex CLI Path",
                "required": False,
                "placeholder": "/path/to/codex",
                "description": "Optional override. PATH is searched when blank.",
            },
            "model": {
                "type": "text",
                "label": "Model",
                "required": False,
                "placeholder": "Leave blank to use Codex CLI default",
            },
            "sandbox_mode": {
                "type": "select",
                "label": "Sandbox Mode",
                "options": ["read-only", "workspace-write", "danger-full-access"],
                "default": "read-only",
            },
            "working_directory": {
                "type": "folder_path",
                "label": "Working Directory",
                "placeholder": "/path/to/project",
                "description": "Workspace presented to a new Codex session.",
            },
            "session_id": {
                "type": "text",
                "label": "Initial Session ID",
                "required": False,
                "description": "Optional Codex thread UUID to resume.",
            },
            "resume_session": {
                "type": "checkbox",
                "label": "Resume Conversation",
                "default": True,
                "description": "Continue the session created by the previous message.",
            },
            "timeout": {
                "type": "number",
                "label": "Timeout (seconds)",
                "default": 600,
                "min": 10,
            },
            "approve_for_me": {
                "type": "checkbox",
                "label": "Codex Automatic Review",
                "default": False,
                "description": (
                    "Use Codex --approve-for-me. Keep disabled for remote/mobile use "
                    "unless workspace policy is understood."
                ),
            },
            "enable_search": {
                "type": "checkbox",
                "label": "Enable Web Search",
                "default": False,
            },
            "skip_git_repo_check": {
                "type": "checkbox",
                "label": "Allow Non-Git Workspace",
                "default": False,
            },
        }

    @classmethod
    def request_schema(cls) -> dict:
        return {
            "prompt": {"type": "textarea", "label": "Prompt", "required": False},
            "session_id": {
                "type": "text",
                "label": "Session ID",
                "required": False,
            },
            "new_session": {
                "type": "checkbox",
                "label": "Start New Session",
                "default": False,
            },
            "action": {
                "type": "select",
                "label": "Action",
                "options": ["status", "send", "reset_session"],
                "default": "status",
            },
        }

    @classmethod
    def output_schema(cls) -> dict:
        return {
            "success": {"type": "bool", "label": "Success"},
            "status": {"type": "text", "label": "Status"},
            "response": {"type": "textarea", "label": "Response"},
            "session_id": {"type": "text", "label": "Session ID"},
            "model": {"type": "text", "label": "Model"},
            "error": {"type": "text", "label": "Error"},
            "events": {"type": "*", "label": "Codex Events"},
            "usage": {"type": "*", "label": "Usage"},
        }

    @classmethod
    def icon(cls) -> str:
        icon_path = os.path.join(os.path.dirname(__file__), "icon.svg")
        try:
            with open(icon_path, "r", encoding="utf-8") as handle:
                return handle.read()
        except OSError:
            return ""

    def supports_chat(self) -> bool:
        return True

    def run(self, request: dict) -> dict:
        request = request or {}
        action = str(request.get("action") or "status")
        prompt = request.get("prompt") or request.get("message")

        if action == "reset_session":
            self.reset_session()
            return self._status_result("ready")
        if action == "send" or prompt:
            payload = dict(request)
            payload["content"] = prompt or ""
            return self.handle_message(payload, files=request.get("files"))
        return self.get_status()

    def get_status(self) -> dict:
        """Return installation and authentication health without changing auth state."""
        codex_path = self._find_codex_cli()
        if not codex_path:
            return self._status_result(
                "not_installed",
                error="Codex CLI was not found. Install it or configure codex_path.",
            )

        version = self._command_text([codex_path, "--version"], timeout=10)
        if self.auth_method == self.AUTH_API_KEY:
            if not self.api_key:
                return self._status_result(
                    "authentication_required",
                    error="Authentication method is api_key, but no API key is configured.",
                    version=version,
                )
            return self._status_result("ready", version=version)

        try:
            completed = subprocess.run(
                [codex_path, "login", "status"],
                capture_output=True,
                text=True,
                timeout=10,
                env=self._build_environment(),
            )
        except (OSError, subprocess.SubprocessError) as exc:
            return self._status_result("error", error=str(exc), version=version)

        login_output = self._combined_output(completed).strip()
        if completed.returncode == 0:
            return self._status_result("ready", version=version)
        return self._status_result(
            "authentication_required",
            error=login_output or "Codex CLI login is required.",
            version=version,
        )

    def authentication_instructions(self) -> dict:
        """Return safe login instructions; never launch hidden interactive login."""
        codex_path = self._find_codex_cli() or "codex"
        return {
            "status": "authentication_required",
            "login_command": f"{codex_path} login --device-auth",
            "message": (
                "Run login command in a visible terminal. Codex CLI owns and stores "
                "credentials; this datasource does not receive them."
            ),
        }

    def reset_session(self) -> None:
        with self._lock:
            self.session_id = None

    def handle_message(self, message: Any, files: list | None = None) -> dict:
        """Send one turn and return normalized response plus native Codex events."""
        with self._lock:
            normalized = self._normalize_message(message, files)
            prompt = normalized["prompt"].strip()
            attachments = normalized["files"]
            requested_session_id = normalized["session_id"]
            new_session = normalized["new_session"]

            if not prompt and not attachments:
                return self._error_result("invalid_request", "Message is empty.")

            status = self.get_status()
            if status["status"] != "ready":
                result = self._error_result(status["status"], status["error"])
                result["authentication"] = self.authentication_instructions()
                return result

            if new_session:
                self.session_id = None
            if requested_session_id:
                self.session_id = requested_session_id

            with self._prepared_attachments(attachments) as prepared:
                effective_prompt = prompt
                if prepared["text_blocks"]:
                    effective_prompt = self._append_text_attachments(
                        effective_prompt, prepared["text_blocks"]
                    )
                if not effective_prompt:
                    effective_prompt = "Review the attached file."

                resume_id = self.session_id if self.resume_session else None
                command = self._build_command(
                    effective_prompt,
                    session_id=resume_id,
                    image_paths=prepared["image_paths"],
                )
                BBLogger.log(
                    "[SubjectiveCodexDataSource] Starting Codex turn "
                    f"mode={'resume' if resume_id else 'new'} "
                    f"session={resume_id or '-'} workspace={self.working_directory}"
                )
                result = self._execute_command(command)

            if result["success"] and result.get("session_id"):
                self.session_id = result["session_id"]
            elif not result.get("session_id"):
                result["session_id"] = self.session_id or ""
            return result

    def _execute_command(self, command: list[str]) -> dict:
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                env=self._build_environment(),
                cwd=self._valid_working_directory(),
            )
        except subprocess.TimeoutExpired:
            BBLogger.log(
                f"[SubjectiveCodexDataSource] Codex turn timed out after {self.timeout}s"
            )
            return self._error_result(
                "timeout", f"Codex execution timed out after {self.timeout} seconds."
            )
        except OSError as exc:
            BBLogger.log(f"[SubjectiveCodexDataSource] Failed to start Codex: {exc}")
            return self._error_result("execution_error", str(exc))

        parsed = self._parse_json_output(completed.stdout or "")
        if completed.returncode != 0:
            error_text = (completed.stderr or parsed.get("raw_text") or "").strip()
            status = self._classify_error(error_text)
            BBLogger.log(
                "[SubjectiveCodexDataSource] Codex turn failed "
                f"exit={completed.returncode} status={status}: {error_text[:500]}"
            )
            result = self._error_result(
                status, error_text or f"Codex exited with code {completed.returncode}."
            )
            result.update(
                {
                    "events": parsed["events"],
                    "session_id": parsed["session_id"] or self.session_id or "",
                    "usage": parsed["usage"],
                    "exit_code": completed.returncode,
                }
            )
            return result

        response = parsed["assistant_message"].strip()
        if not response:
            return {
                **self._error_result(
                    "invalid_response",
                    "Codex completed without an assistant message.",
                ),
                "events": parsed["events"],
                "session_id": parsed["session_id"] or self.session_id or "",
                "usage": parsed["usage"],
                "exit_code": completed.returncode,
            }

        BBLogger.log(
            "[SubjectiveCodexDataSource] Codex turn completed "
            f"session={parsed['session_id'] or self.session_id or '-'}"
        )
        return {
            "success": True,
            "status": "completed",
            "response": response,
            "session_id": parsed["session_id"] or self.session_id or "",
            "model": self.model,
            "error": "",
            "events": parsed["events"],
            "usage": parsed["usage"],
            "exit_code": completed.returncode,
        }

    def _build_command(
        self,
        message: str,
        *,
        session_id: str | None = None,
        image_paths: list[str] | None = None,
    ) -> list[str]:
        codex_path = self._find_codex_cli()
        if not codex_path:
            raise RuntimeError("Codex CLI not found")

        command = [codex_path]
        # --search is a top-level Codex option and must precede `exec`.
        if self.enable_search:
            command.append("--search")
        command.append("exec")

        if session_id:
            command.extend(["resume", "--json"])
        else:
            command.append("--json")

        if self.model:
            command.extend(["--model", self.model])
        if self.skip_git_repo_check:
            command.append("--skip-git-repo-check")

        if not session_id:
            if self.sandbox_mode:
                command.extend(["--sandbox", self.sandbox_mode])
            if self.approve_for_me:
                command.append("--approve-for-me")
            if self.working_directory:
                command.extend(["--cd", self.working_directory])

        for image_path in image_paths or []:
            command.extend(["--image", image_path])

        if session_id:
            command.append(session_id)
        command.append(message)
        return command

    def _parse_json_output(self, output: str) -> dict:
        events: list[dict[str, Any]] = []
        assistant_parts: list[str] = []
        raw_lines: list[str] = []
        session_id = ""
        usage: dict[str, Any] = {}

        for line in output.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                raw_lines.append(line)
                continue
            if not isinstance(event, dict):
                continue
            events.append(event)

            event_type = str(event.get("type") or "")
            if event_type in {"thread.started", "thread.resumed"}:
                session_id = str(
                    event.get("thread_id") or event.get("session_id") or session_id
                )

            if event_type in {"item.completed", "item.updated"}:
                item = event.get("item")
                if isinstance(item, dict) and item.get("type") in {
                    "agent_message",
                    "assistant_message",
                }:
                    text = self._extract_text(item)
                    if text and (not assistant_parts or assistant_parts[-1] != text):
                        assistant_parts.append(text)

            # Compatibility with older Codex JSON event layouts.
            if event_type == "message" and event.get("role") == "assistant":
                text = self._extract_text(event)
                if text and (not assistant_parts or assistant_parts[-1] != text):
                    assistant_parts.append(text)

            if event_type == "turn.completed" and isinstance(event.get("usage"), dict):
                usage = event["usage"]

        return {
            "events": events,
            "assistant_message": "\n".join(assistant_parts),
            "session_id": session_id,
            "usage": usage,
            "raw_text": "\n".join(raw_lines),
        }

    @staticmethod
    def _extract_text(payload: dict[str, Any]) -> str:
        direct = payload.get("text") or payload.get("output_text")
        if isinstance(direct, str):
            return direct

        content = payload.get("content")
        if isinstance(content, str):
            return content
        if not isinstance(content, list):
            return ""

        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text") or item.get("output_text")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)

    def _normalize_message(self, message: Any, files: list | None) -> dict:
        prompt = ""
        embedded_files: list[Any] = []
        session_id = ""
        new_session = False

        if isinstance(message, dict):
            prompt_value = (
                message.get("content")
                if message.get("content") is not None
                else message.get("text", message.get("prompt", message.get("message", "")))
            )
            prompt = str(prompt_value or "")
            for key in ("files", "attachments"):
                value = message.get(key)
                if isinstance(value, list):
                    embedded_files.extend(value)
            session_id = str(message.get("session_id") or "")
            new_session = self._coerce_bool(message.get("new_session", False))
        else:
            prompt = str(message or "")

        all_files = list(embedded_files)
        if isinstance(files, list):
            all_files.extend(files)
        return {
            "prompt": prompt,
            "files": all_files,
            "session_id": session_id or None,
            "new_session": new_session,
        }

    @contextmanager
    def _prepared_attachments(self, files: list[Any]) -> Iterator[dict[str, list]]:
        with tempfile.TemporaryDirectory(prefix="subjective-codex-") as temp_dir:
            image_paths: list[str] = []
            text_blocks: list[dict[str, str]] = []

            for index, item in enumerate(files):
                prepared = self._prepare_attachment(item, temp_dir, index)
                if not prepared:
                    continue
                if prepared["kind"] == "image":
                    image_paths.append(prepared["path"])
                else:
                    text_blocks.append(
                        {"name": prepared["name"], "text": prepared["text"]}
                    )
            yield {"image_paths": image_paths, "text_blocks": text_blocks}

    def _prepare_attachment(
        self, item: Any, temp_dir: str, index: int
    ) -> dict[str, str] | None:
        if isinstance(item, str):
            path = os.path.abspath(os.path.expanduser(item))
            return self._prepare_path_attachment(path)
        if not isinstance(item, dict):
            return None

        source_path = item.get("path") or item.get("file_path")
        if source_path:
            return self._prepare_path_attachment(
                os.path.abspath(os.path.expanduser(str(source_path)))
            )

        name = Path(str(item.get("name") or item.get("filename") or f"file-{index}"))
        safe_name = name.name or f"file-{index}"
        mime_type = str(
            item.get("mime_type")
            or item.get("type")
            or mimetypes.guess_type(safe_name)[0]
            or "application/octet-stream"
        )
        raw_value = item.get("data_base64")
        if raw_value is None:
            raw_value = item.get("content")
        if raw_value is None and isinstance(item.get("text"), str):
            return {"kind": "text", "name": safe_name, "text": item["text"]}
        if raw_value is None:
            return None

        try:
            raw = base64.b64decode(str(raw_value), validate=True)
        except (binascii.Error, ValueError):
            raw = str(raw_value).encode("utf-8", errors="replace")
        if len(raw) > self.MAX_ATTACHMENT_BYTES:
            return {
                "kind": "text",
                "name": safe_name,
                "text": f"[Attachment omitted: exceeds {self.MAX_ATTACHMENT_BYTES} bytes]",
            }

        if mime_type.startswith("image/"):
            path = os.path.join(temp_dir, f"{index}-{safe_name}")
            with open(path, "wb") as handle:
                handle.write(raw)
            return {"kind": "image", "name": safe_name, "path": path}

        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = "[Binary attachment; textual content unavailable]"
        return {"kind": "text", "name": safe_name, "text": text}

    def _prepare_path_attachment(self, path: str) -> dict[str, str] | None:
        if not os.path.isfile(path):
            return {
                "kind": "text",
                "name": os.path.basename(path) or "attachment",
                "text": f"[Attachment path not found: {path}]",
            }
        name = os.path.basename(path)
        mime_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        if mime_type.startswith("image/"):
            return {"kind": "image", "name": name, "path": path}
        if os.path.getsize(path) > self.MAX_ATTACHMENT_BYTES:
            return {
                "kind": "text",
                "name": name,
                "text": f"[Attachment omitted: exceeds {self.MAX_ATTACHMENT_BYTES} bytes]",
            }
        try:
            with open(path, "r", encoding="utf-8") as handle:
                text = handle.read()
        except (OSError, UnicodeDecodeError):
            text = f"[Binary attachment available at: {path}]"
        return {"kind": "text", "name": name, "text": text}

    @staticmethod
    def _append_text_attachments(prompt: str, blocks: list[dict[str, str]]) -> str:
        sections = [prompt] if prompt else []
        for block in blocks:
            sections.append(
                f"<attachment name={json.dumps(block['name'])}>\n"
                f"{block['text']}\n"
                "</attachment>"
            )
        return "\n\n".join(sections)

    def _find_codex_cli(self) -> str | None:
        if self._codex_path:
            return self._codex_path

        candidates: list[str] = []
        if self.configured_codex_path:
            candidates.append(os.path.expanduser(self.configured_codex_path))
        path_candidate = shutil.which("codex")
        if path_candidate:
            candidates.append(path_candidate)
        candidates.extend(
            [
                os.path.expanduser("~/.local/bin/codex"),
                os.path.expanduser("~/bin/codex"),
                "/usr/local/bin/codex",
                os.path.expanduser("~/.npm-global/bin/codex"),
                os.path.expanduser("~/AppData/Local/Programs/codex/codex.exe"),
            ]
        )

        for candidate in candidates:
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                self._codex_path = os.path.abspath(candidate)
                return self._codex_path
        return None

    def _build_environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        if self.auth_method == self.AUTH_API_KEY and self.api_key:
            environment["OPENAI_API_KEY"] = self.api_key
        return environment

    def _valid_working_directory(self) -> str | None:
        if self.working_directory and os.path.isdir(self.working_directory):
            return self.working_directory
        return None

    @staticmethod
    def _combined_output(completed: subprocess.CompletedProcess) -> str:
        return "\n".join(
            part.strip()
            for part in (completed.stdout or "", completed.stderr or "")
            if part and part.strip()
        )

    def _command_text(self, command: list[str], timeout: int) -> str:
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
        return self._combined_output(completed).strip()

    @staticmethod
    def _classify_error(error_text: str) -> str:
        lowered = error_text.lower()
        if any(token in lowered for token in ("login", "not authenticated", "unauthorized")):
            return "authentication_required"
        if any(
            token in lowered
            for token in ("usage limit", "rate limit", "quota", "too many requests")
        ):
            return "quota_limited"
        if "session" in lowered and any(
            token in lowered for token in ("not found", "unknown", "does not exist")
        ):
            return "session_not_found"
        return "execution_error"

    def _status_result(
        self, status: str, *, error: str = "", version: str = ""
    ) -> dict:
        return {
            "success": status == "ready",
            "status": status,
            "response": "",
            "session_id": self.session_id or "",
            "model": self.model,
            "error": error,
            "events": [],
            "usage": {},
            "provider": "codex",
            "cli_path": self._find_codex_cli() or "",
            "cli_version": version,
        }

    def _error_result(self, status: str, error: str) -> dict:
        return {
            "success": False,
            "status": status,
            "response": "",
            "session_id": self.session_id or "",
            "model": self.model,
            "error": error,
            "events": [],
            "usage": {},
        }

    @staticmethod
    def _coerce_bool(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @staticmethod
    def _coerce_int(value: Any, default: int, *, minimum: int) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            parsed = default
        return max(minimum, parsed)
