-- DropForeignKey
ALTER TABLE "pipeline" DROP CONSTRAINT "pipeline_owner_id_startup_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_assignee_id_startup_id_fkey";

-- AddForeignKey
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_owner_id_startup_id_fkey" FOREIGN KEY ("owner_id", "startup_id") REFERENCES "startup_members"("id", "startup_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_startup_id_fkey" FOREIGN KEY ("assignee_id", "startup_id") REFERENCES "startup_members"("id", "startup_id") ON DELETE NO ACTION ON UPDATE CASCADE;

