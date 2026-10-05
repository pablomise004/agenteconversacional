# Imagen para desplegar Lince en un servidor (Coolify, Docker…). Ver «Ponerlo en un servidor» en el README.
#   docker build -t lince .
#   docker run -d -p 8000:8000 -v lince-datos:/data -e AGENTE_ADMIN_TOKEN=pon-aqui-un-secreto lince
# Los agentes y las conversaciones se guardan en /data: monta ahí un volumen o se perderán al
# volver a desplegar. AGENTE_ADMIN_TOKEN protege la consola (muy recomendable en un servidor público).
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /srv
# versiones exactas (requirements.lock): dos despliegues del mismo commit instalan lo mismo
COPY requirements.lock .
RUN pip install -r requirements.lock
COPY app ./app
COPY web ./web
COPY docs ./docs
COPY examples ./examples
# sin privilegios de administrador; /data es suyo (un volumen nuevo hereda el dueño)
RUN useradd --create-home --uid 1000 lince && mkdir -p /data && chown lince:lince /data
USER lince
ENV AGENTE_DATA_DIR=/data HOST=0.0.0.0 PORT=8000
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/info', timeout=4)"]
CMD ["python", "-m", "app", "--no-browser"]
