import { Controller, Post, Param, Body, UseGuards, Req } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';

@Controller('tickets')
@UseGuards(FirebaseAuthGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post(':id/transition')
  transition(
    @Param('id') ticketId: string,
    @Body() body: { newStatus: string; comments?: string },
    @Req() req: any,
  ) {
    return this.ticketsService.transitionStatus(
      ticketId,
      body.newStatus as any,
      req.user.uid,
      req.user.role || 'user',
      body.comments,
    );
  }
}
