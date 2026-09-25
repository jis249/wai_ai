"""Unit tests for hybrid auto-router heuristics."""

from __future__ import annotations

from wai.proxy.auto_router import (
    COMPLEX_MODE_FIXED,
    annotate_candidate,
    extract_prompt_signals,
    fallback_pick,
    heuristic_route,
)


DEFAULT = "qwen3-coder:30b-gpu"


def _pool():
    return [
        annotate_candidate(DEFAULT, provider="ollama"),
        annotate_candidate("gpt-4o-azure", provider="azure", input_price=2.5, output_price=10),
        annotate_candidate("llama-local", provider="ollama", type="chat"),
    ]


def test_coding_prefers_default():
    signals = extract_prompt_signals(
        {
            "messages": [
                {
                    "role": "user",
                    "content": "Fix this Python function:\n```python\ndef foo(x):\n    return x+1\n```",
                }
            ]
        }
    )
    decision = heuristic_route(signals, _pool(), default_model=DEFAULT)
    assert decision is not None
    assert decision.model_name == DEFAULT


def test_complex_prefers_stronger_not_default():
    signals = extract_prompt_signals(
        {
            "messages": [
                {
                    "role": "user",
                    "content": "Please architect a production-ready multi-step system and compare approaches for scaling.",
                }
            ]
        }
    )
    decision = heuristic_route(
        signals,
        _pool(),
        default_model=DEFAULT,
        complex_mode=COMPLEX_MODE_FIXED,
        complex_model="gpt-4o-azure",
    )
    assert decision is not None
    assert decision.model_name == "gpt-4o-azure"
    assert "complex" in decision.detail


def test_vision_prefers_vision_name():
    signals = extract_prompt_signals(
        {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "What is in this image?"},
                        {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
                    ],
                }
            ]
        }
    )
    assert signals.has_images
    decision = heuristic_route(signals, _pool(), default_model=DEFAULT)
    assert decision is not None
    assert decision.model_name == "gpt-4o-azure"


def test_unclear_non_complex_uses_default():
    text = (
        "I'm thinking about our team meeting schedule and whether we should "
        "move the weekly sync to another time that works better for everyone."
    )
    signals = extract_prompt_signals({"messages": [{"role": "user", "content": text}]})
    decision = heuristic_route(signals, _pool(), default_model=DEFAULT)
    assert decision is not None
    assert decision.model_name == DEFAULT
    assert decision.detail in {"default model", "simple prompt"}


def test_simple_question_with_long_history_uses_default():
    history = [
        {"role": "user", "content": "x" * 4000},
        {"role": "assistant", "content": "y" * 4000},
        {"role": "user", "content": "What is 2+2?"},
    ]
    signals = extract_prompt_signals({"messages": history})
    decision = heuristic_route(signals, _pool(), default_model=DEFAULT)
    assert decision is not None
    assert decision.model_name == DEFAULT
    assert signals.is_complex is False


def test_compare_approaches_in_casual_question_is_not_complex():
    signals = extract_prompt_signals(
        {"messages": [{"role": "user", "content": "Can you compare approaches for making tea?"}]}
    )
    decision = heuristic_route(signals, _pool(), default_model=DEFAULT)
    assert signals.is_complex is False
    assert decision is not None
    assert decision.model_name == DEFAULT


def test_fallback_uses_default():
    decision = fallback_pick(_pool(), DEFAULT, "fallback")
    assert decision.model_name == DEFAULT


# --- coding-first routing, context fit, session stickiness --------------------------------

import asyncio  # noqa: E402

from wai.proxy.auto_router import (  # noqa: E402
    REASON_SESSION,
    AutoRouter,
    AutoRouterConfig,
)

COMPLEX = "gpt-4o-azure"


def _router() -> AutoRouter:
    return AutoRouter(
        AutoRouterConfig(default_model=DEFAULT, complex_mode=COMPLEX_MODE_FIXED, complex_model=COMPLEX)
    )


class _NoClassifier:
    """Any classifier HTTP call fails the test: coding prompts must not pay that round-trip."""

    async def post(self, *a, **k):
        raise AssertionError("classifier should not be called")


def _route(router, messages, *, scope="k1", classifier=object(), pool=None, **extra):
    return asyncio.run(
        router.route(
            {"messages": messages, **extra},
            pool or _pool(),
            classifier_model=classifier,
            client=_NoClassifier(),
            build_headers=lambda *a: {},
            scope=scope,
        )
    )


def test_short_coding_prompt_without_code_fence_skips_classifier():
    for text in ("fix the login bug in auth.py", "why does this endpoint return 500", "add unit tests for the api"):
        signals = extract_prompt_signals({"messages": [{"role": "user", "content": text}]})
        assert signals.is_code_heavy, text
        assert signals.confidence >= 0.7, text
    d = _route(_router(), [{"role": "user", "content": "fix the login bug in auth.py"}])
    assert d.model_name == DEFAULT


def test_medium_prose_skips_classifier():
    text = "Summarise the main points of our discussion about onboarding new hires. " * 6
    d = _route(_router(), [{"role": "user", "content": text}])
    assert d.model_name == DEFAULT


def test_context_fit_skips_models_too_small():
    pool = [
        annotate_candidate(DEFAULT, provider="ollama", max_context_tokens=8_000),
        annotate_candidate(COMPLEX, provider="azure", max_context_tokens=400_000),
    ]
    big = [{"role": "user", "content": "x" * 60_000}, {"role": "user", "content": "fix the bug in main.py"}]
    d = _route(_router(), big, pool=pool)
    assert d.model_name == COMPLEX


def test_session_sticks_after_complex_turn():
    r = _router()
    first = [{"role": "system", "content": "You are a coding agent."},
             {"role": "user", "content": "Design a production-ready architecture for our billing service."}]
    assert _route(r, first).model_name == COMPLEX
    later = first + [{"role": "assistant", "content": "..."}, {"role": "user", "content": "ok now add tests"}]
    d = _route(r, later)
    assert d.model_name == COMPLEX
    assert d.reason == REASON_SESSION


def test_session_upgrades_but_never_downgrades():
    r = _router()
    first = [{"role": "user", "content": "fix the bug in utils.py"}]
    assert _route(r, first).model_name == DEFAULT
    turn2 = first + [{"role": "assistant", "content": "..."},
                     {"role": "user", "content": "Now do a root cause analysis of the deadlock."}]
    assert _route(r, turn2).model_name == COMPLEX
    turn3 = turn2 + [{"role": "assistant", "content": "..."}, {"role": "user", "content": "thanks"}]
    assert _route(r, turn3).model_name == COMPLEX


def test_sessions_are_scoped_per_key():
    r = _router()
    first = [{"role": "user", "content": "Design a production-ready architecture for billing."}]
    assert _route(r, first, scope="a").model_name == COMPLEX
    follow = first + [{"role": "assistant", "content": "..."}, {"role": "user", "content": "hi"}]
    assert _route(r, follow, scope="a").reason == REASON_SESSION
    assert _route(r, follow, scope="b").reason != REASON_SESSION
