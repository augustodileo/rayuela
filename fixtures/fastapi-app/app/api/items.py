from fastapi import APIRouter, Depends
from uuid import UUID
from app.infra.auth import get_current_user_id
from app.services.item_service import ItemService

router = APIRouter()


@router.post("/")
async def create_item(name: str, user_id: UUID = Depends(get_current_user_id)):
    service = ItemService()
    return await service.create(name, user_id)


@router.get("/")
async def list_items(user_id: UUID = Depends(get_current_user_id)):
    service = ItemService()
    return await service.list_by_user(user_id)


@router.get("/{item_id}")
async def get_item(item_id: UUID, user_id: UUID = Depends(get_current_user_id)):
    service = ItemService()
    return await service.get(item_id, user_id)
