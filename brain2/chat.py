"""Chat tool-use loop + token streaming (Web Console Phase F).

The generator yields a sequence of `(event_type, payload)` tuples. Events:
- ("token", {"text": "..."}) — incremental assistant text
- ("tool_call_start", {"name": ..., "args": ...})
- ("tool_call_result", {"name": ..., "result": ...})
- ("done", {"tokens_in": int, "tokens_out": int, "latency_ms": int,
            "assistant_message_id": str})
- ("error", {"message": "..."})

v1 streaming is "synthetic": the gateway's complete() is non-streaming, so we
take the final text and chunk it. The same generator shape will work when a
real streaming provider lands behind the same gateway interface.

Tool calls use a deliberately tiny convention: assistants emit lines of the form
"TOOL_CALL: <op_name> <json_args>" anywhere in their response. The loop parses
them, dispatches each via the OperationRegistry under the user's scope (so
authorize() runs), feeds the JSON result back in a follow-up turn, and continues
until no more tool calls are produced (or a turn limit is reached).
"""
from __future__ import annotations

import json
import re
import time

from brain2.chat_providers import build_provider, complete_once
from brain2.context import RequestContext
from brain2.operations import dispatch

_TOOL_LINE_RE = re.compile(r"^TOOL_CALL:\s+(\S+)\s+(\{.*\})\s*$", re.MULTILINE)
_MAX_TURNS = 4
_CHUNK_SIZE = 24


def _chunk(text: str, size: int = _CHUNK_SIZE):
    for i in range(0, len(text), size):
        yield text[i:i + size]


def _build_prompt(history: list[dict], system_prompt: str,
                  tools: list[str]) -> tuple[str, str]:
    tools_block = ""
    if tools:
        tools_block = ("\n\nYou may call tools by emitting a line of the form:\n"
                       "  TOOL_CALL: <name> {\"arg\": \"value\"}\n"
                       f"Available tools: {', '.join(tools)}\n"
                       "After emitting tool calls, stop — the system will reply with results.\n")
    transcript = []
    for m in history:
        role = m["role"].upper()
        transcript.append(f"{role}: {m['content']}")
    system = (system_prompt or "You are a helpful assistant.") + tools_block
    return system, "\n".join(transcript)


def _allowed_tools(store, ctx: RequestContext, operations, agent_allowlist: list[str]) -> list[str]:
    """Return ops the agent may call: agent_allowlist ∩ (ops the user may invoke)."""
    from brain2.auth.authorize import authorize
    from brain2.errors import PermissionDenied
    out = []
    for name in operations.names():
        if agent_allowlist and name not in agent_allowlist:
            continue
        op = operations.get(name)
        try:
            authorize(store, ctx, op.action, ctx.project_id)
            out.append(name)
        except PermissionDenied:
            continue
        except Exception:
            # project-only ops without a project_id raise; filter them out
            continue
    return out


def run_turn(store, operations, secrets, ctx: RequestContext,
             conversation_id: str, agent_row, user_text: str,
             stop_check=lambda: False):
    """Yield (event_type, payload) tuples for one user turn.

    The generator persists assistant + tool messages as it produces them so a
    truncated SSE stream still leaves a coherent transcript.
    """
    from brain2.chat_ops import (insert_user_message, insert_assistant_message,
                                  insert_tool_message)
    insert_user_message(store, conversation_id=conversation_id, content=user_text)

    try:
        provider = build_provider(ctx.tenant_id, agent_row, secrets)
    except Exception as exc:
        yield ("error", {"message": str(exc)})
        return

    allowlist = []
    try:
        allowlist = json.loads(agent_row["tool_allowlist"] or "[]")
    except Exception:
        allowlist = []
    tools = _allowed_tools(store, ctx, operations, allowlist)

    history = [{"role": "user", "content": user_text}]
    total_in = total_out = 0
    started = time.monotonic()
    final_assistant_text = ""
    final_msg_id = None

    for turn in range(_MAX_TURNS):
        if stop_check():
            yield ("error", {"message": "stopped"})
            break
        system, transcript = _build_prompt(history, agent_row["system_prompt"], tools)
        try:
            resp = complete_once(provider, transcript, system=system)
        except Exception as exc:
            yield ("error", {"message": f"provider failed: {exc}"})
            return

        total_in += resp.input_tokens
        total_out += resp.output_tokens
        text = resp.text

        # Stream the text token-by-token to the client.
        for ch in _chunk(text):
            if stop_check():
                break
            yield ("token", {"text": ch})

        tool_calls = list(_TOOL_LINE_RE.finditer(text))
        if not tool_calls:
            # Final assistant message — persist and finish.
            final_assistant_text = text
            final_msg_id = insert_assistant_message(
                store, conversation_id=conversation_id, content=text,
                tokens_in=resp.input_tokens, tokens_out=resp.output_tokens)
            break

        # Persist this assistant turn (it contained tool calls).
        parsed_calls = []
        for m in tool_calls:
            try:
                args = json.loads(m.group(2))
            except Exception:
                args = {}
            parsed_calls.append({"name": m.group(1), "args": args})

        insert_assistant_message(
            store, conversation_id=conversation_id, content=text,
            tool_calls=parsed_calls,
            tokens_in=resp.input_tokens, tokens_out=resp.output_tokens)
        history.append({"role": "assistant", "content": text})

        # Execute each tool call.
        for call in parsed_calls:
            name = call["name"]
            args = call["args"]
            yield ("tool_call_start", {"name": name, "args": args})
            if name not in tools:
                result = {"error": f"tool '{name}' not permitted"}
            else:
                try:
                    result = dispatch(store, operations, ctx, name, args)
                except Exception as exc:
                    result = {"error": str(exc)}
            yield ("tool_call_result", {"name": name, "result": result})
            tool_text = json.dumps(result)[:4000]
            insert_tool_message(store, conversation_id=conversation_id,
                                tool_call_id=str(turn), tool_name=name,
                                content=tool_text)
            history.append({"role": "tool", "content": f"{name} -> {tool_text}"})
    else:
        # Hit the turn limit without a final assistant message — emit what we have.
        if not final_msg_id:
            final_assistant_text = "(turn limit reached)"
            final_msg_id = insert_assistant_message(
                store, conversation_id=conversation_id, content=final_assistant_text,
                tokens_in=0, tokens_out=0)

    latency_ms = int((time.monotonic() - started) * 1000)
    yield ("done", {"tokens_in": total_in, "tokens_out": total_out,
                     "latency_ms": latency_ms,
                     "assistant_message_id": final_msg_id,
                     "text": final_assistant_text})
