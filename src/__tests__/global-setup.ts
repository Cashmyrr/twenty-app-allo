import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { appDevOnce, appUninstall } from 'twenty-sdk/cli';

const APP_PATH = process.cwd();
const CONFIG_DIR = path.join(os.homedir(), '.twenty');

// The tests uninstall the app before and after they run, which deletes every
// Allo Call record on that server. They only run when the caller states the
// server is disposable, and only through the test config, never through the
// remotes in ~/.twenty/config.json.
const TEST_REMOTE = 'local';

function validateEnv(): { apiUrl: string; apiKey: string } {
  if (process.env.TWENTY_TEST_DISPOSABLE !== 'true') {
    throw new Error(
      'Integration tests uninstall the app, which deletes its data. ' +
        'Run them only against a disposable Twenty server, with TWENTY_TEST_DISPOSABLE=true.',
    );
  }

  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      'NODE_ENV must be "test" so the CLI reads ~/.twenty/config.test.json, not your remotes.',
    );
  }

  const apiUrl = process.env.TWENTY_API_URL;
  const apiKey = process.env.TWENTY_API_KEY;

  if (!apiUrl || !apiKey) {
    throw new Error(
      'TWENTY_API_URL and TWENTY_API_KEY must be set.\n' +
        'Start a local server: yarn twenty docker:start\n' +
        'Or set them in vitest env config.',
    );
  }

  return { apiUrl, apiKey };
}

async function checkServer(apiUrl: string) {
  let response: Response;

  try {
    response = await fetch(`${apiUrl}/healthz`);
  } catch {
    throw new Error(
      `Twenty server is not reachable at ${apiUrl}. ` +
        'Make sure the server is running before executing integration tests.',
    );
  }

  if (!response.ok) {
    throw new Error(`Server at ${apiUrl} returned ${response.status}`);
  }
}

function writeConfig(apiUrl: string, apiKey: string) {
  const payload = JSON.stringify(
    {
      version: 1,
      remotes: {
        [TEST_REMOTE]: { apiUrl, apiKey, twentyCLIAccessToken: apiKey },
      },
      defaultRemote: TEST_REMOTE,
    },
    null,
    2,
  );

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(CONFIG_DIR, 'config.test.json'), payload);
}

export async function setup() {
  const { apiUrl, apiKey } = validateEnv();

  await checkServer(apiUrl);

  writeConfig(apiUrl, apiKey);

  await appUninstall({ appPath: APP_PATH, remote: TEST_REMOTE }).catch(
    () => {},
  );

  const result = await appDevOnce({
    appPath: APP_PATH,
    onProgress: (message: string) => console.log(`[dev] ${message}`),
  });

  if (!result.success) {
    throw new Error(
      `Dev sync failed: ${result.error?.message ?? 'Unknown error'}`,
    );
  }
}

export async function teardown() {
  const uninstallResult = await appUninstall({
    appPath: APP_PATH,
    remote: TEST_REMOTE,
  });

  if (!uninstallResult.success) {
    console.warn(
      `App uninstall failed: ${uninstallResult.error?.message ?? 'Unknown error'}`,
    );
  }
}
