export type Role = 'admin' | 'host' | 'client' | 'workshop' | 'transporter';

export interface User {
  id: string;
  name: string;
  phone: string;
  role: Role;
}

export type TicketStatus = 
  | 'REPORTADO' 
  | 'REVISION' 
  | 'EN_REPARACION' 
  | 'REPARADO' 
  | 'ENTREGADO'
  | 'FINALIZADO';

export interface Ticket {
  id: string;
  ticketNumber: string;
  point: {
    id: string;
    name: string;
  };
  reporter: {
    phone: string;
    name: string;
  };
  novelty: {
    type: string;
    description: string;
  };
  status: TicketStatus;
  actors: {
    workshopId?: string;
    transporterId?: string;
  };
  budget: {
    estimatedValue?: number;
    approved?: boolean;
  };
  photos: {
    evidence: string[];
    repair: string[];
    delivery: string[];
  };
  timestamps: {
    createdAt: number;
    updatedAt: number;
  };
}
