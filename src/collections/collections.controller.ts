import {
  Controller, Get, Post, Delete, Body, Param, Headers, BadRequestException,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiNoContentResponse } from '@nestjs/swagger';
import { CollectionsService } from './collections.service';
import { readNamespaceContext, requireChosenNamespace } from '../common/namespace-resolver';

const CollectionSchema = {
  type: 'object' as const,
  required: ['id', 'namespaceId', 'name', 'schemaVersion', 'metadata', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    namespaceId: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    schemaVersion: { type: 'integer' },
    metadata: { type: 'object', additionalProperties: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const CreateCollectionBody = {
  type: 'object' as const,
  required: ['name'],
  properties: {
    name: { type: 'string' },
    schemaVersion: { type: 'integer', default: 1 },
    metadata: { type: 'object', additionalProperties: true },
  },
};

@ApiTags('collections')
@Controller('api/collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Post()
  @ApiOperation({
    operationId: 'createCollection',
    summary: 'Create a named collection',
    description: "Creates a collection in the caller's pinned namespace (the `x-beeable-namespace` header, set by the SDK). The namespace must already exist — call `POST /api/namespaces/ensure` on the platform first.",
  })
  @ApiBody({ schema: CreateCollectionBody })
  @ApiCreatedResponse({ description: 'Created', schema: CollectionSchema })
  async create(
    @Headers() headers: Record<string, string>,
    @Body() body: { name: string; schemaVersion?: number; metadata?: Record<string, unknown> },
  ) {
    const orgId = headers['x-org-id'];
    if (!orgId) throw new BadRequestException('x-org-id header required');
    if (!body.name) throw new BadRequestException('name is required');
    const ns = requireChosenNamespace(readNamespaceContext(headers));
    return this.collections.create(orgId, ns.id, body.name, body.schemaVersion ?? 1, body.metadata ?? {});
  }

  @Post('ensure')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'ensureCollection',
    summary: 'Idempotently create-or-fetch a collection in the pinned namespace',
    description: 'Returns the existing collection when one exists with the same name in the pinned namespace; otherwise creates it. `created` indicates which branch ran.',
  })
  @ApiBody({ schema: CreateCollectionBody })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['collection', 'created'],
      properties: {
        collection: CollectionSchema,
        created: { type: 'boolean' },
      },
    },
  })
  async ensure(
    @Headers() headers: Record<string, string>,
    @Body() body: { name: string; schemaVersion?: number; metadata?: Record<string, unknown> },
  ) {
    const orgId = headers['x-org-id'];
    if (!orgId) throw new BadRequestException('x-org-id header required');
    if (!body.name) throw new BadRequestException('name is required');
    const ns = requireChosenNamespace(readNamespaceContext(headers));
    return this.collections.ensure(orgId, ns.id, body.name, body.schemaVersion ?? 1, body.metadata ?? {});
  }

  @Get()
  @ApiOperation({
    operationId: 'listCollections',
    summary: "List collections in the caller's namespaces",
    description: 'When `x-beeable-namespace` is pinned, lists collections in that one namespace. Otherwise lists across every namespace the caller can access.',
  })
  @ApiOkResponse({ description: 'Array of collections', schema: { type: 'array', items: CollectionSchema } })
  async list(@Headers() headers: Record<string, string>) {
    const orgId = headers['x-org-id'];
    if (!orgId) throw new BadRequestException('x-org-id header required');
    const { accessible } = readNamespaceContext(headers);
    return this.collections.list(orgId, accessible.map((n) => n.id));
  }

  @Get(':name')
  @ApiOperation({ operationId: 'getCollection', summary: 'Get a single collection by name' })
  @ApiOkResponse({ description: 'Collection', schema: CollectionSchema })
  async get(@Headers() headers: Record<string, string>, @Param('name') name: string) {
    const orgId = headers['x-org-id'];
    if (!orgId) throw new BadRequestException('x-org-id header required');
    const { accessible } = readNamespaceContext(headers);
    return this.collections.getByName(orgId, accessible.map((n) => n.id), name);
  }

  @Delete(':name')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'deleteCollection', summary: 'Delete a collection and every document inside it' })
  @ApiNoContentResponse({ description: 'Deleted' })
  async delete(@Headers() headers: Record<string, string>, @Param('name') name: string) {
    const orgId = headers['x-org-id'];
    if (!orgId) throw new BadRequestException('x-org-id header required');
    const { accessible } = readNamespaceContext(headers);
    await this.collections.delete(orgId, accessible.map((n) => n.id), name);
  }
}
