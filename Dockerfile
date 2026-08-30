FROM node:18-slim

RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip curl && \
    pip3 install --break-system-packages --no-cache-dir yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
