#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="aitrader"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
VENV="$SCRIPT_DIR/backend/.venv"
USER="$(whoami)"

echo "=== RobinHood AI Trader ==="

# Create .env from example if it doesn't exist
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo ""
    echo "Created .env — please edit it and set SECRET_KEY and CALLBACK_BASE_URL."
    echo "Then run this script again."
    exit 1
fi

# Build frontend into backend/static if not already done
if [ ! -d "$SCRIPT_DIR/backend/static" ]; then
    echo "Building frontend (requires Node.js)..."
    cd "$SCRIPT_DIR/frontend"
    npm install
    npm run build
    echo "Frontend built."
fi

# Set up Python virtual environment if needed
if [ ! -d "$VENV" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv "$VENV"
fi

echo "Installing Python dependencies..."
"$VENV/bin/pip" install -q -r "$SCRIPT_DIR/backend/requirements.txt"

# Install or update the systemd service
echo "Installing systemd service..."
sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=RobinHood AI Trader
After=network.target

[Service]
User=$USER
WorkingDirectory=$SCRIPT_DIR/backend
ExecStart=$VENV/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=on-failure
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME" --quiet

# Restart if already running, otherwise start
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "Restarting service..."
    sudo systemctl restart "$SERVICE_NAME"
else
    echo "Starting service..."
    sudo systemctl start "$SERVICE_NAME"
fi

sleep 1
sudo systemctl status "$SERVICE_NAME" --no-pager -l
echo ""
echo "Server is running. Logs: sudo journalctl -u $SERVICE_NAME -f"
