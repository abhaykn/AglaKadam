from agla_engine.align import (
    align,
    edit_distance,
    letter_units,
    match_any_order,
    match_letters,
    words_match,
)
from agla_engine.text import (
    aksharas,
    english_words_of,
    is_devanagari,
    normalise_word,
    other_language_words_of,
    words_of,
)


def test_hindi_spelling_variants_compare_equal():
    # Nukta, chandrabindu against anusvara, and decomposed against composed forms.
    assert normalise_word("ज़रूरी") == normalise_word("जरूरी")
    assert normalise_word("हँसना") == normalise_word("हंसना")
    assert normalise_word("सड़क") == normalise_word("सडक")
    decomposed = "\u0915\u093c\u093e\u0932"  # \u0915 + nukta + \u093e + \u0932
    assert normalise_word(decomposed) == normalise_word("काल")


def test_words_of_passages_and_transcripts():
    assert words_of("मेरा नाम मीना है। मेरे घर में एक गाय है।") == [
        "मेरा", "नाम", "मीना", "है", "मेरे", "घर", "में", "एक", "गाय", "है",
    ]  # fmt: skip
    assert words_of("Meera's grandmother said, \u201cHello!\u201d") == [
        "meera's", "grandmother", "said", "hello",
    ]  # fmt: skip
    assert words_of("") == []


def test_apostrophes_and_single_quotation_marks():
    left, right = chr(0x2018), chr(0x2019)
    # A curly apostrophe is an apostrophe, as a straight one is.
    assert words_of(f"It{right}s Meera{right}s cat.") == ["it's", "meera's", "cat"]
    assert words_of("It's Meera's cat.") == ["it's", "meera's", "cat"]
    # Quotation marks around a word are not part of it, in either script.
    assert words_of(f"She said {left}hello{right}.") == ["she", "said", "hello"]
    assert words_of(f"{left}नमस्ते{right} 'दीदी'") == ["नमस्ते", "दीदी"]


def test_english_and_other_language_words():
    text = "this is a cat बिल्ली"
    assert english_words_of(text) == ["this", "is", "a", "cat"]
    assert other_language_words_of(text) == ["बिल्ली"]
    assert is_devanagari("गाय") and not is_devanagari("cow")


def test_aksharas_keep_vowel_signs_and_conjuncts_together():
    assert aksharas("बच्चा") == ["ब", "च्चा"]
    assert aksharas("किताब") == ["कि", "ता", "ब"]
    assert aksharas("आम") == ["आ", "म"]


def test_edit_distance_and_word_matching():
    assert edit_distance("kitten", "sitting") == 3
    # A vowel sign read wrongly is the commonest error of early readers: never forgiven.
    assert not words_match("काल", "कल")
    assert not words_match("मेरा", "मेरी")
    assert not words_match("दिन", "दीन")
    assert not words_match("मछली", "मछलि")
    assert not words_match("है", "हो")
    assert words_match("मछली", "मछली")
    # Long words, which recognisers sometimes misspell, may differ by one character.
    assert words_match("प्रधानमंत्री", "प्रधानमंत्रि")
    assert words_match("grandmother", "grandmothr")
    assert not words_match("grandmother", "grandfather")
    assert not words_match("cat", "cut")
    assert not words_match("likes", "like")
    assert not words_match("cat", "dog")


def test_alignment_counts_what_was_read():
    expected = words_of("the cat sat on the mat")
    # Reads "cat" as "cut", says "sat" again where "on" stands, stops before "mat".
    result = align(expected, words_of("the cut sat sat the"))
    assert result.expected == 6
    assert result.correct == 3
    assert result.marks == (True, False, True, False, True, False)
    assert (result.substituted, result.inserted) == (2, 0)
    # The last word was never reached: it is not counted as attempted or omitted.
    assert result.attempted == 5
    assert result.omitted == 0
    assert result.accuracy == 3 / 5

    # A word left out in the middle, and a word added.
    skipped = align(words_of("one two three four"), words_of("one three um four"))
    assert (skipped.correct, skipped.omitted, skipped.inserted) == (3, 1, 1)


def test_alignment_of_nothing_heard():
    result = align(words_of("one two three"), [])
    assert (result.correct, result.attempted, result.omitted, result.accuracy) == (0, 0, 0, 0.0)


def test_a_stray_word_at_the_end_does_not_reach_further():
    # The child stopped after "three" and said "um": "four" was not reached, not misread.
    result = align(words_of("one two three four five"), words_of("one two three um"))
    assert (result.correct, result.attempted, result.inserted) == (3, 3, 1)
    assert (result.substituted, result.omitted) == (0, 0)
    assert result.accuracy == 1.0


def test_a_misread_vowel_sign_counts_against_the_reader():
    result = align(words_of("मेरा नाम मीना है"), words_of("मेरी नाम मीना है"))
    assert (result.correct, result.substituted, result.attempted) == (3, 1, 4)
    assert result.marks == (False, True, True, True)


def test_equal_alignments_never_mark_the_child_down():
    # "the" twice: the repeated word is an insertion, both expected words are read correctly.
    result = align(words_of("the cat"), words_of("the the cat"))
    assert (result.correct, result.inserted, result.attempted) == (2, 1, 2)


def test_a_grid_may_be_read_in_any_order():
    shown = words_of("गाय घर नल कप")
    # Read down the columns instead of along the rows, with one word not on the grid.
    result = match_any_order(shown, words_of("नल गाय बस कप"))
    assert result.marks == (True, False, True, True)
    assert (result.correct, result.inserted, result.attempted) == (3, 1, 4)
    # A word said twice counts once.
    assert match_any_order(shown, words_of("गाय गाय")).correct == 1


def test_letters_read_one_by_one():
    # A recogniser may write a letter read aloud with a vowel sign, or as its English name.
    assert letter_units(["का", "ख", "गा"]) == ["क", "ख", "ग"]
    assert letter_units(["m", "ess", "tee", "hello"]) == ["m", "s", "t"]
    result = match_letters(["क", "ख", "ग", "घ"], ["का", "ख", "घ"])
    assert result.correct == 3
    assert result.marks == (True, True, False, True)
    # In any order, as for words.
    assert match_letters(["क", "ख", "ग", "घ"], ["घ", "क"]).marks == (True, False, False, True)
