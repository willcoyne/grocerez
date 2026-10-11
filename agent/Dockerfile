FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv/agent

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY prompts ./prompts

# Non-root. No secrets are baked in: pass env at runtime (compose env_file / --env-file).
RUN useradd --system --uid 10001 --no-create-home agent
USER agent

# Internal only: do not publish this port; the server reaches it at http://agent:8000.
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/health', timeout=2)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
