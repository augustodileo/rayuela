import jwt
from fastapi import Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from uuid import UUID

http_bearer = HTTPBearer()


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(http_bearer),
) -> UUID:
    token = credentials.credentials
    payload = jwt.decode(token, "secret", algorithms=["HS256"])
    return UUID(payload["sub"])
