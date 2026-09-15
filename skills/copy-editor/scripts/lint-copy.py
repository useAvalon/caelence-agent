#!/usr/bin/env python3
"""Copy lint. Mechanical bans only; inventing proof is a human gate.

Usage:
    python3 lint-copy.py path/to/draft.txt
    printf '%s' "$draft" | python3 lint-copy.py -
"""
from __future__ import annotations

import re
import sys

CHECKS: list[tuple[str, re.Pattern[str], str]] = [
    (
        "em/en dash",
        re.compile(r"[—–]"),
        "use a comma, colon, period, or parentheses",
    ),
    (
        "spaced-hyphen dash",
        re.compile(r"\S - \S"),
        "same rhythm as an em dash; rewrite the sentence",
    ),
    (
        "exclamation",
        re.compile(r"!"),
        "no exclamation marks",
    ),
    (
        "aphoristic Not X. A Y.",
        re.compile(
            r"\b(?:it'?s|it is|this is|that'?s|that is)\s+not\s+(?:just\s+)?(?:about\s+)?.{1,40}?\.\s+(?:it'?s|it is|a)\b",
            re.IGNORECASE,
        ),
        "state the positive claim; no Not X. A Y. cadence",
    ),
    (
        "banned marketing word",
        re.compile(
            r"\b(seamless(ly)?|effortless(ly)?|magic|powerful|simply|easily|"
            r"unlock(s|ed|ing)?|supercharg(e|es|ed|ing)|revolutionary|"
            r"game-?changing|streamlin(e|es|ed|ing)|empower(s|ed|ing)?|"
            r"world-class|enterprise-grade|delve|leverag(e|es|ed|ing)|robust|"
            r"holistic|cutting-edge|synergy|showcase)\b",
            re.IGNORECASE,
        ),
        "banned in anti-slop",
    ),
    (
        "unresolved VERIFY",
        re.compile(r"\[VERIFY(:[^\]]*)?\]"),
        "resolve with a supplied fact or delete the claim before ship",
    ),
]


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: lint-copy.py <file|->", file=sys.stderr)
        return 2
    src = sys.argv[1]
    text = sys.stdin.read() if src == "-" else open(src, encoding="utf-8").read()
    hits: list[tuple[int, str, str, str]] = []
    for i, line in enumerate(text.splitlines(), 1):
        for label, pat, hint in CHECKS:
            for m in pat.finditer(line):
                hits.append((i, label, m.group(0).strip(), hint))
    if not hits:
        print("LINT CLEAN: 0 violations.")
        return 0
    print(f"LINT FAILED: {len(hits)} violation(s).\n")
    for ln, label, frag, hint in hits:
        print(f"  L{ln}  [{label}] {frag!r}  -> {hint}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
