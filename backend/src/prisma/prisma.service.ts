import 'dotenv/config';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';

const { Pool } = require('pg') as { Pool: new (config: Record<string, unknown>) => unknown };

const DEFAULT_RDS_CA_PATH = '/etc/ssl/certs/aws-rds-global-bundle.pem';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL is not set for PrismaService');
    }

    const caPath = process.env.DATABASE_SSL_CA_PATH || DEFAULT_RDS_CA_PATH;
    const acceptInvalidCerts =
      String(process.env.DATABASE_SSL_ACCEPT_INVALID_CERTS || '')
        .trim()
        .toLowerCase() === 'true';

    const pool = new Pool({
      connectionString,
      ssl: fs.existsSync(caPath)
        ? {
            ca: fs.readFileSync(caPath, 'utf-8'),
            rejectUnauthorized: true,
          }
        : acceptInvalidCerts
          ? { rejectUnauthorized: false }
          : undefined,
    });

    const adapter = new PrismaPg(pool, { disposeExternalPool: true });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
