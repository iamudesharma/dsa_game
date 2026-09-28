#!/usr/bin/env python3
"""Smoke test for the Laya sidecar's decision engine.

Runs one `choice` question through the same `Router` API that `laya-serve` uses
in-process, and prints the answer. This is the test the Laya README's quickstart
uses, kept deliberately tiny: the point is to prove that the import works, the
checkpoint downloads, and the answer comes back as one of the keys we offered —
not to measure anything.

    services/laya/.venv/bin/python services/laya/smoke.py

Exit codes: 0 pass, 1 setup problem (actionable message, no traceback),
2 the model ran and the answer was not a key we asked for.

NOTE: the first run downloads the checkpoint (~1.3 GB) into the Hugging Face
cache. Expect a long silent pause. Set HF_HOME to move the cache off a small
system volume.
"""

from __future__ import annotations

import sys

# The question is intentionally a choice with a two-key criteria OBJECT, which is
# the shape the decision layer actually sends. A non-object criteria is a common
# mistake and Laya rejects it, so this doubles as a check of the wire contract.
QUESTIONS = {
    "department": {
        "type": "choice",
        "instructions": "Which team should handle this?",
        "criteria": {
            "arrays": "sorting, scanning, rearranging numbers",
            "structures": "stacks, queues, linked lists, parentheses",
        },
    }
}
STATE = "I need help debugging why my brackets are unbalanced."


def fail(message: str) -> "int":
    print(f"FAIL: {message}", file=sys.stderr)
    return 1


def main() -> int:
    try:
        import laya  # noqa: F401
    except ModuleNotFoundError:
        print(
            "laya is not installed in this interpreter.\n\n"
            "  services/laya/.venv/bin/python services/laya/smoke.py\n\n"
            "is the right way to run this. If you have not set the sidecar up yet:\n\n"
            "  bash scripts/laya.sh setup\n",
            file=sys.stderr,
        )
        return 1
    except ImportError as exc:
        return fail(f"laya is installed but one of its dependencies is not: {exc}")

    print(f"laya {getattr(laya, '__version__', 'unknown')}")

    try:
        from laya import Router
    except ImportError as exc:
        return fail(f"could not import laya.Router: {exc}")

    # Pin the smallest checkpoint, the same one scripts/laya.sh start serves.
    # Without `model=`, Router auto-selects by script/language and will happily
    # build the 421M English checkpoint instead, which does not fit our budget.
    try:
        router = Router(device="mps", model=None)
        result = router.predict(STATE, QUESTIONS, model="multilingual")
    except TypeError:
        # Older signatures may not accept a `device=` kwarg.
        router = Router()
        result = router.predict(STATE, QUESTIONS, model="multilingual")
    except Exception as exc:  # noqa: BLE001 - surface anything as a readable line
        return fail(f"inference failed: {type(exc).__name__}: {exc}")

    answers = result.get("answers", {})
    answer = answers.get("department")
    if not isinstance(answer, dict):
        return fail(f"no answer for 'department' in response: {answers!r}")

    choice = answer.get("choice")
    keys = list(QUESTIONS["department"]["criteria"])
    print(f"state   : {STATE}")
    print(f"answer  : {choice}")
    print(f"keys    : {keys}")
    print(f"prob    : {answer.get('probabilities')}")
    print(f"conf    : confidence={answer.get('confidence')} "
          f"answer_confidence={answer.get('answer_confidence')}")
    print(f"routing : {result.get('routing')}")

    if choice not in keys:
        return fail(f"answer {choice!r} is not one of the offered keys {keys}")

    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
