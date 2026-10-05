from __future__ import annotations

from typing import Any

from api.services.coach_rag import _load_coach_config


def _payload_from_moment(moment: dict[str, Any]) -> dict[str, Any]:
    from chess_coach.rag.offline_llm_comments import build_llm_moment_payload

    return build_llm_moment_payload(
        {
            "ply": moment.get("ply"),
            "playedSan": moment.get("playedMove") or moment.get("playedSan"),
            "bestSan": moment.get("bestMove") or moment.get("bestSan"),
            "severity": moment.get("mark") or moment.get("severity"),
            "dropCp": moment.get("dropCp") or 0,
            "structuralKind": moment.get("structuralKind"),
            "tacticalFact": {
                "head": moment.get("tacticalHead"),
                "kind": moment.get("tacticalKind"),
                "selfInflicted": moment.get("selfInflicted"),
                "pieceLabel": moment.get("piece"),
                "trapSquare": moment.get("square"),
            },
            "inputs": {
                "tactical_head": moment.get("tacticalHead"),
                "tactical_kind": moment.get("tacticalKind"),
                "tactical_self_inflicted": moment.get("selfInflicted"),
                "why_better": moment.get("whyBetter"),
                "played_line": moment.get("playedLine"),
                "engine_line": moment.get("engineLine"),
                "played_impact": moment.get("playedImpact"),
                "technical_rule": moment.get("technicalRule"),
                "key_id": moment.get("keyId"),
                "praise_mark": moment.get("praiseMark"),
                "structural_kind": moment.get("structuralKind"),
                "tactical_piece": moment.get("piece"),
                "tactical_square": moment.get("square"),
            },
        }
    )


def generate_game_comments(moments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from chess_coach.rag.offline_llm_comments import generate_coach_comments

    if not moments:
        return []
    config = _load_coach_config()
    payloads = [_payload_from_moment(m) for m in moments]
    texts = generate_coach_comments(payloads, config, use_llm=True)
    out: list[dict[str, Any]] = []
    for moment, payload, text in zip(moments, payloads, texts):
        out.append(
            {
                "ply": moment.get("ply") if moment.get("ply") is not None else payload.get("ply"),
                "text": text,
            }
        )
    return out
