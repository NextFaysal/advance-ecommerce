-- Doc 21 G3-10 (wave W0-D schema; W0-E wires store/UI): staff read
-- marker for inbox conversations.
--
-- unreadCount in src/inbox/store.ts is derived as "count of INBOUND
-- messages" because the schema had no read marker — opening a
-- conversation could never mark it read, so unread counts never
-- cleared. lastReadAt is the marker: W0-E stamps it when staff open
-- a conversation and derives unread from messages newer than it.
-- Nullable: existing conversations have never been "read" under the
-- new rule (NULL = nothing read yet).

-- AlterTable
ALTER TABLE "InboxConversation" ADD COLUMN "lastReadAt" TIMESTAMP(3);
