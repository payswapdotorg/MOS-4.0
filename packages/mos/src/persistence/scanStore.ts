import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { sqliteMigrations } from "@zcode/shared/sqlite-migrations";

import type { ScanResult, ScoredVideo } from "../research/scan.js";
import { isScanStale } from "../research/evidence.js";

/**
 * Local persistence for niche scans: `mos-youtube.sqlite` (WAL) owned by the
 * services layer, path-injected here so tests use temp dirs. Migrations run
 * through the shared runner (`database: "mos_youtube"`); released SQL is
 * checksum-frozen by the runner, never edited after release.
 *
 * Retention (docs/integrations/YOUTUBE.md): scan rows + their videos are
 * deleted together; observations are kept only while a stored scan still
 * references the video; every persisted scan carries its provenance JSON and
 * collection time so staleness (30d) and statistics TTL (7d) can be computed.
 */

const MIGRATION_0001_SQL = `
CREATE TABLE scans (
  scan_id TEXT PRIMARY KEY,
  niche_json TEXT NOT NULL,
  themes_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  status TEXT NOT NULL,
  status_reason TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  usage_json TEXT NOT NULL,
  search_failures_json TEXT NOT NULL,
  skipped_channels_json TEXT NOT NULL,
  excluded_live_count INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  saved INTEGER NOT NULL DEFAULT 0,
  collected_at TEXT NOT NULL
);
CREATE TABLE scan_videos (
  scan_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  score_overall REAL,
  scored_json TEXT NOT NULL,
  PRIMARY KEY (scan_id, video_id)
);
CREATE TABLE observations (
  video_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  view_count INTEGER,
  like_count INTEGER,
  comment_count INTEGER,
  PRIMARY KEY (video_id, observed_at)
);
`;

export interface MosScanStoreOptions {
  dbPath: string;
  backupDirectories: readonly string[];
  now?: () => number;
}

export interface SavedScanSummary {
  scanId: string;
  nicheDescription: string;
  status: ScanResult["status"];
  statusReason: string;
  collectedAt: string;
  videoCount: number;
  topScore: number | null;
  saved: boolean;
  stale: boolean;
  modelVersion: string;
  usage: ScanResult["usage"];
}

export class MosScanStore {
  private db: DatabaseSync | null = null;
  private readyPromise: Promise<void> | null = null;

  constructor(private readonly options: MosScanStoreOptions) {}

  async ensureReady(): Promise<void> {
    this.readyPromise ??= this.initialize();
    return this.readyPromise;
  }

  private async initialize(): Promise<void> {
    const { DatabaseSync } = await import("node:sqlite");
    mkdirSync(dirname(this.options.dbPath), { recursive: true });
    const db = new DatabaseSync(this.options.dbPath);
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    await sqliteMigrations.migrate(
      db,
      [
        {
          id: "0001_mos_youtube",
          appVersion: "4.0.0",
          touchedTables: ["scans", "scan_videos", "observations"],
          sql: MIGRATION_0001_SQL,
        },
      ],
      {
        database: "mos_youtube",
        backupDirectories: this.options.backupDirectories,
        now: this.options.now,
      },
    );
    this.db = db;
  }

  private getDatabase(): DatabaseSync {
    if (this.db === null) {
      throw new Error("MosScanStore 未初始化：请先 await ensureReady()");
    }
    return this.db;
  }

