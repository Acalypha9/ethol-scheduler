import { Module, forwardRef } from '@nestjs/common';
import { EtholController } from './ethol.controller';
import { EtholService } from './ethol.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [PrismaModule, forwardRef(() => SyncModule)],
  controllers: [EtholController],
  providers: [EtholService],
  exports: [EtholService],
})
export class EtholModule {}
