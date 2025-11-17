# deps
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN corepack enable && corepack prepare yarn@1.22.22 --activate && yarn install --frozen-lockfile

# build
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build

# run
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json yarn.lock ./
RUN corepack enable && corepack prepare yarn@1.22.22 --activate
EXPOSE 3000
CMD ["yarn","start","-p","3000","-H","0.0.0.0"]
