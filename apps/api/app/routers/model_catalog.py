from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db_session
from app.core.errors import ApiError
from app.models import ModelCatalog, User
from app.schemas.model_catalog import ModelCatalogOut

router = APIRouter(prefix="/api/v1/models/catalog", tags=["model-catalog"])


@router.get("", response_model=list[ModelCatalogOut])
def list_catalog(
    category: str | None = Query(default=None),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[ModelCatalogOut]:
    _ = current_user
    query = db.query(ModelCatalog).filter(ModelCatalog.is_active.is_(True))
    if category:
        query = query.filter(ModelCatalog.category == category.lower())
    items = query.order_by(ModelCatalog.sort_order).all()
    return [ModelCatalogOut.model_validate(item, from_attributes=True) for item in items]


@router.get("/{model_id}", response_model=ModelCatalogOut)
def get_catalog_item(
    model_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> ModelCatalogOut:
    _ = current_user
    item = (
        db.query(ModelCatalog)
        .filter(ModelCatalog.model_id == model_id, ModelCatalog.is_active.is_(True))
        .first()
    )
    if not item:
        raise ApiError("not_found", "Model not found in catalog", status_code=404)
    return ModelCatalogOut.model_validate(item, from_attributes=True)
