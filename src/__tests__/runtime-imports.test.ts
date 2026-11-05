import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';
import { describe, expect, it } from 'vitest';

import { COMPANY_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/standard-objects';

const RUNTIME_DIRECTORIES = ['src/front-components', 'src/logic-functions'];

const listSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : listSourceFiles(path);
    }

    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

describe('runtime imports', () => {
  it('keeps the company identifier equal to the SDK one', () => {
    expect(COMPANY_OBJECT_UNIVERSAL_IDENTIFIER).toBe(
      STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
    );
  });

  // The build replaces twenty-sdk/define with an empty stub in bundled code,
  // so any value other than the define* wrapper reads as undefined at runtime.
  it('imports only define* functions and types from twenty-sdk/define', () => {
    const offending = RUNTIME_DIRECTORIES.flatMap(listSourceFiles).flatMap(
      (path) => {
        const source = readFileSync(path, 'utf8');

        return [
          ...source.matchAll(
            /import\s*\{([^}]*)\}\s*from\s*'twenty-sdk\/define'/g,
          ),
        ].flatMap((match) =>
          match[1]
            .split(',')
            .map((name) => name.trim())
            .filter(
              (name) =>
                name !== '' &&
                !name.startsWith('type ') &&
                !/^define[A-Z]\w*$/.test(name),
            )
            .map((name) => `${path}: ${name}`),
        );
      },
    );

    expect(offending).toEqual([]);
  });
});
