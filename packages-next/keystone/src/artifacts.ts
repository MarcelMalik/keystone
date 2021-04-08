import path from 'path';
import { printSchema, GraphQLSchema } from 'graphql';
import * as fs from 'fs-extra';
import type { BaseKeystone, KeystoneConfig } from '@keystone-next/types';
import { getGenerator, formatSchema } from '@prisma/sdk';
import { confirmPrompt } from './lib/prompts';
import { printGeneratedTypes } from './lib/schema-type-printer';
import { ExitError } from './scripts/utils';

export function getSchemaPaths(cwd: string) {
  return {
    prisma: path.join(cwd, 'schema.prisma'),
    graphql: path.join(cwd, 'schema.graphql'),
  };
}

type CommittedArtifacts = {
  graphql: string;
  prisma: string;
};

export async function getCommittedArtifacts(
  graphQLSchema: GraphQLSchema,
  keystone: BaseKeystone
): Promise<CommittedArtifacts> {
  return {
    graphql: printSchema(graphQLSchema),
    prisma: await formatSchema({
      schema: keystone.adapter._generatePrismaSchema({
        rels: keystone._consolidateRelationships(),
        clientDir: 'node_modules/.prisma/client',
      }),
    }),
  };
}

async function readFileButReturnNothingIfDoesNotExist(filename: string) {
  try {
    return await fs.readFile(filename, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return;
    }
    throw err;
  }
}

export async function validateCommittedArtifacts(
  graphQLSchema: GraphQLSchema,
  keystone: BaseKeystone,
  cwd: string
) {
  const artifacts = await getCommittedArtifacts(graphQLSchema, keystone);
  const schemaPaths = getSchemaPaths(cwd);
  const [writtenGraphQLSchema, writtenPrismaSchema] = await Promise.all([
    readFileButReturnNothingIfDoesNotExist(schemaPaths.graphql),
    readFileButReturnNothingIfDoesNotExist(schemaPaths.prisma),
  ]);
  const outOfDateSchemas = (() => {
    if (writtenGraphQLSchema !== artifacts.graphql && writtenPrismaSchema !== artifacts.prisma) {
      return 'both';
    }
    if (writtenGraphQLSchema !== artifacts.graphql) {
      return 'graphql';
    }
    if (writtenPrismaSchema !== artifacts.prisma) {
      return 'prisma';
    }
  })();
  if (outOfDateSchemas) {
    const message = {
      both: 'Your Prisma and GraphQL schemas are not up to date',
      graphql: 'Your GraphQL schema is not up to date',
      prisma: 'Your GraphQL schema is not up to date',
    }[outOfDateSchemas];
    console.log(message);
    const term = {
      both: 'Prisma and GraphQL schemas',
      prisma: 'Prisma schema',
      graphql: 'GraphQL schema',
    }[outOfDateSchemas];
    if (process.stdout.isTTY && (await confirmPrompt(`Would you like to update your ${term}?`))) {
      await writeCommittedArtifacts(artifacts, cwd);
    } else {
      console.log(`Please run keystone-next postinstall --fix to update your ${term}`);
      throw new ExitError(1);
    }
  }
}

export async function writeCommittedArtifacts(artifacts: CommittedArtifacts, cwd: string) {
  const schemaPaths = getSchemaPaths(cwd);
  await Promise.all([
    fs.writeFile(schemaPaths.graphql, artifacts.graphql),
    fs.writeFile(schemaPaths.prisma, artifacts.prisma),
  ]);
}

export async function generateCommittedArtifacts(
  graphQLSchema: GraphQLSchema,
  keystone: BaseKeystone,
  cwd: string
) {
  const artifacts = await getCommittedArtifacts(graphQLSchema, keystone);
  await writeCommittedArtifacts(artifacts, cwd);
  return artifacts;
}

const nodeAPIJS = (
  cwd: string,
  config: KeystoneConfig
) => `import keystoneConfig from '../../keystone';
import { PrismaClient } from '.prisma/client';
import { createListsAPI } from '@keystone-next/keystone/___internal-do-not-use-will-break-in-patch/node-api';
${makeVercelIncludeTheSQLiteDB(cwd, path.join(cwd, 'node_modules/.keystone/next'), config)}

export const lists = createListsAPI(keystoneConfig, PrismaClient);
`;

const nodeAPIDTS = `import { KeystoneListsAPI } from '@keystone-next/types';
import { KeystoneListsTypeInfo } from './types';

export const lists: KeystoneListsAPI<KeystoneListsTypeInfo>;`;

const makeVercelIncludeTheSQLiteDB = (
  cwd: string,
  directoryOfFileToBeWritten: string,
  config: KeystoneConfig
) => {
  if (config.db.adapter === 'prisma_sqlite' || config.db.provider === 'sqlite') {
    const sqliteDbAbsolutePath = path.resolve(cwd, config.db.url.replace('file:', ''));

    return `import path from 'path';

    path.join(__dirname, ${JSON.stringify(
      path.relative(directoryOfFileToBeWritten, sqliteDbAbsolutePath)
    )});
    path.join(process.cwd(), ${JSON.stringify(path.relative(cwd, sqliteDbAbsolutePath))});
    `;
  }
  return '';
};

const nextGraphQLAPIJS = (
  cwd: string,
  config: KeystoneConfig
) => `import keystoneConfig from '../../../keystone';
import { PrismaClient } from '.prisma/client';
import { nextGraphQLAPIRoute } from '@keystone-next/keystone/___internal-do-not-use-will-break-in-patch/next-graphql';
${makeVercelIncludeTheSQLiteDB(cwd, path.join(cwd, 'node_modules/.keystone/next'), config)}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default nextGraphQLAPIRoute(keystoneConfig, PrismaClient);
`;

// note the export default config is just a lazy way of going "this is also any"
const nextGraphQLAPIDTS = `export const config: any;
export default config;
`;

export async function generateNodeModulesArtifacts(
  graphQLSchema: GraphQLSchema,
  keystone: BaseKeystone,
  config: KeystoneConfig,
  cwd: string
) {
  const printedSchema = printSchema(graphQLSchema);
  const dotKeystoneDir = path.join(cwd, 'node_modules/.keystone');
  await Promise.all([
    generatePrismaClient(cwd),
    fs.outputFile(
      path.join(dotKeystoneDir, 'types.d.ts'),
      printGeneratedTypes(printedSchema, keystone, graphQLSchema)
    ),
    fs.outputFile(path.join(dotKeystoneDir, 'types.js'), ''),
    ...(config.experimental?.generateNodeAPI
      ? [
          fs.outputFile(path.join(dotKeystoneDir, 'api.js'), nodeAPIJS(cwd, config)),
          fs.outputFile(path.join(dotKeystoneDir, 'api.d.ts'), nodeAPIDTS),
        ]
      : []),
    ...(config.experimental?.generateNextGraphqlAPI
      ? [
          fs.outputFile(
            path.join(dotKeystoneDir, 'next/graphql-api.js'),
            nextGraphQLAPIJS(cwd, config)
          ),
          fs.outputFile(path.join(dotKeystoneDir, 'next/graphql-api.d.ts'), nextGraphQLAPIDTS),
        ]
      : []),
  ]);
}

async function generatePrismaClient(cwd: string) {
  const generator = await getGenerator({ schemaPath: getSchemaPaths(cwd).prisma });
  await generator.generate();
  generator.stop();
}

export function requirePrismaClient(cwd: string) {
  return require(path.join(cwd, 'node_modules/.prisma/client')).PrismaClient;
}
