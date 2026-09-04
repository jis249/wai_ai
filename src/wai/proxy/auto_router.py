"""Hybrid auto model router — heuristics first, classifier when unclear.

Clients request ``model: "auto"``. The router picks from the caller's accessible
models (same access rules as explicit model names).
"""

from __future__ import annotations

import json
import logging
import random
import re
from dataclasses import dataclass
from typing import Any

import httpx

from wai.proxy.providers import get_adapter
from wai.proxy.registry import Model

AUTO_MODEL_NAME = "auto"

HEADER_ROUTED_MODEL = "X-WAI-Routed-Model"
HEADER_ROUTING_REASON = "X-WAI-Routing-Reason"
HEADER_ROUTING_DETAIL = "X-WAI-Routing-Detail"
HEADER_REQUESTED_MODEL = "X-WAI-Requested-Model"

REASON_HEURISTIC = "heuristic"
REASON_CLASSIFIER = "classifier"
REASON_DEFAULT = "default"

COMPLEX_MODE_RANDOM = "random"
COMPLEX_MODE_FIXED = "fixed"
VALID_COMPLEX_MODES = frozenset({COMPLEX_MODE_RANDOM, COMPLEX_MODE_FIXED})

_CODE_FENCE_RE = re.compile(r"```")
_CODE_HINT_RE = re.compile(
    r"\b(def |class |import |function |const |let |var |#include|SELECT |FROM |"
    r"async |await |fn |pub |package |docker|kubernetes|regex|stack.?trace|"
    r"compile|typescript|python|golang|rust|sql)\b",
    re.IGNORECASE,
)
_COMPLEX_RE = re.compile(
    r"\b(architect(?:ure)?|design a system|system design|trade.?offs?|reason step.?by.?step|"
    r"prove that|derive the|multi.?step (?:plan|design|migration)|refactor the entire|"
    r"migrate (?:the |this )?(?:system|service|database|app)|production.?ready|"
    r"security audit|root cause analysis)\b",
    re.IGNORECASE,
)
_SIMPLE_RE = re.compile(
    r"^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|ping|test)[\s!.?]*$",
    re.IGNORECASE,
)

_VISION_NAME_RE = re.compile(
    r"(vision|gpt-4o|gpt-4\.1|gpt-4-turbo|gemini|claude-3|llava|moondream|qwen.?vl)",
    re.IGNORECASE,
)
_STRONG_NAME_RE = re.compile(
    r"(gpt-4|o1|o3|claude|opus|sonnet|70b|72b|405b|r1|deepseek-r1|large)",
    re.IGNORECASE,
)
_CODER_NAME_RE = re.compile(
    r"(coder|code|codellama|deepseek-coder|starcoder|qwen3-coder)",
    re.IGNORECASE,
)
_SMALL_NAME_RE = re.compile(
    r"(mini|nano|tiny|7b|8b|3b|1b|haiku|flash|small)",
    re.IGNORECASE,
)


@dataclass
class AutoRouterConfig:
    enabled: bool = True
    default_model: str = "qwen3-coder:30b-gpu"
    classifier_model: str = "qwen3-coder:30b-gpu"
    classifier_timeout_seconds: float = 8.0
    # How to pick when the prompt looks complex.
    # random = random accessible model; fixed = complex_model (fallback to random).
    complex_mode: str = COMPLEX_MODE_RANDOM
    complex_model: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "default_model": self.default_model,
            "classifier_model": self.classifier_model,
            "classifier_timeout_seconds": self.classifier_timeout_seconds,
            "complex_mode": self.complex_mode,
            "complex_model": self.complex_model,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None, *, base: "AutoRouterConfig | None" = None) -> "AutoRouterConfig":
        cfg = cls() if base is None else cls(**base.to_dict())
        if not data:
            return cfg
        if "enabled" in data and data["enabled"] is not None:
            cfg.enabled = bool(data["enabled"])
        if data.get("default_model"):
            cfg.default_model = str(data["default_model"])
        if data.get("classifier_model"):
            cfg.classifier_model = str(data["classifier_model"])
        elif data.get("default_model"):
            cfg.classifier_model = str(data["default_model"])
        if data.get("classifier_timeout_seconds") is not None:
            try:
                cfg.classifier_timeout_seconds = float(data["classifier_timeout_seconds"])
            except (TypeError, ValueError):
                pass
        mode = str(data.get("complex_mode") or cfg.complex_mode).lower().strip()
        cfg.complex_mode = mode if mode in VALID_COMPLEX_MODES else COMPLEX_MODE_RANDOM
        cfg.complex_model = str(data.get("complex_model") or "")
        return cfg


