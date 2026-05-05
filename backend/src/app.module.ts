import { Module } from '@nestjs/common';
import { FirebaseModule } from './firebase/firebase.module';
import { TicketsModule } from './tickets/tickets.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [FirebaseModule, TicketsModule, WhatsappModule],
})
export class AppModule {}
