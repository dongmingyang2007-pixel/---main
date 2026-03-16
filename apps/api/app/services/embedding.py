from sqlalchemy.orm import Session
from sqlalchemy import text as sql_text
from uuid import uuid4

from app.services.dashscope_client import create_embedding


async def embed_and_store(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    memory_id: str | None = None,
    data_item_id: str | None = None,
    chunk_text: str,
) -> str:
    """Embed text and store the vector in the embeddings table.
    Returns the embedding ID."""
    # Get vector from DashScope
    vector = await create_embedding(chunk_text)

    # Insert with raw SQL for pgvector support
    embedding_id = str(uuid4())
    db.execute(
        sql_text("""
            INSERT INTO embeddings (id, workspace_id, project_id, memory_id, data_item_id, chunk_text, vector, created_at)
            VALUES (:id, :workspace_id, :project_id, :memory_id, :data_item_id, :chunk_text, :vector::vector, now())
        """),
        {
            "id": embedding_id,
            "workspace_id": workspace_id,
            "project_id": project_id,
            "memory_id": memory_id,
            "data_item_id": data_item_id,
            "chunk_text": chunk_text,
            "vector": str(vector),  # pgvector expects string like "[0.1, 0.2, ...]"
        },
    )
    db.commit()
    return embedding_id


async def search_similar(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    query: str,
    limit: int = 5,
) -> list[dict]:
    """Semantic search: find most similar embeddings by cosine distance.
    Returns list of {chunk_text, memory_id, data_item_id, score}."""
    query_vector = await create_embedding(query)

    results = db.execute(
        sql_text("""
            SELECT id, chunk_text, memory_id, data_item_id,
                   1 - (vector <=> :query_vector::vector) AS score
            FROM embeddings
            WHERE workspace_id = :workspace_id
              AND project_id = :project_id
              AND vector IS NOT NULL
            ORDER BY vector <=> :query_vector::vector
            LIMIT :limit
        """),
        {
            "workspace_id": workspace_id,
            "project_id": project_id,
            "query_vector": str(query_vector),
            "limit": limit,
        },
    ).fetchall()

    return [
        {
            "id": row[0],
            "chunk_text": row[1],
            "memory_id": row[2],
            "data_item_id": row[3],
            "score": float(row[4]) if row[4] else 0.0,
        }
        for row in results
    ]


def delete_embeddings_for_memory(db: Session, memory_id: str) -> None:
    """Delete all embeddings associated with a memory."""
    db.execute(
        sql_text("DELETE FROM embeddings WHERE memory_id = :memory_id"),
        {"memory_id": memory_id},
    )
    db.commit()
