import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { Readable } from "stream";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler } from "@/lib/api";
import { audit } from "@/lib/notify";
import { urlToAbs } from "@/lib/storage";

/** GET|POST /api/v1/videos/[id]/download — stream the rendered MP4. (UI links use GET → previously 405.) */
const download = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const video = await db.video.findUnique({ where: { id } });
  if (!video || video.userId !== user.id) throw new HttpError(404, "Video not found");
  if (!video.videoUrl) throw new HttpError(400, "Video not rendered yet");

  const abs = urlToAbs(video.videoUrl);
  if (!fs.existsSync(abs)) throw new HttpError(410, "Video file missing from storage");

  await audit(user, "video.download", "video", id);
  const stream = Readable.toWeb(fs.createReadStream(abs)) as unknown as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="shortspilot_${video.id}.mp4"`,
    },
  });
});

export const GET = download;
export const POST = download;
