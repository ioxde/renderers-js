import {
    constantPdaSeedNode,
    constantPdaSeedNodeFromBytes,
    constantPdaSeedNodeFromProgramId,
    constantPdaSeedNodeFromString,
    NumberTypeNode,
    numberTypeNode,
    numberValueNode,
    publicKeyTypeNode,
    publicKeyValueNode,
    sizePrefixTypeNode,
    stringTypeNode,
    stringValueNode,
    variablePdaSeedNode,
} from '@codama/nodes';
import { describe, expect, test } from 'vitest';

import { computePdaAddress, isOnCurve } from '../../src/utils';

const RAYDIUM_AMM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const RAYDIUM_CPSWAP = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
const RAYDIUM_LAUNCHPAD = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj';
const RAYDIUM_LOCK = 'LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE';

describe('computePdaAddress', () => {
    // Cross-checked against the Rust renderer's fixtures for these IDLs: a different address is a bug.
    test.each([
        ['amm authority', RAYDIUM_AMM, '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', 254],
        ['amm_config_account_seed', RAYDIUM_AMM, '9DCxsMizn3H1hprZ7xWe6LDzeUeZBksYFpBWBtSf1PQX', 255],
        ['vault_and_lp_mint_auth_seed', RAYDIUM_CPSWAP, 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL', 253],
        ['lock_cp_authority_seed', RAYDIUM_LOCK, '3f7GcQFG397GAaEnv51zR6tsTVihYRydnydDD1cXekxH', 255],
        ['vault_auth_seed', RAYDIUM_LAUNCHPAD, 'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh', 250],
        ['__event_authority', RAYDIUM_LAUNCHPAD, '2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr', 255],
    ])('it derives the known address for seed [%s]', (seed, programAddress, address, bump) => {
        expect(computePdaAddress([constantPdaSeedNodeFromString('utf8', seed)], programAddress)).toStrictEqual({
            address,
            bump,
        });
    });

    test('it derives the same address from a byte seed as from the equivalent string seed', () => {
        // Hex for 'amm authority', the form an Anchor IDL carries it in.
        const seed = constantPdaSeedNodeFromBytes('base16', '616d6d20617574686f72697479');
        expect(computePdaAddress([seed], RAYDIUM_AMM)).toStrictEqual({
            address: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
            bump: 254,
        });
    });

    test('it uses the deriving program as the value of a program ID seed', () => {
        expect(computePdaAddress([constantPdaSeedNodeFromProgramId()], RAYDIUM_LAUNCHPAD)).toStrictEqual(
            computePdaAddress(
                [constantPdaSeedNode(publicKeyTypeNode(), publicKeyValueNode(RAYDIUM_LAUNCHPAD))],
                RAYDIUM_LAUNCHPAD,
            ),
        );
    });

    test('it encodes number seeds using the format and endianness of their type', () => {
        const littleEndian = computePdaAddress(
            [constantPdaSeedNode(numberTypeNode('u32'), numberValueNode(1))],
            RAYDIUM_LAUNCHPAD,
        );
        const bigEndian = computePdaAddress(
            [constantPdaSeedNode(numberTypeNode('u32', 'be'), numberValueNode(1))],
            RAYDIUM_LAUNCHPAD,
        );
        expect(littleEndian).not.toBeNull();
        expect(littleEndian).not.toStrictEqual(bigEndian);
    });

    test('it returns null for a PDA with a variable seed', () => {
        expect(
            computePdaAddress([variablePdaSeedNode('myAccount', publicKeyTypeNode())], RAYDIUM_LAUNCHPAD),
        ).toBeNull();
    });

    test('it returns null when the program address is not a 32-byte address', () => {
        expect(computePdaAddress([constantPdaSeedNodeFromString('utf8', 'seed')], '1111')).toBeNull();
        expect(computePdaAddress([constantPdaSeedNodeFromString('utf8', 'seed')], 'notBase58!')).toBeNull();
        expect(computePdaAddress([constantPdaSeedNodeFromString('utf8', 'seed')], '')).toBeNull();
    });

    test('it returns null for a seed whose codec writes more than the value itself', () => {
        // The size prefix makes the raw bytes disagree with what the generated client derives.
        expect(
            computePdaAddress(
                [
                    constantPdaSeedNode(
                        sizePrefixTypeNode(stringTypeNode('utf8'), numberTypeNode('u32')),
                        stringValueNode('seed'),
                    ),
                ],
                RAYDIUM_LAUNCHPAD,
            ),
        ).toBeNull();
    });

    test('it returns null for a seed longer than the maximum seed length', () => {
        expect(
            computePdaAddress([constantPdaSeedNodeFromString('utf8', 'x'.repeat(33))], RAYDIUM_LAUNCHPAD),
        ).toBeNull();
        expect(
            computePdaAddress([constantPdaSeedNodeFromString('utf8', 'x'.repeat(32))], RAYDIUM_LAUNCHPAD),
        ).not.toBeNull();
    });

    test('it returns null for more seeds than a derivation accepts', () => {
        // The appended bump takes the 16th slot, so 15 caller seeds is the ceiling; at 16 the runtime
        // throws instead of stepping down a bump, and the baked address would be unreachable.
        const seed = constantPdaSeedNodeFromString('utf8', 'x');
        const seeds = (length: number) => Array.from({ length }, () => seed);
        expect(computePdaAddress(seeds(15), RAYDIUM_LAUNCHPAD)).toStrictEqual({
            address: 'BJPeChFSL6WVp6pZC5ikmfznPSDPQRzyszD6TWNQxLmR',
            bump: 251,
        });
        expect(computePdaAddress(seeds(16), RAYDIUM_LAUNCHPAD)).toBeNull();
        expect(computePdaAddress(seeds(17), RAYDIUM_LAUNCHPAD)).toBeNull();
    });

    test('it defaults to little-endian exactly as the generated codec does', () => {
        // `endian` is required by the type, so only a hand-built or JSON-parsed node omits it — and
        // the codec encodes anything but `be` as little-endian.
        const withoutEndian = { ...numberTypeNode('u32'), endian: undefined } as unknown as NumberTypeNode;
        expect(
            computePdaAddress([constantPdaSeedNode(withoutEndian, numberValueNode(1))], RAYDIUM_LAUNCHPAD),
        ).toStrictEqual(
            computePdaAddress([constantPdaSeedNode(numberTypeNode('u32'), numberValueNode(1))], RAYDIUM_LAUNCHPAD),
        );
    });

    test('it returns null for a number seed the codec would reject', () => {
        // Masking these into range would bake an address for a value that throws at runtime.
        const outOfRange: [NumberTypeNode, number][] = [
            [numberTypeNode('u8'), 300],
            [numberTypeNode('u8'), -1],
            [numberTypeNode('i8'), 128],
            [numberTypeNode('u16'), 65536],
            [numberTypeNode('u32'), 1.5],
        ];
        for (const [type, value] of outOfRange) {
            expect(
                computePdaAddress([constantPdaSeedNode(type, numberValueNode(value))], RAYDIUM_LAUNCHPAD),
            ).toBeNull();
        }
        expect(
            computePdaAddress([constantPdaSeedNode(numberTypeNode('u8'), numberValueNode(255))], RAYDIUM_LAUNCHPAD),
        ).not.toBeNull();
    });

    test('it derives a seedless PDA', () => {
        expect(computePdaAddress([], RAYDIUM_LAUNCHPAD)).toStrictEqual({
            address: '9B63ZbNjSj5ZnBTn2V8kWcPLpFZW9RcD7rHGT6dumC8K',
            bump: 254,
        });
    });

    test('it treats a non-canonical y-coordinate encoding as on-curve, matching the Solana runtime', () => {
        // Solana decompresses with curve25519_dalek's `CompressedEdwardsY::decompress()`, which reads
        // y mod 2^255 instead of requiring 0 <= y < p. With p = 2^255 - 19, y = 1 + p is a non-canonical
        // encoding of y = 1, the identity point: accepted under zip215, rejected without it.
        const p = 2n ** 255n - 19n;
        const nonCanonicalY = 1n + p;

        const bytes = new Uint8Array(32);
        let value = nonCanonicalY;
        for (let i = 0; i < 32; i++) {
            bytes[i] = Number(value & 0xffn);
            value >>= 8n;
        }

        expect(isOnCurve(bytes)).toBe(true);
    });
});
