@echo off
REM RobinHood AI Trader — one-click start (Python only, no Docker needed)
REM Requirements: Python 3.11+

echo === RobinHood AI Trader ===

REM Create .env from example if it doesn't exist
if not exist .env (
    echo Creating .env from .env.example...
    copy .env.example .env
    echo.
    echo IMPORTANT: Edit .env and set your SECRET_KEY before continuing.
    echo            Press any key once you have done that, or Ctrl+C to cancel.
    pause
)

REM Set up virtual environment if needed
if not exist backend\.venv (
    echo Creating Python virtual environment...
    python -m venv backend\.venv
)

echo Installing dependencies...
call backend\.venv\Scripts\pip install -q -r backend\requirements.txt

echo.
echo Starting server at http://localhost:8000
echo Press Ctrl+C to stop.
echo.

set PYTHONPATH=backend
call backend\.venv\Scripts\uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000
