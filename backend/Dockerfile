FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
# Some networks (e.g. the Azure lab sandbox) silently drop the larger post-quantum TLS
# ClientHello that OpenSSL 3.5 sends by default, so HTTPS to PyPI hangs at the handshake.
# Use classic key exchange for the package install only; runtime TLS keeps the defaults.
RUN printf 'openssl_conf = c\n[c]\nssl_conf = s\n[s]\nsystem_default = d\n[d]\nGroups = X25519:P-256:P-384\n' > /tmp/pip-tls.cnf \
 && OPENSSL_CONF=/tmp/pip-tls.cnf pip install --no-cache-dir -r requirements.txt \
 && rm /tmp/pip-tls.cnf

COPY . .

EXPOSE 8000
# Apply migrations, then serve. --proxy-headers: trust X-Forwarded-* from the Azure ingress (HTTPS URLs).
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
