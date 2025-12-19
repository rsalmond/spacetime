FROM node:23.0.0-slim

RUN npm i -g @openai/codex
RUN apt update && apt install vim iproute2 curl -y
