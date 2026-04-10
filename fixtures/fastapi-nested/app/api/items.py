from fastapi import APIRouter, Depends
from app.infra.auth import get_current_user_id
from app.infra.database import get_db

router = APIRouter(prefix="/items")


@router.post("/")
async def create_item(name: str, user_id=Depends(get_current_user_id), db=Depends(get_db)):
    return {"name": name}


@router.get("/")
async def list_items(user_id=Depends(get_current_user_id)):
    return []


@router.get("/{item_id}")
async def get_item(item_id: str, user_id=Depends(get_current_user_id)):
    return {"id": item_id}
