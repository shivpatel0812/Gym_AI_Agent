# Docker Setup for GymAI Backend

## Quick Start

### Build and run with Docker Compose (Recommended for local development)
```bash
cd backend
docker-compose up --build
```

The API will be available at `http://localhost:8000`

### Build and run with Docker directly
```bash
cd backend
docker build -t gymai-backend .
docker run -p 8000:8000 \
  -e CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8081 \
  -e GOOGLE_APPLICATION_CREDENTIALS=/app/firebase-service-account.json \
  -v $(pwd)/firebase-service-account.json:/app/firebase-service-account.json:ro \
  gymai-backend
```

## Environment Variables

Set these in your `.env` file or as environment variables:

- `PORT`: Server port (default: 8000)
- `CORS_ALLOWED_ORIGINS`: Comma-separated list of allowed origins
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to Firebase service account JSON file

## Deployment

### Railway
1. Connect your GitHub repo
2. Set root directory to `backend/`
3. Railway will auto-detect Dockerfile
4. Add environment variables in Railway dashboard

### Fly.io
1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Run `fly launch` in the `backend/` directory
3. Follow prompts to configure
4. Deploy with `fly deploy`

## Notes

- The Firebase service account file is mounted as read-only in docker-compose
- For production, you may want to use environment variables instead of mounting files
- The Dockerfile uses Python 3.11 slim image for smaller size

