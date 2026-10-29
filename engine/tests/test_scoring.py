import json

import pytest

from agla_engine.item import ItemError, parse_item
from agla_engine.kappa import cohen_kappa
from agla_engine.levels import english_level, reading_level
from agla_engine.scoring import (
    DOUBTFUL_CONFIDENCE,
    Hearing,
    child_utterances,
    score_check,
    steps_to_hear,
)

PASSAGE = "Sam has a little cat. The cat is black and white. It likes to drink milk."

ITEM = {
    "reading": {
        "code": "en-g1-p02",
        "language": "en",
        "grade": 1,
        "passage": PASSAGE,
        "words": ["cat", "sun", "pen", "bag", "hat", "dog", "cup", "bed", "red", "big"],
        "letters": ["a", "m", "s", "t", "p", "n", "c", "o", "g", "d", "e", "b"],
    },
    "speaking": {
        "code": "en-g1-s01",
        "grade": 1,
        "pictures": ["cat", "sun"],
        "keywords": ["cat", "sun"],
        "question": "What is this?",
    },
    "shown": [{"level": "passage", "atMs": 0}, {"level": "english", "atMs": 30_000}],
    "restarts": 0,
}

HINDI_ITEM = {
    "reading": {
        "code": "hi-g2-p01",
        "language": "hi",
        "grade": 2,
        "passage": "मेरा नाम मीना है। मेरे घर में एक गाय है।",
        "words": ["गाय", "घर", "नल", "कप"],
        "letters": ["क", "ख", "ग", "घ"],
    },
    "speaking": {"keywords": ["cat"], "question": "What is this? Tell me about it."},
    "shown": [{"level": "passage", "atMs": 0}, {"level": "english", "atMs": 30_000}],
}


def hearing(
    level: str, text: str, *, duration: float = 30.0, speech: float = 20.0, **extra
) -> Hearing:
    return Hearing(
        level=level,
        text=text,
        duration=duration,
        speech_seconds=speech,
        speech_start=extra.pop("start", 1.0),
        speech_end=extra.pop("end", 1.0 + speech),
        **extra,
    )


def fluent_passage() -> Hearing:
    return hearing("passage", PASSAGE, speech=24.0, confidence=0.9)


def test_item_steps_follow_the_screen():
    item = parse_item(
        {
            **ITEM,
            "shown": [{"level": "words", "atMs": 12_000}, {"level": "english", "atMs": 40_000}],
        },
        1,
        "en",
    )
    assert [(step.level, step.start, step.end) for step in item.steps] == [
        ("passage", 0.0, 12.0),
        ("words", 12.0, 40.0),
        ("english", 40.0, None),
    ]
    assert item.reached_level == "words"
    assert item.keywords == ("cat", "sun")
    assert item.question == "What is this?"
    assert item.shown_known
    # The last step ends with the recording; a step that never started is dropped.
    steps = steps_to_hear(item, 55.0)
    assert [(step.level, step.end) for step in steps] == [
        ("passage", 12.0),
        ("words", 40.0),
        ("english", 55.0),
    ]
    assert [step.level for step in steps_to_hear(item, 35.0)] == ["passage", "words"]


def test_an_item_that_does_not_say_when_the_screen_changed():
    item = parse_item({**ITEM, "shown": []}, 1, "en")
    assert not item.shown_known
    assert [(step.level, step.start, step.end) for step in item.steps] == [("passage", 0.0, None)]


def test_item_without_a_passage_cannot_be_scored():
    with pytest.raises(ItemError):
        parse_item({"shown": []}, 1, "en")
    with pytest.raises(ItemError):
        parse_item("not an item", 1, "en")
    with pytest.raises(ItemError):
        parse_item({"reading": {"passage": "  "}}, 1, "en")


def test_reading_levels_follow_the_grade_goals():
    assert reading_level("passage", 2, 50, 0.95, 0.9) == "fluent"
    assert reading_level("passage", 2, 50, 0.7, 0.9) == "hesitant"  # fast but inaccurate
    assert reading_level("passage", 3, 30, 0.95, 0.5) == "hesitant"
    assert reading_level("passage", 3, 10, 0.95, 0.2) == "needs_support"
    assert reading_level("words", 2, None, 0.0, 0.8) == "hesitant"
    assert reading_level("words", 2, None, 0.0, 0.3) == "needs_support"
    assert reading_level("letters", 1, None, 0.0, 1.0) == "needs_support"


def test_english_levels():
    assert english_level(0, 0, 0.0) == "no_response"
    assert english_level(2, 1, 0.9) == "no_response"  # mostly another language
    assert english_level(2, 1, 0.0) == "words"
    assert english_level(4, 4, 0.0) == "sentences"
    # A list of single words is not a sentence, however long it is.
    assert english_level(6, 1, 0.0) == "words"
    assert english_level(6, 2, 0.0) == "words"


