import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __betaPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__betaPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__betaPrisma = prisma;
}

export * from "./embedding";
export * from "./retrieval";
export type { PrismaClient } from "@prisma/client";
