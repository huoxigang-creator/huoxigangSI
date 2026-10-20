import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const records = sqliteTable('records', {
 id: text('id').primaryKey(), owner: text('owner').notNull(), kind: text('kind').notNull(),
 project: text('project').notNull(), data: text('data').notNull(), created: text('created').notNull(),
});
