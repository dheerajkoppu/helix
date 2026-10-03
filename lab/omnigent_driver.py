"""Run one Omnigent agent bundle headlessly and keep its session transcripts.

Started by run_lab.py as a subprocess. Does what `omnigent run <bundle> --no-session -p <prompt>` does,
through the same functions of Omnigent 0.16, and before the per-run server stops it exports the
supervisor session and every sub-agent session in the format of `omnigent session export`. When those
functions are not available it falls back to the CLI and keeps only the final reply.
"""

import argparse
import asyncio
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

WAIT_LIMIT_SECONDS = 2400
QUIET_LIMIT_SECONDS = 240
CONVERSATION_ID = re.compile(r'conversation_id\\*"\s*:\s*\\*"([0-9a-zA-Z_-]{8,64})')


def export_session(client: Any, session_id: str, output: Path) -> list[dict[str, Any]]:
    """Write one session as JSON Lines: a session_meta line, then one line per conversation item."""
    response = client.get(
        f"/v1/sessions/{session_id}", params={"include_items": "false", "include_liveness": "false"}
    )
    response.raise_for_status()
    items: list[dict[str, Any]] = []
    with output.open("w", encoding="utf-8") as handle:
        handle.write(json.dumps({"record_type": "session_meta", **response.json()}) + "\n")
        after: str | None = None
        while True:
            parameters: dict[str, Any] = {"limit": 500, "order": "asc"}
            if after:
                parameters["after"] = after
            page = client.get(f"/v1/sessions/{session_id}/items", params=parameters)
            page.raise_for_status()
            body = page.json()
            for item in body["data"]:
                items.append(item)
                handle.write(json.dumps({"record_type": "item", **item}) + "\n")
            if not body.get("has_more"):
                break
            after = body.get("last_id")
    return items


