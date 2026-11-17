import { z } from "zod";

/**
 * Zod schemas for the YouTube Data API v3 resources MOS consumes.
 * Unknown fields are stripped (zod default), so additive upstream changes do
 * not break parsing; every field MOS relies on is explicit here.
 *
 * Field facts (developers.google.com/youtube/v3/docs):
 * - counts arrive as strings ("viewCount": "1024"); likeCount/commentCount
 *   can be absent when hidden by the channel;
 * - durations are ISO 8601 ("PT4M13S");
 * - liveBroadcastContent: "none" | "live" | "upcoming" | "completed".
 */

const isoDateTime = z.string().min(1);

export const videoResourceSchema = z.object({
  id: z.string().min(1),
  snippet: z.object({
    title: z.string(),
    channelId: z.string().min(1),
    channelTitle: z.string().optional(),
    publishedAt: isoDateTime,
    categoryId: z.string().optional(),
    tags: z.array(z.string()).optional(),
    liveBroadcastContent: z.enum(["none", "live", "upcoming", "completed"]).optional(),
    defaultAudioLanguage: z.string().optional(),
  }),
  statistics: z
    .object({
      viewCount: z.string().optional(),
      likeCount: z.string().optional(),
      commentCount: z.string().optional(),
    })
    .optional(),
  contentDetails: z
    .object({
      duration: z.string().optional(),
    })
    .optional(),
});

export const videoListResponseSchema = z.object({
  items: z.array(videoResourceSchema),
  pageInfo: z.object({ totalResults: z.number().optional(), resultsPerPage: z.number().optional() }).optional(),
  nextPageToken: z.string().optional(),
});

export const searchResultSchema = z.object({
  id: z.object({ videoId: z.string().min(1) }),
  snippet: z.object({
    title: z.string(),
    channelId: z.string().min(1),
    channelTitle: z.string().optional(),
    publishedAt: isoDateTime,
    liveBroadcastContent: z.enum(["none", "live", "upcoming", "completed"]).optional(),
  }),
});

export const searchListResponseSchema = z.object({
  items: z.array(searchResultSchema),
  nextPageToken: z.string().optional(),
  pageInfo: z.object({ totalResults: z.number().optional(), resultsPerPage: z.number().optional() }).optional(),
});

export const channelResourceSchema = z.object({
  id: z.string().min(1),
  snippet: z
    .object({
      title: z.string(),
      customUrl: z.string().optional(),
      publishedAt: isoDateTime.optional(),
      country: z.string().optional(),
    })
    .optional(),
  statistics: z
    .object({
      viewCount: z.string().optional(),
      subscriberCount: z.string().optional(),
      hiddenSubscriberCount: z.boolean().optional(),
      videoCount: z.string().optional(),
    })
    .optional(),
  contentDetails: z
    .object({
      relatedPlaylists: z.object({ uploads: z.string().optional() }).optional(),
    })
    .optional(),
});

export const channelListResponseSchema = z.object({
  items: z.array(channelResourceSchema),
  pageInfo: z.object({ totalResults: z.number().optional(), resultsPerPage: z.number().optional() }).optional(),
});

export const playlistItemResourceSchema = z.object({
  snippet: z.object({
    publishedAt: isoDateTime.optional(),
    channelId: z.string().min(1),
    title: z.string().optional(),
    resourceId: z.object({ videoId: z.string().min(1) }),
    videoOwnerChannelTitle: z.string().optional(),
  }),
});

export const playlistItemListResponseSchema = z.object({
  items: z.array(playlistItemResourceSchema),
  nextPageToken: z.string().optional(),
  pageInfo: z.object({ totalResults: z.number().optional(), resultsPerPage: z.number().optional() }).optional(),
});

/** Google API error envelope, shared by Data API and OAuth endpoints. */
export const googleErrorSchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    status: z.string().optional(),
    errors: z
      .array(z.object({ reason: z.string().optional(), message: z.string().optional(), domain: z.string().optional() }))
      .optional(),
  }),
});

export type VideoResource = z.infer<typeof videoResourceSchema>;
export type VideoListResponse = z.infer<typeof videoListResponseSchema>;
export type SearchListResponse = z.infer<typeof searchListResponseSchema>;
export type ChannelResource = z.infer<typeof channelResourceSchema>;
export type ChannelListResponse = z.infer<typeof channelListResponseSchema>;
export type PlaylistItemListResponse = z.infer<typeof playlistItemListResponseSchema>;
export type GoogleErrorBody = z.infer<typeof googleErrorSchema>;

/** Parse an ISO 8601 duration (PT#H#M#S, P#DT#H#M#S) into seconds. */
export function parseIsoDuration(duration: string | undefined): number | null {
  if (!duration) return null;
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(duration) ?? /^P(?:(\d+)D)?$/.exec(duration);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  const total =
    (days ? Number(days) * 86_400 : 0) +
    (hours ? Number(hours) * 3_600 : 0) +
    (minutes ? Number(minutes) * 60 : 0) +
    (seconds ? Number(seconds) : 0);
  return Number.isFinite(total) ? total : null;
}