  persistScanResult(result: ScanResult): void {
    const db = this.getDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `INSERT INTO scans (scan_id, niche_json, themes_json, plan_json, status, status_reason,
          started_at, finished_at, usage_json, search_failures_json, skipped_channels_json,
          excluded_live_count, model_version, provenance_json, collected_at)
         VALUES (@scanId, @niche, @themes, @plan, @status, @statusReason,
          @startedAt, @finishedAt, @usage, @failures, @skipped,
          @excludedLiveCount, @modelVersion, @provenance, @collectedAt)
         ON CONFLICT(scan_id) DO UPDATE SET status=@status, status_reason=@statusReason,
          finished_at=@finishedAt, usage_json=@usage, search_failures_json=@failures,
          skipped_channels_json=@skipped, excluded_live_count=@excludedLiveCount,
          model_version=@modelVersion, provenance_json=@provenance, collected_at=@collectedAt`,
      ).run(scanRowParams(result));
      db.prepare("DELETE FROM scan_videos WHERE scan_id = ?").run(result.scanId);
      const insertVideo = db.prepare(
        `INSERT INTO scan_videos (scan_id, video_id, channel_id, rank, score_overall, scored_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const insertObservation = db.prepare(
        `INSERT INTO observations (video_id, observed_at, view_count, like_count, comment_count)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT(video_id, observed_at) DO NOTHING`,
      );
      result.videos.forEach((entry, index) => {
        insertVideo.run(
          result.scanId,
          entry.video.videoId,
          entry.video.channelId,
          index + 1,
          entry.score.overall,
          JSON.stringify(entry),
        );
        insertObservation.run(
          entry.video.videoId,
          result.finishedAt,
          entry.video.viewCount,
          entry.video.likeCount,
          entry.video.commentCount,
        );
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  listScans(now: Date = new Date()): SavedScanSummary[] {
    const db = this.getDatabase();
    const rows = db
      .prepare(
        `SELECT s.scan_id, s.niche_json, s.status, s.status_reason, s.collected_at, s.model_version,
                s.usage_json, s.saved,
                (SELECT COUNT(*) FROM scan_videos v WHERE v.scan_id = s.scan_id) AS video_count,
                (SELECT MAX(v.score_overall) FROM scan_videos v WHERE v.scan_id = s.scan_id) AS top_score
         FROM scans s
         ORDER BY s.collected_at DESC, s.scan_id DESC`,
      )
      .all() as unknown as Array<{
        scan_id: string;
        niche_json: string;
        status: ScanResult["status"];
        status_reason: string;
        collected_at: string;
        model_version: string;
        usage_json: string;
        saved: number;
        video_count: number;
        top_score: number | null;
      }>;
    return rows.map((row) => ({
      scanId: row.scan_id,
      nicheDescription: (JSON.parse(row.niche_json) as { description: string }).description,
      status: row.status,
      statusReason: row.status_reason,
      collectedAt: row.collected_at,
      videoCount: row.video_count,
      topScore: row.top_score,
      saved: row.saved === 1,
      stale: isScanStale(row.collected_at, now),
      modelVersion: row.model_version,
      usage: JSON.parse(row.usage_json) as ScanResult["usage"],
    }));
  }

  getScanResult(scanId: string): ScanResult | null {
    const db = this.getDatabase();
    const scanRow = db.prepare("SELECT * FROM scans WHERE scan_id = ?").get(scanId) as unknown as
      | {
          scan_id: string;
          niche_json: string;
          themes_json: string;
          plan_json: string;
          status: ScanResult["status"];
          status_reason: string;
          started_at: string;
          finished_at: string;
          usage_json: string;
          search_failures_json: string;
          skipped_channels_json: string;
          excluded_live_count: number;
          model_version: string;
          provenance_json: string;
          collected_at: string;
        }
      | undefined;
    if (scanRow === undefined) return null;
    const videoRows = db
      .prepare("SELECT scored_json FROM scan_videos WHERE scan_id = ? ORDER BY rank ASC")
      .all(scanId) as unknown as Array<{ scored_json: string }>;
    return {
      scanId: scanRow.scan_id,
      niche: JSON.parse(scanRow.niche_json) as ScanResult["niche"],
      themes: JSON.parse(scanRow.themes_json) as ScanResult["themes"],
      plan: JSON.parse(scanRow.plan_json) as ScanResult["plan"],
      status: scanRow.status,
      statusReason: scanRow.status_reason,
      startedAt: scanRow.started_at,
      finishedAt: scanRow.finished_at,
      usage: JSON.parse(scanRow.usage_json) as ScanResult["usage"],
      searchFailures: JSON.parse(scanRow.search_failures_json) as ScanResult["searchFailures"],
      skippedChannels: JSON.parse(scanRow.skipped_channels_json) as ScanResult["skippedChannels"],
      excludedLiveCount: scanRow.excluded_live_count,
      videos: videoRows.map((row) => JSON.parse(row.scored_json) as ScoredVideo),
      provenance: JSON.parse(scanRow.provenance_json) as ScanResult["provenance"],
      modelVersion: scanRow.model_version,
    };
  }

  setSaved(scanId: string, saved: boolean): void {
    this.getDatabase().prepare("UPDATE scans SET saved = ? WHERE scan_id = ?").run(saved ? 1 : 0, scanId);
  }

  /** API usage (search calls + units) of all scans collected at or after `sinceIso`. */
  getUsageSince(sinceIso: string): { searchCalls: number; units: number } {
    const row = this.getDatabase()
      .prepare(
        `SELECT
           COALESCE(SUM(CAST(json_extract(usage_json, '$.searchCalls') AS INTEGER)), 0) AS search_calls,
           COALESCE(SUM(CAST(json_extract(usage_json, '$.units') AS INTEGER)), 0) AS units
         FROM scans WHERE collected_at >= ?`,
      )
      .get(sinceIso) as unknown as { search_calls: number; units: number };
    return { searchCalls: row.search_calls, units: row.units };
  }

  deleteScan(scanId: string): void {
    const db = this.getDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM scan_videos WHERE scan_id = ?").run(scanId);
      db.prepare(
        `DELETE FROM observations WHERE video_id NOT IN (SELECT DISTINCT video_id FROM scan_videos)`,
      ).run();
      db.prepare("DELETE FROM scans WHERE scan_id = ?").run(scanId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.readyPromise = null;
  }
}

function scanRowParams(result: ScanResult): Record<string, string | number> {
  return {
    scanId: result.scanId,
    niche: JSON.stringify(result.niche),
    themes: JSON.stringify(result.themes),
    plan: JSON.stringify(result.plan),
    status: result.status,
    statusReason: result.statusReason,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    usage: JSON.stringify(result.usage),
    failures: JSON.stringify(result.searchFailures),
    skipped: JSON.stringify(result.skippedChannels),
    excludedLiveCount: result.excludedLiveCount,
    modelVersion: result.modelVersion,
    provenance: JSON.stringify(result.provenance),
    collectedAt: result.finishedAt,
  };
}
