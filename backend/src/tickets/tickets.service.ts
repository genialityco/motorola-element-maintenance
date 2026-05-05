import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';

type TicketStatus =
  | 'REPORTADO'
  | 'REVISION'
  | 'EN_REPARACION'
  | 'REPARADO'
  | 'ENTREGADO'
  | 'FINALIZADO';

const VALID_STATUSES: TicketStatus[] = [
  'REPORTADO',
  'REVISION',
  'EN_REPARACION',
  'REPARADO',
  'ENTREGADO',
  'FINALIZADO',
];

@Injectable()
export class TicketsService {
  constructor(private readonly firebase: FirebaseService) {}

  async transitionStatus(
    ticketId: string,
    newStatus: TicketStatus,
    uid: string,
    role: string,
    comments?: string,
  ) {
    if (!VALID_STATUSES.includes(newStatus)) {
      throw new BadRequestException(`Estado inválido: ${newStatus}`);
    }

    const db = this.firebase.db;
    const ticketRef = db.collection('tickets').doc(ticketId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ticketRef);
      if (!snap.exists) throw new NotFoundException('El ticket no existe.');

      const prevStatus = snap.data()?.status;

      tx.update(ticketRef, {
        status: newStatus,
        'timestamps.updatedAt': Date.now(),
      });

      tx.set(ticketRef.collection('statusHistory').doc(), {
        previousStatus: prevStatus,
        newStatus,
        changedBy: { uid, role },
        comments: comments || '',
        timestamp: Date.now(),
      });
    });

    return { success: true, message: 'Ticket actualizado correctamente.' };
  }
}
