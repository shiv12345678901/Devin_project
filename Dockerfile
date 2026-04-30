FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM mcr.microsoft.com/playwright/python:v1.40.0-jammy

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PORT=7860 \
    HOST=0.0.0.0 \
    ALLOW_PUBLIC_BIND=1 \
    USE_POWERPOINT=0

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY --from=frontend-builder /app/frontend/dist frontend/dist

RUN cp backend/config/config.example.py backend/config/config.py \
    && mkdir -p backend/output/screenshots backend/output/html backend/output/presentations backend/output/videos

WORKDIR /app/backend
EXPOSE 7860

CMD ["gunicorn", "--bind", "0.0.0.0:7860", "--timeout", "300", "--workers", "1", "app:app"]
