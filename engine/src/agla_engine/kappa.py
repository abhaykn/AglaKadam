"""Agreement between the teachers' and the engine's levels."""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence


def cohen_kappa(
    pairs: Sequence[tuple[str, str]],
    categories: Sequence[str],
    weighted: bool = False,
) -> float | None:
    """Cohen's kappa of two raters over the given categories; None without enough data.

    With `weighted`, disagreements count by their squared distance on the ordered scale
    (quadratic weights), so that "fluent" against "hesitant" counts less than against "needs
    support".
    """
    rated = [(a, b) for a, b in pairs if a in categories and b in categories]
    total = len(rated)
    if total == 0:
        return None
    index = {category: position for position, category in enumerate(categories)}
    size = len(categories)

    def weight(a: int, b: int) -> float:
        if not weighted:
            return 0.0 if a == b else 1.0
        return ((a - b) / (size - 1)) ** 2 if size > 1 else 0.0

    first = Counter(index[a] for a, _ in rated)
    second = Counter(index[b] for _, b in rated)
    observed = sum(weight(index[a], index[b]) for a, b in rated) / total
    expected = sum(
        weight(i, j) * first[i] * second[j] for i in range(size) for j in range(size)
    ) / (total * total)
    if expected == 0:
        # Both raters used one and the same category throughout: agreement is complete but
        # kappa is not defined.
        return 1.0 if observed == 0 else None
    return 1.0 - observed / expected
