import base64
import json
import os
import subprocess
import unittest
from unittest.mock import patch

from SubjectiveCodexDataSource import SubjectiveCodexDataSource


def completed(command, returncode=0, stdout="", stderr=""):
    return subprocess.CompletedProcess(command, returncode, stdout, stderr)


def event_lines(*events):
    return "\n".join(json.dumps(event) for event in events) + "\n"


class SubjectiveCodexDataSourceTests(unittest.TestCase):
    def datasource(self, **connection):
        defaults = {
            "auth_method": "existing_session",
            "working_directory": "/tmp",
            "sandbox_mode": "read-only",
        }
        defaults.update(connection)
        instance = SubjectiveCodexDataSource(connection=defaults, config={})
        instance._codex_path = "/usr/bin/codex"
        return instance

    def ready(self, instance):
        instance.get_status = lambda: instance._status_result("ready")

    def test_v2_contract_and_safe_defaults(self):
        instance = self.datasource()
        self.assertEqual(instance.api_version(), "v2")
        self.assertTrue(instance.supports_chat())
        self.assertEqual(instance.auth_method, "existing_session")
        self.assertEqual(instance.sandbox_mode, "read-only")
        self.assertTrue(instance.resume_session)
        self.assertFalse(instance.approve_for_me)
        self.assertIn("prompt", instance.request_schema())
        self.assertIn("session_id", instance.output_schema())

    @patch("SubjectiveCodexDataSource.subprocess.run")
    def test_status_reuses_existing_cli_login_without_starting_login(self, run):
        run.side_effect = [
            completed([], stdout="codex-cli 0.147.0\n"),
            completed([], stdout="Logged in using ChatGPT\n"),
        ]
        result = self.datasource().get_status()

        self.assertTrue(result["success"])
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["cli_version"], "codex-cli 0.147.0")
        commands = [call.args[0] for call in run.call_args_list]
        self.assertIn(["/usr/bin/codex", "login", "status"], commands)
        self.assertFalse(any("--device-auth" in command for command in commands))

    @patch("SubjectiveCodexDataSource.subprocess.run")
    def test_status_reports_login_required(self, run):
        run.side_effect = [
            completed([], stdout="codex-cli 0.147.0\n"),
            completed([], returncode=1, stderr="Not logged in\n"),
        ]
        result = self.datasource().get_status()
        self.assertFalse(result["success"])
        self.assertEqual(result["status"], "authentication_required")
        self.assertIn("Not logged in", result["error"])

    def test_api_key_is_scoped_to_child_environment(self):
        original = os.environ.get("OPENAI_API_KEY")
        instance = self.datasource(auth_method="api_key", api_key="test-secret")
        environment = instance._build_environment()

        self.assertEqual(environment["OPENAI_API_KEY"], "test-secret")
        self.assertEqual(os.environ.get("OPENAI_API_KEY"), original)

    def test_new_session_command_uses_current_option_layout(self):
        instance = self.datasource(
            model="gpt-test",
            enable_search=True,
            approve_for_me=True,
            skip_git_repo_check=True,
        )
        command = instance._build_command("hello", image_paths=["/tmp/image.png"])

        self.assertEqual(command[:3], ["/usr/bin/codex", "--search", "exec"])
        self.assertIn("--json", command)
        self.assertIn("--approve-for-me", command)
        self.assertNotIn("--full-auto", command)
        self.assertEqual(command[-1], "hello")
        self.assertLess(command.index("--search"), command.index("exec"))

    def test_resume_command_uses_native_thread_id(self):
        instance = self.datasource(model="gpt-test", approve_for_me=True)
        command = instance._build_command(
            "continue", session_id="thread-123", image_paths=["/tmp/image.png"]
        )

        self.assertEqual(command[:4], ["/usr/bin/codex", "exec", "resume", "--json"])
        self.assertIn("thread-123", command)
        self.assertNotIn("--cd", command)
        self.assertNotIn("--sandbox", command)
        self.assertNotIn("--approve-for-me", command)
        self.assertEqual(command[-1], "continue")

    def test_parser_supports_current_codex_jsonl(self):
        output = event_lines(
            {"type": "thread.started", "thread_id": "thread-123"},
            {"type": "turn.started"},
            {
                "type": "item.completed",
                "item": {"id": "item-1", "type": "agent_message", "text": "Done."},
            },
            {
                "type": "turn.completed",
                "usage": {"input_tokens": 12, "output_tokens": 3},
            },
        )
        parsed = self.datasource()._parse_json_output(output)

        self.assertEqual(parsed["session_id"], "thread-123")
        self.assertEqual(parsed["assistant_message"], "Done.")
        self.assertEqual(parsed["usage"]["output_tokens"], 3)
        self.assertEqual(len(parsed["events"]), 4)

    def test_parser_keeps_legacy_message_compatibility(self):
        output = event_lines(
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "text", "text": "Legacy response"}],
            }
        )
        parsed = self.datasource()._parse_json_output(output)
        self.assertEqual(parsed["assistant_message"], "Legacy response")

    @patch("SubjectiveCodexDataSource.subprocess.run")
    def test_second_message_resumes_session_created_by_first(self, run):
        instance = self.datasource()
        self.ready(instance)
        run.side_effect = [
            completed(
                [],
                stdout=event_lines(
                    {"type": "thread.started", "thread_id": "thread-123"},
                    {
                        "type": "item.completed",
                        "item": {"type": "agent_message", "text": "First"},
                    },
                ),
            ),
            completed(
                [],
                stdout=event_lines(
                    {"type": "thread.started", "thread_id": "thread-123"},
                    {
                        "type": "item.completed",
                        "item": {"type": "agent_message", "text": "Second"},
                    },
                ),
            ),
        ]

        first = instance.handle_message("hello")
        second = instance.handle_message("continue")

        self.assertTrue(first["success"])
        self.assertEqual(first["session_id"], "thread-123")
        self.assertEqual(second["response"], "Second")
        second_command = run.call_args_list[1].args[0]
        self.assertEqual(second_command[:4], ["/usr/bin/codex", "exec", "resume", "--json"])
        self.assertIn("thread-123", second_command)

    @patch("SubjectiveCodexDataSource.subprocess.run")
    def test_explicit_new_session_does_not_resume(self, run):
        instance = self.datasource(session_id="old-thread")
        self.ready(instance)
        run.return_value = completed(
            [],
            stdout=event_lines(
                {"type": "thread.started", "thread_id": "new-thread"},
                {
                    "type": "item.completed",
                    "item": {"type": "agent_message", "text": "New"},
                },
            ),
        )

        result = instance.handle_message({"content": "start", "new_session": True})

        self.assertEqual(result["session_id"], "new-thread")
        command = run.call_args.args[0]
        self.assertNotIn("resume", command)
        self.assertNotIn("old-thread", command)

    @patch("SubjectiveCodexDataSource.subprocess.run")
    def test_cli_error_is_structured_and_keeps_session(self, run):
        instance = self.datasource(session_id="thread-123")
        self.ready(instance)
        run.return_value = completed([], returncode=1, stderr="session not found")

        result = instance.handle_message("continue")

        self.assertFalse(result["success"])
        self.assertEqual(result["status"], "session_not_found")
        self.assertEqual(result["session_id"], "thread-123")
        self.assertEqual(result["exit_code"], 1)

    @patch("SubjectiveCodexDataSource.subprocess.run")
    def test_timeout_is_structured(self, run):
        instance = self.datasource(timeout=10)
        self.ready(instance)
        run.side_effect = subprocess.TimeoutExpired(["codex"], timeout=10)

        result = instance.handle_message("hello")

        self.assertFalse(result["success"])
        self.assertEqual(result["status"], "timeout")

    def test_text_and_image_attachments_are_normalized(self):
        instance = self.datasource()
        files = [
            {
                "filename": "notes.txt",
                "content": base64.b64encode(b"important context").decode("ascii"),
            },
            {
                "filename": "pixel.png",
                "mime_type": "image/png",
                "content": base64.b64encode(b"not-a-real-png").decode("ascii"),
            },
        ]

        with instance._prepared_attachments(files) as prepared:
            self.assertEqual(prepared["text_blocks"][0]["text"], "important context")
            self.assertEqual(len(prepared["image_paths"]), 1)
            self.assertTrue(os.path.isfile(prepared["image_paths"][0]))

    @patch("SubjectiveCodexDataSource.subprocess.run")
    def test_request_can_select_workspace_and_sandbox(self, run):
        instance = self.datasource(working_directory="/tmp", sandbox_mode="read-only")
        self.ready(instance)
        run.return_value = completed(
            [],
            stdout=event_lines(
                {"type": "thread.started", "thread_id": "thread-workspace"},
                {
                    "type": "item.completed",
                    "item": {"type": "agent_message", "text": "Ready"},
                },
            ),
        )
        result = instance.handle_message(
            {
                "content": "start",
                "workspace": "/subjective",
                "sandbox_mode": "workspace-write",
                "new_session": True,
            }
        )
        self.assertTrue(result["success"])
        command = run.call_args.args[0]
        self.assertIn("/subjective", command)
        self.assertIn("workspace-write", command)


@unittest.skipUnless(
    os.environ.get("RUN_CODEX_LIVE_TEST") == "1",
    "set RUN_CODEX_LIVE_TEST=1 to use local Codex account",
)
class SubjectiveCodexLiveTests(unittest.TestCase):
    def test_authenticated_read_only_turn(self):
        instance = SubjectiveCodexDataSource(
            connection={
                "auth_method": "existing_session",
                "working_directory": os.getcwd(),
                "sandbox_mode": "read-only",
                "timeout": 120,
            },
            config={},
        )
        result = instance.handle_message("Reply with exactly: codex datasource works")
        self.assertTrue(result["success"], result)
        self.assertIn("codex datasource works", result["response"].lower())
        self.assertTrue(result["session_id"])


if __name__ == "__main__":
    unittest.main()
