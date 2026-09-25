FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    sdcc-ucsim sqlite3 git make gcc bison flex python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Keep the 8051 assembler revision identical to the verified local toolchain.
RUN git clone --quiet https://github.com/ve3wwg/as31.git /tmp/as31 \
    && git -C /tmp/as31 checkout --quiet 53f1a78a1f262a67e1a388c20ec7e8357ac30eaa \
    && python3 -c 'from pathlib import Path; p=Path("/tmp/as31/parser.y"); s=p.read_text(); old="#define bit(a)\t( 1 << ((a)%(sizeof(long)*8)) )"; assert s.count(old)==1; p.write_text(s.replace(old,"#define bit(a)\t( 1UL << ((a)%(sizeof(long)*8)) )"))' \
    && make -C /tmp/as31 as31 \
    && install -m 755 /tmp/as31/as31 /usr/local/bin/ve-as31 \
    && rm -rf /tmp/as31

WORKDIR /app
ENV DATABASE_URL=file:/data/ve.db \
    NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate
COPY . .
RUN npm run build

RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production \
    VE_AS31_PATH=/usr/local/bin/ve-as31 \
    VE_S51_PATH=/usr/bin/s51 \
    SECURE_COOKIES=true
USER node
EXPOSE 3100
CMD ["npm", "run", "start"]
