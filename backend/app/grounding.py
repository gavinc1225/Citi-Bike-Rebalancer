"""Free-text location -> station: landmark alias table first, then char n-gram TF-IDF.

The TF-IDF is a plain-Python equivalent of scikit-learn's
TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4)) with default smoothing and L2 norm,
so the API needs no scikit-learn at runtime. tests/test_grounding.py checks it against sklearn.
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path

ALIASES_PATH = Path(__file__).with_name("aliases.json")
NGRAM_MIN, NGRAM_MAX = 2, 4

Vector = dict[str, float]


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", text.lower())).strip()


def char_wb_ngrams(text: str) -> list[str]:
    """Character n-grams inside word boundaries, padded with spaces (sklearn's char_wb analyzer)."""
    grams: list[str] = []
    for word in text.split():
        w = f" {word} "
        for n in range(NGRAM_MIN, NGRAM_MAX + 1):
            offset = 0
            grams.append(w[offset : offset + n])
            while offset + n < len(w):
                offset += 1
                grams.append(w[offset : offset + n])
            if offset == 0:  # a word shorter than n is counted only once
                break
    return grams


def _l2(vec: Vector) -> Vector:
    norm = math.sqrt(sum(v * v for v in vec.values()))
    return {k: v / norm for k, v in vec.items()} if norm else vec


class Grounder:
    def __init__(self, stations: dict[str, str], aliases: dict[str, str]):
        self.ids = list(stations)
        self.names = [stations[i] for i in self.ids]
        self.aliases = {normalize(k): v for k, v in aliases.items()}
        counts = [Counter(char_wb_ngrams(normalize(name))) for name in self.names]
        df = Counter(g for c in counts for g in c)
        n = len(self.names)
        self.idf = {g: math.log((1 + n) / (1 + d)) + 1 for g, d in df.items()}
        self.vectors = [_l2({g: tf * self.idf[g] for g, tf in c.items()}) for c in counts]

    def _query_vector(self, q: str) -> Vector:
        counts = Counter(g for g in char_wb_ngrams(q) if g in self.idf)
        return _l2({g: tf * self.idf[g] for g, tf in counts.items()})

    def scores(self, query: str) -> list[float]:
        qv = self._query_vector(normalize(query))
        return [sum(w * vec.get(g, 0.0) for g, w in qv.items()) for vec in self.vectors]

    def search(self, query: str, k: int = 3) -> list[dict]:
        q = normalize(query)
        if not q:
            return []
        results: list[dict] = []
        # Longest alias contained in the query wins, so "near hoboken terminal" still resolves.
        hits = sorted((a for a in self.aliases if re.search(rf"\b{re.escape(a)}\b", q)), key=len, reverse=True)
        for alias in hits:
            sid = self.aliases[alias]
            if all(r["id"] != sid for r in results):
                results.append({"id": sid, "name": self.names[self.ids.index(sid)], "score": 1.0, "source": "alias"})
        scores = self.scores(q)
        for i in sorted(range(len(scores)), key=lambda j: -scores[j]):
            if len(results) >= k or scores[i] <= 0:
                break
            if all(r["id"] != self.ids[i] for r in results):
                results.append({"id": self.ids[i], "name": self.names[i], "score": round(scores[i], 3),
                                "source": "tfidf"})
        return results[:k]


@lru_cache(maxsize=1)
def default_grounder() -> Grounder:
    from app.data import load

    return Grounder({s["id"]: s["name"] for s in load().stations}, json.loads(ALIASES_PATH.read_text()))
