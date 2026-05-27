import { createClient } from "redis";

const redisClient = createClient({
  username: process.env.REDIS_USERNAME || "default",
  password: process.env.REDIS_PASSWORD,
});

redisClient.on("error", (err) => {
  console.log("Redis client error", err);
  process.exit(1);
});

await redisClient.connect();

export default redisClient;
