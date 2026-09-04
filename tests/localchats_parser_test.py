import importlib.util
import json
import os
import sqlite3
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


    def test_cursor_tab_name_from_composer_headers_beats_first_message(self):
        composer_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        index = {}
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = os.path.join(temp_dir, "state.vscdb")
            conn = sqlite3.connect(db_path)
            conn.execute(
                "CREATE TABLE composerHeaders "
                "(composerId TEXT PRIMARY KEY, workspaceId TEXT, createdAt INTEGER, "
                "lastUpdatedAt INTEGER, isArchived INTEGER, isSubagent INTEGER, "
                "recency INTEGER, checkpointAt INTEGER, value TEXT)"
            )
            conn.execute(
                "INSERT INTO composerHeaders VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    composer_id,
                    "ws",
                    1,
                    2,
                    0,
                    0,
                    2,
                    0,
                    json.dumps({"type": "head", "composerId": composer_id, "name": "dashboard_agent"}),
                ),
            )
            conn.commit()
            conn.close()
            self.datasource._ingest_cursor_db_tab_names(db_path, index)
        self.assertEqual(index[composer_id]["name"], "dashboard_agent")

        transcript_path = (
            f"/home/goldenthinker/.cursor/projects/subjective/agent-transcripts/"
            f"{composer_id}/{composer_id}.jsonl"
        )
        self.assertEqual(self.datasource._cursor_agent_id(transcript_path), composer_id)
        annotated = self.datasource._annotate_cursor_agent_candidates(
            [{"product": "cursor", "kind": "agent", "path": transcript_path}],
            index,
        )
        self.assertEqual(annotated[0]["cursor_name"], "dashboard_agent")

    def test_cursor_subagent_transcripts_are_dropped(self):
        composer_id = "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee"
        path = (
            f"/home/u/.cursor/projects/p/agent-transcripts/{composer_id}/subagents/child.jsonl"
        )
        discovered = self.datasource._annotate_cursor_agent_candidates(
            [{"product": "cursor", "kind": "agent", "path": path}],
            {composer_id: {"name": "Parent tab", "is_subagent": True}},
        )
        self.assertEqual(discovered, [])

    def test_title_noise_skips_you_are_prompt_fragments(self):
        self.assertTrue(self.datasource._is_title_noise("you a"))
        self.assertTrue(self.datasource._is_title_noise("You are Cursor Grok"))
        self.assertFalse(self.datasource._is_title_noise("dashboard_agent"))
        self.assertEqual(
            self.datasource._derive_title(
                "chat.jsonl",
                [
                    {"role": "user", "text": "You are an AI coding assistant"},
                    {"role": "user", "text": "Rename the chat list to tab names"},
                ],
            ),
            "Rename the chat list to tab names",
        )

    def test_duplicate_tab_titles_get_disambiguator(self):
        manifest = {
            "sources": {
                "a": {
                    "tab_title": "Work",
                    "title": "Work",
                    "source_file": "/home/u/.cursor/projects/alpha-app/agent-transcripts/x/x.jsonl",
                },
                "b": {
                    "tab_title": "Work",
                    "title": "Work",
                    "source_file": "/home/u/.cursor/projects/beta-app/agent-transcripts/y/y.jsonl",
                },
                "c": {
                    "tab_title": "Keep me",
                    "title": "Keep me",
                    "source_file": "/home/u/.cursor/projects/p/agent-transcripts/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/subagents/child.jsonl",
                },
                "d": {
                    "tab_title": "Composer twin",
                    "title": "Composer twin",
                    "source_file": "/tmp/state.vscdb#composer:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                },
                "e": {
                    "tab_title": "Composer twin",
                    "title": "Composer twin",
                    "source_file": "/home/u/.cursor/projects/p/agent-transcripts/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl",
                },
            }
        }
        self.datasource._drop_agent_jsonl_twins(manifest)
        self.assertNotIn("c", manifest["sources"])
        self.assertNotIn("e", manifest["sources"])
        self.assertIn("d", manifest["sources"])
        self.datasource._disambiguate_duplicate_titles(manifest)
        titles = {record["title"] for record in manifest["sources"].values()}
        self.assertIn("Work · alpha-app", titles)
        self.assertIn("Work · beta-app", titles)

    def test_apply_cursor_tab_names_overwrites_stale_first_message_titles(self):
        jsonl_id = "11115350-aaaa-bbbb-cccc-dddddddddddd"
        composer_id = "1caed09f-aaaa-bbbb-cccc-dddddddddddd"
        manifest = {
            "sources": {
                "stale": {
                    "tab_title": "you a",
                    "title": "you a",
                    "source_file": (
                        f"/home/gordon/.cursor/projects/p/agent-transcripts/"
                        f"{jsonl_id}/{jsonl_id}.jsonl"
                    ),
                },
                "composer": {
                    "tab_title": "the test is passed but I do not see any conversion",
                    "title": "the test is passed but I do not see any conversion",
                    "source_file": f"/tmp/state.vscdb#composer:{composer_id}",
                },
                "other": {
                    "tab_title": "Keep derived",
                    "title": "Keep derived",
                    "source_file": "/home/u/.claude/projects/x/session.jsonl",
                },
            }
        }
        self.datasource._apply_cursor_tab_names(
            manifest,
            {
                jsonl_id: {"name": "manager_new"},
                composer_id: {"name": "VAI-238"},
            },
        )
        self.assertEqual(manifest["sources"]["stale"]["tab_title"], "manager_new")
        self.assertEqual(manifest["sources"]["composer"]["tab_title"], "VAI-238")
        self.assertEqual(manifest["sources"]["other"]["tab_title"], "Keep derived")
        self.datasource._disambiguate_duplicate_titles(manifest)
        self.assertEqual(manifest["sources"]["stale"]["title"], "manager_new")
        self.assertEqual(manifest["sources"]["composer"]["title"], "VAI-238")

    def test_cursor_user_query_xml_is_unwrapped_and_task_pings_are_hidden(self):
        records = [
            {
                "role": "user",
                "message": {
                    "content": [{
                        "type": "text",
                        "text": (
                            "<timestamp>Tuesday, Aug 18, 2026, 10:58 AM (UTC-3)</timestamp>\n"
                            "<user_query>\nsee all messages for selenium_agent\n</user_query>"
                        ),
                    }]
                },
            },
            {
                "role": "user",
                "message": {
                    "content": [{
                        "type": "text",
                        "text": (
                            "<timestamp>Tuesday, Aug 18, 2026, 10:59 AM (UTC-3)</timestamp>\n"
                            "<system_notification>\nThe above task is complete.\n"
                            "<task>\nkind: shell\nstatus: success\n"
                            "title: Rebuild API and start Vite on VAI 281\n"
                            "</task>\n</system_notification_>\n"
                            "<user_query>Briefly inform the user about the task result "
                            "and perform any follow-up actions (if needed).</user_query>"
                        ),
                    }]
                },
            },
            {
                "role": "assistant",
                "message": {
                    "content": [{"type": "text", "text": "3 passed / 3 skipped"}]
                },
            },
        ]
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record) + "\n")
            handle.flush()
            messages = self.datasource._parse_jsonl_messages(handle.name, "cursor")

        self.assertEqual(
            [(m["role"], m["text"]) for m in messages],
            [
                ("user", "see all messages for selenium_agent"),
                ("system", "Task finished: Rebuild API and start Vite on VAI 281"),
                ("assistant", "3 passed / 3 skipped"),
            ],
        )

    def test_cursor_ask_question_tool_becomes_visible_lettered_prompt(self):
        record = {
            "role": "assistant",
            "message": {
                "content": [{
                    "type": "tool_use",
                    "name": "AskQuestion",
                    "input": {
                        "title": "How should I proceed?",
                        "questions": [{
                            "prompt": "How should I proceed?",
                            "options": [
                                {"id": "a", "label": "Check logs"},
                                {"id": "b", "label": "Fix frozen chats"},
                                {"id": "c", "label": "Show hidden questions"},
                                {"id": "d", "label": "Stop IRC spam"},
                                {"id": "e", "label": "All of the above"},
                            ],
                        }],
                    },
                }]
            },
        }
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", encoding="utf-8") as handle:
            handle.write(json.dumps(record) + "\n")
            handle.flush()
            messages = self.datasource._parse_jsonl_messages(handle.name, "cursor")
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["role"], "assistant")
        self.assertIn("E. All of the above", messages[0]["text"])
        self.assertIn("Which — A, B, C, D, or E?", messages[0]["text"])

    def test_cursor_tool_use_becomes_read_and_diff_cards(self):
        records = [
            {
                "role": "assistant",
                "message": {
                    "content": [
                        {"type": "text", "text": "I'll edit the file."},
                        {"type": "tool_use", "name": "Read", "input": {"path": "/subjective/src/renderer.js"}},
                        {
                            "type": "tool_use",
                            "name": "StrReplace",
                            "input": {
                                "path": "/subjective/src/renderer.js",
                                "old_string": "const x = 1",
                                "new_string": "const x = 2",
                            },
                        },
                    ]
                },
            }
        ]
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record) + "\n")
            handle.flush()
            messages = self.datasource._parse_jsonl_messages(handle.name, "cursor")
        kinds = [(m.get("role"), m.get("kind") or "", m.get("text", "")) for m in messages]
        self.assertTrue(any(role == "assistant" and "I'll edit" in text for role, _kind, text in kinds))
        self.assertTrue(any("Read `" in text for _role, _kind, text in kinds))
        self.assertTrue(any(kind == "code" and "- const x = 1" in text for _role, kind, text in kinds))

    def test_reload_composer_merges_jsonl_diff_cards(self):
        composer_id = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = os.path.join(temp_dir, "state.vscdb")
            conn = sqlite3.connect(db_path)
            conn.execute("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)")
            conn.execute(
                "INSERT INTO cursorDiskKV VALUES (?, ?)",
                (
                    f"composerData:{composer_id}",
                    json.dumps({
                        "composerId": composer_id,
                        "name": "agents_chat_dashboard",
                        "createdAt": 1,
                        "lastUpdatedAt": 2,
                    }),
                ),
            )
            conn.execute(
                "INSERT INTO cursorDiskKV VALUES (?, ?)",
                (
                    f"bubbleId:{composer_id}:u1",
                    json.dumps({"type": 1, "text": "add a refresh button", "createdAt": 10}),
                ),
            )
            conn.execute(
                "INSERT INTO cursorDiskKV VALUES (?, ?)",
                (
                    f"bubbleId:{composer_id}:a1",
                    json.dumps({"type": 2, "text": "I'll look at the frames.", "createdAt": 11}),
                ),
            )
            conn.commit()
            conn.close()

            home = os.path.join(temp_dir, "home", "tester")
            jsonl_dir = os.path.join(
                home, ".cursor", "projects", "p", "agent-transcripts", composer_id
            )
            os.makedirs(jsonl_dir)
            jsonl_path = os.path.join(jsonl_dir, f"{composer_id}.jsonl")
            with open(jsonl_path, "w", encoding="utf-8") as handle:
                handle.write(json.dumps({
                    "role": "assistant",
                    "message": {
                        "content": [
                            {"type": "text", "text": "I'll look at the frames."},
                            {
                                "type": "tool_use",
                                "name": "StrReplace",
                                "input": {
                                    "path": "/subjective/src/renderer.js",
                                    "old_string": "old",
                                    "new_string": "new",
                                },
                            },
                        ]
                    },
                }) + "\n")

            self.datasource.max_messages_per_chat = 0
            self.datasource._active_user_homes = [{"home": home, "source_user": "tester"}]
            transcript = self.datasource.reload_transcript(
                source_file=f"{db_path}#composer:{composer_id}",
                session_id=composer_id,
                provider="cursor",
            )
            self.assertIsNotNone(transcript)
            texts = [str(m.get("text") or "") for m in transcript["messages"]]
            self.assertTrue(any("add a refresh button" in text for text in texts))
            self.assertTrue(any("I'll look at the frames." in text for text in texts))
            self.assertTrue(any("- old" in text and "+ new" in text for text in texts))
            self.assertEqual(transcript["title"], "agents_chat_dashboard")


if __name__ == "__main__":
    unittest.main()