def test_the_teachers_question_is_not_the_childs_answer():
    item = parse_item(ITEM, 1, "en")
    assert child_utterances(item, "What is this? Cat. Sun.") == [["cat"], ["sun"]]
    assert child_utterances(item, "What is this?") == []
    # The child's own sentence may hold the same words in another order.
    assert child_utterances(item, "What is this? This is a cat.") == [["this", "is", "a", "cat"]]
    # Contractions are spelt out, in the question and in the answer.
    assert child_utterances(item, "What's this? It's a cat.") == [["it", "is", "a", "cat"]]
    assert child_utterances(item, f"What{chr(0x2019)}s this?") == []
    # Utterances end at a comma or a danda as well as at the end of a sentence.
    grade3 = parse_item(
        {**ITEM, "speaking": {"question": "Look at the pictures. Tell me about them."}}, 3, "en"
    )
    heard = "Look at the pictures. Tell me about them. I see a cat, the sun is hot, ball"
    assert child_utterances(grade3, heard) == [
        ["i", "see", "a", "cat"],
        ["the", "sun", "is", "hot"],
        ["ball"],
    ]


def test_a_fluent_reader_who_names_the_pictures():
    item = parse_item(ITEM, 1, "en")
    score = score_check(
        item,
        {
            # The whole passage, correctly, in 24 seconds of reading.
            "passage": fluent_passage(),
            "english": hearing(
                "english",
                "What is this? Cat. Sun.",
                duration=25.0,
                speech=3.0,
                confidence=0.8,
                english_probability=0.95,
            ),
        },
    )
    assert score.reading.reached_level == "passage"
    assert score.reading.items == 16
    assert score.reading.correct == 16
    assert score.reading.wcpm == pytest.approx(16 / (24 / 60))
    assert score.reading.level == "fluent"
    # The question's words are not counted.
    assert score.english.words == 2
    assert score.english.keyword_hits == 2
    assert score.english.level == "words"
    assert score.flags == ()
    assert score.confidence == pytest.approx(0.85)


def test_a_child_who_answers_in_sentences():
    item = parse_item(ITEM, 1, "en")
    score = score_check(
        item,
        {
            "passage": fluent_passage(),
            "english": hearing(
                "english",
                "What is this? This is a cat. The sun is yellow.",
                duration=25.0,
                speech=6.0,
                english_probability=0.97,
            ),
        },
    )
    assert score.english.level == "sentences"
    assert score.english.longest_utterance == 4
    assert score.english.keyword_hits == 2


def test_a_child_who_stopped_reading_is_timed_to_the_end_of_the_step():
    item = parse_item(ITEM, 1, "en")
    # Eight words read correctly between 1 s and 9 s; the passage stayed on screen until 30 s.
    score = score_check(
        item,
        {
            "passage": hearing(
                "passage", "Sam has a little cat. The cat is", start=1.0, end=9.0, speech=8.0
            ),
            "english": hearing("english", "cat", duration=25.0, speech=1.0),
        },
    )
    assert (score.reading.correct, score.reading.items) == (8, 16)
    assert score.reading.seconds == pytest.approx(29.0)
    # About 17 words a minute: accurate, but below the Class 1 goal of 25.
    assert score.reading.wcpm == pytest.approx(8 / (29 / 60))
    assert score.reading.level == "hesitant"


def test_a_child_who_stepped_down_and_answered_in_hindi():
    item = parse_item(
        {
            **ITEM,
            "shown": [{"level": "words", "atMs": 10_000}, {"level": "english", "atMs": 40_000}],
        },
        1,
        "en",
    )
    score = score_check(
        item,
        {
            "passage": hearing("passage", "sam", duration=10.0, speech=2.0),
            # The grid read down the columns.
            "words": hearing("words", "cat hat sun dog pen bag", duration=30.0, speech=12.0),
            "english": hearing(
                "english",
                "यह बिल्ली है",
                duration=20.0,
                speech=3.0,
                english_probability=0.05,
            ),
        },
    )
    assert score.reading.reached_level == "words"
    assert score.reading.wcpm is None
    assert (score.reading.items, score.reading.correct) == (10, 6)
    assert score.reading.level == "hesitant"
    assert score.english.level == "no_response"
    assert score.english.other_language_share == pytest.approx(1.0)
    assert "other_language" in score.flags


def test_hindi_reading_with_a_misread_vowel_sign():
    item = parse_item(HINDI_ITEM, 2, "hi")
    score = score_check(
        item,
        {
            "passage": hearing("passage", "मेरी नाम मीना है। मेरे घर में एक गाय है।", speech=10.0),
            "english": hearing("english", "cat", duration=25.0, speech=1.0),
        },
    )
    assert (score.reading.items, score.reading.correct) == (10, 9)
    assert score.flags == ()


