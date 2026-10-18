// SPDX-License-Identifier: Apache-2.0
export interface ByteReader {
  read(): Promise<
    { readonly done: true; readonly value?: undefined } | { readonly done: false; readonly value: Uint8Array }
  >;
  cancel(): Promise<void>;
}

export function readerOf(response: Response): ByteReader | undefined {
  return response.body?.getReader() as ByteReader | undefined;
}

export async function readBody(
  response: Response,
  accept: (bytes: number, total: number) => void,
): Promise<Uint8Array> {
  const reader = readerOf(response);
  if (reader === undefined) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    try {
      accept(value.byteLength, total);
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    }
    chunks.push(value);
  }
  if (chunks.length === 1 && chunks[0] !== undefined) return chunks[0];
  return Buffer.concat(chunks, total);
}
