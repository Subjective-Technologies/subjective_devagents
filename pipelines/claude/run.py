#!/usr/bin/env python3
"""Bundle launcher for subjective_chat_claude.

Resolves logs/context/userdata locations, materialises the bundled per.sis
(when a passphrase is supplied), adds bundled plugin folders to sys.path, and
smoke-tests that each datasource class imports. The actual pipeline runtime is
in subjective_control_lib + the legacy Subjective runtime — this script
prepares the environment they expect.

Usage:
  python run.py --check                       # smoke-test only
  python run.py --connections-passphrase PASS # materialise per.sis then check
  python run.py --print-env                   # show resolved env without acting
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

BUNDLE_ROOT = Path(__file__).resolve().parent
PIPELINE_NAME = "subjective_chat_claude"
BUNDLED_PLUGIN_FOLDERS = ["subjective_claude_cli_datasource"]


def resolve_userdata_paths() -> dict:
    """Resolve the per-pipeline user data layout for this exported bundle.

    Convention: each exported pipeline owns ``~/.<pipeline_name>/`` and writes
    its ``logs/``, ``context/``, ``workspace/`` (the per-node input/output/
    scratch port folders) and ``per.sis``/``per.sis.key`` there. This isolates
    pipelines from each other and from the global Subjective userdata layout.

    Cross-platform: ``Path.home()`` resolves to ``/home/<user>`` on Linux,
    ``/Users/<user>`` on macOS, and ``%USERPROFILE%`` on Windows.

    Falls back to bundle-local ``<bundle_root>/{logs,context,workspace}``
    only when the per-pipeline home cannot be created (e.g. a relocated bundle
    on a read-only filesystem, or a single-executable kiosk distribution).
    """
    pipeline_home = Path.home() / f".{PIPELINE_NAME}"
    target = pipeline_home
    using_home = True
    try:
        pipeline_home.mkdir(parents=True, exist_ok=True)
    except OSError:
        target = BUNDLE_ROOT
        using_home = False
    for sub in ("logs", "context", "workspace"):
        try:
            (target / sub).mkdir(parents=True, exist_ok=True)
        except OSError:
            # If the chosen target itself isn't writable for a subdir, fall
            # back to bundle-local for the remainder.
            target = BUNDLE_ROOT
            using_home = False
            for retry_sub in ("logs", "context", "workspace"):
                (target / retry_sub).mkdir(parents=True, exist_ok=True)
            break
    return {
        "userdata_path": str(target),
        "log_path": str(target / "logs"),
        "context_storage": str(target / "context"),
        "datasources_temp_storage": str(target / "workspace"),
        "using_pipeline_home": using_home,
        "pipeline_home_path": str(pipeline_home),
    }


def add_plugin_sys_paths() -> list:
    plugins_dir = BUNDLE_ROOT / "plugins"
    added = []
    for folder in BUNDLED_PLUGIN_FOLDERS:
        plugin_dir = plugins_dir / folder
        if plugin_dir.is_dir():
            sys.path.insert(0, str(plugin_dir))
            added.append(str(plugin_dir))
    return added


def init_bblogger(env: dict) -> dict:
    """Wire BBLogger to LOG_PATH using the canonical per-run file convention.

    Without this, BBLogger's defaults leave ``log_enable_files=False`` so every
    runtime ``BBLogger.log(...)`` call falls through to stdout. A supervisor
    (Electron, systemd, nohup) then captures stdout to a single undifferentiated
    file. With this, BBLogger writes ``<LOG_PATH>/<YYYY_MM_DD_HH_MM_SS>-<process>-log.log``
    per the subjective platform's convention.

    BBConfig is chatty during configure/override (each call prints "Configuration
    key ... overridden ..." to stdout). We suppress that here so ``--print-env``
    and ``--check`` keep emitting parseable JSON as the FIRST line of stdout.
    """
    import contextlib, io
    report = {"status": "skipped", "files_enabled": False}
    try:
        from brainboost_configuration_package.BBConfig import BBConfig
    except Exception as exc:
        report["reason"] = f"BBConfig not importable: {exc}"
        return report
    conf = BUNDLE_ROOT / "config" / "subjective.conf"
    if not conf.is_file():
        report["reason"] = "bundle subjective.conf missing"
        return report
    bblogger_overrides = (
        ("USERDATA_PATH",            env["userdata_path"]),
        ("LOG_PATH",                 env["log_path"]),
        ("CONTEXT_STORAGE",          env["context_storage"]),
        ("DATASOURCES_TEMP_STORAGE", env["datasources_temp_storage"]),
        ("DS_CONNECTION_TMP_SPACE",  env["datasources_temp_storage"]),
        # The runtime's ``import_datasource_class`` looks up plugins via
        # ``BBConfig.get("DATASOURCES_PLUGIN_PATH")``. Once BBConfig is
        # configured here, our placeholder empty value would shadow the
        # ``os.environ`` setting and break plugin resolution; override to
        # the bundled ``plugins/`` folder so the bundle stays self-contained.
        ("DATASOURCES_PLUGIN_PATH",  str(BUNDLE_ROOT / "plugins")),
        ("LOG_PREFIX",               PIPELINE_NAME),
        ("LOG_ENABLE_FILES",         "true"),
        ("LOG_ENABLE_TERMINAL_OUTPUT", "false"),
        ("LOG_FILE_NAMING",          "per_run"),
        ("LOG_FILE_NAME_CONVENTION", "YYYY_MM_DD_HH_MM_SS-[process]-log.log"),
        ("LOG_COLUMNS",              "timestamp,log_type,process,code_location,message,processing_time"),
        ("LOG_DELIMITER",            "|"),
    )
    try:
        sink = io.StringIO()
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            BBConfig.configure(
                str(conf),
                upload_to_redis=False,
                autofix_paths=False,
                persist_autofix=False,
            )
            for key, value in bblogger_overrides:
                BBConfig.override(key, value)
            # Invalidate BBLogger's config cache so the next BBLogger.log picks
            # up the overrides we just set (otherwise the 5s TTL on the cache
            # means the first few log lines still go to stdout).
            try:
                from brainboost_data_source_logger_package import BBLogger
                BBLogger.invalidate_config_cache()
            except Exception:
                pass
        report.update({
            "status": "configured",
            "files_enabled": True,
            "config": str(conf),
            "log_file_hint": f"{env['log_path']}/<YYYY_MM_DD_HH_MM_SS>-<process>-log.log",
            "overridden_keys": [k for k, _ in bblogger_overrides],
        })
        # Emit a startup line so the log file is created immediately (BBLogger
        # is lazy — it only opens the file on the first ``BBLogger.log`` call).
        # We swallow this line's own stdout echo to keep --print-env JSON clean.
        try:
            from brainboost_data_source_logger_package import BBLogger
            sink2 = io.StringIO()
            with contextlib.redirect_stdout(sink2), contextlib.redirect_stderr(sink2):
                BBLogger.log(
                    f"[run.py] Bundle launcher started for pipeline {PIPELINE_NAME}; "
                    f"log_path={env['log_path']} workspace={env['datasources_temp_storage']}"
                )
            try:
                first_path = BBLogger._get_log_file_path()
                if first_path:
                    report["log_file"] = first_path
            except Exception:
                pass
        except Exception:
            pass
    except Exception as exc:
        report["reason"] = f"BBConfig.configure failed: {exc}"
    return report


def _unwrap_with_passphrase(block: dict, passphrase: str) -> dict:
    """Decrypt a fernet_passphrase block (PBKDF2-SHA256 → Fernet).

    Inlined so run.py only needs ``cryptography`` (a transitive dep of every
    bundled plugin), not subjective_control itself.
    """
    import base64

    from cryptography.fernet import Fernet
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    if str(block.get("method") or "") != "fernet_passphrase":
        raise ValueError("Unsupported wrapped-key method.")
    salt = base64.b64decode(str(block.get("salt") or "").encode("ascii"))
    token = str(block.get("encrypted_payload") or "").encode("ascii")
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=480000)
    key = base64.urlsafe_b64encode(kdf.derive(passphrase.encode("utf-8")))
    return json.loads(Fernet(key).decrypt(token).decode("utf-8"))


def materialize_per_sis(passphrase: str, userdata_path: Path) -> dict:
    """Decrypt per.sis.key.wrapped.json with passphrase and write per.sis.key."""
    config_dir = BUNDLE_ROOT / "config"
    wrapped_path = config_dir / "per.sis.key.wrapped.json"
    per_sis_path = config_dir / "per.sis"
    if not wrapped_path.is_file() or not per_sis_path.is_file():
        return {"status": "skipped", "reason": "no bundled connections"}
    try:
        block = json.loads(wrapped_path.read_text(encoding="utf-8"))
        decoded = _unwrap_with_passphrase(block, passphrase)
    except Exception as exc:
        return {"status": "error", "reason": str(exc)}
    fernet_key = decoded["fernet_key"].encode("ascii")
    userdata_path.mkdir(parents=True, exist_ok=True)
    (userdata_path / "per.sis.key").write_bytes(fernet_key)
    # Copy per.sis next to the key so ConnectionPersistor(userdata_path) reads it.
    (userdata_path / "per.sis").write_bytes(per_sis_path.read_bytes())
    return {
        "status": "materialised",
        "per_sis_path": str(userdata_path / "per.sis"),
        "per_sis_key_path": str(userdata_path / "per.sis.key"),
    }


def smoke_test_plugins() -> list:
    results = []
    plugins_dir = BUNDLE_ROOT / "plugins"
    for folder in BUNDLED_PLUGIN_FOLDERS:
        plugin_dir = plugins_dir / folder
        if not plugin_dir.is_dir():
            results.append({"folder": folder, "status": "missing"})
            continue
        candidates = sorted(plugin_dir.glob("*DataSource.py"))
        if not candidates:
            results.append({"folder": folder, "status": "no_datasource_file"})
            continue
        ds_path = candidates[0]
        class_match = re.search(r"class\s+(\w*DataSource\w*)\s*\(", ds_path.read_text(encoding="utf-8", errors="ignore"))
        class_name = class_match.group(1) if class_match else None
        module_name = ds_path.stem
        try:
            __import__(module_name)
            results.append({"folder": folder, "module": module_name, "class": class_name, "status": "imported"})
        except Exception as exc:
            results.append({"folder": folder, "module": module_name, "class": class_name, "status": "import_error", "error": str(exc)})
    return results


def execute_pipeline(timeout: float | None) -> int:
    """Drive the bundled pipeline through ``SubjectivePipelineDataSource``.

    Uses only the abstract package's v2/v3 runner — no subjective_control_lib
    import. Honours an optional timeout by scheduling ``ds.stop()`` from a
    daemon thread, plus a Ctrl+C handler that stops cleanly.
    """
    import signal
    import threading
    import traceback

    pipe_file = BUNDLE_ROOT / "pipelines" / f"{PIPELINE_NAME}.pipe"
    if not pipe_file.is_file():
        print(f"Pipeline file not found: {pipe_file}", file=sys.stderr)
        return 1
    # The v2 runner resolves datasource classes via DATASOURCES_PLUGIN_PATH.
    # Point it at the bundled plugins so we never mix in user-installed
    # versions that might disagree with what was exported.
    os.environ["DATASOURCES_PLUGIN_PATH"] = str(BUNDLE_ROOT / "plugins")
    try:
        from subjective_abstract_data_source_package import SubjectivePipelineDataSource
    except ImportError as exc:
        print(
            "subjective_abstract_data_source_package is not importable in this Python. "
            f"Install runtime/requirements.lock first. ({exc})",
            file=sys.stderr,
        )
        return 1

    ds = SubjectivePipelineDataSource(
        connection={"pipeline_name": PIPELINE_NAME, "pipeline_file": str(pipe_file)}
    )

    stop_timer = None
    if timeout is not None and timeout > 0:
        def _on_timeout():
            print(
                f"\n[run.py] timeout {timeout:g}s reached — stopping pipeline...",
                file=sys.stderr,
            )
            try:
                ds.stop()
            except Exception:
                pass

        stop_timer = threading.Timer(timeout, _on_timeout)
        stop_timer.daemon = True
        stop_timer.start()

    def _handle_sigint(*_):
        print("\n[run.py] Ctrl+C — stopping pipeline...", file=sys.stderr)
        try:
            ds.stop()
        except Exception:
            pass

    signal.signal(signal.SIGINT, _handle_sigint)

    try:
        print(f"=== STARTING pipeline {PIPELINE_NAME!r} ===", flush=True)
        result = ds.fetch()
        print("=== pipeline returned ===")
        try:
            print(json.dumps(result, indent=2, default=str))
        except Exception:
            print(repr(result))
        return 0
    except KeyboardInterrupt:
        return 130
    except Exception:
        traceback.print_exc()
        return 1
    finally:
        if stop_timer is not None:
            stop_timer.cancel()


def main() -> int:
    parser = argparse.ArgumentParser(description=f"Run/check bundle for {PIPELINE_NAME}")
    parser.add_argument("--check", action="store_true", help="Smoke-test imports and exit.")
    parser.add_argument("--print-env", action="store_true", help="Print resolved env paths and exit.")
    parser.add_argument(
        "--exec",
        dest="execute",
        action="store_true",
        help="Actually run the pipeline via SubjectivePipelineDataSource.fetch().",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=None,
        help="Stop the pipeline after this many seconds (only with --exec).",
    )
    parser.add_argument(
        "--connections-passphrase",
        default=os.environ.get("SUBJECTIVE_BUNDLE_PASSPHRASE"),
        help="Passphrase to unwrap bundled per.sis. Defaults to SUBJECTIVE_BUNDLE_PASSPHRASE env.",
    )
    parser.add_argument(
        "--userdata-path",
        default=None,
        help="Override target USERDATA_PATH for materialising per.sis (default: resolved automatically).",
    )
    args = parser.parse_args()

    env = resolve_userdata_paths()
    os.environ.setdefault("USERDATA_PATH", env["userdata_path"])
    os.environ.setdefault("LOG_PATH", env["log_path"])
    os.environ.setdefault("CONTEXT_STORAGE", env["context_storage"])
    # Route the runtime's per-node port folders (input/output/scratch) into
    # the bundle's workspace/ (or the user's home temp dir when present) so
    # outputs survive across runs and don't fill /tmp.
    os.environ.setdefault("DATASOURCES_TEMP_STORAGE", env["datasources_temp_storage"])
    os.environ.setdefault("DS_CONNECTION_TMP_SPACE", env["datasources_temp_storage"])
    added_paths = add_plugin_sys_paths()
    # Configure BBLogger BEFORE pipeline imports so the first runtime log line
    # already lands in the per-run dated file at LOG_PATH instead of stdout.
    bblogger_report = init_bblogger(env)

    if args.print_env:
        print(json.dumps({
            "pipeline_name": PIPELINE_NAME,
            "env": env,
            "added_sys_paths": added_paths,
            "bblogger": bblogger_report,
        }, indent=2))
        return 0

    materialise_report = {"status": "not_requested"}
    if args.connections_passphrase:
        target = Path(args.userdata_path) if args.userdata_path else Path(env["userdata_path"])
        try:
            materialise_report = materialize_per_sis(args.connections_passphrase, target)
        except Exception as exc:
            materialise_report = {"status": "error", "reason": str(exc)}

    report = {
        "pipeline_name": PIPELINE_NAME,
        "env": env,
        "added_sys_paths": added_paths,
        "per_sis": materialise_report,
        "bblogger": bblogger_report,
        "plugins": smoke_test_plugins(),
    }
    print(json.dumps(report, indent=2))
    failures = [p for p in report["plugins"] if p["status"] != "imported"]
    if args.execute:
        if failures:
            print(
                "Refusing to --exec because at least one plugin failed to import; "
                "install runtime/requirements.lock first.",
                file=sys.stderr,
            )
            return 1
        return execute_pipeline(args.timeout)
    if args.check or not (args.execute):
        return 0 if not failures else 1
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
