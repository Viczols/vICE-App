import { db } from "../db";

export type CleanupGeneralAuditLogsOptions = {
  logger?: {
    info?: (...args: any[]) => void;
    error?: (...args: any[]) => void;
  };
};

export async function cleanupGeneralAuditLogs(
  options: CleanupGeneralAuditLogsOptions = {}
) {
  const logger = options.logger;

  const result = await db.query(
    `DELETE FROM general_audit_logs
     WHERE created_at < NOW() - INTERVAL '6 months'`
  );

  logger?.info?.(
    { deleted: result.rowCount ?? 0 },
    "general audit cleanup completed"
  );

  return {
    deleted: result.rowCount ?? 0,
  };
}
