import { Module } from '@nestjs/common';
import { EtholModule } from '../ethol/ethol.module';
import { SyncService } from './sync.service';

@Module({
  imports: [EtholModule],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
