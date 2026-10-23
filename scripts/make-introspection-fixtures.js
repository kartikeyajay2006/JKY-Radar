/** Regenerates GraphQL introspection fixtures from the SDL fixtures (keeps both forms in sync). */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildSchema, introspectionFromSchema } from 'graphql';

for (const v of ['v1', 'v2']) {
  const schema = buildSchema(readFileSync(`fixtures/graphql/bookstore-${v}.graphql`, 'utf8'));
  writeFileSync(
    `fixtures/graphql/bookstore-${v}.introspection.json`,
    `${JSON.stringify({ data: introspectionFromSchema(schema) }, null, 1)}\n`,
  );
}
console.log('introspection fixtures written');
