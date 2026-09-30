export type VehicleType = 'auto' | 'moto' | 'bici';
/** G = general, M = membresías (espacios fijos), B = bicicletas */
export type Zone = 'G' | 'M' | 'B';
export type PlanId = 'basico' | 'plus' | 'corporativo';
export type SessionKind = 'hourly' | 'night' | 'member' | 'bike';

export interface Space { id: string; label: string; type: VehicleType; zone: Zone }
export interface User { id: string; name: string; email: string; passHash: string; role: 'user' | 'admin' }
export interface Membership {
  id: string; userId: string; plan: PlanId; billing: 'mensual' | 'anual';
  price: number; plates: string[]; spaceIds: string[]; startedAt: string; expiresAt: string;
}
export interface Extension { at: string; minutes: number; amount: number }
export interface Session {
  id: string;
  code: string;               // contenido del QR / folio del ticket
  spaceId: string;
  type: VehicleType;
  plate: string;              // placa (o folio de tarjeta de movilidad en bicicletas)
  kind: SessionKind;
  userId: string | null;      // null = ticket sin cuenta
  membershipId: string | null;
  soldBy: string | null;      // id del admin si se vendió en ventanilla
  startAt: string;
  paidUntil: string | null;   // null en membresías (sin límite)
  paid: number;               // MXN pagados por adelantado (incluye extensiones)
  extensions: Extension[];
  status: 'active' | 'closed';
  exitAt: string | null;
  overdueCharge: number;      // cobro por exceso de tiempo al salir
}
export interface DB {
  meta: { clockOffsetMs: number; tokens: Record<string, string> };
  spaces: Space[]; users: User[]; memberships: Membership[]; sessions: Session[];
}
