FROM node:18-slim

RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip curl unzip && \
    rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp binary from GitHub
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Install Deno (optional but helpful)
RUN curl -fsSL https://deno.land/install.sh | sh
ENV PATH="/root/.deno/bin:${PATH}"

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
