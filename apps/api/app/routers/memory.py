from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_current_workspace_id, get_db_session, require_csrf_protection
from app.core.errors import ApiError
from app.models import Memory, MemoryEdge, MemoryFile, Project, User
from app.schemas.memory import (
    MemoryCreate,
    MemoryDetailOut,
    MemoryEdgeCreate,
    MemoryEdgeOut,
    MemoryFileOut,
    MemoryGraphOut,
    MemoryOut,
    MemoryUpdate,
)

router = APIRouter(prefix="/api/v1/memory", tags=["memory"])


def _verify_project_ownership(db: Session, project_id: str, workspace_id: str) -> Project:
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.workspace_id == workspace_id, Project.deleted_at.is_(None))
        .first()
    )
    if not project:
        raise ApiError("not_found", "Project not found", status_code=404)
    return project


@router.get("", response_model=MemoryGraphOut)
def get_memory_graph(
    project_id: str = Query(...),
    conversation_id: str | None = Query(default=None),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
) -> MemoryGraphOut:
    _ = current_user
    _verify_project_ownership(db, project_id, workspace_id)

    # All permanent nodes for this project
    permanent = (
        db.query(Memory)
        .filter(Memory.project_id == project_id, Memory.workspace_id == workspace_id, Memory.type == "permanent")
        .all()
    )

    # Temporary nodes for given conversation (if provided)
    temporary: list[Memory] = []
    if conversation_id:
        temporary = (
            db.query(Memory)
            .filter(
                Memory.project_id == project_id,
                Memory.workspace_id == workspace_id,
                Memory.type == "temporary",
                Memory.source_conversation_id == conversation_id,
            )
            .all()
        )

    all_memories = permanent + temporary
    memory_ids = [m.id for m in all_memories]

    # All edges between the collected memory nodes
    edges: list[MemoryEdge] = []
    if memory_ids:
        edges = (
            db.query(MemoryEdge)
            .filter(MemoryEdge.source_memory_id.in_(memory_ids), MemoryEdge.target_memory_id.in_(memory_ids))
            .all()
        )

    return MemoryGraphOut(
        nodes=[MemoryOut.model_validate(m, from_attributes=True) for m in all_memories],
        edges=[MemoryEdgeOut.model_validate(e, from_attributes=True) for e in edges],
    )


@router.post("", response_model=MemoryOut)
def create_memory(
    payload: MemoryCreate,
    db: Session = Depends(get_db_session),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
) -> MemoryOut:
    _verify_project_ownership(db, payload.project_id, workspace_id)

    memory = Memory(
        workspace_id=workspace_id,
        project_id=payload.project_id,
        content=payload.content,
        category=payload.category,
        type=payload.type,
        source_conversation_id=payload.source_conversation_id,
        parent_memory_id=payload.parent_memory_id,
        position_x=payload.position_x,
        position_y=payload.position_y,
        metadata_json=payload.metadata_json,
    )
    db.add(memory)
    db.commit()
    db.refresh(memory)
    return MemoryOut.model_validate(memory, from_attributes=True)


@router.get("/{memory_id}", response_model=MemoryDetailOut)
def get_memory_detail(
    memory_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
) -> MemoryDetailOut:
    _ = current_user
    memory = (
        db.query(Memory)
        .filter(Memory.id == memory_id, Memory.workspace_id == workspace_id)
        .first()
    )
    if not memory:
        raise ApiError("not_found", "Memory not found", status_code=404)

    edges = (
        db.query(MemoryEdge)
        .filter(
            (MemoryEdge.source_memory_id == memory_id) | (MemoryEdge.target_memory_id == memory_id)
        )
        .all()
    )

    files = db.query(MemoryFile).filter(MemoryFile.memory_id == memory_id).all()

    result = MemoryDetailOut.model_validate(memory, from_attributes=True)
    result.edges = [MemoryEdgeOut.model_validate(e, from_attributes=True) for e in edges]
    result.files = [MemoryFileOut.model_validate(f, from_attributes=True) for f in files]
    return result


