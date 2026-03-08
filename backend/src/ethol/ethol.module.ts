import { Module } from '@nestjs/common';
import { EtholController } from './ethol.controller';
import { EtholService } from './ethol.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EtholController],
  providers: [EtholService],
  exports: [EtholService],
})
export class EtholModule {}
