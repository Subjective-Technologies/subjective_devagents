#!/usr/bin/env python3
"""Re-parse one live IDE/CLI transcript. Stdin JSON, stdout JSON. No full scan."""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATASOURCE_PATH = (
    ROOT
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

    import importlib.util

    spec = importlib.util.spec_from_file_location("localchats_reload_one", DATASOURCE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.SubjectiveLocalchatsDataSource


def main() -> int:
    try:
        request = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError) as exc:
        print(json.dumps({"success": False, "error": f"invalid request: {exc}"}))
        return 1
    if not isinstance(request, dict):
        print(json.dumps({"success": False, "error": "request must be a JSON object"}))
        return 1
    datasource_class = load_datasource_class()
    datasource = datasource_class.__new__(datasource_class)
    datasource.max_messages_per_chat = 0
    datasource._active_user_homes = None
    transcript = datasource.reload_transcript(
        source_file=str(request.get("source_file") or ""),
        session_id=str(request.get("session_id") or ""),
        provider=str(request.get("provider") or ""),
    )
    if not transcript:
        print(json.dumps({"success": False, "error": "no live transcript"}))
        return 0
    print(json.dumps({"success": True, "transcript": transcript}, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
