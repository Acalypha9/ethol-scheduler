import { Module, forwardRef } from '@nestjs/common';
import { EtholModule } from '../ethol/ethol.module';
import { SyncService } from './sync.service';

@Module({
  imports: [forwardRef(() => EtholModule)],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
