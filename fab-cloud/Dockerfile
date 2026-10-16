FROM node:22-bookworm-slim
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates python3 dbus-x11 gnome-keyring libsecret-1-0 libgtk-3-0 libwebkit2gtk-4.1-0 libsoup-3.0-0 && rm -rf /var/lib/apt/lists/*
ADD https://github.com/zirklerite/FabCLI/releases/download/v0.1.0/fabcli-v0.1.0-linux64.tar.gz /tmp/fabcli-v0.1.0-linux64.tar.gz
ADD https://github.com/zirklerite/FabCLI/releases/download/v0.1.0/SHA256SUMS.txt /tmp/SHA256SUMS.txt
RUN cd /tmp && sha256sum --check --ignore-missing SHA256SUMS.txt && tar -xzf fabcli-v0.1.0-linux64.tar.gz && find /tmp -name fabcli -type f -exec cp '{}' /usr/local/bin/fabcli \; && chmod +x /usr/local/bin/fabcli && fabcli --version && rm -f /tmp/fabcli-v0.1.0-linux64.tar.gz /tmp/SHA256SUMS.txt
WORKDIR /app
COPY fab-cloud/ /app/fab-cloud/
COPY tools/fab-bridge.cjs /app/tools/fab-bridge.cjs
RUN useradd -m -u 10001 sketchbook && chown -R sketchbook:sketchbook /app
USER sketchbook
ENV HOME=/home/sketchbook
EXPOSE 10000
CMD ["sh","/app/fab-cloud/start.sh"]
