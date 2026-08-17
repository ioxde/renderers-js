import {
    CamelCaseString,
    InstructionAccountNode,
    InstructionInputValueNode,
    InstructionNode,
    isNode,
} from '@codama/nodes';
import { findProgramNodeFromPath, getLastNodeFromPath, LinkableDictionary, NodePath } from '@codama/visitors-core';

import { AsyncScope, isDefaultSkippedForOptionalAccount, isDefaultValueAppliedByBuilder } from './async';
import { getResolvedPdaValue, instructionHasResolver, instructionReadsAccount } from './pdas';

const SYNTHESISED_PROGRAM_ID_ACCOUNT = 'programId';

/**
 * The single address an instruction account default resolves to at generation time, or `undefined`
 * when only the caller knows it.
 */
export function getInstructionAccountDefaultAddress(
    defaultValue: InstructionInputValueNode | undefined,
    instructionPath: NodePath<InstructionNode>,
    linkables: LinkableDictionary,
): string | undefined {
    switch (defaultValue?.kind) {
        case 'programIdValueNode':
            return findProgramNodeFromPath(instructionPath)?.publicKey;
        case 'programLinkNode':
            return linkables.get([defaultValue])?.publicKey;
        case 'publicKeyValueNode':
            return defaultValue.publicKey;
        case 'pdaValueNode':
            return getResolvedPdaValue(defaultValue, instructionPath, linkables)?.address;
        default:
            return undefined;
    }
}

/**
 * The address the generated builders put in an account's meta when the caller supplies nothing for
 * it — the only address an instruction type's `TAccountX` default may claim. An IDL-optional account
 * whose default the builder skips gets `undefined`: no pinned address reproduces its meta.
 */
export function getInstructionAccountAddressOnOmission(
    account: InstructionAccountNode,
    instructionPath: NodePath<InstructionNode>,
    linkables: LinkableDictionary,
): string | undefined {
    if (isDefaultSkippedForOptionalAccount(account, getLastNodeFromPath(instructionPath))) return undefined;

    return getInstructionAccountDefaultAddress(account.defaultValue, instructionPath, linkables);
}

/**
 * The address an instruction account is pinned to when the caller has no say in it, or `undefined`
 * when it stays a caller-facing input. The on-chain program enforces such an address, so exposing it
 * as an overridable field can only produce a failing transaction. Rules (1)–(5) are marked below.
 */
export function getFixedInstructionAccountAddress(
    account: InstructionAccountNode,
    instructionPath: NodePath<InstructionNode>,
    linkables: LinkableDictionary,
): string | undefined {
    const instructionNode = getLastNodeFromPath(instructionPath);

    // (5) A resolver body is opaque to the renderer and may read any account, so nothing here moves.
    if (instructionHasResolver(instructionNode)) return undefined;

    // (2) A pinned signer still needs the caller's `TransactionSigner`; `"either"` counts as signer.
    if (account.isSigner !== false) return undefined;

    // (3) Not a default synthesised from the account's name.
    if (hasSynthesisedDefaultValue(account)) return undefined;

    // An IDL-optional account always keeps its input: it is the caller's only way to express the
    // omission the program branches on. Redundant with rules (4) and (5) today, kept because this is
    // a policy of the renderer and not a coincidence of two unrelated rules.
    if (account.isOptional) return undefined;

    // (1) Routed through the omission form — equivalent here, optionality being settled above — so the
    // two functions cannot come to disagree about what a builder assigns.
    const address = getInstructionAccountAddressOnOmission(account, instructionPath, linkables);
    if (!address) return undefined;

    // (4) Over-conservative on purpose: the associated-token program takes `tokenProgram` as a seed,
    // so Token-2022 yields a different and correct address. The account's own default is skipped —
    // the rule is about *other* readers.
    if (instructionReadsAccount(instructionNode, account.name)) return undefined;

    return address;
}

/**
 * Whether an instruction account's address is fixed at generation time, making its caller-facing
 * input meaningless.
 */
export function isInstructionAccountFixedAtGenerationTime(
    account: InstructionAccountNode,
    instructionPath: NodePath<InstructionNode>,
    linkables: LinkableDictionary,
): boolean {
    return !!getFixedInstructionAccountAddress(account, instructionPath, linkables);
}

/**
 * The accounts one generated builder drops from its input type, mapped to the address it emits in
 * their place. Membership is asserted against {@link isDefaultValueAppliedByBuilder}, not assumed: a
 * builder must never drop a field whose default it then skips, leaving the account unset.
 */
export function getFixedInstructionAccounts(scope: {
    asyncScope: AsyncScope;
    instructionPath: NodePath<InstructionNode>;
    linkables: LinkableDictionary;
    useAsync: boolean;
}): ReadonlyMap<CamelCaseString, string> {
    const { asyncScope, instructionPath, linkables, useAsync } = scope;
    const instructionNode = getLastNodeFromPath(instructionPath);

    const fixedAccounts = new Map<CamelCaseString, string>();
    for (const account of instructionNode.accounts ?? []) {
        const address = getFixedInstructionAccountAddress(account, instructionPath, linkables);
        if (!address) continue;
        if (!isDefaultValueAppliedByBuilder(account.defaultValue, asyncScope, useAsync)) continue;
        fixedAccounts.set(account.name, address);
    }

    return fixedAccounts;
}

// A guessed default is not a pin: a `tokenProgram` guessed into SPL Token must still accept Token-2022.
// `getCommonInstructionAccountDefaultRules` (`@codama/visitors`, run by `rootNodeFromAnchor`, not by
// `@codama/nodes-from-anchor`) guesses from the name; a declared `address =` tags the account's own name.
function hasSynthesisedDefaultValue(account: InstructionAccountNode): boolean {
    // The one synthesised rule carrying no identifier to compare, so it is matched by name instead.
    if (isNode(account.defaultValue, 'programIdValueNode')) return account.name === SYNTHESISED_PROGRAM_ID_ACCOUNT;
    if (!isNode(account.defaultValue, 'publicKeyValueNode')) return false;
    return account.defaultValue.identifier !== account.name;
}
