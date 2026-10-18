"""Free-text location -> station: landmark alias table first, then char n-gram TF-IDF."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

ALIASES_PATH = Path(__file__).with_name("aliases.json")


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", text.lower())).strip()


class Grounder:
    def __init__(self, stations: dict[str, str], aliases: dict[str, str]):
        self.ids = list(stations)
        self.names = [stations[i] for i in self.ids]
        self.aliases = {normalize(k): v for k, v in aliases.items()}
        self.vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), preprocessor=normalize)
        self.matrix = self.vectorizer.fit_transform(self.names)

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
        scores = (self.matrix @ self.vectorizer.transform([q]).T).toarray().ravel()
        for i in np.argsort(-scores):
            if len(results) >= k or scores[i] <= 0:
                break
            if all(r["id"] != self.ids[i] for r in results):
                results.append({"id": self.ids[i], "name": self.names[i], "score": round(float(scores[i]), 3),
                                "source": "tfidf"})
        return results[:k]


@lru_cache(maxsize=1)
def default_grounder() -> Grounder:
    from app.forecast import load

    stations = load().stations["name"].to_dict()
    return Grounder(stations, json.loads(ALIASES_PATH.read_text()))
