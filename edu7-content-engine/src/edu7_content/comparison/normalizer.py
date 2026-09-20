import re

def normalize_arabic(text: str) -> str:
    """
    Standardize Arabic string for robust fuzzy comparison:
    Unify Alef variants, Ta Marbuta, Ya, and remove Tashkeel.
    """
    if not text:
        return ""
    # Remove Tashkeel / Harakat
    text = re.sub(r'[\u064B-\u065F\u0670]', '', text)
    # Unify Alef (أ, إ, آ -> ا)
    text = re.sub(r'[إأآ]', 'ا', text)
    # Unify Ta Marbuta (ة -> ه)
    text = re.sub(r'ة', 'ه', text)
    # Unify Ya (ى -> ي)
    text = re.sub(r'ى', 'ي', text)
    # Remove extra whitespaces and punctuation
    text = re.sub(r'[^\w\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip().lower()
    return text

def compute_similarity(s1: str, s2: str) -> float:
    n1, n2 = normalize_arabic(s1), normalize_arabic(s2)
    if n1 == n2:
        return 1.0
    words1, words2 = set(n1.split()), set(n2.split())
    if not words1 or not words2:
        return 0.0
    jaccard = len(words1 & words2) / len(words1 | words2)
    return jaccard
