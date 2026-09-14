import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
export { PrismaClient };
export type * from "@prisma/client";
