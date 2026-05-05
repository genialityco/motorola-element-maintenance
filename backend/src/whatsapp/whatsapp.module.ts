import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';

@Module({
  controllers: [WhatsappController],
  providers: [WhatsappService, FirebaseAuthGuard],
})
export class WhatsappModule {}
