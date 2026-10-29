"""The engine's levels, on the same scales as the teacher's form.

Reading: fluent, hesitant, or needs basic support. English: spoke in sentences, said single words,
or did not answer in English. The thresholds are working values: they follow the NIPUN Bharat
reading goals where these exist, and are to be calibrated against the teachers' levels with the
agreement measured after every run.
"""

from __future__ import annotations

#: Words of an unseen passage read correctly per minute that meet the grade's goal. NIPUN Bharat
#: sets 45 to 60 for Class 2 and 60 for Class 3. Class 1 has no national figure; 25 is a working
#: value for short, simple sentences.
TARGET_WCPM = {1: 25.0, 2: 45.0, 3: 60.0}
#: Share of the attempted words read correctly for fluent reading.
FLUENT_ACCURACY = 0.85
#: Reading at or above this share of the target speed is hesitant rather than needing support.
HESITANT_SPEED_SHARE = 0.4
#: Share of the step-down words read correctly for hesitant rather than needing support.
WORDS_HESITANT_SHARE = 0.6

#: English words in one utterance that make a sentence. A list of single words ("cat, sun, tree")
#: is not a sentence however long it is.
SENTENCE_WORDS = 3
#: Above this share of another language, a few English words are not an English answer.
OTHER_LANGUAGE_LIMIT = 0.7


def reading_level(
    reached_level: str,
    grade: int,
    wcpm: float | None,
    accuracy: float,
    correct_share: float,
) -> str:
    """The reading level from what the child read at the easiest step shown."""
    if reached_level == "passage":
        target = TARGET_WCPM.get(grade, TARGET_WCPM[3])
        speed = wcpm or 0.0
        if speed >= target and accuracy >= FLUENT_ACCURACY:
            return "fluent"
        if speed >= target * HESITANT_SPEED_SHARE:
            return "hesitant"
        return "needs_support"
    if reached_level == "words":
        return "hesitant" if correct_share >= WORDS_HESITANT_SHARE else "needs_support"
    return "needs_support"


def english_level(english_words: int, longest_utterance: int, other_language_share: float) -> str:
    """The English level from what the child said about the pictures."""
    if english_words == 0:
        return "no_response"
    if other_language_share > OTHER_LANGUAGE_LIMIT and english_words < SENTENCE_WORDS:
        return "no_response"
    if longest_utterance >= SENTENCE_WORDS:
        return "sentences"
    return "words"