@router.patch("/{memory_id}", response_model=MemoryOut)
def update_memory(
    memory_id: str,
    payload: MemoryUpdate,
    db: Session = Depends(get_db_session),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
) -> MemoryOut:
    memory = (
        db.query(Memory)
        .filter(Memory.id == memory_id, Memory.workspace_id == workspace_id)
        .first()
    )
    if not memory:
        raise ApiError("not_found", "Memory not found", status_code=404)

    if payload.content is not None:
        memory.content = payload.content
    if payload.category is not None:
        memory.category = payload.category
    if payload.type is not None:
        memory.type = payload.type
    if payload.parent_memory_id is not None:
        memory.parent_memory_id = payload.parent_memory_id
    if payload.position_x is not None:
        memory.position_x = payload.position_x
    if payload.position_y is not None:
        memory.position_y = payload.position_y
    if payload.metadata_json is not None:
        memory.metadata_json = payload.metadata_json
    memory.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(memory)
    return MemoryOut.model_validate(memory, from_attributes=True)


@router.delete("/{memory_id}")
def delete_memory(
    memory_id: str,
    db: Session = Depends(get_db_session),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
) -> dict:
    memory = (
        db.query(Memory)
        .filter(Memory.id == memory_id, Memory.workspace_id == workspace_id)
        .first()
    )
    if not memory:
        raise ApiError("not_found", "Memory not found", status_code=404)

    db.delete(memory)
    db.commit()
    return {"ok": True}


@router.post("/{memory_id}/promote", response_model=MemoryOut)
def promote_memory(
    memory_id: str,
    db: Session = Depends(get_db_session),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
) -> MemoryOut:
    memory = (
        db.query(Memory)
        .filter(Memory.id == memory_id, Memory.workspace_id == workspace_id)
        .first()
    )
    if not memory:
        raise ApiError("not_found", "Memory not found", status_code=404)

    if memory.type != "temporary":
        raise ApiError("bad_request", "Only temporary memories can be promoted", status_code=400)

    memory.type = "permanent"
    memory.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(memory)
    return MemoryOut.model_validate(memory, from_attributes=True)


@router.post("/edges", response_model=MemoryEdgeOut)
def create_edge(
    payload: MemoryEdgeCreate,
    db: Session = Depends(get_db_session),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
) -> MemoryEdgeOut:
    # Verify both memories belong to the same workspace
    source = (
        db.query(Memory)
        .filter(Memory.id == payload.source_memory_id, Memory.workspace_id == workspace_id)
        .first()
    )
    target = (
        db.query(Memory)
        .filter(Memory.id == payload.target_memory_id, Memory.workspace_id == workspace_id)
        .first()
    )
    if not source or not target:
        raise ApiError("not_found", "Source or target memory not found", status_code=404)

    # Check for duplicate
    existing = (
        db.query(MemoryEdge)
        .filter(
            MemoryEdge.source_memory_id == payload.source_memory_id,
            MemoryEdge.target_memory_id == payload.target_memory_id,
        )
        .first()
    )
    if existing:
        raise ApiError("conflict", "Edge already exists between these memories", status_code=409)

    edge = MemoryEdge(
        source_memory_id=payload.source_memory_id,
        target_memory_id=payload.target_memory_id,
        edge_type=payload.edge_type,
        strength=payload.strength,
    )
    db.add(edge)
    db.commit()
    db.refresh(edge)
    return MemoryEdgeOut.model_validate(edge, from_attributes=True)


@router.delete("/edges/{edge_id}")
def delete_edge(
    edge_id: str,
    db: Session = Depends(get_db_session),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
) -> dict:
    # Verify the edge belongs to a memory in the user's workspace
    edge = db.query(MemoryEdge).filter(MemoryEdge.id == edge_id).first()
    if not edge:
        raise ApiError("not_found", "Edge not found", status_code=404)

    source_memory = (
        db.query(Memory)
        .filter(Memory.id == edge.source_memory_id, Memory.workspace_id == workspace_id)
        .first()
    )
    if not source_memory:
        raise ApiError("not_found", "Edge not found", status_code=404)

    db.delete(edge)
    db.commit()
    return {"ok": True}
