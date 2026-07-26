import pino from "pino";

export const logger = (pino as any)({
  transport:
    process.env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss"
          }
        }
      : undefined
});