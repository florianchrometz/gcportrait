// SPDX-License-Identifier: MIT
import type { Reporter, TestError } from '@playwright/test/reporter';

interface Options {
  readonly servers: readonly { readonly url: string; readonly picked: boolean }[];
}

const REFUSAL =
  ' is already used, make sure that nothing is running on the port/url or set reuseExistingServer:true in config.webServer.';

export default class ServerAdviceReporter implements Reporter {
  private readonly servers: Options['servers'];

  constructor(options: Options) {
    this.servers = options.servers;
  }

  printsToStdio(): boolean {
    return true;
  }

  onError(error: TestError): void {
    const server = this.servers.find(({ url }) => error.message === `Error: ${url}${REFUSAL}`);
    if (server === undefined) return;
    const advice = server.picked
      ? 'This run picked that port; rerun to pick new ports or stop the conflicting server.'
      : 'This is an explicit CI server URL; stop the conflicting server or choose another URL.';
    process.stderr.write(
      `gcportrait e2e: ${server.url} is occupied. ${advice} Do not enable reuseExistingServer: this run must test its own server.\n`,
    );
  }
}
