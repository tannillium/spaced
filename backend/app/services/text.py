from collections.abc import Iterable
from typing import Any


def document_json_to_text(value: Any) -> str:
    """Flatten a Tiptap JSON document without relying on rendered HTML."""
    pieces: list[str] = []

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "text" and isinstance(node.get("text"), str):
                pieces.append(node["text"])
            for child in node.get("content", []) if isinstance(node.get("content"), list) else []:
                visit(child)
            if node.get("type") in {"paragraph", "heading", "listItem", "taskItem", "blockquote", "codeBlock"}:
                pieces.append("\n")
        elif isinstance(node, list):
            for child in node:
                visit(child)

    visit(value)
    return "".join(pieces).replace("\u00a0", " ").strip()


def chunk_text(text: str, max_chars: int = 1800, overlap: int = 220) -> list[str]:
    text = " ".join(text.split())
    if not text:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + max_chars)
        if end < len(text):
            boundary = text.rfind(" ", start + max_chars // 2, end)
            if boundary > start:
                end = boundary
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(text):
            break
        start = max(start + 1, end - overlap)
    return chunks


def batch[T](values: Iterable[T], size: int) -> Iterable[list[T]]:
    batch_values: list[T] = []
    for value in values:
        batch_values.append(value)
        if len(batch_values) == size:
            yield batch_values
            batch_values = []
    if batch_values:
        yield batch_values
