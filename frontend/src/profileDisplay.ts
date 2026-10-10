import type { User } from './types';

export function profileInitial(user: Pick<User, 'display_name' | 'email'>): string {
  const source = user.display_name.trim() || user.email.trim();
  return (source[0] ?? '?').toUpperCase();
}

export function formatMemberSince(createdAt: string): string | null {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}
