from __future__ import annotations

import io
import re
import zipfile

from sqlalchemy.orm import Session

from app.services.embedding import embed_and_store


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """Split text into overlapping chunks."""
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        if chunk.strip():
            chunks.append(chunk.strip())
        start = end - overlap
    return chunks


def extract_text_from_content(content: bytes, filename: str) -> str:
    """Extract plain text from file content based on extension."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext in ("txt", "md"):
        return content.decode("utf-8", errors="ignore")

    if ext == "pdf":
        try:
            import pdfplumber  # noqa: WPS433

            with pdfplumber.open(io.BytesIO(content)) as pdf:
                return "\n".join(page.extract_text() or "" for page in pdf.pages)
        except Exception:  # noqa: BLE001
            return ""

    if ext == "docx":
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as z:
                with z.open("word/document.xml") as f:
                    xml_content = f.read().decode("utf-8")
                    text = re.sub(r"<[^>]+>", " ", xml_content)
                    return re.sub(r"\s+", " ", text).strip()
        except Exception:  # noqa: BLE001
            return ""

    # Fallback: try as plain text
    return content.decode("utf-8", errors="ignore")


async def index_document(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    data_item_id: str,
    content: bytes,
    filename: str,
) -> int:
    """Index a document: extract text, chunk, embed, store.

    Returns the number of chunks created.
    """
    text = extract_text_from_content(content, filename)
    if not text.strip():
        return 0

    chunks = chunk_text(text)
    count = 0
    for chunk in chunks:
        try:
            await embed_and_store(
                db,
                workspace_id=workspace_id,
                project_id=project_id,
                data_item_id=data_item_id,
                chunk_text=chunk,
            )
            count += 1
        except Exception:  # noqa: BLE001
            continue  # Skip failed chunks

    return count