@dataclass
class PromptSignals:
    text: str = ""
    last_user_text: str = ""
    estimated_tokens: int = 0
    last_user_tokens: int = 0
    has_images: bool = False
    is_code_heavy: bool = False
    is_complex: bool = False
    is_simple: bool = False
    confidence: float = 0.0


@dataclass
class RoutingDecision:
    model_name: str
    reason: str
    detail: str = ""

    def as_headers(self, requested: str = AUTO_MODEL_NAME) -> dict[str, str]:
        def _latin1(value: str) -> str:
            # HTTP headers must be latin-1; strip anything else.
            return (value or "")[:200].encode("latin-1", errors="replace").decode("latin-1")

        return {
            HEADER_REQUESTED_MODEL: _latin1(requested),
            HEADER_ROUTED_MODEL: _latin1(self.model_name),
            HEADER_ROUTING_REASON: _latin1(self.reason),
            HEADER_ROUTING_DETAIL: _latin1(self.detail or ""),
        }


@dataclass
class Candidate:
    name: str
    type: str = "chat"
    provider: str = ""
    max_context_tokens: int = 0
    input_price: float = 0.0
    output_price: float = 0.0
    vision: bool = False
    coder: bool = False
    strong: bool = False
    small: bool = False


def annotate_candidate(
    name: str,
    *,
    type: str = "chat",
    provider: str = "",
    max_context_tokens: int = 0,
    input_price: float = 0.0,
    output_price: float = 0.0,
) -> Candidate:
    return Candidate(
        name=name,
        type=type or "chat",
        provider=provider,
        max_context_tokens=max_context_tokens,
        input_price=input_price,
        output_price=output_price,
        vision=bool(_VISION_NAME_RE.search(name)),
        coder=bool(_CODER_NAME_RE.search(name)),
        strong=bool(_STRONG_NAME_RE.search(name)),
        small=bool(_SMALL_NAME_RE.search(name)),
    )


def candidates_from_models(
    models: list[Model],
    *,
    model_type: str | None = None,
) -> list[Candidate]:
    out: list[Candidate] = []
    for m in models:
        if m.name == AUTO_MODEL_NAME:
            continue
        mtype = m.type or "chat"
        if model_type:
            if model_type == "chat" and mtype not in ("chat", "completion"):
                continue
            if model_type == "embedding" and mtype != "embedding":
                continue
            if model_type not in ("chat", "embedding") and mtype != model_type:
                continue
        out.append(
            annotate_candidate(
                m.name,
                type=mtype,
                provider=m.provider,
                max_context_tokens=m.max_context_tokens,
                input_price=m.pricing.input_per_1m,
                output_price=m.pricing.output_per_1m,
            )
        )
    return out


def _content_to_text(content: Any) -> tuple[str, bool]:
    """Return text and whether the content block includes images."""
    has_images = False
    if isinstance(content, str):
        return content, has_images
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            btype = str(block.get("type", ""))
            if btype in ("image_url", "image") or "image" in btype:
                has_images = True
            text = block.get("text")
            if isinstance(text, str):
                parts.append(text)
        return "\n".join(parts), has_images
    return "", has_images


def _last_user_text(envelope: dict[str, Any]) -> tuple[str, bool]:
    messages = envelope.get("messages")
    if isinstance(messages, list):
        for msg in reversed(messages):
            if not isinstance(msg, dict) or msg.get("role") != "user":
                continue
            return _content_to_text(msg.get("content"))
    prompt = envelope.get("prompt")
    if isinstance(prompt, str):
        return prompt, False
    input_text = envelope.get("input")
    if isinstance(input_text, str):
        return input_text, False
    return "", False


