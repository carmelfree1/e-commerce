export const ORDER_STATUSES = ['en_attente', 'confirmee', 'en_livraison', 'livree', 'annulee'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  en_attente: 'En attente',
  confirmee: 'Confirmée',
  en_livraison: 'En livraison',
  livree: 'Livrée',
  annulee: 'Annulée',
};

export const PRODUCT_KINDS = ['produit', 'medicament'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export const KIND_LABEL: Record<ProductKind, string> = {
  produit: 'Produit bio',
  medicament: 'Médicament traditionnel',
};
export const MIN_USAGE_LENGTH = 10;

/** Seuil à partir duquel un stock est considéré comme bas. */
export const LOW_STOCK = 5;

export interface PublicProduct {
  id: number;
  name: string;
  description: string;
  price: number;
  category: string;
  image: string;
  stock: number;
  kind: ProductKind;
  /** Mode d'emploi (obligatoire pour un médicament traditionnel). */
  usage: string;
}

export interface AdminProduct extends PublicProduct {
  active: boolean;
  createdAt: string;
}

export interface ProductInput {
  name: string;
  description: string;
  price: number | string;
  category: string;
  image: string;
  stock: number | string;
  kind: ProductKind;
  usage: string;
  active: boolean;
}

export interface OrderLine {
  name: string;
  price: number;
  qty: number;
  /** Photo du produit au moment de la commande (peut être vide). */
  image?: string;
}

export interface AdminOrder {
  id: number;
  code: string;
  customerName: string;
  phone: string;
  address: string;
  note: string;
  total: number;
  status: OrderStatus;
  createdAt: string;
  items: OrderLine[];
}

export interface TrackedOrder {
  code: string;
  status: OrderStatus;
  statusLabel: string;
  total: number;
  createdAt: string;
  items: OrderLine[];
}

export interface PushSubscriptionJSON {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

export interface CheckoutPayload {
  name: string;
  phone: string;
  address: string;
  note: string;
  items: { id: number; qty: number }[];
  subscription: PushSubscriptionJSON | null;
}

export interface DayStat { day: string; revenue: number; orders: number }

export interface Stats {
  pending: number;
  orders: number;
  products: number;
  revenue: number;
  todayOrders: number;
  todayRevenue: number;
  daily: DayStat[];
  byStatus: Record<OrderStatus, number>;
  top: { name: string; qty: number }[];
  lowStock: { id: number; name: string; stock: number }[];
  recent: AdminOrder[];
}
