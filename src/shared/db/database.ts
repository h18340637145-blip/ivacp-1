"use client";

import Dexie, { type Table } from "dexie";
import type { EntityTableName, EntityTables } from "@/domain/entities";

export const IVACP_DB_NAME = "IvacpDB";

/**
 * IndexedDB 索引定义（第一个字段为主键）。
 * 新增索引时追加新版本，不要修改已发布版本。
 */
export const DB_SCHEMA_V1: Record<EntityTableName, string> = {
  ruleGroups: "id, name, sortOrder",
  autoCycles: "ruleGroupId, isActive",
  filterRuns: "id, [ruleGroupId+source], ruleGroupId, source, status, runId, createdAt",
  snapshots: "id, [source+ticketKey], ruleGroupId, filterRunId, assignmentId, origin, createdAt",
  assignments: "id, ticketKey, ruleGroupId, assignmentSource, status, latestTaskId, latestResultId, assignedAt",
  filterAudits: "id, runId, targetRuleGroupId, ticketKey, matchedRuleGroupId, decision, createdAt",
  processTasks: "id, [source+ticketKey], ruleGroupId, snapshotId, assignmentId, status, createdAt",
  processResults:
    "id, [source+ticketKey], [ruleGroupId+source], ruleGroupId, processTaskId, snapshotId, assignmentId, reviewStatus, commentStatus, createdAt",
  analysisHistories: "id, [source+ticketKey], ruleGroupId, assignmentId, sourceResultId, archivedAt",
  validationRuns: "id, resultId, source, validationStatus, systemVerdict, createdAt",
  validationChecks: "id, runId, status, createdAt",
  reviewSamples: "id, ruleGroupId, [source+ticketKey], createdAt",
  learningMemories: "id, ruleGroupId, memoryKey, [ruleGroupId+memoryKey]",
  knowledgeDocs: "id, userId, name, createdAt",
  chatMessages: "id, userId, createdAt",
  memories: "id, userId, createdAt",
  notes: "id, userId, updatedAt",
};

export class IvacpDatabase extends Dexie {
  declare ruleGroups: Table<EntityTables["ruleGroups"], string>;
  declare autoCycles: Table<EntityTables["autoCycles"], string>;
  declare filterRuns: Table<EntityTables["filterRuns"], string>;
  declare snapshots: Table<EntityTables["snapshots"], string>;
  declare assignments: Table<EntityTables["assignments"], string>;
  declare filterAudits: Table<EntityTables["filterAudits"], string>;
  declare processTasks: Table<EntityTables["processTasks"], string>;
  declare processResults: Table<EntityTables["processResults"], string>;
  declare analysisHistories: Table<EntityTables["analysisHistories"], string>;
  declare validationRuns: Table<EntityTables["validationRuns"], string>;
  declare validationChecks: Table<EntityTables["validationChecks"], string>;
  declare reviewSamples: Table<EntityTables["reviewSamples"], string>;
  declare learningMemories: Table<EntityTables["learningMemories"], string>;
  declare knowledgeDocs: Table<EntityTables["knowledgeDocs"], string>;
  declare chatMessages: Table<EntityTables["chatMessages"], string>;
  declare memories: Table<EntityTables["memories"], string>;
  declare notes: Table<EntityTables["notes"], string>;

  constructor(name = IVACP_DB_NAME) {
    super(name);
    this.version(1).stores(DB_SCHEMA_V1);
  }
}

export type IvacpDB = IvacpDatabase;

export const db = new IvacpDatabase();

export function entityTable<K extends EntityTableName>(name: K): Table<EntityTables[K], string> {
  return db.table(name) as Table<EntityTables[K], string>;
}