def test_silence_is_flagged_and_scored_lowest():
    item = parse_item(ITEM, 1, "en")
    score = score_check(
        item,
        {
            "passage": hearing("passage", "", speech=0.0, start=None, end=None),
            "english": hearing("english", "", duration=25.0, speech=0.0, start=None, end=None),
        },
    )
    assert score.reading.level == "needs_support"
    assert score.english.level == "no_response"
    assert "no_speech" in score.flags and "low_confidence" in score.flags
    assert "no_reading" not in score.flags and "no_english" not in score.flags
    assert score.confidence <= 0.2


def test_a_question_without_an_answer_is_flagged():
    item = parse_item(ITEM, 1, "en")
    score = score_check(
        item,
        {
            "passage": fluent_passage(),
            # Only the teacher's voice was heard.
            "english": hearing("english", "What is this?", duration=25.0, speech=1.0),
        },
    )
    assert score.english.level == "no_response"
    assert not score.english.answered
    assert "no_english" in score.flags and "no_speech" not in score.flags
    assert score.confidence <= DOUBTFUL_CONFIDENCE
    assert "low_confidence" in score.flags


def test_an_answer_without_reading_is_flagged():
    item = parse_item(ITEM, 1, "en")
    score = score_check(
        item,
        {
            "passage": hearing("passage", "", speech=0.2, start=3.0, end=3.2),
            "english": hearing("english", "cat", duration=25.0, speech=1.0, confidence=0.9),
        },
    )
    assert "no_reading" in score.flags and "no_speech" not in score.flags
    assert score.confidence <= DOUBTFUL_CONFIDENCE


def test_doubtful_recordings_are_flagged():
    item = parse_item(ITEM, 1, "en")
    quiet = score_check(
        item,
        {
            "passage": hearing("passage", PASSAGE, speech=24.0, confidence=0.9, speech_dbfs=-48.0),
            "english": hearing("english", "cat", duration=25.0, speech=1.0, speech_dbfs=-45.0),
        },
    )
    assert "quiet" in quiet.flags and "low_confidence" in quiet.flags

    unknown = score_check(
        parse_item({**ITEM, "shown": []}, 1, "en"),
        {"passage": fluent_passage()},
    )
    assert "unknown_item" in unknown.flags

    seen = score_check(item, {"passage": fluent_passage()}, seen_before=True)
    assert "seen_before" in seen.flags

    # Whisper standing in for IndicConformer is doubtful for Hindi reading only.
    hindi = parse_item(HINDI_ITEM, 2, "hi")
    passage = hearing("passage", "मेरा नाम मीना है", speech=4.0, confidence=0.9)
    assert (
        "fallback_recogniser"
        in score_check(hindi, {"passage": passage}, fallback_recogniser=True).flags
    )
    assert (
        "fallback_recogniser"
        not in score_check(item, {"passage": fluent_passage()}, fallback_recogniser=True).flags
    )


def test_row_fits_the_database_and_cuts_long_transcripts():
    item = parse_item(ITEM, 1, "en")
    long_text = " ".join(["word"] * 5000)
    score = score_check(
        item,
        {
            "passage": hearing("passage", long_text, speech=30.0),
            "english": hearing("english", long_text, duration=25.0, speech=20.0),
        },
    )
    row = score.row("00000000-0000-4000-8000-000000000001", "pulse-engine 1.0 (test)")
    assert len(json.dumps(row["transcript"], ensure_ascii=False).encode()) <= 12_000
    assert set(row) >= {"check_id", "reading_level", "english_level", "wcpm", "flags", "transcript"}
    assert 0 <= row["confidence"] <= 1
    assert row["wcpm"] is None or row["wcpm"] <= 400


def test_cohen_kappa():
    levels = ("needs_support", "hesitant", "fluent")
    assert cohen_kappa([("fluent", "fluent"), ("hesitant", "hesitant")], levels) == 1.0
    assert cohen_kappa([], levels) is None
    # A worked example: 50 checks, observed agreement 0.7, chance agreement 0.5.
    pairs = (
        [("fluent", "fluent")] * 20
        + [("hesitant", "hesitant")] * 15
        + [("fluent", "hesitant")] * 5
        + [("hesitant", "fluent")] * 10
    )
    assert cohen_kappa(pairs, levels) == pytest.approx(0.4)
    # Neighbouring levels disagree less than distant ones when weighted.
    near = [("fluent", "hesitant"), ("hesitant", "hesitant"), ("needs_support", "needs_support")]
    far = [
        ("fluent", "needs_support"),
        ("hesitant", "hesitant"),
        ("needs_support", "needs_support"),
    ]
    assert cohen_kappa(near, levels, weighted=True) > cohen_kappa(far, levels, weighted=True)
