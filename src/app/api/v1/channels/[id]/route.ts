import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok } from "@/lib/api";
import { audit } from "@/lib/notify";

/** DELETE /api/v1/channels/[id] — disconnect channel (tenant-isolated). */
export const DELETE = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;

  const channel = await db.youTubeChannel.findUnique({ where: { id } });
  if (!channel) throw new HttpError(404, "Channel not found");
  if (channel.userId !== user.id) throw new HttpError(403, "Not your channel"); // tenant isolation

  await db.youTubeChannel.delete({ where: { id } });
  await audit(user, "channel.disconnect", "youtubeChannel", id);
  return ok({ success: true });
});
