FROM node:24

WORKDIR /app
COPY package.json package-lock.json ./
COPY src ./src
COPY specs ./specs
RUN git clone https://github.com/specmatic-demo/central-contract-repository /app/.specmatic/repos/central-contract-repository
RUN git clone https://github.com/specmatic-demo/pricing-service /app/.specmatic/repos/pricing-service
RUN npm install
EXPOSE 4000
CMD ["npm", "run", "start"]
