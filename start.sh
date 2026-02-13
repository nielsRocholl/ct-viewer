#!/bin/bash
# CT Segmentation Viewer - Clean Startup Script
# Ensures only one instance of each service runs

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Function to completely clean processes
clean_processes() {
    print_warning "Cleaning up any existing processes..."
    
    # Kill all uvicorn processes
    pkill -f "uvicorn.*main:app" 2>/dev/null || true
    pkill -f "python.*uvicorn" 2>/dev/null || true
    
    # Kill Next.js processes
    pkill -f "next-server" 2>/dev/null || true
    pkill -f "next dev" 2>/dev/null || true
    
    # Kill processes on specific ports
    lsof -ti:8000 | xargs kill -9 2>/dev/null || true
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    
    # Wait for cleanup
    sleep 2
    
    # Verify cleanup
    if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1; then
        print_error "Port 8000 still in use after cleanup"
        exit 1
    fi
    
    if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
        print_error "Port 3000 still in use after cleanup"
        exit 1
    fi
    
    print_success "All processes cleaned up"
}

# Cleanup on exit
cleanup() {
    print_warning "Shutting down..."
    clean_processes
    exit 0
}

trap cleanup SIGINT SIGTERM

print_status "Starting CT Segmentation Viewer (Clean Mode)..."

# Check directory
if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
    print_error "Please run from project root directory"
    exit 1
fi

# Clean any existing processes
clean_processes

print_status "Starting backend server..."

# Start backend with explicit process management (use venv Python if present)
cd backend
if [ -x "venv/bin/python" ]; then
    nohup venv/bin/python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 > ../backend.log 2>&1 &
elif [ -x ".venv/bin/python" ]; then
    nohup .venv/bin/python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 > ../backend.log 2>&1 &
elif [ -x ".venv-packaging/bin/python" ]; then
    nohup .venv-packaging/bin/python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 > ../backend.log 2>&1 &
else
    nohup python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 > ../backend.log 2>&1 &
fi
BACKEND_PID=$!
cd ..

# Wait and verify backend started
sleep 5
if ! lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    print_error "Backend failed to start"
    cat backend.log | tail -20
    exit 1
fi
print_success "Backend started (PID: $BACKEND_PID)"

print_status "Starting frontend server..."

# Ensure frontend deps are installed
if [ ! -d "frontend/node_modules" ]; then
    print_status "Installing frontend dependencies..."
    (cd frontend && npm install)
fi

# Start frontend
cd frontend
nohup npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..

# Wait for frontend
for i in {1..30}; do
    if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

if ! lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    print_error "Frontend failed to start"
    cat frontend.log | tail -20
    cleanup
    exit 1
fi
print_success "Frontend started (PID: $FRONTEND_PID)"

# Test backend (try multiple endpoints since we don't have /api/health)
if curl -s http://localhost:8000/docs > /dev/null 2>&1; then
    print_success "Backend health check passed"
else
    print_warning "Backend health check failed (but may still be starting)"
fi

print_success "🚀 CT Segmentation Viewer is running!"
echo ""
echo -e "${GREEN}Frontend:${NC} http://localhost:3000"
echo -e "${GREEN}Backend:${NC}  http://localhost:8000"
echo -e "${GREEN}API Docs:${NC} http://localhost:8000/docs"
echo ""
echo -e "${BLUE}Test the viewer:${NC}"
echo "  1. Open http://localhost:3000 in your browser, or"
echo "  2. Run as desktop app (native folder picker): in another terminal run:"
echo "     cd $(pwd) && npm install && npm run electron"
echo ""
print_status "Press Ctrl+C to stop"
echo ""

# Show clean logs (only from our processes)
print_status "Backend logs:"
tail -f backend.log
