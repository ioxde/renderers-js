import { type ConstantPdaSeedNode, isNode, type PdaSeedNode } from '@codama/nodes';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { getBase16Encoder, getBase58Decoder, getBase58Encoder, getBase64Encoder } from '@solana/codecs-strings';

import { getBytesFromBytesValueNode } from './codecs';

const ADDRESS_BYTES = 32;

/** Solana rejects a longer seed at derivation time. */
const MAX_SEED_LENGTH = 32;
/** `find_program_address` spends the 16th seed on the bump, so 15 caller seeds is the ceiling. */
const MAX_SEEDS = 16;
const MAX_SEEDS_WITH_BUMP = MAX_SEEDS - 1;

const PDA_MARKER = 'ProgramDerivedAddress';

/** A PDA resolved at generation time. `address` is base58. */
export type ComputedPda = Readonly<{
    address: string;
    bump: number;
}>;

function isOnCurve(bytes: Uint8Array): boolean {
    return ed25519.utils.isValidPublicKey(bytes);
}

/**
 * Mirrors Solana's `Pubkey::find_program_address` and must not diverge from it: seeds in derivation
 * order, `programId` as 32 raw bytes, highest bump first.
 */
export function findProgramAddress(seeds: readonly Uint8Array[], programId: Uint8Array): ComputedPda | null {
    for (let bump = 255; bump >= 0; bump--) {
        const hash = sha256.create();
        for (const seed of seeds) {
            hash.update(seed);
        }
        hash.update(Uint8Array.from([bump]));
        hash.update(programId);
        hash.update(new TextEncoder().encode(PDA_MARKER));
        const candidate = hash.digest();

        if (!isOnCurve(candidate)) {
            return Object.freeze({ address: getBase58Decoder().decode(candidate), bump });
        }
    }
    return null;
}

/** Inclusive. Out of range means the generated codec throws, so bail — masking would invent an address. */
const INTEGER_RANGES: Record<string, readonly [bigint, bigint]> = {
    i128: [-(2n ** 127n), 2n ** 127n - 1n],
    i16: [-32768n, 32767n],
    i32: [-2147483648n, 2147483647n],
    i64: [-(2n ** 63n), 2n ** 63n - 1n],
    i8: [-128n, 127n],
    u128: [0n, 2n ** 128n - 1n],
    u16: [0n, 65535n],
    u32: [0n, 4294967295n],
    u64: [0n, 2n ** 64n - 1n],
    u8: [0n, 255n],
};

function serializeNumber(value: number, format: string, endian: 'be' | 'le'): Uint8Array | null {
    // The codec encodes anything but `be` as little-endian; testing for `le` bakes a byte-swapped seed.
    const isLE = endian !== 'be';

    const range = INTEGER_RANGES[format];
    if (range) {
        if (!Number.isInteger(value)) return null;
        const big = BigInt(value);
        if (big < range[0] || big > range[1]) return null;
    }

    switch (format) {
        case 'u8':
            return Uint8Array.from([value & 0xff]);
        case 'i8': {
            const buf = new ArrayBuffer(1);
            new DataView(buf).setInt8(0, value);
            return new Uint8Array(buf);
        }
        case 'u16': {
            const buf = new ArrayBuffer(2);
            new DataView(buf).setUint16(0, value, isLE);
            return new Uint8Array(buf);
        }
        case 'i16': {
            const buf = new ArrayBuffer(2);
            new DataView(buf).setInt16(0, value, isLE);
            return new Uint8Array(buf);
        }
        case 'u32': {
            const buf = new ArrayBuffer(4);
            new DataView(buf).setUint32(0, value, isLE);
            return new Uint8Array(buf);
        }
        case 'i32': {
            const buf = new ArrayBuffer(4);
            new DataView(buf).setInt32(0, value, isLE);
            return new Uint8Array(buf);
        }
        case 'f32': {
            const buf = new ArrayBuffer(4);
            new DataView(buf).setFloat32(0, value, isLE);
            return new Uint8Array(buf);
        }
        case 'f64': {
            const buf = new ArrayBuffer(8);
            new DataView(buf).setFloat64(0, value, isLE);
            return new Uint8Array(buf);
        }
        case 'u64':
        case 'i64': {
            const buf = new ArrayBuffer(8);
            const view = new DataView(buf);
            if (format === 'u64') view.setBigUint64(0, BigInt(value), isLE);
            else view.setBigInt64(0, BigInt(value), isLE);
            return new Uint8Array(buf);
        }
        case 'u128':
        case 'i128': {
            const bytes = new Uint8Array(16);
            const view = new DataView(bytes.buffer);
            const big = BigInt(value);
            const mask = (1n << 64n) - 1n;
            const lo = big & mask;
            const hi = (big >> 64n) & mask;
            if (isLE) {
                view.setBigUint64(0, lo, true);
                view.setBigUint64(8, hi, true);
            } else {
                view.setBigUint64(0, hi, false);
                view.setBigUint64(8, lo, false);
            }
            return bytes;
        }
        default:
            return null;
    }
}

