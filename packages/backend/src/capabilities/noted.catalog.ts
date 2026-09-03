import type { AppCapabilityCatalog, CatalogTool } from '@oxyhq/contracts';

const TOOL_VERSION = '1.0.0';

const identifier = { type: 'string', minLength: 1, maxLength: 255 } as const;
const idempotencyKey = {
  type: 'string',
  minLength: 1,
  maxLength: 255,
  description: 'Stable caller-generated key for retry-safe execution.',
} as const;
const isoTimestamp = { type: 'string', format: 'date-time' } as const;
const noteObject = { type: 'object', additionalProperties: true } as const;
const labelObject = { type: 'object', additionalProperties: true } as const;

const noteOutput = {
  type: 'object',
  properties: { note: noteObject },
  required: ['note'],
  additionalProperties: false,
} as const;

const labelOutput = {
  type: 'object',
  properties: { label: labelObject },
  required: ['label'],
  additionalProperties: false,
} as const;

type ToolInput = Omit<
  CatalogTool,
  'version' | 'capabilityPackage' | 'requiredCapabilities' | 'resourceTypes' |
  'effect' | 'idempotency' | 'rollback' | 'exposure' | 'limitKeys'
>;

function readTool(input: ToolInput, resourceTypes: string[]): CatalogTool {
  return {
    ...input,
    version: TOOL_VERSION,
    capabilityPackage: 'read',
    requiredCapabilities: ['notes.read'],
    resourceTypes,
    effect: 'read',
    idempotency: 'none',
    rollback: 'none',
    exposure: ['internal', 'mcp'],
    limitKeys: [],
  };
}

function writeTool(
  input: ToolInput,
  options: {
    capabilityPackage: 'create' | 'administer';
    capability: string;
    resourceTypes: string[];
    rollback: 'manual' | 'supported';
  },
): CatalogTool {
  return {
    ...input,
    version: TOOL_VERSION,
    capabilityPackage: options.capabilityPackage,
    requiredCapabilities: [options.capability],
    resourceTypes: options.resourceTypes,
    effect: 'write',
    idempotency: 'required',
    rollback: options.rollback,
    exposure: ['internal', 'mcp'],
    limitKeys: [],
  };
}

