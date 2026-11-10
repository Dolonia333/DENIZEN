"""Pure text helpers shared by the application and standalone source importer."""
from datetime import datetime, timezone

def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()

def chunk_text(text: str, size: int = 5000, overlap: int = 400):
    text = text.replace('\x00', ' ')
    if not text.strip():
        return []
    if len(text) <= size:
        return [text]
    out, start = [], 0
    while start < len(text):
        end = min(len(text), start + size)
        out.append(text[start:end])
        if end == len(text):
            break
        start = max(start + 1, end - overlap)
    return out
