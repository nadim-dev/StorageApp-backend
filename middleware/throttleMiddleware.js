import redisClient from "../config/redis.js";

export default function throttle({
  waitTime = 1000,
  allowed = 2,
  windowMs = 60 * 1000,
  routeName = "default",
  maxDelay = 3000,
  blockThreshold = 5000,
} = {}) {
  return async (req, res, next) => {
    const key = `throttle:${req.user?._id || req.ip}:${routeName}`;
    const now = Date.now();

    let data;

    try {
      const raw = await redisClient.get(key);
      data = raw
        ? JSON.parse(raw)
        : { previousDelay: 0, lastRequestTime: now, count: 0 };
    } catch {
      data = { previousDelay: 0, lastRequestTime: now, count: 0 };
    }

    let { previousDelay, lastRequestTime, count } = data;

    if (now - lastRequestTime > windowMs) {
      count = 0;
      previousDelay = 0;
    }

    count += 1;

    let delay = 0;

    if (count > allowed) {
      const timePassed = now - lastRequestTime;
      delay = Math.max(0, waitTime + previousDelay - timePassed);
      delay = Math.min(delay, maxDelay);

      if (delay >= blockThreshold) {
        return res.status(429).json({
          message: "Too many requests. Please try again later.",
        });
      }
    }

    const newData = {
      previousDelay: delay,
      lastRequestTime: now,
      count,
    };

    await redisClient.set(key, JSON.stringify(newData), {
      EX: Math.ceil(windowMs / 1000),
    });

    if (delay > 0) {
      return setTimeout(next, delay);
    }

    next();
  };
}