export const NOTED_CAPABILITY_CATALOG: AppCapabilityCatalog = {
  schemaVersion: '1',
  appId: 'noted',
  version: '1.3.0',
  audience: 'oxy-noted-api',
  internalBaseUrl: 'https://api.noted.oxy.so',
  externalMcp: { resource: 'https://mcp.noted.oxy.so' },
  accountResourceType: 'noted_account',
  tools: [
    readTool({
      name: 'searchNotes',
      description: 'Search notes belonging to one delegated Noted account.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 1_000 },
          view: { type: 'string', enum: ['active', 'archived', 'trashed'] },
          labelId: identifier,
          pinned: { type: 'boolean' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: { notes: { type: 'array', items: noteObject } },
        required: ['notes'],
        additionalProperties: false,
      },
      invocation: { method: 'GET', path: '/_oxy/capabilities/searchNotes' },
    }, ['noted_account', 'note']),
    readTool({
      name: 'readNote',
      description: 'Read one note and its generated artifact from a delegated Noted account.',
      inputSchema: {
        type: 'object',
        properties: { noteId: identifier },
        required: ['noteId'],
        additionalProperties: false,
      },
      outputSchema: noteOutput,
      invocation: { method: 'GET', path: '/_oxy/capabilities/readNote' },
    }, ['noted_account', 'note']),
    writeTool({
      name: 'createNote',
      description: 'Create a note in one delegated Noted account.',
      inputSchema: {
        type: 'object',
        properties: {
          idempotencyKey,
          title: { type: 'string', maxLength: 1_000 },
          body: { type: 'string', maxLength: 100_000 },
          color: { type: 'string', maxLength: 32 },
          labelIds: { type: 'array', items: identifier, uniqueItems: true },
          reminderAt: { anyOf: [isoTimestamp, { type: 'null' }] },
        },
        required: ['idempotencyKey'],
        additionalProperties: false,
      },
      outputSchema: noteOutput,
      invocation: { method: 'POST', path: '/_oxy/capabilities/createNote' },
    }, {
      capabilityPackage: 'create',
      capability: 'notes.create',
      resourceTypes: ['noted_account'],
      rollback: 'supported',
    }),
    writeTool({
      name: 'updateNote',
      description: 'Update the editable content and organization of one note.',
      inputSchema: {
        type: 'object',
        properties: {
          idempotencyKey,
          noteId: identifier,
          title: { type: 'string', maxLength: 1_000 },
          body: { type: 'string', maxLength: 100_000 },
          color: { type: 'string', maxLength: 32 },
          labelIds: { type: 'array', items: identifier, uniqueItems: true },
          pinned: { type: 'boolean' },
        },
        required: ['idempotencyKey', 'noteId'],
        additionalProperties: false,
      },
      outputSchema: noteOutput,
      invocation: { method: 'PATCH', path: '/_oxy/capabilities/updateNote' },
    }, {
      capabilityPackage: 'administer',
      capability: 'notes.update',
      resourceTypes: ['noted_account', 'note'],
      rollback: 'supported',
    }),
    writeTool({
      name: 'archiveNote',
      description: 'Archive one note without deleting it.',
      inputSchema: {
        type: 'object',
        properties: { idempotencyKey, noteId: identifier },
        required: ['idempotencyKey', 'noteId'],
        additionalProperties: false,
      },
      outputSchema: noteOutput,
      invocation: { method: 'POST', path: '/_oxy/capabilities/archiveNote' },
    }, {
      capabilityPackage: 'administer',
      capability: 'notes.archive',
      resourceTypes: ['noted_account', 'note'],
      rollback: 'supported',
    }),
    writeTool({
      name: 'restoreNote',
      description: 'Restore one archived or trashed note to the active view.',
      inputSchema: {
        type: 'object',
        properties: { idempotencyKey, noteId: identifier },
        required: ['idempotencyKey', 'noteId'],
        additionalProperties: false,
      },
      outputSchema: noteOutput,
      invocation: { method: 'POST', path: '/_oxy/capabilities/restoreNote' },
    }, {
      capabilityPackage: 'administer',
      capability: 'notes.restore',
      resourceTypes: ['noted_account', 'note'],
      rollback: 'supported',
    }),
    readTool({
      name: 'listLabels',
      description: 'List labels belonging to one delegated Noted account.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: {
        type: 'object',
        properties: { labels: { type: 'array', items: labelObject } },
        required: ['labels'],
        additionalProperties: false,
      },
      invocation: { method: 'GET', path: '/_oxy/capabilities/listLabels' },
    }, ['noted_account', 'label']),
    writeTool({
      name: 'createLabel',
      description: 'Create a label in one delegated Noted account.',
      inputSchema: {
        type: 'object',
        properties: {
          idempotencyKey,
          name: { type: 'string', minLength: 1, maxLength: 50 },
          color: { anyOf: [{ type: 'string', maxLength: 32 }, { type: 'null' }] },
        },
        required: ['idempotencyKey', 'name'],
        additionalProperties: false,
      },
      outputSchema: labelOutput,
      invocation: { method: 'POST', path: '/_oxy/capabilities/createLabel' },
    }, {
      capabilityPackage: 'create',
      capability: 'labels.create',
      resourceTypes: ['noted_account'],
      rollback: 'supported',
    }),
    writeTool({
      name: 'updateLabel',
      description: 'Update one label in a delegated Noted account.',
      inputSchema: {
        type: 'object',
        properties: {
          idempotencyKey,
          labelId: identifier,
          name: { type: 'string', minLength: 1, maxLength: 50 },
          color: { anyOf: [{ type: 'string', maxLength: 32 }, { type: 'null' }] },
        },
        required: ['idempotencyKey', 'labelId'],
        additionalProperties: false,
      },
      outputSchema: labelOutput,
      invocation: { method: 'PATCH', path: '/_oxy/capabilities/updateLabel' },
    }, {
      capabilityPackage: 'administer',
      capability: 'labels.update',
      resourceTypes: ['noted_account', 'label'],
      rollback: 'supported',
    }),
    writeTool({
      name: 'deleteLabel',
      description: 'Delete one label and remove it from notes in the same account.',
      inputSchema: {
        type: 'object',
        properties: { idempotencyKey, labelId: identifier },
        required: ['idempotencyKey', 'labelId'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: { deleted: { type: 'boolean' }, labelId: identifier },
        required: ['deleted', 'labelId'],
        additionalProperties: false,
      },
      invocation: { method: 'DELETE', path: '/_oxy/capabilities/deleteLabel' },
    }, {
      capabilityPackage: 'administer',
      capability: 'labels.delete',
      resourceTypes: ['noted_account', 'label'],
      rollback: 'manual',
    }),
    readTool({
      name: 'listReminders',
      description: 'List notes with reminders in one delegated Noted account.',
      inputSchema: {
        type: 'object',
        properties: {
          dueBefore: isoTimestamp,
          includeDelivered: { type: 'boolean' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: { notes: { type: 'array', items: noteObject } },
        required: ['notes'],
        additionalProperties: false,
      },
      invocation: { method: 'GET', path: '/_oxy/capabilities/listReminders' },
    }, ['noted_account', 'note']),
    writeTool({
      name: 'setReminder',
      description: 'Set or clear the reminder on one note.',
      inputSchema: {
        type: 'object',
        properties: {
          idempotencyKey,
          noteId: identifier,
          reminderAt: { anyOf: [isoTimestamp, { type: 'null' }] },
        },
        required: ['idempotencyKey', 'noteId', 'reminderAt'],
        additionalProperties: false,
      },
      outputSchema: noteOutput,
      invocation: { method: 'PATCH', path: '/_oxy/capabilities/setReminder' },
    }, {
      capabilityPackage: 'administer',
      capability: 'reminders.manage',
      resourceTypes: ['noted_account', 'note'],
      rollback: 'supported',
    }),
  ],
  events: [
    {
      type: 'note_changed',
      version: TOOL_VERSION,
      description: 'A note was created, updated, archived, trashed, restored, or deleted.',
      dataSchema: {
        type: 'object',
        properties: {
          noteId: identifier,
          change: {
            type: 'string',
            enum: ['created', 'updated', 'archived', 'trashed', 'restored', 'deleted'],
          },
        },
        required: ['noteId', 'change'],
        additionalProperties: false,
      },
      resourceTypes: ['noted_account', 'note'],
    },
    {
      type: 'reminder',
      version: TOOL_VERSION,
      description: 'A note reminder became due for delivery.',
      dataSchema: {
        type: 'object',
        properties: { noteId: identifier, reminderAt: isoTimestamp },
        required: ['noteId', 'reminderAt'],
        additionalProperties: false,
      },
      resourceTypes: ['noted_account', 'note'],
    },
  ],
};
