# Imagen para desplegar Lince en un servidor:
#   docker build -t agente .
#   docker run -p 8000:8000 -v agente-datos:/data -e AGENTE_ADMIN_TOKEN=cambia-esto agente
FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY web ./web
COPY docs ./docs
COPY examples ./examples
ENV AGENTE_DATA_DIR=/data HOST=0.0.0.0 PORT=8000 PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8000
CMD ["python", "-m", "app", "--no-browser"]
