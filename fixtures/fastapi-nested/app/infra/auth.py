from fastapi import Depends
from fastapi.security import HTTPBearer


http_bearer = HTTPBearer()


async def get_current_user_id(credentials=Depends(http_bearer)):
    return "user-uuid"