def _lines(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    return rows


def wait_for_loop(client: Any, session_id: str, out: Path) -> str:
    """Keep the per-run server alive until the supervisor has closed the loop.

    Omnigent's headless prompt can return while a sub-agent is still running: it reads the session as
    idle in the moment between a supervisor turn and the next dispatch. The orchestration itself runs
    on the server, so the loop continues as long as the server lives. The research record says when it
    is over: a final report is on record, or nothing has been written or called for a long while.
    """
    limit = time.monotonic() + WAIT_LIMIT_SECONDS
    while time.monotonic() < limit:
        events = _lines(out / "record.jsonl")
        try:
            status = (
                client.get(
                    f"/v1/sessions/{session_id}",
                    params={"include_items": "false", "include_liveness": "false"},
                )
                .json()
                .get("status")
            )
        except Exception:
            status = None
        busy = status in ("running", "launching")
        if any(
            event["type"] == "note" and event["payload"].get("kind") == "final_report" for event in events
        ):
            if not busy:
                return "finished"
        else:
            decided = {event["payload"].get("id") for event in events if event["type"] == "approval_decision"}
            awaiting = any(
                event["type"] == "approval_request" and event["payload"].get("id") not in decided
                for event in events
            )
            stamps = [
                path.stat().st_mtime
                for path in (out / "record.jsonl", out / "policy_log.jsonl")
                if path.exists()
            ]
            quiet = time.time() - max(stamps) if stamps else 0.0
            if quiet > QUIET_LIMIT_SECONDS and not busy and not awaiting:
                return "stalled"
        time.sleep(3)
    return "timeout"


def last_assistant_text(items: list[dict[str, Any]]) -> str | None:
    for item in reversed(items):
        if item.get("type") != "message" or item.get("role") != "assistant":
            continue
        parts = [part.get("text", "") for part in item.get("content") or [] if isinstance(part, dict)]
        text = "".join(parts).strip()
        if text:
            return text
    return None


def run_with_sessions(bundle: Path, prompt: str, out: Path, wait_for_report: bool) -> int:
    import httpx
    from omnigent import chat
    from omnigent_client import OmnigentClient

    path = chat._canonicalize_local_agent_path(bundle)
    spec_path = chat._materialize_override_bundle(
        path, chat.ChatOverrides(harness=None, model=None, system_prompt=None)
    )
    session: dict[str, Any] = {"session_id": None, "sub_agent_sessions": []}

    def remember_session(session_id: str) -> None:
        session["session_id"] = session_id
        (out / "omnigent_session.json").write_text(json.dumps(session, indent=2) + "\n", encoding="utf-8")

    try:
        chat._validate_agent_spec(spec_path)
        agent_name = chat._extract_agent_name(spec_path)
        port = chat._find_free_port()
        server = chat._start_local_server(spec_path, port, ephemeral=True)
        try:
            chat._wait_for_server(port, server)
            base_url = f"http://127.0.0.1:{port}"
            headers = chat._server_headers(runner_id=server.runner_id)

            async def query() -> str | None:
                async with OmnigentClient(
                    base_url=base_url,
                    headers=headers,
                    auth=chat._server_auth(server_url=base_url, session_id=None),
                ) as client:
                    return await chat._query_sessions_once(
                        client=client,
                        agent_name=agent_name,
                        tool_handler=None,
                        prompt=prompt,
                        session_bundle=chat._bundle_agent(spec_path),
                        session_bundle_filename="agent.tar.gz",
                        runner_id=server.runner_id,
                        on_session_ready=remember_session,
                    )

            failure: str | None = None
            reply: str | None = None
            try:
                reply = asyncio.run(query())
            except Exception as error:
                failure = f"{type(error).__name__}: {error}"
            (out / "final_reply.txt").write_text((reply or "") + "\n", encoding="utf-8")
            if session["session_id"]:
                try:
                    with httpx.Client(base_url=base_url, headers=headers, timeout=30.0) as client:
                        if wait_for_report:
                            ending = wait_for_loop(client, session["session_id"], out)
                            session["ended"] = ending
                            if ending == "finished":
                                failure = None
                        items = export_session(client, session["session_id"], out / "transcript.jsonl")
                        persisted = last_assistant_text(items)
                        if persisted:
                            # The persisted reply is what passed the claims guard; streamed text may hold a refused one
                            (out / "final_reply.txt").write_text(persisted + "\n", encoding="utf-8")
                        children = sorted(
                            set(CONVERSATION_ID.findall(json.dumps(items))) - {session["session_id"]}
                        )
                        transcripts = out / "transcripts"
                        for child in children:
                            transcripts.mkdir(exist_ok=True)
                            try:
                                export_session(client, child, transcripts / f"{child}.jsonl")
                                session["sub_agent_sessions"].append(child)
                            except httpx.HTTPError:
                                continue
                    remember_session(session["session_id"])
                except httpx.HTTPError as error:
                    print(f"transcript export failed: {type(error).__name__}", file=sys.stderr)
            if failure:
                print(failure, file=sys.stderr)
                return 1
            return 0
        finally:
            chat._stop_local_server(server)
    finally:
        chat._cleanup_materialized_override_bundle(spec_path)


def run_with_cli(bundle: Path, prompt: str, out: Path) -> int:
    omnigent = Path(sys.executable).with_name("omnigent")
    completed = subprocess.run(
        [str(omnigent), "run", str(bundle), "--no-session", "-p", prompt],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        check=False,
    )
    (out / "final_reply.txt").write_text(completed.stdout, encoding="utf-8")
    if completed.returncode != 0:
        print(completed.stderr[-2000:], file=sys.stderr)
    return completed.returncode


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--prompt-file", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument(
        "--wait-for-report",
        action="store_true",
        help="Keep the server alive until a final report is on record in --out",
    )
    arguments = parser.parse_args()
    prompt = arguments.prompt_file.read_text(encoding="utf-8")
    try:
        code = run_with_sessions(arguments.bundle, prompt, arguments.out, arguments.wait_for_report)
    except (ImportError, AttributeError, TypeError) as error:
        print(
            f"session driver unavailable ({type(error).__name__}: {error}); using the omnigent CLI",
            file=sys.stderr,
        )
        code = run_with_cli(arguments.bundle, prompt, arguments.out)
    raise SystemExit(code)


if __name__ == "__main__":
    main()
