from app.infra.database import get_db


class ItemService:
    async def create(self, name: str, user_id):
        db = get_db()
        return {"id": "new-id", "name": name, "user_id": str(user_id)}

    async def list_by_user(self, user_id):
        db = get_db()
        return []

    async def get(self, item_id, user_id):
        db = get_db()
        return {"id": str(item_id), "name": "item", "user_id": str(user_id)}
