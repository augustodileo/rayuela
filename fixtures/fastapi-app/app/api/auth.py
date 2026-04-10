from fastapi import APIRouter
from app.services.auth_service import AuthService

router = APIRouter()


@router.post("/signup")
async def signup(email: str, password: str):
    service = AuthService()
    return await service.create_user(email, password)


@router.post("/login")
async def login(email: str, password: str):
    service = AuthService()
    return await service.authenticate(email, password)
