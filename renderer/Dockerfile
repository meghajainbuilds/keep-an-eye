FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY renderer/package*.json ./renderer/
RUN cd renderer && npm ci --omit=dev --ignore-scripts
COPY lib ./lib
COPY renderer ./renderer
USER pwuser
CMD ["node", "renderer/server.mjs"]
