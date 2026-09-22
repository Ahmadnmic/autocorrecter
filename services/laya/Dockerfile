# Laya decision service. CPU image; for a GPU host swap the base for an nvidia/cuda runtime and set LAYA_DEVICE=cuda.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 HF_HOME=/models
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
# Bake the checkpoint into the image so a cold container answers immediately.
ARG LAYA_MODEL=multilingual
ENV LAYA_MODEL=${LAYA_MODEL}
RUN python -c "import laya, os; m=os.environ['LAYA_MODEL']; laya.load('convaiinnovations/laya') if m in ('english','root') else laya.load('convaiinnovations/laya', subfolder=m)"
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fs http://localhost:8080/health || exit 1
EXPOSE 8080
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
