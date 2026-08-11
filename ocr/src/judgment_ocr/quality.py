"""Text quality signals shared by embedded and fresh OCR candidates."""

from __future__ import annotations

import re

from wordfreq import zipf_frequency

WORD_PATTERN = re.compile(r"[A-Za-z]{3,}")
NONSPACE_PATTERN = re.compile(r"\S+")
SUSPICIOUS_TOKEN_PATTERN = re.compile(
    r"[A-Za-z][0-9!|;{}~][A-Za-z]|[A-Za-z][.!?,;:][A-Za-z]"
)
EXPECTED_PUNCTUATION = set(" .,;:!?'-()[]/\"%&§₹–—")


def _ratio(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def text_metrics(text: str) -> dict[str, int | float]:
    words = WORD_PATTERN.findall(text)
    tokens = NONSPACE_PATTERN.findall(text)
    nonspace = [character for character in text if not character.isspace()]

    common_words = sum(zipf_frequency(word.lower(), "en") >= 2.5 for word in words)
    suspicious_tokens = sum(
        bool(SUSPICIOUS_TOKEN_PATTERN.search(token)) for token in tokens
    )
    unexpected_characters = sum(
        not character.isalnum() and character not in EXPECTED_PUNCTUATION
        for character in nonspace
    )
    alpha_characters = sum(character.isalpha() for character in nonspace)

    metrics: dict[str, int | float] = {
        "text_chars": len(text),
        "word_count": len(words),
        "common_word_count": common_words,
        "token_count": len(tokens),
        "suspicious_token_count": suspicious_tokens,
        "nonspace_chars": len(nonspace),
        "alpha_chars": alpha_characters,
        "unexpected_chars": unexpected_characters,
    }
    common_word_rate = _ratio(common_words, len(words))
    alpha_char_rate = _ratio(alpha_characters, len(nonspace))
    suspicious_token_rate = _ratio(suspicious_tokens, len(tokens))
    unexpected_char_rate = _ratio(unexpected_characters, len(nonspace))

    score = (
        0.65 * common_word_rate
        + 0.35 * min(alpha_char_rate / 0.95, 1.0)
        - min(suspicious_token_rate * 2.0, 0.1)
        - min(unexpected_char_rate * 5.0, 0.1)
    )
    metrics["quality_score"] = round(max(0.0, min(score, 1.0)), 6)
    return metrics