def extract_prompt_signals(envelope: dict[str, Any]) -> PromptSignals:
    parts: list[str] = []
    has_images = False

    messages = envelope.get("messages")
    if isinstance(messages, list):
        for msg in messages:
            if not isinstance(msg, dict):
                continue
            text, msg_images = _content_to_text(msg.get("content"))
            if msg_images:
                has_images = True
            if text:
                parts.append(text)

    prompt = envelope.get("prompt")
    if isinstance(prompt, str):
        parts.append(prompt)

    input_text = envelope.get("input")
    if isinstance(input_text, str):
        parts.append(input_text)

    text = "\n".join(parts).strip()
    last_user_text, last_user_images = _last_user_text(envelope)
    if last_user_images:
        has_images = True
    last_user_text = last_user_text.strip()

    est = max(1, len(text) // 4) if text else 0
    last_est = max(1, len(last_user_text) // 4) if last_user_text else 0

    signal_text = last_user_text or text
    signal_est = last_est if last_user_text else est

    fence_count = len(_CODE_FENCE_RE.findall(signal_text))
    is_code = fence_count >= 1 or bool(_CODE_HINT_RE.search(signal_text))
    is_complex = (
        signal_est > 900
        or bool(_COMPLEX_RE.search(signal_text))
        or (is_code and signal_est > 700)
    )
    is_simple = (
        signal_est > 0
        and signal_est < 40
        and bool(_SIMPLE_RE.match(signal_text.strip()))
    ) or (
        signal_est > 0
        and signal_est < 80
        and not is_code
        and not has_images
        and not is_complex
    )

    confidence = 0.35
    if has_images:
        confidence = 0.95
    elif is_complex:
        confidence = 0.85
    elif is_code and signal_est > 80:
        confidence = 0.8
    elif is_simple:
        confidence = 0.75
    elif is_code:
        confidence = 0.65
    elif signal_est > 800:
        confidence = 0.55

    return PromptSignals(
        text=text,
        last_user_text=last_user_text,
        estimated_tokens=est,
        last_user_tokens=last_est,
        has_images=has_images,
        is_code_heavy=is_code,
        is_complex=is_complex,
        is_simple=is_simple,
        confidence=confidence,
    )


def _pick_by_name(candidates: list[Candidate], preferred: str) -> Candidate | None:
    for c in candidates:
        if c.name == preferred:
            return c
    return None


def _strength_score(c: Candidate) -> float:
    score = 0.0
    if c.strong:
        score += 5.0
    if c.coder:
        score += 1.0
    if c.small:
        score -= 2.0
    score += min(c.max_context_tokens / 32_000.0, 3.0)
    score += min((c.input_price + c.output_price) / 20.0, 3.0)
    return score


def _cheap_score(c: Candidate) -> float:
    score = 0.0
    if c.provider in ("ollama", "vllm"):
        score += 3.0
    if c.small:
        score += 2.0
    if c.strong:
        score -= 2.0
    price = c.input_price + c.output_price
    if price <= 0:
        score += 2.0
    else:
        score -= min(price / 10.0, 4.0)
    return score


def _pick_complex(
    candidates: list[Candidate],
    *,
    default_model: str,
    complex_mode: str,
    complex_model: str,
) -> RoutingDecision:
    if complex_mode == COMPLEX_MODE_FIXED and complex_model:
        fixed = _pick_by_name(candidates, complex_model)
        if fixed:
            return RoutingDecision(fixed.name, REASON_HEURISTIC, "complex -> fixed model")

    # Random among accessible models (prefer non-default when alternatives exist).
    others = [c for c in candidates if c.name != default_model]
    pool = others or candidates
    pick = random.choice(pool)
    detail = "complex -> random"
    if complex_mode == COMPLEX_MODE_FIXED and complex_model:
        detail = "complex -> random (fixed model unavailable)"
    return RoutingDecision(pick.name, REASON_HEURISTIC, detail)


def heuristic_route(
    signals: PromptSignals,
    candidates: list[Candidate],
    *,
    default_model: str,
    complex_mode: str = COMPLEX_MODE_RANDOM,
    complex_model: str = "",
) -> RoutingDecision | None:
    """Return a routing decision from heuristics, or None if no candidates."""
    if not candidates:
        return None

    if signals.has_images:
        vision = [c for c in candidates if c.vision]
        pool = vision or candidates
        pick = max(pool, key=_strength_score)
        return RoutingDecision(pick.name, REASON_HEURISTIC, "vision input")

    if signals.is_complex:
        return _pick_complex(
            candidates,
            default_model=default_model,
            complex_mode=complex_mode,
            complex_model=complex_model,
        )

    # Coding is a strong signal even on shorter prompts — prefer default coder.
    if signals.is_code_heavy:
        preferred = _pick_by_name(candidates, default_model)
        if preferred:
            return RoutingDecision(preferred.name, REASON_HEURISTIC, "coding task -> default")
        coders = [c for c in candidates if c.coder]
        pick = max(coders or candidates, key=_strength_score)
        return RoutingDecision(pick.name, REASON_HEURISTIC, "coding task")

    # Non-complex prompts always use the default model (never the complex model).
    preferred = _pick_by_name(candidates, default_model)
    if preferred:
        detail = "simple prompt" if signals.is_simple else "default model"
        return RoutingDecision(preferred.name, REASON_HEURISTIC, detail)

    pick = max(candidates, key=_cheap_score)
    return RoutingDecision(pick.name, REASON_HEURISTIC, "default model")


def fallback_pick(
    candidates: list[Candidate],
    default_model: str,
    detail: str,
) -> RoutingDecision:
    preferred = _pick_by_name(candidates, default_model)
    if preferred:
        return RoutingDecision(preferred.name, REASON_DEFAULT, detail)
    pick = max(candidates, key=_cheap_score)
    return RoutingDecision(pick.name, REASON_DEFAULT, detail)


class AutoRouter:
    def __init__(
        self,
        config: AutoRouterConfig | None = None,
        *,
        log: logging.Logger | None = None,
    ) -> None:
        self.config = config or AutoRouterConfig()
        self.log = log or logging.getLogger("wai.auto_router")

    async def route(
        self,
        envelope: dict[str, Any],
        candidates: list[Candidate],
        *,
        classifier_model: Model | None,
        client: httpx.AsyncClient,
        build_headers: Any,
    ) -> RoutingDecision:
        if not candidates:
            raise ValueError("no accessible models available for auto routing")

        signals = extract_prompt_signals(envelope)
        decision = heuristic_route(
            signals,
            candidates,
            default_model=self.config.default_model,
            complex_mode=self.config.complex_mode,
            complex_model=self.config.complex_model,
        )
        if decision is not None:
            self.log.info(
                "auto route heuristic model=%s detail=%s tokens~%d",
                decision.model_name,
                decision.detail,
                signals.estimated_tokens,
            )
            return decision

        if classifier_model is not None and signals.is_complex:
            classified = await self._classify(
                signals,
                candidates,
                classifier_model=classifier_model,
                client=client,
                build_headers=build_headers,
            )
            if classified:
                self.log.info("auto route classifier model=%s", classified.model_name)
                return classified

        return fallback_pick(
            candidates,
            self.config.default_model,
            "heuristic unclear; classifier unavailable",
        )

    async def _classify(
        self,
        signals: PromptSignals,
        candidates: list[Candidate],
        *,
        classifier_model: Model,
        client: httpx.AsyncClient,
        build_headers: Any,
    ) -> RoutingDecision | None:
        names = [c.name for c in candidates]
        summary = (signals.last_user_text or signals.text)[:1500]
        system = (
            "You are a model router for complex requests only. Choose the single best model "
            "from the candidate list for hard reasoning, architecture, long-context design, "
            "or vision tasks. Prefer the configured complex/default coding model for normal "
            "coding unless the task clearly needs a stronger model. "
            "Reply with ONLY the exact model name, nothing else."
        )
        user = (
            f"Default model: {self.config.default_model}\n"
            f"Candidates:\n- "
            + "\n- ".join(names)
            + "\n\n"
            f"Has images: {signals.has_images}\n"
            f"Estimated tokens: {signals.estimated_tokens}\n"
            f"Code-heavy: {signals.is_code_heavy}\n"
            f"Complex signals: {signals.is_complex}\n\n"
            f"User request:\n{summary}"
        )
        body_doc = {
            "model": classifier_model.name,
            "temperature": 0,
            "max_tokens": 64,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        body = json.dumps(body_doc).encode()
        adapter = get_adapter(classifier_model.provider)
        if adapter is not None:
            body = adapter.transform_request(body, classifier_model)
            url = adapter.transform_url(
                classifier_model.base_url, "chat/completions", classifier_model
            )
        else:
            url = classifier_model.base_url.rstrip("/") + "/chat/completions"

        headers = build_headers(classifier_model, adapter)
        timeout = httpx.Timeout(self.config.classifier_timeout_seconds, connect=5.0)
        try:
            resp = await client.post(url, content=body, headers=headers, timeout=timeout)
            if resp.status_code >= 400:
                self.log.warning(
                    "classifier upstream %s: %s", resp.status_code, resp.text[:200]
                )
                return None
            data = resp.json()
            content = (
                data.get("choices", [{}])[0].get("message", {}).get("content", "")
            )
            if not isinstance(content, str):
                return None
            chosen = content.strip().strip("`\"' \n")
            if "\n" in chosen:
                chosen = chosen.splitlines()[0].strip()
            for prefix in ("model:", "use ", "choose "):
                if chosen.lower().startswith(prefix):
                    chosen = chosen[len(prefix) :].strip()
            name_set = {c.name for c in candidates}
            if chosen not in name_set:
                match = next((n for n in names if n in chosen), None)
                if not match:
                    self.log.warning("classifier returned unknown model %r", chosen)
                    return None
                chosen = match
            return RoutingDecision(chosen, REASON_CLASSIFIER, "classifier pick")
        except Exception as exc:
            self.log.warning("classifier failed: %s", exc)
            return None
