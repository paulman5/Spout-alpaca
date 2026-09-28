import { Keypair } from '@solana/web3.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Env } from '../config/env';

export function loadKeypair(env: Env): Keypair {
  if (env.KEYPAIR_JSON) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env.KEYPAIR_JSON) as number[]));
  }
  const candidates = [
    env.KEYPAIR_PATH,
    path.resolve(process.cwd(), env.KEYPAIR_PATH),
    path.resolve(process.cwd(), '../../', env.KEYPAIR_PATH),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8')) as number[]));
    }
  }
  throw new Error(`Keypair not found. Tried: ${candidates.join(', ')}. Run: solana-keygen new -o keys/devnet-keypair.json`);
}
