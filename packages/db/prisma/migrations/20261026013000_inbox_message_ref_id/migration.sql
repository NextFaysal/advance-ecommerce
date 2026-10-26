-- Doc 22 ADV-6 (doc 21 G3-10 remainder): PRODUCT_CARD / ORDER_CARD
-- refs on inbox messages.
--
-- InboxMessage carried the card target only in the TS type
-- (InboxMessage.refId): the schema had no column, so a product/order
-- card arriving on a channel lost its target id at ingest and the
-- inbox conversion panel could never pre-fill from a DB-backed
-- conversation (Conversation.productRefId derives from the first
-- PRODUCT_CARD message's refId in src/inbox/store.ts).
-- Nullable: TEXT / IMAGE / SYSTEM messages carry no ref.

-- AlterTable
ALTER TABLE "InboxMessage" ADD COLUMN "refId" TEXT;
