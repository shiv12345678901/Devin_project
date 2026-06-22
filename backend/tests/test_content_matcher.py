import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from utils.content_matcher import match_input_to_html  # noqa: E402


def test_match_input_to_html_reports_full_coverage_for_same_words():
    result = match_input_to_html(
        "1. What is photosynthesis? Answer: Plants make food.",
        "<html><body><div>1. What is photosynthesis?</div><p>Answer: Plants make food.</p></body></html>",
    )

    assert result["coverage_percent"] == 100.0
    assert result["missing_words"] == []


def test_match_input_to_html_shows_missing_word_samples():
    result = match_input_to_html(
        "question one answer one question two answer two question ten answer ten",
        "<html><body>question one answer one question two answer two</body></html>",
    )

    assert result["coverage_percent"] < 100
    assert "ten" in result["missing_words"]


def test_match_input_to_html_reports_missing_input_lines():
    result = match_input_to_html(
        "Class: 10\nSubject: Nepali\n1. first question answer\n2. second question answer\n3. third question answer",
        "<html><body>1. first question answer 2. second question answer</body></html>",
    )

    assert result["coverage_percent"] < 100
    assert result["missing_sections"]
    assert any(section["line_number"] == 5 for section in result["missing_sections"])
    assert any("third" in section["missing_words"] for section in result["missing_sections"])
