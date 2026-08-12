import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATASOURCE_PATH = (
    ROOT
    / "pipelines"
    / "history"
    / "plugins"
    / "subjective_localchats_datasource"
    / "SubjectiveLocalchatsDataSource.py"
)


def load_datasource_class():
    datasource_package = types.ModuleType("subjective_abstract_data_source_package")
    datasource_package.SubjectiveDataSource = type("SubjectiveDataSource", (), {})
    logger_package = types.ModuleType("brainboost_data_source_logger_package.BBLogger")
    logger_package.BBLogger = type("BBLogger", (), {"log": staticmethod(lambda _message: None)})
    sys.modules["subjective_abstract_data_source_package"] = datasource_package
    sys.modules["brainboost_data_source_logger_package"] = types.ModuleType(
        "brainboost_data_source_logger_package"
    )
    sys.modules["brainboost_data_source_logger_package.BBLogger"] = logger_package

    spec = importlib.util.spec_from_file_location("localchats_datasource_test", DATASOURCE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.SubjectiveLocalchatsDataSource


class LocalChatsParserTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        datasource_class = load_datasource_class()
        cls.datasource = datasource_class.__new__(datasource_class)

    def test_codex_metadata_is_ignored_and_exec_command_stays_complete(self):
        command = (
            "git -C /brainboost/subjective_v2 add "
            "subjective_user_service/src/subjective_user_service/routers/domain/billing.py "
            "subjective_user_service/tests/test_billing_domain.py"
        )
        tool_input = (
            "const r = await tools.exec_command("
            + json.dumps({"cmd": command, "workdir": "/subjective"})
            + "); text(r.output);"
        )
        records = [
            {
                "timestamp": "2026-08-10T00:00:00Z",
                "type": "world_state",
                "payload": {
                    "state": {
                        "permissions": {
                            "approved_command_prefixes": [
                                ["git", "-C", "/brainboost/subjective_v2", "add"]
                            ]
                        }
                    }
                },
            },
            {
                "timestamp": "2026-08-10T00:00:01Z",
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": "Stage billing changes"}],
                },
            },
            {
                "timestamp": "2026-08-10T00:00:01Z",
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": "<recommended_plugins>hidden</recommended_plugins>"}],
                },
            },
            {
                "timestamp": "2026-08-10T00:00:01Z",
                "type": "compacted",
                "payload": {
                    "replacement_history": [{
                        "type": "message",
                        "role": "developer",
                        "content": [{"type": "input_text", "text": "Internal developer prompt"}],
                    }]
                },
            },
            {
                "timestamp": "2026-08-10T00:00:02Z",
                "type": "event_msg",
                "payload": {"type": "user_message", "message": "Stage billing changes"},
            },
            {
                "timestamp": "2026-08-10T00:00:03Z",
                "type": "response_item",
                "payload": {"type": "custom_tool_call", "name": "exec", "input": tool_input},
            },
        ]

        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record) + "\n")
            handle.flush()
            messages = self.datasource._parse_jsonl_messages(handle.name, "codex")

        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0]["role"], "user")
        self.assertEqual(messages[1]["kind"], "command")
        self.assertEqual(messages[1]["command"], command)
        self.assertEqual(messages[1]["workdir"], "/subjective")
        self.assertNotIn("git", [message["text"] for message in messages])

    def test_codex_exec_accepts_javascript_object_literal_properties(self):
        command = 'curl -s -o /dev/null -w "HTTP %{http_code}\\n" https://example.com'
        tool_input = (
            "const r = await tools.exec_command({\n"
            f"  cmd: {json.dumps(command)},\n"
            '  workdir: "/subjective",\n'
            "  yield_time_ms: 10000\n"
            "}); text(r.output);"
        )

        parsed = self.datasource._codex_exec_command(tool_input)

        self.assertEqual(parsed["cmd"], command)
        self.assertEqual(parsed["workdir"], "/subjective")


if __name__ == "__main__":
    unittest.main()
