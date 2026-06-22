"""Word-level content coverage diagnostics for generated HTML."""
from __future__ import annotations

import html
import re
from collections import Counter
from typing import Any


_DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
_TAG_RE = re.compile(r"(?is)<style.*?</style>|<script.*?</script>|<[^>]+>")
_WORD_RE = re.compile(r"[A-Za-z0-9\u0900-\u097F]+")
_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
    "in", "is", "it", "of", "on", "or", "that", "the", "this", "to",
    "with", "html", "body", "class", "style", "div", "span", "section",
    "content", "card", "question", "answer",
}


def _plain_text(value: str, *, strip_html: bool) -> str:
    if strip_html:
        value = _TAG_RE.sub(" ", value)
    return html.unescape(value).translate(_DEVANAGARI_DIGITS).lower()


def _words(value: str, *, strip_html: bool) -> list[str]:
    text = _plain_text(value, strip_html=strip_html)
    return [
        word
        for word in _WORD_RE.findall(text)
        if len(word) >= 2 and word not in _STOPWORDS
    ]


def _line_sections(value: str) -> list[dict[str, Any]]:
    sections = []
    for index, raw in enumerate((value or "").splitlines(), start=1):
        text = raw.strip()
        words = _words(text, strip_html=False)
        numbered = bool(re.match(r"^\s*(?:q(?:uestion)?\s*)?[0-9०-९]{1,3}\s*(?:[.)।:]|\-)", text, re.I))
        if len(words) < 3 and not numbered:
            continue
        sections.append({"line_number": index, "text": text, "words": words})
    return sections


def match_input_to_html(input_text: str, html_text: str, *, sample_limit: int = 40) -> dict[str, Any]:
    """Return user-facing word coverage from input text to generated HTML.

    This is intentionally diagnostic rather than a pass/fail proof: OCR,
    spelling fixes, and legitimate grammar correction can change words. It is
    still very good at surfacing truncation like Q1-10 becoming Q1-7.
    """
    input_words = Counter(_words(input_text or "", strip_html=False))
    output_words = Counter(_words(html_text or "", strip_html=True))

    if not input_words:
        return {
            "coverage_percent": 100.0,
            "input_unique_words": 0,
            "matched_unique_words": 0,
            "missing_unique_words": 0,
            "missing_words": [],
            "missing_sections": [],
            "status": "empty-input",
        }

    matched = sum(1 for word in input_words if output_words.get(word, 0) > 0)
    missing = [word for word in input_words if output_words.get(word, 0) == 0]
    missing.sort(key=lambda word: (-input_words[word], word))
    coverage = round((matched / max(len(input_words), 1)) * 100, 2)
    missing_sections = []
    for section in _line_sections(input_text):
        section_words = section["words"]
        section_missing = [word for word in section_words if output_words.get(word, 0) == 0]
        if section_missing:
            missing_sections.append({
                "line_number": section["line_number"],
                "text": section["text"][:260],
                "missing_words": list(dict.fromkeys(section_missing))[:12],
                "coverage_percent": round(
                    ((len(section_words) - len(section_missing)) / max(len(section_words), 1)) * 100,
                    2,
                ),
            })

    return {
        "coverage_percent": coverage,
        "input_unique_words": len(input_words),
        "matched_unique_words": matched,
        "missing_unique_words": len(missing),
        "missing_words": missing[:sample_limit],
        "missing_sections": missing_sections[:10],
        "input_total_words": sum(input_words.values()),
        "output_total_words": sum(output_words.values()),
        "status": "ok" if coverage >= 95 else "review",
    }
