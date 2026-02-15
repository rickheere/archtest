import { db } from '~/lib/db';
import { config } from '@/config';

export function Layout() {
  return db.query(config.table);
}
