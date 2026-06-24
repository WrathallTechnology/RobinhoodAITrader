#!/bin/bash
echo "=== Service Status ==="
sudo systemctl status aitrader --no-pager -l
echo ""
echo "=== Recent Logs ==="
sudo journalctl -u aitrader -n 50 --no-pager
