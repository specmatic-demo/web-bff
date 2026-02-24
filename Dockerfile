FROM node:24

WORKDIR /app
COPY package.json package-lock.json ./
COPY src ./src
RUN git clone https://github.com/specmatic-demo/central-contract-repository .specmatic/repos/central-contract-repository
RUN npm install
EXPOSE 4000
CMD ["npm", "run", "start"]
