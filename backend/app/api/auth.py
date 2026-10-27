from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database.session import get_db
from app.database.models import User
from app.auth.security import hash_password, verify_password, create_access_token
from app.auth.dependencies import get_current_user

router = APIRouter(prefix="/auth", tags=["Authentication"])

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, description="Unique account username")
    password: str = Field(..., min_length=6, description="Account password (min 6 chars)")

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, description="Account username")
    password: str = Field(..., min_length=1, description="Account password")

class UserInfo(BaseModel):
    id: str
    username: str
    role: str

class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserInfo

@router.post("/register", response_model=AuthResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    clean_username = req.username.strip()
    if len(clean_username) < 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username must be at least 3 characters"
        )

    # Enforce case-insensitive uniqueness check
    existing = await db.execute(
        select(User).where(func.lower(User.username) == clean_username.lower())
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username is already registered. Please choose another."
        )

    hashed = hash_password(req.password)
    user = User(
        username=clean_username,
        password_hash=hashed,
        role="user"
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token({"sub": user.id, "username": user.username, "role": user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role
        }
    }

@router.post("/login", response_model=AuthResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    clean_username = req.username.strip()
    result = await db.execute(
        select(User).where(func.lower(User.username) == clean_username.lower())
    )
    user = result.scalar_one_or_none()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )

    token = create_access_token({"sub": user.id, "username": user.username, "role": user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role
        }
    }

@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "created_at": user.created_at.isoformat()
    }
