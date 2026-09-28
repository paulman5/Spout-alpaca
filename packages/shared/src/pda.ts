import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

export const PROGRAM_ID = new PublicKey('DB2h5equ9Qp2qaaeKyL9sL6RD8LAhZzjiSUYgnaW3aeF');

/** PendingOrder PDA: seeds = ["order", user, order_id (u64 LE)] — see programs/orders-lite/src/lib.rs */
export function pendingOrderPda(user: PublicKey, orderId: bigint | string, programId: PublicKey = PROGRAM_ID): PublicKey {
  const id = new BN(orderId.toString());
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('order'), user.toBuffer(), id.toArrayLike(Buffer, 'le', 8)],
    programId,
  );
  return pda;
}
