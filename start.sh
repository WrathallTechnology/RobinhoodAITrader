#!/bin/bash
set -e

echo "=== RobinHood AI Trader ==="

# Create .env from example if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo ""
    echo "Created .env — please edit it now and set SECRET_KEY and CALLBACK_BASE_URL."
    echo "Then run this script again."
    exit 1
fi

# Build frontend into backend/static if not already done
if [ ! -d backend/static ]; then
    echo "Building frontend (requires Node.js)..."
    cd frontend
    npm install
    npm run build
    cd ..
    cp -r frontend/dist backend/static
    echo "Frontend built."
fi

# Set up Python virtual environment if needed
if [ ! -d backend/.venv ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv backend/.venv
fi

echo "Installing Python dependencies..."
backend/.venv/bin/pip install -q -r backend/requirements.txt

echo ""
echo "Starting server at http://0.0.0.0:8000"
echo "Press Ctrl+C to stop."
echo ""

cd backend
../.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 2>/dev/null || \
    .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
