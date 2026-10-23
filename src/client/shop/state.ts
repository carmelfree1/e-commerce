import type { PublicProduct } from '../../shared/types';

export const store = {
  products: [] as PublicProduct[],
  cat: 'Tous',
  cart: {} as Record<number, number>,
};

try {
  const raw = JSON.parse(localStorage.getItem('ccm-cart') || '{}') as Record<string, number>;
  for (const [k, v] of Object.entries(raw)) if (Number.isInteger(v) && v > 0) store.cart[Number(k)] = v;
} catch { /* panier illisible : on repart de zéro */ }

export const saveCart = (): void => {
  try { localStorage.setItem('ccm-cart', JSON.stringify(store.cart)); } catch { /* stockage indisponible */ }
};

export const findProduct = (id: number): PublicProduct | undefined => store.products.find((p) => p.id === id);