function encodeString(value: string, encoding: string): Uint8Array | null {
    switch (encoding) {
        case 'base16':
            return getBase16Encoder().encode(value) as Uint8Array;
        case 'base58':
            return getBase58Encoder().encode(value) as Uint8Array;
        case 'base64':
            return getBase64Encoder().encode(value) as Uint8Array;
        case 'utf8':
            return new TextEncoder().encode(value);
        default:
            return null;
    }
}

/**
 * Only bare, unwrapped types match here: a `fixedSizeTypeNode`, `sizePrefixedTypeNode` or link pads or
 * prefixes, so accepting one would bake bytes the generated codec never writes. `null` means unknown.
 */
function getConstantSeedBytes(seed: ConstantPdaSeedNode, programAddress: string): Uint8Array | null {
    const { type, value } = seed;

    if (isNode(value, 'programIdValueNode')) {
        return decodeAddress(programAddress);
    }
    if (isNode(value, 'publicKeyValueNode') && isNode(type, 'publicKeyTypeNode')) {
        return decodeAddress(value.publicKey);
    }
    if (isNode(value, 'bytesValueNode') && isNode(type, 'bytesTypeNode')) {
        return getBytesFromBytesValueNode(value);
    }
    if (isNode(value, 'stringValueNode') && isNode(type, 'stringTypeNode')) {
        return encodeString(value.string, type.encoding);
    }
    if (isNode(value, 'numberValueNode') && isNode(type, 'numberTypeNode')) {
        return serializeNumber(value.number, type.format, type.endian);
    }

    return null;
}

function decodeAddress(address: string): Uint8Array | null {
    const bytes = getBase58Encoder().encode(address) as Uint8Array;
    // Hashing a wrong-length decode mints a plausible constant for an address that cannot exist.
    return bytes.length === ADDRESS_BYTES ? bytes : null;
}

/**
 * Resolves a PDA whose every seed is a constant this renderer can encode. `null` — anything unknown
 * or out of range — means keep deriving at runtime.
 */
export function computePdaAddress(seeds: readonly PdaSeedNode[], programAddress: string): ComputedPda | null {
    try {
        if (seeds.length > MAX_SEEDS_WITH_BUMP) return null;

        const programId = decodeAddress(programAddress);
        if (!programId) return null;

        const seedBytes: Uint8Array[] = [];
        for (const seed of seeds) {
            if (!isNode(seed, 'constantPdaSeedNode')) return null;
            const bytes = getConstantSeedBytes(seed, programAddress);
            if (!bytes || bytes.length > MAX_SEED_LENGTH) return null;
            seedBytes.push(bytes);
        }

        return findProgramAddress(seedBytes, programId);
    } catch {
        return null;
    }
}
