"""Prompt sanitization: safe_for_prompt, build_prompt, detect_injection, validate_output.

Defends against:
- Control character injection (NUL, BEL, BS, VT, etc.)
- Delimiter escape attacks in user-controlled text
- Prompt override phrases ("ignore previous instructions")
- Overlong inputs that exhaust context windows
"""
from __future__ import annotations

import re

_DEFAULT_MAX_INPUT_CHARS = 100_000
_DEFAULT_MAX_OUTPUT_CHARS = 100_000
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]")

_INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?previous\s+instructions", re.IGNORECASE),
    re.compile(r"disregard\s+(all\s+)?prior\s+instructions", re.IGNORECASE),
    re.compile(r"forget\s+(everything|all)\s+you", re.IGNORECASE),
    re.compile(r"</?(system|context|user|assistant|instruction)>", re.IGNORECASE),
    re.compile(r"\[/?INST\]", re.IGNORECASE),
    re.compile(r"<\|im_(start|end)\|>", re.IGNORECASE),
]

_CONTEXT_OPEN = "<<CONTEXT>>"
_CONTEXT_CLOSE = "<</CONTEXT>>"
_CONTEXT_OPEN_ESCAPED = "<<CONTEXT_ESC>>"
_CONTEXT_CLOSE_ESCAPED = "<</CONTEXT_ESC>>"


class PromptInjectionError(Exception):
    """Raised when injection is detected and the caller wants strict rejection."""


def safe_for_prompt(text: str, max_chars: int = _DEFAULT_MAX_INPUT_CHARS) -> str:
    """Strip control characters and truncate to max_chars."""
    cleaned = _CONTROL_CHAR_RE.sub("", text)
    if len(cleaned) > max_chars:
        cleaned = cleaned[:max_chars]
    return cleaned


def _escape_delimiters(text: str) -> str:
    """Escape our context delimiters inside user-controlled text."""
    text = text.replace(_CONTEXT_OPEN, _CONTEXT_OPEN_ESCAPED)
    text = text.replace(_CONTEXT_CLOSE, _CONTEXT_CLOSE_ESCAPED)
    # Also escape HTML/XML-style tags that match our injection patterns
    text = re.sub(r"</?(system|context|user|assistant|instruction)>",
                  lambda m: m.group(0).replace("<", "‹").replace(">", "›"),
                  text, flags=re.IGNORECASE)
    return text


def build_prompt(system: str, user_text: str,
                 context_parts: list[str]) -> str:
    """Construct a prompt with strict delimiters.

    Context parts are sanitized and wrapped in <<CONTEXT>> delimiters.
    User text is sanitized. System text is trusted (caller-controlled).
    """
    safe_user = safe_for_prompt(user_text)
    safe_contexts = [
        _CONTEXT_OPEN + _escape_delimiters(safe_for_prompt(p)) + _CONTEXT_CLOSE
        for p in context_parts
    ]
    parts = []
    if system:
        parts.append(f"[SYSTEM]\n{system}\n[/SYSTEM]")
    if safe_contexts:
        parts.append("\n".join(safe_contexts))
    parts.append(f"[USER]\n{safe_user}\n[/USER]")
    return "\n\n".join(parts)


def detect_injection(text: str) -> bool:
    """Return True if text looks like a prompt injection attempt."""
    return any(p.search(text) for p in _INJECTION_PATTERNS)


def validate_output(text: str, max_chars: int = _DEFAULT_MAX_OUTPUT_CHARS) -> str:
    """Validate and bound LLM output."""
    if len(text) > max_chars:
        return text[:max_chars]
    return text
