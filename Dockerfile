FROM node:18-slim

RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip curl && \
    rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Install requests for HTTPS proxy support
RUN pip3 install --break-system-packages requests

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
