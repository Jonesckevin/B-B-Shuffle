# ---------------------------------------------------------------------------
# B&B Shuffle - self-hosted Player/Admin/library front-end plus the stdlib-only
# Python API.
#
# The app is plain HTML/CSS/JS with no bundler. `tools/minify.py` strips every
# comment and compacts the text assets, and the runtime image receives only its
# output - so the published container never serves source comments, indentation
# or pretty-printed JSON. The minifier also runs `node --check` on every script,
# so a broken strip fails the build instead of shipping.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Stage 1: comment-free web root.
# ---------------------------------------------------------------------------
FROM alpine:3.20 AS webroot

RUN apk add --no-cache python3 nodejs

WORKDIR /app
COPY . /app/
RUN python3 tools/minify.py /app /webroot


# ---------------------------------------------------------------------------
# Stage 2: runtime image.
# ---------------------------------------------------------------------------
FROM nginx:alpine

# Runtime dependencies only (see the notes below before adding more):
#   bash            - /start.sh shebang; the health-wait loop uses {1..30}
#   curl            - start.sh health-wait and the HEALTHCHECK below
#   python3         - api_server.py (standard library only - no pip required)
#   ca-certificates - TLS roots for the API server's outbound AI-provider calls
#
# Removed debug tooling: htop, procps, net-tools, wget, nano, vim, git,
# docker-cli, openssh-client, py3-pip. Busybox already provides vi, wget, ps,
# top, ifconfig and netstat inside the container, so basic shell debugging
# still works - only git/docker/ssh and the bigger editors are gone.
RUN apk add --no-cache \
    bash \
    curl \
    python3 \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# Create data directories
RUN mkdir -p /usr/share/nginx/html/data/{uploads,logs}

# Web root from the builder stage: comments stripped, text assets compacted.
COPY --from=webroot /webroot/ /usr/share/nginx/html/

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Set working directory
WORKDIR /usr/share/nginx/html

# Create a startup script that enables both nginx and the API server
RUN echo '#!/bin/bash' > /start.sh && \
    echo 'set -e' >> /start.sh && \
    echo 'cd /usr/share/nginx/html' >> /start.sh && \
    echo 'echo "Starting B&B Shuffle API server..."' >> /start.sh && \
    echo 'python3 api_server.py 8001 &' >> /start.sh && \
    echo 'API_PID=$!' >> /start.sh && \
    echo 'echo "Waiting for API server to be ready..."' >> /start.sh && \
    echo 'for i in {1..30}; do' >> /start.sh && \
    echo '  if curl -f http://127.0.0.1:8001/api/health >/dev/null 2>&1; then' >> /start.sh && \
    echo '    echo "API server is ready!"' >> /start.sh && \
    echo '    break' >> /start.sh && \
    echo '  fi' >> /start.sh && \
    echo '  echo "Waiting for API server... ($i/30)"' >> /start.sh && \
    echo '  sleep 1' >> /start.sh && \
    echo 'done' >> /start.sh && \
    echo 'echo "Starting Nginx..."' >> /start.sh && \
    echo 'nginx -g "daemon off;" &' >> /start.sh && \
    echo 'NGINX_PID=$!' >> /start.sh && \
    echo 'echo "Both services started successfully"' >> /start.sh && \
    echo 'wait $API_PID $NGINX_PID' >> /start.sh && \
    chmod +x /start.sh

# Expose port 80 for nginx and 8001 for the API server
EXPOSE 80 8001

# Set bash as default shell for better debugging experience
ENV SHELL=/bin/bash

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost/api/health || exit 1

# Start both nginx and API server using the startup script
CMD ["/start.sh"]

## Build and Run Instructions
# To build the Docker image, run:
# docker compose build && docker compose up -d
