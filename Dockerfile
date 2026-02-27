# Use Node.js 18 as base image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package files first (for caching)
COPY package*.json ./

# Install dependencies
RUN --mount=type=cache,id=... npm install


# Copy the rest of the backend code
COPY . .

COPY .env .env


# Expose the port your Express app runs on (default 3000)
EXPOSE 3000

# Run the app
CMD ["npm", "start"]
