import sys
from pathlib import Path

# Add backend directory to Python path so `import app...` works from root
backend_dir = Path(__file__).resolve().parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# Expose the FastAPI application instance for uvicorn main:app
from app.main import app

__all__ = ["app"]
