import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, Headers,
  BadRequestException, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiNoContentResponse, ApiQuery } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { readNamespaceContext, requireChosenNamespace } from '../common/namespace-resolver';

const DocSchema = {
  type: 'object' as const,
  required: ['id', 'collectionId', 'data', 'schemaVersion', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    collectionId: { type: 'string', format: 'uuid' },
    data: { type: 'object', additionalProperties: true },
    schemaVersion: { type: 'integer' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const InsertOrReplaceBody = {
  type: 'object' as const,
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      additionalProperties: true,
      description: 'The JSON document to store. Must be a plain object.',
    },
  },
};

const PatchBody = {
  type: 'object' as const,
  required: ['changes'],
  properties: {
    changes: {
      type: 'object',
      additionalProperties: true,
      description: 'Shallow-merge changes: right-hand top-level keys override. Nested objects are replaced, not deep-merged.',
    },
  },
};

function parseWhere(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new BadRequestException('where must be a JSON object of equality predicates');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException('where is not valid JSON');
  }
}

function parseInt32(raw: string | undefined, field: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new BadRequestException(`${field} must be a non-negative integer`);
  }
  return n;
}

@ApiTags('documents')
@Controller('api/collections/:name/docs')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Post()
  @ApiOperation({
    operationId: 'insertDoc',
    summary: 'Insert a JSON document into a collection',
    description: "Writes to the collection in the caller's pinned namespace (`x-beeable-namespace`). The collection must already exist there — call `ensureCollection(name)` on first use.",
  })
  @ApiBody({ schema: InsertOrReplaceBody })
  @ApiCreatedResponse({ description: 'Created', schema: DocSchema })
  async insert(
    @Headers() headers: Record<string, string>,
    @Param('name') name: string,
    @Body() body: { data: Record<string, unknown> },
  ) {
    const orgId = headers['x-org-id'];
    if (!orgId) throw new BadRequestException('x-org-id header required');
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
      throw new BadRequestException('data must be a JSON object');
    }
    const ns = requireChosenNamespace(readNamespaceContext(headers));
    return this.docs.insert(orgId, [ns.id], name, body.data);
  }

  @Get()
  @ApiOperation({
    operationId: 'listDocs',
    summary: 'List documents in a collection',
    description: 'Optional `where` is a JSON-encoded equality predicate (JSONB `@>` containment). When `x-beeable-namespace` is pinned, only that namespace is consulted; otherwise the full accessible set.',
  })
  @ApiQuery({ name: 'where', required: false, description: 'JSON-encoded equality predicate object' })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer' } })
  @ApiQuery({ name: 'offset', required: false, schema: { type: 'integer' } })
  @ApiOkResponse({ description: 'Array of documents', schema: { type: 'array', items: DocSchema } })
  async list(
    @Headers() headers: Record<string, string>,
    @Param('name') name: string,
    @Query('where') whereRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    const orgId = headers['x-org-id'];
    if (!orgId) throw new BadRequestException('x-org-id header required');
    const { accessible } = readNamespaceContext(headers);
    return this.docs.list(orgId, accessible.map((n) => n.id), name, {
      where: parseWhere(whereRaw),
      limit: parseInt32(limitRaw, 'limit'),
      offset: parseInt32(offsetRaw, 'offset'),
    });
  }

  @Get('count')
  @ApiOperation({ operationId: 'countDocs', summary: 'Count documents matching an optional filter' })
  @ApiQuery({ name: 'where', required: false })
  @ApiOkResponse({
    schema: { type: 'object', required: ['count'], properties: { count: { type: 'integer' } } },
  })
  async count(
    @Headers() headers: Record<string, string>,
    @Param('name') name: string,
    @Query('where') whereRaw?: string,
  ) {
    const orgId = headers['x-org-id'];
    if (!orgId) throw new BadRequestException('x-org-id header required');
    const { accessible } = readNamespaceContext(headers);
    const n = await this.docs.count(orgId, accessible.map((ns) => ns.id), name, parseWhere(whereRaw));
    return { count: n };
  }

  @Get(':id')
  @ApiOperation({ operationId: 'getDoc', summary: 'Get one document by id' })
  @ApiOkResponse({ description: 'Document', schema: DocSchema })
  async get(
    @Headers() headers: Record<string, string>,
    @Param('name') name: string,
    @Param('id') id: string,
  ) {
    const orgId = headers['x-org-id'];
    if (!orgId) throw new BadRequestException('x-org-id header required');
    const { accessible } = readNamespaceContext(headers);
    return this.docs.get(orgId, accessible.map((ns) => ns.id), name, id);
  }

  @Put(':id')
  @ApiOperation({ operationId: 'replaceDoc', summary: 'Replace a document entirely' })
  @ApiBody({ schema: InsertOrReplaceBody })
  @ApiOkResponse({ description: 'Updated document', schema: DocSchema })
  async replace(
    @Headers() headers: Record<string, string>,
    @Param('name') name: string,
    @Param('id') id: string,
    @Body() body: { data: Record<string, unknown> },
  ) {
    const orgId = headers['x-org-id'];
    if (!orgId) throw new BadRequestException('x-org-id header required');
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
      throw new BadRequestException('data must be a JSON object');
    }
    const ns = requireChosenNamespace(readNamespaceContext(headers));
    return this.docs.replace(orgId, [ns.id], name, id, body.data);
  }

  @Patch(':id')
  @ApiOperation({
    operationId: 'patchDoc',
    summary: 'Shallow-merge top-level keys into a document',
    description: 'Right-hand keys override; nested objects are replaced, not deep-merged.',
  })
  @ApiBody({ schema: PatchBody })
  @ApiOkResponse({ description: 'Updated document', schema: DocSchema })
  async patch(
    @Headers() headers: Record<string, string>,
    @Param('name') name: string,
    @Param('id') id: string,
    @Body() body: { changes: Record<string, unknown> },
  ) {
    const orgId = headers['x-org-id'];
    if (!orgId) throw new BadRequestException('x-org-id header required');
    if (!body.changes || typeof body.changes !== 'object' || Array.isArray(body.changes)) {
      throw new BadRequestException('changes must be a JSON object');
    }
    const ns = requireChosenNamespace(readNamespaceContext(headers));
    return this.docs.patch(orgId, [ns.id], name, id, body.changes);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'deleteDoc', summary: 'Delete a document' })
  @ApiNoContentResponse({ description: 'Deleted' })
  async delete(
    @Headers() headers: Record<string, string>,
    @Param('name') name: string,
    @Param('id') id: string,
  ) {
    const orgId = headers['x-org-id'];
    if (!orgId) throw new BadRequestException('x-org-id header required');
    const ns = requireChosenNamespace(readNamespaceContext(headers));
    await this.docs.delete(orgId, [ns.id], name, id);
  }
}
