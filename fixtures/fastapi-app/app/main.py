from fastapi import FastAPI
from app.api.auth import router as auth_router
from app.api.items import router as items_router

app = FastAPI()
app.include_router(auth_router, prefix="/api/v1/auth")
app.include_router(items_router, prefix="/api/v1/items")


@app.get("/health")
async def health():
    return {"status": "ok"}
