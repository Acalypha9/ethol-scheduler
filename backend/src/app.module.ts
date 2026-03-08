import { Module } from '@nestjs/common';
import { EtholModule } from './ethol/ethol.module';
import { NotificationModule } from './notification/notification.module';
import { PrismaModule } from './prisma/prisma.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [PrismaModule, EtholModule, NotificationModule, SyncModule],
})
export class AppModule {}
