# GymAI Agent

Fitness tracking application with FastAPI backend and React TypeScript frontend.

## Setup

### Backend

1. Install dependencies:
```bash
cd backend
pip install -r requirements.txt
```

2. Add Firebase service account JSON file to `backend/firebase-service-account.json`

3. Run the server:
```bash
python main.py
```

Server runs on http://localhost:8000

### Frontend

1. Install dependencies:
```bash
cd frontend
npm install
```

2. Run the development server:
```bash
npm run dev
```

Frontend runs on http://localhost:3000

## Features

- Workout tracking with exercises, splits, and sessions
- Physical activity tracking (steps, activities)
- Nutrition and macro tracking
- Stress level tracking
- Body feelings and wellness surveys

