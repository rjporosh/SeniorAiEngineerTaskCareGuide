-- Full-text search and pgvector support (not expressible in the Prisma schema).
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "text_chunks" ADD COLUMN "embedding" vector(256);
ALTER TABLE "text_chunks" ADD COLUMN "tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', "content")) STORED;

CREATE INDEX "text_chunks_tsv_idx" ON "text_chunks" USING GIN ("tsv");
CREATE INDEX "text_chunks_embedding_idx" ON "text_chunks" USING hnsw ("embedding" vector_cosine_ops);
