from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession


engine = create_async_engine("postgresql+asyncpg://localhost/app")


async def get_db() -> AsyncSession:
    async with AsyncSession(engine) as session:
        yield session
