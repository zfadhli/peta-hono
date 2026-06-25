import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const posts = sqliteTable("posts", {
	id: text("id").primaryKey(),
	title: text("title").notNull(),
	content: text("content").notNull(),
	authorId: text("author_id").notNull(),
	createdAt: text("created_at").notNull(),
});

export const comments = sqliteTable("comments", {
	id: text("id").primaryKey(),
	postId: text("post_id").notNull(),
	content: text("content").notNull(),
	authorId: text("author_id").notNull(),
	createdAt: text("created_at").notNull(),
});
