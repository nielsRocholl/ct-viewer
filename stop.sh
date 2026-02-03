#!/bin/bash
# CT Segmentation Viewer - Stop Script

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Stopping CT Segmentation Viewer...${NC}"

# Kill all uvicorn processes
pkill -f "uvicorn.*main:app" 2>/dev/null || true
pkill -f "python.*uvicorn" 2>/dev/null || true

# Kill Next.js processes
pkill -f "next-server" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true

# Kill processes on specific ports
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

sleep 2

echo -e "${GREEN}✓ All services stopped${NC}"
