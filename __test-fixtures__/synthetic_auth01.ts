// Synthetic AUTH-01-service-layer trigger: exported handler reads by id
// without a scope filter (no userId / orgId / tenantId in the where clause).
// Should fire AUTH-01-service-layer (warning) per the calibrated rubric.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function getOrder(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
  });
}
