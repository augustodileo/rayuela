class AuthService:
    async def create_user(self, email: str, password: str):
        return {"id": "new-user", "email": email, "token": "jwt-token"}

    async def authenticate(self, email: str, password: str):
        return {"token": "jwt-token"}
