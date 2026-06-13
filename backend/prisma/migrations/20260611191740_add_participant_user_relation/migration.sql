-- AddForeignKey
ALTER TABLE "arena_participants" ADD CONSTRAINT "arena_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
