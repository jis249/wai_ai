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
