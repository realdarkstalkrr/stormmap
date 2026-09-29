# StormMap — pure-stdlib Python server, no pip dependencies.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    STORMMAP_HOST=0.0.0.0 \
    STORMMAP_PORT=8000 \
    STORMMAP_CACHE_DIR=/data

WORKDIR /app
COPY server.py ./
COPY stormmap ./stormmap
COPY static ./static

RUN useradd --system --uid 10001 --home /app stormmap \
 && mkdir -p /data && chown stormmap /data
USER stormmap
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/api/health' % (os.environ.get('STORMMAP_PORT') or os.environ.get('PORT') or '8000'), timeout=4)"

CMD ["python", "server.py"]
