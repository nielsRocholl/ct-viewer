#!/bin/bash

echo "Setting up CT Segmentation Viewer..."

# Setup backend
echo ""
echo "Setting up backend..."
cd backend

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment and install dependencies
echo "Installing backend dependencies..."
source venv/bin/activate
pip install -q -r requirements.txt
deactivate

# Create environment file
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✓ Created backend/.env"
fi

cd ..

# Setup frontend
echo ""
echo "Setting up frontend..."
cd frontend

# Install dependencies
echo "Installing frontend dependencies..."
npm install

# Create environment file
if [ ! -f .env.local ]; then
    cp .env.local.example .env.local
    echo "✓ Created frontend/.env.local"
fi

cd ..

echo ""
echo "✓ Setup complete!"
echo ""
echo "To start development:"
echo "  Backend:  cd backend && source venv/bin/activate && uvicorn main:app --reload"
echo "  Frontend: cd frontend && npm run dev"
echo ""
echo "Services will be available at:"
echo "  Frontend: http://localhost:3000"
echo "  Backend API: http://localhost:8000"
echo "  API Docs: http://localhost:8000/docs"

