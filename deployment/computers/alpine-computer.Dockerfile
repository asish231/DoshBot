FROM oven/bun:1.3.14-alpine

ENV BUN_INSTALL=/usr/local
ENV PATH="/usr/local/bin:${PATH}"
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY deployment/computers/cache-apks /tmp/cache-apks
RUN ARCH="$(apk --print-arch)" && \
    if [ "$ARCH" = "aarch64" ] && [ -d /tmp/cache-apks ] && [ "$(ls -A /tmp/cache-apks/*.apk 2>/dev/null)" ]; then \
      apk add --no-cache --allow-untrusted /tmp/cache-apks/*.apk; \
    else \
      apk add --no-cache chromium bash; \
    fi && \
    apk add --no-cache font-wqy-zenhei font-noto-cjk font-noto-arabic && \
    rm -rf /tmp/cache-apks

# Symlink system chromium so Playwright detects it under its expected paths
RUN for dir in chromium-1155 chromium-1234 chromium-1240 chromium; do \
      mkdir -p /ms-playwright/$dir/chrome-linux && \
      ln -sf /usr/bin/chromium-browser /ms-playwright/$dir/chrome-linux/chrome; \
    done

WORKDIR /app
COPY deployment/computers/agent-computer/package.json deployment/computers/agent-computer/bun.lock ./
RUN bun install --frozen-lockfile

COPY deployment/computers/agent-computer/src ./src

RUN mkdir -p /workspace
ENV WORKSPACE_DIR=/workspace

ENV PORT=4100
EXPOSE 4100

HEALTHCHECK --interval=2s --timeout=3s --start-period=2s --retries=30 \
  CMD bun -e "const r = await fetch('http://localhost:4100/health'); process.exit(r.ok ? 0 : 1)"

CMD ["bun", "src/index.ts"]
