from fastapi import APIRouter

router = APIRouter(prefix="/auth")


@router.post("/signup")
async def signup(email: str, password: str):
    return {"email": email}


@router.post("/login")
async def login(email: str, password: str):
    return {"token": "jwt-token"}
