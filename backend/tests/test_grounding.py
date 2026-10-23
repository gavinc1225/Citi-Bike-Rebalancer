"""The plain-Python TF-IDF geocoder must score exactly like scikit-learn's (what A2 used)."""

from __future__ import annotations

import pytest
from sklearn.feature_extraction.text import TfidfVectorizer

from app.data import load
from app.grounding import char_wb_ngrams, default_grounder, normalize

QUERIES = [
    "grove street", "grove st path", "hamilton park", "exchange place", "journal sq", "van vorst",
    "city hall hoboken", "paulus hook", "christ hospital", "pathmark", "newark ave", "14 st",
    "light rail", "bergen", "washington st & 1 st", "x", "zz qq", "Hoboken   Terminal!!",
]


@pytest.fixture(scope="module")
def sklearn_model():
    names = [s["name"] for s in load().stations]
    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), preprocessor=normalize)
    return vec, vec.fit_transform(names)


def test_ngrams_match_sklearn():
    analyzer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), preprocessor=normalize).build_analyzer()
    for text in ["Grove St PATH", "a", "ab c", "Hudson Pl & Hoboken Terminal", "  "]:
        assert char_wb_ngrams(normalize(text)) == analyzer(text)


@pytest.mark.parametrize("query", QUERIES)
def test_scores_match_sklearn(sklearn_model, query):
    vec, matrix = sklearn_model
    expected = (matrix @ vec.transform([normalize(query)]).T).toarray().ravel()
    got = default_grounder().scores(query)
    assert got == pytest.approx(expected.tolist(), abs=1e-12)
